import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { io } from 'socket.io-client'
import { notificationApi } from '../lib/api'
import { useNotificationInbox } from '../hooks/useNotificationInbox'
import { useAuth } from '../context/useAuth'
import NotificationBell from '../components/NotificationBell'

vi.mock('socket.io-client', () => ({ io: vi.fn() }))
vi.mock('../lib/api', () => ({ notificationApi: { list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } }))
vi.mock('../context/useAuth', () => ({ useAuth: vi.fn() }))

let sockets

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function item(id = 'task', overrides = {}) {
  return {
    _id: id, type: 'card.assigned', readAt: null, createdAt: '2026-09-08T00:00:00.000Z',
    actor: { _id: 'actor', name: 'Alex' }, board: { _id: 'project', name: 'Uptime Desk' },
    card: { _id: id, title: `Task ${id}` }, ...overrides,
  }
}

function snapshot(notifications = [], unreadCount = notifications.length, nextCursor = null) {
  return { data: { notifications, unreadCount, nextCursor } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  sockets = []
  notificationApi.list.mockResolvedValue(snapshot())
  notificationApi.markRead.mockResolvedValue({ data: {} })
  notificationApi.markAllRead.mockResolvedValue({ data: { modifiedCount: 1 } })
  useAuth.mockReturnValue({ token: 'account-a' })
  io.mockImplementation(() => {
    const listeners = new Map()
    const socket = {
      connected: false,
      on: vi.fn((name, handler) => {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name).add(handler)
        return socket
      }),
      off: vi.fn((name, handler) => { listeners.get(name)?.delete(handler); return socket }),
      disconnect: vi.fn(() => { socket.connected = false }),
      receive(name, payload = {}) {
        if (name === 'connect') socket.connected = true
        if (name === 'disconnect') socket.connected = false
        for (const handler of listeners.get(name) || []) handler(payload)
      },
      listenerCount: (name) => listeners.get(name)?.size || 0,
    }
    sockets.push(socket)
    return socket
  })
})

afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers() })
const advance = (ms = 100) => act(() => vi.advanceTimersByTimeAsync(ms))
const receive = (name = 'notifications:changed', socket = sockets.at(-1)) => act(() => socket.receive(name))

