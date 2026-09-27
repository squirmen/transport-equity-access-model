import assert from 'node:assert/strict';
import test from 'node:test';

import { choiceWithin, setUrban } from '../../web/js/data.js';

test('urban only sets rural people to zero everywhere, and back', () => {
  const pop = Float32Array.from([10, 20, 30]);
  const data = { urban: Uint8Array.from([1, 0, 1]), pop, weights: { everyone: pop, children: Float32Array.from([1, 2, 3]) } };
  data.everywhere = { pop: data.pop, weights: data.weights };
  setUrban(data, true);
  assert.deepEqual(Array.from(data.pop), [10, 0, 30]);
  assert.deepEqual(Array.from(data.weights.children), [1, 0, 3]);
  setUrban(data, false);
  assert.deepEqual(Array.from(data.pop), [10, 20, 30]);
});

test('choice reads the largest step inside the standard', () => {
  const data = { choice: { gp: { 10: [1], 15: [2], 20: [4], 30: [9] } } };
  assert.equal(choiceWithin(data, 'gp', 25).minutes, 20);
  assert.equal(choiceWithin(data, 'gp', 25).counts[0], 4);
  assert.equal(choiceWithin(data, 'gp', 5), null);
});
