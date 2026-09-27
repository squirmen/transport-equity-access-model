// Load the TEAM data files and derive per-cell values for the current view.

import { diagnoseCell } from './diagnose.js';
import { setPlace } from './format.js';

// The network overlays are not needed for the first view, so they load separately.
const FILES = ['cells', 'summary', 'places', 'destinations'];
const numeric = (values) => Float32Array.from(values || [], (v) => (v == null ? NaN : v));

async function fetchJson(base, name) {
  const response = await fetch(`${base}${name}.json`);
  if (!response.ok) throw new Error(`Could not load ${name}.json (${response.status})`);
  return response.json();
}

export async function load(base) {
  const [cells, summary, places, destinations] = await Promise.all(FILES.map((name) => fetchJson(base, name)));
  return prepare({ cells, summary, places, destinations });
}

export function loadOverlays(base) {
  return fetchJson(base, 'overlays');
}

function mapValues(object, fn) {
  return Object.fromEntries(Object.entries(object || {}).map(([k, v]) => [k, fn(v)]));
}

function prepare(raw) {
  setPlace(raw.summary.meta.naming);
  const c = raw.cells;
  const n = c.h3.length;
  const data = {
    meta: raw.summary.meta,
    summary: raw.summary,
    places: raw.places,
    destinations: raw.destinations,
    n,
    h3: c.h3,
    place: c.place,
    pop: numeric(c.pop),
    nzdep: numeric(c.nzdep),
    drive: numeric(c.drive),
    shares: {
      no_car: numeric(c.nocar),
      children: numeric(c.kids),
      older: numeric(c.older),
      ...Object.fromEntries(Object.entries(c.groups || {}).map(([k, v]) => [k, numeric(v)])),
    },
    freq: mapValues(c.freq, numeric),
    mStop: numeric(c.m_stop),
    mRail: numeric(c.m_rail),
    mBike: numeric(c.m_bike),
    t: mapValues(c.t, (modes) => mapValues(modes, numeric)),
    km: mapValues(c.km, numeric),
    nearest: c.nearest,
    jobs: mapValues(c.jobs, (byLimit) => mapValues(byLimit, numeric)),
    fair: mapValues(c.fair, (byLimit) => mapValues(byLimit, numeric)),
    access: mapValues(c.access, (byKey) => mapValues(byKey, numeric)),
    cost: mapValues(c.cost, (byZone) => mapValues(byZone, numeric)),
    zone: c.zone || null,
    // Public transport in the windows after each one's usual window. The
    // usual window is what `t`, `jobs`, `cost` and `access` start out holding.
    windowed: {
      t: mapValues(c.tw, (byWindow) => mapValues(byWindow, numeric)),
      jobs: mapValues(c.jobsw, (byLimit) => mapValues(byLimit, numeric)),
      fair: mapValues(c.fairw, (byLimit) => mapValues(byLimit, numeric)),
      access: mapValues(c.accessw, (byKey) => mapValues(byKey, numeric)),
      cost: mapValues(c.costw, (byWindow) => mapValues(byWindow, (byZone) => mapValues(byZone, numeric))),
    },
    activeWindow: {},
  };
  data.usual = {
    t: mapValues(data.t, (byMode) => byMode.pt),
    jobs: data.jobs.pt,
    fair: data.fair.pt,
    access: data.access.pt,
    cost: { ...data.cost },
  };
  setWindow(data, null);
  data.quintile = Int8Array.from(data.nzdep, (v) => (Number.isFinite(v) ? Math.floor((v + 1) / 2) : 0));
  data.weights = { everyone: data.pop };
  for (const [group, share] of Object.entries(data.shares)) {
    data.weights[group] = Float32Array.from(data.pop, (p, i) => (Number.isFinite(share[i]) ? (p * share[i]) / 100 : 0));
  }
  return data;
}

/** Stands in for a window when each part of a score keeps its own usual time. */
export const USUAL = 'usual';

/** The public transport windows something was timed in, usual one first.
 *
 *  `thing` is a service, 'jobs', or 'score:<key>' for an access score. Old
 *  data files name one window per service and nothing else, which reads as a
 *  single window here.
 */
export function windowsFor(data, thing) {
  const meta = data.meta;
  if (thing === 'jobs') {
    const usual = meta.jobs?.window;
    return meta.jobs?.windows || (usual ? [usual] : []);
  }
  if (typeof thing === 'string' && thing.startsWith('score:')) {
    // The build says which windows each score exists in. A usual window of
    // null means its parts are each timed at their own usual time.
    const key = thing.slice(6);
    const listed = meta.access?.windows?.[key];
    if (listed) return listed.map((w) => w ?? USUAL);
    return [meta.jobs?.window].filter(Boolean);
  }
  const spec = meta.services?.[thing];
  if (!spec) return [];
  return spec.windows || (spec.window ? [spec.window] : []);
}

