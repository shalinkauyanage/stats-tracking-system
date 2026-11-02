// Shared helpers for the tests (kept outside test/ so they are not run as tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLegacyDataset, assignPreviewIds } from '../src/logic/legacyBuilder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

export function loadSnapshot() {
  const file = path.join(ROOT, 'server/test/fixtures/f1-workbook-snapshot.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function emptySeasonData(ids) {
  return {
    seasons: [], entries: [], driverStandings: [], constructorStandings: [],
    driverStats: [], teamStats: [], championships: [],
    legacyDrivers: ids.legacyDrivers, legacyTeams: ids.legacyTeams,
  };
}

/** The real workbook, cleaned, with ids, ready for season data to be added on top. */
export function realLegacy() {
  const snapshot = loadSnapshot();
  const dataset = buildLegacyDataset(snapshot);
  const ids = assignPreviewIds(dataset);
  return { snapshot, dataset, ids, data: emptySeasonData(ids) };
}

/**
 * Returns a NEW data object with one season added (the old one is untouched).
 * spec: { id, year, status, in_legacy_baseline,
 *         drivers: [{ driver_id, team_id, position, points, stats }],
 *         teams:   [{ team_id, position, points, stats }],
 *         champions: { drivers: {...}, constructors: {...} } }
 */
export function addSeason(data, spec) {
  const next = structuredClone(data);
  next.seasons.push({
    id: spec.id, year: spec.year,
    status: spec.status ?? 'final',
    in_legacy_baseline: spec.in_legacy_baseline ?? 0,
  });
  let entryId = next.entries.reduce((m, e) => Math.max(m, e.id), 0);
  for (const d of spec.drivers || []) {
    entryId += 1;
    next.entries.push({ id: entryId, season_id: spec.id, driver_id: d.driver_id, team_id: d.team_id });
    if (d.position !== undefined) {
      next.driverStandings.push({ season_id: spec.id, season_entry_id: entryId, position: d.position, points: d.points ?? null });
    }
    if (d.stats) next.driverStats.push({ season_entry_id: entryId, ...d.stats });
  }
  for (const t of spec.teams || []) {
    if (t.position !== undefined) {
      next.constructorStandings.push({ season_id: spec.id, team_id: t.team_id, position: t.position, points: t.points ?? null });
    }
    if (t.stats) next.teamStats.push({ season_id: spec.id, team_id: t.team_id, ...t.stats });
  }
  const c = spec.champions || {};
  if (c.drivers) next.championships.push({ season_id: spec.id, championship_type: 'drivers', ...c.drivers });
  if (c.constructors) next.championships.push({ season_id: spec.id, championship_type: 'constructors', driver_id: null, ...c.constructors });
  return next;
}
