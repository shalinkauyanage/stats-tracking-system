import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLapTime, formatLapTime, splitNameAndLapTime } from '../src/logic/lapTime.js';

test('a normal lap time is read correctly', () => {
  const r = parseLapTime('01:10.153');
  assert.equal(r.status, 'ok');
  assert.equal(r.ms, 70153);
  assert.equal(r.text, '1:10.153');
  assert.equal(parseLapTime('00:50.295').ms, 50295);
});

test('formatLapTime pads seconds and milliseconds', () => {
  assert.equal(formatLapTime(61005), '1:01.005');
});

test('colon instead of dot is flagged for review and NOT applied', () => {
  const r = parseLapTime('01:11:775');
  assert.equal(r.status, 'needs_review');
  assert.equal(r.ms, null);               // not applied
  assert.equal(r.original, '01:11:775');  // original kept
  assert.equal(r.suggestedMs, 71775);
  assert.equal(r.suggestedText, '1:11.775');
});

test('impossible or blank times are not accepted', () => {
  assert.equal(parseLapTime('01:75.000').status, 'invalid');
  assert.equal(parseLapTime('fast').status, 'invalid');
  assert.equal(parseLapTime('   ').status, 'missing');
  assert.equal(parseLapTime(undefined).status, 'missing');
});

test('splitNameAndLapTime handles spaces and line breaks', () => {
  assert.deepEqual(splitNameAndLapTime('Max Verstappen       01:10.153            '), { name: 'Max Verstappen', timeText: '01:10.153' });
  assert.deepEqual(splitNameAndLapTime('Kimi Antonelli      \n01:10.092            '), { name: 'Kimi Antonelli', timeText: '01:10.092' });
  assert.deepEqual(splitNameAndLapTime('Lando Norris      \n01:11:775      '), { name: 'Lando Norris', timeText: '01:11:775' });
});
