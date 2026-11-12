// The page's school figures against the build's own (parity).
//
// scripts/school_golden.py reads a place's published files and writes
// tests/fixtures/schools/golden_<place>.json (format in that script):
//
//   { place, version, people, urban_people, standards: { service: minutes },
//     figures: { "<choice>": { service: { mode: { share, share_urban,
//                                                 people_within, people } } } },
//     cells: { h3: { "<choice>": { service: { mode: minutes | null } } } },
//     named: { h3: { "<choice>": { service: { mode: [moe, ...] } } } } }
//
// where <choice> is all, state:both, state:girls, state:boys, zone:both,
// zone:girls, zone:boys, one:<moe> or one:<moe>:everyone, and mode is a way
// of travelling or best. From 0.12.0 round 2 a golden file also says
//
//   formats: the build's meta.formats, so a golden made from an older build
//            is skipped rather than compared with newer files;
//   weights: "children" where school figures count the children of each
//            service's ages (cells.json ages, meta.ages.services), as the page
//            does, or "residents" (the default) where they count everyone.
//
// one:<moe> counts, as the page does, only those living in the school's zone,
// each hexagon by its share of residents in it (zones.json share), where the
// school has a zone for the service; everyone where it has none. In zone
// reads the In zone sets from zones.json. Each figure here is worked out by
// schools.js from the same files and must match. The files are not in the
// repository: set TEAM_SITE to a built site's data folder (holding
// <place>/cells.json), as for the Python site checks. Places whose files are
// not there are skipped.
//
// The engine is also checked against the build directly: All, rebuilt from
// the reach lists, must give cells.json's times, nearest school, ties and the
// choice counts in cells_more.json, and the counts in the counting line must
// equal summary.json's.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { ageGroupFor, schoolAgeKey } from '../../web/js/ages.js';
import { ageArray } from '../../web/js/data.js';
import { chooseSchools, decodeReach, decodeZones, formatOk, groupCounts, isZoned, listAnswers, readChoice, schoolByMoe, zoneShares } from '../../web/js/schools.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const FOLDER = join(ROOT, 'tests/fixtures/schools');
const SITE = process.env.TEAM_SITE ? resolve(process.env.TEAM_SITE) : null;
// TEAM_SCHOOLS_GOLDEN names one more golden file anywhere, for checking a build in scratch.
const goldens = [
  ...(existsSync(FOLDER) ? readdirSync(FOLDER).filter((f) => /^golden_.+\.json$/.test(f)).map((f) => join(FOLDER, f)) : []),
  ...(process.env.TEAM_SCHOOLS_GOLDEN ? [resolve(process.env.TEAM_SCHOOLS_GOLDEN)] : []),
];

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const numeric = (values) => Float32Array.from(values, (v) => (v == null ? NaN : v));
const finite = (v) => (Number.isFinite(v) ? v : null);

function load(folder) {
  const cells = read(join(folder, 'cells.json'));
  const more = existsSync(join(folder, 'cells_more.json')) ? read(join(folder, 'cells_more.json')) : {};
  const summary = read(join(folder, 'summary.json'));
  // As the page does (data.js): cells_more's keys replace cells.json's.
  const zonesPath = join(folder, 'schools', 'zones.json');
  const zonesJson = existsSync(zonesPath) ? read(zonesPath) : null;
  return {
    cells: { ...cells, ...more }, ties: cells.ties || {}, meta: summary.meta, destinations: read(join(folder, 'destinations.json')), folder, lists: new Map(),
    zonesJson: zonesJson && formatOk(summary.meta, 'zones', zonesJson) ? zonesJson : null, zones: new Map(),
  };
}

function zonesOf(place, service) {
  if (!place.zonesJson) return null;
  if (!place.zones.has(service)) place.zones.set(service, decodeZones(place.zonesJson, service, place.cells.h3.length));
  return place.zones.get(service);
}

function reachOf(place, service, mode) {
  const key = `${service}_${mode}`;
  if (!place.lists.has(key)) {
    const path = join(place.folder, 'schools', `${key}.json`);
    place.lists.set(key, existsSync(path) ? decodeReach(read(path), place.cells.h3.length) : null);
  }
  return place.lists.get(key);
}

/** "state:girls" as the page's choice. */
function choiceOf(key) {
  const [kind, rest, extra] = key.split(':');
  if (kind === 'one') return readChoice(`one:${rest}`, null, extra === 'everyone' ? '0' : null);
  return readChoice(kind, rest || null);
}

/** The weights a figure counts, as the page does: children of the service's
 *  ages where the golden says so, and for one school with a zone, each
 *  hexagon's share of residents in it. */
