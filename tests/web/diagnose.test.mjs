// The browser diagnosis must agree with src/team/diagnosis.py. These are the same
// seven cases as tests/test_core.py::test_diagnosis_rules_in_order.

import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseCell } from '../../web/js/diagnose.js';

const cases = [
  ['meets', { km: 0.5, walk: 10, bikeLow: 8, bike: 6, pt: 12, car: 3, freq: 6 }, 0],
  ['walk_link', { km: 1.0, walk: 32, bikeLow: 25, bike: 24, pt: 28, car: 5, freq: 6 }, 1],
  ['safe_bike', { km: 3.0, walk: 45, bikeLow: 30, bike: 14, pt: 35, car: 8, freq: 6 }, 2],
  ['pt_frequency', { km: 3.0, walk: 45, bikeLow: 30, bike: 25, pt: 33, car: 8, freq: 2 }, 3],
  ['pt_trip', { km: 3.0, walk: 45, bikeLow: 30, bike: 25, pt: 33, car: 8, freq: 8 }, 4],
  ['distance', { km: 8.0, walk: NaN, bikeLow: 40, bike: 35, pt: 45, car: 12, freq: 10 }, 5],
  ['no_data', { km: 2.0, walk: NaN, bikeLow: NaN, bike: NaN, pt: NaN, car: NaN, freq: 0 }, 9],
];

for (const [name, cell, expected] of cases) {
  test(`diagnosis: ${name}`, () => {
    const best = Math.min(...[cell.walk, cell.bikeLow, cell.pt].filter(Number.isFinite));
    assert.equal(diagnoseCell({ ...cell, best: Number.isFinite(best) ? best : NaN }, 20), expected);
  });
}
