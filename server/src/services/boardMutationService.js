import Card from '../models/Card.js';
import List from '../models/List.js';
import Board from '../models/Board.js';
import Workflow from '../models/Workflow.js';
import mongoose from 'mongoose';
import Comment from '../models/Comment.js';
import { updateChecklist } from './checklistService.js';
import { ensureDefaultWorkflow, getFallbackWorkflow } from './workflowService.js';

const CARD_TAGS = ['Task', 'Feature', 'Bug', 'Design', 'Research', 'Docs', 'Chore'];
const CARD_STATUSES = ['Todo', 'In Progress', 'Review', 'Blocked', 'Done'];

// This service is the single write path for list/card mutations. REST
// controllers and Socket.IO handlers both call these functions so validation,
// cross-board checks, and persisted document shapes stay consistent.

function makeMutationError(message, statusCode = 400, code = 'VALIDATION') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// Cards may move between lists, but never across boards. Checking the target
// list here protects both REST PATCH calls and realtime card:move events.
async function assertListBelongsToBoard(boardId, listId) {
  const list = await List.findOne({ _id: listId, board: boardId });
  if (!list) {
    throw makeMutationError('List not found.', 404, 'NOT_FOUND');
  }
  return list;
}

async function assertCardBelongsToBoard(boardId, cardId) {
  const card = await Card.findOne({ _id: cardId, board: boardId });
  if (!card) {
    throw makeMutationError('Card not found.', 404, 'NOT_FOUND');
  }
  return card;
}

async function resolveWorkflowForBoard(boardId, workflowId) {
  if (!workflowId) return getFallbackWorkflow(boardId);

  if (!mongoose.Types.ObjectId.isValid(workflowId)) {
    throw makeMutationError('Workflow id is invalid.');
  }

  const workflow = await Workflow.findOne({ _id: workflowId, board: boardId });
  if (!workflow) {
    throw makeMutationError('Workflow not found.', 404, 'NOT_FOUND');
  }

  return workflow;
}

async function ensureListHasWorkflow(boardId, list) {
  const workflow = list.workflow
    ? await resolveWorkflowForBoard(boardId, list.workflow)
    : await ensureDefaultWorkflow(boardId);

  if (!list.workflow) {
    await List.updateOne({ _id: list._id, board: boardId, workflow: null }, { workflow: workflow._id });
    list.workflow = workflow._id;
  }

  return workflow;
}

function safeEnumValue(value, allowed, fieldName) {
  if (value === undefined) return undefined;
  if (allowed.includes(value)) return value;

  throw makeMutationError(`${fieldName} is invalid.`);
}

function safeDueDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw makeMutationError('Due date is invalid.');
  }

  return date;
}

function safeGitHubUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return '';

  const text = typeof value === 'string' ? value.trim() : '';
  try {
    const url = new URL(text);
    const allowedHost = url.hostname === 'github.com' || url.hostname.endsWith('.github.com');
    if (!allowedHost) throw new Error('Invalid GitHub host.');
    return url.toString();
  } catch {
    throw makeMutationError('GitHub link must be a valid github.com URL.');
  }
}

async function safeAssignee(boardId, userId) {
  if (userId === undefined) return undefined;
  if (userId === null || userId === '') return null;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw makeMutationError('Assignee is invalid.');
  }

  const board = await Board.findOne({ _id: boardId, 'members.user': userId }).select('_id');
  if (!board) {
    throw makeMutationError('Assignee must be a board member.');
  }

  return userId;
}

async function populateCardPeople(card) {
  return card.populate('assignee', 'name email');
}

export async function createList({ boardId, title, position, workflowId }) {
  const safeTitle = typeof title === 'string' ? title.trim() : '';
  if (!safeTitle) {
    throw makeMutationError('List title is required.');
  }

  const workflow = await resolveWorkflowForBoard(boardId, workflowId);

  return List.create({
    board: boardId,
    workflow: workflow._id,
    title: safeTitle,
    position: position ?? 1000,
  });
}

export async function updateList({ boardId, listId, updates }) {
  const safeUpdates = {};
  if (updates.workflow !== undefined || updates.workflowId !== undefined) {
    throw makeMutationError('Moving lists between workflows is not supported yet.');
  }

  if (updates.title !== undefined) {
    const safeTitle = typeof updates.title === 'string' ? updates.title.trim() : '';
    if (!safeTitle) {
      throw makeMutationError('List title is required.');
    }
    safeUpdates.title = safeTitle;
  }
  if (updates.position !== undefined) safeUpdates.position = updates.position;

  const list = await List.findOneAndUpdate(
    { _id: listId, board: boardId },
    safeUpdates,
    { returnDocument: 'after', runValidators: true }
  );

  if (!list) {
    throw makeMutationError('List not found.', 404, 'NOT_FOUND');
  }

  return list;
}

