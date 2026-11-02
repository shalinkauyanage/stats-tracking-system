// Committing an import: all-or-nothing, repeatable, and it never harms existing data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryImportRepo } from '../src/import/importRepo.memory.js';
import { previewImport, commitImport } from '../src/import/importService.js';
import { ImportBlockedError, ImportMismatchError } from '../src/import/errors.js';
import { sampleWorkbook } from '../test-helpers/xlsx.js';
import { importFile, importSample, preview, realWorkbook, appSeasonData, seasonSnapshot } from '../test-helpers/imports.js';
import { calculateDriverCareer } from '../src/logic/careerTotals.js';
import { buildHallOfFame, unassignedLegacyTitles } from '../src/logic/hallOfFame.js';

const REAL_HISTORY_ROWS = 37;
const rowCounts = (repo) => Object.fromEntries(
  ['drivers', 'teams', 'circuits', 'legacyDrivers', 'legacyTeams', 'legacyTeamHistory', 'gpWinners', 'circuitRecords'].map((t) => [t, repo.data[t].length]));
const copyOf = (repo) => structuredClone(repo.data);

test('PREVIEW WRITES NOTHING: the archive is byte-for-byte the same afterwards', async () => {
  const repo = new MemoryImportRepo(appSeasonData());
  const before = copyOf(repo);
  await preview(repo, sampleWorkbook());
  await preview(repo, realWorkbook(), {}, 'F1.xlsx');
  assert.deepEqual(repo.data, before);
});

test('COMMIT imports the sample and records what it did', async () => {
  const repo = new MemoryImportRepo();
  const result = await importSample(repo);
  assert.equal(result.status, 'imported');
  assert.deepEqual(result.created, { team: 3, driver: 4, circuit: 2, legacy_driver_totals: 4, legacy_team_totals: 3, legacy_team_history: 4, gp_winner: 3, circuit_record: 4 });
  assert.deepEqual(rowCounts(repo), { drivers: 4, teams: 3, circuits: 2, legacyDrivers: 4, legacyTeams: 3, legacyTeamHistory: 5, gpWinners: 3, circuitRecords: 4 });
  const batch = repo.data.batches[0];
  assert.equal(batch.status, 'committed');
  assert.equal(batch.committed_sha256, batch.file_sha256);
  assert.equal(repo.data.items.length, 4 + 3 + 2 + 4 + 3 + 4 + 3 + 4, 'every created row is logged');
});

test('legacy totals are saved exactly as in the workbook; unknown stays unknown', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo);
  const alice = repo.data.legacyDrivers.find((l) => l.driver_id === repo.data.drivers.find((d) => d.name_key === 'alice alpha').id);
  assert.deepEqual({ wins: alice.wins, podiums: alice.podiums, mps: alice.mps, points: alice.points, dc: alice.drivers_titles }, { wins: 2, podiums: 3, mps: 10, points: 100, dc: 1 });
  assert.equal(alice.source_file, 'sample.xlsx');
});

test('SAFE RE-IMPORT: importing the same file twice creates nothing the second time', async () => {
  const repo = new MemoryImportRepo();
  const buf = sampleWorkbook();
  const first = await importFile(repo, buf, { fileName: 'sample.xlsx' });
  const afterFirst = copyOf(repo);
  const second = await importFile(repo, buf, { fileName: 'sample.xlsx' });
  assert.equal(first.status, 'imported');
  assert.equal(second.status, 'already_imported');
  assert.deepEqual(repo.data, afterFirst, 'not a single row changed');
});

test('SAFE RE-IMPORT: a re-saved copy of the same data (different file) adds nothing', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo);
  const afterFirst = copyOf(repo);
  // same numbers, but a trailing space makes the file different byte-for-byte
  const second = await importSample(repo, (c) => { c['Driver Stats'].A3 = 'Alice Alpha    Ferrari  '; });
  assert.equal(second.status, 'no_changes');
  assert.deepEqual(repo.data, afterFirst);
  assert.equal(repo.data.batches.length, 1, 'no empty import batch is recorded');
});

test('INCREMENTAL: a file with one new driver adds only that driver', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo);
  const idsBefore = repo.data.drivers.map((d) => [d.id, d.name_key]);
  const result = await importSample(repo, (c) => {
    const d = c['Driver Stats'];
    const row = ['Eve Epsilon    Ferrari', 0, 0, 0, 0, 0, 0, 0, 0, 1, 5, 0, 0];
    row.forEach((v, i) => { d[`${String.fromCharCode(65 + i)}7`] = v; });
    d.N7 = 'Ferrari';
  });
  assert.equal(result.status, 'imported');
  assert.deepEqual(result.created, { driver: 1, legacy_driver_totals: 1, legacy_team_history: 1 });
  assert.equal(repo.data.drivers.length, 5);
  assert.deepEqual(repo.data.drivers.slice(0, 4).map((d) => [d.id, d.name_key]), idsBefore, 'existing drivers keep their ids');
});

