import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import Notification from '../models/Notification.js';
import Board from '../models/Board.js';
import Card from '../models/Card.js';
import List from '../models/List.js';
import User from '../models/User.js';

let mongo;
const app = createApp();
beforeAll(async () => {
  process.env.JWT_SECRET = 'notification-inbox-test-secret';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Notification, Board, Card, List, User].map((model) => model.deleteMany({})));
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function fixture() {
  const [recipient, actor] = await User.create([
    { name: 'Sam', email: 'sam@example.com', passwordHash: 'unused-test-hash' },
    { name: 'Alex', email: 'alex@example.com', passwordHash: 'unused-test-hash' },
  ]);
  const board = await Board.create({
    name: 'Uptime Desk', owner: actor._id,
    members: [{ user: actor._id, role: 'owner' }, { user: recipient._id, role: 'member' }],
  });
  const list = await List.create({ board: board._id, title: 'Todo', position: 1000 });
  const card = await Card.create({ board: board._id, list: list._id, title: 'API tests', position: 1000 });
  const token = jwt.sign({ id: recipient.id }, process.env.JWT_SECRET);
  return {
    recipient, actor, board, card, token,
    add: (overrides = {}) => Notification.create({
      recipient: recipient._id, actor: actor._id, board: board._id,
      card: card._id, type: 'card.assigned', ...overrides,
    }),
    get: (query = {}) => request(app).get('/api/v1/notifications').query(query).set('Authorization', `Bearer ${token}`),
  };
}

describe('mark all notifications as read', () => {
  const markAll = (ctx, body = {}) => request(app).patch('/api/v1/notifications/read-all')
    .set('Authorization', `Bearer ${ctx.token}`).send(body);

  it('marks all accessible unread records across projects, including records beyond the inbox page', async () => {
    const ctx = await fixture();
    const second = await Board.create({ name: 'Second project', owner: ctx.recipient._id, members: [{ user: ctx.recipient._id, role: 'owner' }] });
    await Promise.all(Array.from({ length: 22 }, () => ctx.add()));
    await ctx.add({ board: second._id, type: 'member.added', card: null });
    const alreadyRead = await ctx.add({ readAt: new Date('2026-01-01') });
    const other = await ctx.add({ recipient: ctx.actor._id });
    const inaccessible = await ctx.add({ board: new mongoose.Types.ObjectId() });
    const res = await markAll(ctx, { recipientId: ctx.actor.id, readAt: '2000-01-01' }).expect(200);
    expect(res.body.data).toEqual({ modifiedCount: 23 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await ctx.get().expect(200)).body.data.unreadCount).toBe(0);
    const unchanged = await Notification.findById(alreadyRead._id);
    expect(unchanged.readAt).toEqual(alreadyRead.readAt);
    expect(unchanged.updatedAt).toEqual(alreadyRead.updatedAt);
    expect((await Notification.findById(other._id)).readAt).toBeNull();
    expect((await Notification.findById(inaccessible._id)).readAt).toBeNull();
  });

  it('returns zero for empty inboxes and repeated calls without changing timestamps', async () => {
    const ctx = await fixture();
    expect((await markAll(ctx).expect(200)).body.data.modifiedCount).toBe(0);
    const item = await ctx.add();
    await markAll(ctx).expect(200);
    const first = await Notification.findById(item._id);
    expect((await markAll(ctx).expect(200)).body.data.modifiedCount).toBe(0);
    const repeated = await Notification.findById(item._id);
    expect(repeated.readAt).toEqual(first.readAt);
    expect(repeated.updatedAt).toEqual(first.updatedAt);
  });

  it('requires authentication and excludes projects with removed membership', async () => {
    const ctx = await fixture();
    const item = await ctx.add();
    await request(app).patch('/api/v1/notifications/read-all').expect(401);
    await request(app).patch('/api/v1/notifications/read-all').set('Authorization', 'Bearer invalid').expect(401);
    await Board.updateOne({ _id: ctx.board._id }, { $pull: { members: { user: ctx.recipient._id } } });
    expect((await markAll(ctx).expect(200)).body.data.modifiedCount).toBe(0);
    expect((await Notification.findById(item._id)).readAt).toBeNull();
  });

  it('marks accessible retained history even when the task and actor were deleted', async () => {
    const ctx = await fixture();
    await ctx.add();
    await Card.deleteOne({ _id: ctx.card._id });
    await User.deleteOne({ _id: ctx.actor._id });
    expect((await markAll(ctx).expect(200)).body.data.modifiedCount).toBe(1);
  });

  it('leaves a notification arriving after selection unread', async () => {
    const ctx = await fixture();
    const earlier = await ctx.add();
    const updateMany = Notification.updateMany.bind(Notification);
    let arriving;
    vi.spyOn(Notification, 'updateMany').mockImplementationOnce(async (...args) => {
      arriving = await ctx.add();
      return updateMany(...args);
    });
    expect((await markAll(ctx).expect(200)).body.data.modifiedCount).toBe(1);
    expect((await Notification.findById(earlier._id)).readAt).toBeInstanceOf(Date);
    expect((await Notification.findById(arriving._id)).readAt).toBeNull();
    expect((await ctx.get().expect(200)).body.data.unreadCount).toBe(1);
  });

  it('preserves a concurrent single-item read and reports only remaining changes', async () => {
    const ctx = await fixture();
    const item = await ctx.add();
    await ctx.add();
    const updateMany = Notification.updateMany.bind(Notification);
    const firstRead = new Date('2026-01-01');
    vi.spyOn(Notification, 'updateMany').mockImplementationOnce(async (...args) => {
      await Notification.updateOne({ _id: item._id }, { $set: { readAt: firstRead } });
      return updateMany(...args);
    });
    expect((await markAll(ctx).expect(200)).body.data.modifiedCount).toBe(1);
    expect((await Notification.findById(item._id)).readAt).toEqual(firstRead);
  });

  it('returns a generic error if the bulk write fails', async () => {
    const ctx = await fixture();
    const item = await ctx.add();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Notification, 'updateMany').mockRejectedValueOnce(new Error('Private database details'));
    const res = await markAll(ctx).expect(500);
    expect(res.body.error).toEqual({ code: 'SERVER', message: 'Could not mark notifications as read.' });
    expect((await Notification.findById(item._id)).readAt).toBeNull();
  });
});

