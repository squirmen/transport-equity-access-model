// The 0.12.0 review: secondary school in two stages, designated character
// schools, who One school counts, the card's rows on other services, stops
// near a school and the jobs wording.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ageWords, schoolAgeKey, splitKey } from '../../web/js/ages.js';
import { ageArray, setAgeGroup } from '../../web/js/data.js';
import { MODES, PT_SHORT_OR_WALK, setTransit, transit } from '../../web/js/format.js';
import { jobsTile, rowWords } from '../../web/js/place.js';
import {
  ALL_CHOICE, cardLines, chooseSchools, countingLine, decodeReach, decodeStops, integratedZoneNote, isInZoneSchool, isState, stagesFor,
  stopLine, stopsCsvLines, stopsIntro, tagOf, teachesStage,
} from '../../web/js/schools.js';

const S = 'secondary_school';
const school = (name, years, extra = {}) => ({
  name, moe: extra.moe ?? name.length, kind: 'state', language: 'english', medium: 'english', services: [S], years,
  sex: { [S]: 'co-ed' }, scheme: false, lat: -36.7, lon: 174.7, ...extra,
});

// Albany: a junior high (Years 7–10), a senior high (11–15), a Years 9–15
// college further away, and a designated character school (Vanguard, 11–15).
const JUNIOR = 0;
const SENIOR = 1;
const COLLEGE = 2;
const VANGUARD = 3;
const D = [
  school('Albany Junior High School', [7, 10], { moe: 6948 }),
  school('Albany Senior High School', [11, 15], { moe: 563 }),
  school('Long Bay College', [9, 15], { moe: 37 }),
  school('Vanguard Military School', [11, 15], { moe: 854, character: 'designated' }),
];
// Two hexagons, on foot: 0 is near Albany, 1 near Long Bay.
const list = (rows) => decodeReach({
  format: 1, o: [0, rows[0].length, rows[0].length + rows[1].length], d: rows.flat().map((r) => r[0]), m: rows.flat().map((r) => r[1]),
}, 2);
const walk = list([[[VANGUARD, 8], [JUNIOR, 10], [SENIOR, 15], [COLLEGE, 25]], [[COLLEGE, 12], [JUNIOR, 20], [SENIOR, 30]]]);
const reach = { walk, bike_low_stress: walk, pt: walk };
const run = (choice, dests = D) => chooseSchools({ destinations: dests, service: S, choice: { ...ALL_CHOICE, ...choice }, reach, n: 2 });

