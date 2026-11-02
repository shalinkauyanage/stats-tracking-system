// Turns the raw workbook snapshot into a clean "legacy dataset" and a list of issues.
//
// IMPORTANT RULES
//  * The workbook is never changed. Original text is kept next to every cleaned value.
//  * Nothing is invented: no years, no circuit names, no guessed meanings.
//  * Blank cells in COUNT columns mean zero in your workbook (proved by the
//    wins + 2nd + 3rd = podiums check), so they are imported as 0 and reported.
//    The unknown "M.P.S" column is the exception: blank stays null.
//  * Suspicious data is FLAGGED, never silently fixed. Fixes wait for your approval.

import { collapseSpaces, nameKey, splitDriverAndTeam, splitNameAndNumber } from './normalize.js';
import { parseLapTime, splitNameAndLapTime } from './lapTime.js';
import { LEGACY_DRIVER_FIELDS, LEGACY_TEAM_FIELDS } from './stats.js';

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const ERROR_LOOKING = /^#[A-Z0-9/!?]+$/; // "#REF!", "#VALUE!" ... already reported by the file reader

/**
 * options.blankPolicy
 *   'zero'    (default, as agreed in Stage 1) blank cells in COUNT columns mean 0 in this
 *             workbook (wins + 2nd + 3rd = podiums only works that way). Reported in the preview.
 *   'unknown' blank cells stay unknown (NULL) - nothing is assumed.
 * A whole missing COLUMN is always unknown, and "M.P.S" blanks are always unknown.
 */
