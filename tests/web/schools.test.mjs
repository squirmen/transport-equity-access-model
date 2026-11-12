import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { setCellMask, setUrban, times } from '../../web/js/data.js';
import { setServices } from '../../web/js/panel.js';
import { namedFor, serviceVerdict, tooltipLines, tripWords, verdictLine } from '../../web/js/place.js';
import {
  admits, applyToData, cardLines, choiceKey, choiceParams, choiceWords, chooseSchools, countingLine, decodeReach, decodeZones,
  distance, findSchools, groupCounts, groupOf, hasAttributes, isState, mediumOf, nearestAt, NO_ZONES, orderTies, readChoice, readSchoolsMeta,
  RESIDENTS, restoreData, schoolFacts, schoolsCsv, sexOf, tagOf, windowWords, zoneCells,
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
  assert.equal(mediumOf(D[TKKM]), 'maori', 'language comes before medium');
  assert.equal(tagOf({ ...D[MAGS], medium: 'other', language: null }, S), 'state, Māori- or Pacific-medium');
  // Not recorded: left out of State and said so, as the build does (schools.py eligible, takes).
  const unrecorded = { ...D[MAGS], medium: null, language: null };
  assert.equal(isState(unrecorded), false, 'a state school with no teaching language recorded is not counted as English-medium');
  assert.equal(groupOf(unrecorded), 'language_unknown');
  assert.equal(tagOf(unrecorded, S), 'state, teaching language not recorded');
  const noSex = { ...D[MAGS], sex: { [S]: null } };
  assert.equal(sexOf(noSex, S), null);
  assert.equal(admits(noSex, S, 'girls'), false, 'a school that does not say who it takes counts for neither');
  assert.equal(admits(noSex, S, 'boys'), false);
  assert.equal(tagOf(noSex, S), '');
  const counts = groupCounts(D, S);
  assert.deepEqual(counts, { all: 9, state: 5, other_medium: 1, language_unknown: 0, integrated: 2, private: 1, charter: 0, unknown: 0 });
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

test("ties follow the build's order: minutes, straight-line metres, Ministry number", () => {
  // The build sorts each hexagon's list (schools.py ordered_reach), and
  // cells.json names ties in that order; the page keeps it rather than
  // working distances out again, so both name the same school.
  const listed = decodeReach(F.schools[`${S}_pt`], N);
  const all = chooseSchools({ destinations: D, service: S, choice: { kind: 'all' }, reach: { pt: listed }, n: N, centres: F.centres, standardModes: ['pt'] });
  assert.equal(all.near.pt[1], MAGS, 'hexagon 1: MAGS and Western Springs both 20 min; MAGS is nearer in a straight line');
  assert.deepEqual(all.ties.pt[1], [WSC]);
  assert.deepEqual(all.ties.pt, F.cells.ties[S].pt);
  const swapped = decodeReach({ format: 1, o: [0, 2], d: [WSC, MAGS], m: [20, 20] }, 1);
  assert.deepEqual(orderTies([MAGS, WSC], swapped, 0), [WSC, MAGS], 'the order is the list\'s, whatever order the ids come in');
  assert.deepEqual(orderTies([MAGS, 99], swapped, 0), [MAGS, 99], 'a school not in the list goes last');
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
  const ctx = { destinations: D, service, choice, reach, result, zones: result ? zones : null, centres: F.centres, maxMinutes: 60,
    when: windowWords({ start: '07:00', minutes: 120 }, '2026-09-15') };
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
    + 'Nearest state school taught in English: Mt Albert Grammar School, 15 min on foot. The standard is 30 min.');
  const bike = verdictLine(data, 0, S, 30, 'bike_low_stress', null, cardFor(data, { kind: 'all' }, null));
  assert.equal(bike.strong, 'Secondary school: 6 min by low-stress cycling.');
  assert.match(bike.rest, /^Nearest: Marist College \(state-integrated, girls' school\)\. Nearest state school taught in English: Mt Albert Grammar School, 10 min by low-stress cycling\./);
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
  assert.match(best.rest, /^For a girl: Auckland Girls' Grammar School, 10 min on foot\. For a boy: Boys High, 15 min by public transport\./);
  const same = verdictLine(data, 0, S, 30, 'best', null, cardFor(data, choice, result));
  assert.equal(same.strong, 'State secondary school: 10 min without a car.');
  assert.match(same.rest, /^Nearest: Mt Albert Grammar School, 10 min by low-stress cycling\./);
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
    + 'Nearest other state school taught in English: Western Springs College-Ngā Puna o Waiōrea, 32 min by public transport. '
    + "Times go to the Ministry's map point for the school (the pin, about 400 m away in a straight line), not to its nearest gate. The standard is 30 min.");
  assert.doesNotMatch(band.rest, /Nearest: Mt Albert/, 'One school does not name itself again');
  const cut = verdictLine(data, 3, S, 30, 'pt', null, cardFor(data, choice, result));
  // The spread is public transport's own, said after the walking time.
  assert.match(cut.rest, /^Walking is quicker: 26 min\. By public transport, usually 25–33 min, depending on when you leave between 7am and 9am on Tuesday 15 September 2026 \(10th to 90th percentile\)\./);
  assert.match(cut.rest, /No other state school taught in English within 60 min by public transport\./);
  assert.match(cut.rest, /Its zone line crosses this hexagon; at least half of it is in the zone\./);
  const out = verdictLine(data, 1, S, 30, 'pt', null, cardFor(data, choice, result));
  assert.match(out.rest, /This hexagon is not in its zone\. Nearest other state school taught in English: Western Springs College-Ngā Puna o Waiōrea, 20 min by public transport\./);
  // A school with checked entrances says so instead.
  const gated = cardLines({ destinations: D.map((d, k) => (k === MAGS ? { ...d, routed_to: 2 } : d)), service: S, choice, reach, result, zones, centres: F.centres }, 'pt', 0, []);
  assert.ok(!gated.some((l) => l.startsWith('Times go to')), gated.join(' | '));
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
  const meta = readSchoolsMeta(F.meta);
  assert.equal(countingLine(D, S, { kind: 'all' }, { plural, meta }),
    'Counting all 9 secondary schools: 5 state, 1 state Māori-medium, 2 state-integrated and 1 private. '
    + 'Single-sex schools count for everyone. Figures count all residents, not only school-age children. School list as at 12 Nov 2026.');
  assert.equal(countingLine(D, S, { kind: 'state', students: 'both' }, { plural }),
    'Counting 5 state secondary schools taught in English. Not counted: 2 state-integrated, 1 private and 1 Māori-medium. '
    + 'Girls and boys: both must be able to reach one they can go to, and the time is the slower of the two. '
    + 'Home zones are not applied: a school with a zone counts for everyone, in or out of it. '
    + 'Figures count all residents, not only school-age children.');
  for (const choice of [{ kind: 'all' }, { kind: 'state', students: 'girls' }, { kind: 'zone', students: 'both' }, { kind: 'one', moe: 69 }]) {
    assert.ok(countingLine(D, S, choice, { plural, zones }).includes(RESIDENTS), `${choice.kind}: who is counted`);
  }
  assert.ok(countingLine(D, S, { kind: 'state', students: 'boys' }, { plural }).includes(NO_ZONES));
  assert.ok(!countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones }).includes(NO_ZONES), 'In zone applies them');
  // One school with no zone in the build: everyone is counted, and it says so.
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: true }, { plural }),
    'Counting Mt Albert Grammar School only. Its zone is not in this build, so people in and out of its zone are counted alike. '
    + 'Figures count all residents, not only school-age children.');
  assert.match(countingLine(D, S, { kind: 'state', students: 'girls' }, { plural }), /Counting co-ed and girls' schools: 4 of the 5\./);
  assert.match(countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones }),
    /^Counting state secondary schools taught in English whose zone covers at least half of the hexagon \(3 of the 5 have a zone\), and the 2 with no enrolment scheme\./);
  assert.match(countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones }), /Zones as at 14 Jul 2026\./);
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: true }, { plural, zones }),
    'Counting Mt Albert Grammar School only. Only people living in its zone (in force from 6 Jun 2018) are counted. '
    + 'Figures count all residents, not only school-age children.');
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: false }, { plural, zones }),
    'Counting Mt Albert Grammar School only. Everyone is counted, not only its zone. Figures count all residents, not only school-age children.');
});

