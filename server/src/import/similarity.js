// "Is this new name probably an existing one, typed a little differently?"
// Used to stop duplicates such as "Max Verstapen" next to "Max Verstappen".

export function editDistance(a, b) {
  const m = a.length; const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const squash = (key) => key.replace(/[\s.\-']/g, '');
const sortedWords = (key) => key.split(' ').filter(Boolean).sort().join(' ');

/** Both arguments are already "name keys" (lower case, single spaces, no accents). */
export function similarNames(keyA, keyB) {
  if (keyA === keyB) return false;                        // identical = the same record, not "similar"
  if (squash(keyA) === squash(keyB)) return true;         // spacing / hyphen / dot differences
  if (sortedWords(keyA) === sortedWords(keyB)) return true; // "Verstappen Max" vs "Max Verstappen"
  const shortest = Math.min(keyA.length, keyB.length);
  if (shortest < 6) return false;                          // too short to judge by spelling
  const allowed = shortest >= 10 ? 2 : 1;
  return editDistance(keyA, keyB) <= allowed;
}
