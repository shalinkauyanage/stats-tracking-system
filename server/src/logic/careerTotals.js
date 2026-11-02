// Career totals. Nothing here talks to the database: it receives plain arrays
// (the same shape as the MySQL tables) and returns plain objects. That is why
// it can be tested without MySQL.
//
// THE NO-DOUBLE-COUNTING RULE
//   career = legacy baseline
//          + every season that is FINAL and NOT flagged in_legacy_baseline
//
//   * A season still being typed in (draft) counts for nothing yet.
//   * A season flagged in_legacy_baseline is already inside the legacy numbers,
//     so it is shown on profiles but never added again.
//   * Unknown (null) values are skipped. If NOTHING is known the total is null,
//     not 0.
//
// "data" shape (each key is an array of rows, like the tables):
//   seasons:              { id, year, status, in_legacy_baseline }
//   entries:              { id, season_id, driver_id, team_id }
//   driverStandings:      { season_id, season_entry_id, position, points }
//   constructorStandings: { season_id, team_id, position, points }
//   driverStats:          { season_entry_id, wins, podiums, ... }
//   teamStats:            { season_id, team_id, wins, podiums, ... }
//   championships:        { season_id, championship_type, driver_id, team_id, points }
//   legacyDrivers:        { driver_id, wins, ... }
//   legacyTeams:          { team_id, wins, ... }

import { sumKnown, isTruthyFlag } from './numbers.js';
import { DRIVER_SEASON_STAT_FIELDS, TEAM_SEASON_STAT_FIELDS } from './stats.js';

const list = (value) => value || [];

/** Ids of seasons that add to career totals: FINAL and not already in the legacy baseline. */
export function countedSeasonIds(data) {
  return new Set(
    list(data.seasons)
      .filter((s) => s.status === 'final' && !isTruthyFlag(s.in_legacy_baseline))
      .map((s) => s.id),
  );
}

export function calculateDriverCareer(data, driverId) {
  const counted = countedSeasonIds(data);
  const allEntries = list(data.entries).filter((e) => e.driver_id === driverId);
  const entries = allEntries.filter((e) => counted.has(e.season_id));
  const entryIds = new Set(entries.map((e) => e.id));
  const legacy = list(data.legacyDrivers).find((l) => l.driver_id === driverId);
  const stats = list(data.driverStats).filter((s) => entryIds.has(s.season_entry_id));

  const career = {};
  for (const field of DRIVER_SEASON_STAT_FIELDS) {
    career[field] = sumKnown([legacy?.[field], ...stats.map((s) => s[field])]);
  }

  career.points = sumKnown([
    legacy?.points,
    ...list(data.driverStandings).filter((s) => entryIds.has(s.season_entry_id)).map((s) => s.points),
  ]);

  // M.P.S: legacy only, shown as imported, never combined with anything.
  career.mps = legacy?.mps ?? null;

  // Titles
  const championships = list(data.championships).filter((c) => counted.has(c.season_id));
  const teamBySeason = new Map(entries.map((e) => [e.season_id, e.team_id]));
  const drivers = championships.filter((c) => c.championship_type === 'drivers' && c.driver_id === driverId).length;
  const constructors = championships.filter(
    (c) => c.championship_type === 'constructors' && teamBySeason.get(c.season_id) === c.team_id,
  ).length;
  career.drivers_titles = sumKnown([legacy?.drivers_titles, entries.length ? drivers : null]);
  career.constructors_titles = sumKnown([legacy?.constructors_titles, entries.length ? constructors : null]);

  career.seasons_counted = entries.length;
  career.seasons_in_baseline = allEntries.filter((e) => {
    const s = list(data.seasons).find((x) => x.id === e.season_id);
    return s && isTruthyFlag(s.in_legacy_baseline);
  }).length;
  return career;
}

