// Validation of the season-end form.
//
// You type final points and achievements at the END of a season. This module only
// CHECKS what you typed. It never calculates points from races, never fills in
// missing numbers and never turns a blank into 0.
//
// submission = {
//   season:               { year },
//   entries:              [{ driver_id, team_id }],
//   driverStandings:      [{ driver_id, position, points }],
//   constructorStandings: [{ team_id, position, points }],
//   driverStats:          [{ driver_id, wins, podiums, ... }],
//   teamStats:            [{ team_id, wins, ... }],
//   champions:            { drivers_driver_id, constructors_team_id },
// }
//
// validateSeasonSubmission(submission, { driverIds, teamIds }, { forFinal })
//   -> { ok, errors, warnings }
//   errors   = must be fixed before saving
//   warnings = worth a look, but you may save anyway

import { parseNullableCount, isId } from './numbers.js';
import { validateLineup } from './lineup.js';
import { DRIVER_SEASON_STAT_FIELDS, TEAM_SEASON_STAT_FIELDS } from './stats.js';

/** Turns form text into numbers: '' -> null (unknown), '0' -> 0, '12' -> 12. Bad text is left alone so validation can report it. */
export function normalizeSeasonSubmission(submission) {
  const fix = (v) => {
    const parsed = parseNullableCount(v);
    return parsed.ok ? parsed.value : v;
  };
  const fixRow = (row, fields) => {
    const out = { ...row };
    for (const f of fields) if (f in out) out[f] = fix(out[f]);
    return out;
  };
  return {
    ...submission,
    driverStandings: (submission.driverStandings || []).map((r) => fixRow(r, ['position', 'points'])),
    constructorStandings: (submission.constructorStandings || []).map((r) => fixRow(r, ['position', 'points'])),
    driverStats: (submission.driverStats || []).map((r) => fixRow(r, DRIVER_SEASON_STAT_FIELDS)),
    teamStats: (submission.teamStats || []).map((r) => fixRow(r, TEAM_SEASON_STAT_FIELDS)),
  };
}