export function buildLegacyDataset(snapshot, { blankPolicy = 'zero' } = {}) {
  const issues = [];
  const addIssue = (severity, code, message, details = {}) =>
    issues.push({ severity, code, message, details });

  // ------------------------------------------------------------ teams
  const teams = [];
  const teamByKey = new Map();
  for (const row of snapshot.team_stats.rows) {
    const name = collapseSpaces(row.team_raw);
    const key = nameKey(name);
    if (!key) {
      addIssue('error', 'blank_team_name', 'A team row has no name.', { row: row.row });
      continue;
    }
    if (teamByKey.has(key)) {
      addIssue('error', 'duplicate_team', `Team "${name}" appears more than once.`, { row: row.row });
      continue;
    }
    const team = { key, name, source_row: row.row };
    teams.push(team);
    teamByKey.set(key, team);
  }
  const teamNames = teams.map((t) => t.name);

  // ------------------------------------------------------------ drivers
  const drivers = [];
  const driverByKey = new Map();
  const driverTeamInName = new Map();
  for (const row of snapshot.driver_stats.rows) {
    const { driver, team } = splitDriverAndTeam(row.name_raw, teamNames);
    const key = nameKey(driver);
    if (!key) {
      addIssue('error', 'blank_driver_name', 'A driver row has no name.', { row: row.row });
      continue;
    }
    if (driverByKey.has(key)) {
      addIssue('error', 'duplicate_driver', `Driver "${driver}" appears more than once.`, { row: row.row });
      continue;
    }
    if (!team) {
      addIssue('warning', 'driver_team_not_found_in_name',
        `Could not find a team next to "${driver}" in the name cell.`, { row: row.row });
    } else if (!teamByKey.has(nameKey(team))) {
      addIssue('error', 'unknown_team_in_name', `Team "${team}" next to ${driver} is not in Team Stats.`, { row: row.row });
    }
    const d = { key, display_name: driver, name_original: row.name_raw, source_row: row.row };
    drivers.push(d);
    driverByKey.set(key, d);
    driverTeamInName.set(key, team ? nameKey(team) : null);
  }

  // ------------------------------------------------------------ legacy totals (+ blanks)
  let blanksDriver = 0;
  const blankCells = [];
  const legacyDriverTotals = [];
  for (const row of snapshot.driver_stats.rows) {
    const { driver } = splitDriverAndTeam(row.name_raw, teamNames);
    const key = nameKey(driver);
    if (!driverByKey.has(key)) continue;
    const totals = { driver_key: key, source_row: row.row };
    for (const field of LEGACY_DRIVER_FIELDS) {
      if (!(field in row)) { totals[field] = null; continue; }   // column absent: unknown
      const raw = row[field];
      if (isBlank(raw)) {
        if (field === 'mps' || blankPolicy === 'unknown') totals[field] = null; // never guess
        else {
          totals[field] = 0; blanksDriver += 1;
          blankCells.push({ sheet: 'Driver Stats', row: row.row, field, name: driver });
        }
      } else if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
        totals[field] = raw;
      } else {
        totals[field] = null;
        if (!(typeof raw === 'string' && ERROR_LOOKING.test(raw.trim()))) {
          addIssue('error', 'bad_number', `Driver Stats row ${row.row}: "${raw}" in ${field} is not a whole number.`, { row: row.row, field });
        }
      }
    }
    legacyDriverTotals.push(totals);

    // wins + 2nd + 3rd must equal podiums
    const parts = [totals.wins, totals.second_places, totals.third_places, totals.podiums];
    const sum = totals.wins + totals.second_places + totals.third_places;
    if (parts.every((v) => v !== null) && sum !== totals.podiums) {
      addIssue('warning', 'podium_sum_mismatch',
        `${driver}: wins + 2nd + 3rd = ${sum} but podiums = ${totals.podiums}.`, { row: row.row, driver });
    }
  }

  let blanksTeam = 0;
  const legacyTeamTotals = [];
  for (const row of snapshot.team_stats.rows) {
    const key = nameKey(row.team_raw);
    if (!teamByKey.has(key)) continue;
    const totals = { team_key: key, source_row: row.row };
    for (const field of LEGACY_TEAM_FIELDS) {
      if (!(field in row)) { totals[field] = null; continue; }
      const raw = row[field];
      if (isBlank(raw)) {
        if (field === 'mps' || blankPolicy === 'unknown') totals[field] = null;
        else {
          totals[field] = 0; blanksTeam += 1;
          blankCells.push({ sheet: 'Team Stats', row: row.row, field, name: collapseSpaces(row.team_raw) });
        }
      } else if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
        totals[field] = raw;
      } else {
        totals[field] = null;
        if (!(typeof raw === 'string' && ERROR_LOOKING.test(raw.trim()))) {
          addIssue('error', 'bad_number', `Team Stats row ${row.row}: "${raw}" in ${field} is not a whole number.`, { row: row.row, field });
        }
      }
    }
    legacyTeamTotals.push(totals);
  }
  if (blankPolicy === 'unknown') {
    addIssue('info', 'blank_kept_unknown',
      'Blank cells in count columns were kept UNKNOWN (nothing was assumed). Career totals will show them as unknown until you fill them in.',
      { driver_stats: 0, team_stats: 0, cells: [] });
  } else {
    addIssue('info', 'blank_counted_as_zero',
      `Blank cells in count columns were imported as 0 (Driver Stats: ${blanksDriver}, Team Stats: ${blanksTeam}). ` +
      'The M.P.S column keeps blanks as unknown. You can choose "keep blanks unknown" instead before importing.',
      { driver_stats: blanksDriver, team_stats: blanksTeam, cells: blankCells });
  }

  // ------------------------------------------------------------ team history (order only, no years)
  const legacyDriverTeamHistory = [];
  for (const row of snapshot.driver_stats.rows) {
    const { driver } = splitDriverAndTeam(row.name_raw, teamNames);
    const key = nameKey(driver);
    if (!driverByKey.has(key)) continue;
    const history = (row.team_history_raw || []).map(collapseSpaces);
    history.forEach((teamName, i) => {
      const tKey = nameKey(teamName);
      if (!teamByKey.has(tKey)) {
        addIssue('error', 'unknown_team_in_history', `${driver}: team "${teamName}" is not in Team Stats.`, { row: row.row });
        return;
      }
      legacyDriverTeamHistory.push({ driver_key: key, sequence_no: i + 1, team_key: tKey });
    });
    const last = history.length ? nameKey(history[history.length - 1]) : null;
    if (last && driverTeamInName.get(key) && last !== driverTeamInName.get(key)) {
      addIssue('warning', 'current_team_mismatch',
        `${driver}: last team in history differs from the team written next to the name.`, { row: row.row });
    }
  }

  // ------------------------------------------------------------ circuits, winners, records
  const circuits = [];
  const circuitByKey = new Map();
  const gpWinners = [];
  const circuitRecords = [];
  let linkedLabels = 0;

  const resolveDriver = (rawName, where) => {
    const key = nameKey(rawName);
    if (!driverByKey.has(key)) {
      addIssue('error', 'unknown_driver_in_track_records',
        `"${collapseSpaces(rawName)}" (${where}) is not in Driver Stats.`, { where });
      return null;
    }
    return key;
  };

  snapshot.track_records.columns.forEach((col, index) => {
    const label = collapseSpaces(col.label);
    if (!label) {
      addIssue('error', 'blank_gp_label', `Track Records column ${col.column} has no Grand Prix name.`, { column: col.column });
      return;
    }
    const key = nameKey(label);
    if (circuitByKey.has(key)) {
      addIssue('error', 'duplicate_circuit', `Grand Prix "${label}" appears twice (column ${col.column}).`, { column: col.column });
      return;
    }
    if (col.label_kind === 'linked_entity') linkedLabels += 1;
    const circuit = { key, gp_name: label, source_column: col.column, source_label_kind: col.label_kind, sort_order: index + 1 };
    circuits.push(circuit);
    circuitByKey.set(key, circuit);

    col.winners.forEach((w, i) => {
      const driverKey = resolveDriver(w.raw, `${label}, row ${w.row}`);
      if (driverKey) gpWinners.push({ circuit_key: key, sequence_no: i + 1, driver_key: driverKey });
    });

    for (const [type, raw] of [['race_fastest_lap', col.fastest_lap_raw], ['qualifying_pole', col.pole_time_raw]]) {
      if (isBlank(raw)) {
        addIssue('warning', 'missing_record', `${label}: no ${type} recorded.`, { column: col.column, type });
        continue;
      }
      const { name, timeText } = splitNameAndLapTime(raw);
      const driverKey = resolveDriver(name, `${label} ${type}`);
      const parsed = parseLapTime(timeText);
      const record = {
        circuit_key: key,
        record_type: type,
        driver_key: driverKey,
        lap_time_ms: parsed.ms,
        lap_time_text: parsed.text,
        original_text: collapseSpaces(raw),
        review_status: parsed.status === 'ok' ? 'ok' : 'pending_review',
        suggested_ms: parsed.suggestedMs ?? null,
        suggested_text: parsed.suggestedText ?? null,
      };
      circuitRecords.push(record);
      if (parsed.status === 'needs_review') {
        addIssue('pending_review', 'lap_time_format_correction',
          `${label} ${type === 'race_fastest_lap' ? 'fastest lap' : 'pole time'}: "${parsed.original}" looks like ` +
          `${parsed.suggestedText}. Waiting for your approval; the original text is kept unchanged.`,
          { circuit: label, type, original: parsed.original, suggested: parsed.suggestedText });
      } else if (parsed.status !== 'ok') {
        addIssue('error', 'unreadable_lap_time', `${label} ${type}: cannot read time "${timeText ?? raw}".`, { circuit: label, type });
      }
    }
  });

  if (linkedLabels > 0) {
    addIssue('info', 'linked_entity_labels_recovered',
      `${linkedLabels} Grand Prix names were stored as Excel linked data types (they look like #VALUE! outside Excel). ` +
      'The real text was recovered from the file. These are country/region labels, used as-is; no circuit names were invented.',
      { count: linkedLabels });
  }

  // ------------------------------------------------------------ cross-checks
  // (a) Track Records winners per driver must equal Driver Stats wins
  const winnerTally = new Map();
  for (const w of gpWinners) winnerTally.set(w.driver_key, (winnerTally.get(w.driver_key) || 0) + 1);
  for (const t of legacyDriverTotals) {
    const counted = winnerTally.get(t.driver_key) || 0;
    if (t.wins !== null && counted !== t.wins) {
      addIssue('warning', 'winner_tally_mismatch',
        `${driverByKey.get(t.driver_key).display_name}: Track Records lists ${counted} wins, Driver Stats says ${t.wins}.`,
        { driver_key: t.driver_key, track_records: counted, driver_stats: t.wins });
    }
  }

  // (b) Driver Stats totals versus Team Stats totals
  const sum = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
  const gaps = {};
  for (const f of ['wins', 'podiums', 'poles', 'points']) {
    const d = sum(legacyDriverTotals, f);
    const t = sum(legacyTeamTotals, f);
    if (d !== t) gaps[f] = { drivers: d, teams: t };
  }
  if (Object.keys(gaps).length) {
    addIssue('warning', 'team_stats_behind_driver_stats',
      'Team Stats totals differ from Driver Stats totals: ' +
      Object.entries(gaps).map(([f, g]) => `${f} ${g.teams} (teams) vs ${g.drivers} (drivers)`).join('; ') +
      '. Both are imported as written; decide which is right during review.', { gaps });
  }

  // (c) A driver who only ever drove for one team cannot have more wins than that team
  const driversPerTeam = new Map();
  for (const h of legacyDriverTeamHistory) {
    const list = legacyDriverTeamHistory.filter((x) => x.driver_key === h.driver_key);
    if (list.length === 1) {
      driversPerTeam.set(h.team_key, [...(driversPerTeam.get(h.team_key) || []), h.driver_key]);
    }
  }
  for (const [teamKey, driverKeys] of driversPerTeam) {
    const team = legacyTeamTotals.find((t) => t.team_key === teamKey);
    for (const dk of driverKeys) {
      const driver = legacyDriverTotals.find((d) => d.driver_key === dk);
      if (team && driver.wins > team.wins) {
        addIssue('warning', 'driver_wins_exceed_team_wins',
          `${driverByKey.get(dk).display_name} has ${driver.wins} wins, but ${teamByKey.get(teamKey).name} only ${team.wins} (the driver never drove for another team).`,
          { driver_key: dk, team_key: teamKey, driver_wins: driver.wins, team_wins: team.wins });
      }
    }
  }

  // (d) Wins listed under each team (Team Stats "top drivers") versus the team's own win count
  for (const row of snapshot.team_stats.rows) {
    const key = nameKey(row.team_raw);
    const total = (row.top_drivers_raw || []).reduce((a, r) => a + (splitNameAndNumber(r).number || 0), 0);
    const team = legacyTeamTotals.find((t) => t.team_key === key);
    if (team && total > team.wins) {
      addIssue('warning', 'team_wins_below_listed_driver_wins',
        `${collapseSpaces(row.team_raw)}: listed drivers' wins add up to ${total}, but the team shows ${team.wins}.`,
        { team_key: key, listed: total, team_wins: team.wins });
    }
  }

  // (e) Titles: drivers' titles by driver vs by team
  const driverTitlesByDrivers = sum(legacyDriverTotals, 'drivers_titles');
  const driverTitlesByTeams = sum(legacyTeamTotals, 'drivers_titles');
  if (driverTitlesByDrivers !== driverTitlesByTeams) {
    addIssue('warning', 'drivers_titles_mismatch',
      `Drivers' titles: ${driverTitlesByDrivers} in Driver Stats vs ${driverTitlesByTeams} in Team Stats.`, {});
  }

  addIssue('info', 'mps_kept_as_is',
    'The "M.P.S" column is stored as a legacy field exactly as written. Its meaning has not been guessed and it is not added to anything.', {});
  addIssue('info', 'no_years_in_workbook',
    'The workbook contains no years or seasons. Titles and team history are imported without years; assign years later in the app.', {});
  addIssue('info', 'most_wins_row_ignored',
    'The "Most Wins" row in Track Records is derived data; it will be recalculated rather than imported.', {});

  const counts = { error: 0, warning: 0, pending_review: 0, info: 0 };
  for (const i of issues) counts[i.severity] += 1;

  return {
    teams, drivers, circuits,
    legacyDriverTotals, legacyTeamTotals, legacyDriverTeamHistory,
    gpWinners, circuitRecords,
    issues,
    summary: {
      teams: teams.length, drivers: drivers.length, circuits: circuits.length,
      gp_winner_rows: gpWinners.length, circuit_records: circuitRecords.length,
      issue_counts: counts,
    },
  };
}

