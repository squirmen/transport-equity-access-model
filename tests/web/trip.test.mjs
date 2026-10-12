import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  distanceText, footRows, footSpan, FOOT_VARIANTS, kmBetween, mileRows, mileSummary, modeRows, ptCells, reachClasses,
  reachKey, reachOf, reachText, rideShape, routeFeatures, routeFor, routeWay, sliceLine, span, stopLabel, tripDrawing,
  tripMode, tripSentence, tripSteps, tripWindowOf,
} from '../../web/js/trip.js';
import { legSwap, originTimes, pairTimes, ptTrip, tripStore } from '../../web/js/trip_data.js';

// The trip tab's figures, worked out from the real Auckland files cut down by tests/fixtures/make_trip_fixture.py
// (and make_trip_lines.py for the line shapes).
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'trip');

function readFixture(file) {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (existsSync(`${file}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${file}.gz`)).toString('utf8'));
  return null;
}

const fetcher = async (folder, name) => {
  const body = readFixture(path.join(folder, `${name}.json`));
  if (!body) throw new Error(`Could not load ${name}.json (404)`);
  return body;
};

const expected = readFixture(path.join(FIX, 'pt_expected.json'));

function store() {
  const ids = Object.fromEntries(Object.entries(expected.ids).map(([k, v]) => [Number(k), v]));
  const geo = { parent: (id, res) => expected.geo[id][`r${res}`], centre: (id) => expected.geo[id].centre };
  return tripStore({ base: `${FIX}/`, ids, order: expected.order ?? null, geo, fetcher });
}

const pair = (start) => expected.pairs.find((p) => p.note.startsWith(start));

// ---------------------------------------------------------------- ranges and labels

test('a range gives no known barrier first, then the cautious figure when it differs', () => {
  assert.equal(span(3, 3), '3');
  assert.equal(span(3, 4), '3, or 4');
  assert.equal(span(11, null), '11, or none');
  assert.equal(span(null, null), 'none');
  assert.equal(span(0, 0), '0');
});

test('a route on foot reads as a range, over the limit, or a dash when no path is near an end', () => {
  const r = (minutes, reason = null) => ({ minutes, reason });
  assert.equal(footSpan(r(12), r(12)), '12');
  assert.equal(footSpan(r(12), r(15)), '12, or 15');
  assert.equal(footSpan(r(40), r(null, 'not-reached')), '40, or over 45');
  assert.equal(footSpan(r(null, 'not-reached'), r(null, 'not-reached')), 'over 45');
  assert.equal(footSpan(r(null, 'origin'), r(null, 'origin')), '–');
  assert.equal(footSpan(undefined, undefined), 'over 45');
});

test('distances, modes and windows', () => {
  // Takapuna Central to Grafton, about 7.9 km.
  assert.ok(Math.abs(kmBetween([174.7724, -36.7884], [174.7702, -36.8591]) - 7.86) < 0.05);
  assert.equal(distanceText(7.94), '7.9 km');
  assert.equal(distanceText(0.43), '450 m');
  assert.equal(tripMode('pt'), 'pt');
  assert.equal(tripMode('car'), 'best');
  assert.equal(tripMode('walk_slow'), 'best', 'TEAM times trips at the usual pace only');
  assert.equal(tripWindowOf('saturday'), 'saturday');
  assert.equal(tripWindowOf(null), 'interpeak');
  assert.equal(tripWindowOf('usual'), 'interpeak');
  assert.equal(stopLabel({ name: 'Stop A Takapuna', code: '3551' }), 'Stop A Takapuna (3551)');
  assert.equal(stopLabel({ name: 'Waitemata Train Station 2', code: null }), 'Waitemata Train Station 2');
  assert.equal(stopLabel({ name: null }), 'a stop');
  assert.ok(FOOT_VARIANTS.includes('older_walker_night') && FOOT_VARIANTS.includes('cargo_bike'));
  assert.equal(FOOT_VARIANTS.length, 9);
});

// ---------------------------------------------------------------- the modes

