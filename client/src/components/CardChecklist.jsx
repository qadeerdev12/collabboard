import { useRef, useState } from 'react'

export default function CardChecklist({ card, onSave, disabled }) {
  const items = card.checklist || []
  const completed = items.filter((item) => item.completed).length
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const locked = disabled || pending

  // Persist separately from the detail form; incoming card props stay live
  // without resetting unsaved title/description edits in the parent modal.
  async function mutate(operation) {
    if (saving.current || disabled) return
    saving.current = true
    setPending(true)
    setError('')
    try {
      await onSave(card, { checklistOperation: operation })
      if (operation.action === 'add') setDraft('')
      if (operation.action === 'update') setEditing(null)
    } catch (err) {
      setError(err.message)
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  const inputClass = 'min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-zinc-700'
  const buttonClass = 'shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-zinc-800'

  return (
    <section aria-label="Checklist" aria-busy={pending} className="min-w-0 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Checklist</h3>
        <span aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">{completed}/{items.length} complete</span>
      </div>
      {items.length > 0 && <progress aria-label="Checklist progress" max={items.length} value={completed} className="mt-2 h-2 w-full accent-teal-600" />}
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((item) => (
          <li key={item._id} className="flex min-w-0 items-start gap-2 py-2">
            <input type="checkbox" checked={item.completed} disabled={locked} aria-label={`Complete ${item.title}`} onChange={(e) => mutate({ action: 'update', itemId: item._id, completed: e.target.checked })} className="mt-2 h-4 w-4 shrink-0 accent-teal-600" />
            {editing === item._id ? (
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                <input autoFocus aria-label="Checklist item title" maxLength={300} value={editTitle} disabled={locked} onChange={(e) => setEditTitle(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (editTitle.trim()) mutate({ action: 'update', itemId: item._id, title: editTitle }) }
                  if (e.key === 'Escape') { e.stopPropagation(); setEditing(null) }
                }} className={inputClass} />
                <button type="button" disabled={locked || !editTitle.trim()} onClick={() => mutate({ action: 'update', itemId: item._id, title: editTitle })} className={buttonClass}>Save</button>
                <button type="button" disabled={locked} onClick={() => setEditing(null)} className={buttonClass}>Cancel</button>
              </div>
            ) : (
              <>
                <span className={`min-w-0 flex-1 break-words py-1 text-sm ${item.completed ? 'text-zinc-500 line-through' : ''}`}>{item.title}</span>
                <button type="button" disabled={locked} aria-label={`Edit ${item.title}`} onClick={() => { setEditing(item._id); setEditTitle(item.title) }} className={buttonClass}>Edit</button>
                <button type="button" disabled={locked} aria-label={`Remove ${item.title}`} onClick={() => mutate({ action: 'remove', itemId: item._id })} className={buttonClass}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input aria-label="New checklist item" placeholder="Add a to-do" maxLength={300} value={draft} disabled={locked || items.length >= 100} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) mutate({ action: 'add', title: draft }) }
        }} className={inputClass} />
        <button type="button" disabled={locked || !draft.trim() || items.length >= 100} onClick={() => mutate({ action: 'add', title: draft })} className={buttonClass}>Add item</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
    </section>
  )
}
