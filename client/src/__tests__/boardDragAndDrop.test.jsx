import { useEffect, useRef, useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closestCorners, pointerWithin } from '@dnd-kit/core'
import { boardApi } from '../lib/api'
import { useBoardDragAndDrop } from '../hooks/useBoardDragAndDrop'

vi.mock('../lib/api', () => ({ boardApi: { updateCard: vi.fn(), updateList: vi.fn() } }))
vi.mock('@dnd-kit/core', async (original) => ({
  ...await original(), closestCorners: vi.fn(), pointerWithin: vi.fn(),
}))

beforeEach(() => { vi.resetAllMocks() })
afterEach(cleanup)

function setup({ rest = false } = {}) {
  const initialLists = [
    { _id: 'a', workflow: 'sprint', position: 1000 },
    { _id: 'other', workflow: 'release', position: 1500 },
    { _id: 'b', workflow: 'sprint', position: 2000 },
  ]
  const initialCards = {
    a: [{ _id: 'one', list: 'a', position: 1000 }, { _id: 'two', list: 'a', position: 2000 }],
    b: [], other: [{ _id: 'release-task', list: 'other', position: 1000 }],
  }
  const activity = { _id: 'activity' }
  const realtimeOrRest = vi.fn(rest ? (_name, _payload, fallback) => fallback() : async () => ({ activity }))
  boardApi.updateCard.mockResolvedValue({ data: { activity } })
  boardApi.updateList.mockResolvedValue({ data: { activity } })
  const prependActivity = vi.fn()
  const toast = { error: vi.fn() }
  const hook = renderHook(() => {
    const [lists, setLists] = useState(initialLists)
    const [cards, setCardsByList] = useState(initialCards)
    const [error, setError] = useState('')
    const cardsRef = useRef(cards)
    useEffect(() => { cardsRef.current = cards }, [cards])
    const drag = useBoardDragAndDrop({
      boardId: 'board', token: 'token', lists, activeLists: lists.filter((list) => list.workflow === 'sprint'),
      cardsRef, setLists, setCardsByList, setError, realtimeOrRest, prependActivity, toast,
    })
    return { ...drag, lists, cards, error, setCardsByList }
  })
  return { ...hook, initialLists, initialCards, realtimeOrRest, prependActivity, toast }
}

const card = (id = 'one') => ({ id, data: { current: { type: 'card' } } })
const target = (id = 'b') => ({ id: `card-drop-${id}`, data: { current: { type: 'card-container', listId: id } } })
const list = (id) => ({ id, data: { current: { type: 'list' } } })

