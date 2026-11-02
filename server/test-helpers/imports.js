// Helpers shared by the Stage 2 tests.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './data.js';
import { sampleWorkbook } from './xlsx.js';
import { previewImport, commitImport } from '../src/import/importService.js';

export const realWorkbook = () => fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'));

/** Previews then commits a workbook the way the app will: same file, fingerprint from the preview. */
export async function importFile(repo, buffer, { fileName = 'F1.xlsx', options = {}, resolutions = {} } = {}) {
  const plan = await previewImport({ repo, buffer, fileName, options });
  return commitImport({ repo, buffer, fileName, expectedSha256: plan.file.sha256, options, resolutions });
}

export const importSample = (repo, edit, opts) => importFile(repo, sampleWorkbook(edit), { fileName: 'sample.xlsx', ...opts });
export const preview = (repo, buffer, options = {}, fileName = 'sample.xlsx') => previewImport({ repo, buffer, fileName, options });

/** What a user might already have entered in the app (Stage 1 data) BEFORE importing. */
export function appSeasonData({ driverId = 1, teamId = 1 } = {}) {
  return {
    seasons: [{ id: 1, year: 2027, status: 'final', in_legacy_baseline: 0 }],
    entries: [{ id: 1, season_id: 1, driver_id: driverId, team_id: teamId }],
    driverStandings: [{ season_id: 1, season_entry_id: 1, position: 1, points: 400 }],
    constructorStandings: [{ season_id: 1, team_id: teamId, position: 1, points: 700 }],
    driverStats: [{ season_entry_id: 1, wins: 10, podiums: 15, poles: 8 }],
    teamStats: [{ season_id: 1, team_id: teamId, wins: 12, podiums: 25 }],
    championships: [
      { season_id: 1, championship_type: 'drivers', driver_id: driverId, team_id: teamId, points: 400, driver_name_snapshot: 'Alice Alpha', team_name_snapshot: 'Ferrari' },
      { season_id: 1, championship_type: 'constructors', driver_id: null, team_id: teamId, points: 700, driver_name_snapshot: null, team_name_snapshot: 'Ferrari' },
    ],
  };
}

export const SEASON_TABLES = ['seasons', 'entries', 'driverStandings', 'constructorStandings', 'driverStats', 'teamStats', 'championships'];
export const seasonSnapshot = (repo) => structuredClone(Object.fromEntries(SEASON_TABLES.map((t) => [t, repo.data[t]])));