export function calculateTeamCareer(data, teamId) {
  const counted = countedSeasonIds(data);
  const legacy = list(data.legacyTeams).find((l) => l.team_id === teamId);
  const stats = list(data.teamStats).filter((s) => s.team_id === teamId && counted.has(s.season_id));

  const career = {};
  for (const field of TEAM_SEASON_STAT_FIELDS) {
    career[field] = sumKnown([legacy?.[field], ...stats.map((s) => s[field])]);
  }
  career.points = sumKnown([
    legacy?.points,
    ...list(data.constructorStandings)
      .filter((s) => s.team_id === teamId && counted.has(s.season_id))
      .map((s) => s.points),
  ]);
  career.mps = legacy?.mps ?? null;

  const championships = list(data.championships).filter((c) => c.team_id === teamId && counted.has(c.season_id));
  const seasonsWithTeam = new Set(
    list(data.entries).filter((e) => e.team_id === teamId && counted.has(e.season_id)).map((e) => e.season_id),
  );
  const hasSeasons = seasonsWithTeam.size > 0;
  career.drivers_titles = sumKnown([
    legacy?.drivers_titles,
    hasSeasons ? championships.filter((c) => c.championship_type === 'drivers').length : null,
  ]);
  career.constructors_titles = sumKnown([
    legacy?.constructors_titles,
    hasSeasons ? championships.filter((c) => c.championship_type === 'constructors').length : null,
  ]);
  career.seasons_counted = seasonsWithTeam.size;
  return career;
}

export function calculateAllDriverCareers(data) {
  const ids = new Set([
    ...list(data.legacyDrivers).map((l) => l.driver_id),
    ...list(data.entries).map((e) => e.driver_id),
  ]);
  return [...ids].sort((a, b) => a - b).map((driver_id) => ({ driver_id, ...calculateDriverCareer(data, driver_id) }));
}

export function calculateAllTeamCareers(data) {
  const ids = new Set([
    ...list(data.legacyTeams).map((l) => l.team_id),
    ...list(data.entries).map((e) => e.team_id),
  ]);
  return [...ids].sort((a, b) => a - b).map((team_id) => ({ team_id, ...calculateTeamCareer(data, team_id) }));
}

/**
 * Season-by-season history for a driver profile. Shows EVERY season (including
 * ones already inside the legacy baseline) and says whether each one is counted.
 */
export function driverSeasonHistory(data, driverId) {
  return list(data.entries)
    .filter((e) => e.driver_id === driverId)
    .map((entry) => {
      const season = list(data.seasons).find((s) => s.id === entry.season_id);
      const standing = list(data.driverStandings).find((s) => s.season_entry_id === entry.id);
      const stats = list(data.driverStats).find((s) => s.season_entry_id === entry.id) || null;
      const titles = list(data.championships).filter(
        (c) => c.season_id === entry.season_id && c.championship_type === 'drivers' && c.driver_id === driverId,
      );
      return {
        season_id: season.id,
        year: season.year,
        status: season.status,
        team_id: entry.team_id,
        position: standing?.position ?? null,
        points: standing?.points ?? null,
        stats,
        drivers_champion: titles.length > 0,
        counted_in_career: season.status === 'final' && !isTruthyFlag(season.in_legacy_baseline),
      };
    })
    .sort((a, b) => a.year - b.year);
}

/**
 * Safety check for back-filled seasons. If you enter detailed seasons that are
 * marked "already inside the legacy totals", their sum can never be BIGGER than
 * the legacy total. If it is, something is wrong (a typo, or the flag is wrong).
 */
export function findBaselineConflicts(data) {
  const baselineIds = new Set(
    list(data.seasons).filter((s) => s.status === 'final' && isTruthyFlag(s.in_legacy_baseline)).map((s) => s.id),
  );
  const issues = [];
  if (baselineIds.size === 0) return issues;

  for (const legacy of list(data.legacyDrivers)) {
    const entryIds = new Set(
      list(data.entries).filter((e) => e.driver_id === legacy.driver_id && baselineIds.has(e.season_id)).map((e) => e.id),
    );
    if (entryIds.size === 0) continue;
    const stats = list(data.driverStats).filter((s) => entryIds.has(s.season_entry_id));
    for (const field of DRIVER_SEASON_STAT_FIELDS) {
      const backfilled = sumKnown(stats.map((s) => s[field]));
      if (backfilled !== null && legacy[field] !== null && legacy[field] !== undefined && backfilled > legacy[field]) {
        issues.push({
          severity: 'warning',
          code: 'baseline_season_exceeds_legacy',
          driver_id: legacy.driver_id,
          field,
          backfilled,
          legacy: legacy[field],
          message: `Seasons marked as already included add up to ${backfilled} ${field}, more than the legacy total of ${legacy[field]}.`,
        });
      }
    }
  }
  return issues;
}
