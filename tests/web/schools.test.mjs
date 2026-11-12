import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ageGroupFor, ageWords } from '../../web/js/ages.js';
import { setAgeGroup, setCellShare, setUrban, times } from '../../web/js/data.js';
import { setTransit } from '../../web/js/format.js';
import { accessSentence, setCounted, setServices, withinSentence, zoneSentence } from '../../web/js/panel.js';
import { busTime, namedFor, serviceVerdict, tooltipLines, tripWords, verdictLine } from '../../web/js/place.js';
import {
  admits, ALL_CHOICE, applyToData, cardLines, choiceKey, choiceParams, choiceWords, chooseSchools, countingLine, decodeReach, decodeStops,
  decodeZones, DEFAULT_CHOICE, DEFAULT_SCHOOL_CHOICE, distance, findSchools, formatOk, groupCounts, groupOf, hasAttributes, isState, isZoned,
  mediumOf, minutesTo, nearestAt, NO_ZONES, orderTies, ptCsvLine, readChoice, readSchoolsMeta, RESIDENTS, restoreData, schoolFacts, schoolsCsv,
  sexOf, stopHours, stopLine, stopsAt, stopsCsvLines, stopsIntro, tagOf, windowWords, zoneShareAt, zoneShares, zoneStatus, zoneTally,
} from '../../web/js/schools.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/schools/fixture.json', import.meta.url), 'utf8'));
const L = F.legacy;
const S = 'secondary_school';
const N = F.h3.length;
const D = F.destinations;
const MODES = ['walk', 'bike_low_stress', 'pt'];
const reach = Object.fromEntries(MODES.map((m) => [m, decodeReach(F.schools[`${S}_${m}`], N)]));
const oldReach = Object.fromEntries(MODES.map((m) => [m, decodeReach(L.schools[`${S}_${m}`], N)]));
const zones = decodeZones(F.zones, S, N);
const KIDS = ageWords(F.meta, '13_17');
const run = (choice, lists = reach, z = zones, dests = D) => chooseSchools({
  destinations: dests, service: S, choice: { ...ALL_CHOICE, ...choice }, reach: lists, zones: z, n: N, centres: F.centres,
});
const TKKM = 0;
const MARIST = 1;
const MAGS = 2;
const AGGS = 3;
const WSC = 4;
const BOYS_HIGH = 8;
const OPEN = 9;
const SOUTH_EAST = 5;

// Round 2 (public transport or walking, ages) unless a test says otherwise.
const round2 = () => { setTransit(F.meta); setCounted(KIDS); };
const round1 = () => { setTransit(L.meta); setCounted(null); };

// ---------------------------------------------------------------- links

test('a link without sch opens the default, In zone; sch=all is All; every link carries sch', () => {
  assert.equal(DEFAULT_SCHOOL_CHOICE, 'zone', 'the one switch for the default');
  assert.deepEqual(DEFAULT_CHOICE, { kind: 'zone', moe: null, students: 'both', zoneOnly: true });
  assert.deepEqual(readChoice(null, null, null), { kind: 'zone', moe: null, students: 'both', zoneOnly: true }, "the councillors' slide link opens In zone");
  assert.deepEqual(readChoice('all'), { kind: 'all', moe: null, students: 'both', zoneOnly: true });
  assert.equal(readChoice(null, null, null, 'all').kind, 'all', 'the default is a parameter, so switching it back is one line');
  for (const choice of [
    { kind: 'all', moe: null, students: 'both', zoneOnly: true },
    { kind: 'state', moe: null, students: 'both', zoneOnly: true },
    { kind: 'state', moe: null, students: 'girls', zoneOnly: true },
    { kind: 'zone', moe: null, students: 'both', zoneOnly: true },
    { kind: 'zone', moe: null, students: 'boys', zoneOnly: true },
    { kind: 'one', moe: 69, students: 'both', zoneOnly: true },
    { kind: 'one', moe: 69, students: 'both', zoneOnly: false },
  ]) {
    const params = new URLSearchParams(choiceParams(choice));
    assert.ok(params.has('sch'), `${choice.kind}: the link says which schools`);
    assert.deepEqual(readChoice(params.get('sch'), params.get('stu'), params.get('sz')), choice, params.toString());
    // The same link means the same thing whatever the default is.
    assert.deepEqual(readChoice(params.get('sch'), params.get('stu'), params.get('sz'), 'all'), choice, `${params} with All as the default`);
  }
  assert.deepEqual(choiceParams({ kind: 'all', students: 'girls' }), [['sch', 'all']], 'All writes sch=all');
  assert.equal(new URLSearchParams(choiceParams({ kind: 'one', moe: 69, zoneOnly: true })).toString(), 'sch=one%3A69');
  assert.equal(readChoice('one:abc').kind, 'zone', 'a malformed school number opens the default');
  assert.equal(readChoice('private').kind, 'zone', 'an unknown choice opens the default');
  assert.equal(choiceKey(S, { kind: 'all' }), null);
  assert.notEqual(choiceKey(S, { kind: 'state', students: 'girls' }), choiceKey(S, { kind: 'state', students: 'boys' }));
});

// ---------------------------------------------------------------- formats

test('school files: the formats this page reads, and the ones the build lists', () => {
  assert.ok(formatOk(F.meta, 'school_reach', F.schools[`${S}_pt`]));
  assert.ok(formatOk(L.meta, 'school_reach', L.schools[`${S}_pt`]), 'a round-1 build lists no formats: format 1 is read');
  assert.ok(!formatOk(F.meta, 'school_reach', L.schools[`${S}_pt`]), 'a build that lists format 2 refuses a format 1 list');
  assert.ok(!formatOk(F.meta, 'school_reach', { format: 3 }));
  assert.ok(formatOk(F.meta, 'zones', F.zones));
  assert.ok(!formatOk({}, 'zones', { format: 1 }), "round 1's made-up zones are not read");
  assert.ok(formatOk(F.meta, 'zone_outlines', F.outlines));
  assert.ok(formatOk(F.meta, 'school_stops', F.stops));
  assert.ok(!formatOk({ formats: { school_stops: 2 } }, 'school_stops', F.stops));
  assert.ok(!formatOk(F.meta, 'zones', null));
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
  const unrecorded = { ...D[MAGS], medium: null, language: null };
  assert.equal(isState(unrecorded), false, 'a state school with no teaching language recorded is not counted as English-medium');
  assert.equal(groupOf(unrecorded), 'language_unknown');
  assert.equal(tagOf(unrecorded, S), 'state, teaching language not recorded');
  const noSex = { ...D[MAGS], sex: { [S]: null } };
  assert.equal(admits(noSex, S, 'girls'), false, 'a school that does not say who it takes counts for neither');
  assert.deepEqual(groupCounts(D, S), { all: 9, state: 5, other_medium: 1, language_unknown: 0, integrated: 2, private: 1, charter: 0, unknown: 0 });
  assert.equal(groupCounts(D, S, 'girls').state, 4, 'girls: all but Boys High');
});

