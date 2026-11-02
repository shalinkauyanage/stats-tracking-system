// The MySQL implementation of the import repository (same interface as the in-memory one
// the tests use). Every query is parameterised ("?" placeholders). Column names that are
// built dynamically only ever come from the fixed lists in logic/stats.js, never from input.
//
// An import takes a MySQL "named lock" so two imports can never run at the same time.

import { LEGACY_DRIVER_FIELDS, LEGACY_TEAM_FIELDS } from '../logic/stats.js';

const LOCK_NAME = 'f1_career_archive_import';
const RECORD_FIELDS = ['driver_id', 'lap_time_ms', 'lap_time_text', 'original_text', 'review_status', 'suggested_text', 'suggested_ms'];
const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

async function loadState(q) {
  const [drivers] = await q.query('SELECT id, display_name, name_key FROM drivers');
  const [teams] = await q.query('SELECT id, name, name_key FROM teams');
  const [circuits] = await q.query('SELECT id, gp_name, name_key, sort_order FROM circuits');
  const [legacyDrivers] = await q.query('SELECT * FROM legacy_driver_totals');
  const [legacyTeams] = await q.query('SELECT * FROM legacy_team_totals');
  const [legacyTeamHistory] = await q.query('SELECT driver_id, sequence_no, team_id FROM legacy_driver_team_history');
  const [gpWinners] = await q.query('SELECT circuit_id, sequence_no, driver_id, season_id FROM circuit_gp_winners');
  const [circuitRecords] = await q.query(
    'SELECT circuit_id, record_type, driver_id, lap_time_ms, lap_time_text, original_text, review_status, suggested_text, suggested_ms, source FROM circuit_records');
  const [committedBatches] = await q.query("SELECT id, file_sha256, committed_at FROM import_batches WHERE status = 'committed'");
  const countSeasons = async (column) => {
    const [rows] = await q.query(
      `SELECT e.${column} AS id, COUNT(*) AS seasons FROM season_entries e JOIN seasons s ON s.id = e.season_id
       WHERE s.status = 'final' AND s.in_legacy_baseline = 0 GROUP BY e.${column}`);
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.seasons)]));
  };
  return {
    drivers, teams, circuits, legacyDrivers, legacyTeams, legacyTeamHistory, gpWinners, circuitRecords, committedBatches,
    countedSeasonsByDriver: await countSeasons('driver_id'),
    countedSeasonsByTeam: await countSeasons('team_id'),
  };
}

class MysqlTx {
  constructor(conn) { this.conn = conn; }
  loadState() { return loadState(this.conn); }

  async createBatch({ file_name, file_sha256, file_size }) {
    const [r] = await this.conn.query("INSERT INTO import_batches (file_name, file_sha256, file_size, status) VALUES (?, ?, ?, 'previewed')", [file_name, file_sha256, file_size]);
    return r.insertId;
  }
  async finalizeBatch(batchId, { summary }) {
    await this.conn.query(
      "UPDATE import_batches SET status = 'committed', committed_sha256 = file_sha256, committed_at = NOW(), summary_json = ? WHERE id = ?",
      [json(summary), batchId]);
  }

  async insertTeam({ name, name_key }) { return (await this.conn.query('INSERT INTO teams (name, name_key) VALUES (?, ?)', [name, name_key]))[0].insertId; }
  async insertDriver({ display_name, name_key }) { return (await this.conn.query('INSERT INTO drivers (display_name, name_key) VALUES (?, ?)', [display_name, name_key]))[0].insertId; }
  async insertCircuit({ gp_name, name_key, sort_order }) { return (await this.conn.query('INSERT INTO circuits (gp_name, name_key, sort_order) VALUES (?, ?, ?)', [gp_name, name_key, sort_order]))[0].insertId; }

