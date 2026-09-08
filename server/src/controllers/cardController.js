import { getBoardIfRole } from '../utils/boardAccess.js';
import {
    createCard as createCardMutation,
    updateCard as updateCardMutation,
    deleteCard as deleteCardMutation,
} from '../services/boardMutationService.js';
import { recordActivity } from '../services/activityService.js';
import Card from '../models/Card.js';

function sendMutationError(res, err) {
    const status = err.statusCode || 500;
    const code = err.code || 'SERVER';
    const message = status === 500 ? 'Something went wrong.' : err.message;
    return res.status(status).json({ error: { code, message } });
}

// POST /api/v1/boards/:boardId/cards
export async function createCard(req, res) {
    try {
        const { title, listId, position, tag, status, assignee, dueDate, workflowId } = req.body;
        const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
        if (!board) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
        }
        const card = await createCardMutation({ boardId: board._id, actorId: req.user._id, title, listId, position, tag, status, assignee, dueDate, workflowId });
        const activity = await recordActivity({
            io: req.app.get('io'),
            boardId: board._id,
            actorId: req.user._id,
            action: 'card.created',
            targetType: 'card',
            targetId: card._id,
            targetTitle: card.title,
        });
        return res.status(201).json({ data: { card, activity } });
    } catch (err) {
        console.error('Create card error:', err.message);
        return sendMutationError(res, err);
    }
}

// PATCH /api/v1/boards/:boardId/cards/:cardId
export async function updateCard(req, res) {
    try {
        const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
        if (!board) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
        }

        const action = req.body.position !== undefined || req.body.list !== undefined ? 'card.moved' : 'card.updated';
        const card = await updateCardMutation({
            boardId: board._id,
            actorId: req.user._id,
            cardId: req.params.cardId,
            updates: req.body,
        });
        // REST fallback must also refresh connected collaborators' checklists.
        if (req.body.checklistOperation) {
            req.app.get('io')?.to(`board:${board._id}`).emit('card:updated', {
                boardId: board._id.toString(), card,
            });
        }
        const activity = await recordActivity({
            io: req.app.get('io'),
            boardId: board._id,
            actorId: req.user._id,
            action,
            targetType: 'card',
            targetId: card._id,
            targetTitle: card.title,
        });
        return res.status(200).json({ data: { card, activity } });
    } catch (err) {
        console.error('Update card error:', err.message);
        return sendMutationError(res, err);
    }
}

// DELETE /api/v1/boards/:boardId/cards/:cardId
export async function deleteCard(req, res) {
    try {
        const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
        if (!board) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
        }

        const cardToDelete = await Card.findOne({ _id: req.params.cardId, board: board._id });
        await deleteCardMutation({ boardId: board._id, cardId: req.params.cardId });
        const activity = await recordActivity({
            io: req.app.get('io'),
            boardId: board._id,
            actorId: req.user._id,
            action: 'card.deleted',
            targetType: 'card',
            targetId: req.params.cardId,
            targetTitle: cardToDelete?.title || '',
        });
        return res.status(200).json({ data: { deleted: true, activity } });
    } catch (err) {
        console.error('Delete card error:', err.message);
        return sendMutationError(res, err);
    }
}
