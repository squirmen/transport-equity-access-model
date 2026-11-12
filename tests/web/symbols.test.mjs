// The map's symbols (web/js/symbols.js, 0.12.1): every symbol has an image
// and a key row, the glyphs match the icon files, and the stops near a
// school are grouped, badged and ordered as the map draws them. The last
// test reads Mt Albert Grammar School's stops from a built site: set
// TEAM_SITE to its data folder (it is skipped otherwise).

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { GLYPHS } from '../../web/js/glyphs.js';
import { decodeStops, nearStopWords, stopsAt } from '../../web/js/schools.js';
import {
  groupStops, IMAGES, isSymbolImage, keyRows, layerStopProperties, MODE_GLYPH, modeOf, nearStopFeatures, SERVICE_GLYPH, symbolOf,
} from '../../web/js/symbols.js';

const ICONS = new URL('../../web/assets/icons/', import.meta.url);
const SITE = process.env.TEAM_SITE ? resolve(process.env.TEAM_SITE) : null;

// Every symbol the map can draw, as the key names it: schools (symbols.js
// and map.js setSchoolPins), the stops near a school, Layers' stops and
// places, lines and areas.
const SYMBOLS = [
  'school-picked', 'zone', 'outside', 'school-on', 'school-out', 'school-other', 'walk', 'train-station', 'ferry-station',
  'bus-near', 'station-none', 'bus-none', 'bus-frequent', 'bus-other', 'rail', 'ferry', 'bus', 'cycling', 'hexagon',
];

test('glyphs.js is the icon files, one for each glyph the map uses', () => {
  const files = readdirSync(ICONS).filter((f) => f.endsWith('.svg')).sort();
  assert.deepEqual(Object.keys(GLYPHS).sort(), files.map((f) => f.replace(/\.svg$/, '')));
  for (const file of files) {
    const svg = readFileSync(new URL(file, ICONS), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, file);
    const paths = [...svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]).join(' ');
    assert.equal(GLYPHS[file.replace(/\.svg$/, '')], paths, `${file}: run python scripts/build_glyphs.py`);
  }
  const used = new Set([...Object.values(SERVICE_GLYPH), ...Object.values(MODE_GLYPH), 'directions_walk', ...Object.values(IMAGES).map((i) => i.glyph).filter(Boolean)]);
  for (const name of used) assert.ok(GLYPHS[name], `no glyph ${name}`);
  // The licence and where the files come from are kept beside them.
  assert.match(readFileSync(new URL('LICENSE', ICONS), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.match(readFileSync(new URL('README.md', ICONS), 'utf8'), /Material Icons/);
});

test('every symbol has a key row, and every key row an image', () => {
  const services = Object.fromEntries(Object.keys(SERVICE_GLYPH).map((s) => [s, s]));
  const present = new Set([...SYMBOLS, ...Object.keys(SERVICE_GLYPH).map((s) => `svc-${s}`)]);
  const rows = keyRows(present, { kind: 'zone', services });
  assert.deepEqual(new Set(rows.map((r) => r.sym)), present);
  for (const row of rows) {
    assert.ok(isSymbolImage(row.icon), `${row.sym}: no image ${row.icon}`);
    assert.ok(row.label && row.short, row.sym);
  }
  // Only what is on screen is listed, in the key's own order.
  assert.deepEqual(keyRows(new Set(['walk', 'school-picked', 'bus-near'])).map((r) => r.sym), ['school-picked', 'walk', 'bus-near']);
  assert.deepEqual(keyRows(new Set()), []);
  // Every plain shape below the glyph zoom is there for each image with a glyph.
  for (const id of Object.keys(IMAGES)) {
    if (IMAGES[id].glyph && id !== 'school-picked') assert.ok(IMAGES[`${id}-dot`], `${id}-dot`);
  }
  assert.ok(isSymbolImage('walk-7') && isSymbolImage('walk-21') && isSymbolImage('name-3301'));
  assert.ok(!isSymbolImage('walk-') && !isSymbolImage('svc-nothing'));
});

test('the key says what a school pin does under each choice', () => {
  const label = (kind, opts = {}) => keyRows(new Set(['school-on', 'school-other']), { kind, ...opts }).map((r) => r.label);
  assert.deepEqual(label('pick'), ['Schools: click one to show only it', 'Other schools: click one to show only it']);
  assert.deepEqual(label('pick', { touch: true }), ['Schools: tap one to show only it', 'Other schools: tap one to show only it']);
  assert.equal(label('zone')[0], 'School counted');
  assert.equal(label('all')[0], 'School');
  const picked = keyRows(new Set(['school-picked', 'bus-none']), { school: 'Mt Albert Grammar School', hours: '7–9am' });
  assert.deepEqual(picked.map((r) => r.label), ['Mt Albert Grammar School', 'Stop with no trips arriving 7–9am']);
});

test('a rendered feature names its symbol', () => {
  assert.equal(symbolOf({ layer: { id: 'near-badge' }, properties: {} }), 'walk');
  assert.equal(symbolOf({ layer: { id: 'picked-name' }, properties: {} }), 'school-picked');
  assert.equal(symbolOf({ layer: { id: 'school-zone-line' }, properties: {} }), 'zone');
  assert.equal(symbolOf({ layer: { id: 'dest-out' }, properties: { sym: 'school-other' } }), 'school-other');
  assert.equal(symbolOf({ layer: { id: 'places' }, properties: {} }), 'places');
});

test('stops by mode: route types, and the Stops layer\'s kinds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 109, 700, 1000].map(modeOf), ['train', 'train', 'train', 'bus', 'ferry', 'train', 'bus', 'ferry']);
  assert.deepEqual(layerStopProperties('rail_ferry', 'ferry'), { img: 'ferry-on', sym: 'ferry-station', mode: 'ferry', station: 1 });
  assert.deepEqual(layerStopProperties('rail_ferry', null), { img: 'train-on', sym: 'train-station', mode: 'train', station: 1 });
  assert.deepEqual(layerStopProperties('frequent'), { img: 'bus-on', sym: 'bus-frequent', mode: 'bus', station: 0 });
  assert.deepEqual(layerStopProperties('other'), { img: 'bus-few', sym: 'bus-other', mode: 'bus', station: 0 });
});

