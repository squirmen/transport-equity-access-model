import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cardFigures, catchment, catchmentModel, entries, kerbs, LOST, lighting, mateHash, minutesRange, narrow, profileOf,
  profileSum, PROFILES, ptWindow, range, readMateHash, servicesIn, statusShares, streets, variantOf, withUnit,
} from '../../web/js/mate.js';
import { hatchImage } from '../../web/js/map.js';

test('a range gives the no-known-barrier figure, then the cautious one when it differs', () => {
  assert.equal(range(13, 10), '13, or 10');
  assert.equal(range(8, 8), '8');
  assert.equal(range(null, 3), '–');
  assert.equal(range(4, null), '4, or none');
  assert.equal(range(3.4, 2.1, '%'), '3.4%, or 2.1%');
});

test('a fold\'s summary names the profile in full and gives the unit', () => {
  // The review: "wheelchair 10, or 6" counted hexagons, "wheelchair 34, or 35" minutes, and "wheelchair" was only the
  // manual one while the powered chair read "scooter".
  // The figure is held on one line (no-break spaces); the name can wrap.
  assert.equal(profileSum('manual_wheelchair', range(10, 6), 'hexagons'), 'manual wheelchair: 10,\u00a0or\u00a06\u00a0hexagons');
  const sum = (key, text, unit) => profileSum(key, text, unit).replace(/\u00a0/g, ' ');
  assert.equal(sum('powered_chair_scooter', range(12, 12), 'hexagons'), 'powered chair or scooter: 12 hexagons');
  assert.equal(sum('pram', range(1, 1), 'hexagons'), 'pram or buggy: 1 hexagon');
  assert.equal(sum('older_walker', '34, or 35', 'min'), 'older walker: 34, or 35 min');
  assert.equal(sum('child', '34, or none', 'min'), 'child on their own: 34 min, or none');
  assert.equal(sum('walk', 'over 45', 'min'), 'walking: over 45 min');
  assert.equal(sum('cargo_bike', 'not worked out'), 'cargo bike: not worked out');
  assert.equal(withUnit('none', 'min'), 'none');
  assert.equal(withUnit('–', 'hexagons'), '–');
  // Every profile has a name for a sentence, starting in lower case.
  for (const p of PROFILES) assert.match(p.person, /^(a|an|someone) [a-z]/, p.key);
});

test('minutes run the other way: the cautious figure is the longer one', () => {
  assert.equal(minutesRange(4, 6), '4, or 6');
  assert.equal(minutesRange(4, 4, ' min'), '4 min');
  assert.equal(minutesRange(9, 14, ' min'), '9 min, or 14 min');
  assert.equal(minutesRange(25, null), '25, or over 30');
  assert.equal(minutesRange(null, null), '–');
});

test('after dark only changes the profiles that have an after-dark rule', () => {
  assert.equal(variantOf('older_walker', true), 'older_walker_night');
  assert.equal(variantOf('child', true), 'child_night');
  assert.equal(variantOf('manual_wheelchair', true), 'manual_wheelchair');
  assert.equal(variantOf('older_walker', false), 'older_walker');
  assert.equal(profileOf('nonsense').key, 'manual_wheelchair');
});

test('the address keeps the hexagon and the MATE settings', () => {
  const read = readMateHash(new URLSearchParams('o=89bb500006fffff&mp=pram.dc'));
  assert.deepEqual(read, { cell: '89bb500006fffff', profile: 'pram', dark: true, view: 'cautious', map: true });
  assert.equal(mateHash(read), 'pram.dc');
  assert.equal(mateHash({ profile: 'walk', dark: false, view: 'nkb', map: false }), 'walk.x');
  assert.equal(mateHash({ profile: 'walk', dark: false, view: 'nkb', map: true }), 'walk');
  // Anything else falls back rather than failing.
  const odd = readMateHash(new URLSearchParams('o=not-a-cell&mp=rocket'));
  assert.equal(odd.cell, null);
  assert.equal(odd.profile, 'manual_wheelchair');
});

