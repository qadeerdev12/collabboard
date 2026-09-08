# 04 — API Specification

**Project:** SDLCFlow
**Status:** Draft v1.0

Defines the contract between client and server: the REST API (request/response work) and the Socket.IO event protocol (live updates). Building to this contract first means the front-end and back-end can be developed against a shared, stable interface.

---

## 1. Conventions

- **Base URL:** `/api/v1`
- **Auth:** `Authorization: Bearer <JWT>` header on all protected REST routes.
- **Content type:** `application/json`.
- **Success envelope:**
  ```json
  { "data": { /* ... */ } }
  ```
- **Error envelope:**
  ```json
  { "error": { "code": "FORBIDDEN", "message": "Members cannot delete boards." } }
  ```

### Status codes
| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Validation error |
| 401 | Missing/invalid token |
| 403 | Authenticated but not permitted (role) |
| 404 | Not found / not a member |
| 409 | Conflict (e.g. email already registered) |
| 500 | Server error |

> Note: requesting a board you're not a member of returns **404**, not 403 — we don't reveal that a board exists to non-members.

> Current implementation note: REST and Socket.IO mutations enforce board roles. Member management and board activity endpoints are implemented.

---

## 2. REST endpoints

### 2.1 Auth

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/register` | – | `{ name, email, password }` | `201 { user, token }` |
| POST | `/auth/login` | – | `{ email, password }` | `200 { user, token }` |
| GET | `/auth/me` | ✅ | – | `200 { user }` |
| GET | `/auth/profile` | ✅ | – | `200 { user, stats }` |
| PATCH | `/auth/profile` | ✅ | `{ name?, email? }` | `200 { user }` |
| PATCH | `/auth/password` | ✅ | `{ currentPassword, newPassword }` | `200 { updated: true }` |
| DELETE | `/auth/me` | ✅ | `{ password }` | `200 { deleted: true }` |

`user` never includes `passwordHash`.
Profile email updates reject duplicate emails with `409 EMAIL_TAKEN`. Password updates require the current password and a new password of at least 8 characters.
Deleting an account removes owned boards and their lists/cards/comments/activity, removes the user from shared boards, clears their card assignments, and deletes their comments/activity records.

### 2.2 Workflow templates

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/workflow-templates` | ✅ | – | `200 { templates }` |
| GET | `/board-templates` | ✅ | – | `200 { templates }` |

Workflow templates are read-only starter blueprints for project areas inside a
board. Each template includes display metadata plus list names and starter card
previews. `GET /board-templates` remains as a compatibility alias for the
current client and older integrations.

### 2.3 Integrations

#### GitHub account connection

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/integrations/github/start` | ✅ | – | `200 { authorizationUrl, scopes }` |
| GET | `/integrations/github/callback` | GitHub redirect | – | Redirects to client profile page |
| GET | `/integrations/github/account` | ✅ | – | `200 { account }` |
| DELETE | `/integrations/github/account` | ✅ | – | `200 { disconnected, revoked, unlinkedProjects }` |
| GET | `/integrations/github/dashboard` | ✅ | – | `200 { connected, account, stats, languages, commitGraph, linkedProjects }` |
| GET | `/integrations/github/repos` | ✅ | – | `200 { repositories, lastSyncedAt }` |

`GET /integrations/github/start` returns the authorization URL instead of
redirecting immediately because protected REST routes need the SDLCFlow JWT in
the `Authorization` header. The client should call this endpoint first, then set
`window.location` to `authorizationUrl`.

The OAuth callback validates a signed `state`, exchanges GitHub's temporary
`code` server-side, fetches the GitHub profile/email, and stores the encrypted
connection against the SDLCFlow user. The current MVP requests `read:user user:email repo`;
`repo` is required so private and public repositories can appear in the project
repo picker. Existing GitHub connections made before repo access was introduced
must reconnect before `GET /integrations/github/repos` can return repository
data.
Disconnecting makes a best-effort token revoke call to GitHub, removes
SDLCFlow's stored GitHub connection, and unlinks projects that depended on that
account. GitHub rate limits return `429 GITHUB_RATE_LIMITED` with retry metadata
when GitHub provides it.
The GitHub dashboard endpoint combines the user's connected GitHub account,
visible repositories, language counts, commit contribution totals for today,
the current week, and the current year, daily contribution buckets for graph
options, plus project-level repository links for projects where the user is
still a member.

`repositories` are normalized to safe picker fields: `id`, `name`, `fullName`,
`owner`, `private`, `htmlUrl`, `description`, `defaultBranch`, `language`, and
`updatedAt`.

#### Project GitHub repository

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards/:boardId/integrations/github` | member | – | `200 { integration }` |
| PUT | `/boards/:boardId/integrations/github` | admin | `{ id/repoId, fullName/repoFullName, htmlUrl/repoUrl, owner/repoOwner?, name/repoName?, defaultBranch?, private?, language? }` | `200 { integration, activity }` |
| DELETE | `/boards/:boardId/integrations/github` | admin | – | `200 { unlinked, integration: null, activity }` |
| GET | `/boards/:boardId/github/commits` | member | – | `200 { integration, commits, activities, lastSyncedAt }` |
| GET | `/boards/:boardId/github/stats` | member | – | `200 { integration, stats, lastSyncedAt }` |

