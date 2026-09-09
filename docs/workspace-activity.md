# Workspace Activity

## Request flow

`ActivityPage` uses `activityApi.list` for `/activity`. The protected
`GET /api/v1/activities` endpoint delegates to `workspaceActivityService`:

1. Validate the page size and timestamp/ID cursor.
2. Fetch only project IDs/names where the authenticated user is a member.
3. Run one activity query across those IDs, ordered newest first, limited to one
   page plus a lookahead row. Populate actors in a batched query.
4. Attach project names and return the next cursor only when more rows exist.

This removes the browser's project-list request plus one activity request per
project. Database query count is fixed rather than proportional to project count;
membership metadata and query work still grow with the user's workspace.
The compound Activity index includes `(board, createdAt DESC, _id DESC)`.
Existing deployments should ensure that index is created; changing the schema
does not automatically remove the old `(board, createdAt)` index. No index
deletion or production migration is performed by this change.

## Client lifecycle

The activity session is keyed by project scope and token, so navigation/account
changes reset loaded rows and cursors. `useLatestRequest` ignores stale reads;
it does not cancel network requests. Load-more requests use an immediate ref guard
against duplicate clicks, retain rows/cursors on failure, and deduplicate appended
IDs. The project-specific activity page still uses its existing two endpoints.

Pagination is not a live snapshot. Reload to see newer events. Previously displayed
rows are not retroactively removed when membership changes; later requests recheck
access. Concurrent membership/deletion changes between database reads are not
serialized by this implementation.

## Regression checks

- `server/src/__tests__/workspaceActivity.test.js`: authentication, membership
  filtering, deleted references, stable cursors, limits, and generic server errors.
- `client/src/__tests__/activityPage.test.jsx`: one feed request, paging/retry,
  empty state, project route compatibility, and stale-session response protection.
