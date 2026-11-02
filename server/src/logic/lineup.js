// Season line-ups and driver transfers.
//
// A line-up is a list of { driver_id, team_id } for ONE season.
// None of these functions change the list you give them: they return a NEW list.
// That is what guarantees an earlier season can never be altered by accident.

import { isId } from './numbers.js';

export class LineupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LineupError';
    this.code = code;
  }
}

/** Checks a line-up. Returns { ok, errors }. */
export function validateLineup(entries, { driverIds, teamIds } = {}) {
  const errors = [];
  const knownDrivers = driverIds ? new Set(driverIds) : null;
  const knownTeams = teamIds ? new Set(teamIds) : null;
  const seen = new Set();

  (entries || []).forEach((entry, index) => {
    if (!isId(entry.driver_id)) {
      errors.push({ code: 'missing_driver', index, message: `Line ${index + 1}: choose a driver.` });
    } else {
      if (seen.has(entry.driver_id)) {
        errors.push({ code: 'duplicate_driver', index, driver_id: entry.driver_id,
          message: `Driver ${entry.driver_id} is listed more than once. A driver can only drive for one team per season.` });
      }
      seen.add(entry.driver_id);
      if (knownDrivers && !knownDrivers.has(entry.driver_id)) {
        errors.push({ code: 'unknown_driver', index, driver_id: entry.driver_id, message: `Driver ${entry.driver_id} does not exist.` });
      }
    }
    if (!isId(entry.team_id)) {
      errors.push({ code: 'missing_team', index, message: `Line ${index + 1}: choose a team.` });
    } else if (knownTeams && !knownTeams.has(entry.team_id)) {
      errors.push({ code: 'unknown_team', index, team_id: entry.team_id, message: `Team ${entry.team_id} does not exist.` });
    }
  });
  return { ok: errors.length === 0, errors };
}

/** "Copy last season's line-up": same drivers, same teams, for the new season. */
export function copyLineup(previousEntries, newSeasonId) {
  return (previousEntries || []).map((e) => ({
    season_id: newSeasonId,
    driver_id: e.driver_id,
    team_id: e.team_id,
  }));
}

/** Moves drivers to new teams in a line-up. changes: [{ driver_id, team_id }] */
export function applyTeamChanges(lineup, changes) {
  const byDriver = new Map(lineup.map((e) => [e.driver_id, e]));
  for (const change of changes) {
    if (!byDriver.has(change.driver_id)) {
      throw new LineupError(`Driver ${change.driver_id} is not in this line-up.`, 'driver_not_in_lineup');
    }
    if (!isId(change.team_id)) {
      throw new LineupError('Choose a valid team for the transfer.', 'missing_team');
    }
  }
  const newTeam = new Map(changes.map((c) => [c.driver_id, c.team_id]));
  return lineup.map((e) => (newTeam.has(e.driver_id) ? { ...e, team_id: newTeam.get(e.driver_id) } : { ...e }));
}

export function addDriverToLineup(lineup, entry) {
  if (lineup.some((e) => e.driver_id === entry.driver_id)) {
    throw new LineupError(`Driver ${entry.driver_id} is already in this line-up.`, 'duplicate_driver');
  }
  return [...lineup.map((e) => ({ ...e })), { ...entry }];
}

/** A driver who retires or leaves simply is not in the new season's line-up. */
export function removeDriversFromLineup(lineup, driverIds) {
  const remove = new Set(driverIds);
  return lineup.filter((e) => !remove.has(e.driver_id)).map((e) => ({ ...e }));
}

/** One driver's teams, year by year (this is the "transfer history"). */
export function driverTeamHistory(data, driverId) {
  return (data.entries || [])
    .filter((e) => e.driver_id === driverId)
    .map((e) => ({ season_id: e.season_id, year: data.seasons.find((s) => s.id === e.season_id)?.year ?? null, team_id: e.team_id }))
    .sort((a, b) => a.year - b.year);
}

/** All drivers a team had in one season. */
export function teamLineupForSeason(data, teamId, seasonId) {
  return (data.entries || []).filter((e) => e.team_id === teamId && e.season_id === seasonId).map((e) => e.driver_id);
}
