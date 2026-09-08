# Board page maintenance

`client/src/pages/BoardPage.jsx` is the project route. A project owns workflows;
workflows own lists and cards. This refactor separates presentation and drag
behavior without changing that model, API payloads, permissions, or socket events.

## Ownership map

| File under `client/src` | Responsibility |
| --- | --- |
| `pages/BoardPage.jsx` | Route/query state, shared project data, loading, permission derivation, mutations, socket subscriptions, and composing the page |
| `components/board/BoardHeader.jsx` | Project identity, counts, presence, theme, notifications, and permission-gated action buttons |
| `components/board/BoardFilters.jsx` | Controlled search/tag/status inputs and the visible-card count |
| `components/board/BoardPageStates.jsx` | Initial loading, initial error/retry, and empty-workflow views |
| `components/board/ActiveWorkflowToolbar.jsx` | Active workflow summary and the controlled add-list form |
| `components/board/ProjectWelcomeState.jsx` | New-project welcome and quick-start workflow actions |
| `components/board/WorkflowSwitcher.jsx` | Workflow tabs, their counts, and the add-workflow entry point |
| `components/board/AddWorkflowModal.jsx` | Local template/custom selection, name draft, pending/error state, and creation callback |
| `components/board/GitHubIntegrationPanel.jsx` | Repository picker, integration/commit/stat views, and local search/picker visibility |
| `components/board/GitHubMark.jsx` | Existing shared GitHub icon used by the header and panel |
| `hooks/useBoardDragAndDrop.js` | Drag sensors, collision priority, optimistic movement, persistence, and rollback |
| `lib/boardMembers.js` | Normalize raw or populated membership user IDs |

Existing `BoardColumn`, card detail, chat, members, activity, and confirmation
components remain where they were. Do not move unrelated components into the
`board` directory just to make the directory larger.

## State and callback boundaries

`BoardPage` remains the single owner of `lists`, `cardsByList`, workflows, selected
card, and server-backed panel data. The extracted views receive those values and
callbacks. They do not independently fetch a second copy of project state.

Draft-only state stays with the relevant component: the workflow modal owns its
selection/name, and the GitHub panel owns repository search/picker visibility.
The header uses the existing theme context. Opening chat, editing the project,
managing members, or changing a repository still delegates to the original page
handlers. Backend authorization remains required regardless of hidden buttons.

The page passes the actual route `boardId` to the header so activity links retain
the same route behavior. Notification task deep links, query-driven panels, and
workflow selection continue to be coordinated in the page.

## Drag-and-drop invariants

The hook was extracted from the existing implementation, not rewritten.

- `cardsRef` is owned and updated by the page. Both card-detail moves and drag
  handlers read that same current card map, including incoming socket changes.
- The hook mirrors lists and active-workflow lists in refs and keeps a separate
  snapshot of lists/cards at drag start. Failed persistence and outside drops
  restore that pre-drag snapshot, not an intermediate preview.
- A `card-container` drop target carries `listId`. Its droppable ID is not the
  database list ID. Preserve this distinction when modifying empty-list drops.
- Card collisions take priority over card-container collisions; list drags and
  missing pointer hits keep the existing closest-corners fallback.
- Cross-list previews update local state. The final drop computes fractional
  ordering and sends the original `card:move` or `list:move` payload.
- List ordering is calculated within the active workflow, while preserving the
  lists belonging to other workflows in the shared page state.
- `realtimeOrRest` stays in the page. The hook receives it, so both transport
  selection and fallback behavior remain unchanged. Successful writes retain
  activity updates; failed writes retain existing rollback/error feedback.
- The pointer activation threshold remains 6px and `DragOverlay` still uses
  `dropAnimation={null}` to avoid the previously observed measuring loop.

Do not relocate only half of an optimistic operation. Its snapshot, preview,
commit, and rollback must be reviewed together.

## Verification

From `client`, run `npm test`, `npm run lint`, and `npm run build`. From `server`,
run `npm test` for the existing permissions and collaboration regressions.

The added client tests cover empty-list drops with and without an intermediate
preview, populated-list ordering, no-op drops, outside drops, failed saves,
workflow-scoped list ordering, REST fallback payloads, fresh card refs, and collision
priority. Component tests cover custom/template creation, error retry, workflow
selection, permission-gated actions, filters, and GitHub panel callbacks.

Source comparison verified unchanged implementations for the existing extracted
and retained functions. Real-browser checks use isolated test accounts/MongoDB,
not development data, to exercise the assembled page and compare its desktop/mobile
layout with the pre-refactor page. The temporary browser harness is not committed.
GitHub network operations are covered with controlled component responses and the
existing server tests, not by changing a real GitHub repository connection.

## GitHub retry behavior

Repository, commit, and statistics auto-load effects stop when their error state
is set. Do not remove those guards: clearing `loading` after a failed request
otherwise immediately triggers another read. Ordinary failures require an explicit
Retry click; closing/reopening the panel does not retry them. Linking a different
repository clears the old commit/stat errors so its data can load normally.

The API wrapper retains `status`, `code`, `retryAfter`, and `resetAt` on errors.
`lib/githubRetry.js` converts GitHub rate limits into per-resource deadlines using
the later of Retry-After seconds and the reset timestamp. Missing or unusable
deadlines fall back to a one-minute pause. Deadlines stay in the page across panel
close/reopen; both loaders and buttons respect them. `useRetryCooldown` only wakes
the button at expiry, never schedules a request, and cleans up its timer on unmount.
An explicit successful read clears that resource's cooldown.

`boardGitHubRequests.test.jsx` mounts the real page under StrictMode with mocked
API/socket boundaries to check request counts, failures, manual recovery, cooldowns,
panel reopening, and repository changes. `githubRetry.test.jsx` covers the API
metadata, deadline parsing, and timer cleanup. Stale responses across project
navigation remain a separate audit item; this fix does not claim to address them.

## Next sensible extractions

The page is smaller, but it deliberately still coordinates the tightly coupled
live state. Future reviewable slices could extract:

1. A project GitHub data hook, moving its lazy-load flags, reset effects, and
   link/unlink/refresh operations together. Keep activity-feed updates explicit.
2. A project chat hook, moving message state, typing timers, pending/retry messages,
   unread behavior, and socket listeners together.
3. Project snapshot/socket coordination once those domain boundaries are stable.

Avoid replacing `BoardPage` with one equally large catch-all hook. Keep each
module responsible for a recognizable feature, and add tests before changing
effect dependencies, state ownership, or persistence behavior.