test('secondary school in two stages: a Years 9–10 and a Years 11–13 student must each reach a school that teaches them', () => {
  assert.deepEqual(stagesFor(D, S), ['junior', 'senior']);
  assert.equal(stagesFor(D.filter((d) => d.years[0] === 9), S), null, 'no split where every school teaches both stages');
  assert.equal(stagesFor(D, 'primary_school'), null);
  assert.ok(teachesStage(D[JUNIOR], S, 'junior') && !teachesStage(D[JUNIOR], S, 'senior'));
  assert.ok(!teachesStage(D[SENIOR], S, 'junior') && teachesStage(D[SENIOR], S, 'senior'));
  assert.ok(teachesStage(D[COLLEGE], S, 'junior') && teachesStage(D[COLLEGE], S, 'senior'));

  const all = run({ kind: 'all' });
  assert.equal(all.t.walk[0], 8, 'All counts any school that teaches any of the years');
  assert.equal(all.groups, null);

  const state = run({ kind: 'state' });
  // Hexagon 0: Years 9–10 walk 10 min to the junior high; Years 11–13 8 min to Vanguard (State counts it).
  assert.equal(state.t.walk[0], 10);
  assert.equal(state.near.walk[0], JUNIOR, 'the slower student names the school');
  assert.equal(state.groups.length, 4, 'girls and boys, each in two stages');
  assert.deepEqual(state.groups.map((g) => [g.students, g.stage]), [['girls', 'junior'], ['girls', 'senior'], ['boys', 'junior'], ['boys', 'senior']]);
  assert.equal(state.bySex.girls.t.walk[0], 10, 'each sex is the slower of its two stages');
  assert.equal(state.t.walk[1], 12, 'Long Bay College takes both stages');

  const zone = chooseSchools({ destinations: D, service: S, choice: { ...ALL_CHOICE, kind: 'zone' }, reach, zones: null, n: 2 });
  // In zone leaves Vanguard out: Years 11–13 walk 15 min to the senior high.
  assert.equal(zone.t.walk[0], 15);
  assert.equal(zone.near.walk[0], SENIOR);
  assert.equal(zone.best[0], 15, 'best is the slowest of each group’s own fastest');

  // Under All a junior high can be the nearest for a 16-year-old: its name says its years.
  assert.equal(tagOf(D[JUNIOR], S, { years: true }), 'Years 7–10');
  assert.equal(tagOf(D[SENIOR], S, { years: true }), 'Years 11–13');
  assert.equal(tagOf(D[COLLEGE], S, { years: true }), '');
  assert.equal(tagOf(D[JUNIOR], S), '', 'without years the tag is kind, language and sex only');
  const lines = cardLines({ destinations: D, service: S, choice: { ...ALL_CHOICE, kind: 'zone' }, reach, result: zone, maxMinutes: 60 }, 'walk', 0, [SENIOR]);
  assert.match(lines.join(' '), /For a girl in Years 9–10: Albany Junior High School, 10 min on foot\. For a girl in Years 11–13: Albany Senior High School, 15 min on foot\./);
});

test('designated character schools: counted under State, left out of In zone, and named in its counting line', () => {
  assert.ok(isState(D[VANGUARD]));
  assert.ok(!isInZoneSchool(D[VANGUARD]));
  assert.ok(isInZoneSchool(D[COLLEGE]));
  const line = countingLine(D, S, { ...ALL_CHOICE, kind: 'zone' }, { plural: 'secondary schools', zones: { schools: {}, source: null } });
  assert.match(line, /Nor is Vanguard Military School: designated character school, whose board may decline a student whose family does not accept its character\./);
  assert.match(line, /1 school here stops at Year 10 and 2 start at Year 11/);
  const state = countingLine(D, S, { ...ALL_CHOICE, kind: 'state' }, { plural: 'secondary schools' });
  assert.doesNotMatch(state, /Vanguard/);
});

test('One school counts the ages its years cover, and only girls at a girls’ school, at the place’s share', () => {
  const meta = {
    ages: {
      groups: {
        '13_17': { label: 'children aged 13–17', years: 'Years 9–13', ages: [13, 17] },
        '13_14': { label: 'children aged 13–14', years: 'Years 9–10', ages: [13, 14] },
        '15_17': { label: 'children aged 15–17', years: 'Years 11–13', ages: [15, 17] },
      },
      services: { [S]: '13_17' },
      sex: { girls: { '13_17': 0.49, '13_14': 0.48, '15_17': 0.5 } },
    },
  };
  const data = { meta, ages: { '13_17': Float32Array.from([10, 20]), '13_14': Float32Array.from([4, 8]) } };
  assert.equal(schoolAgeKey(meta, data.ages, S, D[SENIOR]), '15_17');
  assert.equal(schoolAgeKey(meta, data.ages, S, D[JUNIOR]), '13_14');
  assert.equal(schoolAgeKey(meta, data.ages, S, D[COLLEGE]), '13_17');
  const girls = school('Marist College', [7, 15], { kind: 'integrated', sex: { [S]: 'girls' } });
  assert.equal(schoolAgeKey(meta, data.ages, S, girls), '13_17:girls');
  assert.deepEqual(splitKey('13_17:girls'), { group: '13_17', sex: 'girls' });
  assert.deepEqual([...ageArray(data, '15_17')], [6, 12], '15–17 is 13–17 less 13–14');
  assert.deepEqual([...ageArray(data, '13_17:girls')].map((v) => Math.round(v * 100) / 100), [4.9, 9.8]);
  assert.deepEqual([...ageArray(data, '15_17:boys')], [3, 6]);
  const words = ageWords(meta, '13_17:girls');
  assert.equal(words.many, 'girls aged 13–17');
  assert.equal(words.one, 'girl aged 13–17');
  assert.match(words.line, /Girls are 49% of the children aged 13–17 in this place \(2018 Census\), and are taken to live where the others do\./);
  assert.equal(ageWords(meta, '15_17').many, 'children aged 15–17');
  // The weights follow the key.
  const counted = { ...data, shares: {}, everywhere: { pop: Float32Array.from([100, 200]), weights: {} } };
  assert.ok(setAgeGroup(counted, '13_17:girls'));
  assert.deepEqual([...counted.pop].map((v) => Math.round(v * 100) / 100), [4.9, 9.8]);
});

