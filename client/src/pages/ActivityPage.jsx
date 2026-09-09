import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import ActivityList from '../components/ActivityList'
import { useAuth } from '../context/useAuth'
import { activityApi, boardApi } from '../lib/api'
import { useLatestRequest } from '../hooks/useLatestRequest'

export default function ActivityPage() {
  const { boardId } = useParams()
  const { token } = useAuth()
  return <ActivitySession key={`${boardId || 'all'}:${token}`} boardId={boardId} token={token} />
}

function ActivitySession({ boardId, token }) {
  const navigate = useNavigate()
  const beginRead = useLatestRequest()
  const morePending = useRef(false)
  const [board, setBoard] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')

  const loadActivity = useCallback(async () => {
    const isCurrent = beginRead('activity')
    try {
      setLoading(true)
      setError('')

      if (boardId) {
        const [boardRes, activityRes] = await Promise.all([
          boardApi.getOne(boardId, token),
          boardApi.getActivities(boardId, token),
        ])
        if (!isCurrent()) return
        setBoard(boardRes.data.board)
        setActivities(activityRes.data.activities || [])
        return
      }

      const res = await activityApi.list(token)
      if (!isCurrent()) return
      setActivities(res.data.activities)
      setNextCursor(res.data.nextCursor)
    } catch (err) {
      if (isCurrent()) setError(err.message)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [boardId, token, beginRead])

  async function loadMore() {
    if (!nextCursor || morePending.current) return
    morePending.current = true
    const isCurrent = beginRead('activity')
    setLoadingMore(true)
    setMoreError('')
    try {
      const res = await activityApi.list(token, { cursor: nextCursor })
      if (!isCurrent()) return
      setActivities((previous) => {
        const ids = new Set(previous.map((activity) => activity._id))
        return [...previous, ...res.data.activities.filter((activity) => !ids.has(activity._id))]
      })
      setNextCursor(res.data.nextCursor)
    } catch (err) {
      if (isCurrent()) setMoreError(err.message)
    } finally {
      if (isCurrent()) {
        morePending.current = false
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadActivity()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadActivity])

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <AppHeader />

      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 sm:px-6 lg:py-7 2xl:px-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Activity</p>
            <h1 className="mt-1 truncate text-2xl font-bold text-zinc-950 dark:text-zinc-100">
              {boardId ? board?.name || 'Project activity' : 'All activity'}
            </h1>
          </div>

          {boardId ? (
            <button
              type="button"
              onClick={() => navigate(`/boards/${boardId}`)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:w-auto"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Project
            </button>
          ) : (
            <Link
              to="/dashboard"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:w-auto"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Dashboard
            </Link>
          )}
        </div>

        <section className="min-h-[520px] rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <ActivityList
            activities={activities}
            loading={loading}
            error={error}
            onRetry={loadActivity}
            emptyTitle={boardId ? 'This project has no activity yet.' : 'No activity yet.'}
            emptyDescription="Create cards, move work, or invite collaborators to start the timeline."
          />
          {!boardId && !loading && nextCursor && (
            <div className="mt-4 flex flex-col items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {moreError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{moreError}</p>}
              <button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-teal-700 disabled:opacity-50 dark:border-zinc-700 dark:text-teal-300">
                {loadingMore ? 'Loading...' : moreError ? 'Retry loading more' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
