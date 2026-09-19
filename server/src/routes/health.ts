import { Router } from 'express';
import { checkDatabaseConnection } from '../db/pool';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

healthRouter.get('/db', async (_req, res) => {
  const isConnected = await checkDatabaseConnection();
  if (isConnected) {
    res.json({ status: 'ok', database: 'connected' });
  } else {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});
