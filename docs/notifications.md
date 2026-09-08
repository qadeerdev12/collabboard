# Notifications: model, service, and internal events

Steps 1 and 2 define the notification schema and an internal creation service.
Step 3A registers an internal assignment subscriber during server startup.
Step 3B connects card creation and assignment changes to it through the shared
mutation service. Assignments now persist notifications. Step 4A exposes a
inbox read API. Step 4B adds marking one owned notification as read, and step 4C
adds marking all visible unread notifications as read. Step 5A adds the frontend
bell and inbox. Step 5B adds item navigation and read actions. Step 6A adds private
Socket.IO inbox-change signals on the server. The frontend does not consume those
signals yet; live refresh and reconnect handling belong to step 6B.

## Reading the model

`server/src/models/Notification.js` follows the existing Mongoose models.
A schema describes fields, defaults, validation rules, and database indexes.
`mongoose.model('Notification', notificationSchema)` creates the model that later
code can use to read and write the `notifications` collection.

| Field | Meaning | Example |
| --- | --- | --- |
| `recipient` | User whose inbox owns this notification | The task's assignee |
| `actor` | User who performed the action | The teammate who assigned it |
| `type` | Machine-readable event category | `card.assigned` |
| `board` | Project where it happened | Uptime Desk's Board ID |
| `card` | Task to open, when applicable | The assigned Card ID |
| `readAt` | Null for unread; a date for read | When the user reads it |
| `createdAt` | Automatically recorded creation time | Used for inbox ordering |
| `updatedAt` | Automatically recorded last update time | Changes when marked read |

Mongoose also gives each document an `_id`. `timestamps: true` manages
`createdAt` and `updatedAt` when documents are persisted through Mongoose.

`ObjectId` stores an identifier, not a copy of the user or task. `ref` tells
Mongoose which model to use for a later `populate()` call. It does **not** enforce
foreign keys, prove that the referenced document exists, or grant access.

The `type` enum accepts only `card.assigned`, `comment.created`, and `member.added`.
The first two require a card. A project membership notification does not need
one. The conditional `required` uses a regular function because Mongoose supplies
the document through `this`; an arrow function would not receive that binding.

We use `readAt` instead of both `isRead` and `readAt` so those two values cannot
disagree. Read state belongs to the recipient's notification, not the shared
project activity record.

## Why two indexes?

The planned inbox filters by `recipient` and sorts by `createdAt` descending,
then `_id` descending for stable ordering. The first compound index supports that
query. The second also includes `readAt` for unread queries (`readAt: null`).
An unread count can use the recipient/readAt prefix of that second index.
These are query optimizations, not authorization rules or duplicate prevention.
They are schema declarations here; no database migration is run by this step.

## Boundaries for later steps

- Future event handlers choose recipients; the service checks eligibility and
  skips self-notifications.
- The API must restrict reads and updates to the authenticated recipient.
- Project access must be checked before exposing or following task context.
- We must decide how deleted users, cards, projects, and removed memberships
  affect existing notifications before activating notification creation.
- Saving a document is separate from publishing an event or delivering a socket
  message. This schema alone provides neither delivery nor durable event handling.

## Review and verification

Read the model first, then `server/src/__tests__/notificationModel.test.js`.
The tests instantiate documents and call `validate()` without a database, so they
check schema defaults and validation only. They do not prove persistence, index
performance, permissions, or delivery; those need tests when implemented.

Run from `server`: `npm test -- src/__tests__/notificationModel.test.js`.

## Step 2: creation service walkthrough

Read `server/src/services/notificationService.js` from top to bottom:

1. `new Notification(...)` maps the function's arguments onto the model fields.
   This creates an in-memory document; it does not write to MongoDB.
2. `await notification.validate()` checks the schema rules. It also surfaces
   ID casting errors before we query the database. We reuse the enum and card
   requirement instead of repeating them in the service.
3. `.equals()` compares the recipient and actor ObjectIds by value. If they are
   the same user, return `null`: your own action should not notify you.
4. `getBoardIfMember()` reuses the project's existing access helper. A deleted
   project or removed recipient is no longer eligible, so return `null`.
