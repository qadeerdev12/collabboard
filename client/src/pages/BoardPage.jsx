import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useAuth } from '../context/useAuth'
import { useTheme } from '../context/useTheme'
import { useToast } from '../context/useToast'
import { boardApi, integrationApi } from '../lib/api'
import { useSocket } from '../hooks/useSocket'
import { positionBetween, positionForIndex } from '../lib/position'
import { CARD_STATUSES, CARD_TAGS } from '../lib/cardMeta'
import Logo from '../components/Logo'
import NotificationBell from '../components/NotificationBell'
import BoardSwitcher from '../components/BoardSwitcher'
import BoardColumn from '../components/BoardColumn'
import CardDetailModal from '../components/CardDetailModal'
import NewBoardModal from '../components/NewBoardModal'
import MembersPanel from '../components/MembersPanel'
import ActivityPanel from '../components/ActivityPanel'
import ChatPanel from '../components/ChatPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import BoardIcon from '../components/BoardIcon'

function memberUserId(member) {
  return member.user?.id || member.user?._id || member.user
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

function BoardLoadingSkeleton() {
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

function BoardLoadError({ message, onRetry, onBack }) {
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

function BoardEmptyState({ boardName, workflowName }) {
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

function ActiveWorkflowToolbar({
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

function ProjectWelcomeState({
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

function WorkflowSwitcher({ workflows, activeWorkflowId, onSelect, onAdd, canAdd, listsByWorkflow, cardsByWorkflow }) {
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

function AddWorkflowModal({
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

function GitHubIntegrationPanel({
  board,
  account,
  integration,
  loading,
  error,
  repos,
  reposLoading,
  reposError,
  reposLoaded,
  saving,
  commits,
  commitsLoading,
  commitsError,
  commitsLoaded,
  stats,
  statsLoading,
  statsError,
  statsLoaded,
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
                      disabled={statsLoading}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {statsLoading ? 'Refreshing...' : statsLoaded ? 'Refresh' : 'Load'}
                    </button>
                  </div>

                  {statsError && <PanelMessage tone="error" title="Could not load repository pulse" text={statsError} />}

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
                      disabled={commitsLoading}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {commitsLoading ? 'Refreshing...' : commitsLoaded ? 'Refresh' : 'Load'}
                    </button>
                  </div>

                  {commitsError && <PanelMessage tone="error" title="Could not load commits" text={commitsError} />}

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
                      disabled={reposLoading}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {reposLoading ? 'Refreshing...' : reposLoaded ? 'Refresh' : 'Load repos'}
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

function GitHubMark({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.13c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18A10.97 10.97 0 0 1 12 5.99c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.16c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

export default function BoardPage() {
  const { boardId } = useParams()
  const { user, token } = useAuth()
  const { dark, toggle } = useTheme()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [board, setBoard] = useState(null)
  const [workflows, setWorkflows] = useState([])
  const [activeWorkflowId, setActiveWorkflowId] = useState('')
  const [addingWorkflow, setAddingWorkflow] = useState(false)
  const [quickWorkflowId, setQuickWorkflowId] = useState('')
  const [workflowTemplates, setWorkflowTemplates] = useState([])
  const [workflowTemplatesLoading, setWorkflowTemplatesLoading] = useState(true)
  const [workflowTemplatesError, setWorkflowTemplatesError] = useState('')
  const [lists, setLists] = useState([])              // ordered by position
  const [cardsByList, setCardsByList] = useState({})  // listId -> ordered cards
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newListTitle, setNewListTitle] = useState('')
  const [cardDrafts, setCardDrafts] = useState({})
  const [activeCard, setActiveCard] = useState(null)  // card being dragged (for overlay)
  const [selectedCard, setSelectedCard] = useState(null)
  const [editingBoard, setEditingBoard] = useState(false)
  const [boardDeleteOpen, setBoardDeleteOpen] = useState(false)
  const [boardDeleting, setBoardDeleting] = useState(false)
  const [listDeleteTarget, setListDeleteTarget] = useState(null)
  const [listDeleting, setListDeleting] = useState(false)
  const [managingMembers, setManagingMembers] = useState(false)
  const [presence, setPresence] = useState([])
  const [members, setMembers] = useState([])
  const [activities, setActivities] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState('')
  const [messages, setMessages] = useState([])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState('')
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [typingUsers, setTypingUsers] = useState([])
  const [githubAccount, setGithubAccount] = useState(null)
  const [githubIntegration, setGithubIntegration] = useState(null)
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubError, setGithubError] = useState('')
  const [githubRepos, setGithubRepos] = useState([])
  const [githubReposLoaded, setGithubReposLoaded] = useState(false)
  const [githubReposLoading, setGithubReposLoading] = useState(false)
  const [githubReposError, setGithubReposError] = useState('')
  const [githubSaving, setGithubSaving] = useState(false)
  const [githubCommits, setGithubCommits] = useState([])
  const [githubCommitsLoaded, setGithubCommitsLoaded] = useState(false)
  const [githubCommitsLoading, setGithubCommitsLoading] = useState(false)
  const [githubCommitsError, setGithubCommitsError] = useState('')
  const [githubStats, setGithubStats] = useState(null)
  const [githubStatsLoaded, setGithubStatsLoaded] = useState(false)
  const [githubStatsLoading, setGithubStatsLoading] = useState(false)
  const [githubStatsError, setGithubStatsError] = useState('')
  const [cardSearch, setCardSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const currentRole = members.find((m) => String(memberUserId(m)) === String(user?.id))?.role
  const canEditBoard = ['owner', 'admin'].includes(currentRole)
  const canDeleteBoard = currentRole === 'owner'
  const { connected, connectionError, emitWithAck, onSocketEvent } = useSocket(token)

  const activeWorkflow = workflows.find((workflow) => workflow._id === activeWorkflowId) || workflows[0] || null
  const activeLists = useMemo(
    () => {
      if (!activeWorkflowId) return lists
      return lists.filter((list) => list.workflow === activeWorkflowId)
    },
    [activeWorkflowId, lists]
  )
  const activeCardsByList = useMemo(() => {
    const next = {}
    for (const list of activeLists) next[list._id] = cardsByList[list._id] || []
    return next
  }, [activeLists, cardsByList])
  const listsByWorkflow = useMemo(() => {
    const counts = {}
    for (const list of lists) counts[list.workflow] = (counts[list.workflow] || 0) + 1
    return counts
  }, [lists])
  const cardsByWorkflow = useMemo(() => {
    const counts = {}
    for (const listId in cardsByList) {
      const workflowId = lists.find((list) => list._id === listId)?.workflow
      if (!workflowId) continue
      counts[workflowId] = (counts[workflowId] || 0) + cardsByList[listId].length
    }
    return counts
  }, [cardsByList, lists])
  const totalCardCount = useMemo(
    () => Object.values(activeCardsByList).reduce((sum, cards) => sum + cards.length, 0),
    [activeCardsByList]
  )
  const totalBoardCardCount = useMemo(
    () => Object.values(cardsByList).reduce((sum, cards) => sum + cards.length, 0),
    [cardsByList]
  )
  // A brand-new project is a container with only the default workflow. Once the
  // user adds any workflow, list, or card, the board returns to normal empty/list states.
  const showProjectWelcome = workflows.length === 1
    && workflows[0]?.templateKey === 'default'
    && lists.length === 0
    && totalBoardCardCount === 0
  const filtersActive = Boolean(cardSearch.trim()) || tagFilter !== 'all' || statusFilter !== 'all'
  const activityPanelOpen = searchParams.get('panel') === 'activity'
  const chatPanelOpen = searchParams.get('panel') === 'chat'
  const githubPanelOpen = searchParams.get('panel') === 'github'
  const visibleCardsByList = useMemo(() => {
    const query = cardSearch.trim().toLowerCase()
    const next = {}

    for (const listId in activeCardsByList) {
      next[listId] = activeCardsByList[listId].filter((card) => {
        const titleAndDescription = `${card.title || ''} ${card.description || ''}`.toLowerCase()
        const matchesSearch = !query || titleAndDescription.includes(query)
        const matchesTag = tagFilter === 'all' || (card.tag || 'Task') === tagFilter
        const matchesStatus = statusFilter === 'all' || (card.status || 'Todo') === statusFilter
        return matchesSearch && matchesTag && matchesStatus
      })
    }

    return next
  }, [activeCardsByList, cardSearch, tagFilter, statusFilter])
  const filteredCardCount = useMemo(
    () => Object.values(visibleCardsByList).reduce((sum, cards) => sum + cards.length, 0),
    [visibleCardsByList]
  )
  const listDeleteCardCount = listDeleteTarget ? cardsByList[listDeleteTarget._id]?.length || 0 : 0
  const listDeleteDescription = listDeleteTarget
    ? `This will remove this list${listDeleteCardCount ? ` and ${listDeleteCardCount} ${listDeleteCardCount === 1 ? 'card' : 'cards'}` : ''} from ${activeWorkflow?.name || 'this workflow'}.`
    : ''

  // Refs mirror state so drag handlers always read the freshest value even
  // across the re-renders that onDragOver triggers mid-drag.
  const listsRef = useRef(lists)
  const activeListsRef = useRef(activeLists)
  const cardsRef = useRef(cardsByList)
  useEffect(() => { listsRef.current = lists }, [lists])
  useEffect(() => { activeListsRef.current = activeLists }, [activeLists])
  useEffect(() => { cardsRef.current = cardsByList }, [cardsByList])

  // Snapshot taken at drag start so a failed persist (or a drop outside) can roll back.
  const snapshotRef = useRef(null)
  const dragOriginRef = useRef(null)
  const wasConnectedRef = useRef(false)
  const connectionInitializedRef = useRef(false)
  const typingTimersRef = useRef(new Map())

  const sensors = useSensors(
    // A small distance threshold means a plain click won't start a drag —
    // leaves room for a future "open card" click handler.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const collisionDetection = useCallback((args) => {
    if (args.active.data.current?.type !== 'card') return closestCorners(args)

    const pointerHits = pointerWithin(args)
    if (pointerHits.length === 0) return closestCorners(args)

    const getDropType = (id) => args.droppableContainers.find((container) => container.id === id)?.data.current?.type
    const cardHit = pointerHits.find((hit) => getDropType(hit.id) === 'card')
    if (cardHit) return [cardHit]

    const cardContainerHit = pointerHits.find((hit) => getDropType(hit.id) === 'card-container')
    if (cardContainerHit) return [cardContainerHit]

    return pointerHits
  }, [])

  const loadBoard = useCallback(async ({ keepLoading = false } = {}) => {
    try {
      if (!keepLoading) setLoading(true)
      const res = await boardApi.getOne(boardId, token)
      const sortedLists = [...res.data.lists].sort((a, b) => a.position - b.position)
      const byList = {}
      for (const l of sortedLists) byList[l._id] = []
      for (const c of res.data.cards) {
        if (!byList[c.list]) byList[c.list] = []
        byList[c.list].push(c)
      }
      for (const id in byList) byList[id].sort((a, b) => a.position - b.position)
      setBoard(res.data.board)
      setMembers(res.data.board.members || [])
      setWorkflows(res.data.workflows || [])
      setActiveWorkflowId((current) => {
        if ((res.data.workflows || []).some((workflow) => workflow._id === current)) return current
        return res.data.workflows?.[0]?._id || ''
      })
      setLists(sortedLists)
      setCardsByList(byList)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [boardId, token])

  useEffect(() => {
    const cardId = searchParams.get('card')
    if (!cardId || loading || board?._id !== boardId) return undefined
    // Consume the deep link once after the project loads. Clearing the query
    // prevents later socket updates from reopening a dismissed detail modal.
    const timer = setTimeout(() => {
      const target = Object.values(cardsByList).flat().find((card) => card._id === cardId)
      if (target) {
        const workflowId = target.workflow || lists.find((list) => list._id === target.list)?.workflow
        if (workflowId) setActiveWorkflowId(workflowId)
        setSelectedCard(target)
      } else {
        setError('This task is no longer available in this project.')
      }
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('card')
        return next
      }, { replace: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [board?._id, boardId, cardsByList, lists, loading, searchParams, setSearchParams])

  const loadActivities = useCallback(async () => {
    try {
      setActivityLoading(true)
      setActivityError('')
      const res = await boardApi.getActivities(boardId, token)
      setActivities(res.data.activities || [])
    } catch (err) {
      setActivityError(err.message)
    } finally {
      setActivityLoading(false)
    }
  }, [boardId, token])

  const loadMessages = useCallback(async () => {
    try {
      setMessagesLoading(true)
      setMessagesError('')
      const res = await boardApi.getMessages(boardId, token)
      setMessages(res.data.messages || [])
      setMessagesLoaded(true)
    } catch (err) {
      setMessagesError(err.message)
    } finally {
      setMessagesLoading(false)
    }
  }, [boardId, token])

  const loadGitHubSummary = useCallback(async () => {
    try {
      setGithubLoading(true)
      setGithubError('')
      const [accountRes, integrationRes] = await Promise.all([
        integrationApi.getGitHubAccount(token),
        boardApi.getGitHubIntegration(boardId, token),
      ])
      setGithubAccount(accountRes.data.account)
      setGithubIntegration(integrationRes.data.integration)
    } catch (err) {
      setGithubError(err.message)
    } finally {
      setGithubLoading(false)
    }
  }, [boardId, token])

  const loadGitHubRepos = useCallback(async () => {
    try {
      setGithubReposLoading(true)
      setGithubReposError('')
      const res = await integrationApi.listGitHubRepos(token)
      setGithubRepos(res.data.repositories || [])
      setGithubReposLoaded(true)
    } catch (err) {
      setGithubReposError(err.message)
    } finally {
      setGithubReposLoading(false)
    }
  }, [token])

  const loadGitHubCommits = useCallback(async () => {
    try {
      setGithubCommitsLoading(true)
      setGithubCommitsError('')
      const res = await boardApi.getGitHubCommits(boardId, token)
      setGithubCommits(res.data.commits || [])
      setGithubIntegration(res.data.integration)
      const syncedActivities = res.data.activities || []
      syncedActivities.forEach((activity) => prependActivity(activity))
      setGithubCommitsLoaded(true)
    } catch (err) {
      setGithubCommitsError(err.message)
    } finally {
      setGithubCommitsLoading(false)
    }
  }, [boardId, token])

  const loadGitHubStats = useCallback(async () => {
    try {
      setGithubStatsLoading(true)
      setGithubStatsError('')
      const res = await boardApi.getGitHubStats(boardId, token)
      setGithubStats(res.data.stats || null)
      setGithubIntegration(res.data.integration)
      setGithubStatsLoaded(true)
    } catch (err) {
      setGithubStatsError(err.message)
    } finally {
      setGithubStatsLoading(false)
    }
  }, [boardId, token])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadBoard()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadBoard])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        setWorkflowTemplatesLoading(true)
        setWorkflowTemplatesError('')
        const res = await boardApi.listTemplates(token)
        if (!cancelled) setWorkflowTemplates(res.data.templates || [])
      } catch (err) {
        if (!cancelled) setWorkflowTemplatesError(err.message)
      } finally {
        if (!cancelled) setWorkflowTemplatesLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [token])

  useEffect(() => {
    if (!board) return undefined
    const timer = setTimeout(() => {
      loadActivities()
    }, 0)
    return () => clearTimeout(timer)
  }, [board, loadActivities])

  useEffect(() => {
    if (!board) return undefined
    const timer = setTimeout(() => {
      loadGitHubSummary()
    }, 0)
    return () => clearTimeout(timer)
  }, [board, loadGitHubSummary])

  useEffect(() => {
    if (!githubPanelOpen || !githubAccount || !canEditBoard || githubReposLoaded || githubReposLoading) return undefined
    const timer = setTimeout(() => {
      loadGitHubRepos()
    }, 0)
    return () => clearTimeout(timer)
  }, [canEditBoard, githubAccount, githubPanelOpen, githubReposLoaded, githubReposLoading, loadGitHubRepos])

  useEffect(() => {
    if (!githubPanelOpen || !githubIntegration || githubCommitsLoaded || githubCommitsLoading) return undefined
    const timer = setTimeout(() => {
      loadGitHubCommits()
    }, 0)
    return () => clearTimeout(timer)
  }, [githubCommitsLoaded, githubCommitsLoading, githubIntegration, githubPanelOpen, loadGitHubCommits])

  useEffect(() => {
    if (!githubPanelOpen || !githubIntegration || githubStatsLoaded || githubStatsLoading) return undefined
    const timer = setTimeout(() => {
      loadGitHubStats()
    }, 0)
    return () => clearTimeout(timer)
  }, [githubIntegration, githubPanelOpen, githubStatsLoaded, githubStatsLoading, loadGitHubStats])

  useEffect(() => {
    if (!board || !chatPanelOpen || messagesLoaded) return undefined
    const timer = setTimeout(() => {
      loadMessages()
    }, 0)
    return () => clearTimeout(timer)
  }, [board, chatPanelOpen, loadMessages, messagesLoaded])

  useEffect(() => {
    const timer = setTimeout(() => {
      setMessages([])
      setMessagesLoaded(false)
      setMessagesLoading(false)
      setMessagesError('')
      setUnreadMessages(0)
      setTypingUsers([])
      setGithubAccount(null)
      setGithubIntegration(null)
      setGithubError('')
      setGithubRepos([])
      setGithubReposLoaded(false)
      setGithubReposError('')
      setGithubCommits([])
      setGithubCommitsLoaded(false)
      setGithubCommitsError('')
      setGithubStats(null)
      setGithubStatsLoaded(false)
      setGithubStatsError('')
      typingTimersRef.current.forEach((typingTimer) => clearTimeout(typingTimer))
      typingTimersRef.current.clear()
    }, 0)
    return () => clearTimeout(timer)
  }, [boardId])

  useEffect(() => {
    if (!chatPanelOpen) return undefined
    const timer = setTimeout(() => {
      setUnreadMessages(0)
    }, 0)
    return () => clearTimeout(timer)
  }, [chatPanelOpen])

  useEffect(() => {
    if (!connected || !boardId) return undefined
    let cancelled = false

    // Connection auth proves the JWT is valid. Joining still checks membership
    // for this specific board before the server places the socket in its room.
    emitWithAck('board:join', { boardId })
      .then((data) => {
        if (!cancelled) setPresence(data.presence || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })

    // Reconnects can miss events while offline, so reload the full board
    // snapshot after joining. Incoming events keep the snapshot fresh after that.
    const timer = setTimeout(() => {
      loadBoard({ keepLoading: true })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [boardId, connected, emitWithAck, loadBoard])

  useEffect(() => {
    if (!connectionInitializedRef.current) {
      connectionInitializedRef.current = true
      wasConnectedRef.current = connected
      return
    }

    if (connected) {
      wasConnectedRef.current = true
      return
    }

    if (wasConnectedRef.current && connectionError) {
      toast.error('Realtime disconnected', 'Changes will still save through REST when possible.')
      wasConnectedRef.current = false
    }
  }, [connected, connectionError, toast])

  const updateTypingUser = useCallback((typingUser, typing) => {
    const id = typingUser?.id || typingUser?._id
    if (!id || String(id) === String(user?.id)) return

    const existingTimer = typingTimersRef.current.get(id)
    if (existingTimer) clearTimeout(existingTimer)

    if (!typing) {
      typingTimersRef.current.delete(id)
      setTypingUsers((prev) => prev.filter((item) => String(item.id || item._id) !== String(id)))
      return
    }

    setTypingUsers((prev) => {
      const nextUser = {
        id,
        name: typingUser.name,
        email: typingUser.email,
      }
      if (prev.some((item) => String(item.id || item._id) === String(id))) {
        return prev.map((item) => (String(item.id || item._id) === String(id) ? nextUser : item))
      }
      return [...prev, nextUser].slice(-3)
    })

    const staleTimer = setTimeout(() => {
      typingTimersRef.current.delete(id)
      setTypingUsers((prev) => prev.filter((item) => String(item.id || item._id) !== String(id)))
    }, 3000)
    typingTimersRef.current.set(id, staleTimer)
  }, [user?.id])

  useEffect(() => {
    if (!connected) return undefined

    // Each handler guards on boardId. A socket can reconnect or the user can
    // navigate between boards, and stale events should never mutate this view.
    function onPresenceUpdate(payload) {
      if (payload.boardId === boardId) setPresence(payload.users || [])
    }

    function onCardCreated(payload) {
      if (payload.boardId !== boardId) return
      setCardsByList((prev) => ({
        ...prev,
        [payload.card.list]: [...(prev[payload.card.list] || []), payload.card].sort((a, b) => a.position - b.position),
      }))
    }

    function onCardChanged(payload) {
      if (payload.boardId !== boardId) return
      replaceCard(payload.card)
    }

    function onCardDeleted(payload) {
      if (payload.boardId !== boardId) return
      setCardsByList((prev) => {
        const next = {}
        for (const listId in prev) next[listId] = prev[listId].filter((card) => card._id !== payload.cardId)
        return next
      })
      setSelectedCard((current) => (current?._id === payload.cardId ? null : current))
    }

    function onListCreated(payload) {
      if (payload.boardId !== boardId) return
      setLists((prev) => [...prev, payload.list].sort((a, b) => a.position - b.position))
      setCardsByList((prev) => ({ ...prev, [payload.list._id]: prev[payload.list._id] || [] }))
    }

    function onListChanged(payload) {
      if (payload.boardId !== boardId) return
      setLists((prev) => prev.map((list) => (list._id === payload.list._id ? payload.list : list)).sort((a, b) => a.position - b.position))
    }

    function onListDeleted(payload) {
      if (payload.boardId !== boardId) return
      setLists((prev) => prev.filter((list) => list._id !== payload.listId))
      setCardsByList((prev) => {
        const next = { ...prev }
        delete next[payload.listId]
        return next
      })
      setSelectedCard((current) => (current?.list === payload.listId ? null : current))
    }

    function onWorkflowCreated(payload) {
      if (payload.boardId !== boardId) return
      mergeWorkflowPayload(payload)
    }

    function onMembersUpdated(payload) {
      if (payload.boardId !== boardId) return
      const stillMember = payload.members?.some((member) => String(memberUserId(member)) === String(user?.id))
      if (!stillMember) {
        navigate('/dashboard')
        return
      }

      setMembers(payload.members || [])
      setBoard((current) => current ? { ...current, members: payload.members || [] } : current)
    }

    function onActivityCreated(payload) {
      if (payload.boardId !== boardId) return
      prependActivity(payload.activity)
    }

    function onMessageCreated(payload) {
      if (payload.boardId !== boardId) return
      updateTypingUser(payload.message?.sender, false)
      appendMessage(payload.message)
      if (!chatPanelOpen) setUnreadMessages((count) => Math.min(count + 1, 99))
    }

    function onMessageDeleted(payload) {
      if (payload.boardId !== boardId) return
      updateMessage(payload.message)
    }

    function onChatCleared(payload) {
      if (payload.boardId !== boardId) return
      setMessages([])
      setUnreadMessages(0)
    }

    function onChatTyping(payload) {
      if (payload.boardId !== boardId) return
      updateTypingUser(payload.user, payload.typing)
    }

    const cleanups = [
      onSocketEvent('presence:update', onPresenceUpdate),
      onSocketEvent('card:created', onCardCreated),
      onSocketEvent('card:updated', onCardChanged),
      onSocketEvent('card:moved', onCardChanged),
      onSocketEvent('card:deleted', onCardDeleted),
      onSocketEvent('list:created', onListCreated),
      onSocketEvent('list:updated', onListChanged),
      onSocketEvent('list:moved', onListChanged),
      onSocketEvent('list:deleted', onListDeleted),
      onSocketEvent('workflow:created', onWorkflowCreated),
      onSocketEvent('members:updated', onMembersUpdated),
      onSocketEvent('activity:created', onActivityCreated),
      onSocketEvent('message:created', onMessageCreated),
      onSocketEvent('message:deleted', onMessageDeleted),
      onSocketEvent('chat:cleared', onChatCleared),
      onSocketEvent('chat:typing', onChatTyping),
    ]

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [boardId, chatPanelOpen, connected, navigate, onSocketEvent, updateTypingUser, user?.id])

  // --- helpers -------------------------------------------------------------

  function findCardListId(cardId) {
    const map = cardsRef.current
    for (const listId in map) {
      if (map[listId].some((c) => c._id === cardId)) return listId
    }
    return null
  }

  function listIdFromDropTarget(over) {
    if (!over) return null

    const overType = over.data.current?.type
    if (overType === 'card') return over.data.current.listId ?? findCardListId(over.id)
    if (overType === 'card-container') return over.data.current.listId
    return over.id
  }

  function takeSnapshot() {
    const map = cardsRef.current
    const copy = {}
    for (const id in map) copy[id] = [...map[id]]
    snapshotRef.current = { lists: [...listsRef.current], cardsByList: copy }
  }

  function rollback(message) {
    if (snapshotRef.current) {
      setLists(snapshotRef.current.lists)
      setCardsByList(snapshotRef.current.cardsByList)
    }
    if (message) setError(message)
  }

  function setDraftForList(listId, value) {
    setCardDrafts((prev) => ({ ...prev, [listId]: value }))
  }

  // Prefer Socket.IO writes so collaborators receive live updates. REST keeps
  // the board usable if the socket drops while the API is still reachable.
  async function realtimeOrRest(eventName, payload, restCall) {
    if (connected) return emitWithAck(eventName, payload)
    return restCall()
  }

  function replaceCard(updatedCard) {
    setCardsByList((prev) => {
      const next = {}
      for (const listId in prev) {
        next[listId] = prev[listId].filter((card) => card._id !== updatedCard._id)
      }
      next[updatedCard.list] = [...(next[updatedCard.list] || []), updatedCard].sort((a, b) => a.position - b.position)
      return next
    })
    setSelectedCard((current) => (current?._id === updatedCard._id ? updatedCard : current))
  }

  function mergeWorkflowPayload({ workflow, lists: incomingLists = [], cards: incomingCards = [] }) {
    if (!workflow?._id) return

    setWorkflows((prev) => {
      const existing = prev.some((item) => item._id === workflow._id)
      const next = existing
        ? prev.map((item) => (item._id === workflow._id ? workflow : item))
        : [...prev, workflow]
      return next.sort((a, b) => a.position - b.position)
    })

    setLists((prev) => {
      const byId = new Map(prev.map((list) => [list._id, list]))
      for (const list of incomingLists) byId.set(list._id, list)
      return [...byId.values()].sort((a, b) => a.position - b.position)
    })

    setCardsByList((prev) => {
      const next = { ...prev }
      for (const list of incomingLists) {
        if (!next[list._id]) next[list._id] = []
      }
      for (const card of incomingCards) {
        const current = next[card.list] || []
        next[card.list] = [...current.filter((item) => item._id !== card._id), card]
      }
      for (const listId in next) next[listId] = [...next[listId]].sort((a, b) => a.position - b.position)
      return next
    })
  }

  function removeCard(card) {
    setCardsByList((prev) => ({
      ...prev,
      [card.list]: (prev[card.list] || []).filter((c) => c._id !== card._id),
    }))
  }

  function prependActivity(activity) {
    if (!activity?._id) return
    setActivities((prev) => {
      if (prev.some((item) => item._id === activity._id)) return prev
      return [activity, ...prev].slice(0, 30)
    })
  }

  function appendMessage(message) {
    if (!message?._id) return
    setMessages((prev) => {
      if (prev.some((item) => item._id === message._id)) return prev
      return [...prev, message].slice(-100)
    })
  }

  function replaceMessage(messageId, nextMessage) {
    setMessages((prev) => prev.map((item) => (item._id === messageId ? nextMessage : item)))
  }

  function updateMessage(message) {
    if (!message?._id) return
    setMessages((prev) => prev.map((item) => (item._id === message._id ? message : item)))
  }

  function buildPendingMessage(body) {
    const clientId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`
    return {
      _id: clientId,
      clientId,
      body,
      createdAt: new Date().toISOString(),
      sender: {
        id: user?.id,
        name: user?.name,
        email: user?.email,
      },
      deliveryStatus: 'sending',
    }
  }

  function closeActivityPanel() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('panel')
      return next
    })
  }

  function openPanel(panel) {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('panel', panel)
      return next
    })
  }

  function openChatPanel() {
    setUnreadMessages(0)
    openPanel('chat')
  }

  function closeChatPanel() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('panel')
      return next
    })
  }

  function closeGitHubPanel() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('panel')
      return next
    })
  }

  // --- add list / card -----------------------------------------------------

  async function handleAddCard(e, listId) {
    e.preventDefault()
    const title = (cardDrafts[listId] || '').trim()
    if (!title) return
    try {
      const listCards = cardsByList[listId] || []
      const last = listCards[listCards.length - 1]
      const position = positionBetween(last?.position, undefined)
      const workflowId = lists.find((list) => list._id === listId)?.workflow || activeWorkflowId || undefined
      const data = await realtimeOrRest(
        'card:create',
        { boardId, title, listId, position, workflowId },
        async () => (await boardApi.createCard(boardId, title, listId, position, token, { workflowId })).data
      )
      setCardsByList((prev) => ({ ...prev, [listId]: [...(prev[listId] || []), data.card] }))
      prependActivity(data.activity)
      setDraftForList(listId, '')
      toast.success('Card created', title)
    } catch (err) {
      setError(err.message)
      toast.error('Could not create card', err.message)
    }
  }

  async function handleAddList(e) {
    e.preventDefault()
    if (!newListTitle.trim()) return
    try {
      const last = activeLists[activeLists.length - 1]
      const position = positionBetween(last?.position, undefined)
      const workflowId = activeWorkflowId || workflows[0]?._id
      const data = await realtimeOrRest(
        'list:create',
        { boardId, title: newListTitle, position, workflowId },
        async () => (await boardApi.createList(boardId, newListTitle, position, token, { workflowId })).data
      )
      setLists((prev) => [...prev, data.list].sort((a, b) => a.position - b.position))
      setCardsByList((prev) => ({ ...prev, [data.list._id]: [] }))
      prependActivity(data.activity)
      setNewListTitle('')
      toast.success('List created', data.list.title)
    } catch (err) {
      setError(err.message)
      toast.error('Could not create list', err.message)
    }
  }

  async function handleUpdateCard(card, updates) {
    const fromListId = card.list
    const toListId = updates.list || fromListId
    const payload = { ...updates }

    if (toListId !== fromListId) {
      const targetCards = (cardsRef.current[toListId] || []).filter((c) => c._id !== card._id)
      const last = targetCards[targetCards.length - 1]
      payload.position = positionBetween(last?.position, undefined)
    }

    const data = await realtimeOrRest(
      'card:update',
      { boardId, cardId: card._id, updates: payload },
      async () => (await boardApi.updateCard(boardId, card._id, payload, token)).data
    )
    replaceCard(data.card)
    prependActivity(data.activity)
    if (!updates.checklistOperation) toast.success('Card saved', data.card.title)
  }

  async function handleDeleteCard(card) {
    const data = await realtimeOrRest(
      'card:delete',
      { boardId, cardId: card._id },
      async () => (await boardApi.deleteCard(boardId, card._id, token)).data
    )
    removeCard(card)
    prependActivity(data.activity)
    toast.success('Card deleted', card.title)
  }

  async function handleRenameList(list, title) {
    if (title === list.title) return
    try {
      const data = await realtimeOrRest(
        'list:update',
        { boardId, listId: list._id, updates: { title } },
        async () => (await boardApi.updateList(boardId, list._id, { title }, token)).data
      )
      setLists((prev) => prev.map((l) => (l._id === list._id ? data.list : l)))
      prependActivity(data.activity)
      toast.success('List renamed', data.list.title)
    } catch (err) {
      setError(err.message)
      toast.error('Could not rename list', err.message)
    }
  }

  async function handleDeleteList(list) {
    setListDeleteTarget(list)
  }

  async function confirmDeleteList() {
    if (!listDeleteTarget) return
    const list = listDeleteTarget
    setListDeleting(true)
    try {
      const data = await realtimeOrRest(
        'list:delete',
        { boardId, listId: list._id },
        async () => (await boardApi.deleteList(boardId, list._id, token)).data
      )
      setLists((prev) => prev.filter((l) => l._id !== list._id))
      setCardsByList((prev) => {
        const next = { ...prev }
        delete next[list._id]
        return next
      })
      prependActivity(data.activity)
      toast.success('List deleted', list.title)
      setListDeleteTarget(null)
    } catch (err) {
      setError(err.message)
      toast.error('Could not delete list', err.message)
    } finally {
      setListDeleting(false)
    }
  }

  async function handleUpdateBoard(name, options) {
    const res = await boardApi.update(boardId, { name, ...options }, token)
    setBoard(res.data.board)
    prependActivity(res.data.activity)
    toast.success('Project updated', res.data.board.name)
  }

  async function handleDeleteBoard() {
    setBoardDeleteOpen(true)
  }

  async function confirmDeleteBoard() {
    setBoardDeleting(true)
    try {
      await boardApi.delete(boardId, token)
      toast.success('Project deleted', board.name)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
      toast.error('Could not delete project', err.message)
    } finally {
      setBoardDeleting(false)
    }
  }

  async function handleAddMember(email, role) {
    const res = await boardApi.addMember(boardId, email, role, token)
    setMembers(res.data.members)
    setBoard((current) => current ? { ...current, members: res.data.members } : current)
    prependActivity(res.data.activity)
    toast.success('Member added', email)
  }

  async function handleChangeMemberRole(memberId, role) {
    const res = await boardApi.updateMemberRole(boardId, memberId, role, token)
    setMembers(res.data.members)
    setBoard((current) => current ? { ...current, members: res.data.members } : current)
    prependActivity(res.data.activity)
    toast.success('Member role updated', role)
  }

  async function handleRemoveMember(memberId) {
    const res = await boardApi.removeMember(boardId, memberId, token)
    setMembers(res.data.members)
    setBoard((current) => current ? { ...current, members: res.data.members } : current)
    prependActivity(res.data.activity)
    toast.success('Member removed')
  }

  async function handleAddWorkflow(payload) {
    const res = await boardApi.createWorkflow(boardId, payload, token)
    const { workflow, lists: seededLists = [], cards: seededCards = [], activity } = res.data
    mergeWorkflowPayload({ workflow, lists: seededLists, cards: seededCards })
    setActiveWorkflowId(workflow._id)
    prependActivity(activity)
    toast.success('Workflow added', workflow.name)
  }

  async function handleQuickStartWorkflow(template) {
    if (!template || quickWorkflowId) return

    setQuickWorkflowId(template.id)
    try {
      await handleAddWorkflow({
        workflowTemplateId: template.id,
        name: template.name,
      })
    } catch (err) {
      toast.error('Could not add workflow', err.message)
    } finally {
      setQuickWorkflowId('')
    }
  }

  async function handleRefreshGitHubRepos() {
    setGithubReposLoaded(false)
    await loadGitHubRepos()
  }

  async function handleLinkGitHubRepo(repository) {
    setGithubSaving(true)
    try {
      const res = await boardApi.linkGitHubRepo(boardId, repository, token)
      setGithubIntegration(res.data.integration)
      setGithubCommits([])
      setGithubCommitsLoaded(false)
      setGithubCommitsError('')
      setGithubStats(null)
      setGithubStatsLoaded(false)
      setGithubStatsError('')
      prependActivity(res.data.activity)
      toast.success('GitHub repo linked', res.data.integration.repoFullName)
    } catch (err) {
      setGithubReposError(err.message)
      toast.error('Could not link GitHub repo', err.message)
      throw err
    } finally {
      setGithubSaving(false)
    }
  }

  async function handleUnlinkGitHubRepo() {
    setGithubSaving(true)
    try {
      const res = await boardApi.unlinkGitHubRepo(boardId, token)
      setGithubIntegration(null)
      setGithubCommits([])
      setGithubCommitsLoaded(false)
      setGithubCommitsError('')
      setGithubStats(null)
      setGithubStatsLoaded(false)
      setGithubStatsError('')
      prependActivity(res.data.activity)
      toast.success('GitHub repo unlinked')
    } catch (err) {
      setGithubReposError(err.message)
      toast.error('Could not unlink GitHub repo', err.message)
      throw err
    } finally {
      setGithubSaving(false)
    }
  }

  async function handleRefreshGitHubCommits() {
    setGithubCommitsLoaded(false)
    await loadGitHubCommits()
  }

  async function handleRefreshGitHubStats() {
    setGithubStatsLoaded(false)
    await loadGitHubStats()
  }

  async function handleSendMessage(body) {
    const pendingMessage = buildPendingMessage(body)
    appendMessage(pendingMessage)

    try {
      const data = await realtimeOrRest(
        'message:create',
        { boardId, body },
        async () => (await boardApi.createMessage(boardId, body, token)).data
      )
      setMessagesError('')
      replaceMessage(pendingMessage._id, data.message)
    } catch (err) {
      replaceMessage(pendingMessage._id, {
        ...pendingMessage,
        deliveryStatus: 'failed',
        deliveryError: err.message,
      })
      toast.error('Could not send message', err.message)
      throw err
    }
  }

  async function handleRetryMessage(message) {
    replaceMessage(message._id, {
      ...message,
      deliveryStatus: 'sending',
      deliveryError: '',
    })

    try {
      const data = await realtimeOrRest(
        'message:create',
        { boardId, body: message.body },
        async () => (await boardApi.createMessage(boardId, message.body, token)).data
      )
      setMessagesError('')
      replaceMessage(message._id, data.message)
    } catch (err) {
      replaceMessage(message._id, {
        ...message,
        deliveryStatus: 'failed',
        deliveryError: err.message,
      })
      toast.error('Retry failed', err.message)
      throw err
    }
  }

  async function handleDeleteMessage(message) {
    try {
      const data = await realtimeOrRest(
        'message:delete',
        { boardId, messageId: message._id },
        async () => (await boardApi.deleteMessage(boardId, message._id, token)).data
      )
      updateMessage(data.message)
      prependActivity(data.activity)
      toast.success('Message deleted')
    } catch (err) {
      setMessagesError(err.message)
      toast.error('Could not delete message', err.message)
      throw err
    }
  }

  async function handleClearMessages() {
    try {
      const data = await realtimeOrRest(
        'chat:clear',
        { boardId },
        async () => (await boardApi.clearMessages(boardId, token)).data
      )
      setMessages([])
      setUnreadMessages(0)
      prependActivity(data.activity)
      toast.success('Chat cleared', `${data.deletedCount || 0} messages cleared`)
    } catch (err) {
      setMessagesError(err.message)
      toast.error('Could not clear chat', err.message)
      throw err
    }
  }

  const handleTypingChange = useCallback((typing) => {
    if (!connected || !boardId) return
    emitWithAck('chat:typing', { boardId, typing }).catch(() => {
      // Typing is best-effort realtime polish; failed pings should not disturb
      // the user's actual message flow or show noisy errors.
    })
  }, [boardId, connected, emitWithAck])

  // --- drag & drop ---------------------------------------------------------

  function handleDragStart(event) {
    const { active } = event
    setError('')
    takeSnapshot()
    if (active.data.current?.type === 'card') {
      const listId = findCardListId(active.id)
      const card = cardsRef.current[listId]?.find((c) => c._id === active.id)
      setActiveCard(card || null)
      dragOriginRef.current = { type: 'card', listId, index: cardsRef.current[listId]?.findIndex((c) => c._id === active.id) }
    } else {
      dragOriginRef.current = { type: 'list', index: listsRef.current.findIndex((l) => l._id === active.id) }
    }
  }

  // Live-move a card into another column as it's dragged over it.
  function handleDragOver(event) {
    const { active, over } = event
    if (!over || active.data.current?.type !== 'card') return

    const activeId = active.id
    const fromList = findCardListId(activeId)
    const toList = listIdFromDropTarget(over)
    if (!fromList || !toList || fromList === toList) return

    setCardsByList((prev) => {
      const fromArr = [...(prev[fromList] || [])]
      const toArr = [...(prev[toList] || [])]
      const movingIdx = fromArr.findIndex((c) => c._id === activeId)
      if (movingIdx === -1) return prev
      const [moving] = fromArr.splice(movingIdx, 1)
      const moved = { ...moving, list: toList }
      let insertAt = toArr.length
      if (over.data.current?.type === 'card') {
        const overIdx = toArr.findIndex((c) => c._id === over.id)
        insertAt = overIdx === -1 ? toArr.length : overIdx
      }
      toArr.splice(insertAt, 0, moved)
      return { ...prev, [fromList]: fromArr, [toList]: toArr }
    })
  }

  function handleDragEnd(event) {
    const { active, over } = event
    setActiveCard(null)

    // Dropped outside any target — undo the live moves from onDragOver.
    if (!over) {
      rollback()
      return
    }

    if (active.data.current?.type === 'list') {
      finishListDrag(active, over)
    } else {
      finishCardDrag(active, over)
    }
  }

  function finishListDrag(active, over) {
    const current = activeListsRef.current
    const oldIndex = current.findIndex((l) => l._id === active.id)
    const newIndex = current.findIndex((l) => l._id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

    const reordered = arrayMove(current, oldIndex, newIndex)
    const position = positionForIndex(reordered, newIndex)
    const withPos = reordered.map((l) => (l._id === active.id ? { ...l, position } : l))
    setLists((prev) => prev.map((list) => withPos.find((item) => item._id === list._id) || list).sort((a, b) => a.position - b.position))

    realtimeOrRest(
      'list:move',
      { boardId, listId: active.id, position },
      async () => (await boardApi.updateList(boardId, active.id, { position }, token)).data
    )
      .then((data) => prependActivity(data.activity))
      .catch(() => {
        rollback('Could not save list order — reverted.')
        toast.error('Could not save list order', 'The list was moved back.')
      })
  }

  function finishCardDrag(active, over) {
    const activeId = active.id
    const originContainer = findCardListId(activeId)
    const targetContainer = listIdFromDropTarget(over) || originContainer
    if (!originContainer || !targetContainer) return

    let arr = [...(cardsRef.current[targetContainer] || [])]
    let sourceWithoutMoving = null
    if (originContainer !== targetContainer) {
      const originArr = [...(cardsRef.current[originContainer] || [])]
      const moving = originArr.find((c) => c._id === activeId)
      if (!moving) return

      sourceWithoutMoving = originArr.filter((c) => c._id !== activeId)
      arr = arr.filter((c) => c._id !== activeId)
      let insertAt = arr.length
      if (over.data.current?.type === 'card') {
        const overIdx = arr.findIndex((c) => c._id === over.id)
        insertAt = overIdx === -1 ? arr.length : overIdx
      }
      arr.splice(insertAt, 0, { ...moving, list: targetContainer })
    }

    const oldIndex = arr.findIndex((c) => c._id === activeId)
    let newIndex = oldIndex
    if (originContainer === targetContainer && over.data.current?.type === 'card') {
      const overIdx = arr.findIndex((c) => c._id === over.id)
      if (overIdx !== -1) newIndex = overIdx
    }

    const origin = dragOriginRef.current
    const unchanged = origin?.type === 'card' && origin.listId === targetContainer && origin.index === newIndex
    if (unchanged) return  // nothing actually moved — skip the write

    const finalArr = oldIndex === newIndex ? arr : arrayMove(arr, oldIndex, newIndex)
    const finalIndex = finalArr.findIndex((c) => c._id === activeId)
    const position = positionForIndex(finalArr, finalIndex)
    const withPos = finalArr.map((c) => (c._id === activeId ? { ...c, list: targetContainer, position } : c))
    setCardsByList((prev) => {
      const next = { ...prev, [targetContainer]: withPos }
      if (sourceWithoutMoving) next[originContainer] = sourceWithoutMoving
      return next
    })

    realtimeOrRest(
      'card:move',
      { boardId, cardId: activeId, position, list: targetContainer },
      async () => (await boardApi.updateCard(boardId, activeId, { position, list: targetContainer }, token)).data
    )
      .then((data) => prependActivity(data.activity))
      .catch(() => {
        rollback('Could not save card move — reverted.')
        toast.error('Could not move card', 'The card was moved back.')
      })
  }

  // --- render --------------------------------------------------------------

  if (loading) {
    return <BoardLoadingSkeleton />
  }
  // Full-screen error only when the board never loaded. Transient errors (a
  // failed drag persist, etc.) show as an inline banner below so the board stays put.
  if (error && !board) {
    return (
      <BoardLoadError
        message={error}
        onRetry={() => loadBoard()}
        onBack={() => navigate('/dashboard')}
      />
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-stone-50/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <Logo size="sm" />
            </button>
            <span className="hidden text-zinc-300 dark:text-zinc-700 sm:block">/</span>
            <div className="min-w-0">
              <BoardSwitcher currentBoard={board} />
              <div className="mt-1 hidden items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 sm:flex">
                <span>
                  {activeWorkflow ? `${activeWorkflow.name} · ` : ''}{activeLists.length} lists · {filtersActive ? `${filteredCardCount} of ${totalCardCount}` : totalCardCount} cards
                </span>
                <span>·</span>
                <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-teal-700 dark:text-teal-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-teal-500' : 'bg-zinc-400'}`} />
                  {connected ? `${presence.length || 1} online` : 'offline'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => setManagingMembers(true)}
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <div className="flex -space-x-1">
                {members.slice(0, 3).map((member) => (
                  <span key={memberUserId(member)} className="grid h-5 w-5 place-items-center rounded-full border border-white bg-zinc-950 text-[9px] font-bold text-white dark:border-zinc-900 dark:bg-white dark:text-zinc-950">
                    {(member.user?.name || member.user?.email || '?')[0]?.toUpperCase()}
                  </span>
                ))}
              </div>
              Members
            </button>
            <Link
              to={`/boards/${boardId}/activity`}
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 12h4l3 8 4-16 3 8h4" />
              </svg>
              Activity
            </Link>
            <button
              type="button"
              onClick={() => openPanel('github')}
              className="relative inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <GitHubMark className="h-[15px] w-[15px]" />
              GitHub
              {githubIntegration && (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-teal-500 dark:border-zinc-900" />
              )}
            </button>
            <button
              type="button"
              onClick={openChatPanel}
              className="relative inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              </svg>
              Chat
              {unreadMessages > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </button>
            {(canEditBoard || canDeleteBoard) && (
              <div className="col-span-2 grid grid-cols-[1fr_auto] gap-2 sm:flex">
                {canEditBoard && (
                  <button
                    type="button"
                    onClick={() => setEditingBoard(true)}
                    className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    Edit
                  </button>
                )}
                {canDeleteBoard && (
                  <button
                    type="button"
                    onClick={handleDeleteBoard}
                    className="grid h-10 w-10 place-items-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50 dark:border-red-500/30 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-500/10"
                    aria-label="Delete project"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
              <NotificationBell />
              <button
                onClick={toggle}
                aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
                className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {dark ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <WorkflowSwitcher
        workflows={workflows}
        activeWorkflowId={activeWorkflowId}
        onSelect={(workflowId) => {
          setActiveWorkflowId(workflowId)
          setSelectedCard(null)
        }}
        onAdd={() => setAddingWorkflow(true)}
        canAdd={canEditBoard}
        listsByWorkflow={listsByWorkflow}
        cardsByWorkflow={cardsByWorkflow}
      />

      {!showProjectWelcome && (
        <ActiveWorkflowToolbar
          activeWorkflow={activeWorkflow}
          listCount={activeLists.length}
          cardCount={totalCardCount}
          newListTitle={newListTitle}
          onNewListTitleChange={setNewListTitle}
          onAddList={handleAddList}
        />
      )}

      {!showProjectWelcome && (
        <section className="mx-4 mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search cards</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={cardSearch}
              onChange={(e) => setCardSearch(e.target.value)}
              placeholder="Search title or description"
              className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-950"
            />
          </label>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <label>
              <span className="sr-only">Filter by tag</span>
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:bg-zinc-950 sm:w-36"
              >
                <option value="all">All tags</option>
                {CARD_TAGS.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="sr-only">Filter by status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:bg-zinc-950 sm:w-40"
              >
                <option value="all">All statuses</option>
                {CARD_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 md:justify-end">
            <span className="whitespace-nowrap text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {filtersActive ? `${filteredCardCount} of ${totalCardCount} shown` : `${totalCardCount} cards in ${activeWorkflow?.name || 'this workflow'}`}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setCardSearch('')
                  setTagFilter('all')
                  setStatusFilter('all')
                }}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Clear
              </button>
            )}
          </div>
        </section>
      )}

      {connectionError && !connected && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span>Realtime is offline: {connectionError}. Changes will use REST where possible.</span>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-red-100 dark:hover:bg-red-500/10" aria-label="Dismiss error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-[calc(100dvh-238px)] gap-4 overflow-x-auto px-4 py-4 sm:min-h-[calc(100dvh-204px)] lg:min-h-[calc(100dvh-164px)]">
          {showProjectWelcome ? (
            <ProjectWelcomeState
              boardName={board.name}
              templates={workflowTemplates}
              templatesLoading={workflowTemplatesLoading}
              pendingTemplateId={quickWorkflowId}
              canAdd={canEditBoard}
              onAddWorkflow={() => setAddingWorkflow(true)}
              onQuickStart={handleQuickStartWorkflow}
            />
          ) : (
            <SortableContext items={activeLists.map((l) => l._id)} strategy={horizontalListSortingStrategy}>
              {activeLists.map((list) => (
                <BoardColumn
                  key={list._id}
                  list={list}
                  cards={visibleCardsByList[list._id] || []}
                  totalCards={(cardsByList[list._id] || []).length}
                  filtersActive={filtersActive}
                  draft={cardDrafts[list._id]}
                  onDraftChange={setDraftForList}
                  onAddCard={handleAddCard}
                  onCardOpen={setSelectedCard}
                  onListRename={handleRenameList}
                  onListDelete={handleDeleteList}
                />
              ))}
            </SortableContext>
          )}

          {!showProjectWelcome && activeLists.length === 0 && (
            <BoardEmptyState boardName={board.name} workflowName={activeWorkflow?.name} />
          )}
        </div>

        {/* No drop animation: its post-drop settling opens a window where a
            state change (e.g. a rollback) thrashes dnd-kit's rect measuring
            into an infinite update loop. */}
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="rounded-lg border border-teal-200 bg-white p-3 text-sm text-zinc-950 shadow-xl shadow-teal-700/15 dark:border-teal-500/30 dark:bg-zinc-900 dark:text-zinc-100">
              {activeCard.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardDetailModal
          boardId={boardId}
          card={selectedCard}
          lists={activeLists}
          members={members}
          token={token}
          connected={connected}
          emitWithAck={emitWithAck}
          onSocketEvent={onSocketEvent}
          onActivity={prependActivity}
          onToast={toast}
          onClose={() => setSelectedCard(null)}
          onSave={handleUpdateCard}
          onDelete={handleDeleteCard}
        />
      )}

      {editingBoard && (
        <NewBoardModal
          board={board}
          onClose={() => setEditingBoard(false)}
          onCreate={handleUpdateBoard}
        />
      )}

      {managingMembers && (
        <MembersPanel
          board={board}
          members={members}
          presence={presence}
          currentUserId={user?.id}
          currentRole={currentRole}
          onClose={() => setManagingMembers(false)}
          onAddMember={handleAddMember}
          onChangeRole={handleChangeMemberRole}
          onRemoveMember={handleRemoveMember}
        />
      )}

      {activityPanelOpen && (
        <ActivityPanel
          board={board}
          activities={activities}
          loading={activityLoading}
          error={activityError}
          onRetry={loadActivities}
          onClose={closeActivityPanel}
        />
      )}

      {githubPanelOpen && (
        <GitHubIntegrationPanel
          board={board}
          account={githubAccount}
          integration={githubIntegration}
          loading={githubLoading}
          error={githubError}
          repos={githubRepos}
          reposLoading={githubReposLoading}
          reposError={githubReposError}
          reposLoaded={githubReposLoaded}
          saving={githubSaving}
          commits={githubCommits}
          commitsLoading={githubCommitsLoading}
          commitsError={githubCommitsError}
          commitsLoaded={githubCommitsLoaded}
          stats={githubStats}
          statsLoading={githubStatsLoading}
          statsError={githubStatsError}
          statsLoaded={githubStatsLoaded}
          canEdit={canEditBoard}
          onClose={closeGitHubPanel}
          onRefreshRepos={handleRefreshGitHubRepos}
          onLinkRepo={handleLinkGitHubRepo}
          onUnlinkRepo={handleUnlinkGitHubRepo}
          onRefreshCommits={handleRefreshGitHubCommits}
          onRefreshStats={handleRefreshGitHubStats}
        />
      )}

      {chatPanelOpen && (
        <ChatPanel
          board={board}
          messages={messages}
          loading={messagesLoading}
          error={messagesError}
          currentUserId={user?.id}
          connected={connected}
          currentRole={currentRole}
          typingUsers={typingUsers}
          onRetry={loadMessages}
          onClose={closeChatPanel}
          onSendMessage={handleSendMessage}
          onDeleteMessage={handleDeleteMessage}
          onClearMessages={handleClearMessages}
          onRetryMessage={handleRetryMessage}
          onTypingChange={handleTypingChange}
        />
      )}

      {addingWorkflow && (
        <AddWorkflowModal
          templates={workflowTemplates}
          templatesLoading={workflowTemplatesLoading}
          templatesError={workflowTemplatesError}
          onClose={() => setAddingWorkflow(false)}
          onCreate={handleAddWorkflow}
        />
      )}

      {listDeleteTarget && (
        <ConfirmDialog
          title={`Delete "${listDeleteTarget.title}"?`}
          description={listDeleteDescription}
          confirmLabel="Delete list"
          pending={listDeleting}
          onCancel={() => setListDeleteTarget(null)}
          onConfirm={confirmDeleteList}
        />
      )}

      {boardDeleteOpen && (
        <ConfirmDialog
          title={`Delete "${board.name}"?`}
          description="This will permanently delete the project, its workflows, lists, cards, comments, chat messages, and activity history."
          confirmLabel="Delete project"
          pending={boardDeleting}
          onCancel={() => setBoardDeleteOpen(false)}
          onConfirm={confirmDeleteBoard}
        />
      )}
    </div>
  )
}
