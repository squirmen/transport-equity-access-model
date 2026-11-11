import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { setCellMask, setUrban, times } from '../../web/js/data.js';
import { setServices } from '../../web/js/panel.js';
import { namedFor, serviceVerdict, verdictLine } from '../../web/js/place.js';
import {
  admits, applyToData, cardLines, choiceKey, choiceParams, choiceWords, chooseSchools, countingLine, decodeReach, decodeZones,
  findSchools, groupCounts, hasAttributes, isState, nearestAt, orderTies, readChoice, restoreData, schoolFacts, schoolsCsv, sexOf,
  tagOf, zoneCells,
} from '../../web/js/schools.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/schools/fixture.json', import.meta.url), 'utf8'));
const S = 'secondary_school';
const N = F.h3.length;
const D = F.destinations;
const MODES = ['walk', 'bike_low_stress', 'pt'];
const reach = Object.fromEntries(MODES.map((m) => [m, decodeReach(F.schools[`${S}_${m}`], N)]));
const zones = decodeZones(F.zones, S, N);
const run = (choice) => chooseSchools({
  destinations: D, service: S, choice: { kind: 'all', moe: null, students: 'both', zoneOnly: true, ...choice }, reach, zones, n: N, centres: F.centres,
});
const MAGS = 2;
const TKKM = 0;
const MARIST = 1;
const AGGS = 3;
const WSC = 4;
const BOYS_HIGH = 8;

// ---------------------------------------------------------------- links

test('an old link means All, and sch, stu and sz survive a round trip', () => {
  assert.deepEqual(readChoice(null, null, null), { kind: 'all', moe: null, students: 'both', zoneOnly: true });
  for (const choice of [
    { kind: 'state', moe: null, students: 'both', zoneOnly: true },
    { kind: 'state', moe: null, students: 'girls', zoneOnly: true },
    { kind: 'zone', moe: null, students: 'boys', zoneOnly: true },
    { kind: 'one', moe: 69, students: 'both', zoneOnly: true },
    { kind: 'one', moe: 69, students: 'both', zoneOnly: false },
  ]) {
    const params = new URLSearchParams(choiceParams(choice));
    assert.deepEqual(readChoice(params.get('sch'), params.get('stu'), params.get('sz')), choice, params.toString());
  }
  assert.deepEqual(choiceParams({ kind: 'all', students: 'girls' }), [], 'All writes nothing');
  assert.equal(new URLSearchParams(choiceParams({ kind: 'one', moe: 69, zoneOnly: true })).toString(), 'sch=one%3A69');
  assert.equal(readChoice('one:abc').kind, 'all', 'a malformed school number is ignored');
  assert.equal(readChoice('private').kind, 'all', 'an unknown choice is ignored');
  assert.equal(choiceKey(S, { kind: 'all' }), null);
  assert.notEqual(choiceKey(S, { kind: 'state', students: 'girls' }), choiceKey(S, { kind: 'state', students: 'boys' }));
});

// ---------------------------------------------------------------- what a school is

test('school kinds, teaching language and sex by service', () => {
  assert.ok(hasAttributes(D, S));
  assert.ok(!hasAttributes([{ name: 'Old', services: [S] }], S), 'a build before 0.12 has no kinds');
  assert.equal(isState(D[MAGS]), true);
  assert.equal(isState(D[TKKM]), false, 'all students taught in te reo Māori: not English-medium');
  assert.equal(isState(D[MARIST]), false, 'state-integrated is not State');
  assert.equal(sexOf(D[MARIST], S), 'girls');
  assert.equal(sexOf(D[6], S), 'boys', "King's College is a boys' school at Year 9");
  assert.equal(admits(D[MARIST], S, 'boys'), false);
  assert.equal(admits(D[MAGS], S, 'girls'), true);
  assert.equal(tagOf(D[TKKM], S), 'state, Māori-medium');
  assert.equal(tagOf(D[MARIST], S), "state-integrated, girls' school");
  assert.equal(tagOf(D[6], S), "private, boys' school");
  assert.equal(tagOf(D[MAGS], S), '', 'a state, English-medium co-ed school has no tag');
  assert.equal(tagOf({ ...D[MAGS], medium: 'other' }, S), 'state, Māori- or Pacific-medium');
  const counts = groupCounts(D, S);
  assert.deepEqual(counts, { all: 9, state: 5, other_medium: 1, integrated: 2, private: 1, charter: 0, unknown: 0 });
  assert.equal(groupCounts(D, S, 'girls').state, 4, 'girls: all but Boys High');
});

