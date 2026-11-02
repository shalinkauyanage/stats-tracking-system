// DATABASE TESTS - these need a running MySQL server. Run them with:  npm run test:db
//
// They use a SEPARATE database (DB_TEST_NAME in server/.env, default f1_career_archive_test).
// That database is wiped and rebuilt on every run. The name must end in "_test" so
// your real archive can never be touched by accident.
//
// STATUS: written in Stage 1 but NOT yet run (the build sandbox has no MySQL).
// Please run them on your PC and send me the output.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';

const testDb = config.testDatabaseName;
if (!/^[A-Za-z0-9_]+_test$/.test(testDb)) {
  throw new Error(`Refusing to run: DB_TEST_NAME ("${testDb}") must end with _test`);
}
if (testDb === config.db.database) {
  throw new Error('Refusing to run: DB_TEST_NAME must be different from DB_NAME');
}

let db; // one connection used by all tests

const insert = async (sql, params = []) => (await db.query(sql, params))[0].insertId;
const addDriver = (name) => insert('INSERT INTO drivers (display_name, name_key) VALUES (?, ?)', [name, name.toLowerCase()]);
const addTeam = (name) => insert('INSERT INTO teams (name, name_key) VALUES (?, ?)', [name, name.toLowerCase()]);
const addSeason = (year, status = 'final') => insert('INSERT INTO seasons (year, status) VALUES (?, ?)', [year, status]);
const addEntry = (season, driver, team) =>
  insert('INSERT INTO season_entries (season_id, driver_id, team_id) VALUES (?, ?, ?)', [season, driver, team]);

/** Runs a query that must fail and checks the MySQL error code. */
async function mustFail(code, sql, params = []) {
  await assert.rejects(() => db.query(sql, params), (err) => {
    assert.equal(err.code, code, `expected ${code} but got ${err.code}: ${err.message}`);
    return true;
  });
}