  async insertLegacyDriver(row) {
    const cols = ['driver_id', ...LEGACY_DRIVER_FIELDS, 'source_file', 'source_row'];
    await this.conn.query(`INSERT INTO legacy_driver_totals (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c] ?? null));
  }
  async updateLegacyDriver(driverId, fields) {
    const cols = LEGACY_DRIVER_FIELDS.filter((c) => c in fields);
    await this.conn.query(`UPDATE legacy_driver_totals SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE driver_id = ?`, [...cols.map((c) => fields[c]), driverId]);
  }
  async insertLegacyTeam(row) {
    const cols = ['team_id', ...LEGACY_TEAM_FIELDS, 'source_file', 'source_row'];
    await this.conn.query(`INSERT INTO legacy_team_totals (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c] ?? null));
  }
  async updateLegacyTeam(teamId, fields) {
    const cols = LEGACY_TEAM_FIELDS.filter((c) => c in fields);
    await this.conn.query(`UPDATE legacy_team_totals SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE team_id = ?`, [...cols.map((c) => fields[c]), teamId]);
  }
  async replaceLegacyTeamHistory(driverId, rows) {
    await this.conn.query('DELETE FROM legacy_driver_team_history WHERE driver_id = ?', [driverId]);
    for (const r of rows) {
      await this.conn.query('INSERT INTO legacy_driver_team_history (driver_id, sequence_no, team_id) VALUES (?, ?, ?)', [driverId, r.sequence_no, r.team_id]);
    }
  }

  async insertGpWinner({ circuit_id, sequence_no, driver_id }) {
    await this.conn.query("INSERT INTO circuit_gp_winners (circuit_id, sequence_no, driver_id, source) VALUES (?, ?, ?, 'legacy_import')", [circuit_id, sequence_no, driver_id]);
  }
  async updateGpWinner({ circuit_id, sequence_no, driver_id }) {
    await this.conn.query('UPDATE circuit_gp_winners SET driver_id = ? WHERE circuit_id = ? AND sequence_no = ?', [driver_id, circuit_id, sequence_no]);
  }
  async insertCircuitRecord(row) {
    const cols = ['circuit_id', 'record_type', ...RECORD_FIELDS];
    await this.conn.query(`INSERT INTO circuit_records (${cols.join(', ')}, source) VALUES (${cols.map(() => '?').join(', ')}, 'legacy_import')`, cols.map((c) => row[c] ?? null));
  }
  async updateCircuitRecord(circuitId, recordType, fields) {
    const cols = RECORD_FIELDS.filter((c) => c in fields);
    await this.conn.query(`UPDATE circuit_records SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE circuit_id = ? AND record_type = ?`, [...cols.map((c) => fields[c]), circuitId, recordType]);
  }

  async insertItem(batchId, { entity_type, natural_key, action, before_json, after_json }) {
    await this.conn.query('INSERT INTO import_items (batch_id, entity_type, natural_key, action, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)',
      [batchId, entity_type, String(natural_key).slice(0, 200), action, json(before_json), json(after_json)]);
  }
  async issueExists(code, message) {
    const [rows] = await this.conn.query("SELECT 1 AS found FROM import_issues WHERE code = ? AND message = ? AND status <> 'resolved' LIMIT 1", [code, message]);
    return rows.length > 0;
  }
  async insertIssue(batchId, { severity, code, message, details, status }) {
    await this.conn.query('INSERT INTO import_issues (batch_id, severity, code, message, details_json, status) VALUES (?, ?, ?, ?, ?, ?)',
      [batchId, severity, code, message, json(details), status]);
  }
  async insertChangeLog({ table_name, record_id, action, old_json, new_json, note }) {
    await this.conn.query('INSERT INTO change_log (table_name, record_id, action, old_json, new_json, note) VALUES (?, ?, ?, ?, ?, ?)',
      [table_name, record_id, action, json(old_json), json(new_json), note]);
  }
}

export class MysqlImportRepo {
  /** pool = a mysql2/promise pool */
  constructor(pool) { this.pool = pool; }

  loadState() { return loadState(this.pool); }

  /** All-or-nothing, and only one import at a time. */
  async transaction(work) {
    const conn = await this.pool.getConnection();
    let locked = false;
    try {
      const [[lock]] = await conn.query('SELECT GET_LOCK(?, 30) AS got', [LOCK_NAME]);
      if (Number(lock.got) !== 1) throw new Error('Another import is running right now. Try again in a minute.');
      locked = true;
      await conn.beginTransaction();
      const result = await work(new MysqlTx(conn));
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch { /* connection may already be gone */ }
      throw err;
    } finally {
      if (locked) { try { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch { /* ignore */ } }
      conn.release();
    }
  }

  async recordFailedBatch({ file_name, file_sha256, file_size, error }) {
    await this.pool.query("INSERT INTO import_batches (file_name, file_sha256, file_size, status, error_message) VALUES (?, ?, ?, 'failed', ?)",
      [file_name, file_sha256, file_size, String(error).slice(0, 500)]);
  }
  async listBatches() {
    const [rows] = await this.pool.query(
      'SELECT id, file_name, file_sha256, file_size, status, committed_at, created_at, summary_json AS summary, error_message FROM import_batches ORDER BY id DESC LIMIT 100');
    return rows;
  }
  async listIssues({ status } = {}) {
    const [rows] = status
      ? await this.pool.query('SELECT id, batch_id, severity, code, message, details_json AS details, status, created_at FROM import_issues WHERE status = ? ORDER BY id', [status])
      : await this.pool.query('SELECT id, batch_id, severity, code, message, details_json AS details, status, created_at FROM import_issues ORDER BY id');
    return rows;
  }
}
