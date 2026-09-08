import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Board from '../models/Board.js';
import List from '../models/List.js';
import Card from '../models/Card.js';
import { createNotification } from '../services/notificationService.js';

let mongo;

beforeAll(async () => {
  // This suite never loads the application's .env or connects to Atlas.
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Notification, User, Board, List, Card].map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function fixture() {
  // Authentication is outside this service; these users only need valid records.
  const [actor, recipient] = await User.create([
    { name: 'Alex', email: 'alex@example.com', passwordHash: 'unused-test-hash' },
    { name: 'Sam', email: 'sam@example.com', passwordHash: 'unused-test-hash' },
  ]);
  const board = await Board.create({
    name: 'Uptime Desk', owner: actor._id,
    members: [{ user: actor._id, role: 'owner' }, { user: recipient._id, role: 'member' }],
  });
  const list = await List.create({ board: board._id, title: 'Todo', position: 1000 });
  const card = await Card.create({
    board: board._id, list: list._id, title: 'Write API tests',
    assignee: recipient._id, position: 1000,
  });
  return {
    recipientId: recipient._id, actorId: actor._id,
    boardId: board._id, cardId: card._id, type: 'card.assigned',
  };
}

describe('createNotification', () => {
  it.each(['card.assigned', 'comment.created', 'member.added'])(
    'persists an unread %s notification and returns its saved document', async (type) => {
      const input = await fixture();
      input.type = type;
      if (type === 'member.added') delete input.cardId;
      const result = await createNotification(input);
      expect(result.isNew).toBe(false);
      // Read back from MongoDB, not just from the returned in-memory instance.
      const persisted = await Notification.findById(result._id).lean();
      expect(persisted).toMatchObject({
        recipient: input.recipientId, actor: input.actorId, board: input.boardId,
        card: input.cardId || null, type, readAt: null,
        createdAt: expect.any(Date), updatedAt: expect.any(Date),
      });
      expect(await Notification.countDocuments()).toBe(1);
    }
  );

  it('skips self-notifications even when one ID is a string and the other is an ObjectId', async () => {
    const input = await fixture();
    input.actorId = input.recipientId.toString();
    expect(await createNotification(input)).toBeNull();
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('skips recipients who are no longer project members', async () => {
    const input = await fixture();
    await Board.updateOne({ _id: input.boardId }, { $pull: { members: { user: input.recipientId } } });
    expect(await createNotification(input)).toBeNull();
    expect(await Notification.countDocuments()).toBe(0);
  });

  it.each(['actorId', 'recipientId', 'boardId', 'cardId'])(
    'skips a deleted record referenced by %s', async (field) => {
      const input = await fixture();
      const model = field === 'boardId' ? Board : field === 'cardId' ? Card : User;
      await model.deleteOne({ _id: input[field] });
      expect(await createNotification(input)).toBeNull();
      expect(await Notification.countDocuments()).toBe(0);
    }
  );

  it('skips a card from a different project even when the recipient belongs to both', async () => {
    const input = await fixture();
    const otherBoard = await Board.create({
      name: 'Another project', owner: input.actorId,
      members: [{ user: input.actorId, role: 'owner' }, { user: input.recipientId, role: 'member' }],
    });
    expect(await createNotification({ ...input, boardId: otherBoard._id })).toBeNull();
    expect(await Notification.countDocuments()).toBe(0);
  });

  it.each([
    { recipientId: 'invalid-id' },
    { type: 'unknown.event' },
    { cardId: undefined },
  ])('throws for malformed input rather than silently skipping it: %j', async (override) => {
    const input = await fixture();
    await expect(createNotification({ ...input, ...override })).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('propagates a failed save rather than reporting a skipped notification', async () => {
    const input = await fixture();
    const failure = new Error('Database unavailable');
    vi.spyOn(Notification.prototype, 'save').mockRejectedValueOnce(failure);
    await expect(createNotification(input)).rejects.toBe(failure);
    expect(await Notification.countDocuments()).toBe(0);
  });
});