5. `User.exists()` checks both referenced users. The two independent queries run
   together with `Promise.all`. Missing users cause an intentional skip, including
   cases where a membership still contains a deleted user's ID.
6. `Card.exists({ _id, board })` verifies that any supplied card still exists in
   the specified project. A missing or mismatched card also causes a skip.
7. `notification.save()` writes the document and supplies timestamps. The model
   defaults `readAt` to `null`. The function returns the saved document.

### Function contract

```js
const notification = await createNotification({
  recipientId: assigneeId,
  actorId: actingUserId,
  type: 'card.assigned',
  boardId,
  cardId,
});
```

| Result | Meaning | Future caller behavior |
| --- | --- | --- |
| Saved document | Notification persisted | May attempt live delivery |
| `null` | Self-action or stale/ineligible context | No delivery needed |
| Rejected promise | Invalid input or a database failure | Handle/report the error |

The service deliberately does not swallow database errors. Treating a failed
write as a normal skip would hide a broken notification pipeline.

This function is internal: its callers must authorize the original mutation and
derive event details from saved server data. It does not prove that an assignment
or comment happened, choose its recipients, or authorize the actor's mutation.
Repeated valid calls currently create separate notifications; retry deduplication
is not implemented in this step.

### Deleted records and concurrency

Creation skips users/projects/cards already missing when checked and recipients
whose membership has already been removed. These queries and the save are **not
one transaction**: records can change between a check and the write. Therefore
the future inbox API must check current access and tolerate missing references.
Already-saved notifications are retained on deletion/removal and may contain
dangling IDs. Step 4A applies current project access checks and safe handling of
missing references when reading them. Physical cleanup remains deferred; this
read endpoint neither deletes notifications nor alters their read state.

### Database tests

`server/src/__tests__/notificationService.test.js` uses a disposable local
MongoMemoryServer database, following the project's existing integration tests.
It does not load application environment variables or use the Atlas database.
Successful cases read records back from MongoDB; skipped and invalid cases assert
that no notification was written. One test simulates a failed save to verify that
the service propagates the error.

Run from `server`: `npm test -- src/__tests__/notificationService.test.js`.

## Step 3A: internal pub/sub

An event is a statement of something that happened. A publisher announces it;
subscribers choose which event names they want to handle. The publisher does not
need to import the notification service or know what an inbox document looks like.

### Read the event bus first

`server/src/events/eventBus.js` wraps Node's built-in `EventEmitter`:

1. `EVENTS.CARD_ASSIGNED` gives publishers and subscribers the same event name.
2. `createEventBus()` makes an isolated bus. The exported `appEvents` is the
   shared instance for this server process; tests use separate instances.
3. `subscribe(name, handler)` registers a function and returns a cleanup function.
4. `publish(name, payload)` takes a snapshot of handlers registered for that name.
5. Each handler runs inside `Promise.resolve().then(...)`, converting both a
   synchronous throw and an async rejection into a rejected promise.
6. `Promise.allSettled()` waits for all handlers, even if some fail. It returns
   `{ status: 'fulfilled', value }` or `{ status: 'rejected', reason }` per handler.
7. Failures are logged and results returned, instead of subscriber failures
   rejecting publication and making a future already-saved card update look failed.

Why not just use `emitter.emit()`? It calls listeners but does not await async
listeners' promises. This wrapper gives the publisher an explicit completion
point. Awaiting publication adds subscriber latency to the caller; it is not a
background job queue. A handler that never settles will keep publication pending.
Subscribers run concurrently and must not depend on each other's completion order.

### Then read the subscriber

`server/src/events/notificationSubscriber.js` subscribes to `card.assigned` and
maps `{ actorId, assigneeId, boardId, cardId }` to the creation service's arguments.
In particular, `assigneeId` becomes `recipientId`. The event name is fixed by the
subscriber rather than accepting an arbitrary notification type in the payload.

The subscriber returns the service promise so the bus can await it. A saved
document becomes a fulfilled result; an intentional skip becomes a fulfilled
`null`; a service failure becomes a rejected result collected by the bus.

