export function userRoomName(userId) {
  return `user:${userId.toString()}`;
}

// A socket signal invalidates cached inbox data; it never carries private task
// details or an unread count. The authenticated inbox API remains authoritative.
export function emitInboxChanged(io, recipientId) {
  if (!io) return; // HTTP-only apps/tests can persist without a socket server.

  try {
    // Include every tab/device for this user, including the tab making a write.
    io.to(userRoomName(recipientId)).emit('notifications:changed', {});
  } catch (err) {
    // Delivery is best-effort. A transport failure must not turn an already
    // persisted notification/read action into a failed write response.
    console.error('Notification live delivery failed:', err.message);
  }
}
