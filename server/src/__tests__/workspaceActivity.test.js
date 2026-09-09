import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import Activity from '../models/Activity.js';
import Board from '../models/Board.js';
import User from '../models/User.js';

let mongo;
const app = createApp();
beforeAll(async () => {
  process.env.JWT_SECRET = 'activity-test-secret';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Activity, Board, User].map((model) => model.deleteMany({})));
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function fixture() {
  const [user, actor] = await User.create([
    { name: 'Alex', email: 'alex@example.com', passwordHash: 'unused' },
    { name: 'Sam', email: 'sam@example.com', passwordHash: 'unused' },
  ]);
  const board = await Board.create({ name: 'Uptime Desk', owner: actor._id, members: [{ user: user._id, role: 'member' }] });
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  return {
    user, actor, board,
    get: (query = {}) => request(app).get('/api/v1/activities').query(query).set('Authorization', `Bearer ${token}`),
    add: (values = {}) => Activity.create({ board: board._id, actor: actor._id, action: 'card.created', targetType: 'card', targetTitle: 'Task', ...values }),
  };
}

describe('workspace activity', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/activities').expect(401);
  });

  it('includes member/admin/owner projects but excludes private and missing projects before limiting', async () => {
    const ctx = await fixture();
    const visible = [await ctx.add({ createdAt: new Date('2026-01-01') })];
    for (const role of ['admin', 'owner']) {
      const board = await Board.create({ name: role, owner: ctx.user._id, members: [{ user: ctx.user._id, role }] });
      visible.push(await ctx.add({ board: board._id }));
    }
    const privateBoard = await Board.create({ name: 'Secret', owner: ctx.actor._id, members: [{ user: ctx.actor._id, role: 'owner' }] });
    await ctx.add({ board: privateBoard._id, targetTitle: 'Private task', createdAt: new Date('2030-01-01') });
    await ctx.add({ board: new mongoose.Types.ObjectId(), createdAt: new Date('2030-01-02') });
    const res = await ctx.get({ limit: '3', userId: ctx.actor.id, boardId: privateBoard.id }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.activities.map((a) => a._id).sort()).toEqual(visible.map((a) => a.id).sort());
    expect(res.body.data.nextCursor).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Private task');
    expect(res.body.data.activities.find((a) => a.board === ctx.board.id)).toMatchObject({ boardName: 'Uptime Desk', actor: { name: 'Sam' } });
  });

  it('paginates tied timestamps without duplicates or newly inserted events', async () => {
    const ctx = await fixture();
    const seeded = [];
    for (let i = 0; i < 5; i++) seeded.push(await ctx.add({ createdAt: new Date('2026-01-01') }));
    const first = await ctx.get({ limit: '2' }).expect(200);
    await ctx.add({ createdAt: new Date('2026-02-01') });
    const second = await ctx.get({ limit: '2', cursor: first.body.data.nextCursor }).expect(200);
    const third = await ctx.get({ limit: '2', cursor: second.body.data.nextCursor }).expect(200);
    expect([first, second, third].flatMap((res) => res.body.data.activities.map((a) => a._id))).toEqual(seeded.map((a) => a.id).sort().reverse());
    expect(third.body.data.nextCursor).toBeNull();
  });

  it('rechecks membership on subsequent pages and tolerates a deleted actor', async () => {
    const ctx = await fixture();
    await ctx.add();
    await ctx.add();
    await User.deleteOne({ _id: ctx.actor._id });
    const first = await ctx.get({ limit: '1' }).expect(200);
    expect(first.body.data.activities[0].actor).toBeNull();
    await Board.updateOne({ _id: ctx.board._id }, { $set: { members: [] } });
    const next = await ctx.get({ cursor: first.body.data.nextCursor }).expect(200);
    expect(next.body.data).toEqual({ activities: [], nextCursor: null });
  });

  it('bounds the default page and uses one activity query for multiple projects', async () => {
    const ctx = await fixture();
    await Activity.insertMany(Array.from({ length: 51 }, () => ({ board: ctx.board._id, actor: ctx.actor._id, action: 'board.updated', targetType: 'board' })));
    const second = await Board.create({ name: 'Second', owner: ctx.user._id, members: [{ user: ctx.user._id, role: 'owner' }] });
    await ctx.add({ board: second._id });
    const find = vi.spyOn(Activity, 'find');
    const res = await ctx.get().expect(200);
    expect(res.body.data.activities).toHaveLength(50);
    expect(res.body.data.nextCursor).toBeTruthy();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: ['1', '2'] }, { cursor: '' }, { cursor: 'garbage' }, { cursor: 'x'.repeat(513) }])('rejects invalid query %j', async (query) => {
    const ctx = await fixture();
    const res = await ctx.get(query).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('returns a safe error when the database fails', async () => {
    const ctx = await fixture();
    vi.spyOn(Activity, 'find').mockImplementationOnce(() => { throw new Error('Database credentials'); });
    expect((await ctx.get().expect(500)).body.error).toEqual({ code: 'SERVER', message: 'Could not load activity.' });
  });
});
