// The data behind the trip tab: a trip from one hexagon to another.
//
// - TEAM's own times for the pair by each mode and window, and the public
//   transport path behind each (pairs/, docs/pairs.md).
// - Each profile's walk to the boarding stop and from the alighting stop on
//   MATE's graph, swapped into that path (MATE's stops/ files): an estimate.
// - A route on MATE's graph for each profile, to draw and to say what it
//   passes, from MATE's graph tiles and a small Dijkstra (MATE's graph/).
//
// Auckland only, behind ?mate=1, as mate.js. Nothing is fetched until a trip
// is asked for, and every file is fetched once. MATE's docs/team_export.md
// describes its files.

/* global h3 */

import { fetchJson } from './data.js';

export const PLACES = ['auckland'];
export const WINDOWS = ['am_peak', 'interpeak', 'saturday'];
export const MODES = ['walk', 'bike_low_stress', 'bike'];
// The profiles MATE times public transport for: not the cargo bike, and not after dark (TEAM's windows are in
// daylight). Each gets a range: no known barrier, then cautious.
export const PT_PROFILES = ['walk', 'older_walker', 'manual_wheelchair', 'powered_chair_scooter', 'pram', 'child'];
export const RANGE_VIEWS = ['nkb', 'cautious'];
export const STOP_WALK_MINUTES = 15;
export const PT_MINUTES = 45;
export const STATUS = ['no known barrier', 'harder', 'not known', 'barrier'];
// Routes on MATE's graph are looked for up to this long. It bounds the tiles a trip fetches when a profile cannot
// get there at all: the search then stops here rather than spreading across Auckland.
export const ROUTE_LIMIT_S = 45 * 60;
const UNKNOWN = 2;

// ---------------------------------------------------------------- the store

/** Everything one place's trips need, fetched as asked for. base: the place's data folder; ids: cells.json's h3;
 *  order: cells.json's order fingerprint (cellOrder), checked against the pairs; geo and fetcher are for the
 *  tests (the page uses h3-js and fetchJson). */
export function tripStore({ base, ids, order = null, geo = null, fetcher = fetchJson }) {
  return { base, ids, order, geo: geo || h3Geo(), fetcher, files: new Map(), graph: null, transit: null };
}

function h3Geo() {
  return {
    parent: (id, res) => h3.cellToParent(id, res),
    centre: (id) => {
      const [lat, lng] = h3.cellToLatLng(id);
      return [lng, lat];
    },
  };
}

/** A file, fetched once. A missing file (or one that failed) is null; a failure is tried again next time. */
function file(store, folder, name) {
  const key = `${folder}${name}`;
  if (!store.files.has(key)) {
    const got = store.fetcher(`${store.base}${folder}`, name).catch(() => {
      store.files.delete(key);
      return null;
    });
    store.files.set(key, got);
  }
  return store.files.get(key);
}

/** The fingerprint of a cell order, as TEAM's pairs carry it: the first 16 hex digits of the SHA-256 of the ids
 *  joined by newlines. */
export async function cellOrder(ids) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.join('\n')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Rows [start, end) of one origin in a block laid out by counts n, origin after origin. */
export function rowsOf(cells, n, cell) {
  const k = sortedIndex(cells, cell);
  if (k < 0 || !n) return null;
  let start = 0;
  for (let q = 0; q < k; q += 1) start += n[q];
  return [start, start + (n[k] || 0)];
}

function sortedIndex(list, value) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] === value) return mid;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function findRow(block, rows, d) {
  if (!rows) return -1;
  for (let i = rows[0]; i < rows[1]; i += 1) if (block.d[i] === d) return i;
  return -1;
}

// ---------------------------------------------------------------- TEAM's pairs

/** pairs/index.json, or null when the place has none or they were routed for another cell order. */
export async function pairsIndex(store) {
  const index = await file(store, 'pairs/', 'index');
  if (!index) return null;
  if (store.order && index.order !== store.order) return null;
  return index;
}

/** TEAM's minutes from cell o to cell d (places in cells.json): walking, low-stress and any bikeable cycling, and
 *  public transport in each window. A mode is null when d is not within its limit (index.minutes). Null when TEAM
 *  has no pairs from o. ptFrom: whether TEAM times public transport from o at all (urban cells only). */