test('two stops of the same name either side of a road are one symbol, a third far off is not', () => {
  const stops = {
    stops: [
      { name: 'Ferndale House', code: '8226', lat: -36.8810, lon: 174.7300, served: true },
      { name: 'Ferndale House', code: '8229', lat: -36.8813, lon: 174.7302, served: true },
      { name: 'Ferndale House', code: '9999', lat: -36.8900, lon: 174.7400, served: true },
      { name: 'Other', code: '1', lat: -36.8811, lon: 174.7301, served: false },
    ],
    counts: 'arrivals',
    window: ['07:00', '08:59'],
  };
  const rows = [
    { s: 0, walk: 7, metres: 520, trips: 17, routes: [{ route: 'OUT', mode: 'bus' }, { route: '22N', mode: 'bus' }] },
    { s: 1, walk: 8, metres: 560, trips: 36, routes: [{ route: '22R', mode: 'bus' }, { route: '209', mode: 'bus' }] },
    { s: 2, walk: 14, metres: 990, trips: 4, routes: [] },
    { s: 3, walk: 7, metres: 500, trips: 0, routes: [] },
  ];
  assert.deepEqual(groupStops(rows, stops), [[0, 1], [2], [3]]);
  const [pair, far, other] = nearStopFeatures(rows, stops, { lon: 174.72, lat: -36.88 });
  assert.equal(pair.properties.ks, '0,1');
  assert.equal(pair.properties.badge, 'walk-7');
  assert.equal(pair.properties.sym, 'bus-near');
  assert.equal(far.properties.ks, '2');
  assert.equal(other.properties.sym, 'bus-none');
  assert.deepEqual(nearStopWords([rows[0], rows[1]], stops), {
    title: 'Ferndale House (stops 8226 and 8229)', mode: 'bus',
    lines: ['2 bus stops · 7–8 min walk to the school', '53 trips arriving 7–9am: OUT, 22N, 22R, 209'],
  });
});

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const auckland = SITE ? join(SITE, 'auckland') : null;
const noSite = !SITE ? 'set TEAM_SITE to a built site\'s data folder'
  : existsSync(join(auckland, 'schools', 'stops.json')) ? false : `no stops.json at ${auckland}`;

test('Mt Albert Grammar School: 35 stops, 23 symbols below the zoom where pairs part', { skip: noSite }, () => {
  const destinations = read(join(auckland, 'destinations.json'));
  const d = destinations.findIndex((x) => x.moe === 69 && (x.services || []).includes('secondary_school'));
  assert.ok(d >= 0);
  const stops = decodeStops(read(join(auckland, 'schools', 'stops.json')));
  const rows = stopsAt(stops, d);
  assert.equal(rows.length, 35);
  const school = destinations[d];
  const all = nearStopFeatures(rows, stops, school, { grouped: false });
  const grouped = nearStopFeatures(rows, stops, school, { grouped: true });
  assert.equal(all.length, 35);
  assert.equal(grouped.length, 23);
  // Every stop is in exactly one symbol.
  const members = grouped.flatMap((f) => f.properties.ks.split(',').map(Number)).sort((a, b) => a - b);
  assert.deepEqual(members, rows.map((row, k) => k));
  // Stations get their badges first.
  const order = [...grouped].sort((a, b) => a.properties.place - b.properties.place);
  const stations = grouped.filter((f) => f.properties.station === 1).length;
  assert.ok(stations >= 3);
  assert.ok(order.slice(0, stations).every((f) => f.properties.station === 1));
  // Badges on the side away from the school.
  for (const f of grouped) {
    const [lon] = f.geometry.coordinates;
    assert.equal(f.properties.side, lon < school.lon ? 'L' : 'R');
  }
  // No trips arriving 7–9am: 1427, 1429, 8870 and the Asquith Avenue pair.
  const codeOf = (f) => f.properties.ks.split(',').map((k) => stops.stops[rows[Number(k)].s].code).sort().join('+');
  const none = grouped.filter((f) => f.properties.sym === 'bus-none').map(codeOf).sort();
  for (const code of ['1427', '1429', '8870', '8867+8872']) assert.ok(none.includes(code), `${code} in ${none}`);
});