test('a state-integrated school’s zone is not a right to enrol', () => {
  assert.match(integratedZoneNote({ kind: 'integrated' }), /^State-integrated: it takes children whose families accept its special character first/);
  assert.equal(integratedZoneNote({ kind: 'state' }), null);
});

test("One school's card: the nearest other school takes the same students, and leaves designated schools out", () => {
  const boys = school('Christchurch Boys’ High School', [9, 15], { moe: 327, sex: { [S]: 'boys' } });
  const girls = school('Christchurch Girls’ High School', [9, 15], { moe: 328, sex: { [S]: 'girls' } });
  const coed = school('Hagley College', [9, 15], { moe: 336 });
  const far = school('Riccarton High School', [9, 15], { moe: 340 });
  const dests = [boys, girls, coed, far];
  const foot = decodeReach({ format: 1, o: [0, 4], d: [0, 1, 2, 3], m: [5, 20, 25, 30] }, 1);
  const ctx = { destinations: dests, service: S, choice: { ...ALL_CHOICE, kind: 'one', moe: 327 }, reach: { walk: foot }, maxMinutes: 60 };
  assert.match(cardLines(ctx, 'walk', 0).join(' '), /Nearest other state school taught in English that takes boys: Hagley College, 25 min on foot\./);
  coed.character = 'designated';
  assert.match(cardLines(ctx, 'walk', 0).join(' '), /that takes boys: Riccarton High School, 30 min on foot\./, 'a designated character school is left out');
  const atCoed = { ...ctx, choice: { ...ALL_CHOICE, kind: 'one', moe: 340 } };
  assert.match(cardLines(atCoed, 'walk', 0).join(' '), /No other state school taught in English, co-ed within 60 min on foot\./, 'a girls’ school is not offered to a co-ed school');
});

test("the St Lukes card on another service: the secondary row names the school reached the way it shows, and says all schools", () => {
  setTransit({ pt_or_walk: { rule: 'x' } });
  assert.equal(MODES.pt.short, PT_SHORT_OR_WALK);
  const destinations = [
    { name: 'TKKM o Ngā Maungarongo', kind: 'state', language: 'maori', medium: 'other', services: [S], sex: { [S]: 'co-ed' } },
    { name: 'Marist College', kind: 'integrated', language: 'english', medium: 'english', services: [S], sex: { [S]: 'girls' } },
  ];
  const data = {
    meta: { standard_modes: ['walk', 'bike_low_stress', 'pt'], services: { [S]: { window: 'am_peak' } } },
    destinations,
    t: { [S]: { walk: [9], bike_low_stress: [6], pt: [9], bike: [5], car: [3] } },
    nearestMode: { [S]: { walk: [0], bike_low_stress: [1], pt: [0], bike: [1], car: [1] } },
    ties: {},
    km: { [S]: [0.6] },
  };
  const row = rowWords(data, 0, S, 30, 'pt');
  assert.equal(row.name, 'Secondary school, all schools');
  assert.equal(row.time, '9 min · on foot');
  assert.equal(row.nearest, 'Nearest on foot: TKKM o Ngā Maungarongo (state, Māori-medium)');
  assert.doesNotMatch(row.nearest, /Marist/, 'the 9-minute walk is never paired with Marist College');
  assert.equal(row.fastest, "Fastest without a car: low-stress cycling, 6 min, within the 30-minute standard, to Marist College (state-integrated, girls' school).");
  const chosen = rowWords(data, 0, S, 30, 'pt', null, { short: 'State secondary school, in zone', choice: true, label: (k) => destinations[k].name });
  assert.equal(chosen.name, 'State secondary school, in zone');
});

