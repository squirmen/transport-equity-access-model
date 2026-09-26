import assert from 'node:assert/strict';
import test from 'node:test';

import { byGroup, concentrationIndex, fgt, leaning, pricedOut, shortfalls } from '../../web/js/equity.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} is not near ${b}`);

test('somewhere that meets the standard has no shortfall', () => {
  const gaps = shortfalls(Float32Array.from([10, 20, 30]), 20);
  assert.deepEqual([...gaps], [0, 0, 0.5]);
});

test('nowhere to go at all counts as the routed limit, not as missing data', () => {
  // Leaving it out would flatter the result exactly where things are worst.
  const gaps = shortfalls(Float32Array.from([NaN]), 20, 60);
  close(gaps[0], 2);
});

test('the headcount and the depth answer different questions', () => {
  // Two places miss a 20-minute standard: one by 2 minutes, one by 40.
  const times = Float32Array.from([20, 22, 60]);
  const weights = Float32Array.from([100, 100, 100]);
  const out = fgt(times, weights, 20);
  close(out.rate, 2 / 3);
  // Depth is the average shortfall over everyone, so the 40-minute place
  // dominates it while the headcount treats both the same.
  close(out.depth, (0.1 + 2) / 3);
  close(out.minutesShort, 21);
});

test('severity weighs the worst off more than the depth does', () => {
  const weights = Float32Array.from([100, 100]);
  const even = fgt(Float32Array.from([30, 30]), weights, 20);
  const uneven = fgt(Float32Array.from([20, 40]), weights, 20);
  // Same total shortfall, spread differently.
  close(even.depth, uneven.depth);
  assert.ok(uneven.severity > even.severity, 'severity should notice the concentration');
});

test('a fare, not distance, is what shuts some people out', () => {
  //                      near enough, affordable | near, unaffordable | far
  const withoutBudget = Float32Array.from([10, 12, 50]);
  const withBudget = Float32Array.from([10, NaN, 50]);
  const weights = Float32Array.from([100, 100, 100]);
  const split = pricedOut(withBudget, withoutBudget, weights, 20);
  assert.equal(split.priced, 100);
  assert.equal(split.distance, 100);
});

test('the concentration index says which way access leans', () => {
  const weights = Float32Array.from([100, 100, 100, 100]);
  const deprivation = Float32Array.from([1, 4, 7, 10]);
  // Access rising with deprivation: the worst off have the most.
  const proPoor = concentrationIndex(Float32Array.from([10, 20, 30, 40]), weights, deprivation);
  assert.ok(proPoor < 0, `expected negative, got ${proPoor}`);
  // And the other way round.
  const proRich = concentrationIndex(Float32Array.from([40, 30, 20, 10]), weights, deprivation);
  assert.ok(proRich > 0, `expected positive, got ${proRich}`);
  close(proPoor, -proRich, 1e-9);
});

test('access spread evenly leans neither way', () => {
  const weights = Float32Array.from([100, 100, 100, 100]);
  const flat = concentrationIndex(Float32Array.from([25, 25, 25, 25]), weights, Float32Array.from([1, 4, 7, 10]));
  close(flat, 0, 1e-9);
});

test('the leaning reads as a sentence', () => {
  assert.match(leaning(-0.3), /favours more deprived areas/);
  assert.match(leaning(0.3), /favours better-off areas/);
  assert.match(leaning(0.001), /spread evenly/);
  assert.equal(leaning(NaN), null);
});

test('groups come back worst first', () => {
  const times = Float32Array.from([10, 40]);
  const rows = byGroup(times, 20, [
    ['fine', 'Fine', Float32Array.from([100, 0])],
    ['badly', 'Badly served', Float32Array.from([0, 100])],
  ]);
  assert.equal(rows[0].key, 'badly');
  close(rows[0].rate, 1);
  close(rows[1].rate, 0);
});
