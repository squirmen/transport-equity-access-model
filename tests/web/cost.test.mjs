import assert from 'node:assert/strict';
import test from 'node:test';

import { bestMode, cellInputs, times } from '../../web/js/data.js';

// Two cells. Cell 0 has a bus 12 minutes away but three fare zones out;
// cell 1 has one inside a single zone.
const data = {
  n: 2,
  meta: {
    standard_modes: ['walk', 'bike_low_stress', 'pt'],
    services: { gp: { window: 'interpeak', standard_minutes: 20 } },
  },
  t: {
    gp: {
      walk: Float32Array.from([40, 50]),
      bike_low_stress: Float32Array.from([25, 30]),
      pt: Float32Array.from([12, 9]),
      car: Float32Array.from([6, 7]),
    },
  },
  km: { gp: Float32Array.from([3, 4]) },
  freq: { interpeak: Float32Array.from([6, 6]) },
  cost: {
    gp: {
      z1: Float32Array.from([NaN, 9]),
      z2: Float32Array.from([NaN, 9]),
      z3: Float32Array.from([12, 9]),
      z4: Float32Array.from([12, 9]),
    },
  },
};

test('without a budget every routed trip counts', () => {
  assert.deepEqual([...times(data, 'gp', 'pt')], [12, 9]);
  assert.equal(bestMode(data, 'gp', 0), 'pt');
});

test('a budget hides a trip that costs more zones than it buys', () => {
  assert.deepEqual([...times(data, 'gp', 'pt', 1)], [NaN, 9]);
  assert.deepEqual([...times(data, 'gp', 'pt', 3)], [12, 9]);
});

test('no affordable fare removes public transport altogether', () => {
  const [a, b] = times(data, 'gp', 'pt', 0);
  assert.ok(Number.isNaN(a) && Number.isNaN(b));
});

test('the best option falls back to cycling when the bus is unaffordable', () => {
  assert.equal(bestMode(data, 'gp', 0, 1), 'bike_low_stress');
  assert.equal(bestMode(data, 'gp', 0, 3), 'pt');
  // Walking and cycling cost nothing, so the budget never changes them.
  assert.deepEqual([...times(data, 'gp', 'walk', 0)], [40, 50]);
  assert.deepEqual([...times(data, 'gp', 'best', 0)], [25, 30]);
});

test('the diagnosis sees the trip the traveller can pay for', () => {
  // With no budget the bus is 12 minutes, so it is not the bus that is slow.
  assert.equal(cellInputs(data, 'gp', 0, 12).pt, 12);
  // Priced out, the diagnosis must not still see a 12-minute bus.
  assert.equal(Number.isFinite(cellInputs(data, 'gp', 0, 25, 1).pt), false);
  assert.equal(Number.isFinite(cellInputs(data, 'gp', 0, 25, 0).pt), false);
  assert.equal(cellInputs(data, 'gp', 0, 12, 3).pt, 12);
});
