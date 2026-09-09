import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema(
  {
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'board.updated',
        'list.created',
        'list.updated',
        'list.moved',
        'list.deleted',
        'card.created',
        'card.updated',
        'card.moved',
        'card.deleted',
        'comment.created',
        'message.deleted',
        'chat.cleared',
        'workflow.created',
        'github.repo_linked',
        'github.repo_unlinked',
        'github.commit_synced',
        'member.added',
        'member.role_updated',
        'member.removed',
      ],
    },
    targetType: {
      type: String,
      enum: ['board', 'list', 'card', 'member', 'message', 'workflow', 'integration'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    targetTitle: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

activitySchema.index({ board: 1, createdAt: -1, _id: -1 });

const Activity = mongoose.model('Activity', activitySchema);
export default Activity;
