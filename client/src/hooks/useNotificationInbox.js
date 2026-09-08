import { useCallback, useEffect, useRef, useState } from 'react'
import { notificationApi } from '../lib/api'

export function useNotificationInbox(token) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const generation = useRef(0)
  const paging = useRef(false)
  const invalidate = useCallback(() => { generation.current += 1 }, [])

  const refresh = useCallback(async () => {
    const id = ++generation.current
    paging.current = false
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setMoreError('')
    // Discard old context on refresh; access may have changed since last open.
    setNotifications([])
    setNextCursor(null)
    try {
      const { data } = await notificationApi.list(token)
      if (id !== generation.current) return
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
      setNextCursor(data.nextCursor)
    } catch (err) {
      if (id !== generation.current) return
      setUnreadCount(null)
      setError(err.message)
    } finally {
      if (id === generation.current) setLoading(false)
    }
  }, [token])

  async function loadMore() {
    if (loading || paging.current || !nextCursor) return
    const id = generation.current
    paging.current = true
    setLoadingMore(true)
    setMoreError('')
    try {
      const { data } = await notificationApi.list(token, { cursor: nextCursor })
      if (id !== generation.current) return
      setNotifications((current) => {
        const seen = new Set(current.map((item) => item._id))
        return [...current, ...data.notifications.filter((item) => !seen.has(item._id))]
      })
      setUnreadCount(data.unreadCount)
      setNextCursor(data.nextCursor)
    } catch (err) {
      if (id === generation.current) setMoreError(err.message)
    } finally {
      if (id === generation.current) { paging.current = false; setLoadingMore(false) }
    }
  }

  useEffect(() => {
    const timer = setTimeout(refresh, 0)
    return () => { clearTimeout(timer); invalidate() }
  }, [refresh, invalidate])

  // A newer refresh invalidates older page requests, and cleanup ignores any
  // response arriving after unmount. The keyed bell resets state on user change.
  return { notifications, unreadCount, nextCursor, loading, loadingMore, error, moreError, refresh, loadMore }
}
