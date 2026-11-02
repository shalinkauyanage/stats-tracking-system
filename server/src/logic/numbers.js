// Helpers for numbers typed into forms or read from a spreadsheet.
// Golden rule of this project: a BLANK is "unknown" (null). It is never silently 0.

/**
 * Turns a form/JSON value into a whole number >= 0, or null for blank.
 * Returns { ok: true, value } or { ok: false }.
 *   ''  / null / undefined -> { ok: true, value: null }   (unknown)
 *   0   / '0'              -> { ok: true, value: 0 }      (a real zero)
 *   '12' / 12              -> { ok: true, value: 12 }
 *   -1 / 2.5 / 'abc'       -> { ok: false }
 */
export function parseNullableCount(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return { ok: true, value: null };
    if (!/^\d+$/.test(text)) return { ok: false };
    return { ok: true, value: Number(text) };
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return { ok: true, value };
  }
  return { ok: false };
}

/** Adds up only the KNOWN values. If nothing is known, the answer is null (not 0). */
export function sumKnown(values) {
  let total = 0;
  let anyKnown = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    total += v;
    anyKnown = true;
  }
  return anyKnown ? total : null;
}

/** MySQL returns TINYINT(1) as 0/1; tests may use true/false. Treat both the same. */
export function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1';
}

export function isId(value) {
  return Number.isInteger(value) && value > 0;
}
