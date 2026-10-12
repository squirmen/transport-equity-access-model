// The map's colours stay readable for colour-blind readers.
//
// Ported from MATE's tests/test_palette.py (itself from ALTO's
// test_cvd_palettes.cjs): each colour is passed through Machado, Oliveira and
// Fernandes (2009) at severity 1 for protanopia, deuteranopia and tritanopia,
// in linear RGB, and compared in CIEDE2000 (Sharma, Wu and Dalal 2005).
// Classes drawn with the same mark must differ by 9 or more under normal
// vision and each of the three; steps of a ramp must differ from the next by
// the same. The colours are read from web/js/palette.js and web/css/team.css,
// so a palette that fails cannot come back unnoticed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACCESS, CONCENTRATION, DENSITY, DESTINATION_COLOURS, DESTINATION_OTHER, FAIR, FARE, JOBS, LEAN, PEOPLE, REASON_PALETTE,
  SCORE,
} from '../../web/js/palette.js';
import { CATCHMENT, STATUS } from '../../web/js/mate.js';

const CSS = readFileSync(new URL('../../web/css/team.css', import.meta.url), 'utf8');

const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const VISION = [null, 'protanopia', 'deuteranopia', 'tritanopia'];
const MIN_BETWEEN = 9;

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function simulate(colour, vision) {
  const lin = colour.map(linear);
  if (!vision) return lin;
  return MACHADO[vision].map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
}

function lab([r, g, b]) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function ciede2000([l1, a1, b1], [l2, a2, b2]) {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cb = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (x, y) => (!x && !y ? 0 : ((Math.atan2(y, x) / rad) % 360 + 360) % 360);
  const h1 = hue(a1p, b1);
  const h2 = hue(a2p, b2);
  let dh = 0;
  if (c1p * c2p) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = l2 - l1;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh * rad) / 2);
  const lb = (l1 + l2) / 2;
  const cbp = (c1p + c2p) / 2;
  let hb = h1 + h2;
  if (c1p * c2p) hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const t = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad)
    - 0.20 * Math.cos((4 * hb - 63) * rad);
  const rc = 2 * Math.sqrt(cbp ** 7 / (cbp ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lb - 50) ** 2) / Math.sqrt(20 + (lb - 50) ** 2);
  const sc = 1 + 0.045 * cbp;
  const sh = 1 + 0.015 * cbp * t;
  const rt = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

const delta = (x, y, vision) => ciede2000(lab(simulate(rgb(x), vision)), lab(simulate(rgb(y), vision)));

/** The closest pair in a set, under each vision: every pair for categories,
 *  neighbours only for a ramp. */
function worst(colours, { ramp = false } = {}) {
  let low = Infinity;
  let pair = null;
  for (const vision of VISION) {
    for (let i = 0; i < colours.length; i += 1) {
      for (let j = i + 1; j < colours.length; j += 1) {
        if (ramp && j !== i + 1) continue;
        const d = delta(colours[i], colours[j], vision);
        if (d < low) {
          low = d;
          pair = `${colours[i]} / ${colours[j]} (${vision || 'normal'})`;
        }
      }
    }
  }
  return { low, pair };
}

test('CIEDE2000 reproduces Sharma\'s reference pairs', () => {
  // Sharma, Wu and Dalal (2005), table 1, pairs 1 and 17, as ALTO's and MATE's tests check.
  assert.ok(Math.abs(ciede2000([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 1e-3);
  assert.ok(Math.abs(ciede2000([50, 2.5, 0], [73, 25, -18]) - 27.1492) < 1e-3);
});

const CATEGORIES = {
  // The five reasons; the sixth entry is the faded colour for reasons not picked, drawn apart.
  'main reason': REASON_PALETTE.slice(0, 5),
  'destination pins': [...new Set([...Object.values(DESTINATION_COLOURS), DESTINATION_OTHER])],
  'lean dots': [LEAN.toward, LEAN.away],
  // MATE's footpath status in the card's bar; not known is hatched, a different mark.
  'footpath status': STATUS.filter((s) => s.key !== 'u').map((s) => s.colour),
};

for (const [name, colours] of Object.entries(CATEGORIES)) {
  test(`${name}: every pair differs by ${MIN_BETWEEN} or more in every vision`, () => {
    const { low, pair } = worst(colours);
    assert.ok(low >= MIN_BETWEEN, `${name}: ${pair} differ by ${low.toFixed(1)}`);
  });
}

const RAMPS = {
  minutes: ACCESS,
  'fare and fare burden': FARE,
  'people missing out': PEOPLE,
  'share of jobs': JOBS,
  'job access against the average': FAIR,
  'access score': SCORE,
  'where a group lives': CONCENTRATION,
  'people per hexagon': DENSITY,
  'MATE catchment': CATCHMENT,
};

for (const [name, colours] of Object.entries(RAMPS)) {
  test(`${name}: each step differs from the next by ${MIN_BETWEEN} or more in every vision`, () => {
    const { low, pair } = worst(colours, { ramp: true });
    assert.ok(low >= MIN_BETWEEN, `${name}: ${pair} differ by ${low.toFixed(1)}`);
  });
}

test('the fare map is no longer a red-to-green ramp', () => {
  // The 13 October audit: lime and yellow 8.7 apart for protanopia.
  const before = ['#1a7f5a', '#7cb342', '#f2c200', '#f08a24', '#e0562d', '#9c2f2f'];
  assert.ok(worst(before, { ramp: true }).low < MIN_BETWEEN);
  assert.equal(FARE[0], ACCESS[1], 'free is the blue of the minutes map');
});

test('the old reason and pin colours would fail', () => {
  assert.ok(worst(['#2a78d6', '#eb6834', '#1baf7a', '#8f8c85', '#7a5195']).low < MIN_BETWEEN);
  assert.ok(worst(['#1a7f4b', '#c8364e', '#b86e00', '#0c0c48']).low < MIN_BETWEEN);
});

test('the stylesheet\'s lean dots are the palette\'s', () => {
  assert.match(CSS, new RegExp(`\\.lean-dot\\.is-toward \\{ background: ${LEAN.toward}; \\}`));
  assert.match(CSS, new RegExp(`\\.lean-dot\\.is-away \\{ background: ${LEAN.away}; \\}`));
});