/** The window `thing` is shown in: the one asked for if it was timed then,
 *  otherwise its usual one. A school run has no Saturday, so asking for
 *  Saturday leaves schools on the weekday morning. */
export function windowOf(data, thing, wanted) {
  const windows = windowsFor(data, thing);
  return windows.includes(wanted) ? wanted : windows[0] || null;
}

/** Point every public transport layer at the window asked for.
 *
 *  Everything else reads `data.t`, `data.jobs`, `data.cost` and `data.access`
 *  as before, so the map, the panels, the place card and the diagnosis all
 *  follow the window without each needing to know about it.
 */
export function setWindow(data, wanted) {
  const w = data.windowed;
  for (const service of Object.keys(data.t)) {
    const window = windowOf(data, service, wanted);
    data.activeWindow[service] = window;
    const usual = windowsFor(data, service)[0];
    const pt = window === usual ? data.usual.t[service] : w.t[service]?.[window];
    if (pt) data.t[service].pt = pt;
    else if (data.usual.t[service]) data.t[service].pt = data.usual.t[service];
    if (data.usual.cost[service]) {
      data.cost[service] = window === usual ? data.usual.cost[service] : (w.cost[service]?.[window] || data.usual.cost[service]);
    }
  }
  const jobsWindow = windowOf(data, 'jobs', wanted);
  const jobsUsual = windowsFor(data, 'jobs')[0];
  data.activeWindow.jobs = jobsWindow;
  if (data.usual.jobs) data.jobs.pt = jobsWindow === jobsUsual ? data.usual.jobs : (w.jobs[jobsWindow] || data.usual.jobs);
  if (data.usual.fair) data.fair.pt = jobsWindow === jobsUsual ? data.usual.fair : (w.fair[jobsWindow] || data.usual.fair);
  if (data.usual.cost.jobs) {
    data.cost.jobs = jobsWindow === jobsUsual ? data.usual.cost.jobs : (w.cost.jobs?.[jobsWindow] || data.usual.cost.jobs);
  }
  if (data.usual.access) {
    const scores = {};
    for (const key of Object.keys(data.usual.access)) {
      const window = windowOf(data, `score:${key}`, wanted);
      data.activeWindow[`score:${key}`] = window;
      scores[key] = w.access[window]?.[key] || data.usual.access[key];
    }
    data.access.pt = scores;
  }
}

/** When a trip in this window happens, for pricing it: the hour it starts and
 *  whether it is a weekday. */
export function tripTime(data, window) {
  const spec = (data.meta.windows || {})[window];
  if (!spec) return { hour: null, weekday: true };
  const hour = Number(String(spec.start).split(':')[0]);
  const day = spec.date ? new Date(`${spec.date}T12:00:00`).getDay() : 2;
  return { hour, weekday: day >= 1 && day <= 5 };
}

/** The priced public transport layer for a traveller who can afford `zones`.
 *
 *  Networks differ in how many zone steps they have: Auckland four,
 *  Wellington fourteen, a flat fare one. A budget beyond the last step buys
 *  the whole network, which is the last layer.
 */
export function costLayer(data, service, zones) {
  const layers = data.cost[service];
  if (!layers || !(zones > 0)) return null;
  let steps = 0;
  while (layers[`z${steps + 1}`]) steps += 1;
  return steps ? layers[`z${Math.min(Math.floor(zones), steps)}`] : null;
}

/** Minutes to the nearest `service` by `mode`; `best` is the fastest counting mode.
 *
 *  With `zones` set, a public transport trip only counts when it stays inside
 *  that many fare zones, which is what the traveller can afford. Walking and
 *  cycling cost nothing, so a budget never changes them.
 */
export function times(data, service, mode, zones = null) {
  const byMode = data.t[service] || {};
  const forMode = (m) => {
    if (m !== 'pt' || zones == null) return byMode[m];
    if (zones <= 0) return null;
    return costLayer(data, service, zones);
  };
  if (mode !== 'best') return forMode(mode) || new Float32Array(data.n).fill(NaN);
  const out = new Float32Array(data.n).fill(NaN);
  for (const m of data.meta.standard_modes) {
    const t = forMode(m);
    if (!t) continue;
    for (let i = 0; i < data.n; i += 1) {
      const v = t[i];
      if (Number.isFinite(v) && !(v >= out[i])) out[i] = v;
    }
  }
  return out;
}