test('the modes table says "over 20 min" beyond TEAM\'s limit, and marks any-street cycling', async () => {
  const s = store();
  const ferry = pair('Devonport to Britomart');
  const times = await pairTimes(s, ferry.o, ferry.d);
  const rows = modeRows(times);
  assert.deepEqual(rows.map((r) => r.text), ['over 20 min', 'over 20 min', 'over 20 min']);
  assert.deepEqual(rows.map((r) => r.comparison), [false, false, true]);
  const near = pair('Newmarket to the next cell');
  const close = modeRows(await pairTimes(s, near.o, near.d));
  assert.deepEqual(close.map((r) => r.text), ['13 min', '16 min', '11 min']);
  const cells = ptCells(times, 'interpeak');
  assert.deepEqual(cells.map((c) => `${c.label} ${c.text}`), ['Peak 30', 'Off-peak 35', 'Sat 35']);
  assert.deepEqual(cells.map((c) => c.on), [false, true, false]);
  const none = ptCells(await pairTimes(s, ...['Devonport to Henderson'].map(pair).flatMap((p) => [p.o, p.d])), 'saturday');
  assert.deepEqual(none.map((c) => c.text), ['over 45', 'over 45', 'over 45']);
});

test('the live region names the fastest way that counts', async () => {
  const s = store();
  const ferry = pair('Devonport to Britomart');
  assert.equal(tripSentence(await pairTimes(s, ferry.o, ferry.d), 'interpeak', 'Off-peak'), 'Trip: 35 minutes by public transport, off-peak.');
  const near = pair('Newmarket to the next cell');
  // Walking 13, public transport 13 (walked): walking wins the tie.
  assert.equal(tripSentence(await pairTimes(s, near.o, near.d), 'interpeak', 'Off-peak'), 'Trip: 13 minutes walking.');
  const far = pair('Devonport to Henderson');
  assert.equal(tripSentence(await pairTimes(s, far.o, far.d), 'interpeak', 'Off-peak'), 'Trip: over 45 minutes without a car.');
});

// ---------------------------------------------------------------- the walker's trip

test('the typical trip adds up, names its stops and routes, and says how the change is made', async () => {
  const s = store();
  const buses = pair('Ponsonby to Britomart');
  const trip = await ptTrip(s, buses.o, buses.d, 'interpeak');
  const steps = tripSteps(trip);
  const want = buses.pt.interpeak;
  assert.equal(steps.total, Math.round(want.access + want.wait + want.ride + want.transfer + want.egress));
  assert.deepEqual(steps.parts.map((p) => p.kind), ['walk', 'wait', 'ride', 'change', 'walk']);
  assert.ok(Math.abs(steps.parts.reduce((t, p) => t + p.share, 0) - 1) < 1e-9);
  assert.equal(steps.steps[0].text, `Walk to ${want.board_name}${trip.board.code ? ` (${trip.board.code})` : ''}`);
  assert.deepEqual(steps.steps[1].routes, ['20', 'CTY']);
  assert.match(steps.steps[1].text, /^, with 3 min walking between stops: 7 min waiting, 15 on board$/);
  assert.equal(steps.steps[1].minutes, Math.round(want.between));
  assert.match(steps.steps[2].text, /^Walk from Te Komititanga/);

  const ferry = pair('Devonport to Britomart');
  const one = tripSteps(await ptTrip(s, ferry.o, ferry.d, 'interpeak'));
  assert.match(one.steps[1].text, /^: 14 min waiting, 12 on board$/, 'one ride says nothing of changing');
  assert.deepEqual(one.parts.map((p) => p.kind), ['walk', 'wait', 'ride', 'walk']);

  const walked = pair('Newmarket to the next cell');
  assert.equal(tripSteps(await ptTrip(s, walked.o, walked.d, 'interpeak')), null);
});

// ---------------------------------------------------------------- first and last mile

test('first and last mile: each profile as a range, and none where a walk is not possible', async () => {
  const s = store();
  const ferry = pair('Devonport to Britomart');
  const swap = await legSwap(s, ferry.o, ferry.d, 'interpeak');
  const rows = mileRows(swap, 'manual_wheelchair');
  assert.deepEqual(rows.map((r) => r.key), ['walk', 'older_walker', 'manual_wheelchair', 'powered_chair_scooter', 'pram', 'child']);
  const want = ferry.pt.interpeak.profiles;
  for (const r of rows) {
    const w = want[r.key];
    const round = (x) => (x == null ? null : Math.round(x));
    assert.equal(r.to, span(w.nkb.toStop, w.cautious.toStop), `${r.key} to the stop`);
    assert.equal(r.from, span(w.nkb.fromStop, w.cautious.fromStop), `${r.key} from the stop`);
    assert.equal(r.trip, span(round(w.nkb.total), round(w.cautious.total)), `${r.key} trip`);
  }
  // A manual wheelchair has no 15-minute walk from Pier 4 to the Britomart cell (MATE's data).
  const chair = rows.find((r) => r.key === 'manual_wheelchair');
  assert.equal(chair.from, 'none');
  assert.equal(chair.trip, 'none');
  assert.equal(chair.chosen, true);
  assert.equal(mileSummary(swap, 'manual_wheelchair'), 'wheelchair none');
  assert.equal(mileSummary(swap, 'walk'), `walking ${rows[0].trip}`);
  assert.equal(mileSummary(swap, 'cargo_bike'), 'cargo bike: not worked out');
});