// A reach file with two origins, cells 5 and 9, as MATE writes it.
const shard = {
  cells: [5, 9],
  r: {
    walk: { nkb: { n: [4, 1], c: [5, 6, 7, 8, 9], m: [0, 4, 9, 14, 0] }, cautious: { n: [2, 1], c: [5, 6, 9], m: [0, 5, 0] } },
    manual_wheelchair: { nkb: { n: [3, 1], c: [5, 6, 2, 9], m: [0, 6, 11, 0] }, cautious: { n: [1, 1], c: [5, 9], m: [0, 0] } },
  },
};

test('one origin\'s entries are found by adding up the counts before it', () => {
  assert.deepEqual(entries(shard.r.walk.nkb, 1), { ids: [9], minutes: [0] });
  assert.deepEqual(entries(shard.r.walk.nkb, 0).ids, [5, 6, 7, 8]);
});

test('the catchment colours by 5, 10 and 15 minutes and marks what only walking reaches', () => {
  const c = catchment(shard, 5, 'manual_wheelchair', 'nkb', 12);
  assert.deepEqual([...c.classes], [-1, -1, 2, -1, -1, 0, 1, LOST, LOST, -1, -1, -1]);
  assert.deepEqual(c.lost, [7, 8]);
  assert.equal(c.minutes.get(2), 11);
  assert.equal(catchment(shard, 3, 'walk', 'nkb', 12), null, 'not an origin in this file');
});

test('the map model waits for its data and is off when the map is set to TEAM\'s view', () => {
  const settings = { profile: 'manual_wheelchair', dark: false, view: 'nkb', map: true };
  assert.equal(catchmentModel({ core: {}, shard: null }, 5, settings, 12), null);
  assert.equal(catchmentModel({ core: {}, shard }, 5, { ...settings, map: false }, 12), null);
  const model = catchmentModel({ core: {}, shard }, 5, settings, 12);
  assert.deepEqual(model.tooltip(7), ['Walking: 9 min', 'Manual wheelchair: not within 15 min']);
  assert.deepEqual(model.tooltip(6), ['Manual wheelchair: 6 min', 'Walking: 4 min']);
  assert.deepEqual(model.tooltip(11), ['Not within 15 min on foot']);
  assert.equal(model.key.rows.at(-1)[1], LOST);
});

