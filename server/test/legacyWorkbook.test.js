// These tests use the REAL F1.xlsx data (via the snapshot extracted from it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { realLegacy, loadSnapshot, ROOT } from '../test-helpers/data.js';
import { buildLegacyDataset } from '../src/logic/legacyBuilder.js';

const { dataset, ids } = realLegacy();
const issueCodes = dataset.issues.map((i) => i.code);

test('the original workbook is unchanged (fingerprint matches)', () => {
  const file = path.join(ROOT, 'data/original/F1.xlsx');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const stored = fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx.sha256'), 'utf8').trim();
  assert.equal(actual, stored);
  assert.equal(loadSnapshot().source.sha256, stored);
});

test('the real workbook has the expected shape', () => {
  assert.equal(dataset.summary.drivers, 22);
  assert.equal(dataset.summary.teams, 11);
  assert.equal(dataset.summary.circuits, 29);
  assert.equal(dataset.summary.gp_winner_rows, 104);
  assert.equal(dataset.summary.circuit_records, 58); // 29 fastest laps + 29 poles
});

test('there are no blocking errors in the real data', () => {
  assert.equal(dataset.summary.issue_counts.error, 0, JSON.stringify(dataset.issues.filter((i) => i.severity === 'error')));
});

test('no duplicate drivers, teams or circuits after cleaning', () => {
  for (const list of [dataset.drivers, dataset.teams, dataset.circuits]) {
    assert.equal(new Set(list.map((x) => x.key)).size, list.length);
  }
});

test('circuit names hidden in Excel linked data types are recovered', () => {
  const names = dataset.circuits.map((c) => c.gp_name);
  assert.ok(names.includes('Bahrain'));
  assert.ok(names.includes('Emilia-Romagna'));
  assert.ok(names.includes('Tuscany'));
  assert.ok(names.includes('Las Vegas'));
  assert.ok(!names.some((n) => n.startsWith('#')), 'no #VALUE! names');
  assert.equal(dataset.circuits.filter((c) => c.source_label_kind === 'linked_entity').length, 28);
});

test('M.P.S is kept exactly as a legacy field and not guessed', () => {
  const vers = ids.legacyDrivers.find((l) => l.driver_id === ids.idOfDriver('Max Verstappen'));
  assert.equal(vers.mps, 450);
  assert.ok(issueCodes.includes('mps_kept_as_is'));
  // M.P.S is never added to season results
  assert.equal(ids.legacyTeams.find((t) => t.team_id === ids.idOfTeam('Red Bull Racing')).mps, 692);
});

test('blank cells in count columns import as 0, and this is reported', () => {
  const albon = ids.legacyDrivers.find((l) => l.driver_id === ids.idOfDriver('Alex Albon'));
  assert.equal(albon.wins, 0);
  assert.equal(albon.poles, 0);
  const note = dataset.issues.find((i) => i.code === 'blank_counted_as_zero');
  assert.ok(note && note.details.driver_stats > 0);
});

test('wins + 2nd + 3rd = podiums for every driver', () => {
  assert.ok(!issueCodes.includes('podium_sum_mismatch'));
  for (const d of ids.legacyDrivers) assert.equal(d.wins + d.second_places + d.third_places, d.podiums);
});

test('Track Records winners agree with Driver Stats wins (104 in total)', () => {
  assert.ok(!issueCodes.includes('winner_tally_mismatch'));
  assert.equal(ids.legacyDrivers.reduce((a, d) => a + d.wins, 0), 104);
  assert.equal(ids.gpWinners.length, 104);
});