export async function pairTimes(store, o, d) {
  const index = await pairsIndex(store);
  if (!index) return null;
  const r7 = store.geo.parent(store.ids[o], index.resolution);
  if (!index.tiles.includes(r7)) return null;
  const tile = await file(store, 'pairs/', r7);
  if (!tile || tile.order !== index.order) return null;
  const minutes = (block) => {
    if (!block) return null;
    const i = findRow(block, rowsOf(tile.cells, block.n, o), d);
    return i < 0 ? null : block.m[i];
  };
  const pt = Object.fromEntries(WINDOWS.map((w) => [w, minutes(tile.pt?.[w])]));
  const ptFrom = WINDOWS.some((w) => {
    const rows = tile.pt?.[w] ? rowsOf(tile.cells, tile.pt[w].n, o) : null;
    return rows && rows[1] > rows[0];
  });
  return { ...Object.fromEntries(MODES.map((m) => [m, minutes(tile[m])])), pt, ptFrom, limits: index.minutes };
}

/** Every destination TEAM times from cell o, for the map while a destination is picked: { walk, bike_low_stress,
 *  bike: Map(d -> minutes), pt: { [window]: Map }, ptFrom, limits }. Null when TEAM has no pairs from o. */
export async function originTimes(store, o) {
  const index = await pairsIndex(store);
  if (!index) return null;
  const r7 = store.geo.parent(store.ids[o], index.resolution);
  if (!index.tiles.includes(r7)) return null;
  const tile = await file(store, 'pairs/', r7);
  if (!tile || tile.order !== index.order) return null;
  const read = (block) => {
    const out = new Map();
    const rows = block ? rowsOf(tile.cells, block.n, o) : null;
    if (rows) for (let i = rows[0]; i < rows[1]; i += 1) out.set(block.d[i], block.m[i]);
    return out;
  };
  const pt = Object.fromEntries(WINDOWS.map((w) => [w, read(tile.pt?.[w])]));
  return { ...Object.fromEntries(MODES.map((m) => [m, read(tile[m])])), pt, ptFrom: WINDOWS.some((w) => pt[w].size > 0), limits: index.minutes };
}

/** transit.json (stops, lines and the line shapes the map draws), fetched once. */
export function transitFile(store) {
  return file(store, '', 'transit');
}