// cells_mate.json and times.json for three cells; cell 1 has no MATE data.
function made() {
  const cells = {
    meta: {
      pt: { windows: ['am_peak', 'interpeak'], variants: ['walk', 'manual_wheelchair'], services: ['supermarket', 'gp', 'library'], jobs_total: 1000 },
      width_limits: { manual_wheelchair: 1.2, powered_chair_scooter: 1.2, pram: 1.0 },
    },
    km: [1.3, null, 0.4],
    o: [0, null, 1],
    p_manual_wheelchair: [54, null, 10], h_manual_wheelchair: [18, null, 0], u_manual_wheelchair: [3, null, 90], b_manual_wheelchair: [25, null, 0],
    x_ok: [3, null, 0], x_raised: [1, null, 0], x_rolled: [1, null, 0], x_ok_est: [2, null, 0], x_raised_est: [0, null, 0], x_part: [1, null, 0], x_unknown: [4, null, 2],
    x_junction: [11, null, 0], x_join: [2, null, null],
    kst: [0.6, null, null], sp_manual_wheelchair: [20, null, null], sh_manual_wheelchair: [0, null, null], su_manual_wheelchair: [80, null, null], sb_manual_wheelchair: [0, null, null],
    wu100r: [0, null, 0], wu100e: [1, null, 0], wu120r: [2, null, 0], wu120e: [3, null, 0],
    x_main: [2, null, 0], x_main_no_signals: [1, null, 0],
    l0: [80, null, 100], l1: [16, null, 0], l2: [0, null, 0], l3: [4, null, 0], lamps: [6, null, 0],
    w0: [10, null, 0], w1: [5, null, 0], wr: [20, null, 0], m12: [140, null, 0], g0: [3, null, 0], steps: [2, null, 0],
    older: [18, null, 5], disabled: [7, null, 2], under5: [6, null, 1], kids: [20, null, 9],
    pt: {
      interpeak: {
        walk: { nkb: { c: [200, 30], j: [12, 0.4], s: [7, 1] }, cautious: { c: [180, 30], j: [11, 0.4], s: [7, 1] } },
        manual_wheelchair: { nkb: { c: [80, null], j: [3.4, null], s: [3, null] }, cautious: { c: [40, null], j: [2.1, null], s: [1, null] } },
      },
    },
  };
  for (const v of ['walk', 'older_walker', 'manual_wheelchair', 'powered_chair_scooter', 'pram', 'child', 'cargo_bike', 'older_walker_night', 'child_night']) {
    for (const view of ['nkb', 'cautious', 'known']) cells[`r_${v}_${view}`] = [view === 'nkb' ? 8 : view === 'cautious' ? 4 : 1, null, 2];
  }
  cells.r_older_walker_night_cautious = [1, null, 1];
  const t = (a, b) => ({ stop: [a, b], frequent_stop: [a + 3, null], supermarket: [9, null], gp: [null, null] });
  const times = {
    meta: { targets: ['supermarket', 'gp', 'stop', 'frequent_stop', 'station'] },
    t: {},
    near: { walk: { nkb: { stop: [0, null] } }, manual_wheelchair: { nkb: { stop: [1, null] } } },
    near_stops: { stop_id: ['a', 'b'], code: ['1', '2'], name: ['Stop A', 'Stop B'], kind: ['bus', 'bus'] },
  };
  for (const v of ['walk', 'older_walker', 'manual_wheelchair', 'powered_chair_scooter', 'pram', 'child', 'cargo_bike', 'older_walker_night', 'child_night']) {
    times.t[v] = { nkb: t(4, 12), cautious: t(6, 20) };
  }
  return { cells, times };
}

test('the card\'s figures come straight from the files, for the profile and the time chosen', () => {
  const mate = made();
  const f = cardFigures(mate, 0, { profile: 'manual_wheelchair', dark: false, when: null, urban: true });
  assert.equal(f.chosen.key, 'manual_wheelchair');
  assert.deepEqual(f.chosen.reach, { nkb: 8, cautious: 4, known: 1 });
  assert.deepEqual(f.chosen.stop, { nkb: 4, cautious: 6 });
  assert.deepEqual(f.chosen.group, { key: 'disabled', label: 'disabled', share: 7 });
  assert.deepEqual(f.services.map((s) => [s.key, s.nkb, s.cautious]), [['supermarket', 9, 9], ['gp', null, null]]);
  assert.deepEqual(f.shares, { p: 54, h: 18, u: 3, b: 25 });
  assert.equal(f.transit.window, 'interpeak', 'off-peak unless a window MATE has is on screen');
  assert.equal(f.transit.state, 'ok');
  const wheel = f.transit.rows.find((r) => r.key === 'manual_wheelchair');
  assert.deepEqual(wheel.cells, { nkb: 80, cautious: 40 });
  assert.deepEqual(wheel.jobs, { nkb: 3.4, cautious: 2.1 });
  assert.equal(wheel.stop.name, 'Stop B');
  assert.equal(f.transit.rows.length, 2, 'only the profiles with public transport figures');
  assert.equal(f.transit.team, null, 'TEAM\'s own figure only for the window its jobs line is in');
  assert.deepEqual(f.streets, { km: 0.6, shares: { p: 20, h: 0, u: 80, b: 0 } });
  assert.deepEqual(f.width.narrow, { limit: 1.2, recorded: 2, estimated: 3 });
});

