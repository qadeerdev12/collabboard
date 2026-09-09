import { getBoardIfRole } from '../utils/boardAccess.js';
import { listActivities } from '../services/activityService.js';
import { listWorkspaceActivities } from '../services/workspaceActivityService.js';

// GET /api/v1/activities: authenticated workspace feed, not a user-supplied board scope.
export async function getWorkspaceActivities(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await listWorkspaceActivities({ userId: req.user._id, limit: req.query.limit, cursor: req.query.cursor });
    return res.json({ data });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: {
      code: err.code || 'SERVER', message: status === 500 ? 'Could not load activity.' : err.message,
    } });
  }
}

// GET /api/v1/boards/:boardId/activities
export async function getActivities(req, res) {
  try {
    const board = await getBoardIfRole(req.params.boardId, req.user._id, ['owner', 'admin', 'member']);
    if (!board) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Board not found.' } });
    }

    const activities = await listActivities(board._id);
    return res.status(200).json({ data: { activities } });
  } catch (err) {
    const status = err.statusCode || 500;
    const code = err.code || 'SERVER';
    const message = status === 500 ? 'Something went wrong.' : err.message;
    return res.status(status).json({ error: { code, message } });
  }
}
