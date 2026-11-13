// Stops near a school, from the 0.12.0 review: each school's nearest train
// or ferry stations beyond the 15-minute walk (`far`), as the One school
// section, its summary, the CSV lines and the map's stop symbols show them.
// Mt Albert Grammar School's figures are the build's (Auckland, 15 Sep 2026).
// From the 0.12.1 review: the summary counts the stops with trips and names
// the nearest station, near or far; a stop with no trips has no badge; the
// nearest station's badge and the nearest stop's always show.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeStops, farStopsHeading, isFarStop, nearByService, nearStopWords, stationNoun, stopImage, stopLine, stopListName, stopsAt, stopsCsvLines, stopsSplit,
  stopsSummary, stopSymbol,
} from '../../web/js/schools.js';
import { nearStopFeatures } from '../../web/js/symbols.js';

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
    // A bus stop named like a station, by Mt Albert Train Station.
    { id: '8233-x', code: '8233', name: 'Mount Albert Station', station: false, lat: -36.8862, lon: 174.7143, served: true },
    { id: '9300-x', code: '9300', name: 'Maungawhau Train Station', station: true, lat: -36.8675, lon: 174.7584, served: true, mode: 'train' },
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
    // St Peter's College: a station within the walk and another beyond it.
    4: [
      { s: 6, walk: 5, metres: 240, routes: E_W, trips: 32, board: 32 },
      { s: 7, walk: 6, metres: 400, routes: [{ route: '22N', mode: 'bus', headsigns: ['City'], trips: 4 }], trips: 4, board: 4 },
      { s: 8, walk: 18, metres: 1300, routes: E_W, trips: 39, board: 39, far: true },
    ],
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
  // No station within the walk, so the stations beyond it are not "other" ones.
  assert.equal(farStopsHeading(split.far, stops, split.near), 'Train stations, 15–30 min walk');
  assert.deepEqual(split.far.map((row) => stopLine(row, stops)), [
    'Baldwin Ave Train Station (stop 119) · 16 min walk · 23 trips arriving 7–9am · E-W',
    'Mt Albert Train Station (stop 120) · 17 min walk · 23 trips arriving 7–9am · E-W',
    'Morningside Train Station (stop 104) · 21 min walk · 23 trips arriving 7–9am · E-W',
  ]);
  // Only the stop with trips counts, and the nearest station is named.
  assert.equal(stopsSummary(split, stops), '1 stop with trips within 15 min · nearest train station: Baldwin Ave Train Station, 16 min');
  // The stop with no trips is listed after the one with trips.
  const { served, none } = nearByService(split);
  assert.deepEqual(served.map((row) => stops.stops[row.s].code), ['8816']);
  assert.deepEqual(none.map((row) => stops.stops[row.s].code), ['1427']);
  // The CSV's header lines: the stops within the walk, then the stations.
  const csv = stopsCsvLines(stops, MAGS);
  assert.equal(csv.length, 1 + 2 + 1 + 3);
  assert.match(csv[0], /^Stops within a 15-minute walk of the school's point on the map/);
  assert.equal(csv[3], 'Train stations, 15–30 min walk (up to 3 within a 30-minute walk):');
  assert.equal(csv[4], 'stop 119 Baldwin Ave Train Station: train, 16 min walk, 23 trips arriving (E-W 23)');
});

test('a school with a station within the walk lists it as before, and nothing further', () => {
  const stops = decodeStops(FILE);
  const split = stopsSplit(stops, 1);
  assert.equal(split.near.length, 1);
  assert.equal(split.far.length, 0);
  assert.equal(stopLine(split.near[0], stops), 'Grafton Train Station (stop 9001) · 8 min walk · 23 trips arriving 7–9am · E-W');
  assert.equal(stopsSummary(split, stops), '1 stop with trips within 15 min · nearest train station: Grafton Train Station, 8 min');
  assert.ok(!stopsCsvLines(stops, 1).some((line) => /train stations?, 15/i.test(line)));
});

test("St Peter's College: the nearest station is the one within the walk, not the one beyond it", () => {
  // The 0.12.1 review: the summary said "1 train station within 30 min" with
  // Grafton 5 min away, and the heading over Maungawhau read as the nearest.
  const stops = decodeStops(FILE);
  const split = stopsSplit(stops, 4);
  assert.equal(split.near.length, 2);
  assert.equal(split.far.length, 1);
  assert.equal(stopsSummary(split, stops), '2 stops with trips within 15 min · nearest train station: Grafton Train Station, 5 min');
  assert.equal(farStopsHeading(split.far, stops, split.near), 'Other train station, 15–30 min walk');
  assert.equal(stopsCsvLines(stops, 4).find((line) => line.startsWith('Other')), 'Other train station, 15–30 min walk (up to 3 within a 30-minute walk):');
});

test('a bus stop named like a station says it is a bus stop', () => {
  const stops = decodeStops({ ...FILE, schools: { 0: [{ s: 7, walk: 9, metres: 700, routes: [{ route: '66', mode: 'bus', trips: 3 }], trips: 3, board: 3 }] } });
  const [row] = stopsAt(stops, 0);
  assert.equal(stopListName(row, stops), 'Mount Albert Station (bus stop 8233)');
  assert.match(stopLine(row, stops), /^Mount Albert Station \(bus stop 8233\) · 9 min walk/);
  assert.equal(nearStopWords([row], stops).title, 'Mount Albert Station (bus stop 8233)');
  // A train station keeps its plain stop number.
  const train = decodeStops(FILE);
  assert.equal(stopListName(stopsAt(train, 1)[0], train), 'Grafton Train Station (stop 9001)');
});

