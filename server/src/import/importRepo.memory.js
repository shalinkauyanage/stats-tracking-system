// An in-memory stand-in for the MySQL import repository.
// It follows the SAME interface, including: unique name keys, "this file was already
// committed" protection, and all-or-nothing transactions. The tests use it to prove the
// import logic without needing MySQL. (The MySQL version is in importRepo.mysql.js.)

const dup = (what) => Object.assign(new Error(`Duplicate entry for ${what}`), { code: 'ER_DUP_ENTRY' });

export class MemoryImportRepo {
  constructor(seed = {}) {
    this.data = {
      drivers: [], teams: [], circuits: [],
      legacyDrivers: [], legacyTeams: [], legacyTeamHistory: [],
      gpWinners: [], circuitRecords: [],
      batches: [], items: [], issues: [], changeLog: [],
      // Stage 1 data that an import must NEVER touch:
      seasons: [], entries: [], driverStandings: [], constructorStandings: [],
      driverStats: [], teamStats: [], championships: [],
      ...structuredClone(seed),
    };
    this.failAt = null; // { method, nth } - used by tests to simulate a crash mid-import
    this.calls = {};
  }

  _id(list) { return list.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1; }
  _check(method) {
    this.calls[method] = (this.calls[method] || 0) + 1;
    if (this.failAt && this.failAt.method === method && this.calls[method] === this.failAt.nth) {
      throw new Error(`Simulated failure in ${method}`);
    }
  }

  async transaction(work) {
    const backup = structuredClone(this.data);
    try { return await work(this); }
    catch (err) { this.data = backup; throw err; }
  }

  async loadState() {
    const d = this.data;
    const counted = new Set(d.seasons.filter((s) => s.status === 'final' && !s.in_legacy_baseline).map((s) => s.id));
    const tally = (field) => {
      const out = {};
      for (const e of d.entries) if (counted.has(e.season_id)) out[e[field]] = (out[e[field]] || 0) + 1;
      return out;
    };
    return structuredClone({
      drivers: d.drivers, teams: d.teams, circuits: d.circuits,
      legacyDrivers: d.legacyDrivers, legacyTeams: d.legacyTeams, legacyTeamHistory: d.legacyTeamHistory,
      gpWinners: d.gpWinners, circuitRecords: d.circuitRecords,
      committedBatches: d.batches.filter((b) => b.status === 'committed'),
      countedSeasonsByDriver: tally('driver_id'),
      countedSeasonsByTeam: tally('team_id'),
    });
  }

  async createBatch({ file_name, file_sha256, file_size }) {
    this._check('createBatch');
    const id = this._id(this.data.batches);
    this.data.batches.push({ id, file_name, file_sha256, file_size, status: 'previewed', committed_sha256: null, committed_at: null, summary: null });
    return id;
  }
  async finalizeBatch(batchId, { summary }) {
    this._check('finalizeBatch');
    const b = this.data.batches.find((x) => x.id === batchId);
    if (this.data.batches.some((x) => x.committed_sha256 === b.file_sha256)) throw dup('committed_sha256');
    Object.assign(b, { status: 'committed', committed_sha256: b.file_sha256, committed_at: new Date().toISOString(), summary });
  }
  async recordFailedBatch({ file_name, file_sha256, file_size, error }) {
    this.data.batches.push({ id: this._id(this.data.batches), file_name, file_sha256, file_size, status: 'failed', committed_sha256: null, error_message: String(error).slice(0, 500) });
  }

  async insertTeam({ name, name_key }) {
    this._check('insertTeam');
    if (this.data.teams.some((t) => t.name_key === name_key)) throw dup('teams.name_key');
    const id = this._id(this.data.teams); this.data.teams.push({ id, name, name_key }); return id;
  }
  async insertDriver({ display_name, name_key }) {
    this._check('insertDriver');
    if (this.data.drivers.some((t) => t.name_key === name_key)) throw dup('drivers.name_key');
    const id = this._id(this.data.drivers); this.data.drivers.push({ id, display_name, name_key }); return id;
  }
  async insertCircuit({ gp_name, name_key, sort_order }) {
    this._check('insertCircuit');
    if (this.data.circuits.some((t) => t.name_key === name_key)) throw dup('circuits.name_key');
    const id = this._id(this.data.circuits); this.data.circuits.push({ id, gp_name, name_key, sort_order }); return id;
  }

  async insertLegacyDriver(row) {
    this._check('insertLegacyDriver');
    if (this.data.legacyDrivers.some((l) => l.driver_id === row.driver_id)) throw dup('legacy_driver_totals');
    this.data.legacyDrivers.push({ ...row });
  }
  async updateLegacyDriver(driverId, fields) { this._check('updateLegacyDriver'); Object.assign(this.data.legacyDrivers.find((l) => l.driver_id === driverId), fields); }
  async insertLegacyTeam(row) {
    this._check('insertLegacyTeam');
    if (this.data.legacyTeams.some((l) => l.team_id === row.team_id)) throw dup('legacy_team_totals');
    this.data.legacyTeams.push({ ...row });
  }
  async updateLegacyTeam(teamId, fields) { this._check('updateLegacyTeam'); Object.assign(this.data.legacyTeams.find((l) => l.team_id === teamId), fields); }
  async replaceLegacyTeamHistory(driverId, rows) {
    this._check('replaceLegacyTeamHistory');
    this.data.legacyTeamHistory = this.data.legacyTeamHistory.filter((h) => h.driver_id !== driverId);
    for (const r of rows) this.data.legacyTeamHistory.push({ driver_id: driverId, ...r });
  }

  async insertGpWinner(row) {
    this._check('insertGpWinner');
    if (this.data.gpWinners.some((w) => w.circuit_id === row.circuit_id && w.sequence_no === row.sequence_no)) throw dup('circuit_gp_winners');
    this.data.gpWinners.push({ season_id: null, source: 'legacy_import', ...row });
  }
  async updateGpWinner({ circuit_id, sequence_no, driver_id }) {
    this._check('updateGpWinner');
    this.data.gpWinners.find((w) => w.circuit_id === circuit_id && w.sequence_no === sequence_no).driver_id = driver_id;
  }
  async insertCircuitRecord(row) {
    this._check('insertCircuitRecord');
    if (this.data.circuitRecords.some((r) => r.circuit_id === row.circuit_id && r.record_type === row.record_type)) throw dup('circuit_records');
    this.data.circuitRecords.push({ source: 'legacy_import', ...row });
  }
  async updateCircuitRecord(circuitId, recordType, fields) {
    this._check('updateCircuitRecord');
    Object.assign(this.data.circuitRecords.find((r) => r.circuit_id === circuitId && r.record_type === recordType), fields);
  }

  async insertItem(batchId, item) { this._check('insertItem'); this.data.items.push({ batch_id: batchId, ...item }); }
  async issueExists(code, message) { return this.data.issues.some((i) => i.code === code && i.message === message && i.status !== 'resolved'); }
  async insertIssue(batchId, issue) { this._check('insertIssue'); this.data.issues.push({ id: this._id(this.data.issues), batch_id: batchId, ...issue }); }
  async insertChangeLog(entry) { this._check('insertChangeLog'); this.data.changeLog.push({ ...entry }); }

  async listBatches() { return structuredClone([...this.data.batches].reverse()); }
  async listIssues({ status } = {}) { return structuredClone(this.data.issues.filter((i) => !status || i.status === status)); }
}
