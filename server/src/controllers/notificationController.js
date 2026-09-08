import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../services/notificationInboxService.js';

export async function getNotifications(req, res) {
  try {
    const data = await listNotifications({
      // Only authentication supplies ownership, never a URL or query parameter.
      recipientId: req.user._id,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ data });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status === 500) console.error('Read notifications error:', err.message);
    return res.status(status).json({ error: {
      code: err.code || 'SERVER',
      message: status === 500 ? 'Could not load notifications.' : err.message,
    } });
  }
}

export async function readNotification(req, res) {
  try {
    // The body cannot choose a recipient, supply readAt, or mark the item unread.
    const notification = await markNotificationRead({
      recipientId: req.user._id,
      notificationId: req.params.notificationId,
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ data: { notification } });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status === 500) console.error('Mark notification read error:', err.message);
    return res.status(status).json({ error: {
      code: err.code || 'SERVER',
      message: status === 500 ? 'Could not mark notification as read.' : err.message,
    } });
  }
}

export async function readAllNotifications(req, res) {
  try {
    const data = await markAllNotificationsRead({ recipientId: req.user._id });
    res.set('Cache-Control', 'no-store');
    return res.json({ data });
  } catch (err) {
    console.error('Mark all notifications read error:', err.message);
    return res.status(500).json({ error: {
      code: 'SERVER', message: 'Could not mark notifications as read.',
    } });
  }
}
