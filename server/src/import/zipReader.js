// A tiny, dependency-free ZIP reader (an .xlsx file is a ZIP of XML files).
// It only reads - it can never write or change the file.
// Safety limits protect against damaged files and "zip bombs".

import zlib from 'node:zlib';
import { ImportFileError } from './errors.js';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function openZip(buffer, { maxEntryBytes = 50 * 1024 * 1024, maxEntries = 5000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== SIG_LOCAL) {
    throw new ImportFileError('This is not an .xlsx file (it is not a ZIP package). Save the workbook from Excel as "Excel Workbook (*.xlsx)".', 'not_zip');
  }

  // find the "end of central directory" record, searching backwards
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportFileError('The file looks damaged or incomplete (no ZIP directory found).', 'corrupt');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const dirOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || dirOffset === 0xffffffff) {
    throw new ImportFileError('ZIP64 files are not supported.', 'unsupported');
  }
  if (entryCount > maxEntries) throw new ImportFileError('The file contains too many parts.', 'too_large');

  const entries = new Map();
  let p = dirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new ImportFileError('The file looks damaged (bad ZIP directory).', 'corrupt');
    }
    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    entries.set(name, { name, flags, method, crc, compressedSize, size, localOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }

  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    /** Returns the file's bytes (a Buffer) or throws. */
    read(name) {
      const e = entries.get(name);
      if (!e) throw new ImportFileError(`The workbook is missing its "${name}" part.`, 'not_xlsx');
      if (e.flags & 1) throw new ImportFileError('Password-protected workbooks cannot be imported. Remove the password in Excel first.', 'encrypted');
      if (e.size > maxEntryBytes) throw new ImportFileError(`"${name}" is unreasonably large.`, 'too_large');
      const o = e.localOffset;
      if (o + 30 > buffer.length || buffer.readUInt32LE(o) !== SIG_LOCAL) {
        throw new ImportFileError('The file looks damaged (bad entry header).', 'corrupt');
      }
      const start = o + 30 + buffer.readUInt16LE(o + 26) + buffer.readUInt16LE(o + 28);
      const raw = buffer.subarray(start, start + e.compressedSize);
      let data;
      if (e.method === 0) data = Buffer.from(raw);
      else if (e.method === 8) {
        try { data = zlib.inflateRawSync(raw, { maxOutputLength: maxEntryBytes }); }
        catch { throw new ImportFileError(`"${name}" could not be unpacked; the file looks damaged.`, 'corrupt'); }
      } else throw new ImportFileError(`"${name}" uses an unsupported compression method.`, 'unsupported');
      if (crc32(data) !== e.crc) throw new ImportFileError(`"${name}" failed its integrity check; the file looks damaged.`, 'corrupt');
      return data;
    },
  };
}