// ---------------------------------------------------------------- reach lists

test('reach lists decode in format 1 and 2, and refuse anything else', () => {
  const ok = { format: 1, o: [0, 2, 2], d: [3, 4], m: [5, 6] };
  assert.deepEqual(Array.from(decodeReach(ok, 2).start), [0, 2, 2]);
  assert.deepEqual(Array.from(decodeReach({ ...ok, o: [0, 2] }, 2).start), [0, 2, 2]);
  assert.throws(() => decodeReach({ ...ok, o: [0] }, 2), /offsets/);
  assert.throws(() => decodeReach({ ...ok, o: [0, 3, 2] }, 2), /order|cover/);
  assert.throws(() => decodeReach({ ...ok, format: 3 }, 2), /format/);
  assert.throws(() => decodeReach({ ...ok, m: [5] }, 2), /minutes/);
  assert.equal(decodeReach(ok, 2).r5, null, 'format 1 has no R5 minutes');
  // Format 2: R5's own minutes for every entry, Infinity where R5 has none.
  const two = decodeReach({ format: 2, pt_or_walk: true, o: [0, 2, 2], d: [3, 4], m: [15, 22], r5: { k: [0, 1], m: [26, null] } }, 2);
  assert.ok(two.ptOrWalk);
  assert.deepEqual(Array.from(two.r5), [26, Infinity]);
  assert.deepEqual(Array.from(two.walked), [1, 1]);
  assert.throws(() => decodeReach({ format: 2, o: [0, 1], d: [3], m: [1], r5: { k: [5], m: [2] } }, 1), /R5 entry/);
  assert.throws(() => decodeReach({ format: 2, o: [0, 1], d: [3], m: [1], r5: { k: [0], m: [] } }, 1), /R5 minutes/);
  // The fixture: hexagon 5 to MAGS, 15 on foot against R5's 26 (usually 23 to 30).
  const pt = reach.pt;
  const k = pt.start[SOUTH_EAST];
  assert.deepEqual([pt.d[k], pt.m[k], pt.lo[k], pt.hi[k], pt.r5[k]], [MAGS, 15, 15, 15, 26]);
  assert.deepEqual(minutesTo(pt, SOUTH_EAST, MAGS), { m: 15, lo: 15, hi: 15, r5: 26 });
  assert.ok(Number.isNaN(minutesTo(pt, 0, MAGS).r5) === false && minutesTo(pt, 0, MAGS).r5 === 15, 'R5 equal to the walk: not listed, its own minutes');
});

test('All, rebuilt from the reach lists, equals the published times and nearest, in both rounds', () => {
  for (const [cells, lists] of [[F.cells, reach], [L.cells, oldReach]]) {
    const all = run({ kind: 'all' }, lists, null);
    for (const m of MODES) {
      assert.deepEqual(Array.from(all.t[m], (v) => (Number.isFinite(v) ? v : null)), cells.t[S][m], m);
      assert.deepEqual(Array.from(all.near[m], (v) => (v < 0 ? null : v)), cells.nearest_mode[S][m], m);
      assert.deepEqual(all.ties[m], cells.ties[S][m], m);
    }
  }
});

test('times over the routing limit count as none', () => {
  const list = decodeReach({ format: 1, o: [0, 2], d: [MAGS, AGGS], m: [61, 62] }, 1);
  const out = chooseSchools({ destinations: D, service: S, choice: { kind: 'all' }, reach: { walk: list }, n: 1, standardModes: ['walk'] });
  assert.ok(Number.isNaN(out.t.walk[0]));
  assert.equal(out.near.walk[0], -1);
});

test("ties follow the build's order: minutes, straight-line metres, Ministry number", () => {
  const all = run({ kind: 'all' });
  assert.equal(all.near.pt[1], MAGS, 'hexagon 1: MAGS and Western Springs both 20 min; MAGS is nearer in a straight line');
  assert.deepEqual(all.ties.pt[1], [WSC]);
  const swapped = decodeReach({ format: 1, o: [0, 2], d: [WSC, MAGS], m: [20, 20] }, 1);
  assert.deepEqual(orderTies([MAGS, WSC], swapped, 0), [WSC, MAGS], "the order is the list's, whatever order the ids come in");
  assert.deepEqual(orderTies([MAGS, 99], swapped, 0), [MAGS, 99], 'a school not in the list goes last');
});

// ---------------------------------------------------------------- public transport, or walking where that is quicker

test('public transport is the quicker of the trip and the walk, pair by pair, with R5 kept', () => {
  // As a round-1 build had it, and as round 2 does.
  const before = run({ kind: 'one', moe: 69 }, oldReach, null);
  const after = run({ kind: 'one', moe: 69 });
  assert.equal(before.t.pt[SOUTH_EAST], 26, 'round 1: 26 by public transport, slower than the 15-minute walk');
  assert.equal(after.t.pt[SOUTH_EAST], 15, 'round 2: the walk');
  assert.equal(after.r5[SOUTH_EAST], 26, "R5's own time is kept for the card");
  assert.equal(after.t.pt[3], 26, 'hexagon 3: MAGS 26 on foot, against 28 by bus');
  assert.equal(after.r5[3], 28);
  assert.equal(after.r5[0], 15, 'St Lukes: R5 equals the walk');
  // State: hexagon 4, a girl's 20-minute bus to AGGS becomes her 10-minute walk.
  const state = run({ kind: 'state' });
  assert.equal(state.bySex.girls.t.pt[4], 10);
  assert.equal(state.bySex.girls.r5[4], 20);
  assert.equal(state.bySex.boys.t.pt[4], 15, "a boy's bus to Boys High stays");
  assert.equal(state.t.pt[4], 15, 'girls and boys: the slower, the boy');
  assert.equal(state.r5[4], 20, 'by bus or train alone, the slower of the two');
  // A walk with no bus at all: R5 has none within the hour.
  const walkOnly = decodeReach({ format: 2, pt_or_walk: true, o: [0, 1], d: [MAGS], m: [22], r5: { k: [0], m: [null] } }, 1);
  const lone = chooseSchools({ destinations: D, service: S, choice: { kind: 'all' }, reach: { pt: walkOnly }, n: 1, standardModes: ['pt'] });
  assert.equal(lone.t.pt[0], 22);
  assert.ok(Number.isNaN(lone.r5[0]), 'none by bus or train within 60');
});

