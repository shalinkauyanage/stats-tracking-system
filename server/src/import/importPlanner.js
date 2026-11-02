// The import PLANNER. It looks at the cleaned workbook data and at what is already in
// the database, and works out what an import WOULD do. It never writes anything.
//
// Rules it follows
//   * Matching is by NAME KEY (lower case, single spaces, no accents), so the same
//     driver is never created twice.
//   * Each row is   create        (not in the database yet)
//                   unchanged     (already there, identical)
//                   conflict      (already there, but different) -> kept as is unless you
//                                 explicitly choose "overwrite" for that one item.
//   * Nothing is ever deleted. Rows that exist only in the database are left alone.
//   * Imports only touch identities and the legacy baseline. Seasons, standings,
//     season stats and the Hall of Fame are never read or changed by an import.
//
// state = { drivers, teams, circuits, legacyDrivers, legacyTeams, legacyTeamHistory,
//           gpWinners, circuitRecords, committedBatches, countedSeasonsByDriver,
//           countedSeasonsByTeam }   (same shapes as the tables)

import { collapseSpaces } from '../logic/normalize.js';
import { LEGACY_DRIVER_FIELDS, LEGACY_TEAM_FIELDS } from '../logic/stats.js';
import { similarNames } from './similarity.js';

const norm = (v) => (v === undefined ? null : v);
const sameValue = (a, b) => norm(a) === norm(b);

function diffFields(fields, incoming, existing) {
  return fields
    .filter((f) => !sameValue(incoming[f], existing[f]))
    .map((f) => ({ field: f, existing: norm(existing[f]), incoming: norm(incoming[f]) }));
}

