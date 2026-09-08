import mongoose from 'mongoose';
import Card from '../models/Card.js';

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION';
  throw error;
}

// Item-level atomic writes preserve concurrent edits to other checklist items.
// Authorization belongs to the shared REST/socket card mutation entry points.
export async function updateChecklist({ boardId, cardId, operation }) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail('Invalid checklist operation.');
  const { action, itemId, title, completed } = operation;
  if (!['add', 'update', 'remove'].includes(action)) fail('Invalid checklist action.');
  const filter = { _id: cardId, board: boardId };
  let mutation;
  let safeTitle;
  if (action === 'add' || (action === 'update' && title !== undefined)) {
    safeTitle = typeof title === 'string' ? title.trim() : '';
    if (!safeTitle || safeTitle.length > 300) fail('Checklist items must contain 1 to 300 characters.');
  }
  if (action === 'add') {
    // The limit is checked in the write filter, including concurrent additions.
    filter['checklist.99'] = { $exists: false };
    mutation = { $push: { checklist: { title: safeTitle, completed: false } } };
  } else {
    if (typeof itemId !== 'string' || !/^[a-f\d]{24}$/i.test(itemId)) fail('Invalid checklist item id.');
    filter['checklist._id'] = new mongoose.Types.ObjectId(itemId);
    if (action === 'remove') {
      mutation = { $pull: { checklist: { _id: itemId } } };
    } else {
      const fields = {};
      if (safeTitle !== undefined) fields['checklist.$.title'] = safeTitle;
      if (completed !== undefined) {
        if (typeof completed !== 'boolean') fail('Checklist completion must be a boolean.');
        fields['checklist.$.completed'] = completed;
      }
      if (!Object.keys(fields).length) fail('Provide a checklist title or completion state.');
      mutation = { $set: fields };
    }
  }
  const card = await Card.findOneAndUpdate(filter, mutation, {
    returnDocument: 'after', runValidators: true,
  }).populate('assignee', 'name email');
  if (!card) {
    if (action === 'add' && await Card.exists({ _id: cardId, board: boardId })) fail('A card can contain up to 100 checklist items.');
    fail('Card or checklist item not found.', 404);
  }
  return card;
}
