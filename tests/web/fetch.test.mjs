import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchJson } from '../../web/js/data.js';

// Answers in turn, then keeps repeating the last one.
function fakeFetch(answers) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return {
      ok: answer >= 200 && answer < 300,
      status: answer,
      json: async () => ({ fine: true }),
    };
  };
  return calls;
}

const quick = { pause: 1 };

test('a dropped connection is tried again', async () => {
  const calls = fakeFetch([new TypeError('network error'), 200]);
  assert.deepEqual(await fetchJson('data/x/', 'cells', quick), { fine: true });
  assert.equal(calls.length, 2);
});

test('a busy server is tried again, up to three times', async () => {
  const calls = fakeFetch([503, 503, 503]);
  await assert.rejects(fetchJson('data/x/', 'cells', quick), /cells\.json \(503\)/);
  assert.equal(calls.length, 3);
});

test('a missing file is not tried again', async () => {
  const calls = fakeFetch([404]);
  await assert.rejects(fetchJson('data/x/', 'cells', quick), /cells\.json \(404\)/);
  assert.equal(calls.length, 1);
});

test('a body cut short is fetched again', async () => {
  let n = 0;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      n += 1;
      if (n === 1) throw new SyntaxError('Unexpected end of JSON input');
      return { fine: true };
    },
  });
  assert.deepEqual(await fetchJson('data/x/', 'cells', quick), { fine: true });
  assert.equal(n, 2);
});
