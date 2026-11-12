// Stops near a school, from the 0.12.0 review: each school's nearest train
// or ferry stations beyond the 15-minute walk (`far`), as the One school
// section, its summary, the CSV lines and the map's stop tags show them.
// Mt Albert Grammar School's figures are the build's (Auckland, 15 Sep 2026).

import assert from 'node:assert/strict';
import test from 'node:test';

import { stopLabelOrder, stopLabelPlan } from '../../web/js/map.js';
import {
  decodeStops, farStopsHeading, isFarStop, stationNoun, stopLine, stopsAt, stopsCsvLines, stopsSplit, stopsSummary,
} from '../../web/js/schools.js';

const E_W = [{ route: 'E-W', mode: 'train', headsigns: ['Manukau via City Centre', 'Swanson'], trips: 23 }];
const FILE = {
  format: 1, date: '2026-09-15', window: ['07:00', '08:59'], max_walk_minutes: 15, far_walk_minutes: 30, far_most: 3,
  gtfs: 'at_gtfs_2026-09-01.zip', counts: 'arrivals',
  stops: [
    { id: '1427-e66ab0d8', code: '1427', name: 'Mount Albert Grammar School', station: false, lat: -36.8853, lon: 174.7247, served: false },
    { id: '8816-69ab520d', code: '8816', name: 'Owairaka/Mount Albert', station: false, lat: -36.8875, lon: 174.7205, served: true },
    { id: '119-de6ec4e8', code: '119', name: 'Baldwin Ave Train Station', station: true, lat: -36.8806, lon: 174.7149, served: true, mode: 'train' },
    { id: '120-848dea07', code: '120', name: 'Mt Albert Train Station', station: true, lat: -36.8866, lon: 174.7140, served: true, mode: 'train' },
    { id: '104-ff3dff29', code: '104', name: 'Morningside Train Station', station: true, lat: -36.8746, lon: 174.7354, served: true, mode: 'train' },
    { id: '133-08da14b5', code: '133', name: 'Devonport Ferry Terminal', station: true, lat: -36.8333, lon: 174.7958, served: true, mode: 'ferry' },
    { id: '9001', code: '9001', name: 'Grafton Train Station', station: true, lat: -36.8622, lon: 174.7713, served: true, mode: 'train' },
  ],
  schools: {
    // MAGS: two stops within the walk, then three train stations beyond it.
    0: [
      { s: 0, walk: 1, metres: 95, routes: [], trips: 0, board: 0 },
      { s: 1, walk: 7, metres: 501, routes: [{ route: '66', mode: 'bus', headsigns: ['Point Chevalier'], trips: 8 }], trips: 8, board: 8 },
      { s: 2, walk: 16, metres: 891, routes: E_W, trips: 23, board: 23, far: true },
      { s: 3, walk: 17, metres: 999, routes: E_W, trips: 23, board: 23, far: true },
      { s: 4, walk: 21, metres: 1392, routes: E_W, trips: 23, board: 23, far: true },
    ],
    // A station within the walk, listed as it always was, and none further.
    1: [{ s: 6, walk: 8, metres: 520, routes: E_W, trips: 23, board: 23 }],
    // No stop within the walk; a ferry stop further out.
    2: [{ s: 5, walk: 22, metres: 1500, routes: [], trips: 0, board: 0, far: true }],
    3: [],
  },
};
const MAGS = 0;