describe('mark one notification as read', () => {
  function mark(ctx, id, body = {}) {
    return request(app).patch(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${ctx.token}`).send(body);
  }

  it('saves a server timestamp, decreases unread count, and leaves other notifications untouched', async () => {
    const ctx = await fixture();
    const notification = await ctx.add();
    const other = await ctx.add();
    const before = Date.now();
    const res = await mark(ctx, notification.id, { readAt: '2000-01-01', recipientId: ctx.actor.id }).expect(200);
    expect(Object.keys(res.body.data.notification).sort()).toEqual(['_id', 'readAt']);
    expect(res.body.data.notification._id).toBe(notification.id);
    expect(new Date(res.body.data.notification.readAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(res.headers['cache-control']).toBe('no-store');
    const saved = await Notification.findById(notification._id);
    expect(saved.readAt.toISOString()).toBe(res.body.data.notification.readAt);
    expect(saved.recipient.toString()).toBe(ctx.recipient.id);
    expect((await Notification.findById(other._id)).readAt).toBeNull();
    expect((await ctx.get().expect(200)).body.data.unreadCount).toBe(1);
  });

  it('preserves readAt and updatedAt on repeated calls', async () => {
    const ctx = await fixture();
    const notification = await ctx.add({ readAt: new Date('2026-01-01T00:00:00.000Z') });
    const first = await mark(ctx, notification.id).expect(200);
    const second = await mark(ctx, notification.id, { readAt: null }).expect(200);
    expect(second.body).toEqual(first.body);
    const saved = await Notification.findById(notification._id);
    expect(saved.readAt).toEqual(notification.readAt);
    expect(saved.updatedAt).toEqual(notification.updatedAt);
  });

  it('returns the same persisted read time for concurrent requests', async () => {
    const ctx = await fixture();
    const notification = await ctx.add();
    const responses = await Promise.all([mark(ctx, notification.id), mark(ctx, notification.id)]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect((await Notification.findById(notification._id)).readAt.toISOString()).toBe(responses[0].body.data.notification.readAt);
  });

  it('requires authentication and hides another recipient\'s notification with the same 404 as a missing ID', async () => {
    const ctx = await fixture();
    const other = await ctx.add({ recipient: ctx.actor._id });
    await request(app).patch(`/api/v1/notifications/${other.id}/read`).expect(401);
    const forbidden = await mark(ctx, other.id).expect(404);
    const missing = await mark(ctx, new mongoose.Types.ObjectId().toString()).expect(404);
    expect(forbidden.body).toEqual(missing.body);
    expect((await Notification.findById(other._id)).readAt).toBeNull();
    const malformed = await mark(ctx, 'invalid-id').expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION');
  });

  it.each(['removed membership', 'deleted project'])('rejects notifications hidden by %s', async (reason) => {
    const ctx = await fixture();
    const notification = await ctx.add();
    if (reason === 'deleted project') await Board.deleteOne({ _id: ctx.board._id });
    else await Board.updateOne({ _id: ctx.board._id }, { $pull: { members: { user: ctx.recipient._id } } });
    await mark(ctx, notification.id).expect(404);
    expect((await Notification.findById(notification._id)).readAt).toBeNull();
  });

  it('can mark retained history read after a task or actor is deleted', async () => {
    const ctx = await fixture();
    const notification = await ctx.add();
    await Card.deleteOne({ _id: ctx.card._id });
    await User.deleteOne({ _id: ctx.actor._id });
    await mark(ctx, notification.id).expect(200);
    expect((await ctx.get().expect(200)).body.data.unreadCount).toBe(0);
  });

  it('returns a generic error and leaves read state unchanged when the write fails', async () => {
    const ctx = await fixture();
    const notification = await ctx.add();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Notification, 'findOneAndUpdate').mockImplementationOnce(() => { throw new Error('Private database details'); });
    const res = await mark(ctx, notification.id).expect(500);
    expect(res.body.error).toEqual({ code: 'SERVER', message: 'Could not mark notification as read.' });
    expect((await Notification.findById(notification._id)).readAt).toBeNull();
  });
});

describe('notification read API', () => {
  it('requires authentication and returns an empty inbox without creating or marking records', async () => {
    const ctx = await fixture();
    await request(app).get('/api/v1/notifications').expect(401);
    await request(app).get('/api/v1/notifications').set('Authorization', 'Bearer invalid').expect(401);
    const res = await ctx.get().expect(200);
    expect(res.body.data).toEqual({ notifications: [], unreadCount: 0, nextCursor: null });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('uses authenticated ownership, returns minimal context, and counts unread across the inbox', async () => {
    const ctx = await fixture();
    const own = await ctx.add();
    await ctx.add({ readAt: new Date() });
    await ctx.add({ recipient: ctx.actor._id });
    const res = await ctx.get({ recipientId: ctx.actor.id, recipient: ctx.actor.id, limit: '1' }).expect(200);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.unreadCount).toBe(1);
    expect(res.body.data.nextCursor).toEqual(expect.any(String));
    const item = res.body.data.notifications[0];
    expect(item.actor).toEqual({ _id: ctx.actor.id, name: 'Alex' });
    expect(item.board).toEqual({ _id: ctx.board.id, name: 'Uptime Desk' });
    expect(item.card).toEqual({ _id: ctx.card.id, title: 'API tests' });
    expect(item).not.toHaveProperty('recipient');
    const older = await ctx.get({ cursor: res.body.data.nextCursor }).expect(200);
    expect(older.body.data.notifications.map((notification) => notification._id)).toEqual([own.id]);
    expect(older.body.data.unreadCount).toBe(1);
    expect((await Notification.findById(own._id)).readAt).toBeNull();
  });

  it('paginates equal timestamps without duplicates and ignores newer inserts on later pages', async () => {
    const ctx = await fixture();
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    const seeded = [];
    for (let i = 0; i < 5; i += 1) seeded.push(await ctx.add({ createdAt }));
    const expectedIds = seeded.map((item) => item.id).sort().reverse();
    const first = await ctx.get({ limit: '2' }).expect(200);
    await ctx.add({ createdAt: new Date('2026-09-02T12:00:00.000Z') });
    const second = await ctx.get({ limit: '2', cursor: first.body.data.nextCursor }).expect(200);
    const third = await ctx.get({ limit: '2', cursor: second.body.data.nextCursor }).expect(200);
    const ids = [first, second, third].flatMap((res) => res.body.data.notifications.map((item) => item._id));
    expect(ids).toEqual(expectedIds);
    expect(third.body.data.nextCursor).toBeNull();
    expect(third.body.data.unreadCount).toBe(6);
  });

  it('excludes deleted projects and removed memberships before pagination and counting', async () => {
    const ctx = await fixture();
    const visible = await ctx.add({ createdAt: new Date('2026-01-01') });
    const revoked = await Board.create({ name: 'Revoked project', owner: ctx.actor._id, members: [{ user: ctx.actor._id, role: 'owner' }] });
    await ctx.add({ board: revoked._id, type: 'member.added', card: null });
    await ctx.add({ board: new mongoose.Types.ObjectId(), type: 'member.added', card: null });
    const res = await ctx.get({ limit: '1' }).expect(200);
    expect(res.body.data.notifications.map((item) => item._id)).toEqual([visible.id]);
    expect(res.body.data).toMatchObject({ unreadCount: 1, nextCursor: null });
    await Board.updateOne({ _id: ctx.board._id }, { $pull: { members: { user: ctx.recipient._id } } });
    expect((await ctx.get().expect(200)).body.data).toEqual({ notifications: [], unreadCount: 0, nextCursor: null });
  });

  it('returns null for deleted actors and tasks while retaining accessible history', async () => {
    const ctx = await fixture();
    await ctx.add();
    await ctx.add({ type: 'member.added', card: null });
    await User.deleteOne({ _id: ctx.actor._id });
    await Card.deleteOne({ _id: ctx.card._id });
    const res = await ctx.get().expect(200);
    expect(res.body.data.unreadCount).toBe(2);
    for (const item of res.body.data.notifications) {
      expect(item.actor).toBeNull();
      expect(item.card).toBeNull();
      expect(item.board._id).toBe(ctx.board.id);
    }
  });

  it('does not expose a mismatched card from another project', async () => {
    const ctx = await fixture();
    const privateCard = await Card.create({ board: new mongoose.Types.ObjectId(), list: new mongoose.Types.ObjectId(), title: 'Private title', position: 1000 });
    await ctx.add({ card: privateCard._id });
    const res = await ctx.get().expect(200);
    expect(res.body.data.notifications[0].card).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Private title');
  });

  it.each([
    { limit: '0' }, { limit: '51' }, { limit: '-1' }, { limit: '1.5' },
    { limit: 'abc' }, { limit: ['1', '2'] }, { cursor: '' }, { cursor: 'not-json' },
    { cursor: Buffer.from(JSON.stringify({ id: 'invalid', createdAt: 'today' })).toString('base64url') },
  ])('rejects invalid query parameters: %j', async (query) => {
    const ctx = await fixture();
    const res = await ctx.get(query).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('returns a generic error when the inbox query fails', async () => {
    const ctx = await fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Notification, 'aggregate').mockRejectedValueOnce(new Error('Private database details'));
    const res = await ctx.get().expect(500);
    expect(res.body.error).toEqual({ code: 'SERVER', message: 'Could not load notifications.' });
  });
});
