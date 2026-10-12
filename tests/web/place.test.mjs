import assert from 'node:assert/strict';
import test from 'node:test';

import { serviceVerdict } from '../../web/js/place.js';

// One hexagon: a quick ride, a slow bus, no walk within an hour.
const data = {
  meta: { standard_modes: ['walk', 'bike_low_stress', 'pt'] },
  t: {
    supermarket: {
      walk: [NaN],
      bike_low_stress: [8],
      pt: [24],
      bike: [6],
      car: [4],
    },
  },
};

test('the card reports the mode on screen, not the fastest one', () => {
  const pt = serviceVerdict(data, 0, 'supermarket', 20, 'pt');
  assert.equal(pt.mode, 'pt');
  assert.equal(pt.shown, 24);
  assert.equal(pt.meets, false, 'a 24-minute bus does not meet a 20-minute standard');
  assert.equal(pt.fastest, 'bike_low_stress');
  assert.equal(pt.best, 8);
});

test('best without a car uses the fastest counting mode', () => {
  const best = serviceVerdict(data, 0, 'supermarket', 20, 'best');
  assert.equal(best.mode, 'bike_low_stress');
  assert.equal(best.meets, true);
});

test('car and any-street cycling never meet a standard', () => {
  for (const mode of ['car', 'bike']) {
    const verdict = serviceVerdict(data, 0, 'supermarket', 20, mode);
    assert.equal(verdict.counts, false);
    assert.equal(verdict.meets, false, `${mode} must not report Meets`);
  }
});

test('a mode with no route within the hour misses', () => {
  const walk = serviceVerdict(data, 0, 'supermarket', 20, 'walk');
  assert.equal(walk.counts, true);
  assert.equal(walk.meets, false);
});

test('a place nothing reaches misses the standard rather than not counting', () => {
  const none = { meta: { standard_modes: ['walk', 'pt'] }, t: { gp: { walk: [NaN], pt: [NaN] } } };
  const verdict = serviceVerdict(none, 0, 'gp', 20, 'best');
  assert.equal(verdict.mode, null);
  assert.equal(verdict.counts, true);
  assert.equal(verdict.meets, false);
});

// ---------------------------------------------------------------- the card, answer first

import { jobsTile, placeHeader, rollup, verdictLine } from '../../web/js/place.js';
import { setServices } from '../../web/js/panel.js';

// Two hexagons: the first meets both standards on foot; the second misses the GP.
const two = {
  meta: {
    standard_modes: ['walk', 'bike_low_stress', 'pt'],
    services: { supermarket: { standard_minutes: 20, window: 'interpeak' }, gp: { standard_minutes: 20, window: 'interpeak' } },
    jobs: { total: 100000 },
  },
  t: {
    supermarket: { walk: [6, 12], bike_low_stress: [4, 9], pt: [10, 15], bike: [3, 8], car: [2, 4] },
    gp: { walk: [3, NaN], bike_low_stress: [2, 41], pt: [8, 34], bike: [2, 30], car: [2, 9] },
  },
  km: { supermarket: [0.4, 0.9], gp: [0.2, 6.5] },
  freq: { interpeak: [12, 2] },
  nearest: { supermarket: [0, 0], gp: [1, 1] },
  destinations: [{ name: 'Corner Store' }, { name: 'Hill Medical' }],
  jobs: { pt: { 45: [31, 2] }, bike_low_stress: { 45: [6, 3.5] }, walk: { 45: [4, 1] } },
  place: [0, null],
  places: [{ name: 'Takapuna Central', board: 'Devonport-Takapuna' }],
  pop: [190, 40],
  zone: ['Lower North Shore', null],
};

test('the verdict band leads with the service and way on screen', () => {
  setServices(two.meta);
  const meets = verdictLine(two, 0, 'gp', 20, 'best');
  assert.equal(meets.state, 'meets');
  assert.equal(meets.strong, 'GP: 2 min by low-stress cycling.');
  assert.match(meets.rest, /The standard is 20 min\. Nearest: Hill Medical\./);
  const misses = verdictLine(two, 1, 'gp', 20, 'pt');
  assert.equal(misses.state, 'misses');
  assert.equal(misses.strong, 'GP: 34 min by public transport.');
  const car = verdictLine(two, 1, 'gp', 20, 'car');
  assert.equal(car.badge, "Doesn't count");
});

test('the roll-up names what a hexagon misses', () => {
  setServices(two.meta);
  const standard = () => 20;
  assert.equal(rollup(two, 0, standard), 'Meets all 2 standards without a car.');
  assert.equal(rollup(two, 1, standard), 'Meets 1 of 2 standards without a car. Misses: GP, 34 min.', 'any-street cycling is not counted');
});

test('the jobs tile takes the way that reaches most', () => {
  assert.deepEqual(jobsTile(two, 0), { figure: '31,000', label: 'jobs in 45 min by public transport', short: '31,000 by PT' });
  assert.equal(jobsTile(two, 1).label, 'jobs in 45 min by low-stress cycling');
});

test('the card header names the local board and the fare zone', () => {
  const head = placeHeader(two, 0);
  assert.equal(head.eyebrow, 'Hexagon · Devonport-Takapuna');
  assert.equal(head.title, 'Takapuna Central');
  assert.equal(head.sub, 'About 190 residents · fare zone Lower North Shore');
  assert.equal(placeHeader(two, 1).title, 'Unnamed area');
});
