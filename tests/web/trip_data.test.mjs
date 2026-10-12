import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  addGraphTile, cellOrder, classTable, graphStore, legSwap, MinHeap, minutesOf, pairTimes, ptTrip, route, routeCells,
  rowsOf, stopWalks, tilesAround, tileOfNode, tripFigures, tripStore,
} from '../../web/js/trip_data.js';

// Real Auckland files cut down by tests/fixtures/make_trip_fixture.py, with the answers it worked out in Python:
// scipy's Dijkstra on MATE's graph tiles, and TEAM's parquet cache for the public transport pairs.
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'trip');

function readFixture(file) {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (existsSync(`${file}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${file}.gz`)).toString('utf8'));
  return null;
}

const fetcher = async (folder, name) => {
  const body = readFixture(path.join(folder, `${name}.json`));
  if (!body) throw new Error(`Could not load ${name}.json (404)`);
  return body;
};

function storeFor(expected) {
  const ids = Object.fromEntries(Object.entries(expected.ids).map(([k, v]) => [Number(k), v]));
  const geo = {
    parent: (id, res) => expected.geo[id][`r${res}`],
    centre: (id) => expected.geo[id].centre,
  };
  return tripStore({ base: `${FIX}/`, ids, order: expected.order ?? null, geo, fetcher });
}

// ---------------------------------------------------------------- small parts

test('the heap gives its items smallest key first', () => {
  const heap = new MinHeap();
  const keys = [5, 3.5, 9, 0.25, 7, 3.5, 12, 1];
  keys.forEach((k, i) => heap.push(k, i));
  const got = [];
  while (heap.size) {
    heap.pop();
    got.push(heap.lastKey);
  }
  assert.deepEqual(got, [...keys].sort((a, b) => a - b));
});

test('whole minutes round half up from seconds, as MATE\'s files do', () => {
  assert.equal(minutesOf(89.99), 1);
  assert.equal(minutesOf(90), 2);
  assert.equal(minutesOf(0.001), 0);
  assert.equal(minutesOf(null), null);
  assert.equal(minutesOf(Infinity), null);
});

test('the cell order fingerprint is the one TEAM\'s pairs carry', async () => {
  const order = readFixture(path.join(FIX, 'order.json'));
  assert.equal(await cellOrder(order.ids), order.order);
});

test('one origin\'s rows are found by adding up the counts before it', () => {
  assert.deepEqual(rowsOf([3, 8, 20], [2, 0, 4], 20), [2, 6]);
  assert.deepEqual(rowsOf([3, 8, 20], [2, 0, 4], 8), [2, 2]);
  assert.equal(rowsOf([3, 8, 20], [2, 0, 4], 9), null);
});

// A status class byte: the better side in bits 0-2 (status, harder), the other side of a street in bits 3-5.
const side = (code, hard = 0) => code | (hard << 2);
const index1 = {
  costs: { harder: 1.5, unknown_cautious: 3, eps_s: 0.001, junction_xlen_m: 4 },
  classes: [[side(0)], [side(1, 1) | (side(2) << 3)], [side(3) | (side(3) << 3)], [side(2, 1) | (side(2, 1) << 3)]],
};

test('a street takes its quicker side in each view, and a barrier is never used', () => {
  const nkb = classTable(index1, 0, 'nkb');
  const cautious = classTable(index1, 0, 'cautious');
  const known = classTable(index1, 0, 'known');
  // Harder on one side, not known on the other: the side not known is quicker unless it costs three times as much.
  assert.deepEqual([nkb.mult[1], nkb.status[1]], [1, 2]);
  assert.deepEqual([cautious.mult[1], cautious.status[1]], [1.5, 1]);
  assert.deepEqual([known.mult[1], known.status[1]], [1.5, 1]);
  assert.deepEqual([nkb.mult[2], nkb.status[2]], [Infinity, -1]);
  // Not known and harder for something that is known: both charges, cautiously.
  assert.equal(cautious.mult[3], 4.5);
  assert.equal(known.status[3], -1);
});

// ---------------------------------------------------------------- routing on a made-up pair of tiles