// ---------------------------------------------------------------- reach lists

test('reach lists decode with n + 1 offsets or n, and refuse anything else', () => {
  const ok = { format: 1, o: [0, 2, 2], d: [3, 4], m: [5, 6] };
  assert.deepEqual(Array.from(decodeReach(ok, 2).start), [0, 2, 2]);
  assert.deepEqual(Array.from(decodeReach({ ...ok, o: [0, 2] }, 2).start), [0, 2, 2]);
  assert.throws(() => decodeReach({ ...ok, o: [0] }, 2), /offsets/);
  assert.throws(() => decodeReach({ ...ok, o: [0, 3, 2] }, 2), /order|cover/);
  assert.throws(() => decodeReach({ ...ok, format: 2 }, 2), /format/);
  assert.throws(() => decodeReach({ ...ok, m: [5] }, 2), /minutes/);
});

test('All, rebuilt from the reach lists, equals the published times and nearest', () => {
  const all = run({ kind: 'all' });
  for (const m of MODES) {
    assert.deepEqual(Array.from(all.t[m], (v) => (Number.isFinite(v) ? v : null)), F.cells.t[S][m], m);
    assert.deepEqual(Array.from(all.near[m], (v) => (v < 0 ? null : v)), F.cells.nearest_mode[S][m], m);
    assert.deepEqual(Object.fromEntries(Object.entries(all.ties[m]).map(([k, v]) => [k, v])), F.cells.ties[S][m], m);
  }
});

test('times over the routing limit count as none', () => {
  const list = decodeReach({ format: 1, o: [0, 2], d: [MAGS, AGGS], m: [61, 62] }, 1);
  const out = chooseSchools({ destinations: D, service: S, choice: { kind: 'all' }, reach: { walk: list }, n: 1, standardModes: ['walk'] });
  assert.ok(Number.isNaN(out.t.walk[0]));
  assert.equal(out.near.walk[0], -1);
});

test('ties come out in the same order however the routing listed them', () => {
  const forwards = decodeReach({ format: 1, o: [0, 2], d: [WSC, MAGS], m: [20, 20] }, 1);
  const backwards = decodeReach({ format: 1, o: [0, 2], d: [MAGS, WSC], m: [20, 20] }, 1);
  const go = (list) => chooseSchools({ destinations: D, service: S, choice: { kind: 'all' }, reach: { pt: list }, n: 1, centres: [F.centres[1]], standardModes: ['pt'] });
  const a = go(forwards);
  const b = go(backwards);
  assert.equal(a.near.pt[0], b.near.pt[0]);
  assert.deepEqual(a.ties.pt[0], b.ties.pt[0]);
  assert.equal(a.near.pt[0], MAGS, 'MAGS is nearer the middle of the hexagon in a straight line');
  // With no distance to go on, the lower Ministry number comes first.
  assert.deepEqual(orderTies([MAGS, WSC], D, null), [WSC, MAGS]);
});

// ---------------------------------------------------------------- the slide's hexagon

test("the councillors' hexagon under each choice", () => {
  const all = run({ kind: 'all' });
  assert.equal(all.t.pt[0], 9);
  assert.equal(all.near.pt[0], TKKM, 'All by public transport: TKKM o Nga Maungarongo, 9 min');
  assert.equal(all.near.bike_low_stress[0], MARIST, 'All by low-stress cycling: Marist, 6 min');
  assert.equal(all.t.bike_low_stress[0], 6);

  const state = run({ kind: 'state' });
  assert.equal(state.t.pt[0], 15, 'State, girls and boys: 15 min');
  assert.equal(state.near.pt[0], MAGS);
  assert.equal(state.t.walk[0], 15, 'the 15 by public transport is a walk');

  const one = run({ kind: 'one', moe: 69 });
  assert.deepEqual([one.t.walk[0], one.t.bike_low_stress[0], one.t.pt[0]], [15, 10, 15], 'One school MAGS: walk 15, cycle 10, PT 15');
  const marist = run({ kind: 'one', moe: 70 });
  assert.equal(marist.t.pt[0], 12, 'Marist by public transport: 12');

  const zone = run({ kind: 'zone' });
  assert.equal(zone.t.pt[0], 15, 'In zone: MAGS, whose zone covers the hexagon');
  assert.equal(zone.near.pt[0], MAGS);
});

