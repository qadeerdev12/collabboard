import { useCallback, useEffect, useRef, useState } from 'react'
import { PointerSensor, useSensor, useSensors, closestCorners, pointerWithin } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { boardApi } from '../lib/api'
import { positionForIndex } from '../lib/position'

// Owns optimistic drag state, drop-target resolution, ordering, and rollback.
// BoardPage remains the owner of the shared lists/cards and transport selection.
export function useBoardDragAndDrop({
  boardId, token, lists, activeLists, cardsRef, setLists, setCardsByList,
  setError, realtimeOrRest, prependActivity, toast,
}) {
  const [activeCard, setActiveCard] = useState(null)
  const listsRef = useRef(lists)
  const activeListsRef = useRef(activeLists)
  // Keep drag reads current across optimistic moves and incoming socket updates.
  useEffect(() => { listsRef.current = lists }, [lists])
  useEffect(() => { activeListsRef.current = activeLists }, [activeLists])

  // One snapshot spans the entire drag, including previews into empty lists.
  const snapshotRef = useRef(null)
  const dragOriginRef = useRef(null)

  const sensors = useSensors(
    // A plain click opens card detail; dragging starts only after moving 6px.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const collisionDetection = useCallback((args) => {
    if (args.active.data.current?.type !== 'card') return closestCorners(args)

    const pointerHits = pointerWithin(args)
    if (pointerHits.length === 0) return closestCorners(args)

    const getDropType = (id) => args.droppableContainers.find((container) => container.id === id)?.data.current?.type
    const cardHit = pointerHits.find((hit) => getDropType(hit.id) === 'card')
    if (cardHit) return [cardHit]

    const cardContainerHit = pointerHits.find((hit) => getDropType(hit.id) === 'card-container')
    if (cardContainerHit) return [cardContainerHit]

    return pointerHits
  }, [])

  function findCardListId(cardId) {
    const map = cardsRef.current
    for (const listId in map) {
      if (map[listId].some((c) => c._id === cardId)) return listId
    }
    return null
  }

  function listIdFromDropTarget(over) {
    if (!over) return null

    const overType = over.data.current?.type
    if (overType === 'card') return over.data.current.listId ?? findCardListId(over.id)
    if (overType === 'card-container') return over.data.current.listId
    return over.id
  }

  function takeSnapshot() {
    const map = cardsRef.current
    const copy = {}
    for (const id in map) copy[id] = [...map[id]]
    snapshotRef.current = { lists: [...listsRef.current], cardsByList: copy }
  }

  function rollback(message) {
    if (snapshotRef.current) {
      setLists(snapshotRef.current.lists)
      setCardsByList(snapshotRef.current.cardsByList)
    }
    if (message) setError(message)
  }

  function handleDragStart(event) {
    const { active } = event
    setError('')
    takeSnapshot()
    if (active.data.current?.type === 'card') {
      const listId = findCardListId(active.id)
      const card = cardsRef.current[listId]?.find((c) => c._id === active.id)
      setActiveCard(card || null)
      dragOriginRef.current = { type: 'card', listId, index: cardsRef.current[listId]?.findIndex((c) => c._id === active.id) }
    } else {
      dragOriginRef.current = { type: 'list', index: listsRef.current.findIndex((l) => l._id === active.id) }
    }
  }

  // Preview cross-list movement without changing the saved ordering until drop.
  function handleDragOver(event) {
    const { active, over } = event
    if (!over || active.data.current?.type !== 'card') return

    const activeId = active.id
    const fromList = findCardListId(activeId)
    const toList = listIdFromDropTarget(over)
    if (!fromList || !toList || fromList === toList) return

    setCardsByList((prev) => {
      const fromArr = [...(prev[fromList] || [])]
      const toArr = [...(prev[toList] || [])]
      const movingIdx = fromArr.findIndex((c) => c._id === activeId)
      if (movingIdx === -1) return prev
      const [moving] = fromArr.splice(movingIdx, 1)
      const moved = { ...moving, list: toList }
      let insertAt = toArr.length
      if (over.data.current?.type === 'card') {
        const overIdx = toArr.findIndex((c) => c._id === over.id)
        insertAt = overIdx === -1 ? toArr.length : overIdx
      }
      toArr.splice(insertAt, 0, moved)
      return { ...prev, [fromList]: fromArr, [toList]: toArr }
    })
  }

  function handleDragEnd(event) {
    const { active, over } = event
    setActiveCard(null)

    // Dropped outside any target — undo the live moves from onDragOver.
    if (!over) {
      rollback()
      return
    }

    if (active.data.current?.type === 'list') {
      finishListDrag(active, over)
    } else {
      finishCardDrag(active, over)
    }
  }

  function finishListDrag(active, over) {
    const current = activeListsRef.current
    const oldIndex = current.findIndex((l) => l._id === active.id)
    const newIndex = current.findIndex((l) => l._id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

    const reordered = arrayMove(current, oldIndex, newIndex)
    const position = positionForIndex(reordered, newIndex)
    const withPos = reordered.map((l) => (l._id === active.id ? { ...l, position } : l))
    setLists((prev) => prev.map((list) => withPos.find((item) => item._id === list._id) || list).sort((a, b) => a.position - b.position))

    realtimeOrRest(
      'list:move',
      { boardId, listId: active.id, position },
      async () => (await boardApi.updateList(boardId, active.id, { position }, token)).data
    )
      .then((data) => prependActivity(data.activity))
      .catch(() => {
        rollback('Could not save list order — reverted.')
        toast.error('Could not save list order', 'The list was moved back.')
      })
  }

  function finishCardDrag(active, over) {
    const activeId = active.id
    const originContainer = findCardListId(activeId)
    const targetContainer = listIdFromDropTarget(over) || originContainer
    if (!originContainer || !targetContainer) return

    let arr = [...(cardsRef.current[targetContainer] || [])]
    let sourceWithoutMoving = null
    if (originContainer !== targetContainer) {
      const originArr = [...(cardsRef.current[originContainer] || [])]
      const moving = originArr.find((c) => c._id === activeId)
      if (!moving) return

      sourceWithoutMoving = originArr.filter((c) => c._id !== activeId)
      arr = arr.filter((c) => c._id !== activeId)
      let insertAt = arr.length
      if (over.data.current?.type === 'card') {
        const overIdx = arr.findIndex((c) => c._id === over.id)
        insertAt = overIdx === -1 ? arr.length : overIdx
      }
      arr.splice(insertAt, 0, { ...moving, list: targetContainer })
    }

    const oldIndex = arr.findIndex((c) => c._id === activeId)
    let newIndex = oldIndex
    if (originContainer === targetContainer && over.data.current?.type === 'card') {
      const overIdx = arr.findIndex((c) => c._id === over.id)
      if (overIdx !== -1) newIndex = overIdx
    }

    const origin = dragOriginRef.current
    const unchanged = origin?.type === 'card' && origin.listId === targetContainer && origin.index === newIndex
    if (unchanged) return  // nothing actually moved — skip the write

    const finalArr = oldIndex === newIndex ? arr : arrayMove(arr, oldIndex, newIndex)
    const finalIndex = finalArr.findIndex((c) => c._id === activeId)
    const position = positionForIndex(finalArr, finalIndex)
    const withPos = finalArr.map((c) => (c._id === activeId ? { ...c, list: targetContainer, position } : c))
    setCardsByList((prev) => {
      const next = { ...prev, [targetContainer]: withPos }
      if (sourceWithoutMoving) next[originContainer] = sourceWithoutMoving
      return next
    })

    realtimeOrRest(
      'card:move',
      { boardId, cardId: activeId, position, list: targetContainer },
      async () => (await boardApi.updateCard(boardId, activeId, { position, list: targetContainer }, token)).data
    )
      .then((data) => prependActivity(data.activity))
      .catch(() => {
        rollback('Could not save card move — reverted.')
        toast.error('Could not move card', 'The card was moved back.')
      })
  }

  return { activeCard, sensors, collisionDetection, handleDragStart, handleDragOver, handleDragEnd }
}