export function validateSeasonSubmission(rawSubmission, context = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const error = (code, message, extra = {}) => errors.push({ code, message, ...extra });
  const warn = (code, message, extra = {}) => warnings.push({ code, message, ...extra });
  const sub = rawSubmission || {};

  // ---- season
  const year = sub.season?.year;
  if (!Number.isInteger(year) || year < 1900 || year > 2300) {
    error('bad_year', 'Enter a valid season year (for example 2026).');
  }

  // ---- line-up
  const entries = sub.entries || [];
  const lineup = validateLineup(entries, { driverIds: context.driverIds, teamIds: context.teamIds });
  errors.push(...lineup.errors);
  const driversInSeason = new Set(entries.map((e) => e.driver_id));
  const teamsInSeason = new Set(entries.map((e) => e.team_id));

  // ---- standings (generic checker)
  const checkStandings = (rows, idField, label, allowedIds, allowedLabel) => {
    const seenIds = new Set();
    const seenPositions = new Set();
    (rows || []).forEach((row, i) => {
      const where = `${label} line ${i + 1}`;
      if (!isId(row[idField])) { error('standing_missing_id', `${where}: choose ${allowedLabel}.`); return; }
      if (seenIds.has(row[idField])) error('standing_duplicate', `${where}: ${allowedLabel} appears twice in the ${label}.`);
      seenIds.add(row[idField]);
      if (!allowedIds.has(row[idField])) error('standing_not_in_season', `${where}: ${allowedLabel} is not in this season's line-up.`);
      if (!Number.isInteger(row.position) || row.position < 1) error('bad_position', `${where}: position must be 1 or more.`);
      else {
        if (seenPositions.has(row.position)) error('duplicate_position', `${where}: position ${row.position} is used twice.`);
        seenPositions.add(row.position);
      }
      const points = parseNullableCount(row.points);
      if (!points.ok) error('bad_points', `${where}: points must be a whole number or blank.`);
    });
  };
  checkStandings(sub.driverStandings, 'driver_id', "drivers' standings", driversInSeason, 'driver');
  checkStandings(sub.constructorStandings, 'team_id', "constructors' standings", teamsInSeason, 'team');

  // ---- achievements
  const checkStats = (rows, idField, allowedIds, fields, label) => {
    const seen = new Set();
    (rows || []).forEach((row, i) => {
      const where = `${label} stats line ${i + 1}`;
      if (!allowedIds.has(row[idField])) { error('stats_not_in_season', `${where}: not part of this season's line-up.`); return; }
      if (seen.has(row[idField])) error('stats_duplicate', `${where}: entered twice.`);
      seen.add(row[idField]);
      const values = {};
      for (const f of fields) {
        const parsed = parseNullableCount(row[f]);
        if (!parsed.ok) error('bad_stat', `${where}: ${f} must be a whole number (0 or more) or blank.`, { field: f });
        values[f] = parsed.ok ? parsed.value : null;
      }
      const known = (a, b) => values[a] !== null && values[a] !== undefined && values[b] !== null && values[b] !== undefined;
      if (known('wins', 'podiums') && values.wins > values.podiums) {
        error('wins_exceed_podiums', `${where}: wins (${values.wins}) cannot be more than podiums (${values.podiums}).`);
      }
      if (fields.includes('second_places')) {
        const all = ['wins', 'second_places', 'third_places', 'podiums'].every((f) => values[f] !== null && values[f] !== undefined);
        if (all && values.wins + values.second_places + values.third_places !== values.podiums) {
          error('podium_mismatch', `${where}: wins + 2nd + 3rd (${values.wins + values.second_places + values.third_places}) must equal podiums (${values.podiums}).`);
        }
        for (const other of ['wins', 'poles', 'fastest_laps']) {
          if (known('p1_fl_gp', other) && values.p1_fl_gp > values[other]) {
            error('p1_fl_gp_too_high', `${where}: "P1 + FL + GP" (${values.p1_fl_gp}) cannot be more than ${other} (${values[other]}).`);
          }
        }
      }
      if (known('sprint_wins', 'sprint_podiums') && values.sprint_wins > values.sprint_podiums) {
        error('sprint_wins_exceed_podiums', `${where}: sprint wins cannot be more than sprint podiums.`);
      }
    });
  };
  checkStats(sub.driverStats, 'driver_id', driversInSeason, DRIVER_SEASON_STAT_FIELDS, 'Driver');
  checkStats(sub.teamStats, 'team_id', teamsInSeason, TEAM_SEASON_STAT_FIELDS, 'Team');

  // ---- champions
  const champs = sub.champions || {};
  if (champs.drivers_driver_id != null && !driversInSeason.has(champs.drivers_driver_id)) {
    error('champion_not_in_season', "The Drivers' Champion must be a driver in this season's line-up.");
  }
  if (champs.constructors_team_id != null && !teamsInSeason.has(champs.constructors_team_id)) {
    error('champion_team_not_in_season', "The Constructors' Champion must be a team in this season's line-up.");
  }
  if (options.forFinal) {
    if (champs.drivers_driver_id == null) error('missing_drivers_champion', "Select the Drivers' Champion before finalising the season.");
    if (champs.constructors_team_id == null) error('missing_constructors_champion', "Select the Constructors' Champion before finalising the season.");
    if (entries.length === 0) error('empty_lineup', 'Add at least one driver to the season.');
  }

  // ---- warnings (you may still save)
  const first = (sub.driverStandings || []).find((r) => r.position === 1);
  if (first && champs.drivers_driver_id != null && first.driver_id !== champs.drivers_driver_id) {
    warn('driver_champion_not_first', "The Drivers' Champion is not P1 in the drivers' standings.");
  }
  const firstTeam = (sub.constructorStandings || []).find((r) => r.position === 1);
  if (firstTeam && champs.constructors_team_id != null && firstTeam.team_id !== champs.constructors_team_id) {
    warn('constructor_champion_not_first', "The Constructors' Champion is not P1 in the constructors' standings.");
  }
  const orderCheck = (rows, label) => {
    const withPoints = (rows || []).filter((r) => Number.isInteger(r.position) && Number.isInteger(r.points)).sort((a, b) => a.position - b.position);
    for (let i = 1; i < withPoints.length; i++) {
      if (withPoints[i].points > withPoints[i - 1].points) {
        warn('points_order', `${label}: position ${withPoints[i].position} has more points than position ${withPoints[i - 1].position}.`);
        break;
      }
    }
  };
  orderCheck(sub.driverStandings, "Drivers' standings");
  orderCheck(sub.constructorStandings, "Constructors' standings");

  // team points should equal the sum of its drivers' points, but only when EVERYTHING is known
  for (const t of sub.constructorStandings || []) {
    if (!Number.isInteger(t.points)) continue;
    const teamDrivers = entries.filter((e) => e.team_id === t.team_id).map((e) => e.driver_id);
    const rows = teamDrivers.map((id) => (sub.driverStandings || []).find((r) => r.driver_id === id));
    if (rows.length && rows.every((r) => r && Number.isInteger(r.points))) {
      const sum = rows.reduce((a, r) => a + r.points, 0);
      if (sum !== t.points) {
        warn('team_points_differ', `Team ${t.team_id}: points (${t.points}) differ from its drivers' total (${sum}). Fine if drivers changed teams mid-season.`, { team_id: t.team_id });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
