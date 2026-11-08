// Read-only API endpoints for the existing archive tables.
import express from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkbookFile } from '../import/workbookLayout.js';

export function createDataRouter(pool) {
  const router = express.Router();
  const get = (sql, params = []) => pool.query(sql, params).then(([rows]) => rows);
  const handle = (fn) => async (req, res, next) => {
    try { res.json(await fn(req)); } catch (err) { next(err); }
  };
  const idParam = (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: { code: 'invalid_id', message: 'ID must be a positive integer.' } });
      return null;
    }
    return id;
  };

  router.get('/drivers', handle(async () => get('SELECT * FROM drivers ORDER BY display_name')));
  router.get('/drivers/:id', async (req, res, next) => {
    const id = idParam(req, res); if (id === null) return;
    try {
      const rows = await get('SELECT * FROM drivers WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: { code: 'not_found', message: 'Driver not found.' } });
      const history = await get(`SELECT s.year, s.status, t.id AS team_id, t.name AS team_name
        FROM season_entries e JOIN seasons s ON s.id = e.season_id JOIN teams t ON t.id = e.team_id
        WHERE e.driver_id = ? ORDER BY s.year`, [id]);
      const legacy = await get('SELECT * FROM legacy_driver_totals WHERE driver_id = ?', [id]);
      res.json({ ...rows[0], legacy_totals: legacy[0] || null, season_history: history });
    } catch (err) { next(err); }
  });
  router.get('/teams', handle(async () => get('SELECT * FROM teams ORDER BY name')));
  router.get('/teams/:id', async (req, res, next) => {
  const id = idParam(req, res);
  if (id === null) return;

  try {
    const rows = await get(
      'SELECT * FROM teams WHERE id = ?',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: {
          code: 'not_found',
          message: 'Team not found.'
        }
      });
    }

    // Existing season statistics
    const history = await get(`
      SELECT s.year, s.status, ts.wins, ts.podiums, ts.poles
      FROM team_season_stats ts
      JOIN seasons s ON s.id = ts.season_id
      WHERE ts.team_id = ?
      ORDER BY s.year
    `, [id]);

    // Existing career totals
    const legacy = await get(
      'SELECT * FROM legacy_team_totals WHERE team_id = ?',
      [id]
    );

    // Championship-winning drivers and seasons
    const driverChampionships = await get(`
      SELECT
        s.year,
        d.id AS driver_id,
        d.display_name AS driver_name
      FROM championship_history c
      JOIN seasons s ON s.id = c.season_id
      JOIN drivers d ON d.id = c.driver_id
      WHERE c.team_id = ?
        AND LOWER(c.championship_type) LIKE '%driver%'
      ORDER BY s.year
    `, [id]);

    // Constructor championship seasons
    const constructorChampionships = await get(`
      SELECT
        c.season_id,
        s.year
      FROM championship_history c
      JOIN seasons s ON s.id = c.season_id
      WHERE c.team_id = ?
        AND LOWER(c.championship_type) LIKE '%constructor%'
      ORDER BY s.year
    `, [id]);

    // Both drivers who represented the team in each
    // constructor championship-winning season
    const constructorLineups = await get(`
      SELECT
        c.season_id,
        s.year,
        d.id AS driver_id,
        d.display_name AS driver_name
      FROM championship_history c
      JOIN seasons s ON s.id = c.season_id
      JOIN season_entries e
        ON e.season_id = c.season_id
        AND e.team_id = c.team_id
      JOIN drivers d ON d.id = e.driver_id
      WHERE c.team_id = ?
        AND LOWER(c.championship_type) LIKE '%constructor%'
      ORDER BY s.year, d.display_name
    `, [id]);

    res.json({
      ...rows[0],
      legacy_totals: legacy[0] || null,
      season_history: history,
      driver_championships: driverChampionships,
      constructor_championships: constructorChampionships,
      constructor_lineups: constructorLineups
    });

  } catch (err) {
    next(err);
  }
});
  router.get('/circuits', handle(async () => get('SELECT * FROM circuits ORDER BY sort_order, gp_name')));
  router.get('/circuits/:id', async (req, res, next) => {
    const id = idParam(req, res); if (id === null) return;
    try {
      const rows = await get('SELECT * FROM circuits WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: { code: 'not_found', message: 'Circuit not found.' } });
      const winners = await get(`SELECT w.*, d.display_name AS driver_name, s.year
        FROM circuit_gp_winners w JOIN drivers d ON d.id = w.driver_id
        LEFT JOIN seasons s ON s.id = w.season_id WHERE w.circuit_id = ? ORDER BY w.sequence_no`, [id]);
      const records = await get('SELECT * FROM circuit_records WHERE circuit_id = ?', [id]);
      res.json({ ...rows[0], winners, records });
    } catch (err) { next(err); }
  });
  router.get('/seasons', handle(async () => get('SELECT id, year, label, status, in_legacy_baseline FROM seasons ORDER BY year DESC')));
  router.get('/seasons/:year', async (req, res, next) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2300) return res.status(400).json({ error: { code: 'invalid_year', message: 'Year must be between 1900 and 2300.' } });
    try {
      const seasons = await get('SELECT * FROM seasons WHERE year = ?', [year]);
      if (!seasons.length) return res.status(404).json({ error: { code: 'not_found', message: 'Season not found.' } });
      const entries = await get(`SELECT e.id AS entry_id, d.id AS driver_id, d.display_name, t.id AS team_id, t.name AS team_name
        FROM season_entries e JOIN drivers d ON d.id = e.driver_id JOIN teams t ON t.id = e.team_id
        WHERE e.season_id = ? ORDER BY d.display_name`, [seasons[0].id]);
      const championships = await get('SELECT * FROM championship_history WHERE season_id = ?', [seasons[0].id]);
      res.json({ ...seasons[0], entries, championships });
    } catch (err) { next(err); }
  });
  router.get('/hall-of-fame', handle(async () => get(`
    SELECT s.id AS season_id, s.year, s.status, c.championship_type, c.driver_id,
      c.driver_name_snapshot AS driver_name, c.team_id, c.team_name_snapshot AS team_name, c.points
    FROM seasons s JOIN championship_history c ON c.season_id = s.id
    ORDER BY s.year DESC, c.championship_type`
  )));
  router.get('/track-records', handle(async () => {
    // Read the current Track Records sheet. Support both the original and
    // updated workbook filenames used by different project versions.
    const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/original');
    let buffer;
    let workbookName;

    try {
      workbookName = 'F1.xlsx';
      buffer = await readFile(resolve(dataDir, workbookName));
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;

      workbookName = 'F1-updated.xlsx';
      buffer = await readFile(resolve(dataDir, workbookName));
    }

    const parsed = parseWorkbookFile(buffer, workbookName);
    return parsed.snapshot?.track_records || { columns: [] };
  }));
  router.get('/records/lap-times', handle(async () => get('SELECT * FROM circuit_records ORDER BY circuit_id')));
  router.get('/records/gp-winners', handle(async () => get(`SELECT w.*, c.gp_name, d.display_name AS driver_name, s.year
    FROM circuit_gp_winners w JOIN circuits c ON c.id = w.circuit_id JOIN drivers d ON d.id = w.driver_id
    LEFT JOIN seasons s ON s.id = w.season_id ORDER BY s.year DESC, w.circuit_id, w.sequence_no`)));
  return router;
}
