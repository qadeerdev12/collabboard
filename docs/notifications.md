# Notifications: data model and creation service

Steps 1 and 2 define the notification schema and an internal creation service.
The service can persist notifications, but no production action calls it yet.
There are no notification routes, event subscribers, Socket.IO changes, or
frontend controls in these slices.

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
Cleanup of already-saved notifications on deletion/removal is still deferred and
must be implemented or deliberately handled before enabling production triggers.

### Database tests

`server/src/__tests__/notificationService.test.js` uses a disposable local
MongoMemoryServer database, following the project's existing integration tests.
It does not load application environment variables or use the Atlas database.
Successful cases read records back from MongoDB; skipped and invalid cases assert
that no notification was written. One test simulates a failed save to verify that
the service propagates the error.

Run from `server`: `npm test -- src/__tests__/notificationService.test.js`.

Stop here for code review. Step 3 will connect a real assignment event to this
service, introducing the publisher and subscriber. There is no visible UI change
to test yet.
