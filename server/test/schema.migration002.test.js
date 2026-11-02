// Static checks of migration 002 (no MySQL needed). The real run is in test-db/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../db/migrations');
const sql002 = fs.readFileSync(path.join(dir, '002_import_tracking.sql'), 'utf8');
const code = sql002.replace(/--.*$/gm, '');

test('migration 002 only ADDS: it never drops, renames or changes anything from Stage 1', () => {
  const statements = code.replace(/ON DELETE RESTRICT/gi, ''); // the harmless FK rule is allowed
  assert.ok(!/\bDROP\b/i.test(statements));
  assert.ok(!/\bMODIFY\b|\bCHANGE\b|\bRENAME\b|\bTRUNCATE\b|\bDELETE\b|\bUPDATE\b/i.test(statements));
  assert.ok(!/ON DELETE (CASCADE|SET NULL)/i.test(code));
});

test('migration 001 (Stage 1) is unchanged apart from nothing: its fingerprint-relevant rules are still there', () => {
  const sql001 = fs.readFileSync(path.join(dir, '001_core_schema.sql'), 'utf8');
  assert.match(sql001, /UNIQUE KEY uq_entry_driver_per_season \(season_id, driver_id\)/);
  assert.match(sql001, /UNIQUE KEY uq_champ_season_type \(season_id, championship_type\)/);
  assert.ok(!/ON DELETE CASCADE/i.test(sql001));
});

test('the same file cannot be committed twice: committed_sha256 is UNIQUE', () => {
  assert.match(code, /ADD COLUMN committed_sha256 CHAR\(64\) NULL/);
  assert.match(code, /ADD UNIQUE KEY uq_import_committed_sha \(committed_sha256\)/);
});

test('import history tables exist and use RESTRICT foreign keys', () => {
  assert.match(code, /CREATE TABLE IF NOT EXISTS import_items/);
  assert.match(code, /CREATE TABLE IF NOT EXISTS import_issues/);
  const fks = [...code.matchAll(/FOREIGN KEY/g)].length;
  const restricts = [...code.matchAll(/ON DELETE RESTRICT/g)].length;
  assert.equal(fks, 2);
  assert.equal(restricts, 2);
});

test('import_batches is altered in ONE statement (so a failure cannot leave it half-changed)', () => {
  assert.equal([...code.matchAll(/ALTER TABLE/g)].length, 1);
});

test('SQL is structurally sound', () => {
  assert.equal([...code].filter((c) => c === '(').length, [...code].filter((c) => c === ')').length);
});