test("MAGS: its stops within 15 minutes, then Baldwin Ave, Mt Albert and Morningside train stations", () => {
  const stops = decodeStops(FILE);
  assert.equal(stops.maxWalk, 15);
  assert.equal(stops.farWalk, 30);
  const split = stopsSplit(stops, MAGS);
  assert.equal(split.near.length, 2);
  assert.deepEqual(split.far.map((row) => stops.stops[row.s].code), ['119', '120', '104']);
  assert.equal(farStopsHeading(split.far, stops), 'Nearest train stations, beyond a 15-minute walk');
  assert.deepEqual(split.far.map((row) => stopLine(row, stops)), [
    'Baldwin Ave Train Station (stop 119) · 16 min walk · 23 trips arriving 7–9am · E-W',
    'Mt Albert Train Station (stop 120) · 17 min walk · 23 trips arriving 7–9am · E-W',
    'Morningside Train Station (stop 104) · 21 min walk · 23 trips arriving 7–9am · E-W',
  ]);
  assert.equal(stopsSummary(split, stops), '2 within 15 min · 3 train stations within 30 min');
  // The CSV's header lines: the stops within the walk, then the stations.
  const csv = stopsCsvLines(stops, MAGS);
  assert.equal(csv.length, 1 + 2 + 1 + 3);
  assert.equal(csv[3], 'Nearest train stations, beyond a 15-minute walk (up to 3 within a 30-minute walk):');
  assert.equal(csv[4], 'stop 119 Baldwin Ave Train Station: train, 16 min walk, 23 trips arriving (E-W 23)');
});

test('a school with a station within the walk lists it as before, and nothing further', () => {
  const stops = decodeStops(FILE);
  const split = stopsSplit(stops, 1);
  assert.equal(split.near.length, 1);
  assert.equal(split.far.length, 0);
  assert.equal(stopLine(split.near[0], stops), 'Grafton Train Station (stop 9001) · 8 min walk · 23 trips arriving 7–9am · E-W');
  assert.equal(stopsSummary(split, stops), '1 within 15 min');
  assert.ok(!stopsCsvLines(stops, 1).some((line) => line.startsWith('Nearest')));
});

test('a ferry stop, and a school with none within the walk', () => {
  const stops = decodeStops(FILE);
  const split = stopsSplit(stops, 2);
  assert.equal(split.near.length, 0);
  assert.equal(farStopsHeading(split.far, stops), 'Nearest ferry stop, beyond a 15-minute walk');
  assert.equal(stopsSummary(split, stops), 'none within 15 min · 1 ferry stop within 30 min');
  assert.deepEqual(stopsCsvLines(stops, 2).slice(1, 3), ['No stop within a 15-minute walk.', 'Nearest ferry stop, beyond a 15-minute walk (up to 3 within a 30-minute walk):']);
  assert.equal(stopsSummary(stopsSplit(stops, 3), stops), 'none');
  assert.equal(stationNoun([split.far[0], stopsSplit(stops, MAGS).far[0]], stops), 'train stations and ferry stops');
});

test('an older stops.json, with no far stations, reads as before', () => {
  const older = decodeStops({ ...FILE, far_walk_minutes: undefined, far_most: undefined,
    schools: { 0: FILE.schools[0].slice(0, 2).map(({ far, ...row }) => row) } });
  assert.equal(older.farWalk, null);
  const split = stopsSplit(older, MAGS);
  assert.equal(split.far.length, 0);
  assert.equal(stopsSummary(split, older), '2 within 15 min');
  assert.ok(stopsAt(older, MAGS).every((row) => !isFarStop(row, older)));
  // A row past the walk is a far one, with the flag or without it.
  assert.ok(isFarStop({ walk: 16 }, older));
});

test('stop tags on the map: stations first, then the nearest stops; a tag that would overlap is a dot', () => {
  const stops = decodeStops(FILE);
  const tags = stopsAt(stops, MAGS).map((row) => ({ ...stops.stops[row.s], walk: row.walk, metres: row.metres, far: isFarStop(row, stops) }));
  assert.deepEqual(stopLabelOrder(tags).map((i) => tags[i].code), ['119', '120', '104', '1427', '8816']);
  // Three tags 18 px wide: the second sits on the first, the third clear of both.
  const items = [{ x: 100, y: 100, w: 18, h: 17 }, { x: 108, y: 104, w: 18, h: 17 }, { x: 140, y: 100, w: 18, h: 17 }];
  assert.deepEqual([...stopLabelPlan(items)], [0, 2]);
  // The school's name is drawn already: a tag under it is a dot.
  assert.deepEqual([...stopLabelPlan(items, [{ left: 130, top: 90, right: 260, bottom: 110 }])], [0]);
  assert.deepEqual([...stopLabelPlan([])], []);
});
