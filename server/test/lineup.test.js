import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLineup, copyLineup, applyTeamChanges, addDriverToLineup,
  removeDriversFromLineup, driverTeamHistory, teamLineupForSeason, LineupError,
} from '../src/logic/lineup.js';

const FERRARI = 1, MERCEDES = 2, McLAREN = 3;
const A = 10, B = 11, C = 12;

test('2025: Driver A at Ferrari, 2026: Driver A at Mercedes - nothing is overwritten', () => {
  const lineup2025 = Object.freeze([
    Object.freeze({ season_id: 1, driver_id: A, team_id: FERRARI }),
    Object.freeze({ season_id: 1, driver_id: B, team_id: McLAREN }),
  ]);
  const copied = copyLineup(lineup2025, 2);
  const lineup2026 = applyTeamChanges(copied, [{ driver_id: A, team_id: MERCEDES }]);

  assert.deepEqual(lineup2026.map((e) => [e.season_id, e.driver_id, e.team_id]), [[2, A, MERCEDES], [2, B, McLAREN]]);
  // 2025 is exactly as it was (frozen objects would throw if anything tried to edit them)
  assert.deepEqual(lineup2025.map((e) => [e.season_id, e.driver_id, e.team_id]), [[1, A, FERRARI], [1, B, McLAREN]]);
  assert.equal(new Set([...lineup2025, ...lineup2026].map((e) => e.driver_id)).size, 2, 'still only 2 drivers, no duplicates');
});

test('copyLineup copies drivers and teams but gives them the new season', () => {
  const copy = copyLineup([{ season_id: 1, driver_id: A, team_id: FERRARI }], 7);
  assert.deepEqual(copy, [{ season_id: 7, driver_id: A, team_id: FERRARI }]);
});

test('a driver cannot be listed twice in one season', () => {
  const r = validateLineup([{ driver_id: A, team_id: FERRARI }, { driver_id: A, team_id: MERCEDES }]);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'duplicate_driver');
});

test('missing and unknown drivers/teams are rejected', () => {
  const r = validateLineup(
    [{ driver_id: null, team_id: FERRARI }, { driver_id: 99, team_id: 77 }, { driver_id: B, team_id: null }],
    { driverIds: [A, B], teamIds: [FERRARI] },
  );
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('missing_driver'));
  assert.ok(codes.includes('unknown_driver'));
  assert.ok(codes.includes('unknown_team'));
  assert.ok(codes.includes('missing_team'));
});

test('a valid line-up passes', () => {
  assert.equal(validateLineup([{ driver_id: A, team_id: FERRARI }, { driver_id: B, team_id: FERRARI }], { driverIds: [A, B], teamIds: [FERRARI] }).ok, true);
});

test('transferring a driver who is not in the line-up is refused', () => {
  assert.throws(() => applyTeamChanges([{ driver_id: A, team_id: FERRARI }], [{ driver_id: C, team_id: MERCEDES }]), LineupError);
});

test('adding and removing drivers returns new lists and never edits the old one', () => {
  const base = Object.freeze([Object.freeze({ season_id: 2, driver_id: A, team_id: FERRARI })]);
  const added = addDriverToLineup(base, { season_id: 2, driver_id: B, team_id: MERCEDES });
  assert.equal(added.length, 2);
  assert.equal(base.length, 1);
  assert.throws(() => addDriverToLineup(added, { season_id: 2, driver_id: B, team_id: FERRARI }), LineupError);
  assert.deepEqual(removeDriversFromLineup(added, [A]).map((e) => e.driver_id), [B]);
});

test('driverTeamHistory is ordered by year and teamLineupForSeason finds team-mates', () => {
  const data = {
    seasons: [{ id: 1, year: 2025 }, { id: 2, year: 2026 }],
    entries: [
      { id: 1, season_id: 2, driver_id: A, team_id: MERCEDES },
      { id: 2, season_id: 1, driver_id: A, team_id: FERRARI },
      { id: 3, season_id: 1, driver_id: B, team_id: FERRARI },
    ],
  };
  assert.deepEqual(driverTeamHistory(data, A).map((h) => [h.year, h.team_id]), [[2025, FERRARI], [2026, MERCEDES]]);
  assert.deepEqual(teamLineupForSeason(data, FERRARI, 1), [A, B]);
});
