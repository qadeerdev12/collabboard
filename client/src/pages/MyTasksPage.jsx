import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../context/useAuth'
import { taskApi } from '../lib/api'
import { statusDotStyle, tagStyle } from '../lib/cardMeta'
import { TASK_GROUPS, taskDateLabel, taskGroup } from '../lib/myTasks'

export default function MyTasksPage() {
  const { token } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('Open')
  const [query, setQuery] = useState('')
  const [project, setProject] = useState('all')
  const requestId = useRef(0)
  const invalidateRequests = useCallback(() => { requestId.current += 1 }, [])

  const load = useCallback(async () => {
    const id = ++requestId.current
    setRefreshing(true)
    try {
      const res = await taskApi.mine(token)
      if (id !== requestId.current) return
      setTasks(res.data.tasks)
      setError('')
    } catch (err) {
      if (id === requestId.current) setError(err.message)
    } finally {
      if (id === requestId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [token])

  useEffect(() => {
    // Refresh on return and periodically while visible, without joining every
    // project room or advertising the viewer as present in those projects.
    const initial = setTimeout(load, 0)
    const refreshVisible = () => { if (!document.hidden) load() }
    const timer = setInterval(refreshVisible, 60000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      invalidateRequests()
      clearTimeout(initial)
      clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [load, invalidateRequests])

  const projects = [...new Map(tasks.map((task) => [task.board._id, task.board])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
  const completed = tasks.filter((task) => task.status === 'Done').length
  const matching = tasks.filter((task) => (
    (project === 'all' || task.board._id === project)
    && `${task.title} ${task.board.name} ${task.workflow?.name || ''}`.toLowerCase().includes(query.trim().toLowerCase())
    && (view === 'Completed' ? task.status === 'Done' : task.status !== 'Done')
  ))
  const groups = view === 'Completed' ? ['Completed'] : TASK_GROUPS
  const filtered = project !== 'all' || Boolean(query.trim())
  const controlClass = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-zinc-700 dark:bg-zinc-900'

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 sm:px-6 lg:py-7 2xl:px-8">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-teal-700 dark:text-teal-300">Assigned to you</p>
            <h1 className="mt-1 text-2xl font-bold">My Tasks</h1>
          </div>
          <button type="button" disabled={refreshing} onClick={load} className={`${controlClass} shrink-0 font-medium disabled:opacity-50`}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>
        </div>

        <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 lg:flex-row lg:items-center">
          <div aria-label="Task view" className="flex gap-1">
            {['Open', 'Completed'].map((option) => (
              <button type="button" key={option} aria-pressed={view === option} onClick={() => setView(option)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === option ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {option} <span className="ml-1 tabular-nums">{loading ? '-' : option === 'Completed' ? completed : tasks.length - completed}</span>
              </button>
            ))}
          </div>
          <input type="search" aria-label="Search assigned tasks" placeholder="Search tasks or projects" value={query} onChange={(e) => setQuery(e.target.value)} className={`${controlClass} min-w-0 flex-1 lg:ml-auto lg:max-w-sm`} />
          <select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)} className={`${controlClass} min-w-0 lg:max-w-64`}>
            <option value="all">All projects</option>
            {projects.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
            {project !== 'all' && !projects.some((item) => item._id === project) && <option value={project}>Unavailable project</option>}
          </select>
        </div>

        {error && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"><span>{error}</span><button type="button" onClick={load} disabled={refreshing} className="font-semibold">Retry</button></div>}
        {loading ? (
          <div aria-label="Loading tasks" role="status" className="mt-5 space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />)}</div>
        ) : matching.length === 0 ? (
          <div className="grid min-h-80 place-items-center py-10 text-center">
            <div>
              <h2 className="text-lg font-semibold">{error ? 'Tasks unavailable' : filtered ? 'No matching tasks' : view === 'Completed' ? 'No completed tasks yet' : 'No open tasks assigned to you'}</h2>
              {!error && <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{filtered ? 'Try another search or project.' : view === 'Completed' ? 'Finished tasks will appear here.' : 'Assign yourself a card in a project to get started.'}</p>}
              {filtered ? <button type="button" onClick={() => { setQuery(''); setProject('all') }} className="mt-4 text-sm font-semibold text-teal-700 dark:text-teal-300">Clear filters</button> : <Link to="/dashboard" className="mt-4 inline-block text-sm font-semibold text-teal-700 dark:text-teal-300">Browse projects</Link>}
            </div>
          </div>
        ) : groups.map((group) => {
          const items = matching.filter((task) => taskGroup(task) === group)
          if (!items.length) return null
          return (
            <section key={group} aria-label={group} className="mt-6">
              <h2 className={`mb-2 text-sm font-semibold ${group === 'Overdue' ? 'text-red-700 dark:text-red-300' : ''}`}>{group} <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{items.length}</span></h2>
              <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {items.map((task) => (
                  <li key={task._id}>
                    <Link to={`/boards/${task.board._id}?card=${task._id}`} className="grid gap-3 px-3 py-4 transition hover:bg-white focus-visible:outline-teal-500 dark:hover:bg-zinc-900 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_140px_130px]">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold">{task.title}</p>
                        <p className="mt-1 break-words text-xs text-zinc-500 dark:text-zinc-400">{task.board.name} / {task.workflow?.name || 'General'} / {task.list.title}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${tagStyle(task.tag)}`}>{task.tag}</span>
                        <span className="flex items-center gap-1.5 text-xs"><span className={`h-2 w-2 shrink-0 rounded-full ${statusDotStyle(task.status)}`} />{task.status}</span>
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 sm:col-span-2 xl:col-span-1 xl:text-right">
                        <span className={group === 'Overdue' ? 'text-red-700 dark:text-red-300' : ''}>{taskDateLabel(task.dueDate)}</span>
                        {task.checklist?.length > 0 && <p className="mt-1 text-teal-700 dark:text-teal-300">{task.checklist.filter((item) => item.completed).length}/{task.checklist.length} to-dos complete</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </main>
    </div>
  )
}
