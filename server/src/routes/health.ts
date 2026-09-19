import { Router } from 'express';
import { env } from '../config/env';
import { checkDatabaseConnection } from '../db/pool';
import { storage } from '../storage';

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

healthRouter.get('/storage', async (_req, res) => {
  const isHealthy = await storage.checkHealth();
  if (isHealthy) {
    res.json({ status: 'ok', storage: env.storage.provider });
  } else {
    res.status(503).json({ status: 'error', storage: env.storage.provider });
  }
});
