import { collapseSpaces } from './normalize.js';

/** 70153 -> "1:10.153" */
export function formatLapTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Reads a lap time such as "01:10.153".
 *   status 'ok'           -> ms and text are filled in
 *   status 'needs_review' -> looks like a typo (e.g. "01:11:775", colon instead of dot).
 *                            ms stays null; the suggested fix is returned but NOT applied.
 *   status 'missing' / 'invalid'
 */
export function parseLapTime(input) {
  const text = collapseSpaces(input);
  if (text === '') return { status: 'missing', ms: null, text: null, original: input ?? null };

  let match = /^(\d{1,2}):(\d{2})\.(\d{3})$/.exec(text);
  if (match) {
    const [minutes, seconds, millis] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (seconds > 59) return { status: 'invalid', ms: null, text: null, original: text };
    const ms = minutes * 60000 + seconds * 1000 + millis;
    return { status: 'ok', ms, text: formatLapTime(ms), original: text };
  }

  match = /^(\d{1,2}):(\d{2}):(\d{3})$/.exec(text);
  if (match) {
    const [minutes, seconds, millis] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (seconds <= 59) {
      const suggestedMs = minutes * 60000 + seconds * 1000 + millis;
      return {
        status: 'needs_review',
        ms: null,
        text: null,
        original: text,
        reason: 'colon_instead_of_dot',
        suggestedMs,
        suggestedText: formatLapTime(suggestedMs),
      };
    }
  }
  return { status: 'invalid', ms: null, text: null, original: text };
}

/**
 * Track Records cells hold "Max Verstappen       01:10.153" (sometimes with a line break).
 * Returns { name, timeText } with spaces cleaned up, or { name: text, timeText: null }.
 */
export function splitNameAndLapTime(raw) {
  const text = collapseSpaces(raw);
  const match = /^(.*?)\s*(\d{1,2}:\d{2}[.:]\d{3})$/.exec(text);
  if (!match) return { name: text, timeText: null };
  return { name: match[1].trim(), timeText: match[2] };
}
