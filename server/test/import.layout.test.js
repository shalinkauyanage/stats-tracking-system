// Validation of the workbook layout: formula errors, blank values, missing sheets/columns...
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleWorkbook, sampleSheets, makeXlsx } from '../test-helpers/xlsx.js';
import { parseWorkbookFile } from '../src/import/workbookLayout.js';
import { buildLegacyDataset } from '../src/logic/legacyBuilder.js';

const codes = (issues, severity) => issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const analyse = (edit, options) => {
  const { snapshot, issues } = parseWorkbookFile(sampleWorkbook(edit), 'sample.xlsx');
  const built = snapshot ? buildLegacyDataset(snapshot, options) : null;
  return { snapshot, built, issues: [...issues, ...(built ? built.issues : [])] };
};

test('a formula error in a data cell is detected, with its exact cell', () => {
  const { issues } = analyse((c) => { c['Driver Stats'].B3 = { error: '#REF!' }; });
  const err = issues.find((i) => i.code === 'formula_error');
  assert.ok(err);
  assert.equal(err.severity, 'error');
  assert.equal(err.details.cell, 'B3');
  assert.equal(err.details.sheet, 'Driver Stats');
  assert.equal(err.details.value, '#REF!');
  assert.equal(codes(issues, 'error').includes('bad_number'), false, 'the same cell is not reported twice');
});

test('formula errors are found in every sheet, including names and lap times', () => {
  const { issues } = analyse((c) => {
    c['Team Stats'].C4 = { error: '#DIV/0!' };
    c['Track Records'].B24 = { error: '#N/A' };
    c['Track Records'].C2 = { error: '#NAME?' };
  });
  const cells = issues.filter((i) => i.code === 'formula_error').map((i) => `${i.details.sheet}!${i.details.cell}`).sort();
  assert.deepEqual(cells, ['Team Stats!C4', 'Track Records!B24', 'Track Records!C2']);
});

test('an error cell never becomes a number: it is not read as zero', () => {
  const { built } = analyse((c) => { c['Driver Stats'].B3 = { error: '#REF!' }; });
  const alice = built.legacyDriverTotals.find((t) => t.driver_key === 'alice alpha');
  assert.equal(alice.wins, null);
});

test('blank count cells are reported, and counted as 0 by default', () => {
  const { built, issues } = analyse();
  const carl = built.legacyDriverTotals.find((t) => t.driver_key === 'carl gamma');
  assert.equal(carl.second_places, 0);
  const note = issues.find((i) => i.code === 'blank_counted_as_zero');
  assert.deepEqual(note.details.cells.map((c) => `${c.name}:${c.field}`), ['Carl Gamma:second_places']);
});

test('UNKNOWN POLICY: blank cells stay unknown (null), not zero', () => {
  const { built, issues } = analyse(undefined, { blankPolicy: 'unknown' });
  const carl = built.legacyDriverTotals.find((t) => t.driver_key === 'carl gamma');
  assert.equal(carl.second_places, null);
  assert.equal(carl.wins, 0, 'a typed zero is still zero');
  assert.ok(codes(issues).includes('blank_kept_unknown'));
  assert.ok(!codes(issues).includes('podium_sum_mismatch'), 'the podium check skips unknown values instead of failing');
});

test('M.P.S blanks stay unknown even with the default policy', () => {
  const { built } = analyse((c) => { c['Driver Stats'].J3 = null; });
  assert.equal(built.legacyDriverTotals.find((t) => t.driver_key === 'alice alpha').mps, null);
});

test('a blank driver name with data in the row is an error', () => {
  const { issues } = analyse((c) => { c['Driver Stats'].A5 = null; });
  const e = issues.find((i) => i.code === 'blank_name_with_data');
  assert.ok(e);
  assert.equal(e.details.row, 5);
});

test('a missing sheet blocks everything with a clear message', () => {
  const sheets = sampleSheets().filter((s) => s.name !== 'Team Stats');
  const { snapshot, issues } = parseWorkbookFile(makeXlsx(sheets), 'x.xlsx');
  assert.equal(snapshot, null);
  const e = issues.find((i) => i.code === 'missing_sheet');
  assert.match(e.message, /Team Stats/);
});

test('sheet names are matched ignoring case and spaces at the ends', () => {
  const sheets = sampleSheets().map((s) => ({ ...s, name: ` ${s.name.toUpperCase()} ` }));
  const { snapshot } = parseWorkbookFile(makeXlsx(sheets), 'x.xlsx');
  assert.ok(snapshot);
});

