import express from 'express';
import { protect } from '../middleware/auth.js';
import { getMyTasks } from '../controllers/taskController.js';

const router = express.Router();
router.get('/mine', protect, getMyTasks);
export default router;