test('with no time picked, public transport follows TEAM\'s jobs line, and gives TEAM\'s own figure beside it', () => {
  const mate = made();
  const f = cardFigures(mate, 0, { profile: 'walk', urban: true, jobsWindow: 'interpeak', teamJobs: 7.7 });
  assert.equal(f.transit.window, 'interpeak');
  assert.equal(f.transit.team, 7.7);
  const g = cardFigures(mate, 0, { profile: 'walk', urban: true, when: 'am_peak', jobsWindow: 'interpeak', teamJobs: 7.7 });
  assert.equal(g.transit.window, 'am_peak');
  assert.equal(g.transit.team, null);
  assert.equal(f.width.narrow, null, 'walking has no width limit');
});

test('after dark swaps in the night figures for the older walker only', () => {
  const mate = made();
  const day = cardFigures(mate, 0, { profile: 'older_walker', dark: false, urban: true });
  const night = cardFigures(mate, 0, { profile: 'older_walker', dark: true, urban: true });
  assert.equal(day.chosen.reach.cautious, 4);
  assert.equal(night.chosen.reach.cautious, 1);
  assert.equal(night.chosen.night, true);
  assert.equal(night.rows.find((r) => r.key === 'manual_wheelchair').night, false);
});

test('a hexagon with no public transport trip says so rather than showing nothing', () => {
  const mate = made();
  mate.cells.pt.interpeak.walk.nkb.c[0] = null;
  mate.cells.pt.interpeak.manual_wheelchair.nkb.c[0] = null;
  assert.equal(cardFigures(mate, 0, { profile: 'walk', urban: true }).transit.state, 'no-trip');
  assert.equal(cardFigures(made(), 0, { profile: 'walk', urban: false }).transit.state, 'not-urban');
});

test('what is recorded about kerbs and lighting is counted first', () => {
  const { cells } = made();
  const k = kerbs(cells, 0);
  assert.equal(k.total, 12);
  assert.equal(k.recorded, 5, 'a rolled kerb is recorded');
  assert.equal(k.rolled, 1);
  assert.equal(k.estimated, 2);
  assert.equal(k.junctions, 11);
  assert.equal(k.joins, 2);
  assert.equal(streets(cells, 1, 'walk'), null);
  assert.equal(narrow(cells, 0, 'pram').limit, 1.0);
  assert.equal(narrow(cells, 1, 'pram'), null);
  assert.deepEqual(lighting(cells, 0), { lit: 16, notLit: 4, recorded: 20, probably: 0, probablyNot: 0, unknown: 80, lamps: 6, police: false });
  // An export with MATE's police estimates (l4): probably not lit is its own share.
  const withPolice = { ...cells, l2: [10, null, 0], l4: [3, null, 0], l0: [67, null, 100] };
  assert.deepEqual(lighting(withPolice, 0), { lit: 16, notLit: 4, recorded: 20, probably: 10, probablyNot: 3, unknown: 67, lamps: 6, police: true });
  assert.equal(lighting(cells, 1), null);
  assert.equal(statusShares(cells, 1, 'walk'), null);
});

test('services come back from their bits, in TEAM\'s order', () => {
  assert.deepEqual(servicesIn(0b101, ['supermarket', 'gp', 'library']), ['supermarket', 'library']);
  assert.deepEqual(servicesIn(null, ['supermarket']), []);
});

test('the public transport window follows the one on screen when MATE has it', () => {
  assert.equal(ptWindow('am_peak', ['am_peak', 'interpeak', 'saturday']), 'am_peak');
  assert.equal(ptWindow(null, ['am_peak', 'interpeak', 'saturday']), 'interpeak');
  assert.equal(ptWindow(null, ['am_peak', 'interpeak', 'saturday'], 'am_peak'), 'am_peak', 'TEAM\'s jobs window when none is picked');
  assert.equal(ptWindow('sunday', ['am_peak']), 'am_peak');
});

test('the hatch tiles: stripes meet across the edges', () => {
  const img = hatchImage(12);
  assert.equal(img.data.length, 12 * 12 * 4);
  const on = (x, y) => img.data[(y * 12 + x) * 4 + 3] > 0;
  assert.equal(on(0, 0), true);
  assert.equal(on(11, 1), true, 'the stripe wraps from the right edge to the left');
  assert.equal(on(5, 0), false);
});
