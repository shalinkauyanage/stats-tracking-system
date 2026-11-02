// Builds small .xlsx files for tests (so broken workbooks can be created on demand).
// A cell value can be: a string, a number, null/undefined (blank), { error: '#REF!' }.
import { crc32 } from '../src/import/zipReader.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const cellRef = (col, row) => `${colLetter(col)}${row}`;

function sheetXml(cells) {
  const byRow = new Map();
  for (const [ref, value] of Object.entries(cells)) {
    if (value === null || value === undefined) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    const row = Number(m[2]);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push([ref, value]);
  }
  const colNum = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
    const cs = byRow.get(r).sort((a, b) => colNum(a[0]) - colNum(b[0])).map(([ref, v]) => {
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (v && typeof v === 'object' && v.error) return `<c r="${ref}" t="e"><v>${esc(v.error)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** sheets = [{ name, cells: { A1: 'text', B2: 5, C3: { error: '#REF!' } } }] */
export function makeXlsx(sheets) {
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'],
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
      sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.cells)]),
  ];
  return zip(files);
}

// ---------------------------------------------------------------------------------------
// A small, fully consistent sample league in the SAME layout as the real F1.xlsx.
// 3 teams, 4 drivers, 2 Grands Prix. No warnings are expected from it.
// ---------------------------------------------------------------------------------------
export function sampleSpec() {
  return {
    teams: [
      { name: 'Ferrari', wins: 2, podiums: 5, poles: 1, mps: 12, points: 150, dc: 1, cc: 1, top: ['Alice Alpha 2'] },
      { name: 'Mercedes', wins: 1, podiums: 3, poles: 1, mps: 8, points: 80, dc: 0, cc: 0, top: ['Bob Beta 1'] },
      { name: 'Red Bull Racing', wins: 0, podiums: 1, poles: 0, mps: 5, points: 30, dc: 0, cc: 0, top: [] },
    ],
    drivers: [
      { name: 'Alice Alpha', team: 'Ferrari', wins: 2, p2: 1, p3: 0, pod: 3, pole: 1, gc: 0, fl: 1, dnf: 0, mps: 10, pts: 100, dc: 1, cc: 1, history: ['Ferrari'] },
      { name: 'Bob Beta', team: 'Mercedes', wins: 1, p2: 1, p3: 1, pod: 3, pole: 1, gc: 0, fl: 0, dnf: 1, mps: 8, pts: 80, dc: 0, cc: 0, history: ['Mercedes'] },
      { name: 'Carl Gamma', team: 'Red Bull Racing', wins: 0, p2: null, p3: 1, pod: 1, pole: 0, gc: 0, fl: 0, dnf: 0, mps: 5, pts: 30, dc: 0, cc: 0, history: ['Red Bull Racing'] },
      { name: 'Dina Delta', team: 'Ferrari', wins: 0, p2: 1, p3: 1, pod: 2, pole: 0, gc: 0, fl: 0, dnf: 0, mps: 2, pts: 50, dc: 0, cc: 0, history: ['Mercedes', 'Ferrari'] },
    ],
    gps: [
      { label: 'Bahrain', winners: ['Alice Alpha', 'Bob Beta'], fl: 'Alice Alpha      \r\n01:10.000   ', pole: 'Bob Beta       01:09.500' },
      { label: 'Monaco', winners: ['Alice Alpha '], fl: 'Bob Beta  \r\n00:52.500', pole: 'Alice Alpha \r\n00:51.000' },
    ],
  };
}

/** Writes the spec into sheets using the real workbook layout. Returns the sheets array. */
export function sampleSheets(spec = sampleSpec()) {
  const track = { A1: 'F1', A2: 'Grand Prix', A3: 1, A22: 'Most Wins', A24: 'Fastest Lap', A26: 'Pole Time' };
  spec.gps.forEach((gp, i) => {
    const L = colLetter(i + 2);
    track[`${L}2`] = gp.label;
    gp.winners.forEach((w, r) => { track[`${L}${3 + r}`] = w; });
    track[`${L}22`] = '(=)';
    track[`${L}24`] = gp.fl;
    track[`${L}26`] = gp.pole;
  });

  const dHeaders = ['Name', 'Grand Prix', '2nd', '3rd', 'Podiums', 'Pole', 'P1 + FL + GP', 'Fatest Lap', 'D.N.F', 'M.P.S', 'Points', 'Drivers Championships', 'Constructors Championships'];
  const driverCells = {};
  dHeaders.forEach((h, i) => { driverCells[cellRef(i + 1, 1)] = h; });
  spec.drivers.forEach((d, i) => {
    const r = 3 + i;
    const values = [`${d.name}    ${d.team}`, d.wins, d.p2, d.p3, d.pod, d.pole, d.gc, d.fl, d.dnf, d.mps, d.pts, d.dc, d.cc];
    values.forEach((v, c) => { driverCells[cellRef(c + 1, r)] = v; });
    d.history.forEach((h, k) => { driverCells[cellRef(14 + k, r)] = h; });
  });

  const tHeaders = ['Team Name', 'Wins', 'Podiums', 'Pole Positions', 'M.P.S', 'Points', 'Drivers', 'Constructors'];
  const teamCells = {};
  tHeaders.forEach((h, i) => { teamCells[cellRef(i + 1, 1)] = h; });
  teamCells.G2 = 'CHAMPIONSHIPS'; teamCells.H2 = 'CHAMPIONSHIPS';
  spec.teams.forEach((t, i) => {
    const r = 3 + i;
    [t.name, t.wins, t.podiums, t.poles, t.mps, t.points, t.dc, t.cc].forEach((v, c) => { teamCells[cellRef(c + 1, r)] = v; });
    t.top.forEach((x, k) => { teamCells[cellRef(9 + k, r)] = x; });
  });

  return [
    { name: 'Track Records', cells: track },
    { name: 'Driver Stats', cells: driverCells },
    { name: 'Team Stats', cells: teamCells },
  ];
}

export const sampleWorkbook = (edit) => {
  const sheets = sampleSheets();
  if (edit) edit(Object.fromEntries(sheets.map((s) => [s.name, s.cells])), sheets);
  return makeXlsx(sheets);
};