test('names for headlines and the key', () => {
  const base = { short: 'Secondary school', noun: 'a secondary school', plural: 'secondary schools' };
  assert.equal(choiceWords(base, null).noun, 'a secondary school');
  assert.equal(choiceWords(base, { kind: 'state', students: 'both' }).noun, 'a state secondary school taught in English');
  assert.equal(choiceWords(base, { kind: 'state', students: 'girls' }).noun, 'a state secondary school taught in English that takes girls');
  assert.equal(choiceWords(base, { kind: 'state', students: 'both' }).short, 'State secondary school');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'both' }).noun, 'an in-zone state secondary school taught in English');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'both' }).short, 'In-zone state secondary school');
  assert.equal(choiceWords(base, { kind: 'one', moe: 69 }, D[MAGS]).noun, 'Mt Albert Grammar School');
  assert.equal(choiceWords({ short: 'Intermediate', noun: 'an intermediate school', plural: 'intermediate schools' }, { kind: 'state', students: 'both' }).noun,
    'a state intermediate school taught in English');
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
  // The names people use: Mount for Mt, Saint for St, initials.
  assert.deepEqual(findSchools(D, S, 'Mount Albert Grammar'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'mount albert'), [MAGS, 5], 'Elim Christian College Mt Albert too, after');
  assert.deepEqual(findSchools(D, S, 'MAGS'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'mags'), [MAGS]);
  assert.equal(findSchools(D, S, 'AGGS')[0], AGGS, "Auckland Girls' Grammar School");
  const saint = [{ name: "St Mary's College", moe: 1, services: [S] }, { name: 'Mount Maunganui College', moe: 2, services: [S] }];
  assert.deepEqual(findSchools(saint, S, "saint mary's"), [0]);
  assert.deepEqual(findSchools(saint, S, 'saint marys'), [0]);
  assert.deepEqual(findSchools(saint, S, 'mt maunganui'), [1], 'Mount in the name matches Mt typed');
  assert.deepEqual(findSchools(saint, S, 'smc'), [0]);
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

