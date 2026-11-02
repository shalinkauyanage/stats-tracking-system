// Hall of Fame: one card per season, Drivers' Champion + Constructors' Champion.
//
// PERMANENCE RULES
//  * A championship row stores the champion's team FOR THAT SEASON plus a copy of the
//    names (snapshots). Transfers or renames later never change an old card.
//  * saveChampionship() refuses to replace a different champion unless you pass
//    { intentional: true, note: '...' }. Then it returns a log entry for change_log.
//  * Titles that exist only as COUNTS in the Excel file (no year known) are listed as
//    "unassigned legacy titles" so you can attach a year later. Nothing is invented.

import { isTruthyFlag } from './numbers.js';

export class ChampionshipLockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChampionshipLockedError';
    this.code = 'championship_locked';
  }
}

const sameChampion = (a, b) =>
  a.championship_type === b.championship_type &&
  (a.driver_id ?? null) === (b.driver_id ?? null) &&
  a.team_id === b.team_id;

/**
 * Adds or (on purpose) corrects one championship row.
 * Returns { rows: [...new list...], logEntry: null | {...} } and never edits the input.
 */
export function saveChampionship(existingRows, newRow, { intentional = false, note = '' } = {}) {
  const existing = existingRows.find(
    (r) => r.season_id === newRow.season_id && r.championship_type === newRow.championship_type,
  );
  if (!existing) {
    return { rows: [...existingRows.map((r) => ({ ...r })), { ...newRow }], logEntry: null };
  }
  if (sameChampion(existing, newRow)) {
    // Saving the same champion again changes nothing (points may be filled in).
    const rows = existingRows.map((r) => (r === existing ? { ...r, points: newRow.points ?? r.points } : { ...r }));
    return { rows, logEntry: null };
  }
  if (!intentional) {
    throw new ChampionshipLockedError(
      `The ${newRow.championship_type} champion for this season is already recorded. ` +
      'Use "Correct champion" and give a reason if you really want to change it.',
    );
  }
  if (!String(note).trim()) {
    throw new ChampionshipLockedError('A reason is required when correcting a champion.');
  }
  const rows = existingRows.map((r) => (r === existing ? { ...newRow, correction_note: note } : { ...r }));
  return {
    rows,
    logEntry: { action: 'correct_champion', table_name: 'championship_history', old: { ...existing }, new: { ...newRow }, note },
  };
}

/** Cards for the Hall of Fame page, newest year first. */
export function buildHallOfFame({ seasons, championships }) {
  const bySeason = new Map();
  for (const season of seasons) {
    bySeason.set(season.id, { season_id: season.id, year: season.year, status: season.status, drivers: null, constructors: null });
  }
  for (const c of championships) {
    const card = bySeason.get(c.season_id);
    if (!card) continue;
    const entry = {
      driver_id: c.driver_id ?? null,
      driver_name: c.driver_name_snapshot ?? null,
      team_id: c.team_id,
      team_name: c.team_name_snapshot,
      points: c.points ?? null,
    };
    if (c.championship_type === 'drivers') card.drivers = entry;
    else card.constructors = entry;
  }
  return [...bySeason.values()]
    .filter((card) => card.drivers || card.constructors)
    .sort((a, b) => b.year - a.year);
}

/**
 * Legacy titles that still have no year.
 *   remaining = legacy count - championship rows already assigned in seasons flagged as baseline.
 * A negative number means more titles were assigned than the legacy total allows.
 */
export function unassignedLegacyTitles({ legacyDrivers, legacyTeams, seasons, championships }) {
  const baselineIds = new Set(seasons.filter((s) => isTruthyFlag(s.in_legacy_baseline)).map((s) => s.id));
  const assigned = championships.filter((c) => baselineIds.has(c.season_id));
  const out = [];

  for (const l of legacyDrivers || []) {
    const total = l.drivers_titles || 0;
    if (!total) continue;
    const used = assigned.filter((c) => c.championship_type === 'drivers' && c.driver_id === l.driver_id).length;
    out.push({ kind: 'drivers', driver_id: l.driver_id, legacy_total: total, assigned: used, remaining: total - used });
  }
  for (const l of legacyTeams || []) {
    const total = l.constructors_titles || 0;
    if (!total) continue;
    const used = assigned.filter((c) => c.championship_type === 'constructors' && c.team_id === l.team_id).length;
    out.push({ kind: 'constructors', team_id: l.team_id, legacy_total: total, assigned: used, remaining: total - used });
  }
  return out.filter((t) => t.remaining !== 0);
}
