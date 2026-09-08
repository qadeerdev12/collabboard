import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { boardApi, integrationApi } from '../lib/api'
import { useSocket } from '../hooks/useSocket'
import { useBoardDragAndDrop } from '../hooks/useBoardDragAndDrop'
import { positionBetween } from '../lib/position'
import { memberUserId } from '../lib/boardMembers'
import BoardColumn from '../components/BoardColumn'
import CardDetailModal from '../components/CardDetailModal'
import NewBoardModal from '../components/NewBoardModal'
import MembersPanel from '../components/MembersPanel'
import ActivityPanel from '../components/ActivityPanel'
import ChatPanel from '../components/ChatPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import BoardHeader from '../components/board/BoardHeader'
import BoardFilters from '../components/board/BoardFilters'
import { BoardLoadingSkeleton, BoardLoadError, BoardEmptyState } from '../components/board/BoardPageStates'
import ActiveWorkflowToolbar from '../components/board/ActiveWorkflowToolbar'
import ProjectWelcomeState from '../components/board/ProjectWelcomeState'
import WorkflowSwitcher from '../components/board/WorkflowSwitcher'
import AddWorkflowModal from '../components/board/AddWorkflowModal'
import GitHubIntegrationPanel from '../components/board/GitHubIntegrationPanel'

