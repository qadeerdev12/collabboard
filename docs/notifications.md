# Notifications: step 1, the data model

This step defines the shape of a notification and tests its validation rules.
No application code creates notifications yet. There are no notification routes,
event subscribers, Socket.IO changes, or frontend controls in this slice.

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

- The service will decide who receives a notification and skip self-notifications.
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

Next step: implement and test a notification creation service. Stop here for
review before adding that behavior.
