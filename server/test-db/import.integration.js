// DATABASE TESTS FOR THE EXCEL IMPORTER - these need a running MySQL server.
// Run them with:  npm run test:db
//
// They use their OWN database, named after DB_TEST_NAME with "_import" added
// (default: f1_career_archive_import_test). It is wiped and rebuilt on every run,
// and the name must end in "_test", so your real archive is never touched.
//
// STATUS: written in Stage 2 but NOT yet run (the build sandbox has no MySQL).
// Please run them on your PC and send me the output.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { MysqlImportRepo } from '../src/import/importRepo.mysql.js';
import { previewImport, commitImport } from '../src/import/importService.js';
import { ImportBlockedError } from '../src/import/errors.js';
import { sampleWorkbook } from '../test-helpers/xlsx.js';
import { importFile } from '../test-helpers/imports.js';
import { ROOT } from '../test-helpers/data.js';

const dbName = `${config.testDatabaseName.replace(/_test$/, '')}_import_test`;
if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) throw new Error(`Refusing to run: "${dbName}" must end with _test`);
if (dbName === config.db.database) throw new Error('Refusing to run: the import test database must differ from DB_NAME');

const realWorkbook = () => fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'));
let pool; let repo;

const count = async (table) => Number((await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``))[0][0].n);
const ALL_IMPORT_TABLES = ['drivers', 'teams', 'circuits', 'legacy_driver_totals', 'legacy_team_totals', 'legacy_driver_team_history',
  'circuit_gp_winners', 'circuit_records', 'import_batches', 'import_items', 'import_issues', 'change_log'];
const SEASON_TABLES = ['seasons', 'season_entries', 'driver_standings', 'constructor_standings', 'driver_season_stats', 'team_season_stats', 'championship_history'];
const dump = async (tables) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await pool.query(`SELECT * FROM \`${t}\` ORDER BY 1`))[0]])));