Project GitHub integrations link one repository to one board/project. Members
can view the linked repo; owners/admins can link, change, or unlink it. The
linking user must have a connected GitHub account. `PUT` accepts the normalized
repository object returned by `GET /integrations/github/repos`, using either
`fullName/htmlUrl/id` or the server names `repoFullName/repoUrl/repoId`.
Linking and unlinking repositories creates project activity records.
Members can load recent commits for the linked repository. Commit reads use the
GitHub token associated with the linked repository, so collaborators do not need
their own GitHub connection just to view project commit activity. Newly seen
commits are recorded as `github.commit_synced` activity entries, deduped by
commit SHA so refreshes do not flood the project timeline.
Repository stats currently include `openPullRequests` and `openIssues`, also
using the linked repository token.

### 2.4 Boards

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards` | member | – | `200 { boards: [...] }` (boards I belong to) |
| POST | `/boards` | any auth | `{ name, emoji?, color? }` | `201 { board, workflows, lists, cards }` (creator becomes owner) |
| GET | `/boards/:boardId` | member | – | `200 { board, workflows, lists, cards }` (full initial load) |
| PATCH | `/boards/:boardId` | admin | `{ name?, emoji?, color? }` | `200 { board, activity }` |
| DELETE | `/boards/:boardId` | owner | – | `200 { deleted: true }` |

Every board is a project container. `POST /boards` creates the default
`General` workflow and returns empty `lists` and `cards` arrays. Workflow
templates are added later through `POST /boards/:boardId/workflows`, which keeps
project identity separate from project structure. Older boards are backfilled
with the default workflow the first time they are loaded, and any legacy
lists/cards without a workflow are attached to that default.

### 2.5 Workflows

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards/:boardId/workflows` | member | – | `200 { workflows }` |
| POST | `/boards/:boardId/workflows` | admin | `{ name?, position?, workflowTemplateId?, templateId?, templateKey?, icon?, color? }` | `201 { workflow, lists, cards, activity }` |

Workflows are top-level project areas inside a board, such as a release plan,
software sprint, bug triage, roadmap, or a custom planning track. This is the
foundation for treating a board as a project and grouping several workflow
templates under it. New projects get a default `General` workflow, and older
boards use lazy backfill. Lists/cards are workflow-aware on create and board
snapshots include all workflows plus all board work so the client can switch
between project areas without reloading.

When `workflowTemplateId` is provided to `POST /boards/:boardId/workflows`, the
server creates a new workflow from that template and seeds its lists/cards.
`templateId` is accepted as a compatibility alias. If no template id is provided,
the route creates an empty custom workflow from the supplied name/metadata.

Implementation note: `List` and `Card` now include optional `workflow`
references. They remain nullable at the schema level during the compatibility
migration, but board creation and board loading backfill missing references to
the default workflow before returning work items to the client.

### 2.6 Members

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards/:boardId/members` | member | – | `200 { members }` |
| POST | `/boards/:boardId/members` | admin | `{ email, role? }` | `201 { members, activity }` |
| PATCH | `/boards/:boardId/members/:userId` | owner | `{ role }` | `200 { members, activity }` |
| DELETE | `/boards/:boardId/members/:userId` | admin | – | `200 { members, activity }` |

Member rules:
- Owners and admins can add members.
- Admins can only add regular members; owners can add members or admins.
- Only owners can change roles.
- Ownership transfer is not available yet.
- Admins cannot remove owners.
- A board must keep at least one owner.

### 2.7 Activity

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards/:boardId/activities` | member | – | `200 { activities }` |

Activity records store `actor`, `action`, `targetType`, `targetId`, `targetTitle`, optional `metadata`, and timestamps. The endpoint returns the latest board activity first.

