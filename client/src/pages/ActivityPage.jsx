import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import ActivityList from '../components/ActivityList'
import { useAuth } from '../context/useAuth'
import { boardApi } from '../lib/api'

export default function ActivityPage() {
  const { boardId } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [board, setBoard] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadActivity = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      if (boardId) {
        const [boardRes, activityRes] = await Promise.all([
          boardApi.getOne(boardId, token),
          boardApi.getActivities(boardId, token),
        ])
        setBoard(boardRes.data.board)
        setActivities(activityRes.data.activities || [])
        return
      }

      const boardsRes = await boardApi.list(token)
      const boards = boardsRes.data.boards || []
      const activityResponses = await Promise.all(
        boards.map((item) => boardApi.getActivities(item._id, token))
      )
      const allActivities = activityResponses.flatMap((res, index) => (
        (res.data.activities || []).map((activity) => ({
          ...activity,
          boardName: boards[index].name,
        }))
      ))
      allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      setActivities(allActivities.slice(0, 50))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [boardId, token])

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
        </section>
      </main>
    </div>
  )
}