/**
 * Gives every row a numeric id (1, 2, 3...), the way MySQL would after the import.
 * Used by tests now and by the import preview in Stage 2.
 */
export function assignPreviewIds(dataset) {
  const driverId = new Map(dataset.drivers.map((d, i) => [d.key, i + 1]));
  const teamId = new Map(dataset.teams.map((t, i) => [t.key, i + 1]));
  const circuitId = new Map(dataset.circuits.map((c, i) => [c.key, i + 1]));
  return {
    drivers: dataset.drivers.map((d) => ({ id: driverId.get(d.key), display_name: d.display_name, name_key: d.key })),
    teams: dataset.teams.map((t) => ({ id: teamId.get(t.key), name: t.name, name_key: t.key })),
    circuits: dataset.circuits.map((c) => ({ id: circuitId.get(c.key), gp_name: c.gp_name, name_key: c.key })),
    legacyDrivers: dataset.legacyDriverTotals.map(({ driver_key, source_row, ...rest }) => ({ driver_id: driverId.get(driver_key), ...rest })),
    legacyTeams: dataset.legacyTeamTotals.map(({ team_key, source_row, ...rest }) => ({ team_id: teamId.get(team_key), ...rest })),
    legacyTeamHistory: dataset.legacyDriverTeamHistory.map((h) => ({ driver_id: driverId.get(h.driver_key), sequence_no: h.sequence_no, team_id: teamId.get(h.team_key) })),
    gpWinners: dataset.gpWinners.map((w) => ({ circuit_id: circuitId.get(w.circuit_key), sequence_no: w.sequence_no, driver_id: driverId.get(w.driver_key) })),
    circuitRecords: dataset.circuitRecords.map(({ circuit_key, driver_key, ...rest }) => ({ circuit_id: circuitId.get(circuit_key), driver_id: driver_key ? driverId.get(driver_key) : null, ...rest })),
    idOfDriver: (name) => driverId.get(nameKey(name)),
    idOfTeam: (name) => teamId.get(nameKey(name)),
  };
}