/** Stop names: transit.json's stops, then the stops it leaves out (pairs/index.json). */
async function stopNames(store, index) {
  if (!store.transit) {
    store.transit = transitFile(store).then((transit) => {
      const byId = new Map();
      for (const f of transit?.stops?.features || []) {
        const p = f.properties;
        byId.set(p.id, { id: p.id, name: p.name, code: p.code ?? null, kind: p.kind, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
      }
      return byId;
    });
  }
  const byId = await store.transit;
  return (id) => {
    if (id == null) return null;
    if (byId.has(id)) return byId.get(id);
    const extra = index.stops_not_in_overlays?.[id];
    return extra ? { id, name: extra.name, code: null, kind: null, lon: extra.lon, lat: extra.lat } : { id, name: null, code: null, kind: null };
  };
}

/** The public transport path behind TEAM's time from o to d in a window: the path most departure minutes took,
 *  with its typical trip's minutes (docs/pairs.md). Null when the pair is not within 45 minutes. */
export async function ptTrip(store, o, d, window) {
  const index = await pairsIndex(store);
  if (!index) return null;
  const r7 = store.geo.parent(store.ids[o], index.resolution);
  if (!index.path_tiles?.[window]?.includes(r7)) return null;
  const tile = await file(store, `pairs/${window}/`, r7);
  if (!tile || tile.order !== index.order) return null;
  const i = findRow(tile, rowsOf(tile.cells, tile.n, o), d);
  if (i < 0) return null;
  const meta = index.windows?.[window] || {};
  const base = { window, label: meta.label ?? window, when: meta.when ?? null, minutes: tile.m[i], use: tile.use[i] };
  // No path recorded: only a time (R5 recorded no trip from this cell in any window).
  if (tile.use[i] == null) return { ...base, kind: 'no-path' };
  if (tile.b[i] == null) return { ...base, kind: 'walk' };
  const name = await stopNames(store, index);
  const routes = tile.routes[tile.r[i]].split('|').map((id) => ({ id, name: index.routes?.[id]?.name ?? id, type: index.routes?.[id]?.type ?? null }));
  const parts = { access: tile.acc[i], wait: tile.wait[i], ride: tile.ride[i], transfer: tile.xfer[i], egress: tile.egr[i] };
  const total = Math.round((parts.access + parts.wait + parts.ride + parts.transfer + parts.egress) * 10) / 10;
  return {
    ...base,
    kind: 'ride',
    board: name(tile.stops[tile.b[i]]),
    alight: name(tile.stops[tile.a[i]]),
    routes,
    rides: routes.length,
    ...parts,
    // wait, ride and changes: what the leg swap keeps.
    between: Math.round((parts.wait + parts.ride + parts.transfer) * 10) / 10,
    total,
  };
}

// ---------------------------------------------------------------- MATE's walks to stops

/** MATE's stop walks from one cell (its stops/ file, by the cell's resolution 6 parent), or null when MATE has no
 *  footpath data there. minutes(variant, view, stopId) is null beyond 15 minutes. */
export async function stopWalks(store, cell) {
  const r6 = store.geo.parent(store.ids[cell], 6);
  const body = await file(store, 'mate/stops/', r6);
  if (!body) return null;
  const k = sortedIndex(body.cells, cell);
  if (k < 0) return null;
  const at = new Map(body.stop_id.map((id, q) => [id, q]));
  const minutes = (variant, view, stopId) => {
    const block = body.s?.[variant]?.[view];
    const q = at.get(stopId);
    if (!block || q == null) return null;
    let start = 0;
    for (let x = 0; x < k; x += 1) start += block.n[x];
    for (let x = start; x < start + block.n[k]; x += 1) if (block.s[x] === q) return block.m[x];
    return null;
  };
  return { cell, minutes };
}

/** The leg swap for each profile (MATE's src/mate/team_pt.py, for one pair): the walker's path in the window,
 *  with the profile's own walks on MATE's graph to the same boarding stop and from the same alighting stop. Each
 *  view gives toStop, fromStop (minutes, null beyond 15), and total: those walks plus TEAM's wait, ride and
 *  changes, or null when a walk is not possible. It assumes the person takes the walker's trip, so label it an
 *  estimate. state: 'ok', 'no-trip' (not within 45 minutes), 'walk' (walked all the way), 'no-path', or
 *  'no-mate' (MATE has no footpath data at one end or both; mate.from and mate.to say which). */
export async function legSwap(store, o, d, window) {
  const trip = await ptTrip(store, o, d, window);
  if (!trip) return { state: 'no-trip', trip: null, profiles: null };
  if (trip.kind !== 'ride') return { state: trip.kind === 'walk' ? 'walk' : 'no-path', trip, profiles: null };
  const [from, to] = await Promise.all([stopWalks(store, o), stopWalks(store, d)]);
  const profiles = PT_PROFILES.map((key) => {
    const row = { key };
    for (const view of RANGE_VIEWS) {
      const toStop = from ? from.minutes(key, view, trip.board.id) : null;
      const fromStop = to ? to.minutes(key, view, trip.alight.id) : null;
      const total = toStop != null && fromStop != null ? Math.round((toStop + trip.between + fromStop) * 10) / 10 : null;
      row[view] = { toStop, fromStop, total, within: total != null && total <= PT_MINUTES + 1e-6 };
    }
    return row;
  });
  return { state: from && to ? 'ok' : 'no-mate', trip, profiles, mate: { from: Boolean(from), to: Boolean(to) } };
}

/** Everything the trip tab shows for a pair and a window, fetched together. */
export async function tripFigures(store, o, d, window) {
  const [times, swap] = await Promise.all([pairTimes(store, o, d), legSwap(store, o, d, window)]);
  return { o, d, window, times, ...swap };
}

// ---------------------------------------------------------------- routing on MATE's graph tiles

/** A binary heap of (key, item), smallest key first. */
export class MinHeap {
  constructor() {
    this.keys = [];
    this.items = [];
    this.lastKey = NaN;
  }

  get size() {
    return this.items.length;
  }

  push(key, item) {
    let i = this.items.length;
    this.keys.push(key);
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }

  pop() {
    const top = this.items[0];
    this.lastKey = this.keys[0];
    const key = this.keys.pop();
    const item = this.items.pop();
    const n = this.items.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c += 1;
        if (this.keys[c] >= key) break;
        this.keys[i] = this.keys[c];
        this.items[i] = this.items[c];
        i = c;
      }
      this.keys[i] = key;
      this.items[i] = item;
    }
    return top;
  }
}

