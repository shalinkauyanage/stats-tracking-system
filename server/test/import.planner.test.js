// The import PLAN: what an import would do, before anything is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryImportRepo } from '../src/import/importRepo.memory.js';
import { sampleWorkbook } from '../test-helpers/xlsx.js';
import { importSample, preview, realWorkbook, appSeasonData } from '../test-helpers/imports.js';

const countsOf = (plan, entity) => plan.summary.by_entity[entity];

test('an empty archive: everything in the sample is new', async () => {
  const plan = await preview(new MemoryImportRepo(), sampleWorkbook());
  assert.equal(plan.status, 'ready');
  assert.equal(plan.canCommit, true);
  assert.deepEqual(plan.blockers, []);
  const expected = { driver: 4, team: 3, circuit: 2, legacy_driver_totals: 4, legacy_team_totals: 3, legacy_team_history: 4, gp_winner: 3, circuit_record: 4 };
  for (const [entity, n] of Object.entries(expected)) assert.deepEqual(countsOf(plan, entity), { create: n, unchanged: 0, conflict: 0 }, entity);
});

test('REAL FILE into an empty archive: 22 drivers, 11 teams, 29 GPs, 104 winners, 58 records', async () => {
  const plan = await preview(new MemoryImportRepo(), realWorkbook(), {}, 'F1.xlsx');
  assert.equal(plan.status, 'ready');
  const expected = { driver: 22, team: 11, circuit: 29, legacy_driver_totals: 22, legacy_team_totals: 11, legacy_team_history: 22, gp_winner: 104, circuit_record: 58 };
  for (const [entity, n] of Object.entries(expected)) assert.equal(countsOf(plan, entity).create, n, entity);
  assert.equal(plan.summary.issue_counts.error, 0);
  assert.equal(plan.summary.issue_counts.pending_review, 2);
  assert.equal(plan.issues.filter((i) => i.severity === 'warning').length, 5);
});

test('the preview never contains the internal dataset when serialised for the browser', async () => {
  const { serializePlan } = await import('../src/import/importService.js');
  const plan = await preview(new MemoryImportRepo(), sampleWorkbook());
  assert.ok(plan.dataset);
  assert.equal('dataset' in serializePlan(plan), false);
});

test('DUPLICATES: an existing driver with the same name (different case/spacing) is reused, not duplicated', async () => {
  const repo = new MemoryImportRepo({ drivers: [{ id: 7, display_name: 'ALICE  alpha', name_key: 'alice alpha' }] });
  const plan = await preview(repo, sampleWorkbook());
  const alice = plan.actions.find((a) => a.entity === 'driver' && a.key === 'alice alpha');
  assert.equal(alice.action, 'unchanged');
  assert.equal(alice.id, 7);
  assert.deepEqual(countsOf(plan, 'driver'), { create: 3, unchanged: 1, conflict: 0 });
});

test('DUPLICATES: a new name that looks like an existing one needs your acknowledgement', async () => {
  const repo = new MemoryImportRepo({ drivers: [{ id: 7, display_name: 'Alice Alpa', name_key: 'alice alpa' }] });
  const plan = await preview(repo, sampleWorkbook());
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.canCommit, false);
  const issue = plan.blockers.find((i) => i.code === 'possible_duplicate_driver');
  assert.ok(issue);
  assert.equal(issue.ack_key, 'similar:driver:alice alpha');
  // acknowledging it unblocks the import
  const acked = await preview(repo, sampleWorkbook(), { acknowledged: [issue.ack_key] });
  assert.equal(acked.status, 'ready');
});

test('DUPLICATES: near-identical names inside the file are warned about', async () => {
  const plan = await preview(new MemoryImportRepo(), sampleWorkbook((c) => { c['Driver Stats'].A6 = 'Alice Alpa    Ferrari'; }));
  const w = plan.issues.find((i) => i.code === 'similar_names_in_file');
  assert.ok(w);
  assert.equal(w.severity, 'warning');
});

test('BLANK/ERROR problems block the plan', async () => {
  const plan = await preview(new MemoryImportRepo(), sampleWorkbook((c) => { c['Driver Stats'].B3 = { error: '#REF!' }; }));
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.canCommit, false);
  assert.ok(plan.blockers.some((i) => i.code === 'formula_error'));
});

test('a plan for a workbook with a missing sheet is blocked and has no actions', async () => {
  const { makeXlsx, sampleSheets } = await import('../test-helpers/xlsx.js');
  const plan = await preview(new MemoryImportRepo(), makeXlsx(sampleSheets().slice(0, 2)));
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.actions, []);
});

