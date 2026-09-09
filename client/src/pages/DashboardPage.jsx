import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useToast } from '../context/useToast'
import { boardApi, integrationApi } from '../lib/api'
import AppHeader from '../components/AppHeader'
import BoardCard from '../components/BoardCard'
import ConfirmDialog from '../components/ConfirmDialog'
import NewBoardModal from '../components/NewBoardModal'

const SORTS = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'created', label: 'Newest first' },
  { key: 'name', label: 'Name A-Z' },
]

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function DashboardPage() {
  const { user, token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [githubDashboard, setGithubDashboard] = useState(null)
  const [githubLoading, setGithubLoading] = useState(true)
  const [githubError, setGithubError] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const [creating, setCreating] = useState(false)
  const [editingBoard, setEditingBoard] = useState(null)
  const [boardDeleteTarget, setBoardDeleteTarget] = useState(null)
  const [boardDeleting, setBoardDeleting] = useState(false)

  useEffect(() => {
    let active = true

    // Each section settles independently; GitHub latency must not block projects.
    async function loadBoards() {
      setLoading(true)
      setError('')
      setBoards([])
      try {
        const response = await boardApi.list(token)
        if (active) setBoards(response.data.boards)
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    }

    async function loadGitHubDashboard() {
      setGithubLoading(true)
      setGithubError('')
      setGithubDashboard(null)
      try {
        const response = await integrationApi.getGitHubDashboard(token)
        if (active) setGithubDashboard(response.data)
      } catch (err) {
        if (active) setGithubError(err.message)
      } finally {
        if (active) setGithubLoading(false)
      }
    }

    loadBoards()
    loadGitHubDashboard()
    return () => {
      // Ignore reads from a previous token, unmounted page, or StrictMode setup.
      active = false
    }
  }, [token])

  const visibleBoards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? boards.filter((b) => b.name.toLowerCase().includes(q)) : boards

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt)
      return new Date(b.updatedAt) - new Date(a.updatedAt)
    })
  }, [boards, query, sort])

  function roleFor(board) {
    return board.members?.find((m) => String(m.user) === String(user?.id))?.role
  }

  async function handleCreate(name, options) {
    const res = await boardApi.create(name, token, options)
    setBoards((prev) => [res.data.board, ...prev])
    toast.success('Project created', res.data.board.name)
  }

  async function handleUpdate(board, name, options) {
    const res = await boardApi.update(board._id, { name, ...options }, token)
    setBoards((prev) => prev.map((b) => (b._id === board._id ? res.data.board : b)))
    toast.success('Project updated', res.data.board.name)
  }

  async function handleDelete(board) {
    setBoardDeleteTarget(board)
  }

  async function confirmDeleteBoard() {
    if (!boardDeleteTarget) return
    const board = boardDeleteTarget
    setBoardDeleting(true)
    try {
      await boardApi.delete(board._id, token)
      setBoards((prev) => prev.filter((b) => b._id !== board._id))
      toast.success('Project deleted', board.name)
      setBoardDeleteTarget(null)
    } catch (err) {
      setError(err.message)
      toast.error('Could not delete project', err.message)
    } finally {
      setBoardDeleting(false)
    }
  }

  const firstName = user?.name?.split(' ')[0]
  const sharedBoards = boards.filter((b) => (b.members?.length ?? 0) > 1).length
  const ownedBoards = boards.filter((b) => roleFor(b) === 'owner').length
  const hasFilters = Boolean(query.trim())

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <AppHeader />

      <main className="mx-auto max-w-[1760px] px-4 py-5 sm:px-6 lg:py-7 2xl:px-8">
        <GitHubDashboardPanel
          dashboard={githubDashboard}
          loading={githubLoading}
          error={githubError}
          onManage={() => navigate('/profile')}
        />

        <section className="mb-5 rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="flex min-w-0 flex-col justify-between gap-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Workspace</p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                    {firstName ? `${firstName}'s projects` : 'Project dashboard'}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                    Open a project, review active spaces, or create a clean container for your next build.
                  </p>
                </div>

                <button
                  onClick={() => setCreating(true)}
                  className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-500 sm:w-auto"
                >
                  <PlusIcon className="h-4 w-4" />
                  <span>New project</span>
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Total projects" value={loading ? '-' : boards.length} />
                <Metric label="Owned by you" value={loading ? '-' : ownedBoards} />
                <Metric label="Shared spaces" value={loading ? '-' : sharedBoards} />
                <Metric label="Current view" value={loading ? '-' : visibleBoards.length} />
              </div>
            </div>

            <aside className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-white dark:border-zinc-800">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-300">Quick start</p>
                  <span className="rounded-md bg-white/10 px-2 py-1 text-xs text-zinc-300">
                    Workflows inside
                  </span>
                </div>
                <h2 className="mt-4 text-lg font-semibold">Create the project first.</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  Each project starts with a General workflow. Add Sprint, Bug Triage, Release Plan, or custom workflows once you are inside.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Clear search
                </button>
              )}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort projects"
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <section>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">Projects</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {loading ? 'Loading your workspace...' : `${pluralize(visibleBoards.length, 'project')} shown`}
              </p>
            </div>
          </div>

          {loading ? (
            <BoardGridSkeleton />
          ) : boards.length === 0 ? (
            <EmptyState onCreate={() => setCreating(true)} />
          ) : visibleBoards.length === 0 ? (
            <NoSearchResults query={query} onClear={() => setQuery('')} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visibleBoards.map((board) => (
                <BoardCard
                  key={board._id}
                  board={board}
                  role={roleFor(board)}
                  canEdit={['owner', 'admin'].includes(roleFor(board))}
                  canDelete={roleFor(board) === 'owner'}
                  onOpen={() => navigate(`/boards/${board._id}`)}
                  onEdit={setEditingBoard}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {creating && (
        <NewBoardModal
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
        />
      )}
      {editingBoard && (
        <NewBoardModal
          board={editingBoard}
          onClose={() => setEditingBoard(null)}
          onCreate={(name, options) => handleUpdate(editingBoard, name, options)}
        />
      )}

      {boardDeleteTarget && (
        <ConfirmDialog
          title={`Delete "${boardDeleteTarget.name}"?`}
          description="This will permanently delete the project, its workflows, lists, cards, comments, chat messages, and activity history."
          confirmLabel="Delete project"
          pending={boardDeleting}
          onCancel={() => setBoardDeleteTarget(null)}
          onConfirm={confirmDeleteBoard}
        />
      )}
    </div>
  )
}

function GitHubDashboardPanel({ dashboard, loading, error, onManage }) {
  const stats = dashboard?.stats || {}
  const languages = dashboard?.languages || []
  const commitGraph = dashboard?.commitGraph || { today: 0, week: 0, year: 0, dailyContributions: [] }
  const linkedProjects = dashboard?.linkedProjects || []

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
            <GitHubIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">GitHub</p>
              {dashboard?.connected && (
                <span className="truncate text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  @{dashboard.account?.username || 'GitHub'}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">Development snapshot</h2>
          </div>
        </div>

        <button
          type="button"
          onClick={onManage}
          className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:w-auto"
        >
          {dashboard?.connected ? 'Manage GitHub' : 'Connect GitHub'}
        </button>
      </div>

      {loading ? (
        <GitHubDashboardSkeleton />
      ) : error ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      ) : dashboard?.needsReconnect ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Reconnect GitHub to refresh repository permissions and load dashboard stats.
        </div>
      ) : dashboard?.connected ? (
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-[220px_minmax(0,760px)_250px_minmax(260px,1fr)]">
          <GitHubMetricGrid stats={stats} />
          <CommitGraphOptions stats={commitGraph} />
          <LinkedProjectList projects={linkedProjects} />
          <LanguagePanel languages={languages} total={stats.repositories || 0} />
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-300 px-4 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Connect GitHub to bring repository context into your SDLCFlow projects.
        </div>
      )}
    </section>
  )
}

function GitHubMetricGrid({ stats }) {
  return (
    <div className="grid self-stretch grid-cols-2 gap-2">
      <MiniMetric label="Repos" value={stats.repositories ?? 0} />
      <MiniMetric label="Private" value={stats.privateRepositories ?? 0} />
      <MiniMetric label="Projects" value={stats.linkedProjects ?? 0} />
      <MiniMetric label="Linked" value={stats.linkedRepositories ?? 0} />
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="flex min-h-16 flex-col items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-lg font-semibold text-zinc-950 dark:text-white">{value}</p>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xl font-semibold text-zinc-950 dark:text-white sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  )
}

function GitHubDashboardSkeleton() {
  return (
    <div className="mt-3 grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-[220px_minmax(0,760px)_250px_minmax(260px,1fr)]">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-36 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      ))}
    </div>
  )
}

