// Applies an import plan. It runs INSIDE a database transaction (see importService.js),
// so either everything is saved or nothing is.
//
//   create    -> inserted
//   unchanged -> skipped
//   conflict  -> kept as it is, UNLESS you chose "overwrite" for that exact item
//                (then the old value is written to change_log first)
// Nothing is ever deleted.

import { LEGACY_DRIVER_FIELDS, LEGACY_TEAM_FIELDS } from '../logic/stats.js';

const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f] ?? null]));

/** true when this conflict should be overwritten */
export function wantsOverwrite(resolutions, action) {
  return resolutions?.[action.resolution_key] === 'overwrite' || resolutions?.['*'] === 'overwrite';
}

/** How many rows an import would really change, given the chosen resolutions. */
export function countChanges(plan, resolutions) {
  return plan.actions.filter((a) => a.action === 'create' || (a.action === 'conflict' && wantsOverwrite(resolutions, a))).length;
}

export async function executePlan(tx, plan, { resolutions = {} } = {}) {
  const dataset = plan.dataset;
  const file = plan.file;
  const batchId = await tx.createBatch({ file_name: file.name, file_sha256: file.sha256, file_size: file.size });

  const created = {};
  const updated = {};
  const kept = [];
  const bump = (bucket, entity) => { bucket[entity] = (bucket[entity] || 0) + 1; };
  const logItem = (entity, key, action, before, after) =>
    tx.insertItem(batchId, { entity_type: entity, natural_key: key, action, before_json: before ?? null, after_json: after ?? null });
  const logChange = (table, recordId, entity, key, before, after) =>
    tx.insertChangeLog({ table_name: table, record_id: recordId, action: 'import_overwrite', old_json: before, new_json: after, note: `Import batch ${batchId}: ${entity} ${key}` });

  // ---- identities --------------------------------------------------------
  const ids = { driver: new Map(), team: new Map(), circuit: new Map() };
  const inserters = {
    team: (row) => tx.insertTeam(row),
    driver: (row) => tx.insertDriver(row),
    circuit: (row) => tx.insertCircuit(row),
  };
  for (const entity of ['team', 'driver', 'circuit']) {
    for (const a of plan.actions.filter((x) => x.entity === entity)) {
      if (a.action === 'unchanged') ids[entity].set(a.key, a.id);
      else {
        const id = await inserters[entity](a.incoming);
        ids[entity].set(a.key, id);
        await logItem(entity, a.key, 'created', null, a.incoming);
        bump(created, entity);
      }
    }
  }

  // ---- legacy totals (driver / team) ----------------------------------------
  const totals = [
    ['legacy_driver_totals', 'driver', 'driver_id', LEGACY_DRIVER_FIELDS, (r) => tx.insertLegacyDriver(r), (id, f) => tx.updateLegacyDriver(id, f)],
    ['legacy_team_totals', 'team', 'team_id', LEGACY_TEAM_FIELDS, (r) => tx.insertLegacyTeam(r), (id, f) => tx.updateLegacyTeam(id, f)],
  ];
  for (const [entity, idKind, idColumn, fields, insert, update] of totals) {
    for (const a of plan.actions.filter((x) => x.entity === entity)) {
      if (a.action === 'unchanged') continue;
      const values = pick(a.incoming, fields);
      const ownerId = ids[idKind].get(a.key);
      if (a.action === 'create') {
        await insert({ [idColumn]: ownerId, ...values, source_file: file.name, source_row: a.source_row ?? null });
        await logItem(entity, a.key, 'created', null, values);
        bump(created, entity);
      } else if (wantsOverwrite(resolutions, a)) {
        const before = pick(a.existing, fields);
        await logChange(entity, ownerId, entity, a.key, before, values);
        await update(ownerId, values);
        await logItem(entity, a.key, 'updated', before, values);
        bump(updated, entity);
      } else kept.push({ entity, key: a.key, label: a.label });
    }
  }

  // ---- team history ---------------------------------------------------------------
  for (const a of plan.actions.filter((x) => x.entity === 'legacy_team_history')) {
    if (a.action === 'unchanged') continue;
    const driverId = ids.driver.get(a.key);
    const rows = a.incoming.map((h) => ({ sequence_no: h.sequence_no, team_id: ids.team.get(h.team_key) }));
    if (a.action === 'create') {
      await tx.replaceLegacyTeamHistory(driverId, rows);
      await logItem('legacy_team_history', a.key, 'created', null, a.incoming);
      bump(created, 'legacy_team_history');
    } else if (wantsOverwrite(resolutions, a)) {
      await logChange('legacy_driver_team_history', driverId, 'legacy_team_history', a.key, a.changes[0].existing, a.changes[0].incoming);
      await tx.replaceLegacyTeamHistory(driverId, rows);
      await logItem('legacy_team_history', a.key, 'updated', a.changes[0].existing, a.changes[0].incoming);
      bump(updated, 'legacy_team_history');
    } else kept.push({ entity: a.entity, key: a.key, label: a.label });
  }

  // ---- Grand Prix winners ------------------------------------------------------------
  for (const a of plan.actions.filter((x) => x.entity === 'gp_winner')) {
    if (a.action === 'unchanged') continue;
    const row = { circuit_id: ids.circuit.get(a.incoming.circuit_key), sequence_no: a.incoming.sequence_no, driver_id: ids.driver.get(a.incoming.driver_key) };
    if (a.action === 'create') {
      await tx.insertGpWinner(row);
      await logItem('gp_winner', a.key, 'created', null, row);
      bump(created, 'gp_winner');
    } else if (wantsOverwrite(resolutions, a)) {
      await logChange('circuit_gp_winners', row.circuit_id, 'gp_winner', a.key, a.changes[0].existing, a.changes[0].incoming);
      await tx.updateGpWinner(row);
      await logItem('gp_winner', a.key, 'updated', a.changes[0].existing, a.changes[0].incoming);
      bump(updated, 'gp_winner');
    } else kept.push({ entity: a.entity, key: a.key, label: a.label });
  }

  // ---- circuit records --------------------------------------------------------------------
  for (const a of plan.actions.filter((x) => x.entity === 'circuit_record')) {
    if (a.action === 'unchanged') continue;
    const r = a.incoming;
    const circuitId = ids.circuit.get(r.circuit_key);
    const fields = {
      driver_id: r.driver_key ? ids.driver.get(r.driver_key) : null,
      lap_time_ms: r.lap_time_ms, lap_time_text: r.lap_time_text, original_text: r.original_text,
      review_status: r.review_status, suggested_text: r.suggested_text, suggested_ms: r.suggested_ms,
    };
    if (a.action === 'create') {
      await tx.insertCircuitRecord({ circuit_id: circuitId, record_type: r.record_type, ...fields });
      await logItem('circuit_record', a.key, 'created', null, fields);
      bump(created, 'circuit_record');
    } else if (wantsOverwrite(resolutions, a)) {
      await logChange('circuit_records', circuitId, 'circuit_record', a.key, a.changes[0].existing, a.changes[0].incoming);
      await tx.updateCircuitRecord(circuitId, r.record_type, fields);
      await logItem('circuit_record', a.key, 'updated', a.changes[0].existing, a.changes[0].incoming);
      bump(updated, 'circuit_record');
    } else kept.push({ entity: a.entity, key: a.key, label: a.label });
  }

  // ---- review items worth keeping (not plain "info") -----------------------------------
  let issuesRecorded = 0;
  for (const issue of plan.issues) {
    if (issue.severity === 'info' || issue.severity === 'error') continue;
    const message = issue.message.slice(0, 1000);
    if (await tx.issueExists(issue.code, message)) continue; // do not repeat an item already open
    await tx.insertIssue(batchId, {
      severity: issue.severity, code: issue.code, message, details: issue.details ?? null,
      status: issue.severity === 'review_required' ? 'acknowledged' : 'open',
    });
    issuesRecorded += 1;
  }

  const summary = { created, updated, kept_conflicts: kept.length, issues_recorded: issuesRecorded };
  await tx.finalizeBatch(batchId, { summary });
  return { status: 'imported', batch_id: batchId, ...summary, kept };
}
