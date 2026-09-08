import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import GitHubMark from './GitHubMark'
import { useRetryCooldown } from '../../hooks/useRetryCooldown'

// Repository data and mutations stay with the page; only picker UI state lives here.
export default function GitHubIntegrationPanel({
  board,
  account,
  integration,
  loading,
  error,
  repos,
  reposLoading,
  reposError,
  reposLoaded,
  reposRetryAt = 0,
  saving,
  commits,
  commitsLoading,
  commitsError,
  commitsLoaded,
  commitsRetryAt = 0,
  stats,
  statsLoading,
  statsError,
  statsLoaded,
  statsRetryAt = 0,
  canEdit,
  onClose,
  onRefreshRepos,
  onLinkRepo,
  onUnlinkRepo,
  onRefreshCommits,
  onRefreshStats,
}) {
  const [search, setSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const reposCoolingDown = useRetryCooldown(reposRetryAt)
  const commitsCoolingDown = useRetryCooldown(commitsRetryAt)
  const statsCoolingDown = useRetryCooldown(statsRetryAt)
  const showPicker = !integration || pickerOpen
  const filteredRepos = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return repos
    return repos.filter((repo) => {
      const haystack = `${repo.fullName} ${repo.description || ''} ${repo.language || ''}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [repos, search])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function chooseRepo(repo) {
    await onLinkRepo(repo)
    setPickerOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-zinc-950/35 p-0 backdrop-blur-sm dark:bg-black/70 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="GitHub repository"
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">GitHub</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-zinc-950 dark:text-zinc-100">{board.name}</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Link one repository to this project.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-3 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
              <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
            </div>
          ) : error ? (
            <PanelMessage tone="error" title="Could not load GitHub" text={error} />
          ) : !account ? (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center dark:border-zinc-700 dark:bg-zinc-950">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
                <GitHubMark className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-zinc-950 dark:text-zinc-100">Connect GitHub first</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Link your GitHub account from your profile, then come back here to choose a project repository.
              </p>
              <Link
                to="/profile"
                className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white transition hover:bg-teal-500"
              >
                Open profile
              </Link>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center gap-3">
                  {account.avatarUrl ? (
                    <img src={account.avatarUrl} alt="" className="h-10 w-10 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-zinc-950 text-sm font-bold text-white dark:bg-white dark:text-zinc-950">
                      {account.username?.[0]?.toUpperCase() || 'G'}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">Connected as @{account.username}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Repositories are loaded from this GitHub account.</p>
                  </div>
                </div>
              </div>

              {integration && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 dark:border-teal-500/30 dark:bg-teal-500/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Linked repository</p>
                      <a href={integration.repoUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-base font-semibold text-zinc-950 hover:text-teal-700 dark:text-zinc-100 dark:hover:text-teal-200">
                        {integration.repoFullName}
                      </a>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                        {integration.private ? 'Private' : 'Public'} · {integration.defaultBranch || 'default branch'}{integration.language ? ` · ${integration.language}` : ''}
                      </p>
                    </div>
                    <span className="rounded-full bg-teal-600 px-2.5 py-1 text-xs font-bold text-white dark:bg-teal-300 dark:text-zinc-950">Active</span>
                  </div>
                  {canEdit && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        disabled={saving}
                        className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        Change repo
                      </button>
                      <button
                        type="button"
                        onClick={onUnlinkRepo}
                        disabled={saving}
                        className="rounded-lg border border-teal-300 px-3 py-2 text-sm font-semibold text-teal-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-teal-500/40 dark:text-teal-200 dark:hover:bg-zinc-900"
                      >
                        {saving ? 'Updating...' : 'Unlink'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {integration && (
                <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">Repository pulse</h3>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Open pull requests and issues for this project repo.</p>
                    </div>
                    <button
                      type="button"
                      onClick={onRefreshStats}
                      disabled={statsLoading || statsCoolingDown}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {statsLoading ? 'Refreshing...' : statsError ? 'Retry' : statsLoaded ? 'Refresh' : 'Load'}
                    </button>
                  </div>

                  {statsError && <PanelMessage tone="error" title="Could not load repository pulse" text={statsError} />}
                  {statsCoolingDown && <RetryNotice retryAt={statsRetryAt} />}

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <GitHubStatCard
                      label="Open PRs"
                      value={statsLoading ? '-' : stats?.openPullRequests ?? '-'}
                      description="Waiting for review or merge"
                    />
                    <GitHubStatCard
                      label="Open issues"
                      value={statsLoading ? '-' : stats?.openIssues ?? '-'}
                      description="Tracked in GitHub"
                    />
                  </div>
                </section>
              )}

              {integration && (
                <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">Recent commits</h3>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Latest changes from {integration.defaultBranch || 'the default branch'}.</p>
                    </div>
                    <button
                      type="button"
                      onClick={onRefreshCommits}
                      disabled={commitsLoading || commitsCoolingDown}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {commitsLoading ? 'Refreshing...' : commitsError ? 'Retry' : commitsLoaded ? 'Refresh' : 'Load'}
                    </button>
                  </div>

                  {commitsError && <PanelMessage tone="error" title="Could not load commits" text={commitsError} />}
                  {commitsCoolingDown && <RetryNotice retryAt={commitsRetryAt} />}

                  <div className="mt-3 space-y-2">
                    {commitsLoading && Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="h-[82px] animate-pulse rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" />
                    ))}

                    {!commitsLoading && commitsLoaded && commits.length === 0 && (
                      <PanelMessage tone="info" title="No commits found" text="GitHub did not return recent commits for this repository." />
                    )}

                    {!commitsLoading && commits.map((commit) => (
                      <a
                        key={commit.sha}
                        href={commit.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-zinc-200 bg-zinc-50 p-3 transition hover:border-teal-300 hover:bg-teal-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10"
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-950 dark:text-zinc-100">
                              {commit.message.split('\n')[0] || 'Untitled commit'}
                            </span>
                            <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                              <span>{commit.authorUsername ? `@${commit.authorUsername}` : commit.authorName}</span>
                              <span>·</span>
                              <span>{formatRelativeDate(commit.committedAt)}</span>
                            </span>
                          </span>
                          <span className="shrink-0 rounded-md bg-white px-2 py-1 font-mono text-[11px] font-semibold text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
                            {commit.shortSha}
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {!canEdit && !integration && (
                <PanelMessage tone="info" title="No repository linked" text="Ask a project owner or admin to choose a GitHub repository for this project." />
              )}

              {!canEdit && integration && (
                <PanelMessage tone="info" title="View only" text="Owners and admins can change the linked repository." />
              )}

              {canEdit && showPicker && (
                <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">Choose repository</h3>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Select the repo that belongs to this project.</p>
                    </div>
                    <button
                      type="button"
                      onClick={onRefreshRepos}
                      disabled={reposLoading || reposCoolingDown}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {reposLoading ? 'Refreshing...' : reposError ? 'Retry' : reposLoaded ? 'Refresh' : 'Load repos'}
                    </button>
                  </div>

                  <label className="mt-4 block">
                    <span className="sr-only">Search repositories</span>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search repositories"
                      className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-950"
                    />
                  </label>

                  {reposError && <PanelMessage tone="error" title="Could not load repositories" text={reposError} />}
                  {reposCoolingDown && <RetryNotice retryAt={reposRetryAt} />}

                  <div className="mt-3 space-y-2">
                    {reposLoading && Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="h-[76px] animate-pulse rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" />
                    ))}

                    {!reposLoading && reposLoaded && filteredRepos.length === 0 && (
                      <PanelMessage tone="info" title="No repositories found" text="Try a different search or refresh the list." />
                    )}

                    {!reposLoading && filteredRepos.map((repo) => {
                      const selected = integration?.repoId === String(repo.id)
                      return (
                        <button
                          key={repo.id}
                          type="button"
                          onClick={() => chooseRepo(repo)}
                          disabled={saving || selected}
                          className={`w-full rounded-lg border p-3 text-left transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-70 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10 ${
                            selected
                              ? 'border-teal-300 bg-teal-50 dark:border-teal-500/40 dark:bg-teal-500/10'
                              : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">{repo.fullName}</span>
                              <span className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                                {repo.description || 'No description'}
                              </span>
                              <span className="mt-2 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                {repo.private ? 'Private' : 'Public'} · {repo.defaultBranch || 'main'}{repo.language ? ` · ${repo.language}` : ''}
                              </span>
                            </span>
                            <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${selected ? 'bg-teal-600 text-white dark:bg-teal-300 dark:text-zinc-950' : 'bg-white text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800'}`}>
                              {selected ? 'Linked' : saving ? 'Saving' : 'Link'}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function RetryNotice({ retryAt }) {
  return (
    <p role="status" className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
      GitHub paused requests. Retry available after {new Date(retryAt).toLocaleTimeString()}.
    </p>
  )
}

function formatRelativeDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function PanelMessage({ tone = 'info', title, text }) {
  const classes = tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
    : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400'

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 ${classes}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-5 opacity-90">{text}</p>
    </div>
  )
}

function GitHubStatCard({ label, value, description }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-2xl font-semibold text-zinc-950 dark:text-zinc-100">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-300">{label}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
    </div>
  )
}
