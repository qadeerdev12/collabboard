import mongoose from 'mongoose';
import Board from '../models/Board.js';
import Activity from '../models/Activity.js';

function invalidQuery(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION';
  throw error;
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
    invalidQuery('Invalid activity cursor.');
  }
}

export async function listWorkspaceActivities({ userId, limit: value = '50', cursor: encodedCursor }) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 50) {
    invalidQuery('Limit must be an integer from 1 to 50.');
  }
  const limit = Number(value);
  const cursor = parseCursor(encodedCursor);
  // Recheck membership on every page. Cursor data selects a position, never access.
  const boards = await Board.find({ 'members.user': userId }).select('_id name').lean();
  const names = new Map(boards.map((board) => [board._id.toString(), board.name]));
  if (!boards.length) return { activities: [], nextCursor: null };
  const filter = { board: { $in: boards.map((board) => board._id) } };
  if (cursor) filter.$or = [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ];
  // One bounded activity query across projects, rather than one query per project.
  const rows = await Activity.find(filter).sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1).populate('actor', 'name email').lean();
  const activities = rows.slice(0, limit).map((row) => ({ ...row, boardName: names.get(row.board.toString()) }));
  const last = activities.at(-1);
  const nextCursor = rows.length > limit ? Buffer.from(JSON.stringify({
    createdAt: last.createdAt.toISOString(), id: last._id.toString(),
  })).toString('base64url') : null;
  return { activities, nextCursor };
}
