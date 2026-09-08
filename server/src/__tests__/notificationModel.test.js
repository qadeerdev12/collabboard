import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import Notification from '../models/Notification.js';

function notificationData(overrides = {}) {
  return {
    recipient: new mongoose.Types.ObjectId(),
    actor: new mongoose.Types.ObjectId(),
    board: new mongoose.Types.ObjectId(),
    card: new mongoose.Types.ObjectId(),
    type: 'card.assigned',
    ...overrides,
  };
}

// validate() exercises Mongoose's document rules without connecting to MongoDB.
// Persistence, permissions, and delivery will be tested with their later slices.
describe('Notification model', () => {
  it('starts an assignment notification unread', async () => {
    const notification = new Notification(notificationData());
    await expect(notification.validate()).resolves.toBeUndefined();
    expect(notification.readAt).toBeNull();
  });

  it.each(['recipient', 'actor', 'board', 'type'])(
    'requires %s', async (field) => {
      const notification = new Notification(notificationData({ [field]: undefined }));
      await expect(notification.validate()).rejects.toHaveProperty(`errors.${field}.kind`, 'required');
    }
  );

  it('rejects unknown event types', async () => {
    const notification = new Notification(notificationData({ type: 'card.unknown' }));
    await expect(notification.validate()).rejects.toHaveProperty('errors.type.kind', 'enum');
  });

  it.each(['card.assigned', 'comment.created'])(
    'requires a card for %s', async (type) => {
      const notification = new Notification(notificationData({ type, card: null }));
      await expect(notification.validate()).rejects.toHaveProperty('errors.card.kind', 'required');
    }
  );

  it('allows a project membership notification without a card', async () => {
    const notification = new Notification(notificationData({ type: 'member.added', card: undefined }));
    await expect(notification.validate()).resolves.toBeUndefined();
    expect(notification.card).toBeNull();
  });

  it('accepts a read timestamp and can return to unread', async () => {
    const readAt = new Date('2026-09-08T10:00:00.000Z');
    const notification = new Notification(notificationData({ readAt }));
    await expect(notification.validate()).resolves.toBeUndefined();
    expect(notification.readAt).toEqual(readAt);
    notification.readAt = null;
    await expect(notification.validate()).resolves.toBeUndefined();
    expect(notification.readAt).toBeNull();
  });

  it('rejects malformed user IDs and read timestamps', async () => {
    const notification = new Notification(notificationData({ recipient: 'not-an-id', readAt: 'not-a-date' }));
    await expect(notification.validate()).rejects.toMatchObject({
      errors: { recipient: { name: 'CastError' }, readAt: { name: 'CastError' } },
    });
  });
});