test('a ferry terminal, and a school with none within the walk', () => {
  const stops = decodeStops(FILE);
  const split = stopsSplit(stops, 2);
  assert.equal(split.near.length, 0);
  // "Ferry terminal", as the map's key names it (0.12.1; "ferry stop" before).
  assert.equal(farStopsHeading(split.far, stops, split.near), 'Ferry terminal, 15–30 min walk');
  assert.equal(stopsSummary(split, stops), 'no stop with trips within 15 min · nearest ferry terminal: Devonport Ferry Terminal, 22 min, no trips 7–9am');
  assert.deepEqual(stopsCsvLines(stops, 2).slice(1, 3), ['No stop within a 15-minute walk.', 'Ferry terminal, 15–30 min walk (up to 3 within a 30-minute walk):']);
  assert.equal(stopsSummary(stopsSplit(stops, 3), stops), 'no stop with trips within 15 min');
  assert.equal(stationNoun([split.far[0], stopsSplit(stops, MAGS).far[0]], stops), 'train stations and ferry terminals');
});

test('an older stops.json, with no far stations, reads as before', () => {
  const older = decodeStops({ ...FILE, far_walk_minutes: undefined, far_most: undefined,
    schools: { 0: FILE.schools[0].slice(0, 2).map(({ far, ...row }) => row) } });
  assert.equal(older.farWalk, null);
  const split = stopsSplit(older, MAGS);
  assert.equal(split.far.length, 0);
  assert.equal(stopsSummary(split, older), '1 stop with trips within 15 min');
  // Without a far walk the heading says only beyond the walk.
  assert.equal(farStopsHeading([FILE.schools[0][2]], older), 'Train station beyond a 15-minute walk');
  assert.ok(stopsAt(older, MAGS).every((row) => !isFarStop(row, older)));
  // A row past the walk is a far one, with the flag or without it.
  assert.ok(isFarStop({ walk: 16 }, older));
});

test('stops on the map: each a symbol for its mode and trips, its walking badge away from the school', () => {
  const stops = decodeStops(FILE);
  const rows = stopsAt(stops, MAGS);
  assert.deepEqual(rows.map((row) => stopSymbol(row, stops)), ['bus-none', 'bus-near', 'train-station', 'train-station', 'train-station']);
  const school = { lon: 174.7253, lat: -36.8847 };
  const features = nearStopFeatures(rows, stops, school, { grouped: false });
  assert.equal(features.length, 5);
  const props = features.map((f) => f.properties);
  assert.deepEqual(props.map((p) => p.img), ['bus-none', 'bus-on', 'train-on', 'train-on', 'train-on']);
  assert.deepEqual(rows.map((row) => stopImage(row, stops)), ['bus-none', 'bus-on', 'train-on', 'train-on', 'train-on']);
  // A stop with no trips at all has no badge: it is no way to get to school.
  assert.deepEqual(props.map((p) => p.badge), ['', 'walk-7', 'walk-16', 'walk-17', 'walk-21']);
  // The nearest station's badge and the nearest bus stop's with trips always show.
  assert.deepEqual(props.map((p) => p.must), [0, 1, 1, 0, 0]);
  // Stations get their badges first, then the quickest walks.
  const placed = [...props].sort((a, b) => a.place - b.place).map((p) => p.walk);
  assert.deepEqual(placed, [16, 17, 21, 1, 7]);
  // Drawn on top: stations, then stops with trips, quicker walks over slower.
  const drawn = [...props].sort((a, b) => b.draw - a.draw).map((p) => p.walk);
  assert.deepEqual(drawn, [16, 17, 21, 7, 1]);
  // A badge goes on the side of its stop away from the school.
  assert.deepEqual(props.map((p) => p.side), ['L', 'L', 'L', 'L', 'R']);
  // What a stop says when hovered or tapped.
  assert.deepEqual(nearStopWords([rows[0]], stops), {
    title: 'Mount Albert Grammar School (stop 1427)', mode: 'bus',
    lines: ['Bus stop · 1 min walk to the school (95 m)', 'No trips on any day in the timetable used'],
  });
  assert.deepEqual(nearStopWords([rows[2]], stops).lines, ['Train station · 16 min walk to the school (891 m)', '23 trips arriving 7–9am: E-W']);
  assert.deepEqual(nearStopFeatures([], stops, school), []);
  // A walk rounded down to 0 is under a minute.
  const zero = { ...rows[1], walk: 0 };
  assert.match(stopLine(zero, stops), / · under 1 min walk · /);
  assert.equal(nearStopWords([zero], stops).lines[0], 'Bus stop · under 1 min walk to the school (501 m)');
});

test('a station with no trips in the window is drawn and keyed in its own mode', () => {
  // St Mary's College (Ponsonby): Hamer Street Ferry Terminal has no morning
  // sailings; it is a hollow ferry, and its key row shows a ferry, not a train.
  const stops = decodeStops(FILE);
  const [row] = stopsAt(stops, 2);
  assert.equal(stopSymbol(row, stops), 'ferry-none');
  assert.equal(stopImage(row, stops), 'ferry-none');
  const [f] = nearStopFeatures([row], stops, { lon: 174.79, lat: -36.84 });
  assert.equal(f.properties.badge, '');
  assert.equal(f.properties.must, 0);
});