function CommitGraphOptions({ stats }) {
  const dailyContributions = stats.dailyContributions || []
  const recentDays = dailyContributions.slice(-70)
  const points = [
    { label: 'Today', value: stats.today || 0 },
    { label: 'This week', value: stats.week || 0 },
    { label: 'This year', value: stats.year || 0 },
  ]

  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">Commit activity</h3>
        </div>
        <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
          {stats.year || 0} YTD
        </span>
      </div>

      <div className="mt-2 grid gap-2 xl:grid-cols-2">
        <CommitStatCards points={points} />
        <CommitHeatmap days={recentDays} />
      </div>
    </div>
  )
}

function CommitStatCards({ points }) {
  const maxValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-950">
      <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">Totals</h4>
      <div className="mt-1.5 grid gap-1">
        {points.map((point) => (
          <div key={point.label} className="rounded-lg border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{point.label}</span>
              <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">{point.value}</span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-teal-500"
                style={{ width: `${Math.max((point.value / maxValue) * 100, point.value > 0 ? 10 : 4)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CommitHeatmap({ days }) {
  const values = days.length ? days : Array.from({ length: 70 }, (_, index) => ({ date: `empty-${index}`, count: 0 }))
  const maxValue = Math.max(...values.map((day) => day.count || 0), 1)

  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">Calendar</h4>
        <p className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Last 70 days</p>
      </div>
      <div className="mt-2 flex max-w-full flex-wrap gap-0.5 overflow-hidden">
        {values.map((day) => (
          <span
            key={day.date}
            title={`${day.date}: ${day.count || 0} commits`}
            className={`h-[18px] w-[18px] shrink-0 rounded ${heatmapClass(day.count || 0, maxValue)}`}
          />
        ))}
      </div>
    </div>
  )
}

function heatmapClass(value, maxValue) {
  if (value <= 0) return 'bg-zinc-200 dark:bg-zinc-800'
  const ratio = value / maxValue
  if (ratio > 0.75) return 'bg-teal-700 dark:bg-teal-300'
  if (ratio > 0.45) return 'bg-teal-500 dark:bg-teal-400'
  if (ratio > 0.2) return 'bg-teal-300 dark:bg-teal-600'
  return 'bg-teal-100 dark:bg-teal-900'
}

function LinkedProjectList({ projects }) {
  const visibleProjects = projects.slice(0, 3)
  const hiddenCount = Math.max(projects.length - visibleProjects.length, 0)

  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">Linked project repos</h3>
      {projects.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Link a repo inside a project to see it here.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {visibleProjects.map((project) => (
            <a
              key={project.id}
              href={project.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg px-2 py-1.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {project.board?.name || 'Project'}
                </p>
                <span className="shrink-0 text-xs text-zinc-400">{project.language || 'Repo'}</span>
              </div>
              <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{project.repoFullName}</p>
            </a>
          ))}
          {hiddenCount > 0 && <p className="px-2 text-xs text-zinc-500 dark:text-zinc-400">+ {pluralize(hiddenCount, 'more project')}</p>}
        </div>
      )}
    </div>
  )
}

function LanguagePanel({ languages, total }) {
  const visibleLanguages = languages.slice(0, 3)
  const hiddenCount = Math.max(languages.length - visibleLanguages.length, 0)
  const topCount = Math.max(...languages.map((language) => language.count), 1)

  return (
    <aside className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">Repository languages</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Primary language across {pluralize(total, 'repo')}.
      </p>
      {visibleLanguages.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No language data yet.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {visibleLanguages.map((language) => (
            <div key={language.name}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{language.name}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{pluralize(language.count, 'repo')}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${Math.max((language.count / topCount) * 100, 8)}%` }}
                />
              </div>
            </div>
          ))}
          {hiddenCount > 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">+ {pluralize(hiddenCount, 'more language')}</p>}
        </div>
      )}
    </aside>
  )
}

function BoardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="min-h-[180px] animate-pulse rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-8 w-8 rounded-lg bg-zinc-100 dark:bg-zinc-800/70" />
          </div>
          <div className="mt-6 h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-2 h-3 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800/70" />
          <div className="mt-7 h-8 w-full rounded-lg bg-zinc-100 dark:bg-zinc-800/70" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onCreate }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-teal-600 text-white shadow-lg shadow-teal-600/20">
        <LayoutIcon className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-lg font-semibold">Create your first project</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Start with a clean project container. Inside it, you can add workflows for sprints, bugs, releases, roadmaps, and custom work.
      </p>
      <button
        onClick={onCreate}
        className="mt-6 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-500"
      >
        <PlusIcon className="h-4 w-4" />
        New project
      </button>
    </div>
  )
}

function NoSearchResults({ query, onClear }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-zinc-500 dark:text-zinc-400">No projects match "{query}".</p>
      <button onClick={onClear} className="mt-2 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">
        Clear search
      </button>
    </div>
  )
}

function PlusIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SearchIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function LayoutIcon({ className = 'h-6 w-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  )
}

function GitHubIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.24c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.93.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.31.1-2.72 0 0 .84-.28 2.75 1.05A9.31 9.31 0 0 1 12 6.9c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.46.1 2.72.64.72 1.03 1.64 1.03 2.76 0 3.94-2.34 4.8-4.57 5.06.36.32.68.95.68 1.91v2.81c0 .27.18.59.69.49A10.13 10.13 0 0 0 22 12.24C22 6.58 17.52 2 12 2Z" />
    </svg>
  )
}
