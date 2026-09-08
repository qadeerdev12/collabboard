import Board from '../models/Board.js';
import Card from '../models/Card.js';

// Assignment alone does not grant access: always intersect with current project
// membership, including when an old assignment survives a membership change.
export async function getMyTasks(req, res) {
  try {
    const boards = await Board.find({ 'members.user': req.user._id }).select('_id').lean();
    const tasks = await Card.find({
      assignee: req.user._id,
      board: { $in: boards.map((board) => board._id) },
    })
      .select('title board workflow list status tag dueDate checklist updatedAt')
      .populate('board', 'name color emoji')
      .populate('workflow', 'name')
      .populate('list', 'title workflow')
      .sort({ dueDate: 1, updatedAt: -1, _id: 1 })
      .lean();
    return res.json({ data: { tasks: tasks.filter((task) => task.board && task.list) } });
  } catch (err) {
    console.error('Get my tasks error:', err.message);
    return res.status(500).json({ error: { code: 'SERVER', message: 'Could not load your tasks.' } });
  }
}
