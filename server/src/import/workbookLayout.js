// Turns a parsed workbook into the "snapshot" that legacyBuilder.js understands, and
// reports everything wrong with the layout: missing sheets/columns, formula errors,
// blank names, numbers stored as text, unexpected content.
//
// Columns and rows are found by their HEADER TEXT, not fixed positions, so the
// workbook can grow (more drivers, more teams, more GP columns) without breaking.
// Values are kept RAW; cleaning and cross-checks happen in legacyBuilder.js.

import crypto from 'node:crypto';
import path from 'node:path';
import { readXlsx, columnLetter } from './xlsxReader.js';
import { ImportFileError } from './errors.js';

export const SHEET_NAMES = { track: 'Track Records', drivers: 'Driver Stats', teams: 'Team Stats' };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const squash = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9+]/g, '');

const DRIVER_COLUMNS = {
  name: ['name', 'drivername', 'driver'],
  wins: ['grandprix', 'gp', 'wins', 'gpwins', 'grandprixwins'],
  second_places: ['2nd', 'secondplaces', 'p2'],
  third_places: ['3rd', 'thirdplaces', 'p3'],
  podiums: ['podiums', 'podium'],
  poles: ['pole', 'poles', 'polepositions'],
  p1_fl_gp: ['p1+fl+gp'],
  fastest_laps: ['fatestlap', 'fastestlap', 'fastestlaps', 'fl'],
  dnfs: ['dnf', 'dnfs'],
  mps: ['mps'],
  points: ['points', 'pts'],
  drivers_titles: ['driverschampionships', 'driverstitles', 'drivers'],
  constructors_titles: ['constructorschampionships', 'constructorstitles', 'constructors'],
};
const DRIVER_REQUIRED = ['name', 'wins', 'second_places', 'third_places', 'podiums', 'poles', 'points'];

const TEAM_COLUMNS = {
  name: ['teamname', 'team', 'name', 'constructor'],
  wins: ['wins', 'grandprix', 'gp'],
  podiums: ['podiums', 'podium'],
  poles: ['polepositions', 'pole', 'poles'],
  mps: ['mps'],
  points: ['points', 'pts'],
  drivers_titles: ['driverschampionships', 'driverstitles', 'drivers'],
  constructors_titles: ['constructorschampionships', 'constructorstitles', 'constructors'],
};
const TEAM_REQUIRED = ['name', 'wins', 'podiums', 'poles', 'points'];

const ERROR_LOOKING = /^#[A-Z0-9/!?]+$/;