Registration happens once after `connectDB()` in `server/src/index.js`, before
listening for requests. A WeakMap remembers each bus's cleanup function to make
setup idempotent. Cleanup removes the listener and is called when the HTTP server
closes. Cleanup affects future publications, not already-running handlers.

### Publisher call

```js
await appEvents.publish(EVENTS.CARD_ASSIGNED, {
  actorId,
  assigneeId,
  boardId,
  cardId,
});
```

Step 3B adds this at the successful assignment boundary using saved server data,
covering REST and Socket.IO without double publishing. The implementation below
distinguishes new assignments from unchanged or removed assignments.

### Guarantees and limits

- The bus exists only in one running Node process; it does not reach other server
  instances or the browser. Step 6A below adds a separate Socket.IO delivery path.
- There is no durable queue, replay, retry, or event deduplication. An event with
  no current subscribers returns an empty result array and is not retained.
- A crash before notification persistence can lose the notification. Database
  persistence protects a notification only after its write succeeds.
- Registering twice is prevented; publishing the same event twice can still
  create two notifications. Those are separate problems.
- This internal event bus is not an authorization boundary. It must receive
  trusted event data from authorized server mutations, never arbitrary client events.

### Tests and review checkpoint

`eventBus.test.js` verifies event routing, awaiting async work, isolating failures,
unsubscribe behavior, and the absence of replay. `notificationSubscriber.test.js`
uses a mocked creation service to verify payload mapping, duplicate setup/cleanup,
skips, and failures. Actual persistence remains covered by the step 2 tests.

Run from `server`:

```sh
npm test -- src/__tests__/eventBus.test.js src/__tests__/notificationSubscriber.test.js
```

At the step 3A checkpoint, no real assignments published yet. Step 3B below
connects those publishers; the frontend remains unchanged.

## Step 3B: publishing real assignments

The same shared `boardMutationService.js` handles REST and Socket.IO card writes.
Publishing there means each successful mutation publishes at most one assignment
event; transport controllers do not publish a second copy.

### Follow the code

1. `cardController.js` passes `req.user._id` as `actorId`; `socket.js` passes
   `socket.data.user._id`. Both IDs come from authentication, not client input.
2. `createCard()` validates and saves the card, then publishes if the saved card
   has an assignee. The payload carries the saved card/project/assignee IDs.
3. `updateCard()` validates fields as before. When an assignee is supplied, its
   atomic `findOneAndUpdate()` requests `returnDocument: 'before'`.
4. That pre-write document contains the assignee immediately before this exact
   write. Compare that value to the saved assignment, and publish only if the new
   value is non-null and different.
5. The bus awaits the subscriber, which calls the creation service. The service
   still skips self-notifications and stale/ineligible references.
6. The mutation returns its card result as before, and REST/Socket.IO continues
   with activity recording and its normal response/broadcast behavior.

### Why return the old document?

Reading the old assignee with a separate `findOne()` is vulnerable to a race:
two requests could both read "unassigned", both assign Sam, and both publish.
Returning the old value from the atomic write means the second identical
assignment sees Sam already assigned and does not publish.

The assignment branch explicitly writes `updatedAt` and disables automatic
timestamps for that one operation. It then applies the validated saved fields
to the returned pre-write document in memory, producing the card response for
that exact write. `.set(savedFields)` is **not** another save. This avoids a
second read that could accidentally return a different concurrent mutation.
Other card updates retain their existing return-after behavior.

| Mutation | Publish assignment event? | Save notification? |
| --- | --- | --- |
| Create a card assigned to a teammate | Yes | If eligible |
| Change unassigned to a teammate | Yes | If eligible |
| Change teammate A to teammate B | Yes, for B | If eligible |
| Save the same assignee again | No | No |
| Remove the assignee | No | No |
| Edit title, description, checklist, or position only | No | No |
| Assign yourself | Yes | No: service skips it |
| Validation, authorization, or card write fails | No | No |

### Failures and current limitations

The card write completes before publication. A rejected notification save is
collected and logged by the bus, so that failure does not turn the successful
assignment into a failed REST response or socket acknowledgement. It is not
automatically retried. Awaiting the subscriber still adds latency to the mutation.