/** Whole minutes from seconds, rounding half up, as MATE's files give them. */
export function minutesOf(seconds) {
  return seconds == null || !Number.isFinite(seconds) ? null : Math.floor(seconds / 60 + 0.5);
}

/** An empty graph for MATE's graph/index.json; tiles are added with addGraphTile. */
export function graphStore(index) {
  const n = index.nodes;
  return {
    index,
    tileAt: new Map(index.tiles.map((t, k) => [t.id, k])),
    starts: Int32Array.from(index.tiles.map((t) => t.n0)),
    loaded: new Uint8Array(index.tiles.length),
    edgeSeen: new Uint8Array(index.edges),
    lon: new Int32Array(n),
    lat: new Int32Array(n),
    edges: { id: [], a: [], b: [], l: [], k: [], t: [] },
    cells: new Map(),
    stops: new Map(),
    adjacency: null,
    tables: new Map(),
    junction: index.kinds.indexOf('junction'),
    kindSteps: index.kinds.indexOf('steps'),
    kindCrossing: index.kinds.indexOf('crossing'),
    kindJoin: index.kinds.indexOf('join'),
    dist: new Float64Array(n),
    prev: new Int32Array(n),
    seen: new Uint32Array(n),
    stamp: 0,
  };
}

/** Add one tile's nodes, edges and joins. An edge two tiles share is added once. */
export function addGraphTile(g, body) {
  const k = g.tileAt.get(body.tile);
  if (k == null || g.loaded[k]) return;
  const { n0, nn, ne, e0 } = body;
  let x = 0;
  let y = 0;
  for (let i = 0; i < nn; i += 1) {
    x += body.lon[i];
    y += body.lat[i];
    g.lon[n0 + i] = x;
    g.lat[n0 + i] = y;
  }
  const e = g.edges;
  let a = n0;
  for (let q = 0; q < body.a.length; q += 1) {
    a += body.a[q];
    const id = q < ne ? e0 + q : body.fe[q - ne];
    if (g.edgeSeen[id]) continue;
    g.edgeSeen[id] = 1;
    e.id.push(id);
    e.a.push(a);
    e.b.push(a + body.b[q]);
    e.l.push(body.l[q]);
    e.k.push(body.k[q]);
    e.t.push(body.t[q]);
  }
  for (const [prefix, map, keyOf] of [['c', g.cells, (v) => v], ['s', g.stops, (v) => v]]) {
    let at = 0;
    body[prefix].forEach((key, q) => {
      const n = body[`${prefix}n`][q];
      const joins = { node: [], dist: [], mask: [] };
      for (let r = at; r < at + n; r += 1) {
        joins.node.push(n0 + body[`${prefix}j`][r]);
        joins.dist.push(body[`${prefix}d`][r]);
        joins.mask.push(body[`${prefix}m`][r]);
      }
      map.set(keyOf(key), joins);
      at += n;
    });
  }
  g.loaded[k] = 1;
  g.adjacency = null;
}

/** The tile a node is in: its nodes are one run starting at n0. */
export function tileOfNode(g, node) {
  let lo = 0;
  let hi = g.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.starts[mid] <= node) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function adjacency(g) {
  if (g.adjacency) return g.adjacency;
  const n = g.index.nodes;
  const { a, b } = g.edges;
  const offset = new Int32Array(n + 1);
  for (let q = 0; q < a.length; q += 1) {
    offset[a[q] + 1] += 1;
    offset[b[q] + 1] += 1;
  }
  for (let i = 0; i < n; i += 1) offset[i + 1] += offset[i];
  const fill = offset.slice(0, n);
  const edge = new Int32Array(2 * a.length);
  for (let q = 0; q < a.length; q += 1) {
    edge[fill[a[q]]++] = q;
    edge[fill[b[q]]++] = q;
  }
  g.adjacency = { offset, edge };
  return g.adjacency;
}

