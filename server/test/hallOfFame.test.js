import test from 'node:test';
import assert from 'node:assert/strict';
import { realLegacy, addSeason } from '../test-helpers/data.js';
import { buildHallOfFame, saveChampionship, unassignedLegacyTitles, ChampionshipLockedError } from '../src/logic/hallOfFame.js';
import { calculateDriverCareer } from '../src/logic/careerTotals.js';

const { ids, data: base } = realLegacy();
const verstappen = ids.idOfDriver('Max Verstappen');
const hamilton = ids.idOfDriver('Lewis Hamilton');
const antonelli = ids.idOfDriver('Kimi Antonelli');
const redBull = ids.idOfTeam('Red Bull Racing');
const ferrari = ids.idOfTeam('Ferrari');
const mercedes = ids.idOfTeam('Mercedes');

const champ = (over) => ({
  season_id: 1, championship_type: 'drivers', driver_id: 10, team_id: 1, points: 400,
  driver_name_snapshot: 'Driver A', team_name_snapshot: 'Ferrari', ...over,
});

test('Hall of Fame lists every season newest first with both champions', () => {
  const seasons = [{ id: 1, year: 2025 }, { id: 2, year: 2026 }, { id: 3, year: 2024 }];
  const championships = [
    champ({ season_id: 1 }),
    { season_id: 1, championship_type: 'constructors', driver_id: null, team_id: 1, points: 700, driver_name_snapshot: null, team_name_snapshot: 'Ferrari' },
    champ({ season_id: 2, driver_id: 10, team_id: 2, driver_name_snapshot: 'Driver A', team_name_snapshot: 'Mercedes' }),
  ];
  const hof = buildHallOfFame({ seasons, championships });
  assert.deepEqual(hof.map((c) => c.year), [2026, 2025]);          // 2024 has no champions yet -> no card
  assert.equal(hof[1].drivers.driver_name, 'Driver A');
  assert.equal(hof[1].constructors.team_name, 'Ferrari');
  assert.equal(hof[1].drivers.points, 400);
});

test('TRANSFERS never rewrite history: Driver A is still a Ferrari champion in 2025 after moving to Mercedes', () => {
  const rows = [champ({ season_id: 1, team_id: 1, team_name_snapshot: 'Ferrari' })];
  // 2026: Driver A wins again, now with Mercedes
  const { rows: after } = saveChampionship(rows, champ({ season_id: 2, team_id: 2, team_name_snapshot: 'Mercedes' }));
  const hof = buildHallOfFame({ seasons: [{ id: 1, year: 2025 }, { id: 2, year: 2026 }], championships: after });
  assert.equal(hof.find((c) => c.year === 2025).drivers.team_name, 'Ferrari');
  assert.equal(hof.find((c) => c.year === 2026).drivers.team_name, 'Mercedes');
});

test('saved names are snapshots: a later rename of a team does not change the card', () => {
  const rows = [champ({ team_name_snapshot: 'Racing Bulls' })];
  const teamsNow = [{ id: 1, name: 'Visa Cash App RB' }]; // team renamed later
  const hof = buildHallOfFame({ seasons: [{ id: 1, year: 2025 }], championships: rows, teams: teamsNow });
  assert.equal(hof[0].drivers.team_name, 'Racing Bulls');
});

test('a recorded champion cannot be changed by accident', () => {
  const rows = [champ({})];
  assert.throws(() => saveChampionship(rows, champ({ driver_id: 11, driver_name_snapshot: 'Driver B' })), ChampionshipLockedError);
  assert.equal(rows[0].driver_id, 10);
});

test('a champion can be corrected on purpose, only with a reason, and the change is logged', () => {
  const rows = Object.freeze([Object.freeze(champ({}))]);
  const change = champ({ driver_id: 11, driver_name_snapshot: 'Driver B' });
  assert.throws(() => saveChampionship(rows, change, { intentional: true }), ChampionshipLockedError);       // no reason
  assert.throws(() => saveChampionship(rows, change, { intentional: true, note: '   ' }), ChampionshipLockedError);
  const { rows: fixed, logEntry } = saveChampionship(rows, change, { intentional: true, note: 'Typed the wrong driver' });
  assert.equal(fixed[0].driver_id, 11);
  assert.equal(fixed[0].correction_note, 'Typed the wrong driver');
  assert.equal(logEntry.action, 'correct_champion');
  assert.equal(logEntry.old.driver_id, 10);
  assert.equal(logEntry.new.driver_id, 11);
  assert.equal(rows[0].driver_id, 10, 'original list untouched');
});

test('saving the same champion again is harmless and fills in missing points', () => {
  const rows = [champ({ points: null })];
  const { rows: again, logEntry } = saveChampionship(rows, champ({ points: 412 }));
  assert.equal(again.length, 1);
  assert.equal(again[0].points, 412);
  assert.equal(logEntry, null);
});

test('the workbook titles without years are listed as unassigned, not invented', () => {
  const list = unassignedLegacyTitles({ legacyDrivers: ids.legacyDrivers, legacyTeams: ids.legacyTeams, seasons: [], championships: [] });
  const find = (pred) => list.find(pred);
  assert.equal(find((t) => t.kind === 'drivers' && t.driver_id === verstappen).remaining, 2);
  assert.equal(find((t) => t.kind === 'drivers' && t.driver_id === hamilton).remaining, 1);
  assert.equal(find((t) => t.kind === 'drivers' && t.driver_id === antonelli).remaining, 1);
  assert.equal(find((t) => t.kind === 'constructors' && t.team_id === ferrari).remaining, 2);
  assert.equal(find((t) => t.kind === 'constructors' && t.team_id === mercedes).remaining, 2);
  assert.equal(list.length, 5);
});

test('assigning a year to a legacy title uses it up and does NOT add a 3rd Verstappen title', () => {
  // The user says: Verstappen's first title was 2024, with Red Bull. That season is inside the legacy totals.
  const data = addSeason(base, {
    id: 1, year: 2024, in_legacy_baseline: 1,
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 437 }],
    champions: { drivers: { driver_id: verstappen, team_id: redBull, points: 437, driver_name_snapshot: 'Max Verstappen', team_name_snapshot: 'Red Bull Racing' } },
  });
  assert.equal(calculateDriverCareer(data, verstappen).drivers_titles, 2);          // still 2, never 3
  const list = unassignedLegacyTitles({ legacyDrivers: data.legacyDrivers, legacyTeams: data.legacyTeams, seasons: data.seasons, championships: data.championships });
  assert.equal(list.find((t) => t.kind === 'drivers' && t.driver_id === verstappen).remaining, 1);
  const hof = buildHallOfFame({ seasons: data.seasons, championships: data.championships });
  assert.equal(hof[0].drivers.driver_name, 'Max Verstappen');
});

test('a NEW title after the legacy baseline is added on top', () => {
  const data = addSeason(base, {
    id: 1, year: 2027,
    drivers: [{ driver_id: verstappen, team_id: redBull, position: 1, points: 450 }],
    champions: { drivers: { driver_id: verstappen, team_id: redBull, points: 450, driver_name_snapshot: 'Max Verstappen', team_name_snapshot: 'Red Bull Racing' } },
  });
  assert.equal(calculateDriverCareer(data, verstappen).drivers_titles, 3);
});
