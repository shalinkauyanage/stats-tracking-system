import test from 'node:test';
import assert from 'node:assert/strict';
import { realLegacy, addSeason } from '../test-helpers/data.js';
import {
  calculateDriverCareer, calculateTeamCareer, calculateAllDriverCareers,
  driverSeasonHistory, findBaselineConflicts, countedSeasonIds,
} from '../src/logic/careerTotals.js';

const { ids, data: base } = realLegacy();
const verstappen = ids.idOfDriver('Max Verstappen');
const hamilton = ids.idOfDriver('Lewis Hamilton');
const norris = ids.idOfDriver('Lando Norris');
const redBull = ids.idOfTeam('Red Bull Racing');
const ferrari = ids.idOfTeam('Ferrari');
const mercedes = ids.idOfTeam('Mercedes');

test('with no seasons entered, career totals equal the legacy numbers', () => {
  const c = calculateDriverCareer(base, verstappen);
  assert.equal(c.wins, 42);
  assert.equal(c.podiums, 64);
  assert.equal(c.points, 1479);
  assert.equal(c.drivers_titles, 2);
  assert.equal(c.mps, 450);
  assert.equal(c.seasons_counted, 0);
});

test('a final season adds on top of legacy and never changes the legacy rows', () => {
  const before = structuredClone(base.legacyDrivers);
  const data = addSeason(base, {
    id: 1, year: 2027,
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 400, stats: { wins: 10, podiums: 15, poles: 8 } }],
  });
  const c = calculateDriverCareer(data, verstappen);
  assert.equal(c.wins, 52);
  assert.equal(c.podiums, 79);
  assert.equal(c.poles, 51);
  assert.equal(c.points, 1879);
  assert.equal(c.seasons_counted, 1);
  assert.deepEqual(data.legacyDrivers, before, 'legacy baseline untouched');
});

test('NO DOUBLE COUNTING: a season already inside the legacy totals is not added again', () => {
  const data = addSeason(base, {
    id: 1, year: 2024, in_legacy_baseline: 1,
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 437, stats: { wins: 9, podiums: 14 } }],
    champions: { drivers: { driver_id: verstappen, team_id: redBull, points: 437 } },
  });
  const c = calculateDriverCareer(data, verstappen);
  assert.equal(c.wins, 42);            // unchanged
  assert.equal(c.points, 1479);        // unchanged
  assert.equal(c.drivers_titles, 2);   // title not counted twice
  assert.equal(c.seasons_counted, 0);
  assert.equal(c.seasons_in_baseline, 1);
  // but it still shows on the profile
  const history = driverSeasonHistory(data, verstappen);
  assert.equal(history.length, 1);
  assert.equal(history[0].counted_in_career, false);
  assert.equal(history[0].drivers_champion, true);
});

test('recalculating is repeatable: the same stored data always gives the same totals', () => {
  const data = addSeason(base, { id: 1, year: 2027, drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 100, stats: { wins: 3 } }] });
  const first = calculateDriverCareer(data, verstappen);
  const second = calculateDriverCareer(structuredClone(data), verstappen);
  assert.deepEqual(first, second);
  assert.equal(first.wins, 45);
  assert.equal(countedSeasonIds(data).size, 1);
});

test('a draft season counts for nothing until it is finalised', () => {
  const draft = addSeason(base, {
    id: 1, year: 2027, status: 'draft',
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 400, stats: { wins: 10 } }],
  });
  assert.equal(calculateDriverCareer(draft, verstappen).wins, 42);
  draft.seasons[0].status = 'final';
  assert.equal(calculateDriverCareer(draft, verstappen).wins, 52);
});

test('MISSING IS NOT ZERO: unknown season stats are skipped, and all-unknown stays null', () => {
  const data = addSeason(base, {
    id: 1, year: 2027,
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: null, stats: { wins: 5 } }], // podiums, points unknown
  });
  const c = calculateDriverCareer(data, verstappen);
  assert.equal(c.wins, 47);
  assert.equal(c.podiums, 64);          // legacy only, not NaN, not reduced
  assert.equal(c.points, 1479);
  // a brand-new driver with nothing known has null, not 0
  const rookie = 9999;
  const withRookie = addSeason(base, { id: 1, year: 2027, drivers: [{ driver_id: rookie, team_id: redBull, position: 20, points: null, stats: { wins: 0 } }] });
  const r = calculateDriverCareer(withRookie, rookie);
  assert.equal(r.wins, 0);              // a real, typed zero
  assert.equal(r.podiums, null);        // never typed -> unknown
  assert.equal(r.points, null);
  assert.equal(r.sprint_wins, null);
});

