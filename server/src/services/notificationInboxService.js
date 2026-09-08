import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import Board from '../models/Board.js';
import Card from '../models/Card.js';
import User from '../models/User.js';

function invalidQuery(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION';
  throw error;
}

function parseLimit(value = '20') {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) invalidQuery('Limit must be an integer from 1 to 50.');
  const limit = Number(value);
  if (limit < 1 || limit > 50) invalidQuery('Limit must be an integer from 1 to 50.');
  return limit;
}

function parseCursor(value) {
  if (value === undefined) return null;
  try {
    if (typeof value !== 'string' || value.length > 512 || !/^[\w-]+$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof decoded?.createdAt !== 'string' || typeof decoded?.id !== 'string' || !/^[a-f\d]{24}$/i.test(decoded.id)) throw new Error();
    const createdAt = new Date(decoded.createdAt);
    if (createdAt.toISOString() !== decoded.createdAt) throw new Error();
    return { createdAt, id: new mongoose.Types.ObjectId(decoded.id) };
  } catch {
    invalidQuery('Invalid notification cursor.');
  }
}

export async function listNotifications({ recipientId, limit: requestedLimit, cursor: requestedCursor }) {
  const limit = parseLimit(requestedLimit);
  const cursor = parseCursor(requestedCursor);
  // Cursor values only choose a position; they never select the recipient or
  // bypass membership. Aggregation does not cast IDs like Mongoose find does.
  const recipient = new mongoose.Types.ObjectId(recipientId);
  const olderThanCursor = cursor ? [{ $match: { $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ] } }] : [];

  const [result] = await Notification.aggregate([
    { $match: { recipient } },
    // Join only projects the recipient still belongs to, before counting or
    // paginating. Missing projects and revoked memberships are excluded alike.
    { $lookup: {
      from: Board.collection.name,
      let: { boardId: '$board' },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$boardId'] }, 'members.user': recipient } },
        { $project: { _id: 1, name: 1 } },
      ],
      as: 'board',
    } },
    { $unwind: '$board' },
    // Both branches share the same access-filtered input. unreadCount describes
    // the entire visible inbox, not just this page or records after the cursor.
    { $facet: {
      unread: [{ $match: { readAt: null } }, { $count: 'count' }],
      notifications: [
        ...olderThanCursor,
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: limit + 1 },
        { $lookup: {
          from: User.collection.name,
          localField: 'actor', foreignField: '_id',
          pipeline: [{ $project: { _id: 1, name: 1 } }], as: 'actor',
        } },
        { $lookup: {
          from: Card.collection.name,
          let: { cardId: '$card', boardId: '$board._id' },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ['$_id', '$$cardId'] }, { $eq: ['$board', '$$boardId'] },
            ] } } },
            { $project: { _id: 1, title: 1 } },
          ], as: 'card',
        } },
        { $project: {
          _id: 1, type: 1, createdAt: 1, readAt: 1, board: 1,
          actor: { $ifNull: [{ $arrayElemAt: ['$actor', 0] }, null] },
          card: { $ifNull: [{ $arrayElemAt: ['$card', 0] }, null] },
        } },
      ],
    } },
  ]);

  const hasMore = result.notifications.length > limit;
  const notifications = result.notifications.slice(0, limit);
  const last = notifications.at(-1);
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({
    createdAt: last.createdAt.toISOString(), id: last._id.toString(),
  })).toString('base64url') : null;
  return { notifications, unreadCount: result.unread[0]?.count || 0, nextCursor };
}