export function planImport(dataset, state, fileInfo, { acknowledged = [], readIssues = [] } = {}) {
  const issues = [...readIssues];
  const add = (severity, code, message, details = {}, extra = {}) =>
    issues.push({ severity, code, message, details, ...extra });

  if (!dataset) {
    return finish({ fileInfo, state, issues, actions: [], acknowledged });
  }
  issues.push(...dataset.issues);

  const actions = [];
  const act = (entity, key, label, action, extra = {}) =>
    actions.push({ entity, key, label, action, resolution_key: `${entity}|${key}`, ...extra });

  // ---- lookups into the existing database --------------------------------
  const driverByKey = new Map(state.drivers.map((d) => [d.name_key, d]));
  const teamByKey = new Map(state.teams.map((t) => [t.name_key, t]));
  const circuitByKey = new Map(state.circuits.map((c) => [c.name_key, c]));
  const driverById = new Map(state.drivers.map((d) => [d.id, d]));
  const teamById = new Map(state.teams.map((t) => [t.id, t]));

  // ---- identities: drivers, teams, circuits -------------------------------
  const identities = [
    ['driver', dataset.drivers, driverByKey, (d) => d.display_name, (d) => ({ display_name: d.display_name, name_key: d.key })],
    ['team', dataset.teams, teamByKey, (t) => t.name, (t) => ({ name: t.name, name_key: t.key })],
    ['circuit', dataset.circuits, circuitByKey, (c) => c.gp_name, (c) => ({ gp_name: c.gp_name, name_key: c.key, sort_order: c.sort_order })],
  ];
  for (const [entity, incomingList, existingByKey, labelOf, rowOf] of identities) {
    const inFile = new Set(incomingList.map((x) => x.key));
    const existingList = [...existingByKey.values()];
    for (const item of incomingList) {
      const ex = existingByKey.get(item.key);
      if (ex) act(entity, item.key, labelOf(item), 'unchanged', { id: ex.id });
      else {
        act(entity, item.key, labelOf(item), 'create', { incoming: rowOf(item) });
        // a NEW name that looks like an existing one the file does not mention: ask first
        for (const other of existingList) {
          const otherKey = other.name_key;
          if (inFile.has(otherKey)) continue;
          if (similarNames(item.key, otherKey)) {
            add('review_required', `possible_duplicate_${entity}`,
              `New ${entity} "${labelOf(item)}" looks like the existing ${entity} "${other.display_name || other.name || other.gp_name}". ` +
              'Importing would create a second record. Acknowledge only if they really are different.',
              { new: labelOf(item), existing: other.display_name || other.name || other.gp_name },
              { ack_key: `similar:${entity}:${item.key}` });
          }
        }
      }
    }
    // near-duplicates inside the file itself (e.g. two spellings of one driver)
    for (let i = 0; i < incomingList.length; i++) {
      for (let j = i + 1; j < incomingList.length; j++) {
        if (similarNames(incomingList[i].key, incomingList[j].key)) {
          add('warning', 'similar_names_in_file',
            `Two ${entity}s in the file have very similar names: "${labelOf(incomingList[i])}" and "${labelOf(incomingList[j])}". Check they are really different.`,
            { first: labelOf(incomingList[i]), second: labelOf(incomingList[j]) });
        }
      }
    }
    const missing = existingList.filter((e) => !inFile.has(e.name_key)).length;
    if (missing > 0) {
      add('info', 'existing_not_in_file', `${missing} existing ${entity}(s) are not in this file. They are left untouched (imports never delete).`, { entity, count: missing });
    }
  }

  const teamKeyById = (id) => teamById.get(id)?.name_key ?? null;
  const driverName = (id) => driverById.get(id)?.display_name ?? `driver #${id}`;
  const legacyDriverById = new Map(state.legacyDrivers.map((l) => [l.driver_id, l]));
  const legacyTeamById = new Map(state.legacyTeams.map((l) => [l.team_id, l]));

  // ---- legacy driver totals ------------------------------------------------
  for (const t of dataset.legacyDriverTotals) {
    const driver = dataset.drivers.find((d) => d.key === t.driver_key);
    const exDriver = driverByKey.get(t.driver_key);
    const exLegacy = exDriver ? legacyDriverById.get(exDriver.id) : null;
    const base = { incoming: t, source_row: t.source_row };
    if (!exLegacy) {
      act('legacy_driver_totals', t.driver_key, driver.display_name, 'create', base);
      const seasons = exDriver ? (state.countedSeasonsByDriver?.[exDriver.id] || 0) : 0;
      if (seasons > 0) {
        add('review_required', 'legacy_added_to_driver_with_seasons',
          `${driver.display_name} already has ${seasons} finished season(s) counted in the app. If those seasons are already included in the Excel totals, ` +
          'mark them "already in legacy totals" first, otherwise career totals will be counted twice.',
          { driver: driver.display_name, seasons },
          { ack_key: `double-count:driver:${t.driver_key}` });
      }
    } else {
      const changes = diffFields(LEGACY_DRIVER_FIELDS, t, exLegacy);
      if (changes.length === 0) act('legacy_driver_totals', t.driver_key, driver.display_name, 'unchanged', { id: exDriver.id });
      else act('legacy_driver_totals', t.driver_key, driver.display_name, 'conflict', { ...base, id: exDriver.id, changes, existing: exLegacy });
    }
  }

  // ---- legacy team totals -----------------------------------------------------
  for (const t of dataset.legacyTeamTotals) {
    const team = dataset.teams.find((x) => x.key === t.team_key);
    const exTeam = teamByKey.get(t.team_key);
    const exLegacy = exTeam ? legacyTeamById.get(exTeam.id) : null;
    const base = { incoming: t, source_row: t.source_row };
    if (!exLegacy) {
      act('legacy_team_totals', t.team_key, team.name, 'create', base);
      const seasons = exTeam ? (state.countedSeasonsByTeam?.[exTeam.id] || 0) : 0;
      if (seasons > 0) {
        add('review_required', 'legacy_added_to_team_with_seasons',
          `${team.name} already has ${seasons} finished season(s) counted in the app. Mark them "already in legacy totals" first if the Excel totals include them.`,
          { team: team.name, seasons }, { ack_key: `double-count:team:${t.team_key}` });
      }
    } else {
      const changes = diffFields(LEGACY_TEAM_FIELDS, t, exLegacy);
      if (changes.length === 0) act('legacy_team_totals', t.team_key, team.name, 'unchanged', { id: exTeam.id });
      else act('legacy_team_totals', t.team_key, team.name, 'conflict', { ...base, id: exTeam.id, changes, existing: exLegacy });
    }
  }

  // ---- team history (ordered, no years) -----------------------------------------
  const historyByDriver = new Map();
  for (const h of dataset.legacyDriverTeamHistory) {
    if (!historyByDriver.has(h.driver_key)) historyByDriver.set(h.driver_key, []);
    historyByDriver.get(h.driver_key).push(h);
  }
  for (const [driverKey, list] of historyByDriver) {
    const driver = dataset.drivers.find((d) => d.key === driverKey);
    const incomingKeys = list.sort((a, b) => a.sequence_no - b.sequence_no).map((h) => h.team_key);
    const exDriver = driverByKey.get(driverKey);
    const exRows = exDriver ? state.legacyTeamHistory.filter((h) => h.driver_id === exDriver.id).sort((a, b) => a.sequence_no - b.sequence_no) : [];
    const base = { incoming: incomingKeys.map((k, i) => ({ sequence_no: i + 1, team_key: k })) };
    if (exRows.length === 0) act('legacy_team_history', driverKey, driver.display_name, 'create', base);
    else {
      const existingKeys = exRows.map((h) => teamKeyById(h.team_id));
      if (existingKeys.join('>') === incomingKeys.join('>')) act('legacy_team_history', driverKey, driver.display_name, 'unchanged', { id: exDriver.id });
      else act('legacy_team_history', driverKey, driver.display_name, 'conflict', {
        ...base, id: exDriver.id,
        changes: [{ field: 'teams (in order)', existing: existingKeys.join(' > '), incoming: incomingKeys.join(' > ') }],
      });
    }
  }

  // ---- Grand Prix winners -----------------------------------------------------------
  const winnerByPos = new Map(state.gpWinners.map((w) => [`${w.circuit_id}:${w.sequence_no}`, w]));
  for (const w of dataset.gpWinners) {
    const exCircuit = circuitByKey.get(w.circuit_key);
    const ex = exCircuit ? winnerByPos.get(`${exCircuit.id}:${w.sequence_no}`) : null;
    const circuit = dataset.circuits.find((c) => c.key === w.circuit_key);
    const driver = dataset.drivers.find((d) => d.key === w.driver_key);
    const key = `${w.circuit_key}#${w.sequence_no}`;
    const label = `${circuit.gp_name} winner #${w.sequence_no}: ${driver.display_name}`;
    if (!ex) act('gp_winner', key, label, 'create', { incoming: w });
    else if (driverByKey.get(w.driver_key)?.id === ex.driver_id) act('gp_winner', key, label, 'unchanged');
    else act('gp_winner', key, label, 'conflict', {
      incoming: w,
      changes: [{ field: 'winner', existing: driverName(ex.driver_id), incoming: driver.display_name }],
    });
  }

  // ---- circuit records (fastest lap / pole) ------------------------------------------
  const recordByPos = new Map(state.circuitRecords.map((r) => [`${r.circuit_id}:${r.record_type}`, r]));
  for (const r of dataset.circuitRecords) {
    const exCircuit = circuitByKey.get(r.circuit_key);
    const ex = exCircuit ? recordByPos.get(`${exCircuit.id}:${r.record_type}`) : null;
    const circuit = dataset.circuits.find((c) => c.key === r.circuit_key);
    const driver = r.driver_key ? dataset.drivers.find((d) => d.key === r.driver_key) : null;
    const key = `${r.circuit_key}#${r.record_type}`;
    const label = `${circuit.gp_name} ${r.record_type === 'race_fastest_lap' ? 'fastest lap' : 'pole'}: ${driver ? driver.display_name : 'unknown driver'}`;
    if (!ex) { act('circuit_record', key, label, 'create', { incoming: r }); continue; }
    // Compare what the WORKBOOK says (original text). An approved correction is kept: it does not count as a difference.
    const sameText = collapseSpaces(ex.original_text) === collapseSpaces(r.original_text);
    const sameDriver = (driver ? driverByKey.get(r.driver_key)?.id : null) === (ex.driver_id ?? null);
    if (sameText && sameDriver) act('circuit_record', key, label, 'unchanged');
    else act('circuit_record', key, label, 'conflict', {
      incoming: r,
      changes: [{ field: 'record', existing: `${driverName(ex.driver_id)} ${ex.original_text ?? ex.lap_time_text ?? ''}`.trim(), incoming: r.original_text }],
    });
  }

  return finish({ fileInfo, state, issues, actions, acknowledged, dataset });
}

