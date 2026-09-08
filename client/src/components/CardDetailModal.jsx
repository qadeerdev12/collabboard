import { useEffect, useMemo, useState } from 'react'
import { boardApi } from '../lib/api'
import { CARD_STATUSES, CARD_TAGS, statusDotStyle, tagStyle } from '../lib/cardMeta'
import ConfirmDialog from './ConfirmDialog'
import CardChecklist from './CardChecklist'

function memberUserId(member) {
  return member.user?.id || member.user?._id || member.user
}

function memberLabel(member) {
  const user = member.user || {}
  return user.name || user.email || 'Board member'
}

function cardAssigneeId(card) {
  return card.assignee?._id || card.assignee?.id || card.assignee || ''
}

function dateInputValue(date) {
  if (!date) return ''
  const isoDate = String(date).match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDate) return isoDate[1]

  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function authorName(comment) {
  return comment.author?.name || comment.author?.email || 'Someone'
}

function commentTime(comment) {
  const date = new Date(comment.createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function githubLinkLabel(url) {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 4 && parts[2] === 'pull') return `Pull request #${parts[3]}`
    if (parts.length >= 4 && parts[2] === 'issues') return `Issue #${parts[3]}`
    if (parts.length >= 4 && parts[2] === 'commit') return `Commit ${parts[3].slice(0, 7)}`
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
  } catch {
    return 'GitHub reference'
  }
  return 'GitHub reference'
}

function GitHubIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.13c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18A10.97 10.97 0 0 1 12 5.99c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.16c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

export default function CardDetailModal({
  boardId,
  card,
  lists,
  members = [],
  token,
  connected,
  emitWithAck,
  onSocketEvent,
  onActivity,
  onToast,
  onClose,
  onSave,
  onDelete,
}) {
  const [title, setTitle] = useState(card.title || '')
  const [description, setDescription] = useState(card.description || '')
  const [tag, setTag] = useState(card.tag || 'Task')
  const [status, setStatus] = useState(card.status || 'Todo')
  const [assignee, setAssignee] = useState(cardAssigneeId(card))
  const [dueDate, setDueDate] = useState(dateInputValue(card.dueDate))
  const [githubUrl, setGithubUrl] = useState(card.githubUrl || '')
  const [listId, setListId] = useState(card.list)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError, setCommentError] = useState('')

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !deleteConfirmOpen) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [deleteConfirmOpen, onClose])

  const currentList = useMemo(
    () => lists.find((list) => list._id === listId),
    [listId, lists]
  )

  useEffect(() => {
    let cancelled = false

    async function loadComments() {
      try {
        setCommentsLoading(true)
        setCommentError('')
        const res = await boardApi.getCardComments(boardId, card._id, token)
        if (!cancelled) setComments(res.data.comments || [])
      } catch (err) {
        if (!cancelled) setCommentError(err.message)
      } finally {
        if (!cancelled) setCommentsLoading(false)
      }
    }

    loadComments()
    return () => { cancelled = true }
  }, [boardId, card._id, token])

  useEffect(() => {
    if (!connected || !onSocketEvent) return undefined

    function onCommentCreated(payload) {
      if (payload.boardId !== boardId || payload.cardId !== card._id) return
      setComments((prev) => {
        if (prev.some((comment) => comment._id === payload.comment._id)) return prev
        return [...prev, payload.comment]
      })
    }

    return onSocketEvent('comment:created', onCommentCreated)
  }, [boardId, card._id, connected, onSocketEvent])

  async function handleSubmit(e) {
    e.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle || saving || deleting) return

    setSaving(true)
    setError('')
    try {
      await onSave(card, {
        title: nextTitle,
        description,
        tag,
        status,
        assignee: assignee || null,
        dueDate: dueDate || null,
        githubUrl: githubUrl.trim(),
        list: listId,
      })
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (saving || deleting) return
    setDeleteConfirmOpen(true)
  }

  async function confirmDelete() {
    if (saving || deleting) return
    setDeleting(true)
    setError('')
    try {
      await onDelete(card)
      setDeleteConfirmOpen(false)
      onClose()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  async function handleAddComment() {
    const body = commentDraft.trim()
    if (!body || commentSaving) return

    setCommentSaving(true)
    setCommentError('')
    try {
      const data = connected
        ? await emitWithAck('comment:create', { boardId, cardId: card._id, body })
        : (await boardApi.createCardComment(boardId, card._id, body, token)).data

      setComments((prev) => [...prev, data.comment])
      onActivity?.(data.activity)
      setCommentDraft('')
      onToast?.success('Comment posted', card.title)
    } catch (err) {
      setCommentError(err.message)
      onToast?.error('Could not post comment', err.message)
    } finally {
      setCommentSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/45 p-3 backdrop-blur-sm dark:bg-black/70 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label="Card details"
        className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">
              {currentList?.title || 'Card'}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-zinc-950 dark:text-zinc-100">Card details</h2>
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

        <div className="grid gap-5 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              required
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Workflow list</span>
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {lists.map((list) => (
                  <option key={list._id} value={list._id}>{list.title}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Tag</span>
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {CARD_TAGS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {CARD_STATUSES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Assignee</span>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={memberUserId(member)} value={memberUserId(member)}>
                    {memberLabel(member)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${tagStyle(tag)}`}>{tag}</span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <span className={`h-2 w-2 rounded-full ${statusDotStyle(status)}`} />
              {status}
            </span>
            {githubUrl.trim() && (
              <a
                href={githubUrl.trim()}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <GitHubIcon />
                {githubLinkLabel(githubUrl.trim())}
              </a>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">GitHub reference</span>
            <input
              type="url"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/org/repo/issues/123"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Link this card to a GitHub issue, pull request, commit, or repository.
            </p>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              placeholder="Add acceptance criteria, links, notes, or implementation details."
              className="w-full resize-y rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </label>

          <CardChecklist card={card} onSave={onSave} disabled={saving || deleting} />

          <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Comments</h3>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{comments.length}</span>
            </div>

            <div className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-1">
              {commentsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="rounded-lg bg-white p-3 dark:bg-zinc-900">
                      <div className="h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                      <div className="mt-2 h-4 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/70" />
                    </div>
                  ))}
                </div>
              ) : comments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">No comments yet.</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Leave notes, decisions, or blockers here.</p>
                </div>
              ) : (
                comments.map((comment) => (
                  <article key={comment._id} className="rounded-lg bg-white p-3 dark:bg-zinc-900">
                    <div className="flex items-start gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-950 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-950">
                        {authorName(comment).slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{authorName(comment)}</span>
                          <time className="text-[11px] text-zinc-400 dark:text-zinc-500">{commentTime(comment)}</time>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-zinc-700 dark:text-zinc-300">{comment.body}</p>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="mt-3">
              <label className="sr-only" htmlFor="card-comment">Add a comment</label>
              <textarea
                id="card-comment"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                rows={3}
                placeholder="Add a comment"
                className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm leading-5 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-h-5 text-xs text-red-600 dark:text-red-300">{commentError}</p>
                <button
                  type="button"
                  onClick={handleAddComment}
                  disabled={!commentDraft.trim() || commentSaving}
                  className="inline-flex items-center justify-center rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {commentSaving ? 'Posting...' : 'Post comment'}
                </button>
              </div>
            </div>
          </section>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || deleting}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
            {deleting ? 'Deleting...' : 'Delete card'}
          </button>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving || deleting}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={`Delete "${card.title}"?`}
          description="This will permanently remove the card and its comments from this project."
          confirmLabel="Delete card"
          pending={deleting}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
