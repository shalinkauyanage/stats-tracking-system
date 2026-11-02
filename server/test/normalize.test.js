import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseSpaces, nameKey, splitDriverAndTeam, splitNameAndNumber } from '../src/logic/normalize.js';

test('collapseSpaces removes extra spaces and line breaks', () => {
  assert.equal(collapseSpaces('  Max   Verstappen \n'), 'Max Verstappen');
  assert.equal(collapseSpaces(null), '');
});

test('nameKey ignores case, spacing and accents so duplicates are caught', () => {
  assert.equal(nameKey('Nico  Hülkenberg'), nameKey('nico hulkenberg'));
});

test('splitDriverAndTeam separates the name from the team in one cell', () => {
  const teams = ['Red Bull Racing', 'Ferrari', 'Aston Martin', 'Alpine'];
  assert.deepEqual(splitDriverAndTeam('Max Verstappen    Red Bull Racing', teams), { driver: 'Max Verstappen', team: 'Red Bull Racing' });
  assert.deepEqual(splitDriverAndTeam('Oliver Bearman         Aston Martin', teams), { driver: 'Oliver Bearman', team: 'Aston Martin' });
});

test('splitDriverAndTeam falls back to double spaces when the team is unknown', () => {
  assert.deepEqual(splitDriverAndTeam('Some Driver   Mystery Team', []), { driver: 'Some Driver', team: 'Mystery Team' });
  assert.deepEqual(splitDriverAndTeam('Solo Name', []), { driver: 'Solo Name', team: null });
});

test('splitNameAndNumber reads "Max Verstappen 42   "', () => {
  assert.deepEqual(splitNameAndNumber('Max Verstappen 42   '), { name: 'Max Verstappen', number: 42 });
  assert.deepEqual(splitNameAndNumber('Oscar Piastri          2'), { name: 'Oscar Piastri', number: 2 });
});
