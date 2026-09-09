import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import Board from '../models/Board.js';
import Workflow from '../models/Workflow.js';
import List from '../models/List.js';
import Card from '../models/Card.js';
import User from '../models/User.js';
import { ensureDefaultWorkflow } from '../services/workflowService.js';

let mongo;
const app = createApp();
beforeAll(async () => {
  process.env.JWT_SECRET = 'board-loading-test-secret';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Board, Workflow, List, Card, User].map((model) => model.deleteMany({})));
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function fixture({ legacy = false } = {}) {
  const user = await User.create({ name: 'Alex', email: 'alex@example.com', passwordHash: 'unused' });
  const board = await Board.create({ name: 'Project', owner: user._id, members: [{ user: user._id, role: 'owner' }] });
  const workflow = legacy ? null : await ensureDefaultWorkflow(board._id);
  const list = await List.create({ board: board._id, workflow: workflow?._id, title: 'Todo', position: 2000 });
  const card = await Card.create({ board: board._id, workflow: workflow?._id, list: list._id, title: 'Task', position: 2000, assignee: user._id });
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  return { user, board, workflow, list, card, get: () => request(app).get(`/api/v1/boards/${board.id}`).set('Authorization', `Bearer ${token}`) };
}

function observeWrites() {
  return [vi.spyOn(Workflow, 'findOneAndUpdate'), vi.spyOn(List, 'updateMany'), vi.spyOn(Card, 'updateMany')];
}

describe('project load optimization', () => {
  it('keeps modern projects read-only with unchanged ordering and populated users', async () => {
    const ctx = await fixture();
    const earlier = await Workflow.create({ board: ctx.board._id, name: 'Sprint', position: 500 });
    const list = await List.create({ board: ctx.board._id, workflow: earlier._id, title: 'Earlier', position: 1000 });
    const card = await Card.create({ board: ctx.board._id, workflow: earlier._id, list: list._id, title: 'Earlier task', position: 1000 });
    const writes = observeWrites();
    const finds = [Workflow, List, Card].map((model) => vi.spyOn(model, 'find'));
    const res = await ctx.get().expect(200);
    expect(res.body.data.workflows.map((w) => w._id)).toEqual([earlier.id, ctx.workflow.id]);
    expect(res.body.data.lists.map((l) => l._id)).toEqual([list.id, ctx.list.id]);
    expect(res.body.data.cards.map((c) => c._id)).toEqual([card.id, ctx.card.id]);
    expect(res.body.data.cards[1].assignee).toMatchObject({ _id: ctx.user.id, name: 'Alex', email: 'alex@example.com' });
    expect(res.body.data.board.members[0].user).toMatchObject({ _id: ctx.user.id, name: 'Alex' });
    finds.forEach((find) => expect(find).toHaveBeenCalledTimes(1));
    await ctx.get().expect(200);
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it.each(['null', 'missing'])('repairs %s legacy workflow fields once and returns the persisted scopes', async (shape) => {
    const ctx = await fixture({ legacy: true });
    if (shape === 'missing') {
      await List.collection.updateOne({ _id: ctx.list._id }, { $unset: { workflow: '' } });
      await Card.collection.updateOne({ _id: ctx.card._id }, { $unset: { workflow: '' } });
    }
    const writes = observeWrites();
    const first = await ctx.get().expect(200);
    const workflowId = first.body.data.workflows[0]._id;
    expect(first.body.data.workflows).toHaveLength(1);
    expect(first.body.data.lists[0].workflow).toBe(workflowId);
    expect(first.body.data.cards[0].workflow).toBe(workflowId);
    expect((await Card.findById(ctx.card._id)).workflow.toString()).toBe(workflowId);
    await ctx.get().expect(200);
    writes.forEach((write) => expect(write).toHaveBeenCalledTimes(1));
  });

  it('repairs a partially migrated project without reassigning scoped work or touching another project', async () => {
    const ctx = await fixture();
    const other = await Board.create({ name: 'Other', owner: ctx.user._id, members: [] });
    const otherList = await List.create({ board: other._id, title: 'Legacy elsewhere', position: 1 });
    await Card.updateOne({ _id: ctx.card._id }, { workflow: null });
    const result = await ctx.get().expect(200);
    expect(result.body.data.cards[0].workflow).toBe(ctx.workflow.id);
    expect(result.body.data.lists[0].workflow).toBe(ctx.workflow.id);
    expect((await List.findById(otherList._id)).workflow).toBeNull();
    expect(await Workflow.countDocuments({ board: ctx.board._id })).toBe(1);
  });

  it('recreates a missing default even when all work is scoped to a custom workflow', async () => {
    const ctx = await fixture();
    await Workflow.updateOne({ _id: ctx.workflow._id }, { templateKey: 'custom' });
    const result = await ctx.get().expect(200);
    expect(result.body.data.workflows).toHaveLength(2);
    expect(result.body.data.workflows.some((w) => w.templateKey === 'default')).toBe(true);
    expect(result.body.data.cards[0].workflow).toBe(ctx.workflow.id);
  });

  it('does not read or migrate private project data for non-members', async () => {
    const ctx = await fixture({ legacy: true });
    await Board.updateOne({ _id: ctx.board._id }, { members: [] });
    const writes = observeWrites();
    const finds = [Workflow, List, Card].map((model) => vi.spyOn(model, 'find'));
    await ctx.get().expect(404);
    finds.concat(writes).forEach((operation) => expect(operation).not.toHaveBeenCalled());
  });

  it('returns a safe error on repair failure and repairs remaining work on retry', async () => {
    const ctx = await fixture({ legacy: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = vi.spyOn(Card, 'updateMany').mockRejectedValueOnce(new Error('Private database error'));
    const failed = await ctx.get().expect(500);
    expect(failed.body.error.message).toBe('Something went wrong.');
    failure.mockRestore();
    const retried = await ctx.get().expect(200);
    expect(retried.body.data.cards[0].workflow).toBe(retried.body.data.workflows[0]._id);
  });

  it('starts independent structure reads before waiting for any one of them', async () => {
    const ctx = await fixture();
    const started = new Set();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const original = mongoose.Query.prototype.exec;
    vi.spyOn(mongoose.Query.prototype, 'exec').mockImplementation(async function (...args) {
      if (this.op === 'find' && ['Workflow', 'List', 'Card'].includes(this.model.modelName)) {
        started.add(this.model.modelName);
        if (started.size === 3) release();
        await gate;
      }
      return original.apply(this, args);
    });
    // Bound a regression failure so a sequential implementation cannot hang tests.
    const timeout = setTimeout(release, 1000);
    const pending = ctx.get().expect(200).then((res) => res);
    try {
      await vi.waitFor(() => expect(started.size).toBe(3), { timeout: 500 });
      await pending;
    } finally {
      clearTimeout(timeout);
      release();
      await pending;
    }
  });
});
