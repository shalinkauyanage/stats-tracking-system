// The Express app. Stage 1: health check. Stage 2: Excel import routes.
import express from 'express';
import cors from 'cors';
import { getPool } from './db/pool.js';
import { MysqlImportRepo } from './import/importRepo.mysql.js';
import { createImportRouter } from './routes/importRoutes.js';
import { createDataRouter } from './routes/dataRoutes.js';

/** pool is optional: tests pass their own so they never touch your real database. */
export function createApp({ pool } = {}) {
  const app = express();
  const db = () => pool || getPool();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', async (req, res, next) => {
    try {
      const [[row]] = await db().query('SELECT 1 AS ok');
      res.json({ status: 'ok', database: row.ok === 1 ? 'connected' : 'unknown' });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/import', createImportRouter(new MysqlImportRepo(pool || getPool())));
  app.use('/api', createDataRouter(db()));

  // Central error handler: the user never sees a stack trace or SQL.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'too_large', message: 'The file is larger than 25 MB.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server.' } });
  });
  return app;
}
