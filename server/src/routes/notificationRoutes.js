import express from 'express';
import { protect } from '../middleware/auth.js';
import { getNotifications, readNotification, readAllNotifications } from '../controllers/notificationController.js';

const router = express.Router();
router.get('/', protect, getNotifications);
router.patch('/read-all', protect, readAllNotifications);
router.patch('/:notificationId/read', protect, readNotification);
export default router;
