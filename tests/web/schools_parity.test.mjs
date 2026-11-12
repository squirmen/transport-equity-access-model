// The page's school figures against the build's own (parity).
//
// The Python build writes tests/fixtures/schools/golden_<place>.json with the
// headline figure for each choice, worked out from the same exported files the
// page reads. Each figure here is rebuilt by schools.js from those files and
// must match. Without a golden file, or without the build it points at, the
// test is skipped.
//
// golden_<place>.json:
//   { "format": 1, "data": "<folder holding cells.json, destinations.json,
//     summary.json and schools/, relative to the repository>",
//     "figures": [{ "service", "choice": { "kind", "students", "moe", "zone_only" },
//                   "mode", "standard", "people", "share" }],
//     "cells": [{ "h3", "service", "choice", "mode", "minutes", "moe": [..] }] }
// `share` is the population-weighted share of people counted whose time is
// within `standard`; `people` is how many are counted; `minutes` is null for
// none within the routing limit; `moe` lists the school named, ties after it.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { chooseSchools, decodeReach, decodeZones, readChoice, schoolByMoe, zoneCells } from '../../web/js/schools.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const FOLDER = join(ROOT, 'tests/fixtures/schools');
// TEAM_SCHOOLS_GOLDEN names one more golden file anywhere, for checking a build in scratch.
const goldens = [
  ...(existsSync(FOLDER) ? readdirSync(FOLDER).filter((f) => /^golden_.+\.json$/.test(f)).map((f) => join(FOLDER, f)) : []),
  ...(process.env.TEAM_SCHOOLS_GOLDEN ? [resolve(process.env.TEAM_SCHOOLS_GOLDEN)] : []),
];

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const numeric = (values) => Float32Array.from(values, (v) => (v == null ? NaN : v));

function load(folder) {
  const cells = read(join(folder, 'cells.json'));
  const more = existsSync(join(folder, 'cells_more.json')) ? read(join(folder, 'cells_more.json')) : {};
  const summary = read(join(folder, 'summary.json'));
  return { cells: { ...cells, ...more }, meta: summary.meta, destinations: read(join(folder, 'destinations.json')), folder, lists: new Map() };
}

function reachOf(place, service, mode) {
  const key = `${service}_${mode}`;
  if (!place.lists.has(key)) place.lists.set(key, decodeReach(read(join(place.folder, 'schools', `${key}.json`)), place.cells.h3.length));
  return place.lists.get(key);
}

/** The times and the people counted for one figure, as the page works them out. */
function figure(place, { service, choice: asked, mode }) {
  const n = place.cells.h3.length;
  const choice = { ...readChoice(), ...asked, zoneOnly: asked.zone_only !== false };
  const counting = place.meta.standard_modes;
  const modes = mode === 'best' ? counting : [mode];
  let pop = numeric(place.cells.pop);
  let zones = null;
  if (choice.kind === 'zone' || choice.kind === 'one') {
    const path = join(place.folder, 'schools', 'zones.json');
    if (existsSync(path)) zones = decodeZones(read(path), service, n);
  }
  let t;
  let best = null;
  let near = {};
  let ties = {};
  if (choice.kind === 'all') {
    t = Object.fromEntries(modes.map((m) => [m, numeric(place.cells.t[service][m])]));
    near = place.cells.nearest_mode?.[service] || {};
    ties = place.cells.ties?.[service] || {};
  } else {
    const reach = Object.fromEntries(modes.map((m) => [m, reachOf(place, service, m)]));
    const result = chooseSchools({ destinations: place.destinations, service, choice, reach, zones, n, standardModes: counting, maxMinutes: place.meta.routing_max_minutes || 60 });
    t = result.t;
    best = result.best;
    near = result.near;
    ties = result.ties;
    if (choice.kind === 'one' && choice.zoneOnly && zones) {
      const cells = zoneCells(zones, schoolByMoe(place.destinations, service, choice.moe), n);
      if (cells.any) pop = Float32Array.from(pop, (v, i) => (cells.mask[i] ? v : 0));
    }
  }
  let times = t[mode];
  if (mode === 'best') {
    times = best && modes.length === counting.length ? best : Float32Array.from({ length: n }, (_, i) => Math.min(...modes.map((m) => (Number.isFinite(t[m][i]) ? t[m][i] : Infinity))));
  }
  const named = (i) => {
    const first = near[mode] ? near[mode][i] : null;
    if (first == null || first < 0) return [];
    return [first, ...((ties[mode] || {})[i] || [])].map((d) => place.destinations[d].moe);
  };
  return { times, pop, named };
}

if (!goldens.length) {
  test('school figures match the build', { skip: 'no tests/fixtures/schools/golden_<place>.json yet' }, () => {});
}

for (const name of goldens) {
  const golden = read(name);
  const folder = resolve(ROOT, golden.data || '');
  const skip = existsSync(join(folder, 'cells.json')) ? false : `the build at ${golden.data} is not here`;
  test(`school figures match the build: ${name.split('/').pop()}`, { skip }, () => {
    const place = load(folder);
    for (const want of golden.figures || []) {
      const { times, pop } = figure(place, want);
      let people = 0;
      let within = 0;
      for (let i = 0; i < times.length; i += 1) {
        if (!(pop[i] > 0)) continue;
        people += pop[i];
        if (Number.isFinite(times[i]) && times[i] <= want.standard) within += pop[i];
      }
      const label = `${want.service} ${JSON.stringify(want.choice)} ${want.mode} ${want.standard} min`;
      assert.ok(Math.abs(people - want.people) <= Math.max(0.5, want.people * 1e-6), `${label}: ${people} people, build ${want.people}`);
      assert.ok(Math.abs(within / people - want.share) <= 1e-6, `${label}: share ${within / people}, build ${want.share}`);
    }
    for (const want of golden.cells || []) {
      const i = place.cells.h3.indexOf(want.h3);
      assert.ok(i >= 0, `${want.h3} is not in the build`);
      const { times, named } = figure(place, want);
      const got = Number.isFinite(times[i]) ? times[i] : null;
      const label = `${want.h3} ${want.service} ${JSON.stringify(want.choice)} ${want.mode}`;
      assert.equal(got, want.minutes, label);
      if (want.moe && want.mode !== 'best') assert.deepEqual(named(i), want.moe, label);
    }
  });
}