test('jobs: a tie with walking is on foot, and public transport says it takes the walk', () => {
  setTransit({ pt_or_walk: { rule: 'x' } });
  assert.ok(transit.orWalk);
  const data = { meta: { jobs: { total: 10000 } }, jobs: { pt: { 45: [46.59, 50] }, walk: { 45: [46.59, 20] }, bike_low_stress: { 45: [10, 10] } } };
  assert.equal(jobsTile(data, 0).label, 'jobs in 45 min on foot', 'Blenheim: the public transport figure is the walk');
  assert.equal(jobsTile(data, 1).label, 'jobs in 45 min by public transport or on foot');
  setTransit(null);
  assert.equal(MODES.pt.short, 'public transport');
});

test('stops near a school: trips arriving, stop numbers for stations, and no trips in the window', () => {
  const stops = decodeStops({
    format: 1, date: '2026-09-15', window: ['07:00', '08:59'], max_walk_minutes: 15, gtfs: 'metlink.zip', counts: 'arrivals',
    stops: [
      { id: '3959', code: '3959', name: 'Tawa College (school stop)', station: false, served: true },
      { id: '11287-x', code: '11287', name: 'St Lukes', station: true, served: true },
      { id: '11512-x', code: '11512', name: 'St Lukes', station: true, served: true },
      { id: '8867', code: '8867', name: 'Asquith Avenue', station: false, served: true },
    ],
    schools: {
      0: [
        { s: 0, walk: 1, metres: 60, routes: [{ route: '402', mode: 'bus', headsigns: ['School Bus'], trips: 1 }], trips: 1 },
        { s: 1, walk: 13, metres: 900, routes: [{ route: '65', mode: 'bus', headsigns: [], trips: 15 }], trips: 15 },
        { s: 2, walk: 14, metres: 950, routes: [{ route: '22N', mode: 'bus', headsigns: [], trips: 14 }], trips: 14 },
        { s: 3, walk: 12, metres: 800, routes: [], trips: 0 },
      ],
    },
  });
  assert.match(stopsIntro(stops), /Buses and trains arriving between 7am and 9am on Tuesday 15 September 2026, where students can get off\./);
  const rows = stops.schools[0].map((row) => stopLine(row, stops));
  assert.equal(rows[0], 'Tawa College (school stop) (stop 3959) · 1 min walk · 1 trip arriving 7–9am · 402', 'a school bus that sets down at the school counts');
  assert.equal(rows[1], 'St Lukes (stop 11287) · 13 min walk · 15 trips arriving 7–9am · 65');
  assert.equal(rows[2], 'St Lukes (stop 11512) · 14 min walk · 14 trips arriving 7–9am · 22N', 'two stations called St Lukes can be told apart');
  assert.equal(rows[3], 'Asquith Avenue (stop 8867) · 12 min walk · no trips arriving 7–9am in the timetable used');
  const csv = stopsCsvLines(stops, 0);
  assert.match(csv[0], /trips arriving 7am-9am on Tuesday 15 September 2026, metlink\.zip/);
  assert.ok(csv.some((line) => line === 'stop 8867 Asquith Avenue: no trips in window, 12 min walk, 0 trips arriving'), 'a stop served on other days is not "no service"');
});
