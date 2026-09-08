// server/src/models/Card.js
import mongoose from 'mongoose';

const cardSchema = new mongoose.Schema(
  {
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
      index: true,            // scope all card queries by board
    },
    workflow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workflow',
      default: null,
      index: true,            // optional until legacy cards are backfilled
    },
    list: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'List',
      required: true,
      index: true,            // fetch a single list's cards
    },
    title: {
      type: String,
      required: [true, 'Card title is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    checklist: {
      type: [new mongoose.Schema({
        title: { type: String, required: true, trim: true, maxlength: 300 },
        completed: { type: Boolean, default: false },
      })],
      default: [],
    },
    tag: {
      type: String,
      enum: ['Task', 'Feature', 'Bug', 'Design', 'Research', 'Docs', 'Chore'],
      default: 'Task',
    },
    status: {
      type: String,
      enum: ['Todo', 'In Progress', 'Review', 'Blocked', 'Done'],
      default: 'Todo',
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    githubUrl: {
      type: String,
      trim: true,
      default: '',
    },
    position: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

const Card = mongoose.model('Card', cardSchema);
export default Card;
