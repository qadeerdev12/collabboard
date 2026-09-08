import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'http';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { io as createClient } from 'socket.io-client';
import { Server } from 'socket.io';
import { createApp } from '../app.js';
import { configureSockets } from '../socket.js';
import Board from '../models/Board.js';
import Card from '../models/Card.js';
import List from '../models/List.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import Comment from '../models/Comment.js';
import Message from '../models/Message.js';
import Workflow from '../models/Workflow.js';
import GitHubAccount from '../models/GitHubAccount.js';
import BoardGitHubIntegration from '../models/BoardGitHubIntegration.js';

let mongo;

describe('card checklists', () => {
  async function fixture(app) {
    const owner = await register(app, 'Owner', 'check-owner@example.com');
    const member = await register(app, 'Member', 'check-member@example.com');
    const outsider = await register(app, 'Outsider', 'check-outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, member.user.email);
    const list = await createListForBoard(app, owner.token, board._id);
    const card = await Card.create({ board: board._id, list: list._id, title: 'Checklist task', position: 1000 });
    const url = `/api/v1/boards/${board._id}/cards/${card._id}`;
    const patch = (operation, token = member.token) => request(app).patch(url)
      .set('Authorization', `Bearer ${token}`).send({ checklistOperation: operation });
    return { owner, member, outsider, board, card, url, patch };
  }

  it('persists item edits without losing concurrent changes and keeps card details intact', async () => {
    const { card, patch } = await fixture(createApp());
    expect(card.checklist).toHaveLength(0);
    await Promise.all([
      patch({ action: 'add', title: '  API tests  ' }).expect(200),
      patch({ action: 'add', title: 'Documentation' }).expect(200),
    ]);
    const saved = await Card.findById(card._id);
    expect(saved.checklist).toHaveLength(2);
    const api = saved.checklist.find((item) => item.title === 'API tests');
    const docs = saved.checklist.find((item) => item.title === 'Documentation');
    await Promise.all([
      patch({ action: 'update', itemId: api.id, completed: true }).expect(200),
      patch({ action: 'update', itemId: docs.id, title: 'API documentation' }).expect(200),
    ]);
    const updated = await Card.findById(card._id);
    expect(updated.checklist.id(api.id).completed).toBe(true);
    expect(updated.checklist.id(docs.id).title).toBe('API documentation');
    expect(updated.status).toBe('Todo');
    await patch({ action: 'update', itemId: api.id, completed: false }).expect(200);
    const removed = await patch({ action: 'remove', itemId: docs.id }).expect(200);
    expect(removed.body.data.card.checklist).toHaveLength(1);
    expect(removed.body.data.card.checklist[0].completed).toBe(false);
    await patch({ action: 'update', itemId: docs.id, completed: true }).expect(404);
  });

  it('enforces membership, item ownership, input validation, and the atomic item limit', async () => {
    const app = createApp();
    const { card, url, member, outsider, patch } = await fixture(app);
    await patch({ action: 'add', title: 'Private' }, outsider.token).expect(404);
    for (const operation of [null, { action: 'wrong' }, { action: 'add', title: ' ' }, { action: 'add', title: 'x'.repeat(301) }, { action: 'update', itemId: 'bad', completed: true }]) {
      await patch(operation).expect(400);
    }
    await patch({ action: 'update', itemId: new mongoose.Types.ObjectId().toString(), completed: true }).expect(404);
    const added = await patch({ action: 'add', title: 'Test' }).expect(200);
    await patch({ action: 'update', itemId: added.body.data.card.checklist[0]._id, completed: 'true' }).expect(400);
    await request(app).patch(url).set('Authorization', `Bearer ${member.token}`).send({ checklist: [] }).expect(400);
    await request(app).patch(url).set('Authorization', `Bearer ${member.token}`).send({ title: 'Changed', checklistOperation: { action: 'add', title: 'Test' } }).expect(400);
    await Card.updateOne({ _id: card._id }, { $set: { checklist: Array.from({ length: 99 }, (_, i) => ({ title: `Item ${i}` })) } });
    const results = await Promise.all([patch({ action: 'add', title: 'A' }), patch({ action: 'add', title: 'B' })]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    expect((await Card.findById(card._id)).checklist).toHaveLength(100);
  });

  it('broadcasts saved checklist changes over sockets and the REST fallback', async () => {
    const server = await startSocketServer();
    const sockets = [];
    try {
      const { owner, member, outsider, board, card, patch } = await fixture(server.app);
      const sender = connectSocket(server.url, owner.token);
      const viewer = connectSocket(server.url, member.token);
      const denied = connectSocket(server.url, outsider.token);
      sockets.push(sender, viewer, denied);
      await Promise.all(sockets.map(waitForConnect));
      await emitWithAck(sender, 'board:join', { boardId: board._id });
      await emitWithAck(viewer, 'board:join', { boardId: board._id });
      const payload = { boardId: board._id, cardId: card.id, updates: { checklistOperation: { action: 'add', title: 'Live item' } } };
      expect((await emitWithAck(denied, 'card:update', payload)).ok).toBe(false);
      const nextUpdate = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Missing checklist broadcast')), 2000);
        viewer.once('card:updated', (event) => { clearTimeout(timer); resolve(event); });
      });
      const broadcast = nextUpdate();
      const ack = await emitWithAck(sender, 'card:update', payload);
      expect(ack.ok).toBe(true);
      expect((await broadcast).card.checklist).toEqual(ack.data.card.checklist);
      const restBroadcast = nextUpdate();
      await patch({ action: 'update', itemId: ack.data.card.checklist[0]._id, completed: true }).expect(200);
      expect((await restBroadcast).card.checklist[0].completed).toBe(true);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await server.close();
    }
  });
});

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterEach(async () => {
  await Promise.all([
    Board.deleteMany({}),
    Card.deleteMany({}),
    List.deleteMany({}),
    User.deleteMany({}),
    Activity.deleteMany({}),
    Comment.deleteMany({}),
    Message.deleteMany({}),
    Workflow.deleteMany({}),
    GitHubAccount.deleteMany({}),
    BoardGitHubIntegration.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function register(app, name, email) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ name, email, password: 'password123' })
    .expect(201);

  return res.body.data;
}

async function createUser(name, email) {
  const passwordHash = await bcrypt.hash('password123', 4);
  return User.create({ name, email, passwordHash });
}

async function createBoardWithOwner(app, ownerToken, name = 'Roadmap') {
  const res = await request(app)
    .post('/api/v1/boards')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name })
    .expect(201);

  return res.body.data.board;
}

async function createListForBoard(app, token, boardId, title = 'Backlog') {
  const res = await request(app)
    .post(`/api/v1/boards/${boardId}/lists`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title, position: 1000 })
    .expect(201);

  return res.body.data.list;
}

