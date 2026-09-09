import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { io as createClient } from 'socket.io-client';
import { Server } from 'socket.io';
import { createApp } from '../app.js';
import { configureSockets } from '../socket.js';
import Board from '../models/Board.js';
import User from '../models/User.js';
import Workflow from '../models/Workflow.js';
import List from '../models/List.js';
import Card from '../models/Card.js';
import Activity from '../models/Activity.js';
import Comment from '../models/Comment.js';

let mongo, io, app, url, ctx;
const clients = [];
const ack = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
});

async function viewer(token, boardId) {
  const socket = createClient(url, { auth: { token }, reconnection: false, forceNew: true, autoConnect: false });
  clients.push(socket);
  const events = [];
  socket.onAny((event, payload) => { if (/^(card|list|activity):/.test(event)) events.push({ event, payload }); });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
  expect((await ack(socket, 'board:join', { boardId })).ok).toBe(true);
  return { socket, events, boardId };
}

// A same-connection acknowledgement is a delivery barrier for earlier frames.
// This avoids timing-based sleeps when asserting that no extra event was sent.
async function flush() {
  for (const client of ctx.viewers) {
    if (client.socket.connected) await ack(client.socket, 'board:join', { boardId: client.boardId });
  }
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'rest-broadcast-test';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp();
  const http = createServer(app);
  io = new Server(http);
  app.set('io', io);
  configureSockets(io);
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${http.address().port}`;
}, 60000);

beforeEach(async () => {
  const users = await User.create(['owner', 'member', 'outsider'].map((name) => ({ name, email: `${name}@example.com`, passwordHash: 'unused-test-hash' })));
  const tokens = users.map((user) => jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET));
  const board = await Board.create({ name: 'Project', owner: users[0]._id, members: [{ user: users[0]._id, role: 'owner' }, { user: users[1]._id, role: 'member' }] });
  const other = await Board.create({ name: 'Other project', owner: users[2]._id, members: [{ user: users[2]._id, role: 'owner' }] });
  const workflow = await Workflow.create({ board: board._id, name: 'General', templateKey: 'default', position: 1000 });
  const lists = await List.create(['Backlog', 'Review'].map((title, i) => ({ board: board._id, workflow: workflow._id, title, position: (i + 1) * 1000 })));
  const card = await Card.create({ board: board._id, workflow: workflow._id, list: lists[0]._id, title: 'Task', position: 1000 });
  const viewers = [await viewer(tokens[0], board.id), await viewer(tokens[1], board.id), await viewer(tokens[2], other.id)];
  ctx = { users, tokens, board, other, workflow, lists, card, viewers };
});

afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  vi.restoreAllMocks();
  await Promise.all([Board, User, Workflow, List, Card, Activity, Comment].map((model) => model.deleteMany({})));
});
afterAll(async () => {
  if (io) await new Promise((resolve) => io.close(resolve));
  await mongoose.disconnect();
  await mongo?.stop();
});

function call(method, path, body, token = ctx.tokens[0]) {
  return request(app)[method](`/api/v1/boards/${ctx.board.id}/${path}`).set('Authorization', `Bearer ${token}`).send(body);
}
const cases = [
  ['card create', 'post', () => 'cards', () => ({ title: 'New task', listId: ctx.lists[0].id, assignee: ctx.users[1].id }), 'card:created', 'card'],
  ['card edit', 'patch', () => `cards/${ctx.card.id}`, () => ({ title: 'Edited', description: 'Notes', status: 'Done' }), 'card:updated', 'card'],
  ['card move', 'patch', () => `cards/${ctx.card.id}`, () => ({ list: ctx.lists[1].id, position: 2000 }), 'card:moved', 'card'],
  ['checklist edit', 'patch', () => `cards/${ctx.card.id}`, () => ({ checklistOperation: { action: 'add', title: 'Test item' } }), 'card:updated', 'card'],
  ['card delete', 'delete', () => `cards/${ctx.card.id}`, () => ({}), 'card:deleted', 'cardId'],
  ['list create', 'post', () => 'lists', () => ({ title: 'Done', workflowId: ctx.workflow.id, position: 3000 }), 'list:created', 'list'],
  ['list rename', 'patch', () => `lists/${ctx.lists[0].id}`, () => ({ title: 'Ready' }), 'list:updated', 'list'],
  ['list move', 'patch', () => `lists/${ctx.lists[0].id}`, () => ({ position: 2500 }), 'list:moved', 'list'],
  ['list rename and move', 'patch', () => `lists/${ctx.lists[0].id}`, () => ({ title: 'Ready', position: 2500 }), 'list:updated', 'list'],
  ['list delete', 'delete', () => `lists/${ctx.lists[0].id}`, () => ({}), 'list:deleted', 'listId'],
];

describe('REST mutation delivery', () => {
  it.each(cases)('%s broadcasts exactly once to its board, with the saved response', async (_label, method, path, body, event, field) => {
    const response = await call(method, path(), body()).expect(method === 'post' ? 201 : 200);
    await flush();
    const value = field === 'cardId' ? ctx.card.id : field === 'listId' ? ctx.lists[0].id : response.body.data[field];
    for (const client of ctx.viewers.slice(0, 2)) {
      expect(client.events.filter((entry) => entry.event !== 'activity:created')).toEqual([{ event, payload: { boardId: ctx.board.id, [field]: value } }]);
      expect(client.events.filter((entry) => entry.event === 'activity:created')).toHaveLength(1);
    }
    expect(ctx.viewers[2].events).toEqual([]);
    const model = field.startsWith('card') ? Card : List;
    const saved = await model.findById(typeof value === 'string' ? value : value._id).lean();
    if (method === 'delete') expect(saved).toBeNull();
    else { expect(saved.title).toBe(value.title); expect(saved.position).toBe(value.position); }
    if (field === 'card' && method === 'post') expect(value.assignee.name).toBe('member');
    if (field === 'listId') expect(await Card.countDocuments({ list: value })).toBe(0);
  });

  it('delivers a fallback save when the author has no connected socket', async () => {
    ctx.viewers[0].socket.disconnect();
    await call('patch', `cards/${ctx.card.id}`, { status: 'Done' }).expect(200);
    await flush();
    expect(ctx.viewers[1].events.filter((entry) => entry.event === 'card:updated')).toHaveLength(1);
    expect(ctx.viewers[2].events).toEqual([]);
  });

  it('does not broadcast unauthorized, invalid, or missing-target writes', async () => {
    for (const [, method, path, body] of cases) await call(method, path(), body(), ctx.tokens[2]).expect(404);
    await call('post', 'cards', { title: '', listId: ctx.lists[0].id }).expect(400);
    await call('patch', `cards/${ctx.card.id}`, { status: 'Invalid' }).expect(400);
    await call('post', 'lists', { title: '' }).expect(400);
    await call('patch', `lists/${ctx.lists[0].id}`, { title: '' }).expect(400);
    for (const type of ['cards', 'lists']) {
      const missing = new mongoose.Types.ObjectId();
      await call('patch', `${type}/${missing}`, { title: 'Missing' }).expect(404);
      await call('delete', `${type}/${missing}`, {}).expect(404);
    }
    await flush();
    ctx.viewers.forEach((client) => expect(client.events).toEqual([]));
  });

  it('does not broadcast when persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Card, 'findOneAndUpdate').mockImplementation(() => { throw new Error('Database unavailable'); });
    await call('patch', `cards/${ctx.card.id}`, { status: 'Done' }).expect(500);
    await flush();
    ctx.viewers.forEach((client) => expect(client.events).toEqual([]));
    expect((await Card.findById(ctx.card.id)).status).toBe('Todo');
  });

  it('keeps socket-origin writes single-delivery and excludes their sending socket', async () => {
    const result = await ack(ctx.viewers[0].socket, 'card:create', { boardId: ctx.board.id, title: 'Socket task', listId: ctx.lists[0].id });
    expect(result.ok).toBe(true);
    await flush();
    expect(ctx.viewers[0].events).toEqual([]);
    expect(ctx.viewers[1].events.filter((entry) => entry.event === 'card:created')).toHaveLength(1);
    expect(ctx.viewers[2].events).toEqual([]);
  });
});