function weightsOf(place, golden, service, key) {
  const pop = numeric(place.cells.pop);
  let w = pop;
  const choice = choiceOf(key);
  if (golden.weights === 'children') {
    const group = ageGroupFor(place.meta, place.cells.ages, service);
    assert.ok(group, `${golden.place} ${service}: the golden counts children, and the build has no ages for it`);
    w = numeric(place.cells.ages[group]);
    // One school counts the ages its years cover, and girls (or boys) only at
    // a single-sex school, as the page does (ages.js schoolAgeKey).
    if (choice.kind === 'one') {
      const d = schoolByMoe(place.destinations, service, choice.moe);
      const own = d >= 0 ? schoolAgeKey(place.meta, place.cells.ages, service, place.destinations[d]) : null;
      if (own && own !== group) {
        const ages = Object.fromEntries(Object.entries(place.cells.ages).map(([k, v]) => [k, numeric(v)]));
        w = Float32Array.from(ageArray({ ages, meta: place.meta }, own), (v) => (Number.isFinite(v) ? v : 0));
      }
    }
  }
  const zones = zonesOf(place, service);
  if (choice.kind === 'one' && choice.zoneOnly !== false && zones) {
    const d = schoolByMoe(place.destinations, service, choice.moe);
    if (d >= 0 && isZoned(zones, place.destinations[d], d, service)) {
      const { share } = zoneShares(zones, d, w.length);
      w = Float32Array.from(w, (v, i) => v * share[i]);
    }
  }
  return w;
}

/** Times by mode (and best) for one choice and service, as the page works them out. */
function figures(place, service, key, modes) {
  const n = place.cells.h3.length;
  const counting = place.meta.standard_modes;
  const choice = choiceOf(key);
  if (choice.kind === 'all') {
    // All reads cells.json, as the page does.
    const t = Object.fromEntries(modes.filter((m) => m !== 'best').map((m) => [m, numeric(place.cells.t[service][m])]));
    t.best = Float32Array.from({ length: n }, (_, i) => {
      const v = Math.min(...counting.map((m) => (Number.isFinite(t[m][i]) ? t[m][i] : Infinity)));
      return Number.isFinite(v) ? v : NaN;
    });
    const near = place.cells.nearest_mode?.[service] || {};
    return { t, near: Object.fromEntries(Object.entries(near).map(([m, v]) => [m, Int32Array.from(v, (d) => (d == null ? -1 : d))])), ties: place.ties[service] || {} };
  }
  const reach = {};
  for (const m of modes) {
    if (m === 'best') continue;
    const list = reachOf(place, service, m);
    // A short list cannot answer One school, nor In zone unless it holds it (schools.js listAnswers).
    if (listAnswers(list, choice)) reach[m] = list;
  }
  for (const m of counting) if (!reach[m]) reach[m] = reachOf(place, service, m);
  const zones = choice.kind === 'zone' || choice.kind === 'one' ? zonesOf(place, service) : null;
  if (choice.kind === 'zone') assert.ok(zones, `${place.folder}: In zone figures need schools/zones.json`);
  const result = chooseSchools({ destinations: place.destinations, service, choice, reach, zones, n, standardModes: counting, maxMinutes: place.meta.routing_max_minutes || 60 });
  const t = { ...result.t };
  t.best = result.best || Float32Array.from({ length: n }, (_, i) => {
    const v = Math.min(...counting.map((m) => (Number.isFinite(t[m]?.[i]) ? t[m][i] : Infinity)));
    return Number.isFinite(v) ? v : NaN;
  });
  return { t, near: result.near, ties: result.ties };
}

function shareOf(times, weights, standard) {
  let people = 0;
  let within = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (!(weights[i] > 0)) continue;
    people += weights[i];
    if (Number.isFinite(times[i]) && times[i] <= standard) within += weights[i];
  }
  return { people, within, share: people > 0 ? within / people : NaN };
}

const named = (place, out, mode, i) => {
  const first = out.near[mode] ? out.near[mode][i] : -1;
  if (first == null || first < 0) return [];
  return [first, ...((out.ties[mode] || {})[i] || [])].map((d) => place.destinations[d].moe);
};

if (!goldens.length) {
  test('school figures match the build', { skip: 'no tests/fixtures/schools/golden_<place>.json' }, () => {});
}

