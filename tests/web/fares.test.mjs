import assert from 'node:assert/strict';
import test from 'node:test';

import { affordableZones, budgetSentence, fare, fareSteps, freeTravel, money, travellerSummary } from '../../web/js/fares.js';

const meta = {
  fares: {
    adult: { hop: { 1: 3.0, 2: 4.9, 3: 6.5, 4: 7.9 }, cash: { 1: 4.0, 2: 6.0, 3: 8.0, 4: 10.0 } },
    community_connect: { hop: { 1: 1.5, 2: 2.45, 3: 3.25, 4: 3.95 } },
  },
  free: { supergold: { free_from: '09:00' } },
  profiles: [{ key: 'adult', label: 'Adult' }, { key: 'supergold', label: 'SuperGold' }],
};

const base = { profile: 'adult', payment: 'hop', returnTrip: true };

test('a fare is capped at four zones', () => {
  assert.equal(fare(meta, 1), 3.0);
  assert.equal(fare(meta, 4), 7.9);
  assert.equal(fare(meta, 9), 7.9);
});

test('a traveller with no cash table of their own pays the adult cash fare', () => {
  assert.equal(fare(meta, 2, 'community_connect', 'hop'), 2.45);
  assert.equal(fare(meta, 2, 'community_connect', 'cash'), 2.45);
});

test('a return trip costs two fares', () => {
  // $5 covers a two-zone trip one way but cannot get an adult there and back.
  assert.equal(affordableZones(meta, { ...base, budget: 5, returnTrip: false }), 2);
  assert.equal(affordableZones(meta, { ...base, budget: 5 }), 0);
  assert.equal(affordableZones(meta, { ...base, budget: 6 }), 1);
});

test('no budget means no limit', () => {
  assert.equal(affordableZones(meta, { ...base, budget: null }), null);
});

test('a concession buys more zones for the same money', () => {
  assert.equal(affordableZones(meta, { ...base, budget: 5 }), 0);
  assert.equal(affordableZones(meta, { ...base, budget: 5, profile: 'community_connect' }), 2);
});

test('SuperGold travels free only after nine on a weekday', () => {
  assert.equal(freeTravel(meta, 'supergold', 8), false);
  assert.equal(freeTravel(meta, 'supergold', 10), true);
  assert.equal(freeTravel(meta, 'supergold', 8, false), true);
  assert.equal(affordableZones(meta, { ...base, budget: 0, profile: 'supergold', hour: 10 }), 4);
  assert.equal(affordableZones(meta, { ...base, budget: 0, profile: 'supergold', hour: 8 }), 0);
});

test('the slider steps are priced for the trip the budget has to cover', () => {
  assert.deepEqual(fareSteps(meta, base).map((s) => s.cost), [6, 9.8, 13, 15.8]);
  assert.deepEqual(fareSteps(meta, { ...base, returnTrip: false }).map((s) => s.cost), [3, 4.9, 6.5, 7.9]);
});

test('the budget line says what the money buys', () => {
  assert.match(budgetSentence(meta, { ...base, budget: null }, 10), /No limit on the fare/);
  assert.match(budgetSentence(meta, { ...base, budget: 5 }, 10), /cheapest return trip is \$6/);
  assert.match(budgetSentence(meta, { ...base, budget: 6 }, 10), /Buys 1 zone return, at \$6/);
  assert.match(budgetSentence(meta, { ...base, budget: 20 }, 10), /whole network/);
  assert.match(budgetSentence(meta, { ...base, budget: 0, profile: 'supergold' }, 10), /Free at 10:00/);
});

test('money reads as dollars', () => {
  assert.equal(money(6), '$6');
  assert.equal(money(9.8), '$9.80');
});

test('the traveller line names who is travelling and how', () => {
  assert.equal(travellerSummary(meta, base, 10), 'Adult · HOP · return · 10:00');
  assert.equal(travellerSummary(meta, { ...base, payment: 'cash', returnTrip: false }, 7), 'Adult · cash · one way · 07:00');
});
