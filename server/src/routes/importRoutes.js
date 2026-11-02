// Express routes for the importer (mounted at /api/import). The real work is in
// import/importHandlers.js. The browser sends the .xlsx file as the raw request body
// (Content-Type: application/octet-stream) and its name in the X-File-Name header.
//
//   POST /api/import/preview   -> shows what an import would do (saves nothing)
//   POST /api/import/commit    -> imports (needs ?confirm=yes&expected_sha256=...)
//   GET  /api/import/batches   -> import history
//   GET  /api/import/issues    -> review items found by imports (?status=open)

import express from 'express';
import { handlePreview, handleCommit, handleBatches, handleIssues } from '../import/importHandlers.js';

const fileName = (req) => {
  try { return decodeURIComponent(req.get('X-File-Name') || 'workbook.xlsx'); } catch { return 'workbook.xlsx'; }
};

export function createImportRouter(repo) {
  const router = express.Router();
  const rawFile = express.raw({ type: () => true, limit: '25mb' });
  const run = (handler, withFile) => async (req, res, next) => {
    try {
      const out = await handler({ repo, body: withFile ? req.body : undefined, fileName: withFile ? fileName(req) : undefined, query: req.query });
      res.status(out.status).json(out.json);
    } catch (err) { next(err); }
  };
  router.post('/preview', rawFile, run(handlePreview, true));
  router.post('/commit', rawFile, run(handleCommit, true));
  router.get('/batches', run(handleBatches, false));
  router.get('/issues', run(handleIssues, false));
  return router;
}