This is not a transaction across card writes and notifications. A process crash
between them can lose a notification; later reassignments can also make a saved
notification historical rather than current. Atomic comparison prevents duplicate
events for concurrent identical assignments, not general exactly-once delivery.
Retained notifications and deleted references are handled by the read-time policy
in step 4A. Lifecycle cleanup remains separate work.

### Verification and review checkpoint

The assignment notification tests in `permissions.test.js` register the real
subscriber and exercise both REST and Socket.IO against the isolated database.
They cover creation, reassignment, no-op updates, unassignment, self-actions,
validation failures, concurrent identical assignments, authenticated actor identity,
and card success despite failed notification persistence. Existing permission
tests continue to verify unauthorized mutations are rejected.

Run `npm test` from `server` for the full suite. There is still no bell to test
in the UI. The step 3B checkpoint ends here; step 4A adds the read API below.

## Step 4A: read-only inbox API

```http
GET /api/v1/notifications?limit=20
Authorization: Bearer <your existing session token>
```

The response has the usual application envelope:

```json
{
  "data": {
    "notifications": [],
    "unreadCount": 0,
    "nextCursor": null
  }
}
```

Each notification contains `_id`, `type`, `createdAt`, `readAt`, project context
as `board: { _id, name }`, and nullable `actor: { _id, name }` and
`card: { _id, title }`. Email addresses, passwords, membership lists, and task
descriptions are not returned. Responses use `Cache-Control: no-store`.

### Read the code in request order

1. `notificationRoutes.js` runs `protect` before the controller. Missing or invalid
   credentials receive 401, using the existing authentication middleware.
2. `notificationController.js` supplies `req.user._id` as the recipient. A client
   cannot choose another recipient with query parameters. Only `limit` and
   `cursor` are forwarded to the query service.
3. `notificationInboxService.js` validates pagination, then runs an aggregation:
   - `$match` restricts notifications to the authenticated recipient.
   - `$lookup` finds the referenced project only if that recipient is still a member.
   - `$unwind` discards notifications with no accessible project match.
   - `$facet` sends the same access-filtered input into two branches: count all
     unread records, and select the requested page.
   - Page-only lookups add minimal actor and card context. Card lookup requires
     both the card ID and matching project ID, preventing cross-project details.
4. The controller returns the result. Validation errors receive 400; unexpected
   database failures receive a generic 500 message.

Aggregation pipelines do not automatically cast string IDs as Mongoose `find()`
queries do, so the query explicitly converts the authenticated ID to an ObjectId.
The access check occurs inside the database query, before pagination and counting;
filtering hidden notifications after fetching a page would create short pages
and an inaccurate or privacy-leaking unread count.

### Pagination contract

- `limit` defaults to 20 and must be an integer between 1 and 50.
- Results sort by `createdAt` descending, then `_id` descending to break ties.
- Pass the returned `nextCursor` unchanged as `cursor` for the next page.
- The cursor encodes the last returned creation timestamp and ID as base64url
  JSON. It is an ordering boundary, not a secret, signature, or authorization token.
- The service fetches one extra record to decide whether another page exists.
  `nextCursor: null` means no further records were visible at query time.
- The next-page condition is an older timestamp OR the same timestamp with a
  smaller ID. New notifications do not shift previously returned records as they
  can with offset/skip pagination. Refresh page one to see new arrivals.
- `unreadCount` covers the entire currently visible inbox, not only the page and
  not only records older than the cursor. It may change between requests.

The existing recipient index helps narrow the input. Access joins and the facet
still process the recipient's notification history; this is not constant-time
pagination or counting. Revisit retention/query performance if histories grow large.

### Missing-reference policy

| Condition | Inbox behavior | Unread count |
| --- | --- | --- |
| Different recipient | Excluded | Excluded |
| Deleted project | Excluded | Excluded |
| Recipient left/was removed from project | Excluded | Excluded |
| Deleted task, accessible project | Retain history; `card: null` | Count if unread |
| Card belongs to another project | Retain history; `card: null` | Count if unread |
| Deleted actor | Retain history; `actor: null` | Count if unread |
| Project membership notification | `card: null` is normal | Count if unread |

