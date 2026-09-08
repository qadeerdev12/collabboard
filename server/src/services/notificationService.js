import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Card from '../models/Card.js';
import { getBoardIfMember } from '../utils/boardAccess.js';

// Internal service for trusted event handlers, not a replacement for mutation
// authorization. Returns a saved document, or null when delivery is ineligible.
// Validation and database errors propagate so callers can report real failures.
export async function createNotification({ recipientId, actorId, type, boardId, cardId }) {
  const notification = new Notification({
    recipient: recipientId,
    actor: actorId,
    type,
    board: boardId,
    card: cardId,
  });

  // Validate and cast IDs before comparing them or querying referenced records.
  // This reuses the model's enum and conditional card requirement.
  await notification.validate();
  if (notification.recipient.equals(notification.actor)) return null;

  const board = await getBoardIfMember(notification.board, notification.recipient);
  if (!board) return null;

  // Membership may retain a stale user ID. A Mongoose ref does not prove that
  // either user still exists, so explicitly check before creating the record.
  const [recipient, actor] = await Promise.all([
    User.exists({ _id: notification.recipient }),
    User.exists({ _id: notification.actor }),
  ]);
  if (!recipient || !actor) return null;

  if (notification.card) {
    const card = await Card.exists({ _id: notification.card, board: notification.board });
    if (!card) return null;
  }

  // readAt defaults to null; save supplies timestamps and persists the document.
  // No socket delivery happens here. A future subscriber will use this result.
  return notification.save();
}
