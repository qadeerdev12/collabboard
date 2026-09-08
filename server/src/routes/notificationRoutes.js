import express from 'express';
import { protect } from '../middleware/auth.js';
import { getNotifications } from '../controllers/notificationController.js';

const router = express.Router();
router.get('/', protect, getNotifications);
export default router;