The future frontend must show fallback text for a missing actor and must not
render a task link when `card` is null. Project links still use the returned board.
Returned names/titles reflect current records, not immutable event-time snapshots.
Access can change after a response; opening the project/card must still enforce
the normal access checks. Read-time filtering does not physically purge records;
if a recipient rejoins a project, retained notifications can become visible again.

### Verification and checkpoint

`notificationInbox.test.js` exercises the real authenticated endpoint against
isolated MongoDB. It tests empty results, recipient isolation, minimal response
fields, global unread counts, tied timestamps, inserts between pages, lost project
access, missing actors/cards, cross-project references, invalid pagination, and
database error handling. GET is verified not to mark notifications as read.

Run `npm test -- src/__tests__/notificationInbox.test.js` from `server` for this
slice, or `npm test` for the full server suite. No frontend changes are included.
Stop for review here. Step 4B will mark one owned notification as read; step 4C
will handle marking all as read.

## Step 4B: mark one notification as read

```http
PATCH /api/v1/notifications/:notificationId/read
Authorization: Bearer <your existing session token>
```

No request body is needed. The server sets the timestamp, and ownership always
comes from authentication. Supplying `recipientId` or `readAt` in the body does
not override those values. A successful response contains only the update needed
by the future frontend:

```json
{
  "data": {
    "notification": {
      "_id": "<notification id>",
      "readAt": "2026-09-08T12:00:00.000Z"
    }
  }
}
```

### Code walkthrough

1. `notificationRoutes.js` applies `protect` and calls `readNotification()`.
2. The controller passes the authenticated user ID and route notification ID
   to `markNotificationRead()` in `notificationInboxService.js`.
3. The service validates the ID, then finds a notification using **both** its ID
   and recipient. It checks current project membership with `getBoardIfMember()`.
4. `findOneAndUpdate()` matches that same owner and notification with
   `readAt: null`. Only an unread notification can receive a new timestamp.
5. If no unread document matched, the service reads the existing timestamp and
   returns it without writing again. If the record has disappeared, it returns 404.

This is an idempotent operation: repeating a successful request preserves both
`readAt` and `updatedAt`. The atomic unread filter also handles simultaneous calls
from two tabs; only the first successful update writes the timestamp.

### Access and response behavior

- No authentication: 401. Malformed notification ID: 400.
- Missing notification, another recipient's notification, deleted project, or
  removed membership: the same generic 404 response, with no read-state change.
- Deleted actor/task: still markable when the notification's project is accessible,
  matching the retained-history policy of the GET endpoint.
- Database failure: generic 500 response, with details logged only on the server.
- GET never marks records read. A later GET reflects the updated unread count.
- The response omits an unread count; the future client can apply this item update
  and refresh the inbox count rather than relying on a second count query here.

Project membership is checked before the write, not in a cross-collection
transaction. A concurrent removal can race this check; the only resulting write
is to the user's own read state, and no project/task content is returned. Inbox
reads continue to apply current project access independently.

### Tests and checkpoint

The mark-one cases in `notificationInbox.test.js` exercise persistence, reduced
unread counts, untouched neighboring records, ignored client-supplied values,
repeat calls, concurrent calls, authentication/ownership, unavailable projects,
retained history, and failed writes. Run from `server`:

```sh
npm test -- src/__tests__/notificationInbox.test.js
```

Stop for code review here. The next slice is step 4C, marking all visible unread
notifications as read. There are still no frontend changes.

## Step 4C: mark all visible notifications as read

```http
PATCH /api/v1/notifications/read-all
Authorization: Bearer <your existing session token>
```

No body is needed. This updates the signed-in user's unread notifications across
all currently accessible projects, not just the current inbox page. The response
is `{ "data": { "modifiedCount": 3 } }`, where the count is the number of records
actually changed. Empty inboxes and repeats with no new unread items return zero.
Clients cannot override the recipient or timestamp through request parameters.

### Code walkthrough

1. The route authenticates the request, then `readAllNotifications()` forwards
   `req.user._id` to `markAllNotificationsRead()`.
2. The service selects IDs of projects where the recipient is currently a member.
3. It selects notification IDs matching that recipient, those projects, and
   `readAt: null`. These captured IDs define the operation's scope.
