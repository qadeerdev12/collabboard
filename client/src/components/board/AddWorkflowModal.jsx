import { useEffect, useState } from 'react'
import BoardIcon from '../BoardIcon'

// Owns the draft/selection only. The page supplies the authorized creation callback.
export default function AddWorkflowModal({
  templates,
  templatesLoading,
  templatesError,
  onClose,
  onCreate,
}) {
  const CUSTOM_TEMPLATE_ID = 'custom'
  const [templateId, setTemplateId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const selectedTemplate = templates.find((template) => template.id === templateId)
  const customSelected = templateId === CUSTOM_TEMPLATE_ID
  const canSubmit = customSelected ? Boolean(name.trim()) : Boolean(selectedTemplate)

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function chooseTemplate(template) {
    setTemplateId(template.id)
    if (!name.trim()) setName(template.name)
  }

  function chooseCustomWorkflow() {
    setTemplateId(CUSTOM_TEMPLATE_ID)
    if (!name.trim()) setName('Custom Workflow')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError('')
    try {
      const workflowName = name.trim()
      await onCreate(customSelected
        ? {
            name: workflowName,
            templateKey: 'custom',
            icon: 'workflow',
            color: 'slate',
          }
        : {
            workflowTemplateId: selectedTemplate.id,
            name: workflowName || selectedTemplate.name,
          })
      onClose()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-sm dark:bg-black/70"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="Add workflow" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div>
              <h2 className="font-semibold text-zinc-950 dark:text-zinc-100">Add project workflow</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Choose a workflow template or start with an empty custom project area.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Templates</p>
                  <h3 className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-100">Choose a workflow type</h3>
                </div>
                <span className="rounded-full border border-zinc-200 px-2 py-1 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  {templatesLoading ? 'Loading' : `${templates.length + 1} ready`}
                </span>
              </div>

              <div className="grid max-h-[52vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={chooseCustomWorkflow}
                  aria-pressed={customSelected}
                  className={`rounded-lg border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    customSelected
                      ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/15 dark:border-teal-400 dark:bg-teal-500/10'
                      : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
                        <BoardIcon value="workflow" className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">Custom Workflow</span>
                        <span className="mt-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          Empty workflow · no starter cards
                        </span>
                      </span>
                    </div>
                    <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${
                      customSelected ? 'border-teal-600 bg-teal-600 dark:border-teal-300 dark:bg-teal-300' : 'border-zinc-300 dark:border-zinc-700'
                    }`} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">Create a blank project area and define your own lists, cards, labels, and rhythm.</p>
                </button>

                {templatesLoading && Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                      <div className="flex-1">
                        <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                        <div className="mt-2 h-3 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
                      </div>
                    </div>
                  </div>
                ))}

                {!templatesLoading && templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => chooseTemplate(template)}
                    aria-pressed={templateId === template.id}
                    className={`rounded-lg border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      templateId === template.id
                        ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/15 dark:border-teal-400 dark:bg-teal-500/10'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
                          <BoardIcon value={template.icon || template.emoji || 'workflow'} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">{template.name}</span>
                          <span className="mt-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                            {template.lists.length} lists · {template.cards.length} starter cards
                          </span>
                        </span>
                      </div>
                      <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${
                        templateId === template.id ? 'border-teal-600 bg-teal-600 dark:border-teal-300 dark:bg-teal-300' : 'border-zinc-300 dark:border-zinc-700'
                      }`} />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{template.summary}</p>
                  </button>
                ))}
              </div>

              {templatesError && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  Workflow templates could not load. Try reopening this dialog.
                </p>
              )}
            </section>

            <section className="space-y-4">
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-teal-600 text-white dark:bg-teal-400 dark:text-zinc-950">
                    <BoardIcon value={selectedTemplate?.icon || selectedTemplate?.emoji || 'workflow'} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate font-semibold ${selectedTemplate || customSelected ? 'text-zinc-950 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-600'}`}>
                      {name.trim() || selectedTemplate?.name || (customSelected ? 'Custom Workflow' : 'Choose a workflow')}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                      {customSelected
                        ? 'Empty workflow ready for your own structure.'
                        : selectedTemplate
                          ? `${selectedTemplate.lists.length} lists and ${selectedTemplate.cards.length} starter cards`
                          : 'Template details will appear here.'}
                    </span>
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="workflow-name" className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Workflow name
                </label>
                <input
                  id="workflow-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. September sprint"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </div>

              {customSelected && (
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Starts empty</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    After creating it, add lists such as Discovery, Next, In Progress, Review, or anything your project needs.
                  </p>
                </div>
              )}

              {selectedTemplate && (
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Starter lists</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedTemplate.lists.map((list) => (
                      <span key={list} className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{list}</span>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</p>
              )}
            </section>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit || submitting} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Adding...' : 'Add workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
