// server/src/controllers/boardController.js
import Board from '../models/Board.js';
import List from '../models/List.js';
import Card from '../models/Card.js';
import Comment from '../models/Comment.js';
import Message from '../models/Message.js';
import Workflow from '../models/Workflow.js';
import BoardGitHubIntegration from '../models/BoardGitHubIntegration.js';
import Activity from '../models/Activity.js';
import Notification from '../models/Notification.js';
import { getBoardIfMember, getBoardIfRole } from '../utils/boardAccess.js';
import { recordActivity } from '../services/activityService.js';
import { backfillBoardWorkItemsToDefaultWorkflow, ensureDefaultWorkflow } from '../services/workflowService.js';

// Keep in sync with the Board schema's color enum.
const BOARD_COLORS = ['slate', 'indigo', 'emerald', 'amber', 'rose', 'sky', 'violet'];

function sendBoardError(res, err) {
  const status = err.statusCode || 500;
  const code = err.code || 'SERVER';
  const message = status === 500 ? 'Something went wrong.' : err.message;
  return res.status(status).json({ error: { code, message } });
}

// POST /api/v1/boards  (protected)
// Creates a board; the creator automatically becomes the owner + first member.
export async function createBoard(req, res) {
  let board;
  try {
    const { name, emoji, color } = req.body;

    if (!name) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Board name is required.' },
      });
    }

    // Only accept a color from the known palette; otherwise fall back to the
    // schema default. This keeps a bad value from throwing a validation error.
    const safeColor = BOARD_COLORS.includes(color) ? color : undefined;
    const safeEmoji = typeof emoji === 'string' && emoji.trim() ? emoji.trim() : undefined;

    // req.user was set by the `protect` middleware — that's who's creating this.
    board = await Board.create({
      name,
      ...(safeEmoji && { emoji: safeEmoji }),
      ...(safeColor && { color: safeColor }),
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'owner' }], // creator is the owner-member
    });

    // A board is the project container. Workflow templates are added inside the
    // project, so creation only seeds the default empty workflow target.
    const starterWorkflow = await ensureDefaultWorkflow(board._id);
    const lists = await List.find({ board: board._id }).sort({ position: 1 });
    const cards = await Card.find({ board: board._id }).sort({ position: 1 });

    return res.status(201).json({ data: { board, workflows: [starterWorkflow], lists, cards } });
  } catch (err) {
    console.error('Create board error:', err.message);
    if (board?._id) {
      await Promise.all([
        Card.deleteMany({ board: board._id }),
        List.deleteMany({ board: board._id }),
        Workflow.deleteMany({ board: board._id }),
        Board.deleteOne({ _id: board._id }),
      ]);
    }
    return sendBoardError(res, err);
  }
}

// GET /api/v1/boards  (protected)
// Returns all boards where the current user is a member.
export async function getMyBoards(req, res) {
  try {
    // Query the embedded members array for this user's id — uses our index.
    const boards = await Board.find({ 'members.user': req.user._id }).sort({ updatedAt: -1 });
    return res.status(200).json({ data: { boards } });
  } catch (err) {
    console.error('Get boards error:', err.message);
    return res.status(500).json({ error: { code: 'SERVER', message: 'Something went wrong.' } });
  }
}

// GET /api/v1/boards/:boardId  (protected)
export async function getBoard(req, res) {
  try {
    const board = await getBoardIfMember(req.params.boardId, req.user._id);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }

    // Older boards are backfilled lazily so every project has a stable workflow
    // target and legacy work items are attached before the client reads them.
    await backfillBoardWorkItemsToDefaultWorkflow(board._id);

    // Fetch this board's project structure and work items, ordered by position.
    const workflows = await Workflow.find({ board: board._id }).sort({ position: 1, createdAt: 1 });
    const lists = await List.find({ board: board._id }).sort({ position: 1 });
    const cards = await Card.find({ board: board._id })
      .sort({ position: 1 })
      .populate('assignee', 'name email');

    await board.populate('members.user', 'name email');
    return res.status(200).json({ data: { board, workflows, lists, cards } });
  } catch (err) {
    console.error('Get board error:', err.message);
    return res.status(500).json({ error: { code: 'SERVER', message: 'Something went wrong.' } });
  }
}

// PATCH /api/v1/boards/:boardId  (protected)
export async function updateBoard(req, res) {
  try {
    const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin']);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }

    const { name, emoji, color } = req.body;
    const updates = {};

    if (name !== undefined) {
      const safeName = typeof name === 'string' ? name.trim() : '';
      if (!safeName) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Board name is required.' } });
      }
      updates.name = safeName;
    }

    if (emoji !== undefined) {
      updates.emoji = typeof emoji === 'string' && emoji.trim() ? emoji.trim() : 'code';
    }

    if (color !== undefined) {
      if (!BOARD_COLORS.includes(color)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Board color is invalid.' } });
      }
      updates.color = color;
    }

    const updatedBoard = await Board.findByIdAndUpdate(
      board._id,
      updates,
      { returnDocument: 'after', runValidators: true }
    );

    const activity = await recordActivity({
      io: req.app.get('io'),
      boardId: board._id,
      actorId: req.user._id,
      action: 'board.updated',
      targetType: 'board',
      targetId: board._id,
      targetTitle: updatedBoard.name,
    });

    return res.status(200).json({ data: { board: updatedBoard, activity } });
  } catch (err) {
    console.error('Update board error:', err.message);
    return sendBoardError(res, err);
  }
}

// DELETE /api/v1/boards/:boardId  (protected)
export async function deleteBoard(req, res) {
  try {
    const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner']);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }

    await Card.deleteMany({ board: board._id });
    await Comment.deleteMany({ board: board._id });
    await Message.deleteMany({ board: board._id });
    await BoardGitHubIntegration.deleteMany({ board: board._id });
    await Workflow.deleteMany({ board: board._id });
    await List.deleteMany({ board: board._id });
    // Scope history cleanup by project, not actor/recipient: members may share other projects.
    // Keep the board until cleanup succeeds so a failed deletion can be retried.
    await Activity.deleteMany({ board: board._id });
    await Notification.deleteMany({ board: board._id });
    await Board.deleteOne({ _id: board._id });

    return res.status(200).json({ data: { deleted: true } });
  } catch (err) {
    console.error('Delete board error:', err.message);
    return sendBoardError(res, err);
  }
}
