import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { statusDotStyle, tagStyle } from '../lib/cardMeta'

const noLayoutAnimation = () => false

function assigneeName(assignee) {
  if (!assignee) return ''
  if (typeof assignee === 'string') return 'Assigned'
  return assignee.name || assignee.email || 'Assigned'
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
}

function parseCalendarDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function dueDateMeta(dueDate) {
  if (!dueDate) return null

  const date = parseCalendarDate(dueDate)
  if (!date) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const daysAway = Math.round((target - today) / 86_400_000)
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

  if (daysAway < 0) {
    return { label: `Overdue ${formatter.format(date)}`, tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' }
  }
  if (daysAway === 0) {
    return { label: 'Due today', tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200' }
  }
  if (daysAway === 1) {
    return { label: 'Due tomorrow', tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200' }
  }
  if (daysAway <= 2) {
    return { label: `Due ${formatter.format(date)}`, tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200' }
  }

  return { label: `Due ${formatter.format(date)}`, tone: 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400' }
}

function createdDateMeta(createdAt) {
  if (!createdAt) return null

  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null

  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  return {
    label: `Created ${formatter.format(date)}`,
    tone: 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
  }
}

export default function SortableCard({ card, onOpen }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card._id, data: { type: 'card', listId: card.list }, animateLayoutChanges: noLayoutAnimation })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const assignedTo = assigneeName(card.assignee)
  const dateLabel = dueDateMeta(card.dueDate) || createdDateMeta(card.createdAt)

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card)}
      className="w-full cursor-grab touch-none rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm shadow-sm transition hover:border-teal-200 hover:shadow-md active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-teal-500/30"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${tagStyle(card.tag)}`}>
          {card.tag || 'Task'}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          <span className={`h-2 w-2 rounded-full ${statusDotStyle(card.status)}`} />
          {card.status || 'Todo'}
        </span>
      </div>
      <p className="leading-5 text-zinc-900 dark:text-zinc-100">{card.title}</p>
      {card.checklist?.length > 0 && (
        <span className="mt-2 block text-xs font-medium text-teal-700 dark:text-teal-300">
          {card.checklist.filter((item) => item.completed).length}/{card.checklist.length} to-dos complete
        </span>
      )}
      {(assignedTo || dateLabel) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          {assignedTo ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-950 text-[9px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
                {initials(assignedTo)}
              </span>
              <span className="truncate">{assignedTo}</span>
            </span>
          ) : <span />}

          {dateLabel && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold ${dateLabel.tone}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 2v4" />
                <path d="M16 2v4" />
                <rect width="18" height="18" x="3" y="4" rx="2" />
                <path d="M3 10h18" />
              </svg>
              {dateLabel.label}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