export function bestMode(data, service, i, zones = null) {
  let chosen = null;
  let fastest = Infinity;
  for (const m of data.meta.standard_modes) {
    let v;
    if (m === 'pt' && zones != null) {
      v = zones <= 0 ? NaN : costLayer(data, service, zones)?.[i];
    } else {
      v = data.t[service]?.[m]?.[i];
    }
    if (Number.isFinite(v) && v < fastest) {
      fastest = v;
      chosen = m;
    }
  }
  return chosen;
}

export function cellInputs(data, service, i, best, zones = null) {
  const t = data.t[service] || {};
  const window = data.activeWindow?.[service] || data.meta.services[service]?.window;
  // Under a budget the diagnosis has to see the trip the traveller can
  // actually pay for, or a place priced off the bus would be reported as a
  // place the bus is too slow to reach.
  const pt = zones == null
    ? t.pt?.[i]
    : (zones <= 0 ? undefined : costLayer(data, service, zones)?.[i]);
  return {
    km: data.km[service]?.[i],
    walk: t.walk?.[i],
    bikeLow: t.bike_low_stress?.[i],
    bike: t.bike?.[i],
    pt,
    car: t.car?.[i],
    best,
    freq: data.freq[window]?.[i],
  };
}

export function reasons(data, service, limit, best, zones = null) {
  const out = new Int8Array(data.n);
  for (let i = 0; i < data.n; i += 1) out[i] = diagnoseCell(cellInputs(data, service, i, best[i], zones), limit);
  return out;
}

export function meetsFlags(best, limit) {
  return Uint8Array.from(best, (v) => (Number.isFinite(v) && v <= limit ? 1 : 0));
}

export function weightedShare(flags, weights, mask) {
  let hit = 0;
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (mask && !mask[i]) continue;
    const w = weights[i];
    if (!(w > 0)) continue;
    total += w;
    if (flags[i]) hit += w;
  }
  return total > 0 ? hit / total : NaN;
}

export function peopleBelow(flags, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) if (!flags[i] && weights[i] > 0) total += weights[i];
  return total;
}

export function byQuintile(data, flags, weights) {
  return [1, 2, 3, 4, 5].map((q) => {
    const mask = Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0));
    return { quintile: q, share: weightedShare(flags, weights, mask) };
  });
}

export function peopleByReason(reason, weights) {
  const totals = {};
  for (let i = 0; i < reason.length; i += 1) {
    const code = reason[i];
    if (code === 0 || code === 9 || !(weights[i] > 0)) continue;
    totals[code] = (totals[code] || 0) + weights[i];
  }
  return totals;
}

/** Places with the most people below the standard, and the most common reason there. */
export function rankPlaces(data, flags, reason, weights, top = 10) {
  const rows = new Map();
  for (let i = 0; i < data.n; i += 1) {
    const p = data.place[i];
    if (p == null || flags[i] || !(weights[i] > 0)) continue;
    const row = rows.get(p) || { place: p, below: 0, reasons: {} };
    row.below += weights[i];
    row.reasons[reason[i]] = (row.reasons[reason[i]] || 0) + weights[i];
    rows.set(p, row);
  }
  return [...rows.values()]
    .map((row) => {
      const [main] = Object.entries(row.reasons).sort((a, b) => b[1] - a[1]);
      return { ...row, main: main ? Number(main[0]) : null };
    })
    .sort((a, b) => b.below - a.below)
    .slice(0, top);
}

export function weightedMedian(values, weights, mask) {
  const idx = [];
  for (let i = 0; i < values.length; i += 1) {
    if (mask && !mask[i]) continue;
    if (Number.isFinite(values[i]) && weights[i] > 0) idx.push(i);
  }
  if (!idx.length) return NaN;
  idx.sort((a, b) => values[a] - values[b]);
  const total = idx.reduce((sum, i) => sum + weights[i], 0);
  let running = 0;
  for (const i of idx) {
    running += weights[i];
    if (running >= total / 2) return values[i];
  }
  return values[idx[idx.length - 1]];
}


/** Population-weighted deciles of a score: 1 is the tenth of residents with the
 *  least access, 10 the tenth with the most. Worked out in the browser so a
 *  decile always describes what is on screen. */
export function decileBands(values, weights) {
  const order = [];
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i]) && weights[i] > 0) order.push(i);
  order.sort((a, b) => values[a] - values[b]);
  const total = order.reduce((sum, i) => sum + weights[i], 0);
  const bands = new Int8Array(values.length).fill(-1);
  let running = 0;
  for (const i of order) {
    running += weights[i];
    bands[i] = Math.min(9, Math.floor((running / total) * 10 - 1e-9));
  }
  return bands;
}
