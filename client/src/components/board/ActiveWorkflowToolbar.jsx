import BoardIcon from '../BoardIcon'

export default function ActiveWorkflowToolbar({
  activeWorkflow,
  listCount,
  cardCount,
  newListTitle,
  onNewListTitleChange,
  onAddList,
}) {
  return (
    <section className="mx-4 mt-4 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
            <BoardIcon value={activeWorkflow?.icon || 'workflow'} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Active workflow</p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              {activeWorkflow?.name || 'Workflow'}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {listCount} {listCount === 1 ? 'list' : 'lists'} · {cardCount} {cardCount === 1 ? 'card' : 'cards'}
            </p>
          </div>
        </div>

        <form onSubmit={onAddList} className="flex min-w-0 gap-2 lg:w-auto">
          <label className="min-w-0 flex-1 lg:w-72">
            <span className="sr-only">Add list to active workflow</span>
            <input
              value={newListTitle}
              onChange={(e) => onNewListTitleChange(e.target.value)}
              placeholder={`Add list to ${activeWorkflow?.name || 'workflow'}`}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-950"
            />
          </label>
          <button type="submit" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition hover:bg-teal-500">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add list
          </button>
        </form>
      </div>
    </section>
  )
}