test('In zone counts a zoned school only inside its zone, and an unzoned state school everywhere', () => {
  const zone = run({ kind: 'zone' });
  // Hexagon 1 ties MAGS and Western Springs at 20 min, but only Western Springs zones it.
  assert.equal(zone.near.pt[1], WSC);
  assert.equal(zone.ties.pt[1], undefined);
  // Hexagon 4: Boys High has no scheme, so a boy counts it; AGGS zones the hexagon for a girl.
  assert.equal(zone.bySex.boys.near.pt[4], BOYS_HIGH);
  assert.equal(zone.bySex.girls.near.pt[4], AGGS);
  assert.equal(zone.counted[MAGS], 2, 'zoned: counts only in its zone');
  assert.equal(zone.counted[BOYS_HIGH], 1, 'no scheme: counts everywhere');
  assert.equal(zone.counted[MARIST], 0);
  const cells = zoneCells(zones, MAGS, N);
  assert.deepEqual(Array.from(cells.mask), [1, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(cells.cut), [0, 0, 0, 1, 0]);
});

test('girls and boys together: the slower of each one, best by each one’s own fastest way', () => {
  const state = run({ kind: 'state' });
  // Hexagon 4. A girl walks 10 min to AGGS; a boy rides 15 min to Boys High.
  assert.equal(state.bySex.girls.t.walk[4], 10);
  assert.equal(state.bySex.boys.t.pt[4], 15);
  assert.equal(state.t.walk[4], 30, 'walking: the boy is slower, 30 min to MAGS');
  assert.equal(state.t.pt[4], 20, 'public transport: the girl is slower, 20 min to AGGS');
  assert.equal(state.best[4], 15, 'best: the slower of 10 and 15, not the 20 the modes give');
  assert.equal(state.near.pt[4], AGGS, 'the school that sets the time');
  const girls = run({ kind: 'state', students: 'girls' });
  assert.equal(girls.best, null);
  assert.equal(girls.t.pt[4], 20);
  assert.equal(girls.counted[BOYS_HIGH], 0);
});

test('counts within each step, by the counting way that reaches most', () => {
  const all = run({ kind: 'all' });
  assert.equal(all.choice['10'][0], 3, 'cycling reaches Marist, TKKM and MAGS within 10');
  assert.equal(all.choice['30'][0], 5);
  const state = run({ kind: 'state' });
  assert.equal(state.choice['15'][0], 1, 'one state school within 15');
  assert.equal(state.bySex.girls.choice['10'][4], 1, 'a girl walks to AGGS in 10');
  assert.equal(state.bySex.boys.choice['10'][4], 0);
  assert.equal(state.choice['10'][4], 0, 'girls and boys: the smaller of the two counts');
  assert.ok(Math.abs(state.km[0] - 0.417) < 0.002, `straight line to MAGS ${state.km[0]}`);
});

// ---------------------------------------------------------------- swapping it in

function dataSet() {
  const pop = Float32Array.from(F.pop);
  const t = { [S]: Object.fromEntries(MODES.map((m) => [m, Float32Array.from(F.cells.t[S][m], (v) => (v == null ? NaN : v))])) };
  const data = {
    n: N,
    meta: { standard_modes: MODES, services: { [S]: { standard_minutes: 30, window: 'am_peak' } } },
    freq: { am_peak: Float32Array.from([12, 8, 0, 6, 10]) },
    activeWindow: {},
    destinations: D,
    t,
    usual: { t: { [S]: t[S].pt }, cost: { [S]: { z1: new Float32Array(N) } } },
    cost: { [S]: { z1: new Float32Array(N) } },
    km: { [S]: new Float32Array(N) },
    choice: { [S]: { 30: new Float32Array(N) } },
    nearest: F.cells.nearest,
    nearestMode: F.cells.nearest_mode,
    ties: F.cells.ties,
    pop,
    weights: { everyone: pop },
    urban: Uint8Array.from([1, 1, 0, 1, 1]),
  };
  data.everywhere = { pop: data.pop, weights: data.weights };
  return data;
}

test('a choice swaps in and back out, fares and all', () => {
  const data = dataSet();
  const before = data.t[S];
  applyToData(data, S, run({ kind: 'state' }));
  assert.equal(data.t[S].pt[0], 15);
  assert.equal(data.usual.t[S], data.t[S].pt, 'the window switch keeps the choice');
  assert.equal(data.cost[S], undefined, 'no fare layers under a choice');
  assert.equal(data.usual.cost[S], undefined);
  assert.equal(times(data, S, 'best')[4], 15, 'best reads the girls-and-boys time');
  assert.equal(namedFor(data, S, 'pt', 0)[0], MAGS);
  restoreData(data);
  assert.equal(data.t[S], before);
  assert.ok(data.cost[S]);
  assert.equal(data.best[S], undefined);
  assert.equal(times(data, S, 'best')[4], 10, 'All: the fastest way, walking to AGGS');
});

test("a zone mask and urban only work together", () => {
  const data = dataSet();
  setCellMask(data, Uint8Array.from([1, 1, 1, 0, 0]));
  assert.deepEqual(Array.from(data.pop), [217.4, 150, 80, 0, 0].map((v) => Math.fround(v)));
  setUrban(data, true);
  assert.deepEqual(Array.from(data.pop), [217.4, 150, 0, 0, 0].map((v) => Math.fround(v)));
  setCellMask(data, null);
  assert.deepEqual(Array.from(data.pop), [217.4, 150, 0, 120, 200].map((v) => Math.fround(v)));
  setUrban(data, false);
  assert.equal(data.pop, data.everywhere.pop);
});

// ---------------------------------------------------------------- the card

function cardFor(data, choice, result) {
  const service = S;
  const words = choiceWords({ short: 'Secondary school', noun: 'a secondary school', plural: 'secondary schools' }, result ? choice : null,
    choice.kind === 'one' ? D[MAGS] : null);
  const ctx = { destinations: D, service, choice, reach, result, zones: result ? zones : null, centres: F.centres, maxMinutes: 60, when: 'weekdays 7 to 9am' };
  return {
    short: words.short,
    one: Boolean(words.one),
    label: (d) => `${D[d].name}${!result && tagOf(D[d], service) ? ` (${tagOf(D[d], service)})` : ''}`,
    lines: (mode, i, named, shown) => cardLines({ ...ctx, shownMinutes: shown }, mode, i, named),
  };
}

test("the slide's card, All by public transport: the walk to TKKM, and the nearest state school", () => {
  setServices({ services: { [S]: {} } });
  const data = dataSet();
  const band = verdictLine(data, 0, S, 30, 'pt', null, cardFor(data, { kind: 'all' }, null));
  assert.equal(band.strong, 'Secondary school: 9 min on foot. No bus or train is quicker.');
  assert.equal(band.rest, 'Nearest: TKKM o Nga Maungarongo (state, Māori-medium). '
    + 'Nearest state school: Mt Albert Grammar School, 15 min on foot. The standard is 30 min.');
  const bike = verdictLine(data, 0, S, 30, 'bike_low_stress', null, cardFor(data, { kind: 'all' }, null));
  assert.equal(bike.strong, 'Secondary school: 6 min by low-stress cycling.');
  assert.match(bike.rest, /^Nearest: Marist College \(state-integrated, girls' school\)\. Nearest state school: Mt Albert Grammar School, 10 min by low-stress cycling\./);
});

test("the slide's card under State, and the schools it leaves out", () => {
  const data = dataSet();
  const choice = { kind: 'state', students: 'both' };
  const result = run(choice);
  applyToData(data, S, result);
  const band = verdictLine(data, 0, S, 30, 'pt', null, cardFor(data, choice, result));
  assert.equal(band.strong, 'State secondary school: 15 min on foot. No bus or train is quicker.');
  assert.equal(band.rest, 'Nearest: Mt Albert Grammar School. Not counted: TKKM o Nga Maungarongo, 9 min (state, Māori-medium); '
    + "Marist College, 12 min (state-integrated, girls' school). The standard is 30 min.");
  // Hexagon 4: a girl and a boy reach different schools in different times.
  const split = verdictLine(data, 4, S, 30, 'pt', null, cardFor(data, choice, result));
  assert.match(split.rest, /For a girl: Auckland Girls' Grammar School, 20 min by public transport\. For a boy: Boys High, 15 min by public transport\./);
  const best = verdictLine(data, 4, S, 30, 'best', null, cardFor(data, choice, result));
  assert.equal(best.strong, 'State secondary school: 15 min without a car.');
});

test('One school: its time by the way on screen, the spread, the zone and the nearest other state school', () => {
  const data = dataSet();
  const choice = { kind: 'one', moe: 69, students: 'both', zoneOnly: true };
  const result = run(choice);
  applyToData(data, S, result);
  const band = verdictLine(data, 0, S, 30, 'pt', null, cardFor(data, choice, result));
  assert.equal(band.strong, 'Mt Albert Grammar School: 15 min on foot. No bus or train is quicker.');
  // A walk takes the same time whenever you leave, so there is no spread to give.
  assert.equal(band.rest, 'This hexagon is in its zone. '
    + 'Nearest other state school: Western Springs College-Ngā Puna o Waiōrea, 32 min by public transport. The standard is 30 min.');
  assert.doesNotMatch(band.rest, /Nearest: Mt Albert/, 'One school does not name itself again');
  const cut = verdictLine(data, 3, S, 30, 'pt', null, cardFor(data, choice, result));
  assert.match(cut.rest, /Usually 25–33 min, depending on when you leave \(weekdays 7 to 9am, 10th to 90th percentile\)\./);
  assert.match(cut.rest, /No other state school within 60 min by public transport\./);
  assert.match(cut.rest, /Its zone line crosses this hexagon; at least half of it is in the zone\./);
  assert.match(cut.rest, /Walking is quicker: 26 min\./);
  const out = verdictLine(data, 1, S, 30, 'pt', null, cardFor(data, choice, result));
  assert.match(out.rest, /This hexagon is not in its zone\. Nearest other state school: Western Springs College-Ngā Puna o Waiōrea, 20 min by public transport\./);
});

test('ties are named together, and walking quicker is said', () => {
  const data = dataSet();
  const tie = verdictLine(data, 1, S, 30, 'pt');
  assert.equal(tie.rest, 'Nearest: Mt Albert Grammar School or Western Springs College-Ngā Puna o Waiōrea, both 20 min. The standard is 30 min.');
  const slow = verdictLine(data, 3, S, 30, 'pt');
  assert.equal(slow.strong, 'Secondary school: 27 min by public transport.');
  assert.match(slow.rest, /^Walking is quicker: 26 min\. Nearest: Marist College\./);
  const none = verdictLine(data, 2, S, 30, 'pt');
  assert.equal(none.strong, 'Secondary school: over 60 min by public transport.');
});

test('a build before 0.12 names a school only for the fastest way', () => {
  const data = { ...dataSet(), nearestMode: null, ties: null };
  assert.deepEqual(namedFor(data, S, 'bike_low_stress', 0), [MARIST], 'cycling is the fastest here');
  assert.deepEqual(namedFor(data, S, 'pt', 0), [], 'the old nearest is by cycling, so public transport names nothing');
  const band = verdictLine(data, 0, S, 30, 'pt');
  assert.equal(band.strong, 'Secondary school: 9 min on foot. No bus or train is quicker.');
  assert.doesNotMatch(band.rest, /Marist/, 'the slide named Marist beside a public transport time');
});

test('under a fare budget the priced time names nothing', () => {
  const data = dataSet();
  data.meta.fares = {};
  data.cost[S] = { z1: Float32Array.from([30, 25, NaN, 27, 15]) };
  const band = verdictLine(data, 0, S, 30, 'pt', 1);
  assert.equal(band.strong, 'Secondary school: 30 min by public transport.');
  assert.doesNotMatch(band.rest, /Nearest/);
  assert.equal(serviceVerdict(data, 0, S, 30, 'pt', 1).shown, 30);
});

// ---------------------------------------------------------------- words

test('the counting line, with counts from the data', () => {
  const plural = 'secondary schools';
  const meta = F.meta.schools;
  assert.equal(countingLine(D, S, { kind: 'all' }, { plural, meta }),
    'Counting all 9 secondary schools: 5 state, 1 state Māori- or Pacific-medium, 2 state-integrated and 1 private. '
    + 'Single-sex schools count for everyone. School list as at 12 Nov 2026.');
  assert.equal(countingLine(D, S, { kind: 'state', students: 'both' }, { plural }),
    'Counting 5 state secondary schools taught in English. Not counted: 2 state-integrated, 1 private and 1 Māori- or Pacific-medium. '
    + 'Girls and boys: both must be able to reach one they can go to, and the time is the slower of the two.');
  assert.match(countingLine(D, S, { kind: 'state', students: 'girls' }, { plural }), /Counting co-ed and girls' schools: 4 of the 5\./);
  assert.match(countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones }),
    /^Counting state secondary schools taught in English whose zone covers at least half of the hexagon \(3 of the 5 have a zone\), and the 2 with no enrolment scheme\./);
  assert.match(countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones }), /Zones as at 14 Jul 2026\./);
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: true }, { plural, zones }),
    'Counting Mt Albert Grammar School only. Only people living in its zone (in force from 6 Jun 2018) are counted.');
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: false }, { plural, zones }),
    'Counting Mt Albert Grammar School only. Everyone is counted, not only its zone.');
});