/** For one variant and view, each status class's cost factor and the status of the side a route takes (-1 when
 *  neither side may be used), as MATE's graph.edge_seconds: a barrier is never used, nor in the known view
 *  anything not known; harder costs index.costs.harder times as much, and in the cautious view what is not known
 *  index.costs.unknown_cautious times as much. A street takes its quicker side, the better side on a tie. */
export function classTable(index, j, view) {
  const { harder, unknown_cautious: unknown } = index.costs;
  const n = index.classes.length;
  const mult = new Float64Array(n);
  const status = new Int8Array(n);
  for (let c = 0; c < n; c += 1) {
    const byte = index.classes[c][j];
    let best = Infinity;
    let side = -1;
    for (const shift of [0, 3]) {
      const code = (byte >> shift) & 3;
      const hard = (byte >> (shift + 2)) & 1;
      if (code === 3 || (view === 'known' && code === UNKNOWN)) continue;
      let m = hard ? harder : 1;
      if (view === 'cautious' && code === UNKNOWN) m *= unknown;
      if (m < best) {
        best = m;
        side = code;
      }
    }
    mult[c] = best;
    status[c] = side;
  }
  return { mult, status };
}

function tableFor(g, j, view) {
  const key = `${j}.${view}`;
  if (!g.tables.has(key)) {
    const ix = g.index;
    const v = ix.variants[j];
    const { mult, status } = classTable(ix, j, view);
    const speed = ix.kinds.map((_, t) => (ix.walked[t] ? v.foot_kmh : v.speed_kmh) / 3.6);
    g.tables.set(key, { mult, status, speed, walk: v.foot_kmh / 3.6 });
  }
  return g.tables.get(key);
}

/** Seconds to pass edge q (a place in g.edges), as MATE's Router charges it, or Infinity when it may not be used. */
function edgeSeconds(g, table, q) {
  const e = g.edges;
  const m = table.mult[e.k[q]];
  if (m === Infinity) return Infinity;
  const length = e.l[q] / g.index.per_m;
  const xlen = e.t[q] === g.junction ? g.index.costs.junction_xlen_m : length;
  return (length + (m - 1) * xlen) / table.speed[e.t[q]] + g.index.costs.eps_s;
}

function joinsOf(g, end) {
  if (end.cell != null) return g.cells.get(end.cell) || null;
  if (end.stop != null) return g.stops.get(end.stop) || null;
  return null;
}

/** The quickest route on MATE's graph from one end to the other, each end { cell } (a place in cells.json) or
 *  { stop } (a GTFS stop id), with tile: the resolution 6 cell its joins are in. variant: a key of
 *  index.variants; view: nkb, cautious or known. Only loaded tiles are used: complete is false when a better route
 *  might pass a tile not loaded, and missing names the tiles to fetch before routing again.
 *
 *  Returns seconds and whole minutes (null when not reached within limitS), nodes and coords ([lon, lat]) along
 *  the route, edges (MATE's edge numbers) and the status of the side taken on each, metres by status
 *  ([no known barrier, harder, not known]), unrecorded (metres not known), link (the straight lines from each end
 *  to the network, metres), runs of one status along coords, crossings and steps passed. */
