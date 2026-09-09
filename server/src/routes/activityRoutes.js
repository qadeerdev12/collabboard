import express from 'express';
import { protect } from '../middleware/auth.js';
import { getWorkspaceActivities } from '../controllers/activityController.js';

const router = express.Router();
router.get('/', protect, getWorkspaceActivities);
export default router;