// ---------------------------------------------------------------- the map while picking

test('the reach while picking: the fastest way, in 10, 20, 30 and 45 minutes', async () => {
  const s = store();
  const ferry = pair('Devonport to Britomart');
  const times = await originTimes(s, ferry.o);
  assert.equal(times.ptFrom, true);
  const best = reachOf(times, 'best', 'interpeak');
  assert.deepEqual(best.get(ferry.d), { minutes: 35, mode: 'pt' });
  // The origin itself, walked in no time.
  assert.deepEqual(best.get(ferry.o), { minutes: 0, mode: 'walk' });
  for (const [d, entry] of best) {
    const options = [times.walk.get(d), times.bike_low_stress.get(d), times.pt.interpeak.get(d)].filter((m) => m != null);
    assert.equal(entry.minutes, Math.min(...options), `cell ${d}`);
  }
  const walk = reachOf(times, 'walk', 'interpeak');
  assert.ok([...walk.values()].every((e) => e.mode === 'walk' && e.minutes <= 20));
  const classes = reachClasses(best, 30000);
  assert.equal(classes[ferry.d], 3, '35 minutes is in the 31 to 45 band');
  assert.equal(classes[ferry.o], 0);
  assert.equal(reachText(best.get(ferry.d), 'best'), '35 min by public transport');
  assert.equal(reachText(undefined, 'best'), 'over 45 min without a car');
  assert.equal(reachText(undefined, 'walk'), 'over 20 min walking');
  assert.deepEqual(reachKey('walk', 'Off-peak').rows.map((r) => r[2]), ['10', '20'], 'walking stops at 20 minutes');
  assert.match(reachKey('best', 'Off-peak').note, /\(off-peak\) from the hexagon picked\. Clear: over 45 minutes\.$/);
  // A rural origin: times on foot, none by public transport.
  const rural = pair('Clevedon');
  const ruralTimes = await originTimes(s, rural.o);
  assert.equal(ruralTimes.ptFrom, false);
  assert.ok(ruralTimes.walk.size > 0);
});

// ---------------------------------------------------------------- on foot, and the map

const made = (minutes, extra = {}) => ({
  minutes,
  reason: minutes == null ? 'not-reached' : null,
  metres: [820, 140, 60],
  unrecorded: 60,
  crossings: { mapped: 2, mappedUnrecorded: 1, junctions: 3, junctionsUnrecorded: 3, joins: 1, joinsUnrecorded: 1 },
  steps: 1,
  coords: [[174.79, -36.83], [174.791, -36.83], [174.792, -36.83], [174.793, -36.83]],
  runs: [{ status: 0, from: 0, to: 2 }, { status: 2, from: 2, to: 3 }],
  ...extra,
});

test('each profile on foot, after dark for the two profiles that have it', () => {
  const routes = Object.fromEntries(FOOT_VARIANTS.map((v, k) => [v, { nkb: made(10 + k), cautious: made(12 + k) }]));
  const day = footRows(routes, { chosen: 'pram' });
  assert.equal(day.length, 7);
  assert.equal(day.find((r) => r.key === 'older_walker').variant, 'older_walker');
  assert.equal(day.find((r) => r.chosen).key, 'pram');
  const night = footRows(routes, { dark: true });
  assert.equal(night.find((r) => r.key === 'older_walker').variant, 'older_walker_night');
  assert.equal(night.find((r) => r.key === 'manual_wheelchair').variant, 'manual_wheelchair');
  assert.equal(routeFor(routes, 'child', true, 'cautious'), routes.child_night.cautious);
  assert.equal(routeFor(routes, 'child', false, 'known'), routes.child.nkb, 'the map draws no known barrier unless cautious');
});