function dataSet(round = 'round2') {
  const cells = round === 'round2' ? F.cells : L.cells;
  const pop = Float32Array.from(F.pop);
  const t = { [S]: Object.fromEntries(MODES.map((m) => [m, Float32Array.from(cells.t[S][m], (v) => (v == null ? NaN : v))])) };
  const shares = { no_car: Float32Array.from([10, 20, 30, 40, 50, 0]), children: Float32Array.from([15, 15, 15, 15, 15, 15]) };
  const data = {
    n: N,
    meta: { ...(round === 'round2' ? F.meta : L.meta), services: { [S]: { standard_minutes: 30, window: 'am_peak', windows: ['am_peak'] } } },
    freq: { am_peak: Float32Array.from([12, 8, 0, 6, 10, 4]) },
    activeWindow: { [S]: 'am_peak' },
    destinations: round === 'round2' ? D : L.destinations,
    t,
    usual: { t: { [S]: t[S].pt }, cost: { [S]: { z1: new Float32Array(N) } } },
    cost: { [S]: { z1: new Float32Array(N) } },
    km: { [S]: new Float32Array(N) },
    choice: { [S]: { 30: new Float32Array(N) } },
    nearest: cells.nearest,
    nearestMode: cells.nearest_mode,
    ties: cells.ties,
    pop,
    shares,
    weights: { everyone: pop, no_car: Float32Array.from(pop, (p, i) => (p * shares.no_car[i]) / 100), children: Float32Array.from(pop, (p) => p * 0.15) },
    urban: Uint8Array.from([1, 1, 0, 1, 1, 1]),
    ages: round === 'round2' ? Object.fromEntries(Object.entries(F.cells.ages).map(([k, v]) => [k, Float32Array.from(v)])) : null,
    ptr: round === 'round2' ? F.cells.ptr : null,
  };
  data.everywhere = { pop: data.pop, weights: data.weights };
  return data;
}

function cardFor(choice, result, { round = 'round2', z = result ? zones : null } = {}) {
  const lists = round === 'round2' ? reach : oldReach;
  const dests = round === 'round2' ? D : L.destinations;
  const words = choiceWords({ short: 'Secondary school', noun: 'a secondary school', plural: 'secondary schools' }, result ? choice : null,
    choice.kind === 'one' ? dests[MAGS] : null, { children: round === 'round2' });
  const ctx = { destinations: dests, service: S, choice, reach: lists, result, zones: z, centres: F.centres, maxMinutes: 60,
    when: windowWords({ start: '07:00', minutes: 120 }, '2026-09-15') };
  return {
    short: words.short,
    one: Boolean(words.one),
    nearestLabel: words.nearestLabel || null,
    label: (d) => `${dests[d].name}${!result && tagOf(dests[d], S) ? ` (${tagOf(dests[d], S)})` : ''}`,
    lines: (mode, i, named, shown) => cardLines({ ...ctx, shownMinutes: shown }, mode, i, named),
  };
}

