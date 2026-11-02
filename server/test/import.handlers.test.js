// The web-route logic (handlers) and the command-line tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryImportRepo } from '../src/import/importRepo.memory.js';
import { handlePreview, handleCommit, handleBatches, handleIssues, optionsFromQuery, resolutionsFromQuery } from '../src/import/importHandlers.js';
import { renderPlanText } from '../src/import/report.js';
import { previewImport } from '../src/import/importService.js';
import { sampleWorkbook } from '../test-helpers/xlsx.js';
import { realWorkbook } from '../test-helpers/imports.js';
import { ROOT } from '../test-helpers/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../scripts/import-excel.js');

test('query options are parsed safely (repeated parameters, defaults)', () => {
  assert.deepEqual(optionsFromQuery({}), { blankPolicy: 'zero', acknowledged: [] });
  assert.deepEqual(optionsFromQuery({ blank_policy: 'unknown', acknowledged: ['a', 'b'] }), { blankPolicy: 'unknown', acknowledged: ['a', 'b'] });
  assert.deepEqual(optionsFromQuery({ acknowledged: 'one' }).acknowledged, ['one']);
  assert.deepEqual(resolutionsFromQuery({ overwrite: ['x|y', 'z|w'] }), { 'x|y': 'overwrite', 'z|w': 'overwrite' });
  assert.deepEqual(resolutionsFromQuery({ overwrite_all: 'yes' }), { '*': 'overwrite' });
  assert.deepEqual(resolutionsFromQuery({}), {});
});

test('POST preview: 200 with the plan, and the repository is untouched', async () => {
  const repo = new MemoryImportRepo();
  const out = await handlePreview({ repo, body: sampleWorkbook(), fileName: 'sample.xlsx', query: {} });
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'ready');
  assert.equal(out.json.file.name, 'sample.xlsx');
  assert.equal('dataset' in out.json, false);
  assert.equal(repo.data.drivers.length, 0);
  JSON.stringify(out.json); // must be serialisable
});

test('POST preview: a file that is not a workbook gives 400 with a readable message', async () => {
  const repo = new MemoryImportRepo();
  const out = await handlePreview({ repo, body: Buffer.from('hello'), fileName: 'notes.xlsx', query: {} });
  assert.equal(out.status, 400);
  assert.equal(out.json.error.code, 'not_zip');
  assert.match(out.json.error.message, /not an \.xlsx/);
  const empty = await handlePreview({ repo, body: {}, fileName: 'a.xlsx', query: {} });   // express.raw gives {} for no body
  assert.equal(empty.status, 400);
  const wrongType = await handlePreview({ repo, body: sampleWorkbook(), fileName: 'old.xls', query: {} });
  assert.equal(wrongType.json.error.code, 'wrong_extension');
});

test('POST commit: needs explicit confirmation', async () => {
  const out = await handleCommit({ repo: new MemoryImportRepo(), body: sampleWorkbook(), fileName: 's.xlsx', query: {} });
  assert.equal(out.status, 400);
  assert.equal(out.json.error.code, 'confirmation_required');
});

test('POST commit: wrong fingerprint is refused (409) and saves nothing', async () => {
  const repo = new MemoryImportRepo();
  const out = await handleCommit({ repo, body: sampleWorkbook(), fileName: 's.xlsx', query: { confirm: 'yes', expected_sha256: 'deadbeef' } });
  assert.equal(out.status, 409);
  assert.equal(out.json.error.code, 'file_mismatch');
  assert.equal(repo.data.drivers.length, 0);
});

test('POST commit: a blocked import is 409 and carries the plan with the reasons', async () => {
  const repo = new MemoryImportRepo();
  const body = sampleWorkbook((c) => { c['Driver Stats'].B3 = { error: '#REF!' }; });
  const preview = await handlePreview({ repo, body, fileName: 's.xlsx', query: {} });
  const out = await handleCommit({ repo, body, fileName: 's.xlsx', query: { confirm: 'yes', expected_sha256: preview.json.file.sha256 } });
  assert.equal(out.status, 409);
  assert.equal(out.json.error.code, 'import_blocked');
  assert.ok(out.json.plan.blockers.some((b) => b.code === 'formula_error'));
  assert.equal(repo.data.drivers.length, 0);
});

