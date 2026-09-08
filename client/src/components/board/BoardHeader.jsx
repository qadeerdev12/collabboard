import { Link, useNavigate } from 'react-router-dom'
import { useTheme } from '../../context/useTheme'
import { memberUserId } from '../../lib/boardMembers'
import Logo from '../Logo'
import NotificationBell from '../NotificationBell'
import BoardSwitcher from '../BoardSwitcher'
import GitHubMark from './GitHubMark'

// Present project context and permission-gated actions; mutations remain in the page.
export default function BoardHeader({
  boardId, board, activeWorkflow, listCount, totalCardCount, filteredCardCount,
  filtersActive, connected, onlineCount, members, canEditBoard, canDeleteBoard,
  githubIntegration, unreadMessages, onManageMembers, onOpenGitHub, onOpenChat,
  onEditBoard, onDeleteBoard,
}) {
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()

  return (
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
                {activeWorkflow ? `${activeWorkflow.name} · ` : ''}{listCount} lists · {filtersActive ? `${filteredCardCount} of ${totalCardCount}` : totalCardCount} cards
              </span>
              <span>·</span>
              <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-teal-700 dark:text-teal-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-teal-500' : 'bg-zinc-400'}`} />
                {connected ? `${onlineCount || 1} online` : 'offline'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onManageMembers}
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
            onClick={onOpenGitHub}
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
            onClick={onOpenChat}
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
                  onClick={onEditBoard}
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
                  onClick={onDeleteBoard}
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
  )
}