test('the card and tooltip: a bus or train trip, a walk with a slower bus, a walk with no bus', () => {
  round2();
  setServices({ services: { [S]: {} } });
  const data = dataSet();
  // Hexagon 4 under All: AGGS 10 on foot; R5's nearest by bus is Boys High at 15.
  const walk = verdictLine(data, 4, S, 30, 'pt', null, cardFor({ kind: 'all' }, null));
  assert.equal(walk.strong, 'Secondary school: 10 min on foot. No bus or train is quicker.');
  assert.match(walk.rest, /^By bus or train: 15 min\. Nearest: Auckland Girls' Grammar School/);
  assert.deepEqual(tooltipLines(data, 4, S, 30, 'pt', null, 'Secondary school'), [walk.strong, 'By bus or train: 15 min.']);
  // Hexagon 1: a bus trip.
  const bus = verdictLine(data, 1, S, 30, 'pt', null, cardFor({ kind: 'all' }, null));
  assert.equal(bus.strong, 'Secondary school: 20 min by public transport.');
  assert.doesNotMatch(bus.rest, /Walking is quicker|By bus or train/);
  assert.deepEqual(tooltipLines(data, 1, S, 30, 'pt', null, 'Secondary school'), [bus.strong]);
  // St Lukes: R5's 9 to TKKM is itself the walk, so no bus time is given.
  const slide = verdictLine(data, 0, S, 30, 'pt', null, cardFor({ kind: 'all' }, null));
  assert.equal(slide.strong, 'Secondary school: 9 min on foot. No bus or train is quicker.');
  assert.doesNotMatch(slide.rest, /By bus or train/);
  // One school MAGS from hexagon 5: 15 on foot, 26 by bus, and no spread for a walk.
  const choice = { kind: 'one', moe: 69, students: 'both', zoneOnly: true };
  const result = run(choice);
  applyToData(data, S, result);
  const one = verdictLine(data, SOUTH_EAST, S, 30, 'pt', null, cardFor(choice, result));
  assert.equal(one.strong, 'Mt Albert Grammar School: 15 min on foot. No bus or train is quicker.');
  assert.match(one.rest, /^By bus or train: 26 min\. Inside its enrolment zone\./);
  assert.doesNotMatch(one.rest, /usually/, 'the spread is for a bus or train trip only');
  assert.deepEqual(tooltipLines(data, SOUTH_EAST, S, 30, 'pt', null, 'Mt Albert Grammar School'), [one.strong, 'By bus or train: 26 min.']);
  // A bus trip to the school keeps its spread.
  const trip = verdictLine(data, 1, S, 30, 'pt', null, cardFor(choice, result));
  assert.match(trip.rest, /By public transport, usually 17–24 min, depending on when you leave between 7am and 9am on Tuesday 15 September 2026/);
  // No bus or train at all within the hour.
  const lone = { t: { [S]: { walk: Float32Array.of(22), pt: Float32Array.of(22) } }, ptr: { [S]: { 0: null } }, meta: { standard_modes: ['walk', 'pt'] } };
  assert.deepEqual(tooltipLines(lone, 0, S, 30, 'pt', null, 'Secondary school'),
    ['Secondary school: 22 min on foot. No bus or train is quicker.', 'No bus or train gets there within 60 min.']);
  // In another window, cells.json's R5 minutes (usual window only) say nothing.
  const other = { ...dataSet(), activeWindow: { [S]: 'interpeak' }, meta: { ...F.meta, services: { [S]: { windows: ['am_peak', 'interpeak'] } } } };
  assert.equal(busTime(other, S, 4), undefined);
  restoreData(data);
});

test('a round-1 build reads as before: walking quicker is said, and no bus line', () => {
  round1();
  setServices({ services: { [S]: {} } });
  const data = dataSet('round1');
  const slow = verdictLine(data, 3, S, 30, 'pt');
  assert.equal(slow.strong, 'Secondary school: 27 min by public transport.');
  assert.match(slow.rest, /^Walking is quicker: 26 min\. Nearest: Marist College\./);
  assert.deepEqual(tooltipLines(data, 3, S, 30, 'pt'), [slow.strong, 'Walking is quicker: 26 min.']);
  const tie = verdictLine(data, 1, S, 30, 'pt');
  assert.equal(tie.rest, 'Nearest: Mt Albert Grammar School or Western Springs College-Ngā Puna o Waiōrea, both 20 min. The standard is 30 min.');
  assert.equal(verdictLine(data, 2, S, 30, 'pt').strong, 'Secondary school: over 60 min by public transport.');
  const words = tripWords({ t: { [S]: { walk: Float32Array.of(22), pt: Float32Array.of(NaN) } } }, S, 'pt', 0);
  assert.equal(words.quicker, 22, 'none by public transport within the hour, but a 22-minute walk');
  round2();
});

// ---------------------------------------------------------------- the slide's hexagon

test("the councillors' hexagon under each choice", () => {
  const all = run({ kind: 'all' });
  assert.equal(all.t.pt[0], 9);
  assert.equal(all.near.pt[0], TKKM, 'All by public transport: TKKM o Nga Maungarongo, 9 min on foot');
  assert.equal(all.near.bike_low_stress[0], MARIST, 'All by low-stress cycling: Marist, 6 min');
  const state = run({ kind: 'state' });
  assert.equal(state.t.pt[0], 15, 'State, girls and boys: 15 min');
  assert.equal(state.near.pt[0], MAGS);
  const one = run({ kind: 'one', moe: 69 });
  assert.deepEqual([one.t.walk[0], one.t.bike_low_stress[0], one.t.pt[0]], [15, 10, 15], 'One school MAGS: walk 15, cycle 10, PT 15');
  assert.equal(run({ kind: 'one', moe: 70 }).t.pt[0], 12, 'Marist by public transport: 12');
  const zone = run({ kind: 'zone' });
  assert.equal(zone.t.pt[0], 15, 'In zone: MAGS, 15 min on foot');
  assert.equal(zone.near.pt[0], MAGS);
});

// ---------------------------------------------------------------- zones

test('zones.json format 2: statuses, In zone sets, shares and split hexagons', () => {
  assert.equal(decodeZones({ format: 1, in: {} }, S, N), null, 'format 1 is not read');
  assert.equal(decodeZones(null, S, N), null);
  assert.equal(decodeZones({ ...F.zones, share: { [S]: { o: [0, 1, 1, 1, 1, 1, 1], d: [2], w: [] } } }, S, N), null, 'shares must match the schools');
  assert.equal(zones.source.version, '2026-10-02');
  assert.equal(zones.reference, '2026-11-12');
  assert.deepEqual(Array.from(zones.split), [0, 1, 0, 1, 0, 0]);
  assert.equal(zoneStatus(zones, D[MAGS], MAGS, S), 'in_force');
  assert.equal(zoneStatus(zones, D[BOYS_HIGH], BOYS_HIGH, S), 'none');
  assert.equal(zoneStatus(zones, D[OPEN], OPEN, S), 'upcoming_used');
  assert.equal(zoneStatus(zones, { ...D[MAGS], zone: null }, 77, S), 'no_map', 'a scheme with no zone in the file');
  assert.equal(zoneStatus(zones, { scheme: false }, 77, S), 'none');
  assert.equal(zoneStatus({ ...zones, schools: { 2: { status: 'in_force', polygons: { primary_school: [1] } } } }, D[MAGS], MAGS, S), 'no_zone_for_years',
    "a zone for other years (Balmoral's Zone A is for Years 1 to 6) counts for everyone");
  assert.ok(isZoned(zones, D[MAGS], MAGS, S));
  assert.ok(!isZoned(null, D[MAGS], MAGS, S), 'no zones in the build: nothing is zoned');
  assert.equal(zoneShareAt(zones, 1, WSC), Math.fround(0.6));
  assert.equal(zoneShareAt(zones, 1, MAGS), Math.fround(0.4));
  assert.equal(zoneShareAt(zones, 2, MAGS), 0);
  const mags = zoneShares(zones, MAGS, N);
  assert.deepEqual(Array.from(mags.share), [1, 0.4, 0, 0.7, 0, 1].map(Math.fround));
  assert.deepEqual(Array.from(mags.crossed), [0, 1, 0, 1, 0, 0]);
  assert.ok(mags.any);
  assert.ok(!zoneShares(zones, MARIST, N).any, 'an integrated school has no zone here');
});

test('In zone counts a zoned school only where its zone is the hexagon\'s set, and an unzoned state school everywhere', () => {
  const zone = run({ kind: 'zone' });
  // Hexagon 1 ties MAGS and Western Springs at 20 min, but its residents mostly live in Western Springs' zone.
  assert.equal(zone.near.pt[1], WSC);
  assert.equal(zone.ties.pt[1], undefined);
  // Hexagon 4: Boys High has no scheme, so a boy counts it; AGGS zones the hexagon for a girl.
  assert.equal(zone.bySex.boys.near.pt[4], BOYS_HIGH);
  assert.equal(zone.bySex.girls.near.pt[4], AGGS);
  assert.equal(zone.counted[MAGS], 2, 'zoned: counts only in its zone');
  assert.equal(zone.counted[BOYS_HIGH], 1, 'no scheme: counts everywhere');
  assert.equal(zone.counted[OPEN], 2, "only an upcoming zone in the file: that zone is used");
  assert.equal(zone.counted[MARIST], 0, 'integrated: not counted');
  assert.equal(zone.counted[TKKM], 0, 'kura: not counted');
  // Hexagon 3: 70% live in MAGS's zone, so MAGS counts; hexagon 2 is in no zone.
  assert.equal(zone.near.walk[3], MAGS);
  const tally = zoneTally(D, S, zones);
  assert.deepEqual(tally.zoned, [MAGS, AGGS, WSC, OPEN]);
  assert.deepEqual(tally.open, [BOYS_HIGH]);
  assert.deepEqual(tally.upcoming, [OPEN]);
  assert.deepEqual(zoneTally(D, S, zones, 'boys').zoned, [MAGS, WSC, OPEN], "a boy: not AGGS, a girls' school");
});

test('girls and boys together: the slower of each one, best by each one’s own fastest way', () => {
  const state = run({ kind: 'state' });
  assert.equal(state.bySex.girls.t.walk[4], 10);
  assert.equal(state.bySex.boys.t.pt[4], 15);
  assert.equal(state.t.walk[4], 30, 'walking: the boy is slower, 30 min to MAGS');
  assert.equal(state.best[4], 15, 'best: the slower of 10 and 15');
  const girls = run({ kind: 'state', students: 'girls' });
  assert.equal(girls.best, null);
  assert.equal(girls.counted[BOYS_HIGH], 0);
});

test('counts within each step, by the counting way that reaches most', () => {
  const all = run({ kind: 'all' });
  assert.equal(all.choice['10'][0], 3, 'cycling reaches Marist, TKKM and MAGS within 10');
  assert.equal(all.choice['30'][0], 5);
  const state = run({ kind: 'state' });
  assert.equal(state.choice['15'][0], 1, 'one state school within 15');
  assert.equal(state.bySex.girls.choice['10'][4], 1, 'a girl walks to AGGS in 10');
  assert.equal(state.choice['10'][4], 0, 'girls and boys: the smaller of the two counts');
  assert.ok(Math.abs(state.km[0] - 0.417) < 0.002, `straight line to MAGS ${state.km[0]}`);
});

// ---------------------------------------------------------------- swapping it in, and who is counted

test('a choice swaps in and back out, fares and R5 minutes too', () => {
  const data = dataSet();
  const before = data.t[S];
  applyToData(data, S, run({ kind: 'state' }));
  assert.equal(data.t[S].pt[0], 15);
  assert.equal(data.usual.t[S], data.t[S].pt, 'the window switch keeps the choice');
  assert.equal(data.cost[S], undefined, 'no fare layers under a choice');
  assert.equal(data.r5t[S][4], 20);
  assert.equal(times(data, S, 'best')[4], 15, 'best reads the girls-and-boys time');
  assert.equal(namedFor(data, S, 'pt', 0)[0], MAGS);
  restoreData(data);
  assert.equal(data.t[S], before);
  assert.ok(data.cost[S]);
  assert.equal(data.r5t[S], undefined);
  assert.equal(data.best[S], undefined);
});

test('children of the service\'s ages, one school\'s zone shares and urban only work together', () => {
  const data = dataSet();
  assert.equal(ageGroupFor(F.meta, data.ages, S), '13_17');
  assert.equal(ageGroupFor(F.meta, data.ages, 'gp'), null, 'every other service counts everyone');
  assert.equal(ageGroupFor(L.meta, null, S), null, 'a build with no ages counts everyone');
  assert.equal(ageGroupFor(F.meta, data.ages, 'early_childhood'), '0_4');
  setAgeGroup(data, '13_17');
  assert.deepEqual(Array.from(data.pop), F.cells.ages['13_17'].map(Math.fround), 'secondary: children aged 13 to 17');
  assert.equal(data.weights.children, undefined, 'under 15 means nothing among them');
  assert.ok(Math.abs(data.weights.no_car[1] - 12 * 0.2) < 1e-6, 'a group is the children times its share of the block');
  setCellShare(data, Float32Array.from([1, 0.4, 0, 0.7, 0, 1]));
  assert.ok(Math.abs(data.pop[1] - 12 * 0.4) < 1e-5, "hexagon 1: the 40% of its children in MAGS's zone");
  assert.ok(Math.abs(data.weights.no_car[3] - 9.5 * 0.4 * 0.7) < 1e-5);
  setUrban(data, true);
  assert.equal(data.pop[2], 0, 'rural, and outside the zone');
  assert.ok(Math.abs(data.pop[3] - 9.5 * 0.7) < 1e-5);
  setCellShare(data, null);
  setAgeGroup(data, null);
  assert.deepEqual(Array.from(data.pop), [217.4, 150, 0, 120, 200, 122.8].map(Math.fround), 'everyone again, urban only');
  setUrban(data, false);
  assert.equal(data.pop, data.everywhere.pop);
  assert.equal(setAgeGroup(data, 'nope'), false, 'a group the build does not send counts everyone');
});

// ---------------------------------------------------------------- headlines

test('headlines name the children counted, and public transport or walking', () => {
  round2();
  const base = { noun: 'a state secondary school that must take them', standard: 30 };
  assert.equal(accessSentence({ ...base, mode: 'pt' }),
    'of children aged 13–17 in this region can reach a state secondary school that must take them within 30 minutes by public transport, or on foot where that is quicker.');
  assert.match(accessSentence({ ...base, mode: 'walk', where: 'Albert-Eden' }), /^of children aged 13–17 in Albert-Eden can walk to/);
  setCounted(ageWords(F.meta, '5_10'));
  assert.match(accessSentence({ noun: 'a primary school', standard: 15, mode: 'best' }), /^of children aged 5–10 in .* can reach a primary school within 15 minutes without a car\.$/);
  setCounted(null);
  assert.match(accessSentence({ noun: 'a GP', standard: 15, mode: 'pt' }), /^of people in .* by public transport, or on foot where that is quicker\.$/);
  round1();
  assert.match(accessSentence({ noun: 'a GP', standard: 15, mode: 'pt' }), /within 15 minutes by public transport\.$/, 'a round-1 build: as before');
  round2();
  // One school with a zone: a share of the children living in it.
  assert.equal(zoneSentence({ standard: 30, mode: 'pt', people: 3912.4, zoneName: "Mt Albert Grammar School's zone" }),
    "of the 3,900 children aged 13–17 living in Mt Albert Grammar School's zone are within 30 minutes of it by public transport, or on foot where that is quicker.");
  // One school with no zone: a count, and why there is no share.
  assert.equal(withinSentence({ noun: 'Marist College', standard: 30, mode: 'pt', within: 2412, noZone: 'It has no home zone, so there is no catchment to give a share of.' }),
    'children aged 13–17 live within 30 minutes of Marist College by public transport, or on foot where that is quicker. It has no home zone, so there is no catchment to give a share of.');
  assert.equal(withinSentence({ noun: 'Marist College', standard: 30, mode: 'walk', within: 1 }), 'child aged 13–17 lives within 30 minutes of Marist College on foot.');
  round1();
  assert.equal(withinSentence({ noun: 'Mt Albert Grammar School', standard: 30, mode: 'pt', within: 57002.8 }),
    'people live within 30 minutes of Mt Albert Grammar School by public transport.');
  round2();
});

test('the words for each age group, and the line under the headline', () => {
  assert.equal(KIDS.many, 'children aged 13–17');
  assert.equal(KIDS.one, 'child aged 13–17');
  assert.equal(KIDS.column, 'children_13_17');
  assert.equal(KIDS.line, 'Counting children aged 13–17 (about Years 9 to 13), from 2023 Census age groups.');
  assert.equal(ageWords(F.meta, '11_12').line, 'Counting children aged 11–12 (about Years 7 to 8), from 2023 Census age groups.');
  assert.equal(ageWords(F.meta, '0_4').line, 'Counting children aged 0–4, from 2023 Census age groups.');
  assert.equal(ageWords({}, '5_10').many, 'children aged 5–10', 'from the key where meta says nothing');
  assert.equal(ageWords(F.meta, null).many, 'people');
});

// ---------------------------------------------------------------- words

test('the counting line under All and State, with children or residents', () => {
  const plural = 'secondary schools';
  const meta = readSchoolsMeta(F.meta);
  assert.equal(countingLine(D, S, { kind: 'all' }, { plural, meta, ages: KIDS }),
    'Counting all 9 secondary schools: 5 state, 1 state Māori-medium, 2 state-integrated and 1 private. '
    + 'Single-sex schools count for everyone. Counting children aged 13–17 (about Years 9 to 13), from 2023 Census age groups. School list as at 12 Nov 2026.');
  assert.equal(countingLine(D, S, { kind: 'all' }, { plural }), `Counting all 9 secondary schools: 5 state, 1 state Māori-medium, 2 state-integrated and 1 private. Single-sex schools count for everyone. ${RESIDENTS}`,
    'a build with no ages counts all residents, and says so');
  assert.equal(countingLine(D, S, { kind: 'state', students: 'both' }, { plural, ages: KIDS }),
    'Counting 5 state secondary schools taught in English. Not counted: 2 state-integrated, 1 private and 1 Māori-medium. '
    + 'Girls and boys: both must be able to reach one they can go to, and the time is the slower of the two. '
    + `${NO_ZONES} ${KIDS.line}`);
  assert.match(countingLine(D, S, { kind: 'state', students: 'girls' }, { plural }), /Counting co-ed and girls' schools: 4 of the 5\./);
  // A kura whose teaching language came from its peak body (rule D7) is named.
  const peak = D.map((d, k) => (k === TKKM ? { ...d, name: 'Te Wharekura o Tāmaki ki te Tonga', language_source: 'peak_body' } : d));
  assert.match(countingLine(peak, S, { kind: 'state', students: 'both' }, { plural }), /1 Māori-medium \(Te Wharekura o Tāmaki ki te Tonga from its peak body\)/);
});

test('the counting line under In zone', () => {
  const plural = 'secondary schools';
  const meta = readSchoolsMeta(F.meta);
  const line = countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones, meta, ages: KIDS, splitPeople: 21.5 });
  assert.equal(line,
    'In zone: state secondary schools taught in English that must take a child living here: the 4 whose home zone covers the home '
    + 'and the 1 with no zone, which must take any student who applies. '
    + "Open State College: the Ministry's file holds only its zone from 1 January 2027, which is used. "
    + 'Integrated, private and charter schools and kura are not counted: they enrol by their own rules (2 state-integrated, 1 private and 1 Māori-medium). '
    + "Zones from the Ministry's file of 2 October 2026, as in force on 12 November 2026. "
    + '22 children aged 13–17 live in hexagons a zone line splits; each hexagon is counted with the zones most of its residents live in. '
    + 'Girls and boys: both must be able to reach one they can go to, and the time is the slower of the two. '
    + 'Counting children aged 13–17 (about Years 9 to 13), from 2023 Census age groups. School list as at 12 Nov 2026.');
  assert.ok(!line.includes(NO_ZONES), 'In zone applies them');
  assert.match(countingLine(D, S, { kind: 'zone', students: 'girls' }, { plural, zones }), /^In zone: state secondary schools taught in English that must take a girl living here: the 4 whose/);
  assert.match(countingLine(D, S, { kind: 'zone', students: 'boys' }, { plural, zones }), /the 3 whose home zone covers the home and the 1 with no zone/);
  // Schools with a scheme but no map, and a map but no scheme.
  const odd = { ...zones, schools: { ...zones.schools, 3: { status: 'no_map' }, 4: { status: 'not_applied' } } };
  const oddLine = countingLine(D, S, { kind: 'zone', students: 'both' }, { plural, zones: odd });
  assert.match(oddLine, /Auckland Girls' Grammar School has an enrolment scheme but no zone in the Ministry's map file, so it counts for everyone\./);
  assert.match(oddLine, /Western Springs College-Ngā Puna o Waiōrea has a zone in the Ministry's file but no enrolment scheme in the directory, so it counts for everyone\./);
  // A place with no zones for these years: In zone is State.
  const none = { ...zones, schools: {} };
  assert.match(countingLine(D.map((d) => ({ ...d, zone: null, scheme: false })), S, { kind: 'zone', students: 'both' }, { plural, zones: none }),
    /^In zone: none of the 5 state secondary schools taught in English here that take a child has a home zone for these years, so each must take any student who applies, as under State\./);
});

test('the counting line under One school', () => {
  const plural = 'secondary schools';
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: true }, { plural, zones, ages: KIDS }),
    'Counting Mt Albert Grammar School only. Only those living in its zone are counted, each hexagon by the share of its residents inside the zone. '
    + KIDS.line);
  assert.equal(countingLine(D, S, { kind: 'one', moe: 69, zoneOnly: false }, { plural, zones }),
    `Counting Mt Albert Grammar School only. Everyone is counted, not only its zone. ${RESIDENTS}`);
  assert.equal(countingLine(D, S, { kind: 'one', moe: 99002 }, { plural, zones, ages: KIDS }),
    `Counting Boys High only. It has no home zone, so everyone is counted. ${KIDS.line}`);
  assert.equal(countingLine(L.destinations, S, { kind: 'one', moe: 69, zoneOnly: true }, { plural }),
    `Counting Mt Albert Grammar School only. Its zone is not in this build, so people in and out of its zone are counted alike. ${RESIDENTS}`,
    'a round-1 build');
});