export function route(g, from, to, { variant, view = 'nkb', limitS = Infinity } = {}) {
  const ix = g.index;
  const j = ix.variants.findIndex((v) => v.key === variant);
  const vi = ix.views.indexOf(view);
  if (j < 0 || vi < 0) throw new Error(`No variant ${variant} or view ${view} in MATE's graph`);
  const out = { variant, view, seconds: null, minutes: null, complete: true, missing: [], reason: null };
  const notLoaded = [from, to].filter((end) => end.tile && !g.loaded[g.tileAt.get(end.tile)] && g.tileAt.has(end.tile));
  if (notLoaded.length) return { ...out, complete: false, missing: notLoaded.map((end) => end.tile), reason: 'tile' };
  const bit = 1 << (3 * j + vi);
  const start = joinsOf(g, from);
  const goal = joinsOf(g, to);
  if (!start || !goal) return { ...out, reason: 'no-network' };
  const table = tableFor(g, j, view);
  const eps = ix.costs.eps_s;
  const link = (d) => d / ix.per_m / table.walk + eps;
  const use = (joins) => joins.node.map((node, q) => ({ node, d: joins.dist[q], ok: (joins.mask[q] & bit) !== 0 })).filter((x) => x.ok);
  const starts = use(start);
  const goals = use(goal);
  const same = from.cell != null && from.cell === to.cell;
  if (!starts.length || !goals.length) {
    // Near footpath this profile cannot use: the cell reaches only itself.
    if (same && !starts.length) {
      const empty = { nodes: [], coords: [], edges: [], status: [], runs: [], crossings: crossingCounts(), steps: 0 };
      return { ...out, ...empty, seconds: eps, minutes: 0, metres: [0, 0, 0], unrecorded: 0, link: 0 };
    }
    return { ...out, reason: starts.length ? 'destination' : 'origin' };
  }
  const goalLink = new Map();
  for (const x of goals) {
    const w = link(x.d);
    if (!(goalLink.get(x.node) <= w)) goalLink.set(x.node, w);
  }
  const { offset, edge } = adjacency(g);
  const e = g.edges;
  g.stamp += 1;
  const stamp = g.stamp;
  const { dist, prev, seen } = g;
  const heap = new MinHeap();
  const startLink = new Map();
  for (const x of starts) {
    const w = link(x.d);
    if (seen[x.node] !== stamp || w < dist[x.node]) {
      seen[x.node] = stamp;
      dist[x.node] = w;
      prev[x.node] = -1;
      startLink.set(x.node, x.d);
      heap.push(w, x.node);
    }
  }
  let best = Infinity;
  let bestNode = -1;
  const missing = new Set();
  while (heap.size) {
    const u = heap.pop();
    const du = heap.lastKey;
    if (du > dist[u]) continue;
    if (du >= best || du > limitS) break;
    const gl = goalLink.get(u);
    if (gl != null && du + gl < best) {
      best = du + gl;
      bestNode = u;
    }
    const tile = tileOfNode(g, u);
    if (!g.loaded[tile]) {
      // Only some of this node's edges are known: a better route may pass its tile.
      missing.add(ix.tiles[tile].id);
      continue;
    }
    for (let p = offset[u]; p < offset[u + 1]; p += 1) {
      const q = edge[p];
      const w = edgeSeconds(g, table, q);
      if (w === Infinity) continue;
      const v = e.a[q] === u ? e.b[q] : e.a[q];
      const dv = du + w;
      if (seen[v] !== stamp || dv < dist[v]) {
        seen[v] = stamp;
        dist[v] = dv;
        prev[v] = q;
        heap.push(dv, v);
      }
    }
  }
  out.missing = [...missing];
  out.complete = missing.size === 0;
  if (bestNode < 0 || best > limitS) return { ...out, reason: 'not-reached' };
  // Back from the destination's network node to the origin's.
  const nodes = [bestNode];
  const edges = [];
  for (let u = bestNode; prev[u] >= 0;) {
    const q = prev[u];
    edges.push(q);
    u = e.a[q] === u ? e.b[q] : e.a[q];
    nodes.push(u);
  }
  nodes.reverse();
  edges.reverse();
  const status = edges.map((q) => table.status[e.k[q]]);
  const metres = [0, 0, 0];
  const runs = [];
  const crossings = crossingCounts();
  let steps = 0;
  let inJunction = false;
  edges.forEach((q, s) => {
    const m = e.l[q] / ix.per_m;
    metres[status[s]] += m;
    const last = runs[runs.length - 1];
    if (last && last.status === status[s]) {
      last.metres += m;
      last.to = s + 1;
    } else runs.push({ status: status[s], metres: m, from: s, to: s + 1 });
    const t = e.t[q];
    const unknown = status[s] === UNKNOWN;
    if (t === g.junction) {
      // A route through a junction passes two halves: one crossing.
      if (!inJunction) {
        crossings.junctions += 1;
        if (unknown) crossings.junctionsUnrecorded += 1;
      }
    } else if (t === g.kindCrossing) {
      crossings.mapped += 1;
      if (unknown) crossings.mappedUnrecorded += 1;
    } else if (t === g.kindJoin) {
      crossings.joins += 1;
      if (unknown) crossings.joinsUnrecorded += 1;
    } else if (t === g.kindSteps) steps += 1;
    inJunction = t === g.junction;
  });
  const round = (x) => Math.round(x * 10) / 10;
  return {
    ...out,
    reason: null,
    seconds: best,
    minutes: minutesOf(best),
    nodes,
    coords: nodes.map((u) => [g.lon[u] / ix.deg, g.lat[u] / ix.deg]),
    edges: edges.map((q) => e.id[q]),
    status,
    metres: metres.map(round),
    unrecorded: round(metres[UNKNOWN]),
    link: round((startLink.get(nodes[0]) + goals.filter((x) => x.node === bestNode).reduce((m, x) => Math.min(m, x.d), Infinity)) / ix.per_m),
    runs: runs.map((r) => ({ ...r, metres: round(r.metres) })),
    crossings,
    steps,
  };
}

