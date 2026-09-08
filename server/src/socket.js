import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Card from './models/Card.js';
import List from './models/List.js';
import Comment from './models/Comment.js';
import { getBoardIfMember, getBoardIfRole } from './utils/boardAccess.js';
import {
  createCard,
  updateCard,
  deleteCard,
  createList,
  updateList,
  deleteList,
} from './services/boardMutationService.js';
import { recordActivity } from './services/activityService.js';
import { clearBoardMessages, createBoardMessage, deleteBoardMessage } from './services/chatService.js';
import { userRoomName } from './services/notificationDeliveryService.js';

const presenceByBoard = new Map();
const presenceTimers = new Map();

function roomName(boardId) {
  return `board:${boardId}`;
}

function socketError(err) {
  return {
    ok: false,
    error: {
      code: err.code || 'SERVER',
      message: err.statusCode === 500 ? 'Something went wrong.' : err.message,
    },
  };
}

function ackSuccess(data = {}) {
  return { ok: true, data };
}

function normalizeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
  };
}

function emitTypingStatus(socket, boardId, typing) {
  socket.to(roomName(boardId)).emit('chat:typing', {
    boardId,
    user: normalizeUser(socket.data.user),
    typing,
  });
}

function getPresenceList(boardId) {
  const boardPresence = presenceByBoard.get(boardId);
  if (!boardPresence) return [];

  return [...boardPresence.values()].map((entry) => ({
    user: entry.user,
    socketCount: entry.sockets.size,
    lastSeen: entry.lastSeen,
  }));
}

// Presence can change quickly during refresh/reconnect. Throttling keeps the
// UI responsive without broadcasting several near-identical member lists.
function schedulePresence(io, boardId) {
  if (presenceTimers.has(boardId)) return;

  const timer = setTimeout(() => {
    presenceTimers.delete(boardId);
    io.to(roomName(boardId)).emit('presence:update', {
      boardId,
      users: getPresenceList(boardId),
    });
  }, 500);

  presenceTimers.set(boardId, timer);
}

// Presence is tracked by user and socket. One user can have multiple tabs open,
// and they should remain "online" until their final tab disconnects.
function addPresence(io, socket, boardId) {
  const normalizedBoardId = boardId.toString();
  const userId = socket.data.user._id.toString();
  const user = normalizeUser(socket.data.user);
  const boardPresence = presenceByBoard.get(normalizedBoardId) || new Map();
  const existing = boardPresence.get(userId) || {
    user,
    sockets: new Set(),
    lastSeen: new Date().toISOString(),
  };

  existing.sockets.add(socket.id);
  existing.lastSeen = new Date().toISOString();
  boardPresence.set(userId, existing);
  presenceByBoard.set(normalizedBoardId, boardPresence);
  schedulePresence(io, normalizedBoardId);
}

// Clean up every board room this socket joined. This is why board ids are kept
// on socket.data instead of only relying on Socket.IO's internal room list.
function removePresence(io, socket) {
  const boardIds = socket.data.boardIds || new Set();
  const userId = socket.data.user?._id?.toString();
  if (!userId) return;

  for (const boardId of boardIds) {
    const boardPresence = presenceByBoard.get(boardId);
    if (!boardPresence) continue;

    const entry = boardPresence.get(userId);
    if (!entry) continue;

    entry.sockets.delete(socket.id);
    entry.lastSeen = new Date().toISOString();

    if (entry.sockets.size === 0) boardPresence.delete(userId);
    if (boardPresence.size === 0) presenceByBoard.delete(boardId);
    schedulePresence(io, boardId);
  }
}