test('names for headlines and the key', () => {
  const base = { short: 'Secondary school', noun: 'a secondary school', plural: 'secondary schools' };
  assert.equal(choiceWords(base, null).noun, 'a secondary school');
  assert.equal(choiceWords(base, { kind: 'state', students: 'both' }).noun, 'a state secondary school');
  assert.equal(choiceWords(base, { kind: 'state', students: 'girls' }).noun, 'a state secondary school that takes girls');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'both' }).noun, 'an in-zone state secondary school');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'both' }).short, 'In-zone state secondary school');
  assert.equal(choiceWords(base, { kind: 'one', moe: 69 }, D[MAGS]).noun, 'Mt Albert Grammar School');
  assert.equal(choiceWords({ short: 'Intermediate', noun: 'an intermediate school', plural: 'intermediate schools' }, { kind: 'state', students: 'both' }).noun,
    'a state intermediate school');
});

test('facts about one school', () => {
  assert.deepEqual(schoolFacts(D[MAGS], S, { zone: { from: '2018-06-06' } }), [
    'State · co-ed · Years 9–15 · roll 3,635 (1 Oct 2026)',
    "Zone in force from 6 Jun 2018. Times go to the Ministry's map point for the school. Ministry number 69.",
  ]);
  assert.match(schoolFacts(D[BOYS_HIGH], S).join(' '), /No enrolment scheme\. Times go to the nearest of 2 checked entrances\./);
  assert.match(schoolFacts(D[TKKM], S)[0], /^State · co-ed · Māori-medium · Years 1–15/);
});