test('team totals: fastest laps and sprint stats are unknown (null) when the workbook never had them', () => {
  const t = calculateTeamCareer(base, redBull);
  assert.equal(t.wins, 41);
  assert.equal(t.fastest_laps, null);
  assert.equal(t.sprint_wins, null);
  assert.equal(t.points, 2025);
});

test('TRANSFERS: achievements stay with the team and season they were earned in', () => {
  const A = hamilton;
  let data = addSeason(base, {
    id: 1, year: 2027,
    drivers: [{ driver_id: A, team_id: ferrari, position: 2, points: 300, stats: { wins: 5, podiums: 12 } }],
    teams: [{ team_id: ferrari, position: 1, points: 700, stats: { wins: 8, podiums: 20 } }],
  });
  data = addSeason(data, {
    id: 2, year: 2028,
    drivers: [{ driver_id: A, team_id: mercedes, position: 1, points: 350, stats: { wins: 3, podiums: 9 } }],
    teams: [{ team_id: mercedes, position: 2, points: 600, stats: { wins: 4, podiums: 14 } }],
  });
  // the driver keeps everything (one identity)
  const career = calculateDriverCareer(data, A);
  assert.equal(career.wins, 15 + 5 + 3);
  assert.equal(career.points, 1017 + 300 + 350);
  // Ferrari only got 2027; Mercedes only got 2028
  const f = calculateTeamCareer(data, ferrari);
  const m = calculateTeamCareer(data, mercedes);
  assert.equal(f.wins, 18 + 8);
  assert.equal(m.wins, 20 + 4);
  // history shows two separate assignments
  const hist = driverSeasonHistory(data, A);
  assert.deepEqual(hist.map((h) => [h.year, h.team_id]), [[2027, ferrari], [2028, mercedes]]);
  assert.equal(data.entries.filter((e) => e.driver_id === A).length, 2); // not duplicated
});

test('constructors titles follow the team the driver was in THAT season', () => {
  let data = addSeason(base, {
    id: 1, year: 2027,
    drivers: [{ driver_id: norris, team_id: ferrari, position: 3, points: 200 }],
    teams: [{ team_id: ferrari, position: 1, points: 650 }],
    champions: { constructors: { team_id: ferrari, points: 650 } },
  });
  assert.equal(calculateDriverCareer(data, norris).constructors_titles, 0 + 1); // legacy 0 + 1 new
  assert.equal(calculateTeamCareer(data, ferrari).constructors_titles, 2 + 1);
  // moving Norris to McLaren in 2028 does not take the 2027 title away
  data = addSeason(data, { id: 2, year: 2028, drivers: [{ driver_id: norris, team_id: ids.idOfTeam('McLaren'), position: 5, points: 150 }] });
  assert.equal(calculateDriverCareer(data, norris).constructors_titles, 1);
});

test('calculateAllDriverCareers lists legacy drivers and new drivers once each', () => {
  const data = addSeason(base, { id: 1, year: 2027, drivers: [{ driver_id: 500, team_id: redBull, position: 1, points: 10 }] });
  const all = calculateAllDriverCareers(data);
  assert.equal(all.length, 23);
  assert.equal(new Set(all.map((x) => x.driver_id)).size, 23);
});

test('findBaselineConflicts warns when back-filled seasons exceed the legacy total', () => {
  const data = addSeason(base, {
    id: 1, year: 2024, in_legacy_baseline: 1,
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 400, stats: { wins: 50 } }],
  });
  const issues = findBaselineConflicts(data);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'wins');
  assert.equal(issues[0].legacy, 42);
  assert.deepEqual(findBaselineConflicts(base), []);
});