before(async () => {
  const { database, ...server } = config.db;
  const admin = await mysql.createConnection({ ...server, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  const migrator = await mysql.createConnection({ ...server, database: dbName, multipleStatements: true });
  await runMigrations(migrator);
  await migrator.end();
  pool = mysql.createPool({ ...server, database: dbName, charset: 'utf8mb4', connectionLimit: 5 });
  repo = new MysqlImportRepo(pool);
});

beforeEach(async () => {
  const [tables] = await pool.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_name <> 'schema_migrations'", [dbName]);
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await pool.query(`TRUNCATE TABLE \`${t.name}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
});

after(async () => { if (pool) await pool.end(); });

test('migrations 001 and 002 are applied, and the "same file once" key exists', async () => {
  const [files] = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
  assert.deepEqual(files.map((f) => f.filename), ['001_core_schema.sql', '002_import_tracking.sql']);
  const [idx] = await pool.query(
  `SELECT index_name, non_unique
   FROM information_schema.statistics
   WHERE table_schema = ?
     AND table_name = 'import_batches'
     AND index_name = 'uq_import_committed_sha'`,
  [dbName]
);

assert.equal(idx.length, 1);
assert.equal(Number(idx[0].NON_UNIQUE), 0, 'the key is UNIQUE');
});

test('the database itself refuses two committed batches with the same fingerprint (NULLs are fine)', async () => {
  const add = (sha) => pool.query("INSERT INTO import_batches (file_name, file_sha256, status, committed_sha256) VALUES ('a', 'x', 'committed', ?)", [sha]);
  await add('a'.repeat(64));
  await assert.rejects(() => add('a'.repeat(64)), (e) => e.code === 'ER_DUP_ENTRY');
  await add(null); await add(null);
  assert.equal(await count('import_batches'), 3);
});

test('PREVIEW WRITES NOTHING to the database', async () => {
  const plan = await previewImport({ repo, buffer: realWorkbook(), fileName: 'F1.xlsx' });
  assert.equal(plan.status, 'ready');
  for (const t of ALL_IMPORT_TABLES) assert.equal(await count(t), 0, t);
});

test('REAL FILE: imports completely, with the right numbers', async () => {
  const result = await importFile(repo, realWorkbook());
  assert.equal(result.status, 'imported');
  const expected = { drivers: 22, teams: 11, circuits: 29, legacy_driver_totals: 22, legacy_team_totals: 11, legacy_driver_team_history: 37, circuit_gp_winners: 108, circuit_records: 58 };
  for (const [table, n] of Object.entries(expected)) assert.equal(await count(table), n, table);

  const [[vers]] = await pool.query("SELECT l.wins, l.mps, l.points, l.drivers_titles FROM legacy_driver_totals l JOIN drivers d ON d.id = l.driver_id WHERE d.name_key = 'max verstappen'");
  assert.deepEqual({ ...vers }, { wins: 42, mps: 450, points: 1479, drivers_titles: 2 });

  const [lv] = await pool.query("SELECT r.review_status, r.lap_time_ms, r.original_text, r.suggested_text FROM circuit_records r JOIN circuits c ON c.id = r.circuit_id WHERE c.name_key = 'las vegas' ORDER BY r.record_type");
  assert.equal(lv.length, 2);
  for (const r of lv) { assert.equal(r.review_status, 'pending_review'); assert.equal(r.lap_time_ms, null); assert.match(r.original_text, /01:11:/); }
  assert.deepEqual(lv.map((r) => r.suggested_text).sort(), ['1:11.561', '1:11.775']);
  const [[ok]] = await pool.query("SELECT COUNT(*) AS n FROM circuit_records WHERE review_status = 'ok'");
  assert.equal(Number(ok.n), 56);

  assert.equal(await count('import_items'), 279);
  const [[issues]] = await pool.query("SELECT SUM(severity = 'pending_review') AS pending, SUM(severity = 'warning') AS warnings FROM import_issues");
  assert.equal(Number(issues.pending), 2);
  assert.equal(Number(issues.warnings), 5);
  const [[batch]] = await pool.query("SELECT status, committed_sha256 = file_sha256 AS same FROM import_batches");
  assert.equal(batch.status, 'committed');
  assert.equal(Number(batch.same), 1);
});

test('the originally imported text is stored exactly (accents and spaces survive)', async () => {
  await importFile(repo, sampleWorkbook((c) => { c['Driver Stats'].A6 = 'Nico  Hülkenberg    Ferrari'; }));
  const [[row]] = await pool.query("SELECT display_name, name_key FROM drivers WHERE name_key LIKE 'nico%'");
  assert.equal(row.display_name, 'Nico Hülkenberg');
  assert.equal(row.name_key, 'nico hulkenberg');
});

test('SQL-looking names are stored as plain text (queries are parameterised)', async () => {
  const evil = "Robert'); DROP TABLE drivers;--";
  await importFile(repo, sampleWorkbook((c) => { c['Driver Stats'].A6 = `${evil}    Ferrari`; }));
  assert.equal(await count('drivers'), 4);
  const [[row]] = await pool.query('SELECT display_name FROM drivers WHERE display_name = ?', [evil]);
  assert.equal(row.display_name, evil);
});

test('SAFE RE-IMPORT: the same file twice changes nothing the second time', async () => {
  const buf = realWorkbook();
  await importFile(repo, buf);
  const before = await dump(ALL_IMPORT_TABLES);
  const second = await importFile(repo, buf);
  assert.equal(second.status, 'already_imported');
  assert.deepEqual(await dump(ALL_IMPORT_TABLES), before);
  assert.equal(await count('import_batches'), 1);
});

test('CONFLICTS are kept unless overwritten on purpose, and the old value is logged', async () => {
  await importFile(repo, sampleWorkbook(), { fileName: 'a.xlsx' });
  await pool.query("UPDATE legacy_driver_totals l JOIN drivers d ON d.id = l.driver_id SET l.wins = 99 WHERE d.name_key = 'alice alpha'");
  const variant = sampleWorkbook((c) => { c['Driver Stats'].A3 = 'Alice Alpha    Ferrari  '; });   // same data, different file

  const kept = await importFile(repo, variant, { fileName: 'b.xlsx' });
  assert.equal(kept.status, 'no_changes');
  assert.equal(kept.conflicts, 1);
  const [[a]] = await pool.query("SELECT l.wins FROM legacy_driver_totals l JOIN drivers d ON d.id = l.driver_id WHERE d.name_key = 'alice alpha'");
  assert.equal(a.wins, 99, 'the saved value was kept');

  const variant2 = sampleWorkbook((c) => { c['Driver Stats'].A3 = 'Alice Alpha    Ferrari   '; });
  const done = await importFile(repo, variant2, { fileName: 'c.xlsx', resolutions: { 'legacy_driver_totals|alice alpha': 'overwrite' } });
  assert.equal(done.status, 'imported');
  assert.deepEqual(done.updated, { legacy_driver_totals: 1 });
  const [[b]] = await pool.query("SELECT l.wins FROM legacy_driver_totals l JOIN drivers d ON d.id = l.driver_id WHERE d.name_key = 'alice alpha'");
  assert.equal(b.wins, 2);
  const [log] = await pool.query("SELECT old_json, new_json, action FROM change_log WHERE action = 'import_overwrite'");
  assert.equal(log.length, 1);
  assert.equal(log[0].old_json.wins, 99);
  assert.equal(log[0].new_json.wins, 2);
});

test('ROLLBACK: a failure midway leaves the database exactly as it was, and the lock is released', async () => {
  class FailingRepo extends MysqlImportRepo {
    async transaction(work) {
      return super.transaction(async (tx) => {
        const original = tx.insertGpWinner.bind(tx);
        let n = 0;
        tx.insertGpWinner = async (row) => { if (++n === 2) throw new Error('Simulated failure'); return original(row); };
        return work(tx);
      });
    }
  }
  const buf = sampleWorkbook();
  await assert.rejects(() => importFile(new FailingRepo(pool), buf, { fileName: 's.xlsx' }), /Simulated failure/);
  for (const t of ['drivers', 'teams', 'circuits', 'legacy_driver_totals', 'legacy_team_totals', 'legacy_driver_team_history', 'circuit_gp_winners', 'circuit_records', 'import_items', 'import_issues']) {
    assert.equal(await count(t), 0, `${t} must be empty after the rollback`);
  }
  const [batches] = await pool.query('SELECT status, error_message FROM import_batches');
  assert.deepEqual(batches.map((b) => b.status), ['failed']);
  assert.match(batches[0].error_message, /Simulated failure/);
  // the same file now imports completely (the named lock was released)
  const retry = await importFile(repo, buf, { fileName: 's.xlsx' });
  assert.equal(retry.status, 'imported');
  assert.equal(await count('drivers'), 4);
});

test('HISTORICAL SEASONS ARE PRESERVED: an import does not touch seasons, standings, stats or champions', async () => {
  const [d] = await pool.query("INSERT INTO drivers (display_name, name_key) VALUES ('Alice Alpha', 'alice alpha')");
  const [t] = await pool.query("INSERT INTO teams (name, name_key) VALUES ('Ferrari', 'ferrari')");
  const [s] = await pool.query("INSERT INTO seasons (year, status, in_legacy_baseline) VALUES (2027, 'final', 1)");
  const [e] = await pool.query('INSERT INTO season_entries (season_id, driver_id, team_id) VALUES (?, ?, ?)', [s.insertId, d.insertId, t.insertId]);
  await pool.query('INSERT INTO driver_standings (season_id, season_entry_id, position, points) VALUES (?, ?, 1, 400)', [s.insertId, e.insertId]);
  await pool.query('INSERT INTO constructor_standings (season_id, team_id, position, points) VALUES (?, ?, 1, 700)', [s.insertId, t.insertId]);
  await pool.query('INSERT INTO driver_season_stats (season_entry_id, wins) VALUES (?, 10)', [e.insertId]);
  await pool.query('INSERT INTO team_season_stats (season_id, team_id, wins) VALUES (?, ?, 12)', [s.insertId, t.insertId]);
  await pool.query("INSERT INTO championship_history (season_id, championship_type, driver_id, team_id, points, driver_name_snapshot, team_name_snapshot) VALUES (?, 'drivers', ?, ?, 400, 'Alice Alpha', 'Ferrari')", [s.insertId, d.insertId, t.insertId]);

  const before = await dump(SEASON_TABLES);
  const result = await importFile(repo, sampleWorkbook());
  assert.equal(result.status, 'imported');
  assert.deepEqual(await dump(SEASON_TABLES), before, 'season data is identical');
  const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM drivers WHERE name_key = 'alice alpha'");
  assert.equal(Number(n.n), 1, 'Alice was matched, not duplicated');
});

test('DOUBLE-COUNT GUARD: legacy totals for a driver with counted seasons need acknowledgement', async () => {
  const [d] = await pool.query("INSERT INTO drivers (display_name, name_key) VALUES ('Alice Alpha', 'alice alpha')");
  const [t] = await pool.query("INSERT INTO teams (name, name_key) VALUES ('Ferrari', 'ferrari')");
  const [s] = await pool.query("INSERT INTO seasons (year, status, in_legacy_baseline) VALUES (2027, 'final', 0)");
  await pool.query('INSERT INTO season_entries (season_id, driver_id, team_id) VALUES (?, ?, ?)', [s.insertId, d.insertId, t.insertId]);
  const buf = sampleWorkbook();
  await assert.rejects(() => importFile(repo, buf), ImportBlockedError);
  assert.equal(await count('legacy_driver_totals'), 0);
  const ack = ['double-count:driver:alice alpha', 'double-count:team:ferrari'];
  const ok = await importFile(repo, buf, { options: { acknowledged: ack } });
  assert.equal(ok.status, 'imported');
  const [[issue]] = await pool.query("SELECT status FROM import_issues WHERE severity = 'review_required' LIMIT 1");
  assert.equal(issue.status, 'acknowledged');
});

test('BLANK POLICY "unknown" stores NULL in MySQL', async () => {
  await importFile(repo, sampleWorkbook(), { options: { blankPolicy: 'unknown' } });
  const [[carl]] = await pool.query("SELECT l.second_places, l.wins FROM legacy_driver_totals l JOIN drivers d ON d.id = l.driver_id WHERE d.name_key = 'carl gamma'");
  assert.equal(carl.second_places, null);
  assert.equal(carl.wins, 0);
});

test('a blocked import (formula error) saves nothing at all', async () => {
  const buf = sampleWorkbook((c) => { c['Driver Stats'].B3 = { error: '#REF!' }; });
  await assert.rejects(() => importFile(repo, buf), ImportBlockedError);
  for (const t of ALL_IMPORT_TABLES) assert.equal(await count(t), 0, t);
});

test('WEB API: preview -> commit -> commit again -> history, through the real Express app', async () => {
  const { createApp } = await import('../src/app.js');
  const server = http.createServer(createApp({ pool }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = sampleWorkbook();
  const post = (url) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'sample.xlsx' }, body });
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health, { status: 'ok', database: 'connected' });

    const previewRes = await post('/api/import/preview');
    assert.equal(previewRes.status, 200);
    const plan = await previewRes.json();
    assert.equal(plan.status, 'ready');
    assert.equal(await count('drivers'), 0, 'preview saved nothing');

    const noConfirm = await post(`/api/import/commit?expected_sha256=${plan.file.sha256}`);
    assert.equal(noConfirm.status, 400);

    const commit = await post(`/api/import/commit?confirm=yes&expected_sha256=${plan.file.sha256}`);
    assert.equal(commit.status, 201);
    assert.equal((await commit.json()).status, 'imported');

    const again = await post(`/api/import/commit?confirm=yes&expected_sha256=${plan.file.sha256}`);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).status, 'already_imported');

    const batches = await (await fetch(`${base}/api/import/batches`)).json();
    assert.equal(batches.batches.length, 1);

    const bad = await fetch(`${base}/api/import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'not a workbook' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'not_zip');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// keep the unused helper import honest
void commitImport;
