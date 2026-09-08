import BoardIcon from '../BoardIcon'

export default function WorkflowSwitcher({ workflows, activeWorkflowId, onSelect, onAdd, canAdd, listsByWorkflow, cardsByWorkflow }) {
  if (workflows.length <= 1 && !canAdd) return null

  return (
    <section className="mx-4 mt-4 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex gap-2 overflow-x-auto">
        {workflows.map((workflow) => {
          const active = workflow._id === activeWorkflowId
          const listCount = listsByWorkflow[workflow._id] || 0
          const cardCount = cardsByWorkflow[workflow._id] || 0

          return (
            <button
              key={workflow._id}
              type="button"
              onClick={() => onSelect(workflow._id)}
              aria-pressed={active}
              className={`group flex min-w-[210px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                active
                  ? 'border-teal-500 bg-teal-50 text-teal-950 shadow-sm dark:border-teal-400 dark:bg-teal-500/10 dark:text-teal-100'
                  : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:border-zinc-800 dark:hover:bg-zinc-950'
              }`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                active ? 'bg-teal-600 text-white dark:bg-teal-400 dark:text-zinc-950' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300'
              }`}>
                <BoardIcon value={workflow.icon || 'workflow'} className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{workflow.name}</span>
                <span className={`mt-0.5 block text-xs ${active ? 'text-teal-700 dark:text-teal-200' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {listCount} {listCount === 1 ? 'list' : 'lists'} · {cardCount} {cardCount === 1 ? 'card' : 'cards'}
                </span>
              </span>
              {active && <span className="h-2 w-2 shrink-0 rounded-full bg-teal-500 dark:bg-teal-300" />}
            </button>
          )
        })}
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex min-w-[180px] items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-600 transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-teal-500/60 dark:hover:bg-teal-500/10 dark:hover:text-teal-200"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add workflow
          </button>
        )}
      </div>
    </section>
  )
}