function finish({ fileInfo, state, issues, actions, acknowledged, dataset }) {
  const ackSet = new Set(acknowledged);
  const errors = issues.filter((i) => i.severity === 'error');
  const reviewRequired = issues.filter((i) => i.severity === 'review_required');
  const unacknowledged = reviewRequired.filter((i) => !ackSet.has(i.ack_key));
  const already = (state.committedBatches || []).find((b) => b.file_sha256 === fileInfo.sha256) || null;

  const summary = { by_entity: {}, create: 0, unchanged: 0, conflict: 0 };
  for (const a of actions) {
    summary.by_entity[a.entity] ||= { create: 0, unchanged: 0, conflict: 0 };
    summary.by_entity[a.entity][a.action] += 1;
    summary[a.action] += 1;
  }
  const counts = { error: 0, warning: 0, pending_review: 0, review_required: 0, info: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  summary.issue_counts = counts;

  let status;
  if (errors.length || unacknowledged.length) status = 'blocked';
  else if (already) status = 'already_imported';
  else if (summary.create > 0) status = 'ready';
  else if (summary.conflict > 0) status = 'conflicts_only'; // nothing new; only differences you may overwrite on purpose
  else status = 'no_changes';

  return {
    file: fileInfo,
    status,
    canCommit: status === 'ready' || status === 'conflicts_only',
    alreadyImported: already ? { batch_id: already.id, committed_at: already.committed_at } : null,
    blockers: [...errors, ...unacknowledged],
    reviewRequired,
    issues,
    actions,
    conflicts: actions.filter((a) => a.action === 'conflict'),
    summary,
    dataset: dataset || null,
  };
}