// Two tiles: nodes 0-2 in A, 3-4 in B. A footway 0-1-2 (100 m each), a junction half 2-3, and a street 3-4
// (200 m) harder on its better side and not known on the other. Cell 7 joins node 0; cell 9 joins node 4, and only
// walking may use that join.
const variants = [
  { key: 'walk', speed_kmh: 4.8, foot_kmh: 4.8 },
  { key: 'cargo_bike', speed_kmh: 12, foot_kmh: 4.8 },
];
const madeIndex = {
  nodes: 5, edges: 4, per_m: 100, deg: 100000, tile_res: 6, views: ['nkb', 'cautious', 'known'], variants,
  costs: index1.costs, kinds: ['footway', 'junction', 'residential'], walked: [true, true, false],
  classes: [[side(0), side(0)], [side(2) | (side(2) << 3), side(0)], [side(1, 1) | (side(2) << 3), side(0)]],
  tiles: [{ id: 'A', n0: 0, nn: 3, e0: 0, ne: 3, bbox: [174.7, -36.8, 174.71, -36.79] },
    { id: 'B', n0: 3, nn: 2, e0: 3, ne: 1, bbox: [174.72, -36.8, 174.73, -36.79] }],
};
const all = (2 ** 6) - 1;
const tileA = {
  tile: 'A', n0: 0, nn: 3, lon: [17470000, 100, 100], lat: [-3680000, 0, 0], e0: 0, ne: 3, fe: [],
  a: [0, 1, 1], b: [1, 1, 1], l: [10000, 10000, 0], k: [0, 0, 1], t: [0, 0, 1],
  c: [7], cn: [1], cj: [0], cd: [1000], cm: [all], s: [], sn: [], sj: [], sd: [], sm: [],
};
const tileB = {
  tile: 'B', n0: 3, nn: 2, lon: [17470300, 200], lat: [-3680000, 0], e0: 3, ne: 1, fe: [2],
  a: [0, -1], b: [1, 1], l: [20000, 0], k: [2, 1], t: [2, 1],
  c: [9], cn: [1], cj: [1], cd: [500], cm: [1 | 2 | 4], s: ['stop-1'], sn: [1], sj: [1], sd: [300], sm: [all],
};

test('a route through a tile not loaded is flagged, and found once the tile is added', () => {
  const g = graphStore(madeIndex);
  addGraphTile(g, tileA);
  assert.equal(tileOfNode(g, 3), 1);
  const first = route(g, { cell: 7, tile: 'A' }, { cell: 9, tile: 'B' }, { variant: 'walk' });
  assert.equal(first.complete, false);
  assert.deepEqual(first.missing, ['B']);
  addGraphTile(g, tileB);
  addGraphTile(g, tileB);
  assert.equal(g.edges.id.length, 4, 'the edge both tiles list is added once');
  const r = route(g, { cell: 7, tile: 'A' }, { cell: 9, tile: 'B' }, { variant: 'walk' });
  assert.equal(r.complete, true);
  const v = 4.8 / 3.6;
  // 10 m in, 200 m of footway, a junction half (no length, no charge by day), 200 m of street on the side not
  // known (quicker than the harder side), 5 m out; each step a millisecond.
  const want = (10 / v + 0.001) + (100 / v + 0.001) * 2 + (0 / v + 0.001) + (200 / v + 0.001) + (5 / v + 0.001);
  assert.ok(Math.abs(r.seconds - want) < 1e-9, `${r.seconds} vs ${want}`);
  assert.deepEqual(r.nodes, [0, 1, 2, 3, 4]);
  assert.deepEqual(r.metres, [200, 0, 200]);
  assert.equal(r.unrecorded, 200);
  assert.equal(r.link, 15);
  assert.deepEqual(r.crossings.junctions, 1);
  assert.deepEqual(r.runs.map((x) => x.status), [0, 2]);
  assert.deepEqual(r.coords[1], [174.701, -36.8]);
});

test('the cautious view charges what is not known, and the junction too', () => {
  const g = graphStore(madeIndex);
  addGraphTile(g, tileA);
  addGraphTile(g, tileB);
  const r = route(g, { cell: 7, tile: 'A' }, { cell: 9, tile: 'B' }, { variant: 'walk', view: 'cautious' });
  const v = 4.8 / 3.6;
  // The harder side (1.5 times) now beats the side not known (3 times); the junction half is charged as 4 m at
  // three times.
  const want = (10 / v + 0.001) + (100 / v + 0.001) * 2 + ((0 + 2 * 4) / v + 0.001) + ((200 + 0.5 * 200) / v + 0.001) + (5 / v + 0.001);
  assert.ok(Math.abs(r.seconds - want) < 1e-9);
  assert.deepEqual(r.metres, [200, 200, 0]);
  assert.equal(r.crossings.junctionsUnrecorded, 1);
});