test('names for headlines, the key and the card', () => {
  const base = { short: 'Secondary school', noun: 'a secondary school', plural: 'secondary schools' };
  assert.equal(choiceWords(base, null).noun, 'a secondary school');
  assert.equal(choiceWords(base, { kind: 'state', students: 'both' }).noun, 'a state secondary school taught in English');
  assert.equal(choiceWords(base, { kind: 'state', students: 'girls' }).noun, 'a state secondary school taught in English that takes girls');
  assert.equal(choiceWords(base, { kind: 'state', students: 'both' }).short, 'State secondary school');
  const zone = choiceWords(base, { kind: 'zone', students: 'both' }, null, { children: true });
  assert.equal(zone.noun, 'a state secondary school that must take them');
  assert.equal(zone.short, 'State secondary school, in zone');
  assert.equal(zone.nearestLabel, 'Nearest state school that must take them');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'both' }).noun, 'a state secondary school that must take a child living there', 'counting everyone');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'girls' }, null, { children: true }).noun, 'a state secondary school that must take a girl living there');
  assert.equal(choiceWords(base, { kind: 'zone', students: 'girls' }).short, 'State secondary school, in zone, girls');
  assert.equal(choiceWords(base, { kind: 'one', moe: 69 }, D[MAGS]).noun, 'Mt Albert Grammar School');
});

