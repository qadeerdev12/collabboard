import BoardIcon from '../BoardIcon'

export default function ProjectWelcomeState({
  boardName,
  templates,
  templatesLoading,
  pendingTemplateId,
  canAdd,
  onAddWorkflow,
  onQuickStart,
}) {
  const quickStarts = ['software-sprint', 'bug-triage', 'release-plan']
    .map((templateId) => templates.find((template) => template.id === templateId))
    .filter(Boolean)

  return (
    <div className="grid min-h-[430px] w-full place-items-center rounded-lg border border-dashed border-teal-200 bg-white px-4 py-10 text-center shadow-sm dark:border-teal-500/20 dark:bg-zinc-900">
      <div className="w-full max-w-3xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-teal-600 text-white shadow-lg shadow-teal-600/20 dark:bg-teal-400 dark:text-zinc-950">
          <BoardIcon value="workflow" className="h-7 w-7" />
        </div>
        <p className="mt-5 text-lg font-semibold text-zinc-950 dark:text-zinc-100">
          {boardName} is ready for its first workflow.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Add a project area for the kind of work you want to manage first. You can keep General for custom lists, or start with a ready-made software workflow.
        </p>

        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onAddWorkflow}
            disabled={!canAdd}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add workflow
          </button>
          {!canAdd && (
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Ask an owner or admin to add workflows.</span>
          )}
        </div>

        {canAdd && (
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {templatesLoading && quickStarts.length === 0 ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-[92px] animate-pulse rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" />
              ))
            ) : (
              quickStarts.map((template) => {
                const pending = pendingTemplateId === template.id
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onQuickStart(template)}
                    disabled={Boolean(pendingTemplateId)}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:-translate-y-0.5 hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10"
                  >
                    <span className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
                        <BoardIcon value={template.icon || template.emoji || 'workflow'} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                          {pending ? 'Adding...' : template.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                          {template.lists.length} lists · {template.cards.length} cards
                        </span>
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