before(async () => {
  const { database, ...server } = config.db;
  const admin = await mysql.createConnection({ ...server, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${testDb}\``);
  await admin.query(`CREATE DATABASE \`${testDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  db = await mysql.createConnection({ ...server, database: testDb, multipleStatements: true });
  await runMigrations(db);
});

beforeEach(async () => {
  const [tables] = await db.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_name <> 'schema_migrations'",
    [testDb],
  );
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await db.query(`TRUNCATE TABLE \`${t.name}\``);
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
});

after(async () => {
  if (db) await db.end();
});

test('the schema builds and contains every table', async () => {
  const [rows] = await db.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?', [testDb]);
  const names = rows.map((r) => r.name);
  for (const t of ['drivers', 'teams', 'circuits', 'seasons', 'season_entries', 'driver_standings', 'constructor_standings',
    'driver_season_stats', 'team_season_stats', 'championship_history', 'circuit_records', 'legacy_driver_totals']) {
    assert.ok(names.includes(t), `missing ${t}`);
  }
});

test('running the migrations again does nothing (safe to repeat)', async () => {
  assert.deepEqual(await runMigrations(db), []);
});

test('TRANSFER: one driver, two seasons, two teams - one identity, two assignments', async () => {
  const driverA = await addDriver('Driver A');
  const ferrari = await addTeam('Ferrari');
  const mercedes = await addTeam('Mercedes');
  const s2025 = await addSeason(2025);
  const s2026 = await addSeason(2026);
  await addEntry(s2025, driverA, ferrari);
  await addEntry(s2026, driverA, mercedes);

  const [[count]] = await db.query('SELECT COUNT(*) AS n FROM drivers');
  assert.equal(count.n, 1, 'driver not duplicated');
  const [rows] = await db.query(
    'SELECT s.year, t.name FROM season_entries e JOIN seasons s ON s.id = e.season_id JOIN teams t ON t.id = e.team_id WHERE e.driver_id = ? ORDER BY s.year',
    [driverA],
  );
  assert.deepEqual(rows.map((r) => [r.year, r.name]), [[2025, 'Ferrari'], [2026, 'Mercedes']]);
});

test('a driver cannot have two teams in the same season', async () => {
  const d = await addDriver('Driver A');
  const t1 = await addTeam('Ferrari');
  const t2 = await addTeam('Mercedes');
  const s = await addSeason(2025);
  await addEntry(s, d, t1);
  await mustFail('ER_DUP_ENTRY', 'INSERT INTO season_entries (season_id, driver_id, team_id) VALUES (?, ?, ?)', [s, d, t2]);
});

test('a driver or team with history cannot be deleted', async () => {
  const d = await addDriver('Driver A');
  const t = await addTeam('Ferrari');
  const s = await addSeason(2025);
  await addEntry(s, d, t);
  await mustFail('ER_ROW_IS_REFERENCED_2', 'DELETE FROM drivers WHERE id = ?', [d]);
  await mustFail('ER_ROW_IS_REFERENCED_2', 'DELETE FROM teams WHERE id = ?', [t]);
  await mustFail('ER_ROW_IS_REFERENCED_2', 'DELETE FROM seasons WHERE id = ?', [s]);
});

test('duplicate driver names (ignoring case/spacing key) are rejected', async () => {
  await addDriver('Max Verstappen');
  await mustFail('ER_DUP_ENTRY', 'INSERT INTO drivers (display_name, name_key) VALUES (?, ?)', ['Max  Verstappen', 'max verstappen']);
});

test('SEASON-END POINTS: standings keep typed points; a blank stays NULL', async () => {
  const d1 = await addDriver('Driver A');
  const d2 = await addDriver('Driver B');
  const t = await addTeam('Ferrari');
  const s = await addSeason(2026);
  const e1 = await addEntry(s, d1, t);
  const e2 = await addEntry(s, d2, t);
  await db.query('INSERT INTO driver_standings (season_id, season_entry_id, position, points) VALUES (?, ?, 1, 400), (?, ?, 2, NULL)', [s, e1, s, e2]);
  const [rows] = await db.query('SELECT position, points FROM driver_standings WHERE season_id = ? ORDER BY position', [s]);
  assert.equal(rows[0].points, 400);
  assert.equal(rows[1].points, null);
});

test('standings cannot reuse a position or point at an entry from another season', async () => {
  const d1 = await addDriver('Driver A');
  const d2 = await addDriver('Driver B');
  const t = await addTeam('Ferrari');
  const s2025 = await addSeason(2025);
  const s2026 = await addSeason(2026);
  const e1 = await addEntry(s2025, d1, t);
  const e2 = await addEntry(s2025, d2, t);
  await db.query('INSERT INTO driver_standings (season_id, season_entry_id, position, points) VALUES (?, ?, 1, 10)', [s2025, e1]);
  await mustFail('ER_DUP_ENTRY', 'INSERT INTO driver_standings (season_id, season_entry_id, position, points) VALUES (?, ?, 1, 5)', [s2025, e2]);
  // e2 belongs to 2025, so claiming it for 2026 must fail
  await mustFail('ER_NO_REFERENCED_ROW_2', 'INSERT INTO driver_standings (season_id, season_entry_id, position, points) VALUES (?, ?, 2, 5)', [s2026, e2]);
});

test('MISSING IS NOT ZERO: unset season stats are stored as NULL', async () => {
  const d = await addDriver('Driver A');
  const t = await addTeam('Ferrari');
  const s = await addSeason(2026);
  const e = await addEntry(s, d, t);
  await db.query('INSERT INTO driver_season_stats (season_entry_id, wins) VALUES (?, 0)', [e]);
  const [[row]] = await db.query('SELECT wins, podiums, poles, sprint_wins FROM driver_season_stats WHERE season_entry_id = ?', [e]);
  assert.equal(row.wins, 0);
  assert.equal(row.podiums, null);
  assert.equal(row.poles, null);
  assert.equal(row.sprint_wins, null);
});

test('HALL OF FAME: one champion per season per type; a season with a champion cannot be deleted', async () => {
  const d = await addDriver('Driver A');
  const d2 = await addDriver('Driver B');
  const t = await addTeam('Ferrari');
  const s = await addSeason(2025);
  await db.query(
    "INSERT INTO championship_history (season_id, championship_type, driver_id, team_id, points, driver_name_snapshot, team_name_snapshot) VALUES (?, 'drivers', ?, ?, 400, 'Driver A', 'Ferrari')",
    [s, d, t],
  );
  await mustFail('ER_DUP_ENTRY',
    "INSERT INTO championship_history (season_id, championship_type, driver_id, team_id, driver_name_snapshot, team_name_snapshot) VALUES (?, 'drivers', ?, ?, 'Driver B', 'Ferrari')",
    [s, d2, t]);
  await mustFail('ER_ROW_IS_REFERENCED_2', 'DELETE FROM seasons WHERE id = ?', [s]);
  await mustFail('ER_ROW_IS_REFERENCED_2', 'DELETE FROM drivers WHERE id = ?', [d]);
});

test('a drivers championship needs a driver; a constructors championship must not have one', async () => {
  const d = await addDriver('Driver A');
  const t = await addTeam('Ferrari');
  const s = await addSeason(2025);
  await mustFail('ER_CHECK_CONSTRAINT_VIOLATED',
    "INSERT INTO championship_history (season_id, championship_type, driver_id, team_id, team_name_snapshot) VALUES (?, 'drivers', NULL, ?, 'Ferrari')", [s, t]);
  await mustFail('ER_CHECK_CONSTRAINT_VIOLATED',
    "INSERT INTO championship_history (season_id, championship_type, driver_id, team_id, driver_name_snapshot, team_name_snapshot) VALUES (?, 'constructors', ?, ?, 'Driver A', 'Ferrari')", [s, d, t]);
});

test('LEGACY totals are separate and are not changed by adding season data', async () => {
  const d = await addDriver('Max Verstappen');
  const t = await addTeam('Red Bull Racing');
  await db.query('INSERT INTO legacy_driver_totals (driver_id, wins, mps, points) VALUES (?, 42, 450, 1479)', [d]);
  const s = await addSeason(2027);
  const e = await addEntry(s, d, t);
  await db.query('INSERT INTO driver_season_stats (season_entry_id, wins) VALUES (?, 10)', [e]);
  const [[legacy]] = await db.query('SELECT wins, mps, points FROM legacy_driver_totals WHERE driver_id = ?', [d]);
  assert.deepEqual({ ...legacy }, { wins: 42, mps: 450, points: 1479 });
});

test('seasons default to draft and not-in-baseline', async () => {
  const s = await addSeason(2030, 'draft');
  const [[row]] = await db.query('SELECT status, in_legacy_baseline FROM seasons WHERE id = ?', [s]);
  assert.equal(row.status, 'draft');
  assert.equal(row.in_legacy_baseline, 0);
});

test('TRANSACTION: if a step fails, nothing from that save is kept', async () => {
  const d = await addDriver('Driver A');
  const t = await addTeam('Ferrari');
  await db.beginTransaction();
  try {
    const s = await addSeason(2031);
    await addEntry(s, d, t);
    await addEntry(s, d, t); // duplicate -> throws
    await db.commit();
    assert.fail('should not get here');
  } catch (err) {
    await db.rollback();
    assert.equal(err.code, 'ER_DUP_ENTRY');
  }
  const [[seasons]] = await db.query('SELECT COUNT(*) AS n FROM seasons');
  const [[entries]] = await db.query('SELECT COUNT(*) AS n FROM season_entries');
  assert.equal(seasons.n, 0);
  assert.equal(entries.n, 0);
});

test('circuit records: one record per circuit and type; original text is kept', async () => {
  const c = await insert("INSERT INTO circuits (gp_name, name_key) VALUES ('Las Vegas', 'las vegas')");
  const d = await addDriver('Lando Norris');
  await db.query(
    "INSERT INTO circuit_records (circuit_id, record_type, driver_id, original_text, review_status, suggested_text, source) VALUES (?, 'race_fastest_lap', ?, 'Lando Norris 01:11:775', 'pending_review', '1:11.775', 'legacy_import')",
    [c, d],
  );
  await mustFail('ER_DUP_ENTRY', "INSERT INTO circuit_records (circuit_id, record_type, driver_id) VALUES (?, 'race_fastest_lap', ?)", [c, d]);
  const [[row]] = await db.query('SELECT lap_time_ms, original_text, review_status FROM circuit_records WHERE circuit_id = ?', [c]);
  assert.equal(row.lap_time_ms, null);
  assert.equal(row.review_status, 'pending_review');
  assert.match(row.original_text, /01:11:775/);
});
