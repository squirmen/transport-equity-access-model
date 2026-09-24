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