test('a cargo bike is walked on footpaths and ridden on streets, and a join it may not use is left out', () => {
  const g = graphStore(madeIndex);
  addGraphTile(g, tileA);
  addGraphTile(g, tileB);
  const bike = route(g, { cell: 7, tile: 'A' }, { cell: 9, tile: 'B' }, { variant: 'cargo_bike' });
  assert.equal(bike.seconds, null);
  assert.equal(bike.reason, 'destination');
  const toStop = route(g, { cell: 7, tile: 'A' }, { stop: 'stop-1', tile: 'B' }, { variant: 'cargo_bike' });
  const walk = 4.8 / 3.6;
  const ride = 12 / 3.6;
  const want = (10 / walk + 0.001) + (100 / walk + 0.001) * 2 + 0.001 + (200 / ride + 0.001) + (3 / walk + 0.001);
  assert.ok(Math.abs(toStop.seconds - want) < 1e-9);
});

test('a route longer than the limit is not looked for, and needs no more tiles', () => {
  const g = graphStore(madeIndex);
  addGraphTile(g, tileA);
  addGraphTile(g, tileB);
  const r = route(g, { cell: 7, tile: 'A' }, { cell: 9, tile: 'B' }, { variant: 'walk', limitS: 60 });
  assert.equal(r.seconds, null);
  assert.equal(r.reason, 'not-reached');
  assert.equal(r.complete, true);
});

test('the tiles near two points are those whose nodes come within the margin', () => {
  assert.deepEqual(tilesAround(madeIndex, [[174.705, -36.795]], 100), ['A']);
  assert.deepEqual(tilesAround(madeIndex, [[174.705, -36.795]], 2000), ['A', 'B']);
});

// ---------------------------------------------------------------- 50 real pairs against scipy

const graphExpected = readFixture(path.join(FIX, 'graph_expected.json'));

test('routes on MATE\'s tiles match scipy on 50 pairs, for every variant and view', () => {
  const index = readFixture(path.join(FIX, 'mate', 'graph', 'index.json'));
  const g = graphStore(index);
  for (const id of graphExpected.tiles) addGraphTile(g, readFixture(path.join(FIX, 'mate', 'graph', `${id}.json`)));
  let compared = 0;
  let sameRoute = 0;
  for (const [o, d] of graphExpected.pairs) {
    const want = graphExpected.results[`${o}-${d}`];
    const ends = [o, d].map((cell) => ({ cell, tile: graphExpected.geo[graphExpected.ids[cell]].r6 }));
    for (const v of index.variants) {
      for (const view of index.views) {
        const w = want[v.key][view];
        const r = route(g, ends[0], ends[1], { variant: v.key, view });
        const label = `${o} to ${d}, ${v.key}, ${view}`;
        assert.equal(r.complete, w.complete, label);
        if (w.seconds == null) {
          assert.equal(r.seconds, null, label);
          continue;
        }
        assert.ok(Math.abs(r.seconds - w.seconds) <= 1e-9 * w.seconds, `${label}: ${r.seconds} vs ${w.seconds}`);
        assert.equal(r.minutes, w.minutes, label);
        compared += 1;
        // Two routes can take exactly the same time; when the route is the same, so are its metres.
        if (r.edges.length === w.edges && r.nodes[0] === w.first && r.nodes.at(-1) === w.last) {
          sameRoute += 1;
          r.metres.forEach((m, s) => assert.ok(Math.abs(m - w.metres[s]) <= 0.0501, `${label}: metres ${r.metres} vs ${w.metres}`));
        }
      }
    }
  }
  assert.ok(compared >= 500, `${compared} routes compared`);
  assert.ok(sameRoute >= 0.95 * compared, `${sameRoute} of ${compared} took the same route`);
});

test('routing between two cells fetches the tiles around them, and more when a route needs them', async () => {
  const store = storeFor(graphExpected);
  const [o, d] = graphExpected.pairs[0];
  const got = await routeCells(store, o, d, { variants: ['walk', 'manual_wheelchair'], views: ['nkb', 'cautious'] });
  for (const v of ['walk', 'manual_wheelchair']) {
    for (const view of ['nkb', 'cautious']) {
      const w = graphExpected.results[`${o}-${d}`][v][view];
      const r = got[v][view];
      // Tiles outside the fixture cannot be fetched: such a route stays flagged, and is otherwise scipy's.
      if (r.complete && w.complete) assert.ok(Math.abs(r.seconds - w.seconds) <= 1e-9 * w.seconds);
      r.missing.forEach((id) => assert.ok(!graphExpected.tiles.includes(id)));
    }
  }
});