test('CONFLICTS are kept by default: the saved value is NOT overwritten', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo);
  const edited = (c) => { c['Driver Stats'].B3 = 3; };
  const result = await importSample(repo, edited);
  assert.equal(result.status, 'no_changes');
  assert.equal(result.conflicts, 1);
  assert.equal(repo.data.legacyDrivers.find((l) => l.source_row === 3).wins, 2);
  assert.equal(repo.data.changeLog.length, 0);
});

test('OVERWRITE only happens when chosen, only for that item, and the old value is logged', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo);
  const edited = (c) => { c['Driver Stats'].B3 = 3; c['Driver Stats'].K4 = 85; };   // two conflicts
  const result = await importSample(repo, edited, { resolutions: { 'legacy_driver_totals|alice alpha': 'overwrite' } });
  assert.equal(result.status, 'imported');
  assert.deepEqual(result.updated, { legacy_driver_totals: 1 });
  assert.equal(result.kept_conflicts, 1);
  const alice = repo.data.legacyDrivers.find((l) => l.source_row === 3);
  const bob = repo.data.legacyDrivers.find((l) => l.source_row === 4);
  assert.equal(alice.wins, 3, 'chosen item overwritten');
  assert.equal(bob.points, 80, 'the other conflict kept its saved value');
  assert.equal(repo.data.changeLog.length, 1);
  assert.equal(repo.data.changeLog[0].action, 'import_overwrite');
  assert.equal(repo.data.changeLog[0].old_json.wins, 2);
  assert.equal(repo.data.changeLog[0].new_json.wins, 3);
});

test('ROLLBACK: if anything fails midway, NOTHING from the import is kept', async () => {
  const repo = new MemoryImportRepo();
  repo.failAt = { method: 'insertGpWinner', nth: 2 };
  const before = copyOf(repo);
  await assert.rejects(() => importSample(repo), /Simulated failure/);
  const after = repo.data;
  assert.deepEqual(rowCounts(repo), { drivers: 0, teams: 0, circuits: 0, legacyDrivers: 0, legacyTeams: 0, legacyTeamHistory: 0, gpWinners: 0, circuitRecords: 0 });
  assert.equal(after.items.length, 0);
  assert.equal(after.issues.length, 0);
  assert.deepEqual(after.batches.map((b) => b.status), ['failed'], 'only a note that the attempt failed');
  assert.match(after.batches[0].error_message, /Simulated failure/);
  void before;
  // after the problem is fixed, the SAME file imports completely, with no leftovers
  repo.failAt = null;
  const retry = await importSample(repo);
  assert.equal(retry.status, 'imported');
  assert.deepEqual(rowCounts(repo), { drivers: 4, teams: 3, circuits: 2, legacyDrivers: 4, legacyTeams: 3, legacyTeamHistory: 5, gpWinners: 3, circuitRecords: 4 });
});

test('ROLLBACK also covers a crash at the very last step (recording the batch)', async () => {
  const repo = new MemoryImportRepo();
  repo.failAt = { method: 'finalizeBatch', nth: 1 };
  await assert.rejects(() => importSample(repo), /Simulated failure/);
  assert.equal(repo.data.drivers.length, 0);
  assert.equal(repo.data.legacyDrivers.length, 0);
});

test('a BLOCKED import (formula error) saves nothing and says why', async () => {
  const repo = new MemoryImportRepo();
  const before = copyOf(repo);
  await assert.rejects(() => importSample(repo, (c) => { c['Driver Stats'].B3 = { error: '#REF!' }; }),
    (e) => e instanceof ImportBlockedError && e.plan.blockers.some((b) => b.code === 'formula_error'));
  assert.deepEqual(repo.data, before);
});

test('the file you commit must be the file you previewed', async () => {
  const repo = new MemoryImportRepo();
  const plan = await preview(repo, sampleWorkbook());
  const other = sampleWorkbook((c) => { c['Driver Stats'].K3 = 999; });
  await assert.rejects(() => commitImport({ repo, buffer: other, fileName: 's.xlsx', expectedSha256: plan.file.sha256 }), ImportMismatchError);
  await assert.rejects(() => commitImport({ repo, buffer: other, fileName: 's.xlsx' }), ImportMismatchError);
  assert.equal(repo.data.drivers.length, 0);
});

