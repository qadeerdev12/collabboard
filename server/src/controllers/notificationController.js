import { listNotifications } from '../services/notificationInboxService.js';

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
