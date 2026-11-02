// Cleaning of names that come from the Excel workbook.

/** "Max   Verstappen \n" -> "Max Verstappen" */
export function collapseSpaces(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * A "key" is what we compare to detect duplicates:
 * lower case, single spaces, accents removed ("Hülkenberg" == "hulkenberg").
 */
export function nameKey(value) {
  return collapseSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * The Driver Stats sheet stores "Max Verstappen    Red Bull Racing" in ONE cell.
 * We use the list of known team names to split it safely, and fall back to
 * "two or more spaces" if no team matches.
 */
export function splitDriverAndTeam(raw, teamNames = []) {
  const text = collapseSpaces(raw);
  const byLongestFirst = teamNames.map(collapseSpaces).sort((a, b) => b.length - a.length);
  for (const team of byLongestFirst) {
    if (text.toLowerCase().endsWith(' ' + team.toLowerCase())) {
      return { driver: text.slice(0, text.length - team.length).trim(), team };
    }
  }
  const parts = String(raw ?? '').trim().split(/\s{2,}/);
  if (parts.length >= 2) {
    return { driver: collapseSpaces(parts[0]), team: collapseSpaces(parts.slice(1).join(' ')) };
  }
  return { driver: text, team: null };
}

/** "Max Verstappen 42   " -> { name: "Max Verstappen", number: 42 } (Team Stats top drivers) */
export function splitNameAndNumber(raw) {
  const text = collapseSpaces(raw);
  const match = /^(.*\S)\s+(\d+)$/.exec(text);
  if (!match) return { name: text, number: null };
  return { name: match[1], number: Number(match[2]) };
}