test('the full web flow: preview -> commit (201) -> commit again (200, already imported) -> history and issues', async () => {
  const repo = new MemoryImportRepo();
  const body = sampleWorkbook((c) => { c['Track Records'].B24 = 'Alice Alpha  \r\n01:10:000'; });
  const preview = await handlePreview({ repo, body, fileName: 's.xlsx', query: {} });
  const query = { confirm: 'yes', expected_sha256: preview.json.file.sha256 };
  const first = await handleCommit({ repo, body, fileName: 's.xlsx', query });
  assert.equal(first.status, 201);
  assert.equal(first.json.status, 'imported');
  const second = await handleCommit({ repo, body, fileName: 's.xlsx', query });
  assert.equal(second.status, 200);
  assert.equal(second.json.status, 'already_imported');
  const batches = await handleBatches({ repo });
  assert.equal(batches.json.batches.length, 1);
  const issues = await handleIssues({ repo, query: { status: 'open' } });
  assert.ok(issues.json.issues.some((i) => i.code === 'lap_time_format_correction'));
});

test('POST commit with overwrite parameters: only the named conflict is changed', async () => {
  const repo = new MemoryImportRepo();
  const a = sampleWorkbook();
  const pa = await handlePreview({ repo, body: a, fileName: 'a.xlsx', query: {} });
  await handleCommit({ repo, body: a, fileName: 'a.xlsx', query: { confirm: 'yes', expected_sha256: pa.json.file.sha256 } });
  const b = sampleWorkbook((c) => { c['Driver Stats'].B3 = 3; });
  const pb = await handlePreview({ repo, body: b, fileName: 'b.xlsx', query: {} });
  assert.equal(pb.json.status, 'conflicts_only');
  const conflictKey = pb.json.conflicts[0].resolution_key;
  const out = await handleCommit({ repo, body: b, fileName: 'b.xlsx', query: { confirm: 'yes', expected_sha256: pb.json.file.sha256, overwrite: [conflictKey] } });
  assert.equal(out.status, 201);
  assert.deepEqual(out.json.updated, { legacy_driver_totals: 1 });
});

test('the text report is readable and complete for the real workbook', async () => {
  const plan = await previewImport({ repo: new MemoryImportRepo(), buffer: realWorkbook(), fileName: 'F1.xlsx' });
  const text = renderPlanText(plan);
  assert.match(text, /READY TO IMPORT/);
  assert.match(text, /Drivers\s+22/);
  assert.match(text, /Grand Prix winners\s+104/);
  assert.match(text, /PENDING YOUR APPROVAL/);
  assert.match(text, /Las Vegas fastest lap/);
  assert.match(text, /930a7c75ee88/);
});

test('COMMAND LINE: preview of the real workbook needs no database and writes nothing', () => {
  const before = fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'));
  const run = spawnSync(process.execPath, [cli, 'preview', path.join(ROOT, 'data/original/F1.xlsx'), '--no-db'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /READY TO IMPORT/);
  assert.match(run.stdout, /Drivers\s+22/);
  assert.ok(before.equals(fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'))), 'the workbook is untouched');
});

test('COMMAND LINE: commit without --yes imports nothing; commit with --no-db is refused', () => {
  const file = path.join(ROOT, 'data/original/F1.xlsx');
  const dry = spawnSync(process.execPath, [cli, 'commit', file, '--no-db'], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /Nothing was imported/);
  const refused = spawnSync(process.execPath, [cli, 'commit', file, '--no-db', '--yes'], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Cannot import without a database/);
});

test('COMMAND LINE: bad input gives a friendly message and a non-zero exit code', () => {
  const tmp = path.join(os.tmpdir(), `not-a-workbook-${process.pid}.xlsx`);
  fs.writeFileSync(tmp, 'plain text');
  const run = spawnSync(process.execPath, [cli, 'preview', tmp, '--no-db'], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not an \.xlsx/);
  assert.equal(spawnSync(process.execPath, [cli, 'preview', '--bogus'], { encoding: 'utf8' }).status, 2);
});
