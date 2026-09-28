import assert from 'node:assert/strict';
import test from 'node:test';

import { CONCENTRATED, concentrationBreaks, concentrationClasses, whereTheyLive } from '../../web/js/equity.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} is not near ${b}`);

test('classes are set against the group share across the whole place', () => {
  const breaks = concentrationBreaks(0.2);
  assert.deepEqual(breaks.map((b) => Math.round(b * 100)), [10, 20, 30, 40]);
  // Shares of 5%, 15%, 25%, 35% and 50% fall one to a class.
  const pop = Float32Array.from([100, 100, 100, 100, 100]);
  const older = Float32Array.from([5, 15, 25, 35, 50]);
  assert.deepEqual([...concentrationClasses(older, pop, breaks)], [0, 1, 2, 3, 4]);
});

test('a share exactly on an edge goes up a class', () => {
  const classes = concentrationClasses(Float32Array.from([20]), Float32Array.from([100]), concentrationBreaks(0.2));
  assert.equal(classes[0], 2);
});

test('empty hexagons, and ones left off, are not drawn', () => {
  const pop = Float32Array.from([0, 100, 100]);
  const older = Float32Array.from([0, 30, 30]);
  const keep = [true, true, false];
  assert.deepEqual([...concentrationClasses(older, pop, concentrationBreaks(0.2), keep)], [-1, 3, -1]);
});

test('concentrations are counted, and whether they can reach the service', () => {
  // Place share 20%. The first hexagon is 40% older people and misses the
  // standard; the second is 10% and meets it.
  const pop = Float32Array.from([100, 300]);
  const older = Float32Array.from([40, 30]);
  const gaps = Float32Array.from([0.5, 0]);
  const r = whereTheyLive(older, pop, gaps);
  close(r.share, 70 / 400);
  close(r.concentrated, 40);
  close(r.concentratedShare, 40 / 70);
  close(r.concentratedMissingRate, 1);
  close(r.missingRate, 40 / 70);
});

test('a group spread evenly has no concentrations', () => {
  const pop = Float32Array.from([100, 100]);
  const r = whereTheyLive(Float32Array.from([20, 20]), pop, Float32Array.from([0, 0]));
  assert.ok(CONCENTRATED > 1);
  close(r.concentrated, 0);
  assert.ok(Number.isNaN(r.concentratedMissingRate));
});