test("summary.json's meta.schools, as the build writes it", () => {
  const meta = readSchoolsMeta(F.meta);
  assert.equal(meta.directory, '2026-11-12', 'the directory date, from dates.directory');
  assert.equal(meta.roll_date, '2026-10-01', 'the date most rolls are at');
  assert.deepEqual(meta.reach, { [S]: ['walk', 'bike_low_stress', 'pt'] }, 'the reach lists, from the file names');
  assert.equal(meta.school_buses, false, 'buses: none_found');
  assert.match(meta.bus_note, /no school bus/);
  assert.deepEqual(readSchoolsMeta({}), {}, 'a build before 0.12');
  assert.equal(readSchoolsMeta({ schools: { buses: 'in_timetable' } }).school_buses, true);
  const files = { 'intermediate_school_bike_low_stress.json': {}, 'intermediate_school_bike.json': {}, 'intermediate_school_pt_slow.json': {}, 'intermediate_school_pt.json': {} };
  assert.deepEqual(readSchoolsMeta({ schools: { files } }).reach.intermediate_school.sort(), ['bike', 'bike_low_stress', 'pt', 'pt_slow']);
  const rolls = readSchoolsMeta({ schools: { directory: { retrieved: '2026-11-12T10:50:20+13:00', roll_dates: { none: 40, '2026-07-01': 2, '2026-10-01': 30 } } } });
  assert.equal(rolls.directory, '2026-11-12');
  assert.equal(rolls.roll_date, '2026-10-01');
});