test('finding a school by name or number', () => {
  assert.deepEqual(findSchools(D, S, 'albert gram'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'maungarongo'), [TKKM]);
  assert.deepEqual(findSchools(D, S, 'Ngā Puna'), [WSC], 'macrons fold');
  assert.deepEqual(findSchools(D, S, '69'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'hill'), [], 'a GP is not a school');
  assert.deepEqual(findSchools(D, S, ''), []);
});

test('the CSV: one row a counted hexagon, the choice and dates in its header', () => {
  const result = run({ kind: 'one', moe: 69 });
  const text = schoolsCsv({
    h3: F.h3, pop: Float32Array.from([217.4, 0, 80, 120, 200]), placeNames: ['St Lukes', 'Mount Albert', 'X', 'Y, "Z"', 'W'],
    t: result.t, near: result.near, ties: result.ties, destinations: D, modes: MODES,
    header: ['Counting Mt Albert Grammar School only.'], extra: { in_zone: Float32Array.from([1, 0, 0, 1, 0]) },
  });
  const lines = text.trim().split('\n');
  assert.equal(lines[0], '# Counting Mt Albert Grammar School only.');
  assert.equal(lines[1], 'h3,suburb,residents,minutes_walk,moe_walk,minutes_bike_low_stress,moe_bike_low_stress,minutes_pt,moe_pt,in_zone');
  assert.equal(lines[2], '89bb50021a3ffff,St Lukes,217.4,15,69,10,69,15,69,1');
  assert.equal(lines.length, 2 + 4, 'the hexagon with nobody counted is left out');
  assert.equal(lines[4], '89bb50021b3ffff,"Y, ""Z""",120,26,69,9,69,28,69,1');
  assert.equal(lines[3], '89bb5002133ffff,X,80,,,,,,,0');
});

test('the nearest among some schools, for one hexagon', () => {
  const found = nearestAt(reach.pt, 0, (d) => isState(D[d]), { destinations: D, centre: F.centres[0] });
  assert.deepEqual(found, { m: 15, ds: [MAGS] });
  assert.equal(nearestAt(reach.pt, 2, () => true, { destinations: D }), null);
});