for (const name of goldens) {
  const golden = read(name);
  const folder = SITE && golden.place ? join(SITE, golden.place) : null;
  const noBuild = !SITE ? 'set TEAM_SITE to a built site\'s data folder' : existsSync(join(folder, 'cells.json')) ? false : `no build at ${folder}`;
  let skip = noBuild;
  if (!skip) {
    // A golden made from an older build than the one here (round 1 against
    // round 2's lists) is compared with nothing: regenerate it.
    const built = read(join(folder, 'summary.json')).meta.formats || null;
    if (JSON.stringify(built?.school_reach ?? null) !== JSON.stringify(golden.formats?.school_reach ?? null)) {
      skip = `golden_${golden.place}.json was made from a build with school_reach format ${golden.formats?.school_reach ?? 1}, the build here is ${built?.school_reach ?? 1}: regenerate it with scripts/school_golden.py`;
    }
  }

  test(`school figures match the build: ${golden.place}`, { skip }, () => {
    const place = load(folder);
    let checked = 0;
    for (const [key, byService] of Object.entries(golden.figures)) {
      for (const [service, byMode] of Object.entries(byService)) {
        const standard = golden.standards[service];
        const pop = weightsOf(place, golden, service, key);
        const urban = place.cells.urban ? Float32Array.from(pop, (v, i) => v * (place.cells.urban[i] ? 1 : 0)) : null;
        const out = figures(place, service, key, Object.keys(byMode));
        for (const [mode, want] of Object.entries(byMode)) {
          const label = `${golden.place} ${key} ${service} ${mode}`;
          const got = shareOf(out.t[mode], pop, standard);
          assert.ok(Math.abs(got.people - want.people) <= 0.1, `${label}: ${got.people} people, build ${want.people}`);
          assert.ok(Math.abs(got.share - want.share) <= 1e-6, `${label}: share ${got.share}, build ${want.share}`);
          // One school's headline is this count (panel.js withinSentence).
          if (want.people_within != null) assert.ok(Math.abs(got.within - want.people_within) <= 0.1, `${label}: ${got.within} people within, build ${want.people_within}`);
          if (urban && want.share_urban != null) {
            const u = shareOf(out.t[mode], urban, standard);
            assert.ok(Math.abs(u.share - want.share_urban) <= 1e-6, `${label} urban: share ${u.share}, build ${want.share_urban}`);
          }
          checked += 1;
        }
      }
    }
    for (const [h3, byChoice] of Object.entries(golden.cells || {})) {
      const i = place.cells.h3.indexOf(h3);
      assert.ok(i >= 0, `${h3} is not in the build`);
      for (const [key, byService] of Object.entries(byChoice)) {
        for (const [service, byMode] of Object.entries(byService)) {
          const out = figures(place, service, key, Object.keys(byMode));
          for (const [mode, minutes] of Object.entries(byMode)) {
            assert.equal(finite(out.t[mode][i]), minutes, `${h3} ${key} ${service} ${mode}`);
            const names = golden.named?.[h3]?.[key]?.[service]?.[mode];
            if (names && mode !== 'best') assert.deepEqual(named(place, out, mode, i), names, `${h3} ${key} ${service} ${mode}: school named`);
          }
        }
      }
    }
    assert.ok(checked > 0);
  });

  test(`All rebuilt from the reach lists equals the build, and the counting line's counts: ${golden.place}`, { skip: noBuild }, () => {
    const place = load(folder);
    const n = place.cells.h3.length;
    const counting = place.meta.standard_modes;
    for (const service of Object.keys(golden.standards)) {
      const reach = {};
      for (const m of ['walk', 'bike_low_stress', 'bike', 'pt', 'car']) {
        const list = reachOf(place, service, m);
        if (list) reach[m] = list;
      }
      const all = chooseSchools({ destinations: place.destinations, service, choice: readChoice('all'), reach, n, standardModes: counting, maxMinutes: place.meta.routing_max_minutes || 60 });
      for (const [m, list] of Object.entries(reach)) {
        const shown = place.cells.t[service][m];
        const near = place.cells.nearest_mode[service][m];
        const ties = place.ties[service]?.[m] || {};
        let bad = 0;
        let badNear = 0;
        let badTies = 0;
        for (let i = 0; i < n; i += 1) {
          if (finite(all.t[m][i]) !== shown[i]) bad += 1;
          if ((all.near[m][i] < 0 ? null : all.near[m][i]) !== near[i]) badNear += 1;
          if (JSON.stringify(all.ties[m][i] || []) !== JSON.stringify(ties[i] || [])) badTies += 1;
        }
        assert.equal(bad, 0, `${golden.place} ${service} ${m}: ${bad} times differ from cells.json (complete list: ${list.complete})`);
        assert.equal(badNear, 0, `${golden.place} ${service} ${m}: ${badNear} schools named differ from cells.json`);
        assert.equal(badTies, 0, `${golden.place} ${service} ${m}: ${badTies} lists of tied schools differ from cells.json`);
      }
      // How many schools within each step, by the counting way that reaches most.
      for (const [limit, counts] of Object.entries(place.cells.choice?.[service] || {})) {
        let bad = 0;
        for (let i = 0; i < n; i += 1) if ((all.choice[limit]?.[i] ?? 0) !== (counts[i] ?? 0)) bad += 1;
        assert.equal(bad, 0, `${golden.place} ${service}: ${bad} hexagons count a different number of schools within ${limit} min`);
      }
      const line = place.meta.schools?.services?.[service];
      if (line) {
        const c = groupCounts(place.destinations, service);
        assert.equal(c.all, line.all, `${golden.place} ${service}: schools counted under All`);
        assert.equal(c.state, line.state, `${golden.place} ${service}: state schools taught in English`);
        assert.equal(c.integrated, line.kind.integrated);
        assert.equal(c.private, line.kind.private);
        assert.equal(c.charter, line.kind.charter);
        assert.equal(c.other_medium, line.state_maori + line.state_pacific, `${golden.place} ${service}: state Māori- or Pacific-medium`);
        assert.equal(c.language_unknown, line.state_language_unknown);
        for (const students of ['girls', 'boys']) {
          const sexed = groupCounts(place.destinations, service, students);
          assert.equal(sexed.state, line.state_sex['co-ed'] + line.state_sex[students], `${golden.place} ${service}: state schools that take ${students}`);
        }
      }
    }
  });
}