test('a short car list answers All and State, and says it is short', () => {
  // By car the build keeps only the nearest school under All, State, State
  // girls and State boys, with ties (schools.py short_list), and marks the
  // file complete: false. One school and In zone must not read it.
  const short = decodeReach({ format: 1, complete: false, o: [0, 2], d: [TKKM, MAGS], m: [2, 6] }, 1);
  assert.equal(short.complete, false);
  assert.equal(decodeReach(F.schools[`${S}_pt`], N).complete, true);
  const state = chooseSchools({ destinations: D, service: S, choice: { kind: 'state', students: 'girls' }, reach: { car: short }, n: 1, standardModes: [] });
  assert.equal(state.t.car[0], 6);
  assert.equal(state.near.car[0], MAGS);
  // The card leaves out what a short list cannot say.
  const lines = cardLines({ destinations: D, service: S, choice: { kind: 'state', students: 'girls' }, reach: { car: short }, result: state }, 'car', 0, [MAGS]);
  assert.ok(!lines.some((l) => /^Not counted/.test(l)), lines.join(' '));
});

test('girls and boys: on foot only when it is for the student whose time is shown', () => {
  // A girl walks 15 min to Auckland Girls' Grammar or takes the bus there in
  // 10; a boy walks 12 min to Boys High or takes the bus there in 15. The
  // joint times are both 15, but the 15 by public transport is the boy's bus
  // trip, so it is not said as a walk.
  const walk = decodeReach({ format: 1, o: [0, 2], d: [BOYS_HIGH, AGGS], m: [12, 15] }, 1);
  const pt = decodeReach({ format: 1, o: [0, 2], d: [AGGS, BOYS_HIGH], m: [10, 15] }, 1);
  const result = chooseSchools({ destinations: D, service: S, choice: { kind: 'state', students: 'both' }, reach: { walk, pt }, n: 1, standardModes: ['walk', 'pt'] });
  assert.equal(result.t.walk[0], 15);
  assert.equal(result.t.pt[0], 15);
  assert.equal(result.ptFoot.mask[0], 0);
  const data = { t: { [S]: { walk: result.t.walk, pt: result.t.pt } }, nearestMode: { [S]: result.near }, ties: { [S]: result.ties }, ptFoot: { [S]: result.ptFoot } };
  const words = tripWords(data, S, 'pt', 0);
  assert.equal(words.onFoot, false);
  assert.deepEqual(words.names, [BOYS_HIGH], "the boy's bus trip sets the time");
  // When each student's public transport time is their walk, it is a walk.
  const both = chooseSchools({ destinations: D, service: S, choice: { kind: 'state', students: 'both' }, reach: { walk, pt: walk }, n: 1, standardModes: ['walk', 'pt'] });
  assert.equal(both.ptFoot.mask[0], 1);
  assert.deepEqual([both.ptFoot.near[0], ...(both.ptFoot.ties[0] || [])], [AGGS], "the girl's walk sets the time");
});

test('none within the hour by public transport, but a walk: the card says so', () => {
  // As in central Blenheim: a public transport trip may walk only so far
  // straight to the door, so a 22-minute walk can be "over 60 min by public
  // transport" when no bus helps.
  const walk = decodeReach({ format: 1, o: [0, 2], d: [BOYS_HIGH, AGGS], m: [11, 22] }, 1);
  const pt = decodeReach({ format: 1, o: [0, 1], d: [BOYS_HIGH], m: [11] }, 1);
  const data = { t: { [S]: { walk: Float32Array.of(22), pt: Float32Array.of(NaN) } } };
  assert.equal(tripWords(data, S, 'pt', 0).quicker, 22, 'Walking is quicker: 22 min');
  const all = cardLines({ destinations: D, service: S, choice: { kind: 'all' }, reach: { walk, pt } }, 'pt', 0, [BOYS_HIGH]);
  assert.ok(all.includes("Nearest state school taught in English, for a girl: none within 60 min by public transport, though Auckland Girls' Grammar School is 22 min on foot."), all.join(' | '));
  const state = chooseSchools({ destinations: D, service: S, choice: { kind: 'state', students: 'both' }, reach: { walk, pt }, n: 1, standardModes: ['walk', 'pt'] });
  const lines = cardLines({ destinations: D, service: S, choice: { kind: 'state', students: 'both' }, reach: { walk, pt }, result: state }, 'pt', 0, []);
  assert.ok(lines.some((l) => l.startsWith("For a girl: none within 60 min by public transport, though Auckland Girls' Grammar School is 22 min on foot.")), lines.join(' | '));
});