// Every board event starts here. Returning 404 for non-members avoids revealing
// whether a private board id exists.
async function requireBoardMember(socket, boardId) {
  if (!boardId) {
    const err = new Error('Board id is required.');
    err.statusCode = 400;
    err.code = 'VALIDATION';
    throw err;
  }

  const board = await getBoardIfMember(boardId, socket.data.user._id);
  if (!board) {
    const err = new Error('Board not found.');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  return board;
}

async function requireBoardRole(socket, boardId, allowedRoles) {
  if (!boardId) {
    const err = new Error('Board id is required.');
    err.statusCode = 400;
    err.code = 'VALIDATION';
    throw err;
  }

  const board = await getBoardIfRole(boardId, socket.data.user._id, allowedRoles);
  if (!board) {
    const err = new Error('Board not found.');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  return board;
}

// Wrap mutation handlers in one ack/error convention. Clients use a Promise
// wrapper around this shape, so keep `{ ok, data/error }` stable.
function registerMutation(socket, eventName, handler) {
  socket.on(eventName, async (payload = {}, callback) => {
    try {
      const result = await handler(payload);
      if (typeof callback === 'function') callback(ackSuccess(result));
    } catch (err) {
      console.error(`${eventName} socket error:`, err.message);
      if (typeof callback === 'function') callback(socketError(err));
      else socket.emit('board:error', socketError(err).error);
    }
  });
}

export function configureSockets(io) {
  // Socket.IO handshake auth. This happens before `connection`, so invalid
  // clients never get a chance to join rooms or emit board events.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        const err = new Error('Authentication token is required.');
        err.data = { code: 'NO_TOKEN_PROVIDED' };
        return next(err);
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) {
        const err = new Error('User not found.');
        err.data = { code: 'USER_NOT_FOUND' };
        return next(err);
      }

      socket.data.user = user;
      socket.data.boardIds = new Set();
      return next();
    } catch {
      const err = new Error('Invalid authentication token.');
      err.data = { code: 'INVALID_TOKEN' };
      return next(err);
    }
  });

  io.on('connection', (socket) => {
    // Identity comes from the verified JWT, never a client-selected room/user ID.
    // All of this user's tabs join automatically, even outside a project page.
    socket.join(userRoomName(socket.data.user._id));

    // Joining is explicit because connection auth proves identity only. The
    // board room still needs membership verification for that specific board.
    socket.on('board:join', async ({ boardId } = {}, callback) => {
      try {
        const board = await requireBoardMember(socket, boardId);
        const normalizedBoardId = board._id.toString();
        socket.join(roomName(normalizedBoardId));
        socket.data.boardIds.add(normalizedBoardId);
        addPresence(io, socket, normalizedBoardId);

        if (typeof callback === 'function') {
          callback(ackSuccess({
            boardId: normalizedBoardId,
            presence: getPresenceList(normalizedBoardId),
          }));
        }
      } catch (err) {
        console.error('board:join socket error:', err.message);
        if (typeof callback === 'function') callback(socketError(err));
      }
    });

    registerMutation(socket, 'card:create', async ({ boardId, title, listId, position, tag, status, assignee, dueDate, workflowId }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const card = await createCard({ boardId: board._id, actorId: socket.data.user._id, title, listId, position, tag, status, assignee, dueDate, workflowId });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'card.created',
        targetType: 'card',
        targetId: card._id,
        targetTitle: card.title,
      });
      // Persist first, then broadcast the saved document to everyone except
      // the sender. The sender receives the same document through the ack.
      socket.to(roomName(board._id)).emit('card:created', { boardId: board._id.toString(), card });
      return { card, activity };
    });

    registerMutation(socket, 'card:update', async ({ boardId, cardId, updates }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const card = await updateCard({ boardId: board._id, actorId: socket.data.user._id, cardId, updates: updates || {} });
      const action = updates?.position !== undefined || updates?.list !== undefined ? 'card.moved' : 'card.updated';
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action,
        targetType: 'card',
        targetId: card._id,
        targetTitle: card.title,
      });
      socket.to(roomName(board._id)).emit('card:updated', { boardId: board._id.toString(), card });
      return { card, activity };
    });

    registerMutation(socket, 'card:move', async ({ boardId, cardId, position, list }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const card = await updateCard({ boardId: board._id, actorId: socket.data.user._id, cardId, updates: { position, list } });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'card.moved',
        targetType: 'card',
        targetId: card._id,
        targetTitle: card.title,
      });
      socket.to(roomName(board._id)).emit('card:moved', { boardId: board._id.toString(), card });
      return { card, activity };
    });

    registerMutation(socket, 'card:delete', async ({ boardId, cardId }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const card = await Card.findOne({ _id: cardId, board: board._id });
      await deleteCard({ boardId: board._id, cardId });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'card.deleted',
        targetType: 'card',
        targetId: cardId,
        targetTitle: card?.title || '',
      });
      socket.to(roomName(board._id)).emit('card:deleted', { boardId: board._id.toString(), cardId });
      return { deleted: true, activity };
    });

    registerMutation(socket, 'comment:create', async ({ boardId, cardId, body }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const card = await Card.findOne({ _id: cardId, board: board._id }).select('_id title');
      if (!card) {
        const err = new Error('Card not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      const safeBody = typeof body === 'string' ? body.trim() : '';
      if (!safeBody) {
        const err = new Error('Comment body is required.');
        err.statusCode = 400;
        err.code = 'VALIDATION';
        throw err;
      }

      const comment = await Comment.create({
        board: board._id,
        card: card._id,
        author: socket.data.user._id,
        body: safeBody,
      });
      await comment.populate('author', 'name email');
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'comment.created',
        targetType: 'card',
        targetId: card._id,
        targetTitle: card.title,
      });

      socket.to(roomName(board._id)).emit('comment:created', {
        boardId: board._id.toString(),
        cardId: card._id.toString(),
        comment,
      });
      return { comment, activity };
    });

    registerMutation(socket, 'message:create', async ({ boardId, body }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const message = await createBoardMessage({
        boardId: board._id,
        senderId: socket.data.user._id,
        body,
      });

      socket.to(roomName(board._id)).emit('message:created', {
        boardId: board._id.toString(),
        message,
      });
      return { message };
    });

    registerMutation(socket, 'chat:typing', async ({ boardId, typing }) => {
      const board = await requireBoardMember(socket, boardId);
      const normalizedBoardId = board._id.toString();

      // Typing is intentionally ephemeral: verify board access, broadcast the
      // current status, and leave no database record behind.
      emitTypingStatus(socket, normalizedBoardId, Boolean(typing));
      return { typing: Boolean(typing) };
    });

    registerMutation(socket, 'message:delete', async ({ boardId, messageId }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const message = await deleteBoardMessage({
        boardId: board._id,
        messageId,
        actorId: socket.data.user._id,
      });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'message.deleted',
        targetType: 'message',
        targetId: message._id,
        targetTitle: 'Chat message',
      });

      socket.to(roomName(board._id)).emit('message:deleted', {
        boardId: board._id.toString(),
        message,
      });
      return { message, activity };
    });

    registerMutation(socket, 'chat:clear', async ({ boardId }) => {
      const board = await requireBoardRole(socket, boardId, ['owner']);
      const deletedCount = await clearBoardMessages({
        boardId: board._id,
        actorId: socket.data.user._id,
      });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'chat.cleared',
        targetType: 'board',
        targetId: board._id,
        targetTitle: board.name,
        metadata: { deletedCount },
      });

      socket.to(roomName(board._id)).emit('chat:cleared', {
        boardId: board._id.toString(),
        deletedCount,
      });
      return { deletedCount, activity };
    });

    registerMutation(socket, 'list:create', async ({ boardId, title, position, workflowId }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const list = await createList({ boardId: board._id, title, position, workflowId });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'list.created',
        targetType: 'list',
        targetId: list._id,
        targetTitle: list.title,
      });
      socket.to(roomName(board._id)).emit('list:created', { boardId: board._id.toString(), list });
      return { list, activity };
    });

    registerMutation(socket, 'list:update', async ({ boardId, listId, updates }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const list = await updateList({ boardId: board._id, listId, updates: updates || {} });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: updates?.position !== undefined && updates?.title === undefined ? 'list.moved' : 'list.updated',
        targetType: 'list',
        targetId: list._id,
        targetTitle: list.title,
      });
      socket.to(roomName(board._id)).emit('list:updated', { boardId: board._id.toString(), list });
      return { list, activity };
    });

    registerMutation(socket, 'list:move', async ({ boardId, listId, position }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const list = await updateList({ boardId: board._id, listId, updates: { position } });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'list.moved',
        targetType: 'list',
        targetId: list._id,
        targetTitle: list.title,
      });
      socket.to(roomName(board._id)).emit('list:moved', { boardId: board._id.toString(), list });
      return { list, activity };
    });

    registerMutation(socket, 'list:delete', async ({ boardId, listId }) => {
      const board = await requireBoardRole(socket, boardId, ['owner', 'admin', 'member']);
      const list = await List.findOne({ _id: listId, board: board._id });
      await deleteList({ boardId: board._id, listId });
      const activity = await recordActivity({
        socket,
        boardId: board._id,
        actorId: socket.data.user._id,
        action: 'list.deleted',
        targetType: 'list',
        targetId: listId,
        targetTitle: list?.title || '',
      });
      socket.to(roomName(board._id)).emit('list:deleted', { boardId: board._id.toString(), listId });
      return { deleted: true, activity };
    });

    socket.on('disconnect', () => {
      for (const boardId of socket.data.boardIds || []) {
        emitTypingStatus(socket, boardId, false);
      }
      removePresence(io, socket);
    });
  });
}
