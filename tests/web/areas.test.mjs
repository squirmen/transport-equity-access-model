import assert from 'node:assert/strict';
import test from 'node:test';

import { areaCsv, areaTable, sortAreas } from '../../web/js/areas.js';

const f32 = (v) => Float32Array.from(v);

test('areas add up people, those missing out, and how far short they are', () => {
  const rows = areaTable([0, 0, 1, null], f32([0, 0.5, 0.25, 1]), f32([10, 10, 5, 99]), f32([2, 10, 5, 1]), 20);
  const a = rows.find((r) => r.area === 0);
  assert.equal(a.people, 20);
  assert.equal(a.missing, 10);
  assert.equal(a.share, 0.5);
  assert.equal(a.minutesShort, 10);
  assert.equal(a.nzdep, 6);
  assert.equal(rows.length, 2, 'a hexagon with no area is left out');
});

test('sorting by share leaves out areas too small to mean much', () => {
  const rows = [
    { area: 'big', people: 1000, missing: 100, share: 0.1 },
    { area: 'tiny', people: 5, missing: 5, share: 1 },
  ];
  assert.deepEqual(sortAreas(rows, 'share').map((r) => r.area), ['big']);
  assert.deepEqual(sortAreas(rows, 'missing').map((r) => r.area), ['big', 'tiny']);
});

test('the CSV quotes names with commas', () => {
  const text = areaCsv([{ name: 'Mt Eden, East', people: 10, missing: 2, share: 0.2, minutesShort: 7.25, nzdep: 3 }], 'area');
  assert.equal(text.split('\n')[1], '"Mt Eden, East",10,2,0.200,7.3,3.0');
});