// ---------------------------------------------------------------- review fixes, November 2026

test('the tooltip says what the card says: a walk is a walk, and Best names the way', () => {
  setServices({ services: { [S]: {} } });
  const data = dataSet();
  // All, public transport, at the slide hexagon: the 9 minutes are a walk.
  const band = verdictLine(data, 0, S, 30, 'pt', null, cardFor(data, { kind: 'all' }, null));
  assert.deepEqual(tooltipLines(data, 0, S, 30, 'pt', null, 'Secondary school'), [band.strong]);
  assert.equal(band.strong, 'Secondary school: 9 min on foot. No bus or train is quicker.');
  // Best: the way is named, not "best option".
  const best = verdictLine(data, 0, S, 30, 'best');
  assert.deepEqual(tooltipLines(data, 0, S, 30, 'best'), [best.strong]);
  assert.equal(best.strong, 'Secondary school: 6 min by low-stress cycling.');
  // Public transport slower than walking: the walk goes on the tooltip too.
  const slow = verdictLine(data, 3, S, 30, 'pt');
  assert.deepEqual(tooltipLines(data, 3, S, 30, 'pt'), [slow.strong, 'Walking is quicker: 26 min.']);
  // One school MAGS.
  const choice = { kind: 'one', moe: 69, students: 'both', zoneOnly: true };
  const result = run(choice);
  applyToData(data, S, result);
  for (const [i, mode] of [[0, 'pt'], [3, 'pt'], [0, 'walk'], [4, 'best'], [2, 'pt']]) {
    const card = verdictLine(data, i, S, 30, mode, null, cardFor(data, choice, result));
    assert.equal(tooltipLines(data, i, S, 30, mode, null, 'Mt Albert Grammar School')[0], card.strong, `${i} ${mode}`);
  }
  // Every hexagon and way, under every choice: the first line is the card's.
  for (const c of [{ kind: 'all' }, { kind: 'state', students: 'both' }, { kind: 'state', students: 'girls' }]) {
    const d = dataSet();
    const r = c.kind === 'all' ? null : run(c);
    if (r) applyToData(d, S, r);
    const words = cardFor(d, c, r);
    for (let i = 0; i < N; i += 1) {
      for (const mode of ['walk', 'bike_low_stress', 'pt', 'best']) {
        assert.equal(tooltipLines(d, i, S, 30, mode, null, words.short)[0], verdictLine(d, i, S, 30, mode, null, words).strong, `${c.kind} ${i} ${mode}`);
      }
    }
  }
});

test('when public transport was timed: one named day, not weekdays', () => {
  assert.equal(windowWords({ start: '07:00', minutes: 120 }, '2026-09-15'), 'between 7am and 9am on Tuesday 15 September 2026');
  assert.equal(windowWords({ start: '10:00', minutes: 120, date: '2026-09-19' }, '2026-09-15'), 'between 10am and midday on Saturday 19 September 2026');
  assert.equal(windowWords({ start: '07:30', minutes: 60 }, null), 'between 7:30am and 8:30am');
  assert.equal(windowWords(null, '2026-09-15'), null);
});

test('straight-line distances read to 50 m or a tenth of a kilometre', () => {
  assert.equal(distance(0.252), '250 m');
  assert.equal(distance(0.276), '300 m');
  assert.equal(distance(0.004), '50 m');
  assert.equal(distance(0.98), '1.0 km');
  assert.equal(distance(1.234), '1.2 km');
  assert.equal(distance(NaN), '');
});

test('the school bus line says dedicated school buses are left out', () => {
  const lines = cardLines({ destinations: D, service: S, choice: { kind: 'one', moe: 69 }, reach, schoolBuses: false }, 'pt', 0, []);
  assert.equal(lines[lines.length - 1], 'Dedicated school buses are not in the timetable used, so they are not counted.');
  const none = cardLines({ destinations: D, service: S, choice: { kind: 'one', moe: 69 }, reach, schoolBuses: true }, 'pt', 0, []);
  assert.ok(!none.some((l) => /school buses/i.test(l)));
});