4. `updateMany()` uses the same filters plus those exact notification IDs, and
   sets a server-generated read timestamp. The unread filter prevents replacing
   a timestamp already written by a concurrent single-item or bulk read.
5. The controller returns `modifiedCount` with `Cache-Control: no-store`.

### Concurrency and access

Capturing IDs avoids marking a notification that arrives after selection as read.
Items arriving earlier, while the request is selecting candidates, may be included.
This is a database selection boundary, not the moment the user clicked a button.
The future frontend should refresh the inbox and unread count after success;
it must not assume the unread count became zero.

Already-read records preserve both `readAt` and `updatedAt`. Other recipients,
deleted projects, and projects with revoked membership at the access check are
excluded. Retained history with a deleted actor/task remains markable, matching
the inbox's visibility rules.

As with marking one item, project membership can change between its check and
the write. This is not a cross-collection transaction. Each document update is
atomic, but the whole bulk operation is not: a database failure can leave some
records updated. Retrying preserves successful timestamps and can finish the
remaining unread items; it can also include newly arrived items in that new call.
The endpoint returns a generic 500 for failures and logs the error server-side.

This first version captures IDs in memory and sends them with `$in`; it is
appropriate for the app's current scale. Large inbox histories will need bounded
batching or a revised bulk-read strategy to avoid oversized queries.

### Tests and checkpoint

The bulk cases in `notificationInbox.test.js` verify cross-project updates beyond
the default page size, ownership, inaccessible projects, unchanged read timestamps,
repeat/empty calls, deleted references, arrivals after selection, competing reads,
and failed writes. Run from `server`:

```sh
npm test -- src/__tests__/notificationInbox.test.js
```

The notification API now supports listing, marking one as read, and marking all
visible unread items as read. Stop for review and commit here. Step 5 will add
the frontend bell, unread badge, and inbox dropdown using these endpoints.

## Step 5A: read-only frontend inbox

The shared `AppHeader` now includes `NotificationBell` on Projects, My Tasks,
Activity, and Profile pages. The project board's custom header is not changed in
this slice. At the 5A checkpoint rows were read-only. Opening the dropdown still
does not mark records read; step 5B below adds explicit read actions and navigation.

### Follow the frontend code

1. `notificationApi.list()` in `client/src/lib/api.js` builds query parameters
   with `URLSearchParams` and uses the existing authenticated request wrapper.
2. `useNotificationInbox()` fetches page one on mount for the unread badge. Its
   `refresh()` replaces the list and refreshes the count when the bell opens or
   the user presses Refresh. There is no polling or Socket.IO subscription yet.
3. `loadMore()` sends `nextCursor`, appends new records without duplicate IDs,
   and adopts the count and next cursor from the response. A ref prevents two
   rapid clicks from requesting the same page concurrently.
4. Request generations distinguish old and new refreshes. A stale page response
   cannot overwrite a newer refresh; unmount invalidates pending responses.
5. `NotificationBell` displays the results. It remounts when the token or pathname
   changes, clearing private cached data and closing the previous page's dropdown.

### UI states and accessibility

- Positive unread counts appear on the bell, capped visually at `99+`. Its
  accessible label includes the exact count. Unknown/failed counts show no badge.
- Loading uses skeleton rows. Empty results show an empty inbox message.
- A failed first-page refresh hides stale rows and provides Retry. A failed
  next page retains already-loaded rows and provides Retry loading more.
- Read and unread rows have different styling and screen-reader labels.
- Missing actors use "Former member"; missing tasks use "Task no longer available".
- The panel has a labelled region, receives focus when opened, and returns focus
  to the bell on Escape or Close. Outside mouse clicks dismiss it. It is a
  nonmodal region, not an ARIA menu requiring menu-item keyboard behavior.
- The mobile panel fits the viewport; desktop anchors it under the bell. Its
  list scrolls within a bounded height, and titles wrap rather than overflow.
- Opening notifications closes the shared header's user menu.

The icons use `lucide-react`, the only added dependency. No backend routes changed.
The badge reflects the last completed fetch; it is not live until step 6.
Access is rechecked by the API on refresh, but visible rows are not continuously
monitored for membership changes while the panel remains open.