describe('live inbox requests', () => {
  it('loads through REST even without a socket connection', async () => {
    notificationApi.list.mockResolvedValue(snapshot([item()]))
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    expect(notificationApi.list).toHaveBeenCalledExactlyOnceWith('account-a')
    expect(io).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ auth: { token: 'account-a' } }))
    expect(result.current.unreadCount).toBe(1)
    expect(result.current.loading).toBe(false)
  })

  it('coalesces bursts and keeps rows visible during a background fetch', async () => {
    notificationApi.list.mockResolvedValueOnce(snapshot([item('old')]))
    const next = deferred()
    notificationApi.list.mockReturnValueOnce(next.promise)
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    for (let i = 0; i < 20; i += 1) receive()
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.notifications[0]._id).toBe('old')
    await act(async () => next.resolve(snapshot([item('new'), item('old')], 2)))
    expect(result.current.unreadCount).toBe(2)
    expect(result.current.refreshing).toBe(false)
    await advance(1000)
    expect(notificationApi.list).toHaveBeenCalledTimes(2)
  })

  it('fetches on connect and reconnect, recovering missed changes without listeners multiplying', async () => {
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    receive('connect')
    await advance()
    receive('disconnect')
    notificationApi.list.mockResolvedValue(snapshot([item()], 1))
    receive('connect')
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(3)
    expect(result.current.unreadCount).toBe(1)
    expect(sockets[0].listenerCount('notifications:changed')).toBe(1)
  })

  it('queues another snapshot when a signal arrives during the initial fetch', async () => {
    const first = deferred()
    notificationApi.list.mockReturnValueOnce(first.promise).mockResolvedValue(snapshot([item()], 1))
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    receive('connect')
    receive()
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve(snapshot()))
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(2)
    expect(result.current.unreadCount).toBe(1)
  })

  it.each(['one', 'all'])('coalesces signals during a %s read into the post-write refresh', async (kind) => {
    notificationApi.list.mockResolvedValueOnce(snapshot([item()])).mockResolvedValue(snapshot([item('new')], 1))
    const write = deferred()
    const method = kind === 'one' ? notificationApi.markRead : notificationApi.markAllRead
    method.mockReturnValue(write.promise)
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    let action
    act(() => { action = result.current.markRead(kind === 'one' ? 'task' : null) })
    receive()
    receive()
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(1)
    expect(await result.current.markRead('duplicate')).toBe(false)
    await act(async () => { write.resolve({ data: {} }); await action })
    await advance()
    expect(method).toHaveBeenCalledTimes(1)
    expect(notificationApi.list).toHaveBeenCalledTimes(2)
    expect(result.current.unreadCount).toBe(1) // Never assume mark-all means zero.
    expect(result.current.pendingRead).toBeNull()
  })

  it('does not lose an arrival during the post-write refresh', async () => {
    const postWrite = deferred()
    notificationApi.list.mockResolvedValueOnce(snapshot([item()]))
      .mockReturnValueOnce(postWrite.promise).mockResolvedValue(snapshot([item('new')], 1))
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    let action
    await act(async () => { action = result.current.markRead('task') })
    receive()
    await act(async () => { postWrite.resolve(snapshot()); await action })
    await advance()
    expect(result.current.unreadCount).toBe(1)
    expect(notificationApi.list).toHaveBeenCalledTimes(3)
  })

  it('keeps failed read feedback while still processing queued live changes', async () => {
    notificationApi.list.mockResolvedValue(snapshot([item()]))
    const write = deferred()
    notificationApi.markRead.mockReturnValue(write.promise)
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    let action
    act(() => { action = result.current.markRead('task') })
    receive()
    await act(async () => { write.reject(new Error('Could not save')); expect(await action).toBe(false) })
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(2)
    expect(result.current.actionError).toBe('Could not save')
    expect(result.current.pendingRead).toBeNull()
  })

  it('ignores an old pagination response after a live page-one refresh', async () => {
    const page = deferred()
    notificationApi.list.mockResolvedValueOnce(snapshot([item('old')], 4, 'cursor'))
      .mockReturnValueOnce(page.promise).mockResolvedValue(snapshot([item('new')], 1))
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    let loadingMore
    act(() => { loadingMore = result.current.loadMore() })
    receive()
    await advance()
    await act(async () => { page.resolve(snapshot([item('inaccessible')], 8, 'stale')); await loadingMore })
    expect(result.current.notifications.map((row) => row._id)).toEqual(['new'])
    expect(result.current.unreadCount).toBe(1)
    expect(result.current.nextCursor).toBeNull()
    expect(result.current.loadingMore).toBe(false)
  })

  it('clears private cached data on a failed live fetch and allows manual retry', async () => {
    notificationApi.list.mockResolvedValueOnce(snapshot([item()])).mockRejectedValueOnce(new Error('Unavailable'))
    const { result } = renderHook(() => useNotificationInbox('account-a'))
    await advance(0)
    receive()
    await advance()
    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBeNull()
    expect(result.current.error).toBe('Unavailable')
    notificationApi.list.mockResolvedValue(snapshot([item('retry')]))
    await act(() => result.current.refresh())
    expect(result.current.error).toBe('')
    expect(result.current.notifications[0]._id).toBe('retry')
  })

  it('cleans up Strict Mode connections, pending timers, listeners, and late writes', async () => {
    notificationApi.list.mockResolvedValue(snapshot([item()]))
    const { result, unmount } = renderHook(() => useNotificationInbox('account-a'), { wrapper: StrictMode })
    await advance(0)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].disconnect).toHaveBeenCalledOnce()
    expect(sockets[0].listenerCount('notifications:changed')).toBe(0)
    const write = deferred()
    notificationApi.markRead.mockReturnValue(write.promise)
    let action
    act(() => { action = result.current.markRead('task') })
    receive()
    unmount()
    await act(async () => { write.resolve({ data: {} }); expect(await action).toBe(false) })
    await advance(1000)
    expect(sockets[1].disconnect).toHaveBeenCalledOnce()
    expect(sockets[1].listenerCount('notifications:changed')).toBe(0)
    expect(notificationApi.list).toHaveBeenCalledTimes(1)
  })
})

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <output aria-label="Current location">{pathname}{search}</output>
}

const bell = () => <MemoryRouter><NotificationBell /><LocationProbe /></MemoryRouter>

describe('live notification bell', () => {
  it('updates while closed, stays open on live updates, and does not create sockets when toggled', async () => {
    render(bell())
    await advance(0)
    notificationApi.list.mockResolvedValue(snapshot([item()]))
    receive()
    await advance()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
    await advance(0)
    notificationApi.list.mockResolvedValue(snapshot([item('new'), item()], 2))
    receive()
    await advance()
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Task new' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }))
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
    expect(io).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/connected/i)).toBeNull()
  })

  it('discards old account fetches and sockets on account change and logout', async () => {
    const old = deferred()
    notificationApi.list.mockReturnValueOnce(old.promise)
    const view = render(bell())
    await advance(0)
    useAuth.mockReturnValue({ token: 'account-b' })
    notificationApi.list.mockResolvedValue(snapshot([item('b')], 2))
    view.rerender(bell())
    await advance(0)
    await act(async () => old.resolve(snapshot([item('private-a')], 99)))
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(sockets[0].disconnect).toHaveBeenCalledOnce()
    receive('notifications:changed', sockets[0])
    await advance()
    expect(notificationApi.list).toHaveBeenCalledTimes(2)
    useAuth.mockReturnValue({ token: null })
    view.rerender(bell())
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull()
    expect(sockets[1].disconnect).toHaveBeenCalledOnce()
  })

  it('marks read before task navigation and never navigates on a failed write', async () => {
    notificationApi.list.mockResolvedValue(snapshot([item()]))
    render(bell())
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
    await advance(0)
    notificationApi.markRead.mockRejectedValueOnce(new Error('Write failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Task task' }))
    await advance(0)
    expect(screen.getByLabelText('Current location').textContent).toBe('/')
    expect(screen.getByRole('alert').textContent).toContain('Write failed')
    fireEvent.click(screen.getByRole('button', { name: 'Open Task task' }))
    await advance(0)
    expect(screen.getByLabelText('Current location').textContent).toBe('/boards/project?card=task')
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
  })
})
