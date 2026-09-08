import mongoose from 'mongoose';

// One document belongs to one recipient. A future event handler will create
// these documents; defining this model does not send or generate notifications.
const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['card.assigned', 'comment.created', 'member.added'],
    },
    // The UI calls this a project; persistence still uses the Board model.
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
    },
    card: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Card',
      default: null,
      // Use a regular function so Mongoose binds `this` to the document.
      required: function () {
        return this.type === 'card.assigned' || this.type === 'comment.created';
      },
    },
    // One field captures both unread state (null) and when it was read.
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Support a recipient's newest-first inbox and unread-only queries. _id breaks
// ties when multiple notifications share the same creation timestamp.
notificationSchema.index({ recipient: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1, _id: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