test("the card under In zone: the school that must take them, and a split hexagon's share", () => {
  round2();
  setServices({ services: { [S]: {} } });
  const data = dataSet();
  const choice = { kind: 'zone', students: 'both' };
  const result = run(choice);
  applyToData(data, S, result);
  const band = verdictLine(data, 0, S, 30, 'pt', null, cardFor(choice, result));
  assert.equal(band.strong, 'State secondary school, in zone: 15 min on foot. No bus or train is quicker.');
  assert.match(band.rest, /^Nearest state school that must take them: Mt Albert Grammar School\. Not counted: TKKM o Nga Maungarongo, 9 min \(state, Māori-medium\); Marist College, 12 min/);
  const split = verdictLine(data, 1, S, 30, 'pt', null, cardFor(choice, result));
  assert.equal(split.strong, 'State secondary school, in zone: 20 min by public transport.');
  assert.match(split.rest, /A zone line crosses this hexagon: 60% of its residents live in Western Springs College-Ngā Puna o Waiōrea's zone; times are for them\./);
  assert.match(split.rest, /Not counted: Mt Albert Grammar School, 20 min \(out of zone\)|Nearest state school/);
  restoreData(data);
});

test("One school's card: in its zone, partly, or not; no zone; a corrected point", () => {
  round2();
  const data = dataSet();
  const choice = { kind: 'one', moe: 69, students: 'both', zoneOnly: true };
  const result = run(choice);
  applyToData(data, S, result);
  const card = cardFor(choice, result);
  const at = (i, mode = 'pt') => verdictLine(data, i, S, 30, mode, null, card).rest;
  assert.match(at(0), /Inside its enrolment zone\./);
  assert.match(at(1), /About 40% of the people here live inside its enrolment zone; a zone line crosses this hexagon\./);
  assert.match(at(4), /Outside its enrolment zone\./);
  assert.match(at(0), /Times go to the Ministry's map point for the school \(the pin, about 400 m away in a straight line\), not to its nearest gate\./);
  assert.doesNotMatch(at(0), /Nearest: Mt Albert/, 'One school does not name itself again');
  // A school with no home zone says so.
  const boys = cardLines({ destinations: D, service: S, choice: { kind: 'one', moe: 99002 }, reach, zones }, 'pt', 4, []);
  assert.ok(boys.includes('It has no home zone.'), boys.join(' | '));
  // A point moved inside the grounds (rule D5-1).
  const moved = cardLines({ destinations: D.map((d, k) => (k === MAGS ? { ...d, point: 'corrected' } : d)), service: S, choice, reach, zones, moved: { 69: 2500 } }, 'pt', 0, []);
  assert.ok(moved.includes("Times go to a corrected point inside the school's grounds; the Ministry's map point is 2.5 km away."), moved.join(' | '));
  restoreData(data);
});

test('facts about one school, with its zone dates', () => {
  assert.deepEqual(schoolFacts(D[MAGS], S, { zones, d: MAGS }), [
    'State · co-ed · Years 9–15 · roll 3,635 (1 Oct 2026)',
    "Zone in force since 6 June 2018. A new zone starts on 1 January 2027; it is not applied. Times go to the Ministry's map point for the school. Ministry number 69.",
  ]);
  assert.match(schoolFacts(D[OPEN], S, { zones, d: OPEN })[1], /^The Ministry's file holds only its new zone, from 1 January 2027, so that zone is used\./);
  assert.match(schoolFacts(D[BOYS_HIGH], S, { zones, d: BOYS_HIGH }).join(' '), /No enrolment scheme\. Times go to the nearest of 2 checked entrances\./);
  assert.match(schoolFacts({ ...D[MAGS], scheme: true, zone: null }, S, { zones, d: 77 })[1], /^Its zone is not in the Ministry's map file\./);
  assert.match(schoolFacts(L.destinations[MAGS], S)[1], /^Zone in force from 6 Jun 2018\./, 'a round-1 build');
  assert.match(schoolFacts({ ...D[MAGS], point: 'corrected' }, S, { zones, d: MAGS, moved: 340 })[1], /Times go to a corrected point inside the school's grounds; the Ministry's map point is 350 m away\./);
  assert.match(schoolFacts({ ...D[TKKM], language_source: 'peak_body' }, S)[0], /Māori-medium \(from its peak body\)/);
});

test('finding a school by name or number', () => {
  assert.deepEqual(findSchools(D, S, 'albert gram'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'Ngā Puna'), [WSC], 'macrons fold');
  assert.deepEqual(findSchools(D, S, '69'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'hill'), [], 'a GP is not a school');
  assert.deepEqual(findSchools(D, S, 'Mount Albert Grammar'), [MAGS]);
  assert.deepEqual(findSchools(D, S, 'MAGS'), [MAGS]);
  assert.equal(findSchools(D, S, 'AGGS')[0], AGGS);
});

// ---------------------------------------------------------------- stops near a school

test('stops near the school: the section, the rows and the CSV lines', () => {
  const stops = decodeStops(F.stops);
  assert.equal(decodeStops({ format: 2 }), null);
  assert.equal(stopsAt(stops, MAGS).length, 3);
  assert.deepEqual(stopsAt(stops, AGGS), [], 'listed with none');
  assert.equal(stopsAt(stops, WSC), null, 'not in the file');
  assert.equal(stopHours(stops), '7–9am');
  assert.equal(stopHours(stops, { ascii: true }), '7am-9am');
  assert.equal(stopsIntro(stops), "Stops and stations within a 15-minute walk of the school's map point, on the street network. "
    + 'Buses and trains stopping between 7am and 9am on Tuesday 15 September 2026.');
  const rows = stopsAt(stops, MAGS).map((row) => stopLine(row, stops));
  assert.deepEqual(rows, [
    'Mount Albert Grammar School (stop 1427) · 1 min walk · no trips on any day in the timetable used',
    'St Lukes (stop 8861) · 7 min walk · 14 trips 7–9am · OUT, 22N',
    'Baldwin Ave Train Station (stop 9300) · 12 min walk · 12 trips 7–9am · WEST',
  ]);
  assert.deepEqual(stopsCsvLines(stops, MAGS), [
    "Stops within a 15-minute walk of the school's map point (walking minutes on the street network, rounded down; trips stopping 7am-9am on Tuesday 15 September 2026, at_gtfs_2026-09-01.zip):",
    'stop 1427 Mount Albert Grammar School: no service, 1 min walk, 0 trips stopping (none on any day in the timetable)',
    'stop 8861 St Lukes: bus, 7 min walk, 14 trips stopping (OUT 10, 22N 4)',
    'stop 9300 Baldwin Ave Train Station: train, 12 min walk, 12 trips stopping (WEST 12)',
  ]);
  assert.equal(stopsCsvLines(stops, AGGS)[1], 'No stop within a 15-minute walk.');
  assert.deepEqual(stopsCsvLines(stops, WSC), []);
  assert.deepEqual(stopsCsvLines(null, MAGS), []);
});

// ---------------------------------------------------------------- the CSV

test('the CSV: residents and children, zone_share, R5 minutes and the header lines', () => {
  const result = run({ kind: 'one', moe: 69 });
  const share = zoneShares(zones, MAGS, N).share;
  const residents = Float32Array.from(F.pop);
  const text = schoolsCsv({
    h3: F.h3, residents, children: Float32Array.from(F.cells.ages['13_17']), childrenColumn: KIDS.column,
    include: Uint8Array.from(residents, (v, i) => (v > 0 && share[i] > 0 ? 1 : 0)),
    placeNames: ['St Lukes', 'Mount Albert', 'X', 'Y, "Z"', 'W', 'V'],
    t: result.t, near: result.near, ties: result.ties, destinations: D, modes: MODES,
    header: ['Counting Mt Albert Grammar School only.', ptCsvLine('between 7am and 9am on Tuesday 15 September 2026', true)],
    extra: { minutes_pt_r5: result.r5, zone_share: share },
  });
  const lines = text.trim().split('\n');
  assert.equal(lines[0], '# Counting Mt Albert Grammar School only.');
  assert.equal(lines[1], '# Public transport, or walking where that is quicker: minutes_pt is the lower of the public transport time (minutes_pt_r5, '
    + 'the median of trips leaving each minute between 7am and 9am on Tuesday 15 September 2026) and minutes_walk.');
  assert.equal(lines[2], 'h3,suburb,residents,children_13_17,minutes_walk,moe_walk,minutes_bike_low_stress,moe_bike_low_stress,minutes_pt,moe_pt,minutes_pt_r5,zone_share');
  assert.equal(lines[3], '89bb50021a3ffff,St Lukes,217.4,25.1,15,69,10,69,15,69,15,1');
  assert.equal(lines[4], '89bb50021a7ffff,Mount Albert,150,12,,,18,69,20,69,20,0.4');
  assert.equal(lines.length, 3 + 4, 'hexagons outside the zone are left out');
  assert.equal(lines[6], '89bb50021b7ffff,V,122.8,8,15,69,6,69,15,69,26,1');
  assert.match(ptCsvLine('in the usual window', false), /^Public transport: the median of trips/, 'a round-1 build');
  // Shares keep the three places zones.json gives them; minutes keep one.
  const small = schoolsCsv({ h3: ['a'], residents: [10], placeNames: [''], t: { walk: [12.34] }, near: {}, ties: {}, destinations: D, modes: ['walk'],
    extra: { zone_share: Float32Array.of(0.347) } });
  assert.equal(small.trim().split('\n')[1], 'a,,10,12.3,,0.347');
});

test('the nearest among some schools, for one hexagon', () => {
  assert.deepEqual(nearestAt(reach.pt, 0, (d) => isState(D[d])), { m: 15, ds: [MAGS] });
  assert.equal(nearestAt(reach.pt, 2, () => true), null);
});

test("summary.json's meta.schools, as the build writes it", () => {
  const meta = readSchoolsMeta(F.meta);
  assert.equal(meta.directory, '2026-11-12');
  assert.equal(meta.roll_date, '2026-10-01');
  assert.deepEqual(meta.reach, { [S]: ['walk', 'bike_low_stress', 'pt'] });
  assert.equal(meta.school_buses, false);
  assert.equal(meta.zone_source.version, '2026-10-02');
  assert.equal(meta.zone_reference, '2026-11-12');
  assert.equal(meta.zone_upcoming.length, 2);
  assert.deepEqual(meta.choices, ['all', 'state', 'zone', 'one']);
  assert.equal(meta.stops.gtfs, 'at_gtfs_2026-09-01.zip');
  assert.equal(meta.formats.school_reach, 2);
  assert.ok(meta.pt_or_walk);
  const old = readSchoolsMeta(L.meta);
  assert.equal(old.zones, null, 'round 1: no zones');
  assert.equal(old.zone_source, null);
  assert.deepEqual(readSchoolsMeta({}), {}, 'a build before 0.12');
});

test('a short car list answers All and State, and says it is short', () => {
  const short = decodeReach({ format: 2, complete: false, o: [0, 2], d: [TKKM, MAGS], m: [2, 6] }, 1);
  assert.equal(short.complete, false);
  const state = chooseSchools({ destinations: D, service: S, choice: { kind: 'state', students: 'girls' }, reach: { car: short }, n: 1, standardModes: [] });
  assert.equal(state.t.car[0], 6);
  const lines = cardLines({ destinations: D, service: S, choice: { kind: 'state', students: 'girls' }, reach: { car: short }, result: state }, 'car', 0, [MAGS]);
  assert.ok(!lines.some((l) => /^Not counted/.test(l)), lines.join(' '));
});

test('girls and boys: on foot only when it is for the student whose time is shown', () => {
  const walk = decodeReach({ format: 1, o: [0, 2], d: [BOYS_HIGH, AGGS], m: [12, 15] }, 1);
  const pt = decodeReach({ format: 1, o: [0, 2], d: [AGGS, BOYS_HIGH], m: [10, 15] }, 1);
  const result = chooseSchools({ destinations: D, service: S, choice: { kind: 'state', students: 'both' }, reach: { walk, pt }, n: 1, standardModes: ['walk', 'pt'] });
  assert.equal(result.ptFoot.mask[0], 0);
  const data = { t: { [S]: { walk: result.t.walk, pt: result.t.pt } }, nearestMode: { [S]: result.near }, ties: { [S]: result.ties }, ptFoot: { [S]: result.ptFoot } };
  const words = tripWords(data, S, 'pt', 0);
  assert.equal(words.onFoot, false);
  assert.deepEqual(words.names, [BOYS_HIGH], "the boy's bus trip sets the time");
});

test('under a fare budget the priced time names nothing, and no fare means walks (z0)', () => {
  round2();
  const data = dataSet();
  data.meta.fares = {};
  data.cost[S] = { z1: Float32Array.from([30, 25, NaN, 27, 15, 26]), z0: Float32Array.from([9, NaN, NaN, 26, 10, 15]) };
  const band = verdictLine(data, 0, S, 30, 'pt', 1);
  assert.equal(band.strong, 'Secondary school: 30 min by public transport.');
  assert.doesNotMatch(band.rest, /Nearest|By bus/);
  assert.equal(serviceVerdict(data, 0, S, 30, 'pt', 1).shown, 30);
  assert.equal(serviceVerdict(data, 4, S, 30, 'pt', 0).shown, 10, 'no fare affordable: the walk, which needs none');
  assert.deepEqual(Array.from(times(data, S, 'pt', 0)).map((v) => (Number.isFinite(v) ? v : null)), [9, null, null, 26, 10, 15]);
});

// ---------------------------------------------------------------- words kept from round 1

test('when public transport was timed: one named day, not weekdays', () => {
  assert.equal(windowWords({ start: '07:00', minutes: 120 }, '2026-09-15'), 'between 7am and 9am on Tuesday 15 September 2026');
  assert.equal(windowWords({ start: '10:00', minutes: 120, date: '2026-09-19' }, '2026-09-15'), 'between 10am and midday on Saturday 19 September 2026');
  assert.equal(windowWords(null, '2026-09-15'), null);
});

test('straight-line distances read to 50 m or a tenth of a kilometre', () => {
  assert.equal(distance(0.252), '250 m');
  assert.equal(distance(0.004), '50 m');
  assert.equal(distance(0.98), '1.0 km');
  assert.equal(distance(NaN), '');
});

test('the school bus line says dedicated school buses are left out', () => {
  const lines = cardLines({ destinations: D, service: S, choice: { kind: 'one', moe: 69 }, reach, schoolBuses: false }, 'pt', 0, []);
  assert.equal(lines[lines.length - 1], 'Dedicated school buses are not in the timetable used, so they are not counted.');
});

test('the tooltip says what the card says, under every choice, way and hexagon', () => {
  round2();
  setServices({ services: { [S]: {} } });
  for (const c of [{ kind: 'all' }, { kind: 'state', students: 'both' }, { kind: 'state', students: 'girls' }, { kind: 'zone', students: 'both' }, { kind: 'one', moe: 69 }]) {
    const d = dataSet();
    const r = c.kind === 'all' ? null : run(c);
    if (r) applyToData(d, S, r);
    const words = cardFor({ ...ALL_CHOICE, ...c }, r);
    for (let i = 0; i < N; i += 1) {
      for (const mode of ['walk', 'bike_low_stress', 'pt', 'best']) {
        assert.equal(tooltipLines(d, i, S, 30, mode, null, words.short)[0], verdictLine(d, i, S, 30, mode, null, words).strong, `${c.kind} ${i} ${mode}`);
      }
    }
  }
});
