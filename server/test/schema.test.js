// Static checks of the SQL file. These do NOT run MySQL (it is not available in the
// build sandbox). The real database checks live in test-db/ and run on your PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrationFiles } from '../src/db/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.resolve(here, '../db/migrations/001_core_schema.sql'), 'utf8');
const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
const tableBody = (name) => {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  return sql.slice(start, sql.indexOf('ENGINE=InnoDB', start));
};

test('every table the plan promised exists', () => {
  for (const t of ['drivers', 'teams', 'circuits', 'seasons', 'season_entries', 'driver_standings', 'constructor_standings',
    'driver_season_stats', 'team_season_stats', 'championship_history', 'season_awards', 'circuit_records', 'circuit_gp_winners',
    'legacy_driver_totals', 'legacy_team_totals', 'legacy_driver_team_history', 'race_results', 'import_batches', 'change_log', 'settings']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.equal(new Set(tables).size, tables.length, 'no table is defined twice');
});

test('driver identity is independent of teams', () => {
  assert.ok(!/team/i.test(tableBody('drivers').replace(/--.*$/gm, '')), 'drivers table has no team column');
});

test('one team per driver per season is enforced by the database', () => {
  assert.match(tableBody('season_entries'), /UNIQUE KEY uq_entry_driver_per_season \(season_id, driver_id\)/);
});

test('history cannot be deleted by accident: no CASCADE / SET NULL anywhere', () => {
  const code = sql.replace(/--.*$/gm, ''); // ignore comments
  assert.ok(!/ON DELETE (CASCADE|SET NULL|SET DEFAULT)/i.test(code));
  assert.ok(!/ON UPDATE (CASCADE|SET NULL|SET DEFAULT)/i.test(code));
  const constraints = code.split(/CONSTRAINT /).slice(1).filter((c) => /^fk_/.test(c));
  assert.equal(constraints.length, 28, 'number of foreign keys');
  // Only these three omit the clause (their column also sits in a CHECK; default = RESTRICT)
  const implicit = ['fk_champ_driver', 'fk_award_driver', 'fk_award_team'];
  for (const c of constraints) {
    const name = c.split(' ')[0];
    const explicit = /ON DELETE RESTRICT/.test(c.split(/,\s*\n|\n\s*\)/)[0]);
    assert.ok(explicit || implicit.includes(name), `${name} must be RESTRICT`);
  }
});

test('standings are tied to the same season as the entry', () => {
  assert.match(tableBody('driver_standings'), /FOREIGN KEY \(season_entry_id, season_id\)\s+REFERENCES season_entries \(id, season_id\)/);
});

test('season statistics columns are nullable (unknown is not zero)', () => {
  const body = tableBody('driver_season_stats');
  const statLines = body.split('\n').filter((l) => /SMALLINT UNSIGNED/.test(l));
  assert.ok(statLines.length >= 12);
  for (const line of statLines) assert.match(line, /\bNULL\b/, line);
  assert.ok(!/DEFAULT 0/i.test(body));
});

test('one champion per season per championship type', () => {
  assert.match(tableBody('championship_history'), /UNIQUE KEY uq_champ_season_type \(season_id, championship_type\)/);
});

test('legacy statistics live in their own tables, with M.P.S kept as mps', () => {
  assert.match(tableBody('legacy_driver_totals'), /\bmps\b/);
  assert.ok(!/legacy/i.test(tableBody('driver_season_stats')));
});

test('SQL is structurally sound: balanced brackets and every statement ends with ;', () => {
  const clean = sql.replace(/--.*$/gm, '');
  assert.equal([...clean].filter((c) => c === '(').length, [...clean].filter((c) => c === ')').length);
  const statements = clean.split(';').map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.length >= tables.length);
});

test('migration files are found in order', async () => {
  const files = await listMigrationFiles();
  assert.deepEqual(files, ['001_core_schema.sql', '002_import_tracking.sql']);
});