test('DATABASE GUARD: the unique "same file already committed" key refuses a second commit of one file', async () => {
  const repo = new MemoryImportRepo();
  const a = await repo.createBatch({ file_name: 'a.xlsx', file_sha256: 'abc', file_size: 1 });
  await repo.finalizeBatch(a, { summary: {} });
  const b = await repo.createBatch({ file_name: 'b.xlsx', file_sha256: 'abc', file_size: 1 });
  await assert.rejects(() => repo.finalizeBatch(b, { summary: {} }), (e) => e.code === 'ER_DUP_ENTRY');
});

test('DATABASE GUARD: if that key fires at the last step, everything is rolled back and reported as already imported', async () => {
  const repo = new MemoryImportRepo();
  repo.finalizeBatch = async () => {
    throw Object.assign(new Error("Duplicate entry 'abc' for key 'import_batches.uq_import_committed_sha'"), { code: 'ER_DUP_ENTRY' });
  };
  const result = await importSample(repo);
  assert.equal(result.status, 'already_imported');
  assert.deepEqual(rowCounts(repo), { drivers: 0, teams: 0, circuits: 0, legacyDrivers: 0, legacyTeams: 0, legacyTeamHistory: 0, gpWinners: 0, circuitRecords: 0 });
});

test('HISTORICAL SEASONS ARE PRESERVED: standings, stats, titles and the Hall of Fame are untouched', async () => {
  const repo = new MemoryImportRepo({
    drivers: [{ id: 1, display_name: 'Alice Alpha', name_key: 'alice alpha' }],
    teams: [{ id: 1, name: 'Ferrari', name_key: 'ferrari' }],
    ...appSeasonData(),
    seasons: [{ id: 1, year: 2027, status: 'final', in_legacy_baseline: 1 }],   // already inside the Excel totals
  });
  const before = seasonSnapshot(repo);
  await importSample(repo);
  assert.deepEqual(seasonSnapshot(repo), before);
  // the existing driver was matched, not duplicated, and her 2027 title card is intact
  assert.equal(repo.data.drivers.filter((d) => d.name_key === 'alice alpha').length, 1);
  const hall = buildHallOfFame({ seasons: repo.data.seasons, championships: repo.data.championships });
  assert.equal(hall[0].drivers.driver_name, 'Alice Alpha');
  assert.equal(hall[0].constructors.team_name, 'Ferrari');
});

test('CAREER TOTALS stay correct after an import: legacy + new seasons, nothing counted twice', async () => {
  const repo = new MemoryImportRepo({
    drivers: [{ id: 1, display_name: 'Alice Alpha', name_key: 'alice alpha' }],
    teams: [{ id: 1, name: 'Ferrari', name_key: 'ferrari' }],
    ...appSeasonData(),                       // a FINAL season (2027) that is NOT in the legacy baseline
  });
  // importing now would risk double counting, so it must be acknowledged explicitly
  await assert.rejects(() => importSample(repo), ImportBlockedError);
  const ack = ['double-count:driver:alice alpha', 'double-count:team:ferrari'];
  const result = await importSample(repo, undefined, { options: { acknowledged: ack } });
  assert.equal(result.status, 'imported');
  const stored = repo.data.issues.filter((i) => i.severity === 'review_required');
  assert.equal(stored.length, 2);
  assert.ok(stored.every((i) => i.status === 'acknowledged'));
  const data = { ...repo.data };
  const career = calculateDriverCareer(data, 1);
  assert.equal(career.wins, 2 + 10, 'legacy 2 + season 10');
  assert.equal(career.drivers_titles, 1 + 1, 'legacy 1 + the 2027 title');
});

test('NEVER DELETES: extra drivers and records already in the archive survive an import', async () => {
  const repo = new MemoryImportRepo({
    drivers: [{ id: 50, display_name: 'Zed Extra', name_key: 'zed extra' }],
    circuits: [{ id: 60, gp_name: 'Imola', name_key: 'imola', sort_order: 9 }],
    circuitRecords: [{ circuit_id: 60, record_type: 'race_fastest_lap', driver_id: 50, lap_time_ms: 80000, lap_time_text: '1:20.000', original_text: null, review_status: 'ok', source: 'manual' }],
  });
  await importSample(repo);
  assert.ok(repo.data.drivers.some((d) => d.id === 50));
  assert.ok(repo.data.circuits.some((c) => c.id === 60));
  assert.equal(repo.data.circuitRecords.find((r) => r.circuit_id === 60).lap_time_ms, 80000);
});

