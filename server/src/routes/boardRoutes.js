// server/src/routes/boardRoutes.js
import express from 'express';
import { createBoard, getMyBoards, getBoard, updateBoard, deleteBoard } from '../controllers/boardController.js';
import { protect } from '../middleware/auth.js';
import { createList, updateList, deleteList } from '../controllers/listController.js';
import { createCard, updateCard, deleteCard } from '../controllers/cardController.js';
import { createTaskDraft } from '../controllers/taskDraftController.js';
import { getMembers, addMember, updateMemberRole, removeMember } from '../controllers/memberController.js';
import { getActivities } from '../controllers/activityController.js';
import { getCardComments, createCardComment } from '../controllers/commentController.js';
import { createWorkflow, getWorkflows } from '../controllers/workflowController.js';
import {
  clearBoardChat,
  createBoardChatMessage,
  deleteBoardChatMessage,
  getBoardMessages,
} from '../controllers/messageController.js';
import {
  deleteBoardGitHubIntegration,
  getBoardGitHubCommits,
  getBoardGitHubIntegration,
  getBoardGitHubStats,
  upsertBoardGitHubIntegration,
} from '../controllers/boardGitHubIntegrationController.js';



const router = express.Router();

// Every board route requires login. Applying `protect` to all routes in this file:
router.use(protect);

router.post('/', createBoard);    // POST   /api/v1/boards
router.get('/', getMyBoards); 
router.get('/:boardId', getBoard); // GET    /api/v1/boards/:boardId
router.patch('/:boardId', updateBoard);
router.delete('/:boardId', deleteBoard);

// Members
router.get('/:boardId/members', getMembers);
router.post('/:boardId/members', addMember);
router.patch('/:boardId/members/:userId', updateMemberRole);
router.delete('/:boardId/members/:userId', removeMember);

// Activity
router.get('/:boardId/activities', getActivities);

// GitHub project integration
router.get('/:boardId/integrations/github', getBoardGitHubIntegration);
router.put('/:boardId/integrations/github', upsertBoardGitHubIntegration);
router.delete('/:boardId/integrations/github', deleteBoardGitHubIntegration);
router.get('/:boardId/github/commits', getBoardGitHubCommits);
router.get('/:boardId/github/stats', getBoardGitHubStats);

// Workflows
router.get('/:boardId/workflows', getWorkflows);
router.post('/:boardId/workflows', createWorkflow);

// Board chat
router.get('/:boardId/messages', getBoardMessages);
router.post('/:boardId/messages', createBoardChatMessage);
router.delete('/:boardId/messages', clearBoardChat);
router.delete('/:boardId/messages/:messageId', deleteBoardChatMessage);

// Lists (nested under a board)
router.post('/:boardId/lists', createList);
router.patch('/:boardId/lists/:listId', updateList);
router.delete('/:boardId/lists/:listId', deleteList);

// Cards (nested under a board)
router.post('/:boardId/cards', createCard);
router.post('/:boardId/cards/:cardId/draft', createTaskDraft);
router.patch('/:boardId/cards/:cardId', updateCard);
router.delete('/:boardId/cards/:cardId', deleteCard);
router.get('/:boardId/cards/:cardId/comments', getCardComments);
router.post('/:boardId/cards/:cardId/comments', createCardComment);

export default router;
