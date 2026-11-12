// Fares against income: per-area budgets and the burden of a trip.
import assert from 'node:assert/strict';
import test from 'node:test';

import { pricedLayer, times } from '../../web/js/data.js';
import { burdenClass, cheapestZones, dailyIncome, incomeZones } from '../../web/js/fares.js';

const f32 = (values) => Float32Array.from(values, (v) => (v == null ? NaN : v));
const meta = {
  kind: 'zones',
  zone_cap: 3,
  fares: { adult: { card: { 1: 3, 2: 5, 3: 7 } } },
  free: { supergold: { free_from: '09:00' } },
};
const traveller = { profile: 'adult', payment: 'card', returnTrip: true, hour: 10, weekday: true };

test('the same share of a lower income buys fewer zones', () => {
  // A day's income of $100, $200 and $400; 5% of it is $5, $10 and $20 for a return trip.
  const zones = incomeZones(meta, f32([100, 200, 400]), 5, traveller);
  assert.deepEqual(Array.from(zones), [0, 2, 3]);
});

test('free travel buys the whole network whatever the income', () => {
  const zones = incomeZones(meta, f32([50, 400]), 1, { ...traveller, profile: 'supergold' });
  assert.deepEqual(Array.from(zones), [3, 3]);
});

test('a place with no income figure gets the city median', () => {
  const data = { income: f32([36500, null]), meta: { affordability: { median_income: 73000 } } };
  assert.deepEqual(Array.from(dailyIncome(data)), [100, 200]);
});

test('per-area budgets read each hexagon its own priced layer', () => {
  const data = {
    n: 3,
    meta: { standard_modes: ['walk', 'pt'] },
    t: { gp: { walk: f32([40, 40, 40]), pt: f32([10, 10, 10]) } },
    cost: { gp: { z1: f32([30, 30, 30]), z2: f32([18, 18, 18]) } },
  };
  // No zones, one zone, and the whole network, which is no constraint at all
  // and so reads the unpriced time.
  const zones = Int8Array.from([0, 1, 2]);
  assert.deepEqual(Array.from(pricedLayer(data, 'gp', zones)).map((v) => (Number.isNaN(v) ? null : v)), [null, 30, 10]);
  assert.deepEqual(Array.from(times(data, 'gp', 'best', zones)), [40, 30, 10]);
});

test('the cheapest way counts walking as free and keeps the true zone count', () => {
  const data = {
    n: 3,
    meta: { standard_modes: ['walk', 'pt'], fares: { kind: 'zones', zone_cap: 6 } },
    t: { gp: { walk: f32([12, 50, 50]) } },
    cost: { gp: { z1: f32([12, 40, 40]), z2: f32([12, 40, 40]), z3: f32([12, 40, 40]), z4: f32([12, 40, 40]), z5: f32([12, 18, 40]), z6: f32([12, 18, 40]) } },
  };
  assert.deepEqual(Array.from(cheapestZones(data, 'gp', 20)), [0, 5, -2]);
});

test('burden bands break at 2.5, 5 and 10 percent', () => {
  assert.deepEqual([0, 0.02, 0.025, 0.049, 0.05, 0.1, 0.3].map(burdenClass), [0, 1, 2, 2, 3, 4, 4]);
});

test('the bus-only count needs no fare where the trip is a walk (z0)', () => {
  // From 0.12.0 public transport is the quicker of the trip and the walk,
  // and the build sends the walks within the fare cap as z0, which need no
  // fare. A 12-minute walk beats the 15-minute trip, so nobody pays. A
  // 25-minute walk is over the standard, so the 18-minute trip boards.
  const data = {
    n: 4,
    meta: { standard_modes: ['walk', 'pt'], fares: { kind: 'zones', zone_cap: 2 } },
    t: { gp: { walk: f32([12, 50, 25, 50]) } },
    cost: { gp: { z0: f32([12, null, 25, null]), z1: f32([12, 40, 18, null]), z2: f32([12, 18, 18, null]) } },
  };
  assert.deepEqual(Array.from(cheapestZones(data, 'gp', 20, { walkable: false })), [0, 2, 1, -2]);
  // A build before 0.12.0 has no z0, and its public transport time is R5's
  // own: a trip in time boards something and pays.
  const before = { ...data, cost: { gp: { z1: f32([15, 40, 18, null]), z2: f32([15, 18, 18, null]) } } };
  assert.deepEqual(Array.from(cheapestZones(before, 'gp', 20, { walkable: false })), [1, 2, 1, -2]);
  // With no fare affordable, z0 is what public transport reaches.
  assert.deepEqual(Array.from(times(data, 'gp', 'pt', 0)).map((v) => (Number.isNaN(v) ? null : v)), [12, null, 25, null]);
  assert.ok(Number.isNaN(times(before, 'gp', 'pt', 0)[0]), 'an older build reaches nothing with no fare');
});

test('cycling counts as free even when walking is too slow', async () => {
  const { cheapestFareClasses } = await import('../../web/js/fares.js');
  const data = {
    n: 3,
    meta: { standard_modes: ['walk', 'bike_low_stress', 'pt'], fares: { kind: 'zones', zone_cap: 4 } },
    t: { gp: { walk: f32([30, 30, null]), bike_low_stress: f32([10, 25, null]), car: f32([5, 5, null]) } },
    cost: { gp: { z1: f32([12, 40, null]) } },
  };
  // Cycles in time; nothing in time but routed; no route at all.
  assert.deepEqual(Array.from(cheapestFareClasses(data, 'gp', 20)), [0, 5, -1]);
});