### Review and verification

Start with the API helper, then the hook, then the component, and finally its
`AppHeader` integration. Browser checks used isolated sample responses (no writes
to real notifications) to verify desktop/mobile layout, long text, missing
references, pagination, loading, empty/error states, retained rows on page failure,
the badge cap, and Escape focus restoration. Temporary preview files were removed.

Run `npm run lint` and `npm run build` from `client`. In the app, assign a task
to another account, then open that account's bell on a shared-header page to
verify the real notification appears. Opening it should leave unreadCount unchanged.
Pause for review and commit before 5B: navigation and mark-as-read controls.

## Step 5B: navigation and read actions

The shared-header inbox now supports three actions:

- Click a notification to mark it read, then open its task or project. Existing
  read notifications navigate without another PATCH request.
- Use the check icon to mark one notification read while staying in the inbox.
- Use Mark all as read for all accessible unread records, including other pages.

### Follow the code

1. `notificationApi.markRead()` and `markAllRead()` call the existing authenticated
   PATCH endpoints. The client supplies no recipient or read timestamp.
2. `useNotificationInbox.markRead(id)` locks concurrent read actions, invalidates
   older page requests, and awaits the PATCH. Omitting the ID selects mark-all.
3. Once the write succeeds, the hook refreshes page one and the unread count from
   the server. It does not guess a new count or mark every cached record read.
   This resets previously loaded pages and lets new arrivals remain unread.
4. A write failure leaves the existing rows intact and exposes an inline error.
   Controls become available again so the user can retry or refresh. No navigation
   follows a failed write. A write may have succeeded despite a lost response;
   the backend's idempotent endpoints make retrying safe for existing timestamps.
5. `NotificationBell.openNotification()` waits for read success before navigating
   to `/boards/:boardId?card=:cardId`. The existing BoardPage logic selects the
   correct workflow and opens its card detail modal.
6. Membership notifications and missing-card history navigate to the returned
   project instead. Missing actors retain the Former member fallback. Project
   access is enforced again by the destination API if permissions have changed.

### Async behavior

While a write is pending, row actions, mark-all, pagination, and refresh are
disabled. A ref also blocks duplicate clicks before React renders the disabled
state. Request generations prevent an older page load from replacing post-write
data. The component checks whether it is still mounted before navigating after
an async action, so changing pages or accounts cannot trigger a late redirect.

A successful PATCH followed by a failed refresh is still a successful write.
The hook shows its normal fetch error and hides an unknown unread count; Retry
reloads the inbox. An item-opening action can still navigate after that successful
PATCH. Mark-all never forces the badge to zero because newer records may remain
unread. Notifications only refresh through REST in this step, not live sockets.

### Review checks

Desktop/mobile checks used temporary sample responses to verify individual read
updates, global count refresh, new arrivals during mark-all, inline write failures
without navigation, task deep-link URLs, deleted-task project fallback, membership
project URLs, and disabled mark-all at zero unread. These checks exercise frontend
behavior, not a real signed-in end-to-end session. The temporary preview files
were removed after verification. Backend API behavior is covered by its existing
integration tests; no backend code changed in this slice.

Run `npm run lint` and `npm run build` from `client`. For the final user review,
assign a task from a second account, open its notification, and confirm that the
correct workflow/card opens and the read state persists after reloading.

Stop for review and commit here. Step 6 will add live delivery through personal
Socket.IO rooms; comment and membership publishers are still future steps.

## Step 6A: private server-side live delivery

This slice connects persisted notifications to Socket.IO. It does not change the
bell or create a frontend socket connection. There are two different event paths:

```text
Authorized REST/socket card assignment
  -> save card
  -> appEvents.publish('card.assigned', saved assignment facts)
  -> notification subscriber
  -> createNotification() validates eligibility and saves to MongoDB
  -> io.to('user:<saved recipient ID>').emit('notifications:changed', {})

Authenticated PATCH /notifications/:id/read or /notifications/read-all
  -> inbox service checks ownership/project access and writes readAt
  -> io.to('user:<authenticated user ID>').emit('notifications:changed', {})
```