test('SAFE RE-IMPORT: the same file again is recognised', async () => {
  const repo = new MemoryImportRepo();
  const buf = sampleWorkbook();
  const first = await importSample(repo, undefined);
  assert.equal(first.status, 'imported');
  const plan = await preview(repo, buf);
  assert.equal(plan.status, 'already_imported');
  assert.equal(plan.alreadyImported.batch_id, first.batch_id);
  assert.equal(plan.summary.create, 0);
  assert.equal(plan.summary.conflict, 0);
  assert.equal(plan.summary.unchanged, 4 + 3 + 2 + 4 + 3 + 4 + 3 + 4);
});

test('a changed number is a CONFLICT, listed field by field', async () => {
  const repo = new MemoryImportRepo();
  await importSample(repo);
  const plan = await preview(repo, sampleWorkbook((c) => { c['Driver Stats'].B3 = 3; c['Driver Stats'].E3 = 4; }));
  assert.equal(plan.status, 'conflicts_only');
  assert.equal(plan.canCommit, true);
  const c = plan.conflicts.find((x) => x.entity === 'legacy_driver_totals');
  assert.equal(c.key, 'alice alpha');
  assert.deepEqual(c.changes.map((x) => [x.field, x.existing, x.incoming]), [['wins', 2, 3], ['podiums', 3, 4]]);
  assert.equal(c.resolution_key, 'legacy_driver_totals|alice alpha');
});

test('an APPROVED lap-time correction is not reported as a difference', async () => {
  const repo = new MemoryImportRepo();
  const typo = (c) => { c['Track Records'].B24 = 'Alice Alpha  \r\n01:10:000'; };
  await importSample(repo, typo);
  const rec = repo.data.circuitRecords.find((r) => r.record_type === 'race_fastest_lap' && r.circuit_id === 1);
  assert.equal(rec.review_status, 'pending_review');
  // the user approves the correction inside the app
  Object.assign(rec, { review_status: 'approved', lap_time_ms: 70000, lap_time_text: '1:10.000' });
  // a later file still has the same original text, but other numbers changed
  const plan = await preview(repo, sampleWorkbook((c) => { typo(c); c['Driver Stats'].K3 = 101; }));
  const recAction = plan.actions.find((a) => a.entity === 'circuit_record' && a.key === 'bahrain#race_fastest_lap');
  assert.equal(recAction.action, 'unchanged');
  assert.equal(plan.conflicts.length, 1, 'only the changed points total');
});

test('LEGACY vs SEASONS: adding legacy totals to a driver who already has finished seasons needs acknowledgement', async () => {
  const repo = new MemoryImportRepo({
    drivers: [{ id: 1, display_name: 'Alice Alpha', name_key: 'alice alpha' }],
    teams: [{ id: 1, name: 'Ferrari', name_key: 'ferrari' }],
    ...appSeasonData(),
  });
  const plan = await preview(repo, sampleWorkbook());
  assert.equal(plan.status, 'blocked');
  const issue = plan.blockers.find((i) => i.code === 'legacy_added_to_driver_with_seasons');
  assert.match(issue.message, /already in legacy totals/);
  assert.equal(issue.ack_key, 'double-count:driver:alice alpha');
  assert.ok(plan.blockers.some((i) => i.code === 'legacy_added_to_team_with_seasons'));
});

test('a season already flagged "in legacy baseline" does not trigger the double-counting warning', async () => {
  const seed = appSeasonData();
  seed.seasons[0].in_legacy_baseline = 1;
  const repo = new MemoryImportRepo({
    drivers: [{ id: 1, display_name: 'Alice Alpha', name_key: 'alice alpha' }],
    teams: [{ id: 1, name: 'Ferrari', name_key: 'ferrari' }],
    ...seed,
  });
  const plan = await preview(repo, sampleWorkbook());
  assert.equal(plan.status, 'ready');
});

test('nothing in the archive is ever marked for deletion: existing extras are only noted', async () => {
  const repo = new MemoryImportRepo({ drivers: [{ id: 50, display_name: 'Zed Extra', name_key: 'zed extra' }] });
  const plan = await preview(repo, sampleWorkbook());
  assert.ok(plan.issues.some((i) => i.code === 'existing_not_in_file' && i.details.entity === 'driver'));
  assert.ok(plan.actions.every((a) => ['create', 'unchanged', 'conflict'].includes(a.action)));
});
