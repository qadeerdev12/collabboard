import { useCallback, useEffect, useRef, useState } from 'react'
import { notificationApi } from '../lib/api'
import { useSocket } from './useSocket'

export function useNotificationInbox(token) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [pendingRead, setPendingRead] = useState(null)
  const [actionError, setActionError] = useState('')
  const session = useRef(null)
  // This connection belongs to the inbox, not a board room. It stays active even
  // when the popover is closed, and useSocket disconnects it on account/unmount.
  const { onSocketEvent } = useSocket(token)

  useEffect(() => {
    if (!token) return undefined
    let active = true
    let generation = 0
    let fetching = false
    let writing = false
    let paging = false
    let dirty = false
    let loaded = false
    let cursor = null
    let refreshTimer = null

    function scheduleRefresh() {
      if (!active) return
      dirty = true
      // Coalesce bursts, but remember signals during a fetch/write. Its completion
      // schedules another fetch so a response captured before a signal cannot win.
      if (fetching || writing || refreshTimer !== null) return
      refreshTimer = setTimeout(() => refresh(), 100)
    }

    async function refresh({ background = true, clearActionError = false } = {}) {
      if (!active) return
      if (writing || fetching) { dirty = true; return }
      clearTimeout(refreshTimer)
      refreshTimer = null
      dirty = false
      fetching = true
      const id = ++generation
      paging = false
      setLoadingMore(false)
      setMoreError('')
      if (clearActionError) setActionError('')
      if (!background || !loaded) {
        setLoading(true)
        setNotifications([])
        setNextCursor(null)
      } else {
        // Live updates should not replace the open inbox with loading skeletons.
        setRefreshing(true)
      }
      try {
        const { data } = await notificationApi.list(token)
        if (!active || id !== generation) return
        cursor = data.nextCursor
        loaded = true
        setNotifications(data.notifications)
        setUnreadCount(data.unreadCount)
        setNextCursor(cursor)
        setError('')
      } catch (err) {
        if (!active || id !== generation) return
        // Failed authorization/network refreshes must not leave a confidently
        // stale badge or potentially inaccessible project details in the inbox.
        cursor = null
        setNotifications([])
        setNextCursor(null)
        setUnreadCount(null)
        setError(err.message)
      } finally {
        if (active && id === generation) {
          fetching = false
          setLoading(false)
          setRefreshing(false)
          if (dirty) scheduleRefresh()
        }
      }
    }

    async function loadMore() {
      if (!active || fetching || writing || paging || !cursor) return
      const id = generation
      paging = true
      setLoadingMore(true)
      setMoreError('')
      try {
        const { data } = await notificationApi.list(token, { cursor })
        if (!active || id !== generation) return
        cursor = data.nextCursor
        setNotifications((current) => {
          const seen = new Set(current.map((item) => item._id))
          return [...current, ...data.notifications.filter((item) => !seen.has(item._id))]
        })
        setUnreadCount(data.unreadCount)
        setNextCursor(cursor)
      } catch (err) {
        if (active && id === generation) setMoreError(err.message)
      } finally {
        if (active && id === generation) { paging = false; setLoadingMore(false) }
      }
    }

    async function markRead(notificationId = null) {
      if (!active || writing || fetching) return false
      writing = true
      ++generation // Ignore any earlier pagination response after this write.
      paging = false
      clearTimeout(refreshTimer)
      refreshTimer = null
      setLoadingMore(false)
      setMoreError('')
      setPendingRead(notificationId || 'all')
      setActionError('')
      let succeeded = false
      try {
        if (notificationId) await notificationApi.markRead(token, notificationId)
        else await notificationApi.markAllRead(token)
        succeeded = true
      } catch (err) {
        if (active) setActionError(err.message)
      } finally {
        writing = false
        if (active) {
          // The server signals this tab too. Consume signals received during a
          // successful PATCH with one authoritative post-write fetch, not a guess.
          if (succeeded) await refresh()
          else if (dirty) scheduleRefresh()
          if (active) setPendingRead(null)
        }
      }
      // A failed follow-up GET does not undo a successful PATCH. Navigation can
      // continue, but never after this account/page has been disposed.
      return active && succeeded
    }

    session.current = { refresh, loadMore, markRead }
    const unsubscribe = [
      onSocketEvent('notifications:changed', scheduleRefresh),
      // Socket.IO fires connect for the first connection AND reconnects. Offline
      // signals are not replayed, so each connection needs an inbox snapshot.
      onSocketEvent('connect', scheduleRefresh),
    ]
    // REST also works when the socket cannot connect. Subscribe before fetching
    // so a signal arriving during this initial request is queued, not missed.
    const initialTimer = setTimeout(() => refresh({ background: false }), 0)
    return () => {
      active = false
      ++generation
      clearTimeout(initialTimer)
      clearTimeout(refreshTimer)
      unsubscribe.forEach((stop) => stop())
      session.current = null
    }
  }, [token, onSocketEvent])

  const refresh = useCallback(() => session.current?.refresh({ background: false, clearActionError: true }), [])
  const loadMore = useCallback(() => session.current?.loadMore(), [])
  const markRead = useCallback((id) => session.current?.markRead(id) ?? Promise.resolve(false), [])

  // NotificationBell is keyed by account/page, so private React state resets in
  // addition to the effect cleanup that ignores old network responses above.
  return { notifications, unreadCount, nextCursor, loading, refreshing, loadingMore, error, moreError, pendingRead, actionError, refresh, loadMore, markRead }
}
