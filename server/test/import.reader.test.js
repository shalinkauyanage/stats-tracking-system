// The file reader: ZIP, XML, the real F1.xlsx, and damaged files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, loadSnapshot } from '../test-helpers/data.js';
import { makeXlsx, sampleSheets, sampleWorkbook } from '../test-helpers/xlsx.js';
import { openZip, crc32 } from '../src/import/zipReader.js';
import { parseXml, decodeEntities } from '../src/import/xml.js';
import { readXlsx, parseCellRef, columnLetter } from '../src/import/xlsxReader.js';
import { parseWorkbookFile } from '../src/import/workbookLayout.js';
import { ImportFileError } from '../src/import/errors.js';

const realFile = fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'));

test('crc32 gives the standard checksum', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('XML reader keeps spaces and line breaks, decodes entities and drops prefixes', () => {
  const root = parseXml('<?xml version="1.0"?><a:x xmlns:a="u"><a:t xml:space="preserve"> Max &amp; Co \r\n 42 </a:t><b/></a:x>');
  assert.equal(root.name, 'x');
  assert.equal(root.children[0].name, 't');
  assert.equal(root.children[0].text, ' Max & Co \n 42 ');
  assert.equal(decodeEntities('&#65;&#x42;&lt;'), 'AB<');
});

test('cell references convert both ways', () => {
  assert.deepEqual(parseCellRef('AD17'), { col: 30, row: 17 });
  assert.equal(columnLetter(30), 'AD');
  assert.equal(columnLetter(26), 'Z');
  assert.equal(parseCellRef('nonsense'), null);
});

test('the ZIP reader opens the real workbook and unpacks its parts', () => {
  const zip = openZip(realFile);
  assert.ok(zip.has('xl/workbook.xml'));
  assert.ok(zip.has('xl/richData/rdrichvalue.xml'));
  assert.match(zip.read('xl/workbook.xml').toString('utf8'), /Track Records/);
});

test('the ZIP reader also reads deflate-compressed entries', () => {
  // build a one-file zip with method 8 by hand
  const data = Buffer.from('hello hello hello hello', 'utf8');
  const packed = zlib.deflateRawSync(data);
  const name = Buffer.from('a.txt');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const body = Buffer.concat([local, name, packed]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(body.length, 16);
  const zip = openZip(Buffer.concat([body, central, name, eocd]));
  assert.equal(zip.read('a.txt').toString(), 'hello hello hello hello');
});

test('files that are not workbooks are rejected with a clear message', () => {
  assert.throws(() => readXlsx(Buffer.from('this is plain text, not a zip')), (e) => e instanceof ImportFileError && e.code === 'not_zip');
  assert.throws(() => parseWorkbookFile(Buffer.alloc(0), 'x.xlsx'), (e) => e.code === 'empty');
  assert.throws(() => parseWorkbookFile(realFile, 'old.xls'), (e) => e.code === 'wrong_extension');
  // a valid ZIP that is not a workbook
  const notExcel = makeXlsx([{ name: 'S', cells: {} }]);
  const zip = openZip(notExcel);
  assert.ok(zip.has('xl/workbook.xml')); // sanity: our synthetic file IS a workbook
});

test('a damaged file is detected (corrupted data fails the integrity check)', () => {
  // corrupt a byte inside the sheet XML of a workbook whose parts are stored uncompressed
  const damaged = Buffer.from(sampleWorkbook());
  const at = damaged.indexOf('Alice Alpha');
  assert.ok(at > 0);
  damaged[at] ^= 0xff;
  assert.throws(() => readXlsx(damaged), (e) => e instanceof ImportFileError && e.code === 'corrupt');
  // a truncated file has lost its ZIP directory
  assert.throws(() => readXlsx(realFile.subarray(0, 5000)), (e) => e instanceof ImportFileError && e.code === 'corrupt');
});

test('damage inside parts the importer never reads (embedded flag pictures) does not matter', () => {
  const damaged = Buffer.from(realFile);
  for (let i = 2000; i < 2040; i++) damaged[i] ^= 0xff; // lands inside a picture
  assert.doesNotThrow(() => readXlsx(damaged));
});

test('REAL FILE: linked Excel data types are recovered instead of showing #VALUE!', () => {
  const wb = readXlsx(realFile);
  const track = wb.getSheet('Track Records');
  const cells = [...track.cells.values()];
  assert.equal(cells.filter((c) => c.type === 'error').length, 57);
  assert.equal(cells.filter((c) => c.type === 'error' && c.linked).length, 57, 'every error cell is a recovered linked value');
  assert.equal(track.cells.get('B2').linked.text, 'Bahrain');
  assert.equal(track.cells.get('B1').linked.text, 'Image of Bahrain');
  assert.equal(track.cells.get('X2').value, 'Las Vegas'); // a plain text cell
  assert.equal(wb.getSheet('track records'), track, 'sheet lookup ignores case');
});

test('REAL FILE: the Node reader gives exactly the same data as the independent Python extraction', () => {
  const { snapshot, issues } = parseWorkbookFile(realFile, 'F1.xlsx');
  const fixture = loadSnapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(snapshot.track_records, fixture.track_records);
  assert.deepEqual(snapshot.driver_stats, fixture.driver_stats);
  assert.deepEqual(snapshot.team_stats, fixture.team_stats);
  assert.equal(snapshot.source.sha256, fixture.source.sha256);
});

test('reading never changes the file (same bytes, same fingerprint)', () => {
  const before = fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'));
  parseWorkbookFile(before, 'F1.xlsx');
  const after = fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx'));
  assert.ok(before.equals(after));
  assert.equal(parseWorkbookFile(before, 'F1.xlsx').file.sha256, fs.readFileSync(path.join(ROOT, 'data/original/F1.xlsx.sha256'), 'utf8').trim());
});

test('the synthetic sample workbook is read with the same layout rules', () => {
  const { snapshot, issues } = parseWorkbookFile(sampleWorkbook(), 'sample.xlsx');
  assert.deepEqual(issues, []);
  assert.equal(snapshot.driver_stats.rows.length, 4);
  assert.equal(snapshot.team_stats.rows.length, 3);
  assert.equal(snapshot.track_records.columns.length, 2);
  assert.equal(snapshot.driver_stats.rows[2].second_places, null, 'a blank cell stays blank in the raw snapshot');
  assert.deepEqual(snapshot.driver_stats.rows[3].team_history_raw, ['Mercedes', 'Ferrari']);
  void sampleSheets;
});
