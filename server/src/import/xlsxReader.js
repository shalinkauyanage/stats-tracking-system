// Reads an .xlsx workbook into plain JavaScript objects. Read-only: nothing is ever
// written back to the file.
//
// Special case handled here: Excel "linked data types" (Geography, pictures...) look
// like #VALUE! to most readers. The real text is stored in xl/richData; we follow
// the chain  cell -> metadata -> rich value -> display text  to recover it.

import { openZip } from './zipReader.js';
import { parseXml, child, childrenNamed, descendants, decodeExcelEscapes } from './xml.js';
import { ImportFileError } from './errors.js';

/** "AD17" -> { col: 30, row: 17 }  */
export function parseCellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export function columnLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Text of a shared string / inline string, ignoring phonetic hints. */
function stringText(si) {
  let out = '';
  const walk = (node) => {
    for (const c of node.children) {
      if (c.name === 't') out += c.text;
      else if (c.name === 'r') walk(c);
      // 'rPh' (phonetic) and 'phoneticPr' are skipped on purpose
    }
  };
  walk(si);
  return decodeExcelEscapes(out);
}

function parseNumber(text) {
  const t = text.trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  const n = Number(t);
  return Number.isFinite(n) ? n : text;
}

function readRichValues(zip) {
  // returns a function vm -> { type, fields } | null
  if (!zip.has('xl/metadata.xml') || !zip.has('xl/richData/rdrichvalue.xml') || !zip.has('xl/richData/rdrichvaluestructure.xml')) {
    return () => null;
  }
  const structs = childrenNamed(parseXml(zip.read('xl/richData/rdrichvaluestructure.xml').toString('utf8')), 's')
    .map((s) => ({ type: s.attrs.t, keys: childrenNamed(s, 'k').map((k) => k.attrs.n) }));
  const values = childrenNamed(parseXml(zip.read('xl/richData/rdrichvalue.xml').toString('utf8')), 'rv')
    .map((rv) => ({ s: Number(rv.attrs.s), v: childrenNamed(rv, 'v').map((v) => v.text) }));

  const meta = parseXml(zip.read('xl/metadata.xml').toString('utf8'));
  const typeNames = childrenNamed(child(meta, 'metadataTypes'), 'metadataType').map((t) => t.attrs.name);
  const future = childrenNamed(meta, 'futureMetadata').find((f) => f.attrs.name === 'XLRICHVALUE');
  const rvbIndex = childrenNamed(future, 'bk').map((bk) => {
    const rvb = descendants(bk, 'rvb')[0];
    return rvb ? Number(rvb.attrs.i) : null;
  });
  const valueMeta = childrenNamed(child(meta, 'valueMetadata'), 'bk').map((bk) => child(bk, 'rc'));

  return (vm) => {
    const rc = valueMeta[Number(vm) - 1];
    if (!rc) return null;
    const typeName = typeNames[Number(rc.attrs.t) - 1];
    if (typeName && typeName !== 'XLRICHVALUE') return null;
    const rvIndex = rvbIndex[Number(rc.attrs.v)];
    const rv = values[rvIndex];
    if (!rv) return null;
    const struct = structs[rv.s];
    if (!struct) return null;
    const fields = {};
    struct.keys.forEach((k, i) => { fields[k] = rv.v[i] ?? ''; });
    return { type: struct.type, fields };
  };
}

/**
 * readXlsx(buffer) ->
 *   { sheets: [{ name, hidden, cells: Map("B2" -> cell) }], getSheet(name) }
 * cell = { ref, row, col, type: 'string'|'number'|'boolean'|'error',
 *          value, hasFormula, linked?: { type, text } }
 */
export function readXlsx(buffer, { maxCells = 1_000_000 } = {}) {
  const zip = openZip(buffer);
  if (!zip.has('[Content_Types].xml') || !zip.has('xl/workbook.xml')) {
    throw new ImportFileError('This ZIP file is not an Excel workbook (xl/workbook.xml is missing).', 'not_xlsx');
  }

  const workbook = parseXml(zip.read('xl/workbook.xml').toString('utf8'));
  const rels = new Map(
    childrenNamed(parseXml(zip.read('xl/_rels/workbook.xml.rels').toString('utf8')), 'Relationship')
      .map((r) => [r.attrs.Id, r.attrs.Target]),
  );

  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    for (const si of childrenNamed(parseXml(zip.read('xl/sharedStrings.xml').toString('utf8')), 'si')) shared.push(stringText(si));
  }
  const richValue = readRichValues(zip);

  let cellCount = 0;
  const sheets = [];
  for (const s of childrenNamed(child(workbook, 'sheets'), 'sheet')) {
    const target = rels.get(s.attrs.id);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const sheetXml = parseXml(zip.read(path).toString('utf8'));
    const cells = new Map();
    for (const row of childrenNamed(child(sheetXml, 'sheetData'), 'row')) {
      for (const c of childrenNamed(row, 'c')) {
        const pos = parseCellRef(c.attrs.r || '');
        if (!pos) continue;
        const vNode = child(c, 'v');
        const fNode = child(c, 'f');
        const isNode = child(c, 'is');
        const t = c.attrs.t || 'n';
        let type; let value;
        if (t === 's') { type = 'string'; value = shared[Number(vNode?.text)] ?? ''; }
        else if (t === 'str') { type = 'string'; value = decodeExcelEscapes(vNode?.text ?? ''); }
        else if (t === 'inlineStr') { type = 'string'; value = isNode ? stringText(isNode) : ''; }
        else if (t === 'b') { type = 'boolean'; value = vNode?.text === '1'; }
        else if (t === 'e') { type = 'error'; value = (vNode?.text ?? '#VALUE!').trim(); }
        else if (t === 'd') { type = 'string'; value = vNode?.text ?? ''; }
        else if (vNode && vNode.text.trim() !== '') { type = 'number'; value = parseNumber(vNode.text); if (typeof value === 'string') type = 'string'; }
        else continue; // a styled but empty cell
        const cell = { ref: c.attrs.r, row: pos.row, col: pos.col, type, value, hasFormula: Boolean(fNode) };
        if (c.attrs.vm) {
          const rich = richValue(c.attrs.vm);
          const text = rich && (rich.fields._DisplayString || rich.fields.Text);
          if (text) cell.linked = { type: rich.type, text };
        }
        cells.set(c.attrs.r, cell);
        if (++cellCount > maxCells) throw new ImportFileError('The workbook is too large to import.', 'too_large');
      }
    }
    sheets.push({ name: s.attrs.name, hidden: Boolean(s.attrs.state && s.attrs.state !== 'visible'), cells });
  }

  return {
    sheets,
    getSheet(name) {
      const wanted = String(name).trim().toLowerCase();
      return sheets.find((sh) => sh.name.trim().toLowerCase() === wanted) || null;
    },
  };
}
