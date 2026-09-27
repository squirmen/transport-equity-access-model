import assert from 'node:assert/strict';
import test from 'node:test';

import { nearestCity } from '../../web/js/cities.js';

const cities = [
  { slug: 'auckland', bbox: [174.6, -37.1, 175.0, -36.7] },
  { slug: 'hamilton', bbox: [175.2, -37.85, 175.35, -37.72] },
];

test('a point inside an urban area picks it', () => {
  assert.equal(nearestCity(cities, 174.76, -36.85).slug, 'auckland');
});

test('a point just outside picks the nearest, and one far away picks none', () => {
  assert.equal(nearestCity(cities, 175.4, -37.8).slug, 'hamilton');
  assert.equal(nearestCity(cities, 172.6, -43.5), null);
});
