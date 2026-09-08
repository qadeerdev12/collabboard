# My Tasks

`/my-tasks` shows cards assigned to the signed-in user across their current
projects. Desktop navigation exposes a My Tasks tab; mobile navigation includes
it in the user menu. Open tasks group into Overdue, Today, Upcoming, and No due
date. Completed tasks (`status: Done`) have a separate view. Search matches task,
project, and workflow names; the project filter applies within either view.

## Data and access

`GET /api/v1/tasks/mine` requires the existing JWT middleware. The server derives
the assignee from the authenticated user, never from query parameters, and
restricts the query to current project memberships. It returns `{ data: { tasks } }`
with project, workflow, and list labels plus task metadata and checklist progress.
The first version returns all assigned tasks; pagination should be introduced if
personal task volumes become large.

The page refreshes on mount, manual refresh, window focus, visibility changes,
and once per minute while visible. It does not join every project's socket room,
so viewing My Tasks does not create false project presence. Changes made by other
users are reflected on the next refresh, not instantly. Request sequence guards
prevent older responses or unmounted requests from replacing current data.

## Dates and navigation

Due dates follow the existing card date-input convention: their YYYY-MM-DD
portion represents a calendar date. Grouping uses the viewer's local current
date, preserving due dates across time zones and daylight-saving boundaries.
Checklist completion does not determine whether a task belongs in Completed.

Task links use `/boards/:boardId?card=:cardId`. After project loading and any
legacy workflow backfill, BoardPage selects the task's workflow and opens the
existing detail modal. It consumes the query parameter so subsequent updates
cannot reopen the modal. Deleted tasks show an unavailable message; inaccessible
projects retain the existing project access error.

## Manual review

- Assign cards across two projects and different workflows; check all date groups.
- Search, filter by project, and switch between Open and Completed.
- Open a task from a non-default workflow, edit it, and return to My Tasks.
- Check loading, empty, failed-request/retry, dark mode, and mobile navigation.
- Remove project membership and refresh; the project's tasks must disappear.