async function addMember(app, ownerToken, boardId, email, role = 'member') {
  const res = await request(app)
    .post(`/api/v1/boards/${boardId}/members`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email, role })
    .expect(201);

  return res.body.data.members;
}

function emitWithAck(socket, eventName, payload) {
  return new Promise((resolve) => {
    socket.timeout(1000).emit(eventName, payload, (err, response) => {
      if (err) resolve({ ok: false, error: { message: err.message } });
      else resolve(response);
    });
  });
}

async function startSocketServer() {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: ['http://localhost:5173'], methods: ['GET', 'POST'] },
  });
  app.set('io', io);
  configureSockets(io);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();

  return {
    app,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function connectSocket(url, token) {
  return createClient(url, {
    auth: token !== undefined ? { token } : {},
    forceNew: true,
    reconnection: false,
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function waitForConnectError(socket) {
  return new Promise((resolve) => {
    socket.once('connect_error', resolve);
  });
}

describe.sequential('REST board permissions', () => {
  it('protects GitHub integration endpoints before an account is connected', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const previousConfig = {
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
      GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,
    };

    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_CALLBACK_URL;

    try {
      await request(app)
        .get('/api/v1/integrations/github/start')
        .expect(401);

      await request(app)
        .get('/api/v1/integrations/github/start')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(500)
        .expect((res) => {
          expect(res.body.error.code).toBe('GITHUB_CONFIG_MISSING');
        });

      const account = await request(app)
        .get('/api/v1/integrations/github/account')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(account.body.data.account).toBeNull();

      await request(app)
        .get('/api/v1/integrations/github/repos')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409)
        .expect((res) => {
          expect(res.body.error.code).toBe('GITHUB_NOT_CONNECTED');
        });

      await request(app)
        .delete('/api/v1/integrations/github/account')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.disconnected).toBe(true);
        });
    } finally {
      Object.entries(previousConfig).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    }
  });

  it('asks old GitHub connections to reconnect before listing repositories', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    await GitHubAccount.create({
      user: owner.user.id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'token-without-repo-scope',
      scopes: ['read:user', 'user:email'],
    });

    await request(app)
      .get('/api/v1/integrations/github/repos')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('GITHUB_REPO_SCOPE_REQUIRED');
      });
  });

  it('encrypts stored GitHub access tokens while keeping them usable for API calls', async () => {
    const owner = await createUser('Owner', 'owner@example.com');
    const account = await GitHubAccount.create({
      user: owner._id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'plain-text-token',
      scopes: ['read:user', 'user:email', 'repo'],
    });

    const storedAccount = await GitHubAccount.findById(account._id).select('+accessToken');
    expect(storedAccount.accessToken).not.toBe('plain-text-token');
    expect(storedAccount.accessToken.startsWith('enc:v1:')).toBe(true);
    expect(storedAccount.getAccessToken()).toBe('plain-text-token');
  });

  it('revokes GitHub tokens and removes linked project repos on disconnect', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const account = await GitHubAccount.create({
      user: owner.user.id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'token-to-revoke',
      scopes: ['read:user', 'user:email', 'repo'],
    });
    await BoardGitHubIntegration.create({
      board: board._id,
      connectedBy: owner.user.id,
      githubAccount: account._id,
      repoId: '1001',
      repoOwner: 'octocat',
      repoName: 'sdlcflow',
      repoFullName: 'octocat/sdlcflow',
      repoUrl: 'https://github.com/octocat/sdlcflow',
    });

    const previousConfig = {
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    };
    const previousFetch = global.fetch;
    process.env.GITHUB_CLIENT_ID = 'github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
    const revokeCalls = [];
    global.fetch = async (url, options) => {
      revokeCalls.push({ url, options });
      return {
        status: 204,
        ok: true,
        json: async () => ({}),
      };
    };

    try {
      await request(app)
        .delete('/api/v1/integrations/github/account')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toMatchObject({
            disconnected: true,
            revoked: true,
            unlinkedProjects: 1,
          });
        });

      expect(revokeCalls).toHaveLength(1);
      expect(revokeCalls[0].url).toContain('/applications/github-client-id/token');
      expect(JSON.parse(revokeCalls[0].options.body)).toEqual({ access_token: 'token-to-revoke' });
      await expect(GitHubAccount.countDocuments({ user: owner.user.id })).resolves.toBe(0);
      await expect(BoardGitHubIntegration.countDocuments({ board: board._id })).resolves.toBe(0);
    } finally {
      global.fetch = previousFetch;
      Object.entries(previousConfig).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    }
  });

  it('returns a clear GitHub rate-limit response when GitHub throttles repository reads', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    await GitHubAccount.create({
      user: owner.user.id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'repo-token',
      scopes: ['read:user', 'user:email', 'repo'],
    });

    const previousFetch = global.fetch;
    global.fetch = async () => ({
      status: 403,
      ok: false,
      headers: {
        get: (name) => {
          if (name === 'x-ratelimit-remaining') return '0';
          if (name === 'x-ratelimit-reset') return '1788307200';
          return null;
        },
      },
      json: async () => ({ message: 'API rate limit exceeded.' }),
    });

    try {
      await request(app)
        .get('/api/v1/integrations/github/repos')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(429)
        .expect((res) => {
          expect(res.body.error).toMatchObject({
            code: 'GITHUB_RATE_LIMITED',
            message: 'GitHub rate limit reached. Please try again shortly.',
            resetAt: '2026-09-02T00:00:00.000Z',
          });
        });
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('summarizes GitHub dashboard stats for the connected user', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const visibleBoard = await createBoardWithOwner(app, owner.token, 'Visible project');
    const hiddenBoard = await createBoardWithOwner(app, outsider.token, 'Hidden project');
    const account = await GitHubAccount.create({
      user: owner.user.id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'repo-token',
      scopes: ['read:user', 'user:email', 'repo'],
    });
    await BoardGitHubIntegration.create({
      board: visibleBoard._id,
      connectedBy: owner.user.id,
      githubAccount: account._id,
      repoId: '1001',
      repoOwner: 'octocat',
      repoName: 'sdlcflow',
      repoFullName: 'octocat/sdlcflow',
      repoUrl: 'https://github.com/octocat/sdlcflow',
      language: 'JavaScript',
    });
    await BoardGitHubIntegration.create({
      board: hiddenBoard._id,
      connectedBy: owner.user.id,
      githubAccount: account._id,
      repoId: '1002',
      repoOwner: 'octocat',
      repoName: 'hidden',
      repoFullName: 'octocat/hidden',
      repoUrl: 'https://github.com/octocat/hidden',
      language: 'TypeScript',
    });

    const previousFetch = global.fetch;
    global.fetch = async (url) => {
      if (url === 'https://api.github.com/graphql') {
        return {
          ok: true,
          json: async () => ({
            data: {
              viewer: {
                today: { totalCommitContributions: 2 },
                week: { totalCommitContributions: 9 },
                year: {
                  totalCommitContributions: 144,
                  contributionCalendar: {
                    weeks: [
                      {
                        contributionDays: [
                          { date: '2026-08-31', contributionCount: 1 },
                          { date: '2026-09-01', contributionCount: 4 },
                          { date: '2026-09-02', contributionCount: 2 },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => [
          {
            id: 1,
            name: 'sdlcflow',
            full_name: 'octocat/sdlcflow',
            owner: { login: 'octocat' },
            private: true,
            html_url: 'https://github.com/octocat/sdlcflow',
            description: 'Project management for builders',
            default_branch: 'main',
            language: 'JavaScript',
            updated_at: '2026-09-02T00:00:00.000Z',
          },
          {
            id: 2,
            name: 'api',
            full_name: 'octocat/api',
            owner: { login: 'octocat' },
            private: false,
            html_url: 'https://github.com/octocat/api',
            default_branch: 'main',
            language: 'JavaScript',
            updated_at: '2026-09-01T00:00:00.000Z',
          },
          {
            id: 3,
            name: 'docs',
            full_name: 'octocat/docs',
            owner: { login: 'octocat' },
            private: false,
            html_url: 'https://github.com/octocat/docs',
            default_branch: 'main',
            language: 'Markdown',
            updated_at: '2026-08-31T00:00:00.000Z',
          },
        ],
      };
    };

    try {
      await request(app)
        .get('/api/v1/integrations/github/dashboard')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.connected).toBe(true);
          expect(res.body.data.account.username).toBe('octocat');
          expect(res.body.data.stats).toMatchObject({
            repositories: 3,
            publicRepositories: 2,
            privateRepositories: 1,
            linkedProjects: 1,
            linkedRepositories: 1,
          });
          expect(res.body.data.languages[0]).toEqual({ name: 'JavaScript', count: 2 });
          expect(res.body.data.commitGraph).toMatchObject({ today: 2, week: 9, year: 144 });
          expect(res.body.data.commitGraph.dailyContributions).toEqual([
            { date: '2026-08-31', count: 1 },
            { date: '2026-09-01', count: 4 },
            { date: '2026-09-02', count: 2 },
          ]);
          expect(res.body.data.linkedProjects).toHaveLength(1);
          expect(res.body.data.linkedProjects[0].board.name).toBe('Visible project');
        });
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('enforces roles for project GitHub repository links', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const admin = await register(app, 'Admin', 'admin@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, member.user.email, 'member');
    await addMember(app, owner.token, board._id, admin.user.email, 'admin');

    await GitHubAccount.create({
      user: owner.user.id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'owner-token',
      scopes: ['read:user', 'user:email', 'repo'],
    });
    await GitHubAccount.create({
      user: admin.user.id,
      githubId: '67890',
      username: 'hubot',
      accessToken: 'admin-token',
      scopes: ['read:user', 'user:email', 'repo'],
    });

    await request(app)
      .get(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);

    const empty = await request(app)
      .get(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(empty.body.data.integration).toBeNull();

    await request(app)
      .put(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({
        id: 1001,
        fullName: 'octocat/sdlcflow',
        owner: 'octocat',
        name: 'sdlcflow',
        htmlUrl: 'https://github.com/octocat/sdlcflow',
        defaultBranch: 'main',
        private: true,
      })
      .expect(403);

    const linked = await request(app)
      .put(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        id: 1001,
        fullName: 'octocat/sdlcflow',
        owner: 'octocat',
        name: 'sdlcflow',
        htmlUrl: 'https://github.com/octocat/sdlcflow',
        defaultBranch: 'main',
        private: true,
        language: 'JavaScript',
      })
      .expect(200);

    expect(linked.body.data.integration).toMatchObject({
      repoId: '1001',
      repoOwner: 'octocat',
      repoName: 'sdlcflow',
      repoFullName: 'octocat/sdlcflow',
      repoUrl: 'https://github.com/octocat/sdlcflow',
      defaultBranch: 'main',
      private: true,
      language: 'JavaScript',
    });
    expect(linked.body.data.activity.action).toBe('github.repo_linked');

    const visibleToMember = await request(app)
      .get(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(visibleToMember.body.data.integration.repoFullName).toBe('octocat/sdlcflow');

    const changedByAdmin = await request(app)
      .put(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        repoId: 'repo-2',
        repoOwner: 'hubot',
        repoName: 'api',
        repoFullName: 'hubot/api',
        repoUrl: 'https://github.com/hubot/api',
      })
      .expect(200);
    expect(changedByAdmin.body.data.integration.repoFullName).toBe('hubot/api');

    await request(app)
      .delete(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403);

    const unlinked = await request(app)
      .delete(`/api/v1/boards/${board._id}/integrations/github`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(unlinked.body.data.unlinked).toBe(true);
    expect(unlinked.body.data.integration).toBeNull();
    expect(unlinked.body.data.activity.action).toBe('github.repo_unlinked');

    await request(app)
      .get(`/api/v1/boards/${board._id}/github/commits`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('GITHUB_REPO_NOT_LINKED');
      });

    await request(app)
      .get(`/api/v1/boards/${board._id}/github/stats`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(409)
      .expect((res) => {
        expect(res.body.error.code).toBe('GITHUB_REPO_NOT_LINKED');
      });
  });

  it('records newly synced GitHub commits in project activity without duplicates', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, member.user.email, 'member');

    const githubAccount = await GitHubAccount.create({
      user: owner.user.id,
      githubId: '12345',
      username: 'octocat',
      accessToken: 'owner-token',
      scopes: ['read:user', 'user:email', 'repo'],
    });
    await BoardGitHubIntegration.create({
      board: board._id,
      connectedBy: owner.user.id,
      githubAccount: githubAccount._id,
      repoId: '1001',
      repoOwner: 'octocat',
      repoName: 'sdlcflow',
      repoFullName: 'octocat/sdlcflow',
      repoUrl: 'https://github.com/octocat/sdlcflow',
      defaultBranch: 'main',
    });

    const previousFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => [
        {
          sha: 'abc1234567890',
          html_url: 'https://github.com/octocat/sdlcflow/commit/abc1234',
          commit: {
            message: 'Ship GitHub activity feed\n\nConnect commits to the timeline.',
            author: { name: 'Alex Kim', date: '2026-09-02T00:00:00.000Z' },
          },
          author: { login: 'alexkim', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
        },
        {
          sha: 'def9876543210',
          html_url: 'https://github.com/octocat/sdlcflow/commit/def9876',
          commit: {
            message: 'Polish repository panel',
            author: { name: 'Jamie Lee', date: '2026-09-01T00:00:00.000Z' },
          },
          author: { login: 'jamielee', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' },
        },
      ],
    });

    try {
      const firstSync = await request(app)
        .get(`/api/v1/boards/${board._id}/github/commits`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
      expect(firstSync.body.data.commits).toHaveLength(2);
      expect(firstSync.body.data.activities).toHaveLength(2);
      expect(firstSync.body.data.activities[1]).toMatchObject({
        action: 'github.commit_synced',
        targetTitle: 'Ship GitHub activity feed',
      });
      expect(firstSync.body.data.activities[1].metadata).toMatchObject({
        repoFullName: 'octocat/sdlcflow',
        sha: 'abc1234567890',
        shortSha: 'abc1234',
        authorUsername: 'alexkim',
      });
      await expect(Activity.countDocuments({ board: board._id, action: 'github.commit_synced' })).resolves.toBe(2);

      const secondSync = await request(app)
        .get(`/api/v1/boards/${board._id}/github/commits`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
      expect(secondSync.body.data.activities).toEqual([]);
      await expect(Activity.countDocuments({ board: board._id, action: 'github.commit_synced' })).resolves.toBe(2);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('serves the workflow template catalog and keeps the old board-template alias', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');

    await request(app)
      .get('/api/v1/workflow-templates')
      .expect(401);

    const res = await request(app)
      .get('/api/v1/workflow-templates')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(res.body.data.templates.length).toBeGreaterThan(0);
    expect(res.body.data.templates[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      lists: expect.any(Array),
      cards: expect.any(Array),
    });

    const alias = await request(app)
      .get('/api/v1/board-templates')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(alias.body.data.templates[0].id).toBe(res.body.data.templates[0].id);
  });

  it('creates a project container with only the default workflow', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');

    const res = await request(app)
      .post('/api/v1/boards')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Uptime Desk', emoji: 'api', color: 'sky' })
      .expect(201);

    expect(res.body.data.board).toMatchObject({
      name: 'Uptime Desk',
      emoji: 'api',
      color: 'sky',
    });
    expect(res.body.data.workflows).toHaveLength(1);
    expect(res.body.data.workflows[0]).toMatchObject({
      name: 'General',
      templateKey: 'default',
    });
    expect(res.body.data.lists).toEqual([]);
    expect(res.body.data.cards).toEqual([]);

    await expect(List.countDocuments({ board: res.body.data.board._id })).resolves.toBe(0);
    await expect(Card.countDocuments({ board: res.body.data.board._id })).resolves.toBe(0);
    await expect(Workflow.countDocuments({ board: res.body.data.board._id })).resolves.toBe(1);
  });

  it('ignores legacy board template fields during project creation', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');

    const res = await request(app)
      .post('/api/v1/boards')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        name: 'Release project',
        templateId: 'software-sprint',
        workflowTemplateId: 'release-plan',
      })
      .expect(201);

    expect(res.body.data.workflows[0]).toMatchObject({
      name: 'General',
      templateKey: 'default',
    });
    expect(res.body.data.lists).toEqual([]);
    expect(res.body.data.cards).toEqual([]);
    await expect(Board.countDocuments({ name: 'Release project' })).resolves.toBe(1);
  });

  it('backfills a default workflow when an older board is opened', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const legacyBoard = await Board.create({
      name: 'Legacy board',
      owner: owner.user.id,
      members: [{ user: owner.user.id, role: 'owner' }],
    });
    const legacyList = await List.create({
      board: legacyBoard._id,
      title: 'Legacy backlog',
      position: 1000,
    });
    const legacyCard = await Card.create({
      board: legacyBoard._id,
      list: legacyList._id,
      title: 'Legacy task',
      position: 1000,
    });

    await expect(Workflow.countDocuments({ board: legacyBoard._id })).resolves.toBe(0);
    await expect(List.countDocuments({ board: legacyBoard._id, workflow: null })).resolves.toBe(1);
    await expect(Card.countDocuments({ board: legacyBoard._id, workflow: null })).resolves.toBe(1);

    const loaded = await request(app)
      .get(`/api/v1/boards/${legacyBoard._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(loaded.body.data.workflows).toHaveLength(1);
    expect(loaded.body.data.workflows[0]).toMatchObject({
      name: 'General',
      templateKey: 'default',
    });
    await expect(Workflow.countDocuments({ board: legacyBoard._id })).resolves.toBe(1);
    expect(loaded.body.data.lists[0].workflow).toBe(loaded.body.data.workflows[0]._id);
    expect(loaded.body.data.cards[0].workflow).toBe(loaded.body.data.workflows[0]._id);
    await expect(List.countDocuments({ board: legacyBoard._id, workflow: null })).resolves.toBe(0);
    await expect(Card.countDocuments({ board: legacyBoard._id, workflow: null })).resolves.toBe(0);
  });

  it('stores optional workflow references on lists and cards without requiring them yet', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const workflow = await Workflow.findOne({ board: board._id, templateKey: 'default' });

    const workflowList = await List.create({
      board: board._id,
      workflow: workflow._id,
      title: 'Workflow backlog',
      position: 1000,
    });
    const legacyList = await List.create({
      board: board._id,
      title: 'Legacy backlog',
      position: 2000,
    });
    const workflowCard = await Card.create({
      board: board._id,
      workflow: workflow._id,
      list: workflowList._id,
      title: 'Workflow-scoped card',
      position: 1000,
    });
    const legacyCard = await Card.create({
      board: board._id,
      list: legacyList._id,
      title: 'Legacy card',
      position: 2000,
    });

    expect(workflowList.workflow.toString()).toBe(workflow._id.toString());
    expect(workflowCard.workflow.toString()).toBe(workflow._id.toString());
    expect(legacyList.workflow).toBeNull();
    expect(legacyCard.workflow).toBeNull();
  });

  it('creates lists and cards in the requested workflow with a default fallback', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const defaultWorkflow = await Workflow.findOne({ board: board._id, templateKey: 'default' });
    const triageWorkflow = await Workflow.create({
      board: board._id,
      name: 'Bug triage',
      templateKey: 'bug-triage',
      icon: 'bug',
      color: 'rose',
      position: 2000,
    });

    const defaultList = await request(app)
      .post(`/api/v1/boards/${board._id}/lists`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Default backlog', position: 1000 })
      .expect(201);
    expect(defaultList.body.data.list.workflow).toBe(defaultWorkflow._id.toString());

    const triageList = await request(app)
      .post(`/api/v1/boards/${board._id}/lists`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Triage backlog', workflowId: triageWorkflow._id, position: 2000 })
      .expect(201);
    expect(triageList.body.data.list.workflow).toBe(triageWorkflow._id.toString());

    const defaultCard = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: defaultList.body.data.list._id, title: 'Default card', position: 1000 })
      .expect(201);
    expect(defaultCard.body.data.card.workflow).toBe(defaultWorkflow._id.toString());

    const triageCard = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        listId: triageList.body.data.list._id,
        workflowId: triageWorkflow._id,
        title: 'Triage card',
        position: 1000,
      })
      .expect(201);
    expect(triageCard.body.data.card.workflow).toBe(triageWorkflow._id.toString());
  });

  it('rejects list/card creation with invalid or mismatched workflows', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const otherBoard = await createBoardWithOwner(app, owner.token, 'Other project');
    const otherWorkflow = await Workflow.findOne({ board: otherBoard._id, templateKey: 'default' });
    const defaultList = await createListForBoard(app, owner.token, board._id, 'Default backlog');
    const customWorkflow = await Workflow.create({
      board: board._id,
      name: 'Release plan',
      templateKey: 'release-plan',
      icon: 'deploy',
      color: 'emerald',
      position: 2000,
    });

    await request(app)
      .post(`/api/v1/boards/${board._id}/lists`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Broken list', workflowId: 'not-an-id' })
      .expect(400);

    await request(app)
      .post(`/api/v1/boards/${board._id}/lists`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Wrong project list', workflowId: otherWorkflow._id })
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: defaultList._id, title: 'Wrong project card', workflowId: otherWorkflow._id })
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: defaultList._id, title: 'Mismatched card', workflowId: customWorkflow._id })
      .expect(400);
  });

  it('keeps card moves inside a workflow and backfills legacy move targets', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const defaultWorkflow = await Workflow.findOne({ board: board._id, templateKey: 'default' });
    const sourceList = await createListForBoard(app, owner.token, board._id, 'Ready');
    const targetList = await createListForBoard(app, owner.token, board._id, 'Doing');
    const legacyTarget = await List.create({
      board: board._id,
      title: 'Legacy QA',
      position: 3000,
    });
    const card = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: sourceList._id, title: 'Move me', position: 1000 })
      .expect(201);

    const moved = await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ list: targetList._id, position: 2000 })
      .expect(200);
    expect(moved.body.data.card.list).toBe(targetList._id.toString());
    expect(moved.body.data.card.workflow).toBe(defaultWorkflow._id.toString());

    const legacyMove = await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ list: legacyTarget._id, position: 3000 })
      .expect(200);
    const updatedLegacyTarget = await List.findById(legacyTarget._id);
    expect(legacyMove.body.data.card.workflow).toBe(defaultWorkflow._id.toString());
    expect(updatedLegacyTarget.workflow.toString()).toBe(defaultWorkflow._id.toString());
  });

  it('rejects direct workflow updates and cross-workflow card moves', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const customWorkflow = await Workflow.create({
      board: board._id,
      name: 'Release plan',
      templateKey: 'release-plan',
      icon: 'deploy',
      color: 'emerald',
      position: 2000,
    });
    const defaultList = await createListForBoard(app, owner.token, board._id, 'Default backlog');
    const releaseList = await request(app)
      .post(`/api/v1/boards/${board._id}/lists`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Release backlog', workflowId: customWorkflow._id, position: 2000 })
      .expect(201);
    const card = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: defaultList._id, title: 'Default card', position: 1000 })
      .expect(201);

    await request(app)
      .patch(`/api/v1/boards/${board._id}/lists/${defaultList._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ workflowId: customWorkflow._id })
      .expect(400);

    await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ workflowId: customWorkflow._id })
      .expect(400);

    await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ list: releaseList.body.data.list._id, position: 2000 })
      .expect(400);
  });

  it('lets board members view workflows and only owners/admins create them', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const admin = await register(app, 'Admin', 'admin@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, admin.user.email, 'admin');
    await addMember(app, owner.token, board._id, member.user.email, 'member');

    await request(app)
      .get(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ name: 'Member-created sprint' })
      .expect(403);

    await request(app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '', position: 1000 })
      .expect(400);

    const created = await request(app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'API Roadmap',
        icon: 'workflow',
        color: 'slate',
        position: 2000,
      })
      .expect(201);

    expect(created.body.data.workflow).toMatchObject({
      name: 'API Roadmap',
      templateKey: 'custom',
      icon: 'workflow',
      color: 'slate',
      position: 2000,
    });
    expect(created.body.data.lists).toEqual([]);
    expect(created.body.data.cards).toEqual([]);
    expect(created.body.data.activity.action).toBe('workflow.created');

    const workflows = await request(app)
      .get(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    expect(workflows.body.data.workflows).toHaveLength(2);
    expect(workflows.body.data.workflows.map((workflow) => workflow.name)).toEqual(['General', 'API Roadmap']);
    await expect(Workflow.countDocuments({ board: board._id })).resolves.toBe(2);
    await expect(Activity.countDocuments({ board: board._id, action: 'workflow.created' })).resolves.toBe(1);
  });

  it('creates a workflow from a template inside an existing board', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const admin = await register(app, 'Admin', 'admin@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, admin.user.email, 'admin');
    await addMember(app, owner.token, board._id, member.user.email, 'member');

    await request(app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ workflowTemplateId: 'bug-triage' })
      .expect(403);

    const created = await request(app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ workflowTemplateId: 'bug-triage' })
      .expect(201);

    expect(created.body.data.workflow).toMatchObject({
      name: 'Bug Triage',
      templateKey: 'bug-triage',
      icon: 'bug',
      color: 'rose',
      position: 2000,
    });
    expect(created.body.data.lists.map((list) => list.title)).toEqual([
      'Reported',
      'Reproducing',
      'Prioritized',
      'Fixing',
      'Verifying',
      'Closed',
    ]);
    expect(created.body.data.cards.map((card) => card.workflow)).toEqual(
      created.body.data.cards.map(() => created.body.data.workflow._id)
    );
    expect(created.body.data.activity.action).toBe('workflow.created');

    await expect(Workflow.countDocuments({ board: board._id })).resolves.toBe(2);
    await expect(List.countDocuments({ board: board._id, workflow: created.body.data.workflow._id })).resolves.toBe(6);
    await expect(Card.countDocuments({ board: board._id, workflow: created.body.data.workflow._id })).resolves.toBe(3);
  });

  it('rejects unknown workflow templates on existing boards without partial data', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);

    await request(app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ workflowTemplateId: 'missing-template' })
      .expect(400);

    await expect(Workflow.countDocuments({ board: board._id })).resolves.toBe(1);
    await expect(List.countDocuments({ board: board._id })).resolves.toBe(0);
    await expect(Card.countDocuments({ board: board._id })).resolves.toBe(0);
  });

  it('hides private boards from non-members and rejects their mutations', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);

    await request(app)
      .get(`/api/v1/boards/${board._id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/lists`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ title: 'Sneaky list', position: 1000 })
      .expect(404);
  });

  it('allows members to change work items but not board settings', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, member.user.email, 'member');

    await request(app)
      .patch(`/api/v1/boards/${board._id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ name: 'Member rename' })
      .expect(403);

    const list = await createListForBoard(app, member.token, board._id, 'Doing');
    await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ listId: list._id, title: 'Ship tests', position: 1000, tag: 'Task', status: 'Todo' })
      .expect(201);

    const activities = await request(app)
      .get(`/api/v1/boards/${board._id}/activities`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(activities.body.data.activities.map((activity) => activity.action)).toContain('card.created');
  });

  it('keeps board activity private to members', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await createListForBoard(app, owner.token, board._id);

    await request(app)
      .get(`/api/v1/boards/${board._id}/activities`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
  });

  it('only allows cards to be assigned to board members', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const teammate = await register(app, 'Teammate', 'teammate@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const list = await createListForBoard(app, owner.token, board._id);
    await addMember(app, owner.token, board._id, teammate.user.email, 'member');

    const assigned = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        listId: list._id,
        title: 'Assigned task',
        position: 1000,
        assignee: teammate.user.id,
        dueDate: '2026-09-02',
      })
      .expect(201);

    expect(assigned.body.data.card.assignee._id).toBe(teammate.user.id);
    expect(assigned.body.data.card.dueDate).toBeTruthy();

    await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        listId: list._id,
        title: 'Wrong assignee',
        position: 2000,
        assignee: outsider.user.id,
      })
      .expect(400);

    await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${assigned.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assignee: outsider.user.id })
      .expect(400);

    await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${assigned.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assignee: null, dueDate: null })
      .expect(200);

    await expect(Card.countDocuments({ board: board._id })).resolves.toBe(1);
  });

  it('stores optional GitHub references on cards', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const list = await createListForBoard(app, owner.token, board._id);
    const created = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: list._id, title: 'GitHub linked task', position: 1000 })
      .expect(201);

    const linked = await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${created.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ githubUrl: 'https://github.com/qadeerafzal/SDLCFlow/issues/12' })
      .expect(200);
    expect(linked.body.data.card.githubUrl).toBe('https://github.com/qadeerafzal/SDLCFlow/issues/12');

    await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${created.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ githubUrl: 'https://example.com/not-github' })
      .expect(400);

    const cleared = await request(app)
      .patch(`/api/v1/boards/${board._id}/cards/${created.body.data.card._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ githubUrl: '' })
      .expect(200);
    expect(cleared.body.data.card.githubUrl).toBe('');
  });

  it('keeps card comments board-scoped and records comment activity', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    const list = await createListForBoard(app, owner.token, board._id);
    await addMember(app, owner.token, board._id, member.user.email, 'member');
    const card = await request(app)
      .post(`/api/v1/boards/${board._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: list._id, title: 'Comment target', position: 1000 })
      .expect(201);

    await request(app)
      .get(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}/comments`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}/comments`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ body: 'No access' })
      .expect(404);

    const created = await request(app)
      .post(`/api/v1/boards/${board._id}/cards/${card.body.data.card._id}/comments`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ body: 'I will take this one.' })
      .expect(201);

    expect(created.body.data.comment.body).toBe('I will take this one.');
    expect(created.body.data.comment.author._id).toBe(member.user.id);
    expect(created.body.data.activity.action).toBe('comment.created');
    await expect(Comment.countDocuments({ board: board._id })).resolves.toBe(1);
  });

  it('keeps board chat private to members and persists messages', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const outsider = await register(app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, member.user.email, 'member');

    await request(app)
      .get(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ body: 'No access' })
      .expect(404);

    await request(app)
      .post(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ body: '' })
      .expect(400);

    const created = await request(app)
      .post(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ body: 'Can someone review the API task?' })
      .expect(201);

    expect(created.body.data.message.body).toBe('Can someone review the API task?');
    expect(created.body.data.message.sender._id).toBe(member.user.id);

    const messages = await request(app)
      .get(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(messages.body.data.messages).toHaveLength(1);
    expect(messages.body.data.messages[0].body).toBe('Can someone review the API task?');
    await expect(Message.countDocuments({ board: board._id })).resolves.toBe(1);
  });

  it('enforces board chat moderation permissions', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const admin = await register(app, 'Admin', 'admin@example.com');
    const member = await register(app, 'Member', 'member@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, admin.user.email, 'admin');
    await addMember(app, owner.token, board._id, member.user.email, 'member');

    const ownerMessage = await request(app)
      .post(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Owner decision.' })
      .expect(201);
    const memberMessage = await request(app)
      .post(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ body: 'Member update.' })
      .expect(201);

    await request(app)
      .delete(`/api/v1/boards/${board._id}/messages/${ownerMessage.body.data.message._id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403);

    await request(app)
      .delete(`/api/v1/boards/${board._id}/messages/${ownerMessage.body.data.message._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403);

    await request(app)
      .delete(`/api/v1/boards/${board._id}/messages/${memberMessage.body.data.message._id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);

    const memberDeleted = await request(app)
      .delete(`/api/v1/boards/${board._id}/messages/${memberMessage.body.data.message._id}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(memberDeleted.body.data.message.deletedAt).toBeTruthy();
    expect(memberDeleted.body.data.activity.action).toBe('message.deleted');

    await request(app)
      .delete(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403);

    await request(app)
      .post(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ body: 'Clear this one.' })
      .expect(201);

    const cleared = await request(app)
      .delete(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(cleared.body.data.deletedCount).toBe(3);
    expect(cleared.body.data.activity.action).toBe('chat.cleared');

    const messages = await request(app)
      .get(`/api/v1/boards/${board._id}/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(messages.body.data.messages).toHaveLength(0);
    await expect(Activity.countDocuments({ board: board._id, action: 'message.deleted' })).resolves.toBe(1);
    await expect(Activity.countDocuments({ board: board._id, action: 'chat.cleared' })).resolves.toBe(1);
  });

  it('loads profile stats and deletes an account with related personal data', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const user = await register(app, 'User', 'user@example.com');
    const ownedBoard = await createBoardWithOwner(app, user.token, 'Personal project');
    const sharedBoard = await createBoardWithOwner(app, owner.token, 'Shared project');
    await addMember(app, owner.token, sharedBoard._id, user.user.email, 'member');

    const ownedList = await createListForBoard(app, user.token, ownedBoard._id);
    await request(app)
      .post(`/api/v1/boards/${ownedBoard._id}/cards`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ listId: ownedList._id, title: 'Owned card', position: 1000 })
      .expect(201);

    const sharedList = await createListForBoard(app, owner.token, sharedBoard._id);
    const sharedCard = await request(app)
      .post(`/api/v1/boards/${sharedBoard._id}/cards`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ listId: sharedList._id, title: 'Shared card', position: 1000, assignee: user.user.id })
      .expect(201);
    await request(app)
      .post(`/api/v1/boards/${sharedBoard._id}/cards/${sharedCard.body.data.card._id}/comments`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ body: 'Leaving a note before account deletion.' })
      .expect(201);
    await request(app)
      .post(`/api/v1/boards/${sharedBoard._id}/messages`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ body: 'Shared board chat before account deletion.' })
      .expect(201);

    const profile = await request(app)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(profile.body.data.user.email).toBe(user.user.email);
    expect(profile.body.data.stats.boards).toBe(2);
    expect(profile.body.data.stats.ownedBoards).toBe(1);
    expect(profile.body.data.stats.assignedCards).toBe(1);
    expect(profile.body.data.stats.comments).toBe(1);
    await expect(Message.countDocuments({ sender: user.user.id })).resolves.toBe(1);

    await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: 'wrong-password' })
      .expect(401);

    await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: 'password123' })
      .expect(200);

    await expect(User.exists({ _id: user.user.id })).resolves.toBeNull();
    await expect(Board.exists({ _id: ownedBoard._id })).resolves.toBeNull();
    await expect(List.countDocuments({ board: ownedBoard._id })).resolves.toBe(0);
    await expect(Card.countDocuments({ board: ownedBoard._id })).resolves.toBe(0);
    await expect(Comment.countDocuments({ author: user.user.id })).resolves.toBe(0);
    await expect(Message.countDocuments({ sender: user.user.id })).resolves.toBe(0);
    await expect(Activity.countDocuments({ actor: user.user.id })).resolves.toBe(0);

    const remainingBoard = await Board.findById(sharedBoard._id);
    expect(remainingBoard.members.some((member) => member.user.toString() === user.user.id)).toBe(false);
    const remainingCard = await Card.findById(sharedCard.body.data.card._id);
    expect(remainingCard.assignee).toBeNull();
  });

  it('updates profile details and password with credential checks', async () => {
    const app = createApp();
    const user = await register(app, 'Old Name', 'old@example.com');
    await register(app, 'Taken Email', 'taken@example.com');

    await request(app)
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Duplicate', email: 'taken@example.com' })
      .expect(409);

    const profile = await request(app)
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'New Name', email: 'new@example.com' })
      .expect(200);

    expect(profile.body.data.user.name).toBe('New Name');
    expect(profile.body.data.user.email).toBe('new@example.com');

    await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ currentPassword: 'wrong-password', newPassword: 'new-password-123' })
      .expect(401);

    await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ currentPassword: 'password123', newPassword: 'new-password-123' })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'new@example.com', password: 'password123' })
      .expect(401);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'new@example.com', password: 'new-password-123' })
      .expect(200);
  });

  it('keeps owner-only actions out of admin hands', async () => {
    const app = createApp();
    const owner = await register(app, 'Owner', 'owner@example.com');
    const admin = await register(app, 'Admin', 'admin@example.com');
    const member = await createUser('Member', 'member@example.com');
    const board = await createBoardWithOwner(app, owner.token);
    await addMember(app, owner.token, board._id, admin.user.email, 'admin');

    await request(app)
      .patch(`/api/v1/boards/${board._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Admin rename' })
      .expect(200);

    await request(app)
      .delete(`/api/v1/boards/${board._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403);

    await request(app)
      .patch(`/api/v1/boards/${board._id}/members/${member._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'admin' })
      .expect(403);
  });
});

describe.sequential('Socket.IO board permissions', () => {
  it('rejects invalid JWTs during the handshake', async () => {
    const server = await startSocketServer();
    const socket = connectSocket(server.url, 'not-a-real-token');

    const err = await waitForConnectError(socket);
    expect(err.message).toBe('Invalid authentication token.');

    socket.disconnect();
    await server.close();
  });

  it('checks membership before joining rooms and mutating cards', async () => {
    const server = await startSocketServer();
    const owner = await register(server.app, 'Owner', 'owner@example.com');
    const outsider = await register(server.app, 'Outsider', 'outsider@example.com');
    const board = await createBoardWithOwner(server.app, owner.token);
    const list = await createListForBoard(server.app, owner.token, board._id);
    const socket = connectSocket(server.url, outsider.token);
    await waitForConnect(socket);

    const join = await emitWithAck(socket, 'board:join', { boardId: board._id });
    expect(join.ok).toBe(false);
    expect(join.error.code).toBe('NOT_FOUND');

    const create = await emitWithAck(socket, 'card:create', {
      boardId: board._id,
      listId: list._id,
      title: 'Unauthorized card',
      position: 1000,
    });
    expect(create.ok).toBe(false);
    expect(create.error.code).toBe('NOT_FOUND');
    await expect(Card.countDocuments({ board: board._id })).resolves.toBe(0);

    socket.disconnect();
    await server.close();
  });

  it('acks the sender and broadcasts persisted card changes to collaborators', async () => {
    const server = await startSocketServer();
    const owner = await register(server.app, 'Owner', 'owner@example.com');
    const collaborator = await register(server.app, 'Collaborator', 'collab@example.com');
    const board = await createBoardWithOwner(server.app, owner.token);
    const list = await createListForBoard(server.app, owner.token, board._id);
    await addMember(server.app, owner.token, board._id, collaborator.user.email, 'member');

    const ownerSocket = connectSocket(server.url, owner.token);
    const collaboratorSocket = connectSocket(server.url, collaborator.token);
    await Promise.all([waitForConnect(ownerSocket), waitForConnect(collaboratorSocket)]);
    await emitWithAck(ownerSocket, 'board:join', { boardId: board._id });
    await emitWithAck(collaboratorSocket, 'board:join', { boardId: board._id });

    const broadcast = new Promise((resolve) => {
      collaboratorSocket.once('card:created', resolve);
    });
    const activityBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('activity:created', resolve);
    });
    const ack = await emitWithAck(ownerSocket, 'card:create', {
      boardId: board._id,
      listId: list._id,
      title: 'Realtime card',
      position: 1000,
      tag: 'Feature',
      status: 'In Progress',
    });

    expect(ack.ok).toBe(true);
    expect(ack.data.card.title).toBe('Realtime card');
    expect(ack.data.card._id).toBeTruthy();

    const payload = await broadcast;
    const activityPayload = await activityBroadcast;
    expect(payload.boardId).toBe(board._id.toString());
    expect(payload.card._id.toString()).toBe(ack.data.card._id.toString());
    expect(activityPayload.activity.action).toBe('card.created');
    expect(ack.data.activity.action).toBe('card.created');
    await expect(Card.countDocuments({ board: board._id })).resolves.toBe(1);
    await expect(Activity.countDocuments({ board: board._id })).resolves.toBe(3);

    const commentBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('comment:created', resolve);
    });
    const commentActivityBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('activity:created', resolve);
    });
    const commentAck = await emitWithAck(ownerSocket, 'comment:create', {
      boardId: board._id,
      cardId: ack.data.card._id,
      body: 'This is ready for review.',
    });

    expect(commentAck.ok).toBe(true);
    expect(commentAck.data.comment.body).toBe('This is ready for review.');
    const commentPayload = await commentBroadcast;
    const commentActivityPayload = await commentActivityBroadcast;
    expect(commentPayload.cardId).toBe(ack.data.card._id.toString());
    expect(commentPayload.comment._id.toString()).toBe(commentAck.data.comment._id.toString());
    expect(commentActivityPayload.activity.action).toBe('comment.created');
    await expect(Comment.countDocuments({ board: board._id })).resolves.toBe(1);

    const messageBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('message:created', resolve);
    });
    const messageAck = await emitWithAck(ownerSocket, 'message:create', {
      boardId: board._id,
      body: 'Realtime chat is working.',
    });

    expect(messageAck.ok).toBe(true);
    expect(messageAck.data.message.body).toBe('Realtime chat is working.');
    const messagePayload = await messageBroadcast;
    expect(messagePayload.boardId).toBe(board._id.toString());
    expect(messagePayload.message._id.toString()).toBe(messageAck.data.message._id.toString());
    await expect(Message.countDocuments({ board: board._id })).resolves.toBe(1);

    const typingBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('chat:typing', resolve);
    });
    const typingAck = await emitWithAck(ownerSocket, 'chat:typing', {
      boardId: board._id,
      typing: true,
    });
    expect(typingAck.ok).toBe(true);
    expect(typingAck.data.typing).toBe(true);
    const typingPayload = await typingBroadcast;
    expect(typingPayload.boardId).toBe(board._id.toString());
    expect(typingPayload.user.email).toBe(owner.user.email);
    expect(typingPayload.typing).toBe(true);

    const deniedDelete = await emitWithAck(collaboratorSocket, 'message:delete', {
      boardId: board._id,
      messageId: messageAck.data.message._id,
    });
    expect(deniedDelete.ok).toBe(false);
    expect(deniedDelete.error.code).toBe('FORBIDDEN');

    const deleteBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('message:deleted', resolve);
    });
    const deleteActivityBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('activity:created', resolve);
    });
    const deleteAck = await emitWithAck(ownerSocket, 'message:delete', {
      boardId: board._id,
      messageId: messageAck.data.message._id,
    });
    expect(deleteAck.ok).toBe(true);
    expect(deleteAck.data.message.deletedAt).toBeTruthy();
    expect(deleteAck.data.activity.action).toBe('message.deleted');
    const deletePayload = await deleteBroadcast;
    const deleteActivityPayload = await deleteActivityBroadcast;
    expect(deletePayload.message._id.toString()).toBe(messageAck.data.message._id.toString());
    expect(deleteActivityPayload.activity.action).toBe('message.deleted');

    const collaboratorMessageAck = await emitWithAck(collaboratorSocket, 'message:create', {
      boardId: board._id,
      body: 'Collaborator message stays personal.',
    });
    expect(collaboratorMessageAck.ok).toBe(true);

    const ownerDeniedDelete = await emitWithAck(ownerSocket, 'message:delete', {
      boardId: board._id,
      messageId: collaboratorMessageAck.data.message._id,
    });
    expect(ownerDeniedDelete.ok).toBe(false);
    expect(ownerDeniedDelete.error.code).toBe('FORBIDDEN');

    await emitWithAck(ownerSocket, 'message:create', {
      boardId: board._id,
      body: 'First clear target.',
    });
    await emitWithAck(ownerSocket, 'message:create', {
      boardId: board._id,
      body: 'Second clear target.',
    });

    const clearBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('chat:cleared', resolve);
    });
    const clearActivityBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('activity:created', resolve);
    });
    const clearAck = await emitWithAck(ownerSocket, 'chat:clear', { boardId: board._id });
    expect(clearAck.ok).toBe(true);
    expect(clearAck.data.deletedCount).toBe(4);
    expect(clearAck.data.activity.action).toBe('chat.cleared');
    const clearPayload = await clearBroadcast;
    const clearActivityPayload = await clearActivityBroadcast;
    expect(clearPayload.deletedCount).toBe(4);
    expect(clearActivityPayload.activity.action).toBe('chat.cleared');

    ownerSocket.disconnect();
    collaboratorSocket.disconnect();
    await server.close();
  });

  it('broadcasts workflow template additions to joined collaborators', async () => {
    const server = await startSocketServer();
    const owner = await register(server.app, 'Owner', 'owner@example.com');
    const collaborator = await register(server.app, 'Collaborator', 'collab@example.com');
    const board = await createBoardWithOwner(server.app, owner.token);
    await addMember(server.app, owner.token, board._id, collaborator.user.email, 'member');

    const collaboratorSocket = connectSocket(server.url, collaborator.token);
    await waitForConnect(collaboratorSocket);
    await emitWithAck(collaboratorSocket, 'board:join', { boardId: board._id });

    const workflowBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('workflow:created', resolve);
    });
    const activityBroadcast = new Promise((resolve) => {
      collaboratorSocket.once('activity:created', resolve);
    });

    const created = await request(server.app)
      .post(`/api/v1/boards/${board._id}/workflows`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ workflowTemplateId: 'release-plan' })
      .expect(201);

    const workflowPayload = await workflowBroadcast;
    const activityPayload = await activityBroadcast;

    expect(workflowPayload.boardId).toBe(board._id.toString());
    expect(workflowPayload.workflow._id.toString()).toBe(created.body.data.workflow._id.toString());
    expect(workflowPayload.workflow.templateKey).toBe('release-plan');
    expect(workflowPayload.lists.map((list) => list.workflow)).toEqual(
      workflowPayload.lists.map(() => created.body.data.workflow._id)
    );
    expect(workflowPayload.cards.map((card) => card.workflow)).toEqual(
      workflowPayload.cards.map(() => created.body.data.workflow._id)
    );
    expect(activityPayload.activity.action).toBe('workflow.created');

    collaboratorSocket.disconnect();
    await server.close();
  });
});
