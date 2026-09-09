import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import boardRoutes from './routes/boardRoutes.js';
import boardTemplateRoutes from './routes/boardTemplateRoutes.js';
import workflowTemplateRoutes from './routes/workflowTemplateRoutes.js';
import githubIntegrationRoutes from './routes/githubIntegrationRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import activityRoutes from './routes/activityRoutes.js';

export function allowedClientOrigins() {
  return (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp({ io } = {}) {
  const app = express();
  const clientOrigins = allowedClientOrigins();

  app.use(cors({
    origin: clientOrigins,
    credentials: true,
  }));

  if (io) app.set('io', io);

  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/integrations', githubIntegrationRoutes);
  app.use('/api/v1/workflow-templates', workflowTemplateRoutes);
  app.use('/api/v1/board-templates', boardTemplateRoutes);
  app.use('/api/v1/boards', boardRoutes);
  app.use('/api/v1/tasks', taskRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/activities', activityRoutes);

  app.get('/', (req, res) => {
    res.json({
      name: 'SDLCFlow API',
      status: 'ok',
      health: '/health',
      apiBase: '/api/v1',
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
