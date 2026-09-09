import Card from '../models/Card.js';
import { getBoardIfRole } from '../utils/boardAccess.js';
import { createDraftLimiter, draftError, generateTaskDraft, validateDraftInput } from '../services/taskDraftService.js';

const acquire = createDraftLimiter();

export async function createTaskDraft(req, res) {
  res.set('Cache-Control', 'no-store');
  let release;
  try {
    const { boardId, cardId } = req.params;
    if (![boardId, cardId].every((id) => /^[a-f\d]{24}$/i.test(id))) throw draftError('Invalid project or card id.', 400, 'VALIDATION');
    const board = await getBoardIfRole(boardId, req.user._id, ['owner', 'admin', 'member']);
    if (!board || !await Card.exists({ _id: cardId, board: boardId })) throw draftError('Card not found.', 404, 'NOT_FOUND');
    const input = validateDraftInput(req.body);
    release = acquire(req.user._id);
    const draft = await generateTaskDraft(input);
    // Generation never writes a card or broadcasts an event. Applying suggestions
    // uses the normal authenticated card mutations and their existing permissions.
    return res.json({ data: { draft } });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status === 429) res.set('Retry-After', '60');
    return res.status(status).json({ error: { code: err.code || 'SERVER', message: status === 500 ? 'Could not generate a draft.' : err.message } });
  } finally {
    release?.();
  }
}