### 2.8 Project chat

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards/:boardId/messages` | member | – | `200 { messages }` |
| POST | `/boards/:boardId/messages` | member | `{ body }` | `201 { message }` |
| DELETE | `/boards/:boardId/messages/:messageId` | member/owner/admin | – | `200 { message, activity }` |
| DELETE | `/boards/:boardId/messages` | owner | – | `200 { deletedCount, activity }` |

Messages are scoped to a board and populated with `sender { name, email }`.
Members, admins, and owners can delete only messages they sent. Deleted messages
remain as placeholders with `deletedAt/deletedBy`, so open clients keep a stable
conversation shape. Owners can clear the full board chat; cleared messages are
hidden from future history loads. Normal chat is stored separately from activity
so conversation does not flood the audit timeline, but moderation actions create
activity records.

### 2.9 Lists

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| POST | `/boards/:boardId/lists` | member | `{ title, position, workflowId? }` | `201 { list, activity }` |
| PATCH | `/boards/:boardId/lists/:listId` | member | `{ title?, position? }` | `200 { list, activity }` |
| DELETE | `/boards/:boardId/lists/:listId` | member | – | `200 { deleted: true, activity }` |

If `workflowId` is omitted, new lists are created in the board's first workflow.
For new projects that is `General`; if additional workflows are added later, the
client should pass the active `workflowId`. If provided, the workflow must belong to the board.
List workflow reassignment is not supported yet; `PATCH` rejects direct
`workflow` or `workflowId` changes so cards do not silently jump between project
areas.

### 2.10 Cards

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| POST | `/boards/:boardId/cards` | member | `{ listId, title, position, workflowId?, tag?, status?, assignee?, dueDate? }` | `201 { card, activity }` |
| PATCH | `/boards/:boardId/cards/:cardId` | member | `{ title?, description?, tag?, status?, assignee?, dueDate?, githubUrl?, list?, position? }` | `200 { card, activity }` |
| DELETE | `/boards/:boardId/cards/:cardId` | member | – | `200 { deleted: true, activity }` |

> Card **move** = a `PATCH` changing `list` and/or `position`. The same operation is also available over sockets (below) for low-latency drags; both paths run the same service function.
> `assignee` must be `null`, empty, or a user id that already belongs to the board. `dueDate` accepts an ISO date/date-time string or `null`.
> `githubUrl` is optional and must be empty or a valid `github.com` URL. It can point to a repository, issue, pull request, or commit.
> If `workflowId` is omitted, the card inherits the target list's workflow. If
> provided, it must belong to the board and match the target list's workflow.
> Card moves are constrained to the card's current workflow. Direct
> `workflow`/`workflowId` updates are rejected until the UI supports an explicit
> cross-workflow move.

### 2.11 Comments

| Method | Path | Min role | Body | Returns |
|---|---|---|---|---|
| GET | `/boards/:boardId/cards/:cardId/comments` | member | – | `200 { comments }` |
| POST | `/boards/:boardId/cards/:cardId/comments` | member | `{ body }` | `201 { comment, activity }` |

Comments are scoped by both board and card. The server verifies board membership first, then verifies the card belongs to that board before reading or writing comments.

---

## 3. Socket.IO protocol

### 3.1 Connection & auth
Client connects with the JWT in the handshake:
```js
io(SERVER_URL, { auth: { token } });
```
Server middleware verifies the token on `connection`; invalid tokens are rejected before any events are processed.

### 3.2 Rooms
A client explicitly joins `board:<boardId>` for an open board. Membership is
verified on join; mutations additionally verify the caller's role.

Every authenticated socket also automatically joins `user:<userId>`, using the
user loaded by JWT middleware. There is no client-selectable personal-room join
event. This room carries private inbox invalidation signals, independently of
board subscriptions, and includes all connected tabs/devices for that user.

### 3.3 Client → Server events
Each emits with an **ack callback** so the client knows the result.

All mutation acks use this envelope:

```json
{ "ok": true, "data": { } }
```

Errors use:

```json
{ "ok": false, "error": { "code": "VALIDATION", "message": "..." } }
```

| Event | Payload | Server action | Ack data |
|---|---|---|---|
| `board:join` | `{ boardId }` | verify membership → join room | `{ boardId, presence }` |
| `card:create` | `{ boardId, listId, title, position, workflowId?, tag?, status?, assignee?, dueDate? }` | verify membership, persist, broadcast | `{ card, activity }` |
| `card:move` | `{ boardId, cardId, list, position }` | verify membership, persist, broadcast | `{ card, activity }` |
| `card:update` | `{ boardId, cardId, updates }` | verify membership, persist, broadcast | `{ card, activity }` |
| `card:delete` | `{ boardId, cardId }` | verify membership, persist, broadcast | `{ deleted: true, activity }` |
| `comment:create` | `{ boardId, cardId, body }` | verify membership, persist, broadcast | `{ comment, activity }` |
| `message:create` | `{ boardId, body }` | verify membership, persist, broadcast | `{ message }` |
| `chat:typing` | `{ boardId, typing }` | verify membership, broadcast ephemeral status | `{ typing }` |
| `message:delete` | `{ boardId, messageId }` | verify role/ownership, soft-delete, broadcast | `{ message, activity }` |
| `chat:clear` | `{ boardId }` | verify owner, clear visible history, broadcast | `{ deletedCount, activity }` |
| `list:create` | `{ boardId, title, position, workflowId? }` | verify membership, persist, broadcast | `{ list, activity }` |
| `list:move` | `{ boardId, listId, position }` | verify membership, persist, broadcast | `{ list, activity }` |
| `list:update` | `{ boardId, listId, updates }` | verify membership, persist, broadcast | `{ list, activity }` |
| `list:delete` | `{ boardId, listId }` | verify membership, persist, broadcast | `{ deleted: true, activity }` |

### 3.4 Server → Client events (broadcast to the board room)

| Event | Payload | Meaning |
|---|---|---|
| `card:created` | `{ boardId, card }` | a card was added |
| `card:moved` | `{ boardId, card }` | a card moved |
| `card:updated` | `{ boardId, card }` | a card's fields changed |
| `card:deleted` | `{ boardId, cardId }` | a card was removed |
| `comment:created` | `{ boardId, cardId, comment }` | a card comment was added |
| `message:created` | `{ boardId, message }` | a board chat message was added |
| `chat:typing` | `{ boardId, user, typing }` | a board member started or stopped typing |
| `message:deleted` | `{ boardId, message }` | a board chat message was deleted |
| `chat:cleared` | `{ boardId, deletedCount }` | visible board chat history was cleared |
| `list:created` | `{ boardId, list }` | a list was added |
| `list:moved` | `{ boardId, list }` | a list moved |
| `list:updated` | `{ boardId, list }` | a list changed |
| `list:deleted` | `{ boardId, listId }` | a list was removed |
| `workflow:created` | `{ boardId, workflow, lists, cards }` | a workflow and any seeded work items were added through REST |
| `members:updated` | `{ boardId, members }` | board membership changed |
| `activity:created` | `{ boardId, activity }` | a board activity record was added |
| `presence:update` | `{ boardId, users: [{ user, socketCount, lastSeen }] }` | who is currently on the board |
| `board:error` | `{ code, message }` | a server-side problem with a prior event sent without ack |

### 3.5 Ordering of guarantees
- Server **persists before broadcasting** (system-design §3).
- Socket mutation broadcasts exclude the originating socket (it already applied the change optimistically).
- REST-triggered broadcasts, such as `workflow:created` and `members:updated`, do not have an originating socket; clients merge them by id so the requester does not see duplicate data.
- On any failure, the server NACKs the sender via ack and broadcasts nothing.

### 3.6 Private inbox signals

These have a separate contract from the board broadcasts above:

| Event | Payload | Destination | Meaning |
|---|---|---|---|
| `notifications:changed` | `{}` | `user:<recipientId>` | The recipient's cached inbox may be stale |

The assignment subscriber emits after saving an eligible notification. Read
controllers emit after a successful single read (including idempotent retries)
or a bulk read that changed at least one record. Failed writes and skipped
notification creations emit nothing. All of the user's sockets receive the
signal, including the tab initiating a read; board peers do not receive it.

No private task data or counts travel in this signal. Clients must re-fetch
`GET /api/v1/notifications`, which checks recipient ownership and current project
access. Signals are best-effort, not replayed, and have no acknowledgement.
Transport failure does not fail an already-persisted notification or read action.
Clients must also fetch on connect/reconnect to recover missed changes.

The backend contract is implemented in step 6A; the frontend listener and reconnect
refresh are deferred to step 6B. See [the notifications walkthrough](notifications.md#step-6a-private-server-side-live-delivery).

---

## 4. Example: a card move end-to-end

1. User drags card → client updates UI optimistically.
2. Client emits `card:move { boardId, cardId, list, position }` with ack.
3. Server verifies JWT, board membership, role; computes/accepts the fractional `position`; updates the card document.
4. Server acks `{ ok: true }` to sender → sender keeps the change.
5. Server broadcasts `card:moved` to the rest of `board:<boardId>` → their UIs update.
6. If step 3 fails, server acks `{ ok: false, error }` → sender rolls back; no broadcast.