`appEvents` is internal pub/sub between server modules. Socket.IO is the network
transport to connected clients. The event names and payloads are intentionally
different: internal assignment facts must not be forwarded to browsers.

### Follow the code

1. `socket.js` verifies the JWT and loads the user before the `connection` handler
   runs. That handler calls `socket.join(userRoomName(socket.data.user._id))`.
   Every authenticated connection joins its personal room automatically, without
   `board:join`. This also works for multiple tabs/devices for the same account.
2. `notificationDeliveryService.js` owns the room-name convention and the small
   `emitInboxChanged(io, recipientId)` helper. `io.to(room).emit(...)` includes all
   connected sockets in that room; it does not exclude the initiating tab.
3. `index.js` injects the real Socket.IO server when registering the subscriber:
   `registerNotificationSubscriber(appEvents, { io })`. Registration remains
   idempotent per bus and cleanup still runs when the HTTP server closes. The
   first registration owns that bus's options; it is not reconfigured by calling
   registration a second time. HTTP-only tests may omit `io`.
4. `notificationSubscriber.js` awaits `createNotification()`. A saved document
   triggers the helper using that document's recipient. A `null` eligibility skip
   or a rejected save sends nothing. The creation service stays transport-free.
5. `notificationController.js` signals after a successful read service call, using
   `req.user._id`. A repeated single-item read signals again without changing its
   original timestamp. Mark-all signals only when `modifiedCount > 0`. Validation,
   access, and database failures do not send a success signal.

### Socket contract and access boundaries

| Property | Contract |
| --- | --- |
| Direction | Server to client only |
| Event | `notifications:changed` |
| Payload | `{}` |
| Destination | `user:<authenticated recipient ID>` |
| Meaning | Cached inbox data may be stale; fetch it again |
| Read API | `GET /api/v1/notifications` with the client's own JWT |

No public `user:join` handler exists. Clients cannot select a recipient using
handshake fields, a socket event, or a PATCH body. Knowing a user ID is not
authorization. Board membership does not grant access to another user's room.
Socket.IO automatically removes disconnected sockets from their rooms; a new
connection authenticates and joins again.

The signal contains no notification ID, task title, actor, project details, or
unread count. The inbox API still filters by authenticated recipient and current
project membership. Even if access changes between saving and signaling, the
subsequent API request enforces current access before returning private content.

### Delivery limits and the next frontend slice

- Persistence remains the source of truth. Offline clients miss signals, not
  already-saved inbox records. Step 6B must fetch on connect/reconnect as well as
  on `notifications:changed`; Socket.IO does not replay these missed signals.
- No delivery acknowledgement, durable queue, retry, or exactly-once guarantee is
  added. The internal bus and default room adapter still run in one server process.
- Transport errors are logged and do not reverse a completed database write or
  turn a successful read PATCH into a 500. Notification-save failures still use
  the existing event bus error handling and do not fail a saved card assignment.
- An inbox-change signal is not one new notification. A read action can emit it,
  and repeated reads can emit it again. The client must refresh, not increment or
  decrement counts based on the event.
- The existing frontend still refreshes through its REST actions only. Step 6B
  will add an account-scoped listener and handle overlapping refresh/read requests
  without dropping changes or showing a connection toast.

### Tests and review checkpoint

`notificationSubscriber.test.js` proves that a pending save sends nothing, delivery
uses the stored recipient after the save resolves, skips/failures send nothing,
and transport errors preserve the saved result.

`notificationDelivery.test.js` uses a real Socket.IO server, multiple clients, and
an isolated MongoDB. It covers JWT rejection, spoofed identity fields, private-room
isolation, REST/socket assignments, multiple recipient tabs, read synchronization,
idempotent/no-op behavior, and write/transport failures. Ordered acknowledgement
sentinels in the test harness verify non-delivery without arbitrary sleep timers.
Existing inbox tests also exercise the HTTP-only path with no Socket.IO server.

Run from `server`:

```sh
npm test -- src/__tests__/notificationSubscriber.test.js src/__tests__/notificationDelivery.test.js src/__tests__/notificationInbox.test.js
npm test
```

Stop for review and commit here. Step 6B connects the frontend bell to this signal;
comment and membership publishers remain separate future iterations.
