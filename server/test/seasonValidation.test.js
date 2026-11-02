import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeasonSubmission, normalizeSeasonSubmission } from '../src/logic/seasonValidation.js';

const FERRARI = 1, MERCEDES = 2;
const A = 10, B = 11, C = 12;
const context = { driverIds: [A, B, C], teamIds: [FERRARI, MERCEDES] };

function goodSubmission() {
  return {
    season: { year: 2026 },
    entries: [{ driver_id: A, team_id: MERCEDES }, { driver_id: B, team_id: FERRARI }, { driver_id: C, team_id: FERRARI }],
    driverStandings: [
      { driver_id: A, position: 1, points: 400 },
      { driver_id: B, position: 2, points: 300 },
      { driver_id: C, position: 3, points: 200 },
    ],
    constructorStandings: [
      { team_id: FERRARI, position: 1, points: 500 },
      { team_id: MERCEDES, position: 2, points: 400 },
    ],
    driverStats: [{ driver_id: A, wins: 8, second_places: 4, third_places: 2, podiums: 14, poles: 6, p1_fl_gp: 3, fastest_laps: 5 }],
    teamStats: [{ team_id: MERCEDES, wins: 8, podiums: 14 }],
    champions: { drivers_driver_id: A, constructors_team_id: FERRARI },
  };
}
const codes = (list) => list.map((e) => e.code);

test('a normal season-end submission is valid and needs NO race-by-race data', () => {
  const r = validateSeasonSubmission(goodSubmission(), context, { forFinal: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(goodSubmission()).includes('race'), false);
});

test('missing statistics are allowed and are not treated as zero', () => {
  const sub = goodSubmission();
  sub.driverStats = [{ driver_id: A, wins: '8', podiums: '', poles: null }];   // podiums blank, poles unknown
  sub.driverStandings[1].points = '';                                            // blank points
  const normalized = normalizeSeasonSubmission(sub);
  assert.equal(normalized.driverStats[0].wins, 8);
  assert.equal(normalized.driverStats[0].podiums, null);   // blank stays unknown
  assert.equal(normalized.driverStats[0].poles, null);
  assert.equal(normalized.driverStandings[1].points, null);
  const r = validateSeasonSubmission(normalized, context, { forFinal: true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('a typed 0 stays 0 (it is information, unlike a blank)', () => {
  const n = normalizeSeasonSubmission({ driverStats: [{ driver_id: A, wins: '0' }], driverStandings: [{ driver_id: A, position: '4', points: 0 }] });
  assert.equal(n.driverStats[0].wins, 0);
  assert.equal(n.driverStandings[0].points, 0);
  assert.equal(n.driverStandings[0].position, 4);
});

test('points are exactly what you typed: nothing is calculated from stats', () => {
  const sub = goodSubmission();
  sub.driverStandings = [{ driver_id: A, position: 1, points: null }];   // lots of wins, but no points typed
  const n = normalizeSeasonSubmission(sub);
  assert.equal(n.driverStandings[0].points, null);
  assert.equal(validateSeasonSubmission(n, context).ok, true);
});

test('line-up problems are errors', () => {
  const sub = goodSubmission();
  sub.entries.push({ driver_id: A, team_id: FERRARI }); // A twice
  assert.ok(codes(validateSeasonSubmission(sub, context).errors).includes('duplicate_driver'));
});

test('standings must use drivers/teams that are in the season, with unique positions', () => {
  const sub = goodSubmission();
  sub.driverStandings.push({ driver_id: 999, position: 3, points: 1 });  // not in line-up and duplicate position
  const c = codes(validateSeasonSubmission(sub, context).errors);
  assert.ok(c.includes('standing_not_in_season'));
  assert.ok(c.includes('duplicate_position'));
});

test('negative or fractional numbers are rejected', () => {
  const sub = goodSubmission();
  sub.driverStandings[0].points = -5;
  sub.driverStats[0].wins = 2.5;
  const c = codes(validateSeasonSubmission(sub, context).errors);
  assert.ok(c.includes('bad_points'));
  assert.ok(c.includes('bad_stat'));
});

test('impossible achievements are caught', () => {
  const sub = goodSubmission();
  sub.driverStats = [{ driver_id: A, wins: 10, second_places: 1, third_places: 1, podiums: 5, poles: 2, p1_fl_gp: 4, fastest_laps: 9 }];
  const c = codes(validateSeasonSubmission(sub, context).errors);
  assert.ok(c.includes('wins_exceed_podiums'));
  assert.ok(c.includes('podium_mismatch'));
  assert.ok(c.includes('p1_fl_gp_too_high'));  // 4 > poles (2)
});

test('stats for a driver who is not in the season are rejected', () => {
  const sub = goodSubmission();
  sub.driverStats = [{ driver_id: 999, wins: 1 }];
  assert.ok(codes(validateSeasonSubmission(sub, context).errors).includes('stats_not_in_season'));
});

test('finalising requires both champions; drafts do not', () => {
  const sub = goodSubmission();
  sub.champions = {};
  assert.equal(validateSeasonSubmission(sub, context).ok, true);                 // draft: fine
  const final = codes(validateSeasonSubmission(sub, context, { forFinal: true }).errors);
  assert.ok(final.includes('missing_drivers_champion'));
  assert.ok(final.includes('missing_constructors_champion'));
});

test('a champion must belong to the season', () => {
  const sub = goodSubmission();
  sub.champions = { drivers_driver_id: 999, constructors_team_id: 888 };
  const c = codes(validateSeasonSubmission(sub, context).errors);
  assert.ok(c.includes('champion_not_in_season'));
  assert.ok(c.includes('champion_team_not_in_season'));
});

test('warnings (not errors) for a champion who is not P1 and for odd points order', () => {
  const sub = goodSubmission();
  sub.champions.drivers_driver_id = B;                 // B is P2
  sub.driverStandings[2].points = 350;                 // P3 has more points than P2
  const r = validateSeasonSubmission(sub, context, { forFinal: true });
  assert.equal(r.ok, true);
  assert.ok(codes(r.warnings).includes('driver_champion_not_first'));
  assert.ok(codes(r.warnings).includes('points_order'));
});

test('team points that differ from the drivers total only produce a warning', () => {
  const sub = goodSubmission();            // Ferrari drivers: 300 + 200 = 500 -> matches
  assert.ok(!codes(validateSeasonSubmission(sub, context).warnings).includes('team_points_differ'));
  sub.constructorStandings[0].points = 777;
  const r = validateSeasonSubmission(sub, context);
  assert.ok(codes(r.warnings).includes('team_points_differ'));
  assert.equal(r.ok, true);
});

test('a bad year is rejected', () => {
  const sub = goodSubmission();
  sub.season.year = 26;
  assert.ok(codes(validateSeasonSubmission(sub, context).errors).includes('bad_year'));
});
