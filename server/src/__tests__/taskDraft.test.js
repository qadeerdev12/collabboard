import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import Board from '../models/Board.js';
import Card from '../models/Card.js';
import User from '../models/User.js';
import { createDraftLimiter, generateTaskDraft } from '../services/taskDraftService.js';

let mongo;
const app = createApp();
const draft = { description: 'Add password reset with expiring links.', tag: 'Feature', checklist: ['Validate email', 'Test expiry'] };
function provider(value = draft) {
  return { ok: true, status: 200, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) };
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'draft-test';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-key');
  vi.stubEnv('OPENAI_TASK_DRAFT_MODEL', 'test-model');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(provider()));
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  await Promise.all([Board, Card, User].map((model) => model.deleteMany({})));
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

async function fixture(role = 'member') {
  const user = await User.create({ name: 'Alex', email: 'alex@example.com', passwordHash: 'unused' });
  const board = await Board.create({ name: 'Private project', owner: user._id, members: role ? [{ user: user._id, role }] : [] });
  const card = await Card.create({ board: board._id, list: new mongoose.Types.ObjectId(), title: 'Stored title', description: 'PRIVATE existing notes', position: 1000, checklist: [{ title: 'Existing', completed: true }] });
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  const url = `/api/v1/boards/${board.id}/cards/${card.id}/draft`;
  return { card, url, send: (body = { title: 'Reset password', brief: 'Use expiring links' }) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body) };
}

describe('AI task drafting', () => {
  it.each(['owner', 'admin', 'member'])('allows %s to preview without saving or sending stored data', async (role) => {
    const ctx = await fixture(role);
    const before = await Card.findById(ctx.card._id).lean();
    const res = await ctx.send().expect(200);
    expect(res.body.data.draft).toEqual(draft);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await Card.findById(ctx.card._id).lean()).toEqual(before);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ store: false, model: 'test-model', text: { format: { type: 'json_schema', strict: true } } });
    expect(JSON.parse(body.input[0].content)).toEqual({ title: 'Reset password', brief: 'Use expiring links' });
    expect(options.body).not.toContain('PRIVATE');
    expect(body.tools).toBeUndefined();
  });
  it('rejects guests and non-members before calling the provider', async () => {
    const ctx = await fixture(null);
    await request(app).post(ctx.url).send({}).expect(401);
    await ctx.send().expect(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects cards outside the requested project', async () => {
    const ctx = await fixture();
    await Card.updateOne({ _id: ctx.card._id }, { board: new mongoose.Types.ObjectId() });
    await ctx.send().expect(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ title: '', brief: '' }, { title: 'x'.repeat(301), brief: '' }, { title: 'Task', brief: 'x'.repeat(4001) }, { title: 'Task', brief: {} }])('validates input %j', async (body) => {
    const ctx = await fixture();
    await ctx.send(body).expect(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns a configuration error without making an external request', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const ctx = await fixture();
    expect((await ctx.send().expect(503)).body.error.code).toBe('AI_NOT_CONFIGURED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...draft, tag: 'Invalid' }, { ...draft, checklist: ['x'.repeat(301)] },
    { ...draft, checklist: Array(11).fill('Task') }, { ...draft, extra: 'unexpected' },
  ])('rejects invalid provider output', async (value) => {
    fetch.mockResolvedValue(provider(value));
    await expect(generateTaskDraft({ title: 'Task', brief: '' })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
  it('handles refusal and incomplete output', async () => {
    for (const value of [{ status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }]) {
      fetch.mockResolvedValue({ ok: true, json: async () => value });
      await expect(generateTaskDraft({ title: 'Task', brief: '' })).rejects.toMatchObject({ statusCode: 502 });
    }
  });
  it('handles provider rate limits and timeout without retrying', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(generateTaskDraft({ title: 'Task', brief: '' })).rejects.toMatchObject({ statusCode: 429 });
    fetch.mockRejectedValue(Object.assign(new Error('secret'), { name: 'TimeoutError' }));
    await expect(generateTaskDraft({ title: 'Task', brief: '' })).rejects.toMatchObject({ statusCode: 504 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('limits concurrent and repeated attempts independently per user', () => {
    const acquire = createDraftLimiter();
    const release = acquire('a');
    expect(() => acquire('a')).toThrow(/Too many/);
    acquire('b')();
    release();
    for (let i = 0; i < 4; i++) acquire('a')();
    expect(() => acquire('a')).toThrow(/Too many/);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_001);
    expect(() => acquire('a')()).not.toThrow();
  });
});
