import Logo from '../Logo'

// Page-level loading, initial error, and empty-workflow states share no data fetching.
export function BoardLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-stone-50/90 dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="space-y-2">
              <div className="h-4 w-44 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-10 w-24 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-10 w-44 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      </header>

      <div className="mx-4 mt-4 h-[66px] animate-pulse rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />

      <div className="flex gap-4 overflow-hidden px-4 py-4">
        {Array.from({ length: 4 }).map((_, columnIndex) => (
          <div key={columnIndex} className="flex h-[480px] w-[min(84vw,320px)] shrink-0 flex-col rounded-lg border border-zinc-200 bg-zinc-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:w-[310px]">
            <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-2 h-3 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800/70" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: columnIndex === 1 ? 2 : 3 }).map((_, cardIndex) => (
                <div key={cardIndex} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="flex justify-between">
                    <div className="h-5 w-16 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-3 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                  </div>
                  <div className="mt-4 h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BoardLoadError({ message, onRetry, onBack }) {
  return (
    <div className="grid min-h-screen place-items-center bg-stone-50 px-4 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow-xl shadow-red-900/5 dark:border-red-500/30 dark:bg-zinc-900 dark:shadow-black/20">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-bold">Could not load this project</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={onRetry} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500">
            Try again
          </button>
          <button type="button" onClick={onBack} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800">
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

export function BoardEmptyState({ boardName, workflowName }) {
  return (
    <div className="grid min-h-[360px] w-full place-items-center rounded-lg border border-dashed border-zinc-300 bg-white px-4 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="max-w-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16" />
            <path d="M4 12h10" />
            <path d="M4 18h7" />
          </svg>
        </div>
        <p className="mt-4 font-semibold text-zinc-900 dark:text-zinc-100">{workflowName || boardName} is ready for its first list.</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Add stages like Backlog, Next, In Progress, and Review to this workflow.</p>
      </div>
    </div>
  )
}
