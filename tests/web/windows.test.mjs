// Public transport timed at more than one time, and the pieces that read it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { costLayer, setWindow, times, tripTime, USUAL, windowOf, windowsFor } from '../../web/js/data.js';
import { concentrationIndex, shortfallLeaning } from '../../web/js/equity.js';
import { cheapestFareClasses } from '../../web/js/fares.js';

const f32 = (values) => Float32Array.from(values, (v) => (v == null ? NaN : v));

function makeData() {
  const data = {
    n: 2,
    meta: {
      standard_modes: ['walk', 'pt'],
      windows: {
        am_peak: { start: '07:00', label: 'Peak' },
        interpeak: { start: '10:00', label: 'Off-peak' },
        saturday: { start: '10:00', date: '2026-09-19', label: 'Saturday' },
      },
      services: {
        gp: { window: 'interpeak', windows: ['interpeak', 'am_peak', 'saturday'] },
        primary_school: { window: 'am_peak', windows: ['am_peak'] },
      },
      jobs: { window: 'am_peak', windows: ['am_peak', 'interpeak', 'saturday'] },
      access: { windows: { everyday: ['interpeak', 'saturday'], all: [null, 'am_peak'] } },
    },
    t: {
      gp: { walk: f32([30, 40]), pt: f32([15, 25]) },
      primary_school: { walk: f32([10, 12]), pt: f32([8, 9]) },
    },
    jobs: { pt: { 45: f32([10, 20]) } },
    fair: {},
    access: { pt: { everyday: f32([100, 80]), all: f32([90, 90]) } },
    cost: { gp: { z1: f32([15, null]) } },
    windowed: {
      t: { gp: { am_peak: f32([12, 20]), saturday: f32([31, null]) } },
      jobs: { saturday: { 45: f32([5, 9]) } },
      fair: {},
      access: { saturday: { everyday: f32([60, 50]) }, am_peak: { all: f32([95, 97]) } },
      cost: { gp: { saturday: { z1: f32([31, null]) } } },
    },
    activeWindow: {},
  };
  data.usual = {
    t: { gp: data.t.gp.pt, primary_school: data.t.primary_school.pt },
    jobs: data.jobs.pt,
    fair: undefined,
    access: data.access.pt,
    cost: { ...data.cost },
  };
  return data;
}

test('asking for Saturday moves only what was timed on Saturday', () => {
  const data = makeData();
  setWindow(data, 'saturday');
  assert.equal(data.t.gp.pt[0], 31);
  assert.equal(data.t.primary_school.pt[0], 8, 'a school run has no Saturday, so it keeps its own time');
  assert.equal(data.activeWindow.primary_school, 'am_peak');
  assert.equal(data.jobs.pt[45][0], 5);
  assert.equal(data.cost.gp.z1[0], 31);
  assert.equal(data.access.pt.everyday[0], 60);
  assert.equal(data.access.pt.all[0], 90, 'all opportunities has no Saturday version');
  // Walking does not depend on the clock.
  assert.equal(data.t.gp.walk[0], 30);
  // And back again.
  setWindow(data, null);
  assert.equal(data.t.gp.pt[0], 15);
  assert.equal(data.jobs.pt[45][0], 10);
  assert.equal(data.cost.gp.z1[0], 15);
});

test('best times follow the window', () => {
  const data = makeData();
  setWindow(data, 'am_peak');
  assert.equal(times(data, 'gp', 'best')[0], 12);
  setWindow(data, 'saturday');
  assert.equal(times(data, 'gp', 'best')[0], 30, 'walking beats a slow Saturday bus');
});

test('windows come from the data, usual first', () => {
  const data = makeData();
  assert.deepEqual(windowsFor(data, 'gp'), ['interpeak', 'am_peak', 'saturday']);
  assert.deepEqual(windowsFor(data, 'jobs'), ['am_peak', 'interpeak', 'saturday']);
  assert.deepEqual(windowsFor(data, 'score:all'), [USUAL, 'am_peak']);
  assert.equal(windowOf(data, 'primary_school', 'saturday'), 'am_peak');
  assert.equal(windowOf(data, 'gp', 'nonsense'), 'interpeak');
});

test('a Saturday trip is priced as a weekend trip', () => {
  const data = makeData();
  assert.deepEqual(tripTime(data, 'saturday'), { hour: 10, weekday: false });
  assert.deepEqual(tripTime(data, 'am_peak'), { hour: 7, weekday: true });
});

test('a budget past four zones reads the right layer on a fourteen-zone network', () => {
  const layers = {};
  for (let z = 1; z <= 14; z += 1) layers[`z${z}`] = f32([60 - z]);
  const data = { cost: { gp: layers } };
  assert.equal(costLayer(data, 'gp', 9)[0], 51);
  assert.equal(costLayer(data, 'gp', 30)[0], 46, 'more than the network has buys all of it');
  assert.equal(costLayer(data, 'gp', 0), null);
});

test('the fare map puts four zones and over in the last class', () => {
  const layers = {};
  for (let z = 1; z <= 14; z += 1) layers[`z${z}`] = f32([z >= 9 ? 18 : 40]);
  const data = {
    n: 1,
    meta: { standard_modes: ['walk', 'pt'], fares: { kind: 'zones', zone_cap: 14 } },
    t: { gp: { walk: f32([50]) } },
    cost: { gp: layers },
  };
  assert.equal(cheapestFareClasses(data, 'gp', 20)[0], 4);
});

test('the lean of the shortfall says where it falls', () => {
  // Most deprived places (NZDep 10) carry all of the shortfall.
  const gaps = f32([0.5, 0.4, 0, 0]);
  const index = concentrationIndex(gaps, f32([1, 1, 1, 1]), f32([10, 9, 2, 1]));
  assert.ok(index < -0.2);
  assert.match(shortfallLeaning(index), /heavily concentrated in more deprived areas/);
  assert.match(shortfallLeaning(0.01), /spread evenly/);
  assert.equal(shortfallLeaning(NaN), null);
});