// ---------------------------------------------------------------- 10 real public transport pairs

const ptExpected = readFixture(path.join(FIX, 'pt_expected.json'));

test('TEAM\'s times for 10 real pairs, by mode and window', async () => {
  const store = storeFor(ptExpected);
  for (const pair of ptExpected.pairs) {
    const got = await pairTimes(store, pair.o, pair.d);
    assert.ok(got, pair.note);
    for (const mode of ['walk', 'bike_low_stress', 'bike']) assert.equal(got[mode], pair.times[mode], `${pair.note}: ${mode}`);
    assert.deepEqual(got.pt, pair.times.pt, pair.note);
    assert.equal(got.limits.pt, 45);
  }
});

test('the walker\'s public transport path, with stop and route names', async () => {
  const store = storeFor(ptExpected);
  for (const pair of ptExpected.pairs) {
    for (const window of ['am_peak', 'interpeak', 'saturday']) {
      const want = pair.pt[window];
      const got = await ptTrip(store, pair.o, pair.d, window);
      const label = `${pair.note}, ${window}`;
      if (!want) {
        assert.equal(got, null, label);
        continue;
      }
      assert.equal(got.kind, want.kind, label);
      if (want.kind !== 'ride') continue;
      assert.equal(got.board.id, want.board, label);
      assert.equal(got.alight.id, want.alight, label);
      assert.equal(got.board.name, want.board_name, label);
      assert.equal(got.alight.name, want.alight_name, label);
      assert.deepEqual(got.routes.map((r) => r.name), want.routes, label);
      for (const k of ['access', 'egress', 'transfer', 'wait', 'ride']) assert.ok(Math.abs(got[k] - want[k]) < 0.051, `${label}: ${k}`);
      assert.equal(got.minutes, pair.times.pt[window], label);
    }
  }
});

test('each profile\'s walks to and from the same stops, swapped into the walker\'s path', async () => {
  const store = storeFor(ptExpected);
  let blocked = 0;
  for (const pair of ptExpected.pairs) {
    const want = pair.pt.interpeak;
    const got = await legSwap(store, pair.o, pair.d, 'interpeak');
    const label = pair.note;
    if (!want) {
      assert.equal(got.state, 'no-trip', label);
      continue;
    }
    if (want.kind !== 'ride') {
      assert.equal(got.state, want.kind, label);
      continue;
    }
    assert.ok(['ok', 'no-mate'].includes(got.state), label);
    for (const row of got.profiles) {
      for (const view of ['nkb', 'cautious']) {
        const w = want.profiles[row.key][view];
        assert.equal(row[view].toStop, w.toStop, `${label}: ${row.key} ${view} to the stop`);
        assert.equal(row[view].fromStop, w.fromStop, `${label}: ${row.key} ${view} from the stop`);
        if (w.total == null) assert.equal(row[view].total, null);
        else assert.ok(Math.abs(row[view].total - w.total) < 0.051, `${label}: ${row.key} ${view} total`);
      }
      if (row.key === 'manual_wheelchair' && row.nkb.toStop == null) blocked += 1;
    }
    // Walking on MATE's graph to the walker's stop: no more than 15 minutes, as TEAM's own walk.
    const walk = got.profiles.find((p) => p.key === 'walk');
    if (walk.nkb.toStop != null) assert.ok(walk.nkb.toStop <= 15);
  }
  assert.ok(blocked >= 1, 'one pair a manual wheelchair cannot start');
});

test('a rural cell has times on foot and by bike, and none by public transport', async () => {
  const store = storeFor(ptExpected);
  const rural = ptExpected.pairs.find((p) => p.note.startsWith('Clevedon'));
  const got = await pairTimes(store, rural.o, rural.d);
  assert.equal(got.ptFrom, false);
  assert.notEqual(got.walk, null);
  const figures = await tripFigures(store, rural.o, rural.d, 'interpeak');
  assert.equal(figures.state, 'no-trip');
});

test('MATE\'s stop walks are null where MATE has no footpath data', async () => {
  const store = storeFor(ptExpected);
  const devonport = ptExpected.pairs[0];
  const walks = await stopWalks(store, devonport.o);
  assert.equal(walks.minutes('walk', 'nkb', devonport.pt.interpeak.board), devonport.pt.interpeak.profiles.walk.nkb.toStop);
  assert.equal(walks.minutes('walk', 'nkb', 'no-such-stop'), null);
});
