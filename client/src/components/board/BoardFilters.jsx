import { CARD_STATUSES, CARD_TAGS } from '../../lib/cardMeta'

export default function BoardFilters({
  cardSearch, tagFilter, statusFilter, filtersActive, filteredCardCount,
  totalCardCount, activeWorkflow, onSearchChange, onTagChange, onStatusChange, onClear,
}) {
  return (
    <section className="mx-4 mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search cards</span>
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={cardSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search title or description"
          className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-950"
        />
      </label>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <label>
          <span className="sr-only">Filter by tag</span>
          <select
            value={tagFilter}
            onChange={(e) => onTagChange(e.target.value)}
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
            onChange={(e) => onStatusChange(e.target.value)}
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
            onClick={onClear}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Clear
          </button>
        )}
      </div>
    </section>
  )
}