test('a required column that is missing is an error; an optional one stays UNKNOWN', () => {
  const required = analyse((c) => { for (const r of [1, 3, 4, 5, 6]) delete c['Driver Stats'][`E${r}`]; });
  assert.ok(required.issues.some((i) => i.code === 'missing_column' && i.details.field === 'podiums'));
  const optional = analyse((c) => { for (const r of [1, 3, 4, 5, 6]) delete c['Driver Stats'][`J${r}`]; }); // M.P.S column
  assert.ok(optional.issues.some((i) => i.code === 'missing_optional_column' && i.details.field === 'mps'));
  assert.equal(optional.built.legacyDriverTotals[0].mps, null);
  assert.equal(optional.issues.filter((i) => i.severity === 'error').length, 0);
});

test('columns are found by header text, in any order', () => {
  const { built } = analyse((c) => {
    // swap the "Points" (K) and "M.P.S" (J) columns
    for (const r of [1, 3, 4, 5, 6]) { const j = c['Driver Stats'][`J${r}`]; c['Driver Stats'][`J${r}`] = c['Driver Stats'][`K${r}`]; c['Driver Stats'][`K${r}`] = j; }
  });
  const alice = built.legacyDriverTotals.find((t) => t.driver_key === 'alice alpha');
  assert.equal(alice.points, 100);
  assert.equal(alice.mps, 10);
});

test('numbers stored as text are read, with a warning', () => {
  const { built, issues } = analyse((c) => { c['Driver Stats'].B3 = '2'; });
  assert.equal(built.legacyDriverTotals.find((t) => t.driver_key === 'alice alpha').wins, 2);
  assert.ok(issues.some((i) => i.code === 'number_stored_as_text' && i.details.cell === 'B3'));
});

test('words, decimals and negatives in number columns are errors', () => {
  const { issues } = analyse((c) => { c['Driver Stats'].B3 = 'lots'; c['Driver Stats'].C4 = 2.5; c['Driver Stats'].D5 = -1; });
  const bad = issues.filter((i) => i.code === 'bad_number');
  assert.equal(bad.length, 3);
});

test('a duplicate driver (even spelled with different spaces) is an error', () => {
  const { issues } = analyse((c) => { c['Driver Stats'].A6 = 'Alice   Alpha    Ferrari'; });
  assert.ok(codes(issues, 'error').includes('duplicate_driver'));
});

test('a duplicate Grand Prix column is an error', () => {
  const { issues } = analyse((c) => { c['Track Records'].C2 = 'bahrain '; });
  assert.ok(codes(issues, 'error').includes('duplicate_circuit'));
});

test('a winner who is not in Driver Stats is an error', () => {
  const { issues } = analyse((c) => { c['Track Records'].B4 = 'Zed Nobody'; });
  assert.ok(codes(issues, 'error').includes('unknown_driver_in_track_records'));
});

test('an unreadable lap time is an error; a colon-for-dot typo is only PENDING review', () => {
  const unreadable = analyse((c) => { c['Track Records'].B24 = 'Alice Alpha  fast'; });
  assert.ok(codes(unreadable.issues, 'error').includes('unreadable_lap_time'));
  const typo = analyse((c) => { c['Track Records'].B24 = 'Alice Alpha  \r\n01:10:000'; });
  assert.deepEqual(codes(typo.issues, 'error'), []);
  const pending = typo.issues.find((i) => i.code === 'lap_time_format_correction');
  assert.equal(pending.severity, 'pending_review');
  assert.equal(pending.details.suggested, '1:10.000');
  const rec = typo.built.circuitRecords.find((r) => r.record_type === 'race_fastest_lap' && r.circuit_key === 'bahrain');
  assert.equal(rec.lap_time_ms, null, 'the correction is not applied');
  assert.match(rec.original_text, /01:10:000/);
});

test('unexpected content outside the data area is a warning, never silently dropped', () => {
  const { issues } = analyse((c) => { c['Track Records'].AF40 = 'stray note'; c['Driver Stats'].T50 = 7; });
  const strays = issues.filter((i) => i.code === 'unexpected_content');
  assert.equal(strays.length, 2);
  assert.equal(strays[0].severity, 'warning');
});

test('an unknown extra column is ignored with a warning', () => {
  const { issues } = analyse((c) => { c['Driver Stats'].N1 = 'Favourite colour'; c['Driver Stats'].N3 = 'red'; });
  // N is also where team history starts, so put the new header BEFORE the history columns instead
  void issues;
  const second = analyse((c) => { c['Team Stats'].H1 = 'Constructors'; c['Team Stats'].I1 = 'Notes'; });
  assert.ok(second.issues.some((i) => i.code === 'unknown_column' && /Notes/.test(i.message)));
});

test('the REAL workbook still produces no layout problems and no blocking errors', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('../test-helpers/data.js');
  const { snapshot, issues } = parseWorkbookFile(fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx')), 'F1.xlsx');
  assert.deepEqual(issues, []);
  const built = buildLegacyDataset(snapshot);
  assert.equal(built.summary.issue_counts.error, 0);
  assert.equal(built.summary.issue_counts.pending_review, 2);
});