test('PENDING lap-time corrections are imported as pending, with the original text and NO time', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo, (c) => { c['Track Records'].B24 = 'Alice Alpha  \r\n01:10:000'; });
  const rec = repo.data.circuitRecords.find((r) => r.original_text.includes('01:10:000'));
  assert.equal(rec.review_status, 'pending_review');
  assert.equal(rec.lap_time_ms, null);
  assert.equal(rec.lap_time_text, null);
  assert.equal(rec.suggested_text, '1:10.000');
  assert.ok(repo.data.issues.some((i) => i.severity === 'pending_review' && i.status === 'open'));
});

test('review items are kept once: an identical open item is not saved again by a later import', async () => {
  const repo = new MemoryImportRepo();
  const typo = (c) => { c['Track Records'].B24 = 'Alice Alpha  \r\n01:10:000'; };
  await importSample(repo, typo);
  const n = repo.data.issues.length;
  assert.ok(n >= 1);
  await importSample(repo, (c) => { typo(c); c['Driver Stats'].A7 = 'Eve Epsilon    Ferrari'; for (const [k, v] of Object.entries({ B7: 0, C7: 0, D7: 0, E7: 0, F7: 0, G7: 0, H7: 0, I7: 0, J7: 1, K7: 5, L7: 0, M7: 0, N7: 'Ferrari' })) c['Driver Stats'][k] = v; });
  assert.equal(repo.data.issues.filter((i) => i.code === 'lap_time_format_correction').length, 1);
});

test('BLANK POLICY at commit time: "unknown" saves NULL, never 0', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo, undefined, { options: { blankPolicy: 'unknown' } });
  const carlId = repo.data.drivers.find((d) => d.name_key === 'carl gamma').id;
  const carl = repo.data.legacyDrivers.find((l) => l.driver_id === carlId);
  assert.equal(carl.second_places, null);
  assert.equal(carl.wins, 0);
  const career = calculateDriverCareer({ ...repo.data }, carlId);
  assert.equal(career.second_places, null, 'career total shows unknown, not 0');
});

test('an unknown blank-policy value is refused', async () => {
  await assert.rejects(() => preview(new MemoryImportRepo(), sampleWorkbook(), { blankPolicy: 'guess' }), /blank policy/);
});

test('REAL FILE end to end: import, check the data, then import again safely', async () => {
  const repo = new MemoryImportRepo();
  const buf = realWorkbook();
  const result = await importFile(repo, buf);
  assert.equal(result.status, 'imported');
  assert.deepEqual(rowCounts(repo), { drivers: 22, teams: 11, circuits: 29, legacyDrivers: 22, legacyTeams: 11, legacyTeamHistory: REAL_HISTORY_ROWS, gpWinners: 104, circuitRecords: 58 });

  const id = (name) => repo.data.drivers.find((d) => d.name_key === name).id;
  const vers = repo.data.legacyDrivers.find((l) => l.driver_id === id('max verstappen'));
  assert.equal(vers.wins, 42);
  assert.equal(vers.mps, 450);               // M.P.S kept as a legacy field
  assert.equal(vers.drivers_titles, 2);
  assert.equal(calculateDriverCareer({ ...repo.data }, id('max verstappen')).wins, 42);

  const lv = repo.data.circuits.find((c) => c.name_key === 'las vegas');
  const lvRecords = repo.data.circuitRecords.filter((r) => r.circuit_id === lv.id);
  assert.equal(lvRecords.length, 2);
  for (const r of lvRecords) { assert.equal(r.review_status, 'pending_review'); assert.equal(r.lap_time_ms, null); assert.match(r.original_text, /01:11:/); }
  assert.equal(repo.data.circuitRecords.filter((r) => r.review_status === 'ok').length, 56);

  // the 4 workbook titles are still "unassigned" (the workbook has no years)
  const unassigned = unassignedLegacyTitles({ legacyDrivers: repo.data.legacyDrivers, legacyTeams: repo.data.legacyTeams, seasons: [], championships: [] });
  assert.equal(unassigned.length, 5);

  // the 7 flagged items are saved for later review
  assert.equal(repo.data.issues.filter((i) => i.severity === 'pending_review').length, 2);
  assert.equal(repo.data.issues.filter((i) => i.severity === 'warning').length, 5);

  // importing the very same file again changes nothing at all
  const snapshot = copyOf(repo);
  const again = await importFile(repo, buf);
  assert.equal(again.status, 'already_imported');
  assert.deepEqual(repo.data, snapshot);
  const plan = await preview(repo, buf, {}, 'F1.xlsx');
  assert.equal(plan.summary.create + plan.summary.conflict, 0);
});