test('what a route passes, in plain lines', () => {
  const lines = routeWay(made(14));
  assert.equal(lines[0], '1.0 km on paths and streets: 820 m no known barrier, 140 m harder, 60 m not known.');
  assert.equal(lines[1], 'Crosses at 2 mapped crossings (1 with kerbs not recorded), 3 street junctions with no crossing mapped, 1 gap between footpaths, joined.');
  assert.equal(lines[2], '1 flight of steps.');
  assert.equal(lines[3], 'This route depends on 60 m nobody has recorded.');
  const clean = routeWay(made(5, { metres: [400, 0, 0], unrecorded: 0, crossings: { mapped: 0, mappedUnrecorded: 0, junctions: 0, junctionsUnrecorded: 0, joins: 0, joinsUnrecorded: 0 }, steps: 0 }));
  assert.deepEqual(clean, ['400 m on paths and streets: 400 m no known barrier.', 'No street crossings.']);
  assert.deepEqual(routeWay(made(null)), []);
});

test('a route is drawn run by run, from one hexagon\'s centre to the other\'s', () => {
  const start = [174.7895, -36.8302];
  const end = [174.7935, -36.8298];
  const features = routeFeatures(made(9), start, end);
  assert.deepEqual(features.map((f) => f.properties.status), [0, 0, 2, 0]);
  assert.deepEqual(features[0].geometry.coordinates, [start, [174.79, -36.83]]);
  assert.equal(features[1].geometry.coordinates.length, 3);
  assert.deepEqual(features.at(-1).geometry.coordinates, [[174.793, -36.83], end]);
  assert.deepEqual(routeFeatures(made(null), start, end), []);
});

test('a ride follows the line the map draws, between its two stops', async () => {
  const lines = readFixture(path.join(FIX, 'transit_lines.json'));
  const s = store();
  const ferry = pair('Devonport to Britomart');
  const trip = await ptTrip(s, ferry.o, ferry.d, 'interpeak');
  const shape = rideShape(lines, trip);
  assert.ok(shape && shape.length > 2, 'the ferry is drawn along its route');
  assert.deepEqual(shape[0], [trip.board.lon, trip.board.lat]);
  assert.deepEqual(shape.at(-1), [trip.alight.lon, trip.alight.lat]);
  const train = pair('Mt Albert to Britomart');
  const rail = rideShape(lines, await ptTrip(s, train.o, train.d, 'interpeak'));
  assert.ok(rail && rail.length > 5, 'the train is drawn along the line');
  // Two buses: no one line to follow.
  const buses = pair('Ponsonby to Britomart');
  assert.equal(rideShape(lines, await ptTrip(s, buses.o, buses.d, 'interpeak')), null);
  // A line that does not pass near both stops is not used.
  assert.equal(sliceLine([[174.7, -36.8], [174.71, -36.8]], [174.7, -36.8], [174.75, -36.9]), null);
  const sliced = sliceLine([[0, 0], [0.001, 0], [0.002, 0], [0.003, 0]], [0.0029, 0], [0.0001, 0]);
  assert.deepEqual(sliced.coords, [[0.0029, 0], [0.003, 0], [0.002, 0], [0.001, 0], [0, 0], [0.0001, 0]]);
});

test('what the map draws: walks dashed to and from the stops, the ride, both stops and the route names', async () => {
  const s = store();
  const buses = pair('Ponsonby to Britomart');
  const trip = await ptTrip(s, buses.o, buses.d, 'interpeak');
  const start = [174.745, -36.853];
  const end = [174.767, -36.844];
  const drawing = tripDrawing({ start, end, trip, show: { pt: true, foot: false } });
  assert.deepEqual(drawing.lines.map((f) => f.properties.kind), ['walk', 'ride', 'walk']);
  assert.deepEqual(drawing.lines[0].geometry.coordinates[0], start);
  assert.deepEqual(drawing.stops.map((x) => x.label), ['A', 'B']);
  assert.equal(drawing.label.text, '20 · CTY');
  const both = tripDrawing({ start, end, trip, route: made(9), show: { pt: false, foot: true } });
  assert.deepEqual(both.stops, []);
  assert.ok(both.lines.every((f) => f.properties.kind === 'route'));
  const walked = pair('Newmarket to the next cell');
  const none = tripDrawing({ start, end, trip: await ptTrip(s, walked.o, walked.d, 'interpeak'), show: { pt: true, foot: false } });
  assert.deepEqual(none, { lines: [], stops: [], label: null });
});