function crossingCounts() {
  return { mapped: 0, mappedUnrecorded: 0, junctions: 0, junctionsUnrecorded: 0, joins: 0, joinsUnrecorded: 0 };
}

/** MATE's graph tiles whose nodes come within marginM of the box around the points ([lon, lat]). */
export function tilesAround(index, points, marginM = 1000) {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginM / 111320;
  const dLon = marginM / (111320 * Math.cos((mid * Math.PI) / 180));
  const box = [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat];
  return index.tiles.filter((t) => t.bbox && t.bbox[0] <= box[2] && t.bbox[2] >= box[0] && t.bbox[1] <= box[3] && t.bbox[3] >= box[1]).map((t) => t.id);
}

/** MATE's graph/index.json and an empty graph for it, once; null when the place has none. */
export async function graphFor(store) {
  if (!store.graph) {
    store.graph = file(store, 'mate/graph/', 'index').then((index) => (index ? graphStore(index) : null));
  }
  return store.graph;
}

export async function loadGraphTiles(store, ids) {
  const g = await graphFor(store);
  if (!g) return null;
  const want = ids.filter((id) => g.tileAt.has(id) && !g.loaded[g.tileAt.get(id)]);
  const bodies = await Promise.all(want.map((id) => file(store, 'mate/graph/', id)));
  bodies.forEach((body) => body && addGraphTile(g, body));
  return g;
}

/** Routes on MATE's graph between two cells (places in cells.json) for each variant and view, fetching the tiles
 *  around them, and more when a route needs them, up to `rounds` times. A route longer than limitS is not looked
 *  for (seconds null, reason 'not-reached'). Returns { [variant]: { [view]: route } }, or null when the place has
 *  no graph tiles. */
export async function routeCells(store, o, d, { variants = PT_PROFILES, views = RANGE_VIEWS, margin = 1000, rounds = 3, limitS = ROUTE_LIMIT_S } = {}) {
  const g = await graphFor(store);
  if (!g) return null;
  const ends = [o, d].map((cell) => ({ cell, tile: store.geo.parent(store.ids[cell], g.index.tile_res) }));
  const near = tilesAround(g.index, [o, d].map((cell) => store.geo.centre(store.ids[cell])), margin);
  await loadGraphTiles(store, [...new Set([ends[0].tile, ends[1].tile, ...near])]);
  const out = Object.fromEntries(variants.map((v) => [v, {}]));
  for (let round = 0; round < rounds; round += 1) {
    const missing = new Set();
    for (const v of variants) {
      for (const view of views) {
        if (out[v][view]?.complete) continue;
        out[v][view] = route(g, ends[0], ends[1], { variant: v, view, limitS });
        out[v][view].missing.forEach((id) => missing.add(id));
      }
    }
    const fresh = [...missing].filter((id) => !g.loaded[g.tileAt.get(id)]);
    if (!fresh.length) break;
    await loadGraphTiles(store, fresh);
  }
  return out;
}