test('the two Las Vegas lap times are PENDING approval and the originals are untouched', () => {
  const lv = dataset.circuits.find((c) => c.gp_name === 'Las Vegas');
  const recs = dataset.circuitRecords.filter((r) => r.circuit_key === lv.key);
  assert.equal(recs.length, 2);
  const fl = recs.find((r) => r.record_type === 'race_fastest_lap');
  const pole = recs.find((r) => r.record_type === 'qualifying_pole');
  for (const r of [fl, pole]) {
    assert.equal(r.review_status, 'pending_review');
    assert.equal(r.lap_time_ms, null);          // correction NOT applied
    assert.ok(r.original_text.includes('01:11:'), 'original text preserved');
  }
  assert.equal(fl.suggested_text, '1:11.775');
  assert.equal(pole.suggested_text, '1:11.561');
  const pending = dataset.issues.filter((i) => i.severity === 'pending_review');
  assert.equal(pending.length, 2);
  // every other record parsed fine
  assert.equal(dataset.circuitRecords.filter((r) => r.review_status === 'ok').length, 56);
});

test('the Team Stats inconsistencies are flagged for review, not silently fixed', () => {
  const gap = dataset.issues.find((i) => i.code === 'team_stats_behind_driver_stats');
  assert.deepEqual(gap.details.gaps.wins, { drivers: 104, teams: 96 });
  assert.deepEqual(gap.details.gaps.podiums, { drivers: 312, teams: 288 });
  assert.ok(!('points' in gap.details.gaps), 'total points agree (9696)');
  const over = dataset.issues.find((i) => i.code === 'driver_wins_exceed_team_wins');
  assert.equal(over.details.driver_wins, 42);
  assert.equal(over.details.team_wins, 41);
  // values are imported exactly as written
  assert.equal(ids.legacyTeams.find((t) => t.team_id === ids.idOfTeam('Red Bull Racing')).wins, 41);
  assert.equal(ids.legacyDrivers.find((d) => d.driver_id === ids.idOfDriver('Max Verstappen')).wins, 42);
});

test('team history keeps order but has no invented years', () => {
  const ofDriver = (name) => ids.legacyTeamHistory
    .filter((h) => h.driver_id === ids.idOfDriver(name))
    .sort((a, b) => a.sequence_no - b.sequence_no)
    .map((h) => ids.teams.find((t) => t.id === h.team_id).name);
  assert.deepEqual(ofDriver('Arvid Lindblad'), ['Racing Bulls', 'Red Bull Racing', 'Audi']);
  assert.deepEqual(ofDriver('Lewis Hamilton'), ['Ferrari', 'Mercedes']);
  assert.deepEqual(ofDriver('Lance Stroll'), ['Aston Martin', 'Haas', 'Alpine']);
  assert.ok(ids.legacyTeamHistory.every((h) => !('year' in h)));
});

test('legacy titles match between sheets', () => {
  const sum = (rows, f) => rows.reduce((a, r) => a + r[f], 0);
  assert.equal(sum(ids.legacyDrivers, 'drivers_titles'), 4);
  assert.equal(sum(ids.legacyTeams, 'drivers_titles'), 4);
  assert.equal(sum(ids.legacyTeams, 'constructors_titles'), 4);
  assert.equal(sum(ids.legacyDrivers, 'constructors_titles'), 8); // 4 titles x 2 drivers
  assert.ok(!issueCodes.includes('drivers_titles_mismatch'));
});

test('importing is repeatable: the same snapshot always gives the same result', () => {
  const again = realLegacy().dataset;
  assert.deepEqual(again.summary, dataset.summary);
  assert.deepEqual(again.legacyDriverTotals, dataset.legacyDriverTotals);
  assert.deepEqual(again.drivers.map((d) => d.key), dataset.drivers.map((d) => d.key));
});

test('bad data is caught: a duplicate driver and an unknown winner raise errors', () => {
  const snap = loadSnapshot();
  snap.driver_stats.rows.push({ ...snap.driver_stats.rows[0], row: 99 });            // duplicate Verstappen
  snap.track_records.columns[0].winners.push({ row: 8, raw: 'Nobody Known' });       // unknown driver
  const bad = buildLegacyDataset(snap);
  const codes = bad.issues.filter((i) => i.severity === 'error').map((i) => i.code);
  assert.ok(codes.includes('duplicate_driver'));
  assert.ok(codes.includes('unknown_driver_in_track_records'));
});