export function parseWorkbookFile(buffer, fileName = 'workbook.xlsx') {
  const ext = path.extname(fileName).toLowerCase();
  if (ext && ext !== '.xlsx') {
    throw new ImportFileError(`Only .xlsx workbooks can be imported (got "${ext}"). In Excel use File > Save As > Excel Workbook.`, 'wrong_extension');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ImportFileError('The file is empty.', 'empty');
  if (buffer.length > MAX_FILE_BYTES) throw new ImportFileError('The file is larger than 25 MB.', 'too_large');

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const file = { name: path.basename(fileName), size: buffer.length, sha256 };
  const wb = readXlsx(buffer);
  const { snapshot, issues } = workbookToSnapshot(wb);
  if (snapshot) snapshot.source = { file: file.name, sha256, note: 'Raw values copied from the workbook. Nothing has been corrected.' };
  return { file, snapshot, issues };
}

export function workbookToSnapshot(wb) {
  const issues = [];
  const add = (severity, code, message, details = {}) => issues.push({ severity, code, message, details });

  const sheets = {};
  for (const [key, name] of Object.entries(SHEET_NAMES)) {
    sheets[key] = wb.getSheet(name);
    if (!sheets[key]) add('error', 'missing_sheet', `The workbook has no sheet called "${name}". Found: ${wb.sheets.map((s) => `"${s.name}"`).join(', ') || 'none'}.`, { sheet: name });
  }
  if (!sheets.track || !sheets.drivers || !sheets.teams) return { snapshot: null, issues };

  const consumed = { track: new Set(), drivers: new Set(), teams: new Set() };
  const cellAt = (sheet, row, col) => sheet.cells.get(`${columnLetter(col)}${row}`);

  // ---- reading helpers ----------------------------------------------------
  const errorCell = (sheetKey, cell) => {
    if (cell.linked) return false; // recovered linked data type: not a real error
    add('error', 'formula_error',
      `${SHEET_NAMES[sheetKey]}, cell ${cell.ref}: Excel error ${cell.value}. Fix the cell in Excel and save the file again.`,
      { sheet: SHEET_NAMES[sheetKey], cell: cell.ref, value: cell.value });
    return true;
  };

  const readCount = (sheetKey, cell) => {
    if (!cell) return null;
    consumed[sheetKey].add(cell.ref);
    if (cell.type === 'error') { errorCell(sheetKey, cell); return cell.value; }
    if (cell.type === 'string') {
      const t = cell.value.trim();
      if (t === '') return null;
      if (/^\d+$/.test(t)) {
        add('warning', 'number_stored_as_text', `${SHEET_NAMES[sheetKey]}, cell ${cell.ref}: the number "${t}" is stored as text. It was read as ${Number(t)}.`, { sheet: SHEET_NAMES[sheetKey], cell: cell.ref });
        return Number(t);
      }
      return cell.value;
    }
    return cell.value;
  };

  const readText = (sheetKey, cell) => {
    if (!cell) return null;
    consumed[sheetKey].add(cell.ref);
    if (cell.type === 'error') { errorCell(sheetKey, cell); return cell.linked ? cell.linked.text : null; }
    return cell.value;
  };

  const maxOf = (sheet, pick) => Math.max(0, ...[...sheet.cells.values()].map(pick));

  // ---- Driver Stats / Team Stats (same shape) -------------------------------
  function readTable(sheetKey, columnMap, required, nameField, extrasField) {
    const sheet = sheets[sheetKey];
    const label = SHEET_NAMES[sheetKey];
    const maxRow = maxOf(sheet, (c) => c.row);
    const maxCol = maxOf(sheet, (c) => c.col);

    let headerRow = null;
    for (let r = 1; r <= Math.min(10, maxRow); r++) {
      const c = cellAt(sheet, r, 1);
      if (c && c.type === 'string' && columnMap.name.includes(squash(c.value))) { headerRow = r; break; }
    }
    if (!headerRow) {
      add('error', 'header_not_found', `${label}: could not find the header row (a "Name" / "Team Name" cell in column A, within the first 10 rows).`, { sheet: label });
      return null;
    }

    // header text = row 1 (+ the line below it for two-line headers like "Drivers / CHAMPIONSHIPS")
    const colField = new Map();
    const headers = [];
    let lastHeaderCol = 0;
    for (let c = 1; c <= maxCol; c++) {
      const top = cellAt(sheet, headerRow, c);
      if (!top || top.type !== 'string') continue;
      const below = cellAt(sheet, headerRow + 1, c);
      const belowCountsAsHeader = below && below.type === 'string' && !cellAt(sheet, headerRow + 1, 1);
      const text = belowCountsAsHeader ? `${top.value} ${below.value}` : top.value;
      consumed[sheetKey].add(top.ref);
      if (belowCountsAsHeader) consumed[sheetKey].add(below.ref);
      lastHeaderCol = c;
      const field = Object.keys(columnMap).find((f) => columnMap[f].includes(squash(text)));
      if (!field) {
        add('warning', 'unknown_column', `${label}: column ${columnLetter(c)} "${String(top.value).trim()}" is not recognised and was ignored.`, { sheet: label, column: columnLetter(c) });
      } else if ([...colField.values()].includes(field)) {
        add('error', 'duplicate_column', `${label}: more than one column means "${field}" (column ${columnLetter(c)}).`, { sheet: label, column: columnLetter(c) });
      } else {
        colField.set(c, field);
        headers.push(top.value);
      }
    }
    for (const field of Object.keys(columnMap)) {
      if ([...colField.values()].includes(field)) continue;
      if (required.includes(field)) {
        add('error', 'missing_column', `${label}: the required column for "${field}" is missing (expected a header such as "${columnMap[field][0]}").`, { sheet: label, field });
      } else {
        add('warning', 'missing_optional_column', `${label}: no column for "${field}". Those values will stay UNKNOWN (not zero).`, { sheet: label, field });
      }
    }

    const rows = [];
    for (let r = headerRow + 2; r <= maxRow; r++) {
      const nameCell = cellAt(sheet, r, 1);
      const nameValue = nameCell ? readText(sheetKey, nameCell) : null;
      const hasName = typeof nameValue === 'string' ? nameValue.trim() !== '' : nameValue !== null && nameValue !== undefined;
      const others = [...sheet.cells.values()].filter((c) => c.row === r && c.col > 1);
      if (!hasName) {
        if (others.length) add('error', 'blank_name_with_data', `${label}, row ${r}: there is data but no name in column A.`, { sheet: label, row: r });
        continue;
      }
      const row = { row: r, [nameField]: nameCell.value };
      for (const [col, field] of colField) {
        if (field === 'name') continue;
        row[field] = readCount(sheetKey, cellAt(sheet, r, col));
      }
      const extras = [];
      for (let c = lastHeaderCol + 1; c <= maxCol; c++) {
        const cell = cellAt(sheet, r, c);
        if (cell && !(cell.type === 'string' && cell.value.trim() === '')) extras.push(readText(sheetKey, cell));
      }
      row[extrasField] = extras;
      rows.push(row);
    }
    // mark every header-area cell as consumed
    for (let r = 1; r <= headerRow + 1; r++) for (let c = 1; c <= maxCol; c++) { const x = cellAt(sheet, r, c); if (x) consumed[sheetKey].add(x.ref); }
    return { headers, rows };
  }

  const driverTable = readTable('drivers', DRIVER_COLUMNS, DRIVER_REQUIRED, 'name_raw', 'team_history_raw');
  const teamTable = readTable('teams', TEAM_COLUMNS, TEAM_REQUIRED, 'team_raw', 'top_drivers_raw');

  // ---- Track Records ----------------------------------------------------------
  const track = sheets.track;
  const tMaxRow = maxOf(track, (c) => c.row);
  const tMaxCol = maxOf(track, (c) => c.col);
  const findRow = (text) => {
    for (let r = 1; r <= tMaxRow; r++) {
      const c = cellAt(track, r, 1);
      if (c && c.type === 'string' && squash(c.value) === squash(text)) return r;
    }
    return null;
  };
  const labelRow = findRow('Grand Prix');
  const mostRow = findRow('Most Wins');
  const flRow = findRow('Fastest Lap');
  const poleRow = findRow('Pole Time');
  let trackColumns = null;
  if (!labelRow) {
    add('error', 'header_not_found', 'Track Records: could not find the "Grand Prix" row in column A.', { sheet: SHEET_NAMES.track });
  } else {
    if (!flRow) add('warning', 'missing_row', 'Track Records: no "Fastest Lap" row. Fastest-lap records stay unknown.', { row: 'Fastest Lap' });
    if (!poleRow) add('warning', 'missing_row', 'Track Records: no "Pole Time" row. Pole records stay unknown.', { row: 'Pole Time' });
    const winnersEnd = (mostRow ?? flRow ?? poleRow ?? tMaxRow + 1) - 1;
    for (let r = 1; r <= tMaxRow; r++) { const a = cellAt(track, r, 1); if (a) consumed.track.add(a.ref); } // column A = row labels

    trackColumns = [];
    for (let c = 2; c <= tMaxCol; c++) {
      const L = columnLetter(c);
      const labelCell = cellAt(track, labelRow, c);
      const winnerCells = [];
      for (let r = labelRow + 1; r <= winnersEnd; r++) { const x = cellAt(track, r, c); if (x) winnerCells.push(x); }
      const flCell = flRow ? cellAt(track, flRow, c) : null;
      const poleCell = poleRow ? cellAt(track, poleRow, c) : null;
      const mostCell = mostRow ? cellAt(track, mostRow, c) : null;
      const flagCell = labelRow > 1 ? cellAt(track, labelRow - 1, c) : null;
      if (!labelCell && !winnerCells.length && !flCell && !poleCell) continue; // an unused column

      let labelKind = null; let label = null;
      if (labelCell) {
        consumed.track.add(labelCell.ref);
        if (labelCell.linked) { labelKind = 'linked_entity'; label = labelCell.linked.text; }
        else if (labelCell.type === 'string') { labelKind = 'plain_text'; label = labelCell.value; }
        else if (labelCell.type === 'error') errorCell('track', labelCell);
        else { labelKind = 'plain_text'; label = String(labelCell.value); }
      }
      let flagText = null;
      if (flagCell) { consumed.track.add(flagCell.ref); flagText = flagCell.linked ? flagCell.linked.text : (flagCell.type === 'string' ? flagCell.value : null); }

      const winners = winnerCells.map((x) => {
        consumed.track.add(x.ref);
        if (x.type === 'error') errorCell('track', x);
        return { row: x.row, raw: x.value };
      });
      const raw = (cell) => { if (!cell) return null; consumed.track.add(cell.ref); if (cell.type === 'error') errorCell('track', cell); return cell.value; };
      trackColumns.push({
        column: L, label, label_kind: labelKind, flag_text: flagText, winners,
        most_wins_raw: raw(mostCell), fastest_lap_raw: raw(flCell), pole_time_raw: raw(poleCell),
      });
    }
  }

  // ---- errors and strays anywhere else ------------------------------------------
  let formulaCellsUsed = 0;
  for (const key of Object.keys(consumed)) {
    const sheet = sheets[key];
    const stray = [];
    for (const cell of sheet.cells.values()) {
      if (consumed[key].has(cell.ref)) {
        if (cell.hasFormula && !cell.linked) formulaCellsUsed += 1;
        continue;
      }
      if (cell.type === 'string' && cell.value.trim() === '') continue;
      if (cell.type === 'error' && !cell.linked) {
        add('warning', 'formula_error_outside_data', `${SHEET_NAMES[key]}, cell ${cell.ref}: Excel error ${cell.value} (outside the data the importer reads).`, { sheet: SHEET_NAMES[key], cell: cell.ref });
      } else if (!cell.linked) stray.push(cell.ref);
    }
    if (stray.length) {
      add('warning', 'unexpected_content', `${SHEET_NAMES[key]}: ${stray.length} cell(s) hold content the importer does not use (${stray.slice(0, 6).join(', ')}${stray.length > 6 ? ', …' : ''}). They were ignored.`, { sheet: SHEET_NAMES[key], cells: stray.slice(0, 50), count: stray.length });
    }
  }
  if (formulaCellsUsed > 0) {
    add('info', 'cached_formula_values', `${formulaCellsUsed} imported cell(s) contain formulas. The values Excel last saved were used. Open and save the workbook in Excel first if they might be out of date.`, { count: formulaCellsUsed });
  }

  if (!driverTable || !teamTable || !trackColumns) return { snapshot: null, issues };

  const headerErrorCells = [...track.cells.values()].filter((c) => c.type === 'error' && c.row <= 2).length;
  return {
    snapshot: {
      source: null,
      track_records: { columns: trackColumns, excel_error_cells_in_header_rows: headerErrorCells },
      driver_stats: driverTable,
      team_stats: teamTable,
    },
    issues,
  };
}
