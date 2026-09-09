import { useRef, useState } from 'react'
import { Sparkles, Plus, Check, X } from 'lucide-react'
import { boardApi } from '../lib/api'
import { CARD_TAGS } from '../lib/cardMeta'
import { useLatestRequest } from '../hooks/useLatestRequest'

export default function TaskDraftPanel({ boardId, card, token, title, disabled, onUse, onSave, onApplying }) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [draft, setDraft] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState([])
  const [adding, setAdding] = useState(null)
  const busy = useRef(false)
  const beginRead = useLatestRequest()
  const locked = disabled || pending || adding !== null

  async function generate() {
    if (busy.current || disabled) return
    busy.current = true
    const isCurrent = beginRead('draft')
    setPending(true)
    setError('')
    try {
      const res = await boardApi.draftCard(boardId, card._id, { title, brief }, token)
      if (isCurrent()) {
        setDraft(res.data.draft)
        setAdded([])
      }
    } catch (err) {
      if (isCurrent()) setError(err.message)
    } finally {
      if (isCurrent()) { setPending(false); busy.current = false }
    }
  }

  async function addItem(index) {
    if (busy.current || disabled || added.includes(index)) return
    busy.current = true
    setAdding(index)
    setError('')
    onApplying(true)
    try {
      // Add only the reviewed item. Never replace the live checklist wholesale.
      await onSave(card, { checklistOperation: { action: 'add', title: draft.checklist[index].trim() } })
      setAdded((previous) => [...previous, index])
    } catch (err) {
      setError(err.message)
    } finally {
      busy.current = false
      setAdding(null)
      onApplying(false)
    }
  }

  const inputClass = 'w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700'
  const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-zinc-800'
  if (!open) return <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={buttonClass}><Sparkles size={16} />Draft with AI</button>

  return (
    <section aria-label="AI task draft" aria-busy={pending} className="min-w-0 space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">AI task draft</h3>
        <button type="button" disabled={locked} aria-label="Discard draft" title="Discard draft" onClick={() => { setOpen(false); setDraft(null); setError('') }} className={buttonClass}><X size={16} /></button>
      </div>
      <label className="block text-sm">Task brief<textarea rows={3} maxLength={4000} value={brief} disabled={locked} onChange={(e) => setBrief(e.target.value)} className={`${inputClass} mt-1`} /></label>
      <p className="text-xs text-zinc-500">The task title and this brief are sent to OpenAI. Do not include secrets.</p>
      <button type="button" disabled={locked || !title.trim() || title.length > 300} onClick={generate} className={buttonClass}><Sparkles size={16} />{pending ? 'Generating...' : draft ? 'Regenerate draft' : 'Generate draft'}</button>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      {draft && (
        <div className="min-w-0 space-y-3">
          <label className="block text-sm">Suggested description<textarea rows={6} maxLength={6000} disabled={locked} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inputClass} mt-1`} /></label>
          <label className="block text-sm">Suggested label<select disabled={locked} value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} className={`${inputClass} mt-1`}>{CARD_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
          <button type="button" disabled={locked || !draft.description.trim()} onClick={() => onUse(draft)} className={buttonClass}>Use description and label</button>
          <p className="text-xs text-zinc-500">Description and label remain unsaved until Save changes. Checklist additions save immediately.</p>
          <ul className="space-y-2">
            {draft.checklist.map((item, index) => (
              <li key={index} className="flex min-w-0 items-start gap-2">
                <textarea rows={2} aria-label={`Suggested checklist item ${index + 1}`} maxLength={300} disabled={locked || added.includes(index)} value={item} onChange={(e) => setDraft({ ...draft, checklist: draft.checklist.map((value, i) => i === index ? e.target.value : value) })} className={inputClass} />
                <button type="button" aria-label={added.includes(index) ? `Added suggestion ${index + 1}` : `Add suggestion ${index + 1}`} title="Add to checklist" disabled={locked || added.includes(index) || !item.trim() || (card.checklist?.length || 0) >= 100} onClick={() => addItem(index)} className={`${buttonClass} shrink-0`}>{added.includes(index) ? <Check size={16} /> : <Plus size={16} />}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
