import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../app.js';
import { configureSockets } from '../socket.js';
import { appEvents } from '../events/eventBus.js';
import { registerNotificationSubscriber } from '../events/notificationSubscriber.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Board from '../models/Board.js';

let mongo;
let io;
let stopSubscriber;
const clients = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'notification-delivery-test-secret';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterEach(async () => {
  vi.restoreAllMocks();
  stopSubscriber?.();
  stopSubscriber = undefined;
  for (const client of clients.splice(0)) client.disconnect();
  if (io) await new Promise((resolve) => io.close(resolve));
  io = undefined;
  // All models here use this suite's isolated MongoDB, never the development DB.
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function fixture() {
  const app = createApp();
  const httpServer = createServer(app);
  io = new Server(httpServer);
  app.set('io', io);
  configureSockets(io);
  stopSubscriber = registerNotificationSubscriber(appEvents, { io });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;

  const [owner, recipient, outsider] = await User.create([
    { name: 'Alex', email: 'alex@example.com', passwordHash: 'unused-test-hash' },
    { name: 'Sam', email: 'sam@example.com', passwordHash: 'unused-test-hash' },
    { name: 'Lee', email: 'lee@example.com', passwordHash: 'unused-test-hash' },
  ]);
  const token = (user) => jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  const created = await request(app).post('/api/v1/boards')
    .set('Authorization', `Bearer ${token(owner)}`).send({ name: 'Uptime Desk' }).expect(201);
  const board = created.body.data.board;
  await Board.updateOne({ _id: board._id }, { $push: { members: { user: recipient._id, role: 'member' } } });
  const listResponse = await request(app).post(`/api/v1/boards/${board._id}/lists`)
    .set('Authorization', `Bearer ${token(owner)}`).send({ title: 'Todo', position: 1000 }).expect(201);
  const list = listResponse.body.data.list;

  async function connect(auth) {
    const socket = createClient(url, { auth, forceNew: true, reconnection: false, autoConnect: false });
    clients.push(socket);
    const changes = [];
    socket.on('notifications:changed', (payload) => changes.push(payload));
    socket.on('test:flush', (ack) => ack());
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return { socket, changes };
  }

  const first = await connect({ token: token(recipient) });
  const second = await connect({ token: token(recipient) });
  // Spoofed identity/room fields must not affect the verified owner's room.
  const sender = await connect({ token: token(owner), userId: recipient.id, room: `user:${recipient.id}` });
  const other = await connect({ token: token(outsider) });
  const viewers = [first, second, sender, other];

  async function flush() {
    // Acknowledged sentinel packets follow earlier signals on each connection.
    // This makes negative-delivery assertions deterministic without sleep timers.
    for (const { socket } of viewers) {
      await new Promise((resolve, reject) => {
        io.sockets.sockets.get(socket.id).timeout(2000).emit('test:flush', (err) => err ? reject(err) : resolve());
      });
    }
  }

  async function assign(transport = 'REST', assignee = recipient.id) {
    const body = { title: 'API tests', listId: list._id, assignee };
    if (transport === 'socket') {
      const ack = await sender.socket.timeout(2000).emitWithAck('card:create', { boardId: board._id, ...body });
      expect(ack.ok).toBe(true);
      return ack.data.card;
    }
    const res = await request(app).post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${token(owner)}`).send(body).expect(201);
    return res.body.data.card;
  }

  const mark = (id, user = recipient) => request(app).patch(`/api/v1/notifications/${id}/read`)
    .set('Authorization', `Bearer ${token(user)}`).send({ recipientId: owner.id });
  const markAll = () => request(app).patch('/api/v1/notifications/read-all')
    .set('Authorization', `Bearer ${token(recipient)}`).send({ recipientId: owner.id });
  const resetChanges = () => viewers.forEach(({ changes }) => { changes.length = 0; });
  return { app, owner, recipient, outsider, board, connect, first, second, sender, other, viewers, flush, assign, mark, markAll, resetChanges };
}

describe('private notification delivery', () => {
  it('joins only the authenticated user room, without a project subscription', async () => {
    const ctx = await fixture();
    expect(io.sockets.adapter.rooms.get(`user:${ctx.recipient.id}`)).toEqual(new Set([ctx.first.socket.id, ctx.second.socket.id]));
    expect(io.sockets.adapter.rooms.get(`user:${ctx.owner.id}`)).toEqual(new Set([ctx.sender.socket.id]));
    expect(io.sockets.adapter.rooms.has(`board:${ctx.board._id}`)).toBe(false);

    // There is no public personal-room subscription handler. A normal board
    // event afterward confirms earlier client packets have been processed.
    ctx.sender.socket.emit('user:join', { userId: ctx.recipient.id });
    const joined = await ctx.sender.socket.timeout(2000).emitWithAck('board:join', { boardId: ctx.board._id });
    expect(joined.ok).toBe(true);
    expect(io.sockets.adapter.rooms.get(`user:${ctx.recipient.id}`)).not.toContain(ctx.sender.socket.id);
    await ctx.assign();
    await ctx.flush();
    expect(ctx.sender.changes).toEqual([]); // Even another member of the same board is excluded.
  });

  it.each(['missing', 'invalid', 'expired', 'deleted-user'])('rejects %s authentication before joining a personal room', async (kind) => {
    const ctx = await fixture();
    const deletedId = new mongoose.Types.ObjectId().toString();
    const auth = {
      missing: {},
      invalid: { token: 'invalid' },
      expired: { token: jwt.sign({ id: ctx.recipient.id }, process.env.JWT_SECRET, { expiresIn: -1 }) },
      'deleted-user': { token: jwt.sign({ id: deletedId }, process.env.JWT_SECRET) },
    }[kind];
    await expect(ctx.connect(auth)).rejects.toBeInstanceOf(Error);
    expect(io.sockets.sockets.size).toBe(4);
    expect(io.sockets.adapter.rooms.get(`user:${ctx.recipient.id}`).size).toBe(2);
    expect(io.sockets.adapter.rooms.has(`user:${deletedId}`)).toBe(false);
  });

  it.each(['REST', 'socket'])('%s assignment signals both recipient tabs, not the actor or outsiders', async (transport) => {
    const ctx = await fixture();
    // Query as soon as the packet arrives to prove it does not precede persistence.
    const snapshot = new Promise((resolve) => {
      ctx.first.socket.once('notifications:changed', () => resolve(Notification.find({ recipient: ctx.recipient._id }).lean().exec()));
    });
    const card = await ctx.assign(transport);
    await ctx.flush();
    const saved = await snapshot;
    expect(saved).toHaveLength(1);
    expect(saved[0].card.toString()).toBe(card._id);
    expect(ctx.first.changes).toEqual([{}]);
    expect(ctx.second.changes).toEqual([{}]);
    expect(ctx.sender.changes).toEqual([]);
    expect(ctx.other.changes).toEqual([]);
  });

  it('does not signal self-assignments or failed notification saves', async () => {
    const ctx = await fixture();
    await ctx.assign('REST', ctx.owner.id);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Notification.prototype, 'save').mockRejectedValueOnce(new Error('Storage unavailable'));
    await ctx.assign(); // The card write still succeeds.
    await ctx.flush();
    expect(await Notification.countDocuments()).toBe(0);
    for (const viewer of ctx.viewers) expect(viewer.changes).toEqual([]);
  });

  it('signals successful single reads to every recipient tab, including idempotent retries', async () => {
    const ctx = await fixture();
    await ctx.assign();
    await ctx.flush();
    ctx.resetChanges();
    const item = await Notification.findOne();
    const firstRead = await ctx.mark(item.id).expect(200);
    const repeated = await ctx.mark(item.id).expect(200);
    await ctx.flush();
    expect(firstRead.body).toEqual(repeated.body);
    expect((await Notification.findById(item.id)).readAt).toBeInstanceOf(Date);
    expect(ctx.first.changes).toEqual([{}, {}]);
    expect(ctx.second.changes).toEqual([{}, {}]);
    expect(ctx.sender.changes).toEqual([]);
    expect(ctx.other.changes).toEqual([]);
  });

  it('signals bulk reads once per changed request, not for an empty/no-op inbox', async () => {
    const ctx = await fixture();
    await ctx.assign();
    await ctx.assign();
    await ctx.flush();
    ctx.resetChanges();
    expect((await ctx.markAll().expect(200)).body.data.modifiedCount).toBe(2);
    expect((await ctx.markAll().expect(200)).body.data.modifiedCount).toBe(0);
    await ctx.flush();
    expect(await Notification.countDocuments({ readAt: null })).toBe(0);
    expect(ctx.first.changes).toEqual([{}]);
    expect(ctx.second.changes).toEqual([{}]);
    expect(ctx.sender.changes).toEqual([]);
    expect(ctx.other.changes).toEqual([]);
  });

  it('does not signal unauthorized, invalid, inaccessible, or failed read writes', async () => {
    const ctx = await fixture();
    await ctx.assign();
    await ctx.flush();
    ctx.resetChanges();
    const item = await Notification.findOne();
    await request(ctx.app).patch(`/api/v1/notifications/${item.id}/read`).expect(401);
    await ctx.mark(item.id, ctx.owner).expect(404);
    await ctx.mark('invalid').expect(400);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Notification, 'findOneAndUpdate').mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
    await ctx.mark(item.id).expect(500);
    vi.spyOn(Notification, 'updateMany').mockRejectedValueOnce(new Error('Storage unavailable'));
    await ctx.markAll().expect(500);
    await Board.updateOne({ _id: ctx.board._id }, { $pull: { members: { user: ctx.recipient._id } } });
    await ctx.mark(item.id).expect(404);
    expect((await ctx.markAll().expect(200)).body.data.modifiedCount).toBe(0);
    await ctx.flush();
    expect((await Notification.findById(item.id)).readAt).toBeNull();
    for (const viewer of ctx.viewers) expect(viewer.changes).toEqual([]);
  });

  it('preserves a successful read response when socket delivery fails', async () => {
    const ctx = await fixture();
    await ctx.assign();
    const item = await Notification.findOne();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(io, 'to').mockImplementationOnce(() => { throw new Error('Transport unavailable'); });
    await ctx.mark(item.id).expect(200);
    expect((await Notification.findById(item.id)).readAt).toBeInstanceOf(Date);
  });
});
