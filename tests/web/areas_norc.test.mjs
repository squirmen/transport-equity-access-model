import test from 'node:test';
import assert from 'node:assert/strict';
import { areaCsv } from '../../web/js/areas.js';

test('the area CSV carries a NORC column only when suburbs are flagged', () => {
  const base = { name: 'Milford', people: 900, missing: 100, share: 0.11, minutesShort: 2, nzdep: 3, residents: 3000, ofResidents: 0.3 };
  const flagged = areaCsv([{ ...base, norc: true }, { ...base, name: 'Takapuna', norc: false }], 'sa2').trim().split('\n');
  assert.equal(flagged[0].split(',').at(-1), 'norc');
  assert.equal(flagged[1].split(',').at(-1), '1');
  assert.equal(flagged[2].split(',').at(-1), '0');
  const plain = areaCsv([base], 'sa2').split('\n')[0];
  assert.ok(!plain.includes('norc'));
});