export async function deleteList({ boardId, listId }) {
  const list = await List.findOneAndDelete({ _id: listId, board: boardId });
  if (!list) {
    throw makeMutationError('List not found.', 404, 'NOT_FOUND');
  }

  // Lists own their visible cards in the UI. Deleting the list also removes
  // their comments so the database does not keep unreachable work items around.
  const cards = await Card.find({ board: boardId, list: list._id }).select('_id');
  await Comment.deleteMany({ board: boardId, card: { $in: cards.map((card) => card._id) } });
  await Card.deleteMany({ board: boardId, list: list._id });
  return true;
}

export async function createCard({ boardId, title, listId, position, tag, status, assignee, dueDate, workflowId }) {
  const safeTitle = typeof title === 'string' ? title.trim() : '';
  if (!safeTitle || !listId) {
    throw makeMutationError('Card title and listId are required.');
  }

  const list = await assertListBelongsToBoard(boardId, listId);
  const workflow = workflowId
    ? await resolveWorkflowForBoard(boardId, workflowId)
    : await ensureListHasWorkflow(boardId, list);

  if (list.workflow && list.workflow.toString() !== workflow._id.toString()) {
    throw makeMutationError('Card workflow must match the target list workflow.');
  }

  const safeAssigneeId = await safeAssignee(boardId, assignee);
  const safeCardDueDate = safeDueDate(dueDate);

  const card = await Card.create({
    board: boardId,
    workflow: workflow._id,
    list: listId,
    title: safeTitle,
    ...(tag !== undefined && { tag: safeEnumValue(tag, CARD_TAGS, 'Card tag') }),
    ...(status !== undefined && { status: safeEnumValue(status, CARD_STATUSES, 'Card status') }),
    ...(safeAssigneeId !== undefined && { assignee: safeAssigneeId }),
    ...(safeCardDueDate !== undefined && { dueDate: safeCardDueDate }),
    position: position ?? 1000,
  });

  return populateCardPeople(card);
}

export async function updateCard({ boardId, cardId, updates }) {
  if (updates.checklist !== undefined) {
    throw makeMutationError('Use checklistOperation to edit individual items.');
  }
  if (updates.checklistOperation !== undefined) {
    if (Object.keys(updates).length !== 1) {
      throw makeMutationError('Checklist operations must be saved separately from card details.');
    }
    return updateChecklist({ boardId, cardId, operation: updates.checklistOperation });
  }
  const safeUpdates = {};
  if (updates.workflow !== undefined || updates.workflowId !== undefined) {
    throw makeMutationError('Moving cards between workflows is not supported yet.');
  }

  if (updates.title !== undefined) {
    const safeTitle = typeof updates.title === 'string' ? updates.title.trim() : '';
    if (!safeTitle) {
      throw makeMutationError('Card title is required.');
    }
    safeUpdates.title = safeTitle;
  }
  if (updates.description !== undefined) safeUpdates.description = updates.description;
  if (updates.tag !== undefined) safeUpdates.tag = safeEnumValue(updates.tag, CARD_TAGS, 'Card tag');
  if (updates.status !== undefined) safeUpdates.status = safeEnumValue(updates.status, CARD_STATUSES, 'Card status');
  if (updates.assignee !== undefined) safeUpdates.assignee = await safeAssignee(boardId, updates.assignee);
  if (updates.dueDate !== undefined) safeUpdates.dueDate = safeDueDate(updates.dueDate);
  if (updates.githubUrl !== undefined) safeUpdates.githubUrl = safeGitHubUrl(updates.githubUrl);
  if (updates.position !== undefined) safeUpdates.position = updates.position;
  if (updates.list !== undefined) {
    const [card, targetList] = await Promise.all([
      assertCardBelongsToBoard(boardId, cardId),
      assertListBelongsToBoard(boardId, updates.list),
    ]);
    const targetWorkflow = await ensureListHasWorkflow(boardId, targetList);

    if (card.workflow && card.workflow.toString() !== targetWorkflow._id.toString()) {
      throw makeMutationError('Cards cannot be moved to a list in another workflow.');
    }

    safeUpdates.list = updates.list;
    safeUpdates.workflow = targetWorkflow._id;
  }

  const card = await Card.findOneAndUpdate(
    { _id: cardId, board: boardId },
    safeUpdates,
    { returnDocument: 'after', runValidators: true }
  ).populate('assignee', 'name email');

  if (!card) {
    throw makeMutationError('Card not found.', 404, 'NOT_FOUND');
  }

  return card;
}

export async function deleteCard({ boardId, cardId }) {
  const card = await Card.findOneAndDelete({ _id: cardId, board: boardId });
  if (!card) {
    throw makeMutationError('Card not found.', 404, 'NOT_FOUND');
  }

  await Comment.deleteMany({ board: boardId, card: card._id });
  return true;
}
