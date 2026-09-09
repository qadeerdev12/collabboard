import { getBoardIfRole } from '../utils/boardAccess.js';
import {
  createList as createListMutation,
  updateList as updateListMutation,
  deleteList as deleteListMutation,
} from '../services/boardMutationService.js';
import { recordActivity } from '../services/activityService.js';
import List from '../models/List.js';

function sendMutationError(res, err) {
  const status = err.statusCode || 500;
  const code = err.code || 'SERVER';
  const message = status === 500 ? 'Something went wrong.' : err.message;
  return res.status(status).json({ error: { code, message } });
}

// POST /api/v1/boards/:boardId/lists
export async function createList(req, res) {
  try {
    const { title, position, workflowId } = req.body;
    const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }
    const list = await createListMutation({ boardId: board._id, title, position, workflowId });
    const activity = await recordActivity({
      io: req.app.get('io'),
      boardId: board._id,
      actorId: req.user._id,
      action: 'list.created',
      targetType: 'list',
      targetId: list._id,
      targetTitle: list.title,
    });
    // Use the same room/payload as socket mutations after persistence succeeds.
    req.app.get('io')?.to(`board:${board._id}`).emit('list:created', {
      boardId: board._id.toString(), list,
    });
    return res.status(201).json({ data: { list, activity } });
  } catch (err) {
    console.error('Create list error:', err.message);
    return sendMutationError(res, err);
  }
}

// PATCH /api/v1/boards/:boardId/lists/:listId
export async function updateList(req, res) {
  try {
    const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }

    const action = req.body.position !== undefined && req.body.title === undefined ? 'list.moved' : 'list.updated';
    const list = await updateListMutation({
      boardId: board._id,
      listId: req.params.listId,
      updates: req.body,
    });
    const activity = await recordActivity({
      io: req.app.get('io'),
      boardId: board._id,
      actorId: req.user._id,
      action,
      targetType: 'list',
      targetId: list._id,
      targetTitle: list.title,
    });
    req.app.get('io')?.to(`board:${board._id}`).emit(action === 'list.moved' ? 'list:moved' : 'list:updated', {
      boardId: board._id.toString(), list,
    });
    return res.status(200).json({ data: { list, activity } });
  } catch (err) {
    console.error('Update list error:', err.message);
    return sendMutationError(res, err);
  }
}

// DELETE /api/v1/boards/:boardId/lists/:listId
export async function deleteList(req, res) {
  try {
    const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }

    const listToDelete = await List.findOne({ _id: req.params.listId, board: board._id });
    await deleteListMutation({ boardId: board._id, listId: req.params.listId });
    const activity = await recordActivity({
      io: req.app.get('io'),
      boardId: board._id,
      actorId: req.user._id,
      action: 'list.deleted',
      targetType: 'list',
      targetId: req.params.listId,
      targetTitle: listToDelete?.title || '',
    });
    req.app.get('io')?.to(`board:${board._id}`).emit('list:deleted', {
      boardId: board._id.toString(), listId: req.params.listId,
    });
    return res.status(200).json({ data: { deleted: true, activity } });
  } catch (err) {
    console.error('Delete list error:', err.message);
    return sendMutationError(res, err);
  }
}
