import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, Inbox, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useNotificationInbox } from '../hooks/useNotificationInbox'

const actions = {
  'card.assigned': 'assigned you a task',
  'comment.created': 'commented on your task',
  'member.added': 'added you to a project',
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

export default function NotificationBell({ onOpen }) {
  const { token } = useAuth()
  const { pathname } = useLocation()
  // Remount on account or page changes, discarding private cached inbox state.
  return token ? <InboxBell key={`${token}:${pathname}`} token={token} onOpen={onOpen} /> : null
}

function InboxBell({ token, onOpen }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const panel = useRef(null)
  const id = useId()
  const inbox = useNotificationInbox(token)
  const iconButton = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800'

  useEffect(() => {
    if (!open) return undefined
    panel.current?.focus()
    function outside(event) {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    function escape(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function toggle() {
    if (!open) { onOpen?.(); inbox.refresh() }
    setOpen((value) => !value)
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button ref={trigger} type="button" onClick={toggle} title="Notifications" aria-label={`Notifications${inbox.unreadCount !== null ? `, ${inbox.unreadCount} unread` : ''}`} aria-expanded={open} aria-controls={open ? id : undefined} className={`${iconButton} relative border border-zinc-200 dark:border-zinc-800`}>
        <Bell size={17} aria-hidden="true" />
        {inbox.unreadCount > 0 && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-teal-700 px-1 text-[10px] font-bold text-white ring-2 ring-stone-50 dark:ring-zinc-950">{inbox.unreadCount > 99 ? '99+' : inbox.unreadCount}</span>}
      </button>
      {open && (
        <section id={id} ref={panel} tabIndex={-1} aria-label="Notifications" className="fixed inset-x-4 top-16 z-50 mt-2 flex max-h-[min(32rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-96">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="min-w-0 flex-1 text-sm font-semibold">Notifications</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{inbox.unreadCount === null ? '' : `${inbox.unreadCount} unread`}</span>
            <button type="button" title="Refresh notifications" aria-label="Refresh notifications" disabled={inbox.loading} onClick={inbox.refresh} className={iconButton}><RefreshCw size={15} aria-hidden="true" /></button>
            <button type="button" title="Close notifications" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus() }} className={iconButton}><X size={17} aria-hidden="true" /></button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain" aria-busy={inbox.loading || inbox.loadingMore}>
            {inbox.loading ? (
              <div role="status" aria-label="Loading notifications" className="space-y-4 p-4"><span className="sr-only">Loading notifications</span>{[0, 1, 2].map((item) => <div key={item} className="space-y-2"><div className="h-3 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" /><div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></div>)}</div>
            ) : inbox.error ? (
              <div role="alert" className="p-5 text-center"><p className="text-sm text-red-700 dark:text-red-300">{inbox.error}</p><button type="button" onClick={inbox.refresh} className="mt-3 text-sm font-semibold text-teal-700 dark:text-teal-300">Retry</button></div>
            ) : inbox.notifications.length === 0 ? (
              <div className="px-5 py-10 text-center"><Inbox size={28} aria-hidden="true" className="mx-auto mb-3 text-zinc-400" /><p className="text-sm font-semibold">No notifications yet</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">New task assignments will appear here.</p></div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {inbox.notifications.map((item) => (
                  <li key={item._id} className={`flex gap-3 px-4 py-4 ${item.readAt ? '' : 'bg-teal-50/50 dark:bg-teal-500/5'}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-teal-600'}`}><span className="sr-only">{item.readAt ? 'Read' : 'Unread'}</span></span>
                    <div className="min-w-0 flex-1 break-words">
                      <p className="text-sm leading-5"><span className="font-semibold">{item.actor?.name || 'Former member'}</span> {actions[item.type] || 'updated your project'}.</p>
                      {item.type !== 'member.added' && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{item.card?.title || 'Task no longer available'}</p>}
                      <p className="mt-1 text-xs font-medium text-teal-700 dark:text-teal-300">{item.board.name}</p>
                      <time dateTime={item.createdAt} className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{timeLabel(item.createdAt)}</time>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!inbox.loading && !inbox.error && inbox.nextCursor && (
              <div className="border-t border-zinc-100 p-3 text-center dark:border-zinc-800">
                {inbox.moreError && <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-300">{inbox.moreError}</p>}
                <button type="button" disabled={inbox.loadingMore} onClick={inbox.loadMore} className="px-3 py-2 text-sm font-semibold text-teal-700 disabled:opacity-50 dark:text-teal-300">{inbox.loadingMore ? 'Loading...' : inbox.moreError ? 'Retry loading more' : 'Load more'}</button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