describe('board drag behavior', () => {
  it.each([false, true])('drops into an empty list with preview=%s', async (preview) => {
    const ctx = setup()
    act(() => ctx.result.current.handleDragStart({ active: card() }))
    expect(ctx.result.current.activeCard._id).toBe('one')
    if (preview) act(() => ctx.result.current.handleDragOver({ active: card(), over: target() }))
    await act(async () => ctx.result.current.handleDragEnd({ active: card(), over: target() }))
    expect(ctx.result.current.cards.a.map((item) => item._id)).toEqual(['two'])
    expect(ctx.result.current.cards.b).toEqual([{ _id: 'one', list: 'b', position: 1000 }])
    expect(ctx.result.current.cards.other).toEqual(ctx.initialCards.other)
    expect(ctx.result.current.activeCard).toBeNull()
    expect(ctx.realtimeOrRest).toHaveBeenCalledExactlyOnceWith('card:move', {
      boardId: 'board', cardId: 'one', position: 1000, list: 'b',
    }, expect.any(Function))
    expect(ctx.prependActivity).toHaveBeenCalledWith({ _id: 'activity' })
  })

  it('reorders cards over another card, using the stored list when drop metadata omits it', async () => {
    const ctx = setup()
    act(() => ctx.result.current.handleDragStart({ active: card() }))
    await act(async () => ctx.result.current.handleDragEnd({ active: card(), over: card('two') }))
    expect(ctx.result.current.cards.a.map((item) => item._id)).toEqual(['two', 'one'])
    expect(ctx.result.current.cards.a[1].position).toBe(3000)
  })

  it('skips writes when a card is dropped back at its original position', async () => {
    const ctx = setup()
    act(() => ctx.result.current.handleDragStart({ active: card() }))
    await act(async () => ctx.result.current.handleDragEnd({ active: card(), over: card() }))
    expect(ctx.realtimeOrRest).not.toHaveBeenCalled()
    expect(ctx.result.current.cards).toEqual(ctx.initialCards)
  })

  it('restores the full pre-drag snapshot after dropping outside', () => {
    const ctx = setup()
    act(() => ctx.result.current.handleDragStart({ active: card() }))
    act(() => ctx.result.current.handleDragOver({ active: card(), over: target() }))
    expect(ctx.result.current.cards.b).toHaveLength(1)
    act(() => ctx.result.current.handleDragEnd({ active: card(), over: null }))
    expect(ctx.result.current.cards).toEqual(ctx.initialCards)
    expect(ctx.result.current.lists).toEqual(ctx.initialLists)
    expect(ctx.realtimeOrRest).not.toHaveBeenCalled()
  })

  it('rolls back a failed card persist, including its live preview', async () => {
    const ctx = setup()
    ctx.realtimeOrRest.mockRejectedValueOnce(new Error('Offline'))
    act(() => ctx.result.current.handleDragStart({ active: card() }))
    act(() => ctx.result.current.handleDragOver({ active: card(), over: target() }))
    await act(async () => ctx.result.current.handleDragEnd({ active: card(), over: target() }))
    expect(ctx.result.current.cards).toEqual(ctx.initialCards)
    expect(ctx.result.current.error).toContain('Could not save card move')
    expect(ctx.toast.error).toHaveBeenCalledWith('Could not move card', 'The card was moved back.')
  })

  it('reorders only the active workflow lists and preserves other workflows', async () => {
    const ctx = setup()
    act(() => ctx.result.current.handleDragStart({ active: list('a') }))
    await act(async () => ctx.result.current.handleDragEnd({ active: list('a'), over: list('b') }))
    expect(ctx.result.current.lists.find((item) => item._id === 'other')).toEqual(ctx.initialLists[1])
    expect(ctx.result.current.lists.filter((item) => item.workflow === 'sprint').map((item) => item._id)).toEqual(['b', 'a'])
    expect(ctx.realtimeOrRest).toHaveBeenCalledWith('list:move', { boardId: 'board', listId: 'a', position: 3000 }, expect.any(Function))
  })

  it('rolls back a failed list reorder', async () => {
    const ctx = setup()
    ctx.realtimeOrRest.mockRejectedValueOnce(new Error('Offline'))
    act(() => ctx.result.current.handleDragStart({ active: list('a') }))
    await act(async () => ctx.result.current.handleDragEnd({ active: list('a'), over: list('b') }))
    expect(ctx.result.current.lists).toEqual(ctx.initialLists)
    expect(ctx.result.current.error).toContain('Could not save list order')
  })

  it('uses the same REST fallback payloads for card and list moves', async () => {
    const ctx = setup({ rest: true })
    act(() => ctx.result.current.handleDragStart({ active: card() }))
    await act(async () => ctx.result.current.handleDragEnd({ active: card(), over: target() }))
    expect(boardApi.updateCard).toHaveBeenCalledWith('board', 'one', { list: 'b', position: 1000 }, 'token')
    act(() => ctx.result.current.handleDragStart({ active: list('a') }))
    await act(async () => ctx.result.current.handleDragEnd({ active: list('a'), over: list('b') }))
    expect(boardApi.updateList).toHaveBeenCalledWith('board', 'a', { position: 3000 }, 'token')
  })

  it('reads incoming card updates through the shared ref instead of an initial snapshot', async () => {
    const ctx = setup()
    act(() => ctx.result.current.setCardsByList((current) => ({ ...current, b: [{ _id: 'remote', list: 'b', position: 1000 }] })))
    act(() => ctx.result.current.handleDragStart({ active: card('remote') }))
    await act(async () => ctx.result.current.handleDragEnd({ active: card('remote'), over: target('a') }))
    expect(ctx.result.current.cards.a.at(-1)._id).toBe('remote')
    expect(ctx.result.current.cards.b).toEqual([])
  })
})

describe('drop target collision priority', () => {
  it('prefers cards, then empty card containers, before list containers', () => {
    const ctx = setup()
    const args = { active: card(), droppableContainers: [list('list'), { id: 'drop', data: { current: { type: 'card-container' } } }, card()] }
    pointerWithin.mockReturnValue([{ id: 'list' }, { id: 'drop' }, { id: 'one' }])
    expect(ctx.result.current.collisionDetection(args)).toEqual([{ id: 'one' }])
    pointerWithin.mockReturnValue([{ id: 'list' }, { id: 'drop' }])
    expect(ctx.result.current.collisionDetection(args)).toEqual([{ id: 'drop' }])
    pointerWithin.mockReturnValue([{ id: 'list' }])
    expect(ctx.result.current.collisionDetection(args)).toEqual([{ id: 'list' }])
  })

  it('keeps the closest-corners fallback for list drags and absent pointer hits', () => {
    const ctx = setup()
    closestCorners.mockReturnValue([{ id: 'fallback' }])
    pointerWithin.mockReturnValue([])
    expect(ctx.result.current.collisionDetection({ active: list('a') })).toEqual([{ id: 'fallback' }])
    expect(ctx.result.current.collisionDetection({ active: card() })).toEqual([{ id: 'fallback' }])
  })
})