export default function BoardPage() {
  const { boardId } = useParams()
  const { user, token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [board, setBoard] = useState(null)
  const [workflows, setWorkflows] = useState([])
  const [activeWorkflowId, setActiveWorkflowId] = useState('')
  const [addingWorkflow, setAddingWorkflow] = useState(false)
  const [quickWorkflowId, setQuickWorkflowId] = useState('')
  const [workflowTemplates, setWorkflowTemplates] = useState([])
  const [workflowTemplatesLoading, setWorkflowTemplatesLoading] = useState(true)
  const [workflowTemplatesError, setWorkflowTemplatesError] = useState('')
  const [lists, setLists] = useState([])              // ordered by position
  const [cardsByList, setCardsByList] = useState({})  // listId -> ordered cards
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newListTitle, setNewListTitle] = useState('')
  const [cardDrafts, setCardDrafts] = useState({})
  const [selectedCard, setSelectedCard] = useState(null)
  const [editingBoard, setEditingBoard] = useState(false)
  const [boardDeleteOpen, setBoardDeleteOpen] = useState(false)
  const [boardDeleting, setBoardDeleting] = useState(false)
  const [listDeleteTarget, setListDeleteTarget] = useState(null)
  const [listDeleting, setListDeleting] = useState(false)
  const [managingMembers, setManagingMembers] = useState(false)
  const [presence, setPresence] = useState([])
  const [members, setMembers] = useState([])
  const [activities, setActivities] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState('')
  const [messages, setMessages] = useState([])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState('')
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [typingUsers, setTypingUsers] = useState([])
  const [githubAccount, setGithubAccount] = useState(null)
  const [githubIntegration, setGithubIntegration] = useState(null)
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubError, setGithubError] = useState('')
  const [githubRepos, setGithubRepos] = useState([])
  const [githubReposLoaded, setGithubReposLoaded] = useState(false)
  const [githubReposLoading, setGithubReposLoading] = useState(false)
  const [githubReposError, setGithubReposError] = useState('')
  const [githubSaving, setGithubSaving] = useState(false)
  const [githubCommits, setGithubCommits] = useState([])
  const [githubCommitsLoaded, setGithubCommitsLoaded] = useState(false)
  const [githubCommitsLoading, setGithubCommitsLoading] = useState(false)
  const [githubCommitsError, setGithubCommitsError] = useState('')
  const [githubStats, setGithubStats] = useState(null)
  const [githubStatsLoaded, setGithubStatsLoaded] = useState(false)
  const [githubStatsLoading, setGithubStatsLoading] = useState(false)
  const [githubStatsError, setGithubStatsError] = useState('')
  const [cardSearch, setCardSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const currentRole = members.find((m) => String(memberUserId(m)) === String(user?.id))?.role
  const canEditBoard = ['owner', 'admin'].includes(currentRole)
  const canDeleteBoard = currentRole === 'owner'
  const { connected, connectionError, emitWithAck, onSocketEvent } = useSocket(token)

  const activeWorkflow = workflows.find((workflow) => workflow._id === activeWorkflowId) || workflows[0] || null
  const activeLists = useMemo(
    () => {
      if (!activeWorkflowId) return lists
      return lists.filter((list) => list.workflow === activeWorkflowId)
    },
    [activeWorkflowId, lists]
  )
  const activeCardsByList = useMemo(() => {
    const next = {}
    for (const list of activeLists) next[list._id] = cardsByList[list._id] || []
    return next
  }, [activeLists, cardsByList])
  const listsByWorkflow = useMemo(() => {
    const counts = {}
    for (const list of lists) counts[list.workflow] = (counts[list.workflow] || 0) + 1
    return counts
  }, [lists])
  const cardsByWorkflow = useMemo(() => {
    const counts = {}
    for (const listId in cardsByList) {
      const workflowId = lists.find((list) => list._id === listId)?.workflow
      if (!workflowId) continue
      counts[workflowId] = (counts[workflowId] || 0) + cardsByList[listId].length
    }
    return counts
  }, [cardsByList, lists])
  const totalCardCount = useMemo(
    () => Object.values(activeCardsByList).reduce((sum, cards) => sum + cards.length, 0),
    [activeCardsByList]
  )
  const totalBoardCardCount = useMemo(
    () => Object.values(cardsByList).reduce((sum, cards) => sum + cards.length, 0),
    [cardsByList]
  )
  // A brand-new project is a container with only the default workflow. Once the
  // user adds any workflow, list, or card, the board returns to normal empty/list states.
  const showProjectWelcome = workflows.length === 1
    && workflows[0]?.templateKey === 'default'
    && lists.length === 0
    && totalBoardCardCount === 0
  const filtersActive = Boolean(cardSearch.trim()) || tagFilter !== 'all' || statusFilter !== 'all'
  const activityPanelOpen = searchParams.get('panel') === 'activity'
  const chatPanelOpen = searchParams.get('panel') === 'chat'
  const githubPanelOpen = searchParams.get('panel') === 'github'
  const visibleCardsByList = useMemo(() => {
    const query = cardSearch.trim().toLowerCase()
    const next = {}

    for (const listId in activeCardsByList) {
      next[listId] = activeCardsByList[listId].filter((card) => {
        const titleAndDescription = `${card.title || ''} ${card.description || ''}`.toLowerCase()
        const matchesSearch = !query || titleAndDescription.includes(query)
        const matchesTag = tagFilter === 'all' || (card.tag || 'Task') === tagFilter
        const matchesStatus = statusFilter === 'all' || (card.status || 'Todo') === statusFilter
        return matchesSearch && matchesTag && matchesStatus
      })
    }

    return next
  }, [activeCardsByList, cardSearch, tagFilter, statusFilter])
  const filteredCardCount = useMemo(
    () => Object.values(visibleCardsByList).reduce((sum, cards) => sum + cards.length, 0),
    [visibleCardsByList]
  )
  const listDeleteCardCount = listDeleteTarget ? cardsByList[listDeleteTarget._id]?.length || 0 : 0
  const listDeleteDescription = listDeleteTarget
    ? `This will remove this list${listDeleteCardCount ? ` and ${listDeleteCardCount} ${listDeleteCardCount === 1 ? 'card' : 'cards'}` : ''} from ${activeWorkflow?.name || 'this workflow'}.`
    : ''

  // Card-detail updates and drag handlers share the same up-to-date card map.
  const cardsRef = useRef(cardsByList)
  useEffect(() => { cardsRef.current = cardsByList }, [cardsByList])

  const { activeCard, sensors, collisionDetection, handleDragStart, handleDragOver, handleDragEnd } = useBoardDragAndDrop({
    boardId, token, lists, activeLists, cardsRef, setLists, setCardsByList,
    setError, realtimeOrRest, prependActivity, toast,
  })

  const wasConnectedRef = useRef(false)
  const connectionInitializedRef = useRef(false)
  const typingTimersRef = useRef(new Map())

  const loadBoard = useCallback(async ({ keepLoading = false } = {}) => {
    try {
      if (!keepLoading) setLoading(true)
      const res = await boardApi.getOne(boardId, token)
      const sortedLists = [...res.data.lists].sort((a, b) => a.position - b.position)
      const byList = {}
      for (const l of sortedLists) byList[l._id] = []
      for (const c of res.data.cards) {
        if (!byList[c.list]) byList[c.list] = []
        byList[c.list].push(c)
      }
      for (const id in byList) byList[id].sort((a, b) => a.position - b.position)
      setBoard(res.data.board)
      setMembers(res.data.board.members || [])
      setWorkflows(res.data.workflows || [])
      setActiveWorkflowId((current) => {
        if ((res.data.workflows || []).some((workflow) => workflow._id === current)) return current
        return res.data.workflows?.[0]?._id || ''
      })
      setLists(sortedLists)
      setCardsByList(byList)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [boardId, token])

  useEffect(() => {
    const cardId = searchParams.get('card')
    if (!cardId || loading || board?._id !== boardId) return undefined
    // Consume the deep link once after the project loads. Clearing the query
    // prevents later socket updates from reopening a dismissed detail modal.
    const timer = setTimeout(() => {
      const target = Object.values(cardsByList).flat().find((card) => card._id === cardId)
      if (target) {
        const workflowId = target.workflow || lists.find((list) => list._id === target.list)?.workflow
        if (workflowId) setActiveWorkflowId(workflowId)
        setSelectedCard(target)
      } else {
        setError('This task is no longer available in this project.')
      }
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('card')
        return next
      }, { replace: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [board?._id, boardId, cardsByList, lists, loading, searchParams, setSearchParams])

  const loadActivities = useCallback(async () => {
    try {
      setActivityLoading(true)
      setActivityError('')
      const res = await boardApi.getActivities(boardId, token)
      setActivities(res.data.activities || [])
    } catch (err) {
      setActivityError(err.message)
    } finally {
      setActivityLoading(false)
    }
  }, [boardId, token])

  const loadMessages = useCallback(async () => {
    try {
      setMessagesLoading(true)
      setMessagesError('')
      const res = await boardApi.getMessages(boardId, token)
      setMessages(res.data.messages || [])
      setMessagesLoaded(true)
    } catch (err) {
      setMessagesError(err.message)
    } finally {
      setMessagesLoading(false)
    }
  }, [boardId, token])

  const loadGitHubSummary = useCallback(async () => {
    try {
      setGithubLoading(true)
      setGithubError('')
      const [accountRes, integrationRes] = await Promise.all([
        integrationApi.getGitHubAccount(token),
        boardApi.getGitHubIntegration(boardId, token),
      ])
      setGithubAccount(accountRes.data.account)
      setGithubIntegration(integrationRes.data.integration)
    } catch (err) {
      setGithubError(err.message)
    } finally {
      setGithubLoading(false)
    }
  }, [boardId, token])

  const loadGitHubRepos = useCallback(async () => {
    try {
      setGithubReposLoading(true)
      setGithubReposError('')
      const res = await integrationApi.listGitHubRepos(token)
      setGithubRepos(res.data.repositories || [])
      setGithubReposLoaded(true)
    } catch (err) {
      setGithubReposError(err.message)
    } finally {
      setGithubReposLoading(false)
    }
  }, [token])

  const loadGitHubCommits = useCallback(async () => {
    try {
      setGithubCommitsLoading(true)
      setGithubCommitsError('')
      const res = await boardApi.getGitHubCommits(boardId, token)
      setGithubCommits(res.data.commits || [])
      setGithubIntegration(res.data.integration)
      const syncedActivities = res.data.activities || []
      syncedActivities.forEach((activity) => prependActivity(activity))
      setGithubCommitsLoaded(true)
    } catch (err) {
      setGithubCommitsError(err.message)
    } finally {
      setGithubCommitsLoading(false)
    }
  }, [boardId, token])

  const loadGitHubStats = useCallback(async () => {
    try {
      setGithubStatsLoading(true)
      setGithubStatsError('')
      const res = await boardApi.getGitHubStats(boardId, token)
      setGithubStats(res.data.stats || null)
      setGithubIntegration(res.data.integration)
      setGithubStatsLoaded(true)
    } catch (err) {
      setGithubStatsError(err.message)
    } finally {
      setGithubStatsLoading(false)
    }
  }, [boardId, token])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadBoard()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadBoard])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        setWorkflowTemplatesLoading(true)
        setWorkflowTemplatesError('')
        const res = await boardApi.listTemplates(token)
        if (!cancelled) setWorkflowTemplates(res.data.templates || [])
      } catch (err) {
        if (!cancelled) setWorkflowTemplatesError(err.message)
      } finally {
        if (!cancelled) setWorkflowTemplatesLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [token])

  useEffect(() => {
    if (!board) return undefined
    const timer = setTimeout(() => {
      loadActivities()
    }, 0)
    return () => clearTimeout(timer)
  }, [board, loadActivities])

  useEffect(() => {
    if (!board) return undefined
    const timer = setTimeout(() => {
      loadGitHubSummary()
    }, 0)
    return () => clearTimeout(timer)
  }, [board, loadGitHubSummary])

  useEffect(() => {
    if (!githubPanelOpen || !githubAccount || !canEditBoard || githubReposLoaded || githubReposLoading) return undefined
    const timer = setTimeout(() => {
      loadGitHubRepos()
    }, 0)
    return () => clearTimeout(timer)
  }, [canEditBoard, githubAccount, githubPanelOpen, githubReposLoaded, githubReposLoading, loadGitHubRepos])

  useEffect(() => {
    if (!githubPanelOpen || !githubIntegration || githubCommitsLoaded || githubCommitsLoading) return undefined
    const timer = setTimeout(() => {
      loadGitHubCommits()
    }, 0)
    return () => clearTimeout(timer)
  }, [githubCommitsLoaded, githubCommitsLoading, githubIntegration, githubPanelOpen, loadGitHubCommits])

  useEffect(() => {
    if (!githubPanelOpen || !githubIntegration || githubStatsLoaded || githubStatsLoading) return undefined
    const timer = setTimeout(() => {
      loadGitHubStats()
    }, 0)
    return () => clearTimeout(timer)
  }, [githubIntegration, githubPanelOpen, githubStatsLoaded, githubStatsLoading, loadGitHubStats])

  useEffect(() => {
    if (!board || !chatPanelOpen || messagesLoaded) return undefined
    const timer = setTimeout(() => {
      loadMessages()
    }, 0)
    return () => clearTimeout(timer)
  }, [board, chatPanelOpen, loadMessages, messagesLoaded])

  useEffect(() => {
    const timer = setTimeout(() => {
      setMessages([])
      setMessagesLoaded(false)
      setMessagesLoading(false)
      setMessagesError('')
      setUnreadMessages(0)
      setTypingUsers([])
      setGithubAccount(null)
      setGithubIntegration(null)
      setGithubError('')
      setGithubRepos([])
      setGithubReposLoaded(false)
      setGithubReposError('')
      setGithubCommits([])
      setGithubCommitsLoaded(false)
      setGithubCommitsError('')
      setGithubStats(null)
      setGithubStatsLoaded(false)
      setGithubStatsError('')
      typingTimersRef.current.forEach((typingTimer) => clearTimeout(typingTimer))
      typingTimersRef.current.clear()
    }, 0)
    return () => clearTimeout(timer)
  }, [boardId])

  useEffect(() => {
    if (!chatPanelOpen) return undefined
    const timer = setTimeout(() => {
      setUnreadMessages(0)
    }, 0)
    return () => clearTimeout(timer)
  }, [chatPanelOpen])

  useEffect(() => {
    if (!connected || !boardId) return undefined
    let cancelled = false

    // Connection auth proves the JWT is valid. Joining still checks membership
    // for this specific board before the server places the socket in its room.
    emitWithAck('board:join', { boardId })
      .then((data) => {
        if (!cancelled) setPresence(data.presence || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })

    // Reconnects can miss events while offline, so reload the full board
    // snapshot after joining. Incoming events keep the snapshot fresh after that.
    const timer = setTimeout(() => {
      loadBoard({ keepLoading: true })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [boardId, connected, emitWithAck, loadBoard])

  useEffect(() => {
    if (!connectionInitializedRef.current) {
      connectionInitializedRef.current = true
      wasConnectedRef.current = connected
      return
    }

    if (connected) {
      wasConnectedRef.current = true
      return
    }

    if (wasConnectedRef.current && connectionError) {
      toast.error('Realtime disconnected', 'Changes will still save through REST when possible.')
      wasConnectedRef.current = false
    }
  }, [connected, connectionError, toast])

  const updateTypingUser = useCallback((typingUser, typing) => {
    const id = typingUser?.id || typingUser?._id
    if (!id || String(id) === String(user?.id)) return

    const existingTimer = typingTimersRef.current.get(id)
    if (existingTimer) clearTimeout(existingTimer)

    if (!typing) {
      typingTimersRef.current.delete(id)
      setTypingUsers((prev) => prev.filter((item) => String(item.id || item._id) !== String(id)))
      return
    }

    setTypingUsers((prev) => {
      const nextUser = {
        id,
        name: typingUser.name,
        email: typingUser.email,
      }
      if (prev.some((item) => String(item.id || item._id) === String(id))) {
        return prev.map((item) => (String(item.id || item._id) === String(id) ? nextUser : item))
      }
      return [...prev, nextUser].slice(-3)
    })

    const staleTimer = setTimeout(() => {
      typingTimersRef.current.delete(id)
      setTypingUsers((prev) => prev.filter((item) => String(item.id || item._id) !== String(id)))
    }, 3000)
    typingTimersRef.current.set(id, staleTimer)
  }, [user?.id])

  useEffect(() => {
    if (!connected) return undefined

    // Each handler guards on boardId. A socket can reconnect or the user can
    // navigate between boards, and stale events should never mutate this view.
    function onPresenceUpdate(payload) {
      if (payload.boardId === boardId) setPresence(payload.users || [])
    }

    function onCardCreated(payload) {
      if (payload.boardId !== boardId) return
      setCardsByList((prev) => ({
        ...prev,
        [payload.card.list]: [...(prev[payload.card.list] || []), payload.card].sort((a, b) => a.position - b.position),
      }))
    }

    function onCardChanged(payload) {
      if (payload.boardId !== boardId) return
      replaceCard(payload.card)
    }

    function onCardDeleted(payload) {
      if (payload.boardId !== boardId) return
      setCardsByList((prev) => {
        const next = {}
        for (const listId in prev) next[listId] = prev[listId].filter((card) => card._id !== payload.cardId)
        return next
      })
      setSelectedCard((current) => (current?._id === payload.cardId ? null : current))
    }

    function onListCreated(payload) {
      if (payload.boardId !== boardId) return
      setLists((prev) => [...prev, payload.list].sort((a, b) => a.position - b.position))
      setCardsByList((prev) => ({ ...prev, [payload.list._id]: prev[payload.list._id] || [] }))
    }

    function onListChanged(payload) {
      if (payload.boardId !== boardId) return
      setLists((prev) => prev.map((list) => (list._id === payload.list._id ? payload.list : list)).sort((a, b) => a.position - b.position))
    }

    function onListDeleted(payload) {
      if (payload.boardId !== boardId) return
      setLists((prev) => prev.filter((list) => list._id !== payload.listId))
      setCardsByList((prev) => {
        const next = { ...prev }
        delete next[payload.listId]
        return next
      })
      setSelectedCard((current) => (current?.list === payload.listId ? null : current))
    }

    function onWorkflowCreated(payload) {
      if (payload.boardId !== boardId) return
      mergeWorkflowPayload(payload)
    }

    function onMembersUpdated(payload) {
      if (payload.boardId !== boardId) return
      const stillMember = payload.members?.some((member) => String(memberUserId(member)) === String(user?.id))
      if (!stillMember) {
        navigate('/dashboard')
        return
      }

      setMembers(payload.members || [])
      setBoard((current) => current ? { ...current, members: payload.members || [] } : current)
    }

    function onActivityCreated(payload) {
      if (payload.boardId !== boardId) return
      prependActivity(payload.activity)
    }

    function onMessageCreated(payload) {
      if (payload.boardId !== boardId) return
      updateTypingUser(payload.message?.sender, false)
      appendMessage(payload.message)
      if (!chatPanelOpen) setUnreadMessages((count) => Math.min(count + 1, 99))
    }

    function onMessageDeleted(payload) {
      if (payload.boardId !== boardId) return
      updateMessage(payload.message)
    }

    function onChatCleared(payload) {
      if (payload.boardId !== boardId) return
      setMessages([])
      setUnreadMessages(0)
    }

    function onChatTyping(payload) {
      if (payload.boardId !== boardId) return
      updateTypingUser(payload.user, payload.typing)
    }

    const cleanups = [
      onSocketEvent('presence:update', onPresenceUpdate),
      onSocketEvent('card:created', onCardCreated),
      onSocketEvent('card:updated', onCardChanged),
      onSocketEvent('card:moved', onCardChanged),
      onSocketEvent('card:deleted', onCardDeleted),
      onSocketEvent('list:created', onListCreated),
      onSocketEvent('list:updated', onListChanged),
      onSocketEvent('list:moved', onListChanged),
      onSocketEvent('list:deleted', onListDeleted),
      onSocketEvent('workflow:created', onWorkflowCreated),
      onSocketEvent('members:updated', onMembersUpdated),
      onSocketEvent('activity:created', onActivityCreated),
      onSocketEvent('message:created', onMessageCreated),
      onSocketEvent('message:deleted', onMessageDeleted),
      onSocketEvent('chat:cleared', onChatCleared),
      onSocketEvent('chat:typing', onChatTyping),
    ]

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [boardId, chatPanelOpen, connected, navigate, onSocketEvent, updateTypingUser, user?.id])

  // --- helpers -------------------------------------------------------------



  function setDraftForList(listId, value) {
    setCardDrafts((prev) => ({ ...prev, [listId]: value }))
  }

  // Prefer Socket.IO writes so collaborators receive live updates. REST keeps
  // the board usable if the socket drops while the API is still reachable.
  async function realtimeOrRest(eventName, payload, restCall) {
    if (connected) return emitWithAck(eventName, payload)
    return restCall()
  }

  function replaceCard(updatedCard) {
    setCardsByList((prev) => {
      const next = {}
      for (const listId in prev) {
        next[listId] = prev[listId].filter((card) => card._id !== updatedCard._id)
      }
      next[updatedCard.list] = [...(next[updatedCard.list] || []), updatedCard].sort((a, b) => a.position - b.position)
      return next
    })
    setSelectedCard((current) => (current?._id === updatedCard._id ? updatedCard : current))
  }

  function mergeWorkflowPayload({ workflow, lists: incomingLists = [], cards: incomingCards = [] }) {
    if (!workflow?._id) return

    setWorkflows((prev) => {
      const existing = prev.some((item) => item._id === workflow._id)
      const next = existing
        ? prev.map((item) => (item._id === workflow._id ? workflow : item))
        : [...prev, workflow]
      return next.sort((a, b) => a.position - b.position)
    })

    setLists((prev) => {
      const byId = new Map(prev.map((list) => [list._id, list]))
      for (const list of incomingLists) byId.set(list._id, list)
      return [...byId.values()].sort((a, b) => a.position - b.position)
    })

    setCardsByList((prev) => {
      const next = { ...prev }
      for (const list of incomingLists) {
        if (!next[list._id]) next[list._id] = []
      }
      for (const card of incomingCards) {
        const current = next[card.list] || []
        next[card.list] = [...current.filter((item) => item._id !== card._id), card]
      }
      for (const listId in next) next[listId] = [...next[listId]].sort((a, b) => a.position - b.position)
      return next
    })
  }

  function removeCard(card) {
    setCardsByList((prev) => ({
      ...prev,
      [card.list]: (prev[card.list] || []).filter((c) => c._id !== card._id),
    }))
  }

  function prependActivity(activity) {
    if (!activity?._id) return
    setActivities((prev) => {
      if (prev.some((item) => item._id === activity._id)) return prev
      return [activity, ...prev].slice(0, 30)
    })
  }

  function appendMessage(message) {
    if (!message?._id) return
    setMessages((prev) => {
      if (prev.some((item) => item._id === message._id)) return prev
      return [...prev, message].slice(-100)
    })
  }

  function replaceMessage(messageId, nextMessage) {
    setMessages((prev) => prev.map((item) => (item._id === messageId ? nextMessage : item)))
  }

  function updateMessage(message) {
    if (!message?._id) return
    setMessages((prev) => prev.map((item) => (item._id === message._id ? message : item)))
  }

  function buildPendingMessage(body) {
    const clientId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`
    return {
      _id: clientId,
      clientId,
      body,
      createdAt: new Date().toISOString(),
      sender: {
        id: user?.id,
        name: user?.name,
        email: user?.email,
      },
      deliveryStatus: 'sending',
    }
  }

  function closeActivityPanel() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('panel')
      return next
    })
  }

  function openPanel(panel) {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('panel', panel)
      return next
    })
  }

  function openChatPanel() {
    setUnreadMessages(0)
    openPanel('chat')
  }

  function closeChatPanel() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('panel')
      return next
    })
  }

  function closeGitHubPanel() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('panel')
      return next
    })
  }

  // --- add list / card -----------------------------------------------------

  async function handleAddCard(e, listId) {
    e.preventDefault()
    const title = (cardDrafts[listId] || '').trim()
    if (!title) return
    try {
      const listCards = cardsByList[listId] || []
      const last = listCards[listCards.length - 1]
      const position = positionBetween(last?.position, undefined)
      const workflowId = lists.find((list) => list._id === listId)?.workflow || activeWorkflowId || undefined
      const data = await realtimeOrRest(
        'card:create',
        { boardId, title, listId, position, workflowId },
        async () => (await boardApi.createCard(boardId, title, listId, position, token, { workflowId })).data
      )
      setCardsByList((prev) => ({ ...prev, [listId]: [...(prev[listId] || []), data.card] }))
      prependActivity(data.activity)
      setDraftForList(listId, '')
      toast.success('Card created', title)
    } catch (err) {
      setError(err.message)
      toast.error('Could not create card', err.message)
    }
  }

  async function handleAddList(e) {
    e.preventDefault()
    if (!newListTitle.trim()) return
    try {
      const last = activeLists[activeLists.length - 1]
      const position = positionBetween(last?.position, undefined)
      const workflowId = activeWorkflowId || workflows[0]?._id
      const data = await realtimeOrRest(
        'list:create',
        { boardId, title: newListTitle, position, workflowId },
        async () => (await boardApi.createList(boardId, newListTitle, position, token, { workflowId })).data
      )
      setLists((prev) => [...prev, data.list].sort((a, b) => a.position - b.position))
      setCardsByList((prev) => ({ ...prev, [data.list._id]: [] }))
      prependActivity(data.activity)
      setNewListTitle('')
      toast.success('List created', data.list.title)
    } catch (err) {
      setError(err.message)
      toast.error('Could not create list', err.message)
    }
  }

  async function handleUpdateCard(card, updates) {
    const fromListId = card.list
    const toListId = updates.list || fromListId
    const payload = { ...updates }

    if (toListId !== fromListId) {
      const targetCards = (cardsRef.current[toListId] || []).filter((c) => c._id !== card._id)
      const last = targetCards[targetCards.length - 1]
      payload.position = positionBetween(last?.position, undefined)
    }

    const data = await realtimeOrRest(
      'card:update',
      { boardId, cardId: card._id, updates: payload },
      async () => (await boardApi.updateCard(boardId, card._id, payload, token)).data
    )
    replaceCard(data.card)
    prependActivity(data.activity)
    if (!updates.checklistOperation) toast.success('Card saved', data.card.title)
  }

  async function handleDeleteCard(card) {
    const data = await realtimeOrRest(
      'card:delete',
      { boardId, cardId: card._id },
      async () => (await boardApi.deleteCard(boardId, card._id, token)).data
    )
    removeCard(card)
    prependActivity(data.activity)
    toast.success('Card deleted', card.title)
  }

  async function handleRenameList(list, title) {
    if (title === list.title) return
    try {
      const data = await realtimeOrRest(
        'list:update',
        { boardId, listId: list._id, updates: { title } },
        async () => (await boardApi.updateList(boardId, list._id, { title }, token)).data
      )
      setLists((prev) => prev.map((l) => (l._id === list._id ? data.list : l)))
      prependActivity(data.activity)
      toast.success('List renamed', data.list.title)
    } catch (err) {
      setError(err.message)
      toast.error('Could not rename list', err.message)
    }
  }

  async function handleDeleteList(list) {
    setListDeleteTarget(list)
  }

  async function confirmDeleteList() {
    if (!listDeleteTarget) return
    const list = listDeleteTarget
    setListDeleting(true)
    try {
      const data = await realtimeOrRest(
        'list:delete',
        { boardId, listId: list._id },
        async () => (await boardApi.deleteList(boardId, list._id, token)).data
      )
      setLists((prev) => prev.filter((l) => l._id !== list._id))
      setCardsByList((prev) => {
        const next = { ...prev }
        delete next[list._id]
        return next
      })
      prependActivity(data.activity)
      toast.success('List deleted', list.title)
      setListDeleteTarget(null)
    } catch (err) {
      setError(err.message)
      toast.error('Could not delete list', err.message)
    } finally {
      setListDeleting(false)
    }
  }

  async function handleUpdateBoard(name, options) {
    const res = await boardApi.update(boardId, { name, ...options }, token)
    setBoard(res.data.board)
    prependActivity(res.data.activity)
    toast.success('Project updated', res.data.board.name)
  }

  async function handleDeleteBoard() {
    setBoardDeleteOpen(true)
  }

  async function confirmDeleteBoard() {
    setBoardDeleting(true)
    try {
      await boardApi.delete(boardId, token)
      toast.success('Project deleted', board.name)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
      toast.error('Could not delete project', err.message)
    } finally {
      setBoardDeleting(false)
    }
  }

  async function handleAddMember(email, role) {
    const res = await boardApi.addMember(boardId, email, role, token)
    setMembers(res.data.members)
    setBoard((current) => current ? { ...current, members: res.data.members } : current)
    prependActivity(res.data.activity)
    toast.success('Member added', email)
  }

  async function handleChangeMemberRole(memberId, role) {
    const res = await boardApi.updateMemberRole(boardId, memberId, role, token)
    setMembers(res.data.members)
    setBoard((current) => current ? { ...current, members: res.data.members } : current)
    prependActivity(res.data.activity)
    toast.success('Member role updated', role)
  }

  async function handleRemoveMember(memberId) {
    const res = await boardApi.removeMember(boardId, memberId, token)
    setMembers(res.data.members)
    setBoard((current) => current ? { ...current, members: res.data.members } : current)
    prependActivity(res.data.activity)
    toast.success('Member removed')
  }

  async function handleAddWorkflow(payload) {
    const res = await boardApi.createWorkflow(boardId, payload, token)
    const { workflow, lists: seededLists = [], cards: seededCards = [], activity } = res.data
    mergeWorkflowPayload({ workflow, lists: seededLists, cards: seededCards })
    setActiveWorkflowId(workflow._id)
    prependActivity(activity)
    toast.success('Workflow added', workflow.name)
  }

  async function handleQuickStartWorkflow(template) {
    if (!template || quickWorkflowId) return

    setQuickWorkflowId(template.id)
    try {
      await handleAddWorkflow({
        workflowTemplateId: template.id,
        name: template.name,
      })
    } catch (err) {
      toast.error('Could not add workflow', err.message)
    } finally {
      setQuickWorkflowId('')
    }
  }

  async function handleRefreshGitHubRepos() {
    setGithubReposLoaded(false)
    await loadGitHubRepos()
  }

  async function handleLinkGitHubRepo(repository) {
    setGithubSaving(true)
    try {
      const res = await boardApi.linkGitHubRepo(boardId, repository, token)
      setGithubIntegration(res.data.integration)
      setGithubCommits([])
      setGithubCommitsLoaded(false)
      setGithubCommitsError('')
      setGithubStats(null)
      setGithubStatsLoaded(false)
      setGithubStatsError('')
      prependActivity(res.data.activity)
      toast.success('GitHub repo linked', res.data.integration.repoFullName)
    } catch (err) {
      setGithubReposError(err.message)
      toast.error('Could not link GitHub repo', err.message)
      throw err
    } finally {
      setGithubSaving(false)
    }
  }

  async function handleUnlinkGitHubRepo() {
    setGithubSaving(true)
    try {
      const res = await boardApi.unlinkGitHubRepo(boardId, token)
      setGithubIntegration(null)
      setGithubCommits([])
      setGithubCommitsLoaded(false)
      setGithubCommitsError('')
      setGithubStats(null)
      setGithubStatsLoaded(false)
      setGithubStatsError('')
      prependActivity(res.data.activity)
      toast.success('GitHub repo unlinked')
    } catch (err) {
      setGithubReposError(err.message)
      toast.error('Could not unlink GitHub repo', err.message)
      throw err
    } finally {
      setGithubSaving(false)
    }
  }

  async function handleRefreshGitHubCommits() {
    setGithubCommitsLoaded(false)
    await loadGitHubCommits()
  }

  async function handleRefreshGitHubStats() {
    setGithubStatsLoaded(false)
    await loadGitHubStats()
  }

  async function handleSendMessage(body) {
    const pendingMessage = buildPendingMessage(body)
    appendMessage(pendingMessage)

    try {
      const data = await realtimeOrRest(
        'message:create',
        { boardId, body },
        async () => (await boardApi.createMessage(boardId, body, token)).data
      )
      setMessagesError('')
      replaceMessage(pendingMessage._id, data.message)
    } catch (err) {
      replaceMessage(pendingMessage._id, {
        ...pendingMessage,
        deliveryStatus: 'failed',
        deliveryError: err.message,
      })
      toast.error('Could not send message', err.message)
      throw err
    }
  }

  async function handleRetryMessage(message) {
    replaceMessage(message._id, {
      ...message,
      deliveryStatus: 'sending',
      deliveryError: '',
    })

    try {
      const data = await realtimeOrRest(
        'message:create',
        { boardId, body: message.body },
        async () => (await boardApi.createMessage(boardId, message.body, token)).data
      )
      setMessagesError('')
      replaceMessage(message._id, data.message)
    } catch (err) {
      replaceMessage(message._id, {
        ...message,
        deliveryStatus: 'failed',
        deliveryError: err.message,
      })
      toast.error('Retry failed', err.message)
      throw err
    }
  }

  async function handleDeleteMessage(message) {
    try {
      const data = await realtimeOrRest(
        'message:delete',
        { boardId, messageId: message._id },
        async () => (await boardApi.deleteMessage(boardId, message._id, token)).data
      )
      updateMessage(data.message)
      prependActivity(data.activity)
      toast.success('Message deleted')
    } catch (err) {
      setMessagesError(err.message)
      toast.error('Could not delete message', err.message)
      throw err
    }
  }

  async function handleClearMessages() {
    try {
      const data = await realtimeOrRest(
        'chat:clear',
        { boardId },
        async () => (await boardApi.clearMessages(boardId, token)).data
      )
      setMessages([])
      setUnreadMessages(0)
      prependActivity(data.activity)
      toast.success('Chat cleared', `${data.deletedCount || 0} messages cleared`)
    } catch (err) {
      setMessagesError(err.message)
      toast.error('Could not clear chat', err.message)
      throw err
    }
  }

  const handleTypingChange = useCallback((typing) => {
    if (!connected || !boardId) return
    emitWithAck('chat:typing', { boardId, typing }).catch(() => {
      // Typing is best-effort realtime polish; failed pings should not disturb
      // the user's actual message flow or show noisy errors.
    })
  }, [boardId, connected, emitWithAck])





  // --- render --------------------------------------------------------------

  if (loading) {
    return <BoardLoadingSkeleton />
  }
  // Full-screen error only when the board never loaded. Transient errors (a
  // failed drag persist, etc.) show as an inline banner below so the board stays put.
  if (error && !board) {
    return (
      <BoardLoadError
        message={error}
        onRetry={() => loadBoard()}
        onBack={() => navigate('/dashboard')}
      />
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <BoardHeader
        boardId={boardId}
        board={board}
        activeWorkflow={activeWorkflow}
        listCount={activeLists.length}
        totalCardCount={totalCardCount}
        filteredCardCount={filteredCardCount}
        filtersActive={filtersActive}
        connected={connected}
        onlineCount={presence.length}
        members={members}
        canEditBoard={canEditBoard}
        canDeleteBoard={canDeleteBoard}
        githubIntegration={githubIntegration}
        unreadMessages={unreadMessages}
        onManageMembers={() => setManagingMembers(true)}
        onOpenGitHub={() => openPanel('github')}
        onOpenChat={openChatPanel}
        onEditBoard={() => setEditingBoard(true)}
        onDeleteBoard={handleDeleteBoard}
      />

      <WorkflowSwitcher
        workflows={workflows}
        activeWorkflowId={activeWorkflowId}
        onSelect={(workflowId) => {
          setActiveWorkflowId(workflowId)
          setSelectedCard(null)
        }}
        onAdd={() => setAddingWorkflow(true)}
        canAdd={canEditBoard}
        listsByWorkflow={listsByWorkflow}
        cardsByWorkflow={cardsByWorkflow}
      />

      {!showProjectWelcome && (
        <ActiveWorkflowToolbar
          activeWorkflow={activeWorkflow}
          listCount={activeLists.length}
          cardCount={totalCardCount}
          newListTitle={newListTitle}
          onNewListTitleChange={setNewListTitle}
          onAddList={handleAddList}
        />
      )}

      {!showProjectWelcome && (
        <BoardFilters
          cardSearch={cardSearch}
          tagFilter={tagFilter}
          statusFilter={statusFilter}
          filtersActive={filtersActive}
          filteredCardCount={filteredCardCount}
          totalCardCount={totalCardCount}
          activeWorkflow={activeWorkflow}
          onSearchChange={setCardSearch}
          onTagChange={setTagFilter}
          onStatusChange={setStatusFilter}
          onClear={() => {
            setCardSearch('')
            setTagFilter('all')
            setStatusFilter('all')
          }}
        />
      )}

      {connectionError && !connected && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span>Realtime is offline: {connectionError}. Changes will use REST where possible.</span>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-red-100 dark:hover:bg-red-500/10" aria-label="Dismiss error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-[calc(100dvh-238px)] gap-4 overflow-x-auto px-4 py-4 sm:min-h-[calc(100dvh-204px)] lg:min-h-[calc(100dvh-164px)]">
          {showProjectWelcome ? (
            <ProjectWelcomeState
              boardName={board.name}
              templates={workflowTemplates}
              templatesLoading={workflowTemplatesLoading}
              pendingTemplateId={quickWorkflowId}
              canAdd={canEditBoard}
              onAddWorkflow={() => setAddingWorkflow(true)}
              onQuickStart={handleQuickStartWorkflow}
            />
          ) : (
            <SortableContext items={activeLists.map((l) => l._id)} strategy={horizontalListSortingStrategy}>
              {activeLists.map((list) => (
                <BoardColumn
                  key={list._id}
                  list={list}
                  cards={visibleCardsByList[list._id] || []}
                  totalCards={(cardsByList[list._id] || []).length}
                  filtersActive={filtersActive}
                  draft={cardDrafts[list._id]}
                  onDraftChange={setDraftForList}
                  onAddCard={handleAddCard}
                  onCardOpen={setSelectedCard}
                  onListRename={handleRenameList}
                  onListDelete={handleDeleteList}
                />
              ))}
            </SortableContext>
          )}

          {!showProjectWelcome && activeLists.length === 0 && (
            <BoardEmptyState boardName={board.name} workflowName={activeWorkflow?.name} />
          )}
        </div>

        {/* No drop animation: its post-drop settling opens a window where a
            state change (e.g. a rollback) thrashes dnd-kit's rect measuring
            into an infinite update loop. */}
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="rounded-lg border border-teal-200 bg-white p-3 text-sm text-zinc-950 shadow-xl shadow-teal-700/15 dark:border-teal-500/30 dark:bg-zinc-900 dark:text-zinc-100">
              {activeCard.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardDetailModal
          boardId={boardId}
          card={selectedCard}
          lists={activeLists}
          members={members}
          token={token}
          connected={connected}
          emitWithAck={emitWithAck}
          onSocketEvent={onSocketEvent}
          onActivity={prependActivity}
          onToast={toast}
          onClose={() => setSelectedCard(null)}
          onSave={handleUpdateCard}
          onDelete={handleDeleteCard}
        />
      )}

      {editingBoard && (
        <NewBoardModal
          board={board}
          onClose={() => setEditingBoard(false)}
          onCreate={handleUpdateBoard}
        />
      )}

      {managingMembers && (
        <MembersPanel
          board={board}
          members={members}
          presence={presence}
          currentUserId={user?.id}
          currentRole={currentRole}
          onClose={() => setManagingMembers(false)}
          onAddMember={handleAddMember}
          onChangeRole={handleChangeMemberRole}
          onRemoveMember={handleRemoveMember}
        />
      )}

      {activityPanelOpen && (
        <ActivityPanel
          board={board}
          activities={activities}
          loading={activityLoading}
          error={activityError}
          onRetry={loadActivities}
          onClose={closeActivityPanel}
        />
      )}

      {githubPanelOpen && (
        <GitHubIntegrationPanel
          board={board}
          account={githubAccount}
          integration={githubIntegration}
          loading={githubLoading}
          error={githubError}
          repos={githubRepos}
          reposLoading={githubReposLoading}
          reposError={githubReposError}
          reposLoaded={githubReposLoaded}
          saving={githubSaving}
          commits={githubCommits}
          commitsLoading={githubCommitsLoading}
          commitsError={githubCommitsError}
          commitsLoaded={githubCommitsLoaded}
          stats={githubStats}
          statsLoading={githubStatsLoading}
          statsError={githubStatsError}
          statsLoaded={githubStatsLoaded}
          canEdit={canEditBoard}
          onClose={closeGitHubPanel}
          onRefreshRepos={handleRefreshGitHubRepos}
          onLinkRepo={handleLinkGitHubRepo}
          onUnlinkRepo={handleUnlinkGitHubRepo}
          onRefreshCommits={handleRefreshGitHubCommits}
          onRefreshStats={handleRefreshGitHubStats}
        />
      )}

      {chatPanelOpen && (
        <ChatPanel
          board={board}
          messages={messages}
          loading={messagesLoading}
          error={messagesError}
          currentUserId={user?.id}
          connected={connected}
          currentRole={currentRole}
          typingUsers={typingUsers}
          onRetry={loadMessages}
          onClose={closeChatPanel}
          onSendMessage={handleSendMessage}
          onDeleteMessage={handleDeleteMessage}
          onClearMessages={handleClearMessages}
          onRetryMessage={handleRetryMessage}
          onTypingChange={handleTypingChange}
        />
      )}

      {addingWorkflow && (
        <AddWorkflowModal
          templates={workflowTemplates}
          templatesLoading={workflowTemplatesLoading}
          templatesError={workflowTemplatesError}
          onClose={() => setAddingWorkflow(false)}
          onCreate={handleAddWorkflow}
        />
      )}

      {listDeleteTarget && (
        <ConfirmDialog
          title={`Delete "${listDeleteTarget.title}"?`}
          description={listDeleteDescription}
          confirmLabel="Delete list"
          pending={listDeleting}
          onCancel={() => setListDeleteTarget(null)}
          onConfirm={confirmDeleteList}
        />
      )}

      {boardDeleteOpen && (
        <ConfirmDialog
          title={`Delete "${board.name}"?`}
          description="This will permanently delete the project, its workflows, lists, cards, comments, chat messages, and activity history."
          confirmLabel="Delete project"
          pending={boardDeleting}
          onCancel={() => setBoardDeleteOpen(false)}
          onConfirm={confirmDeleteBoard}
        />
      )}
    </div>
  )
}
