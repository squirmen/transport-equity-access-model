// Load the TEAM data files and derive per-cell values for the current view.

import { diagnoseCell } from './diagnose.js';

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
    shares: { no_car: numeric(c.nocar), children: numeric(c.kids), older: numeric(c.older) },
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
  };
  data.quintile = Int8Array.from(data.nzdep, (v) => (Number.isFinite(v) ? Math.floor((v + 1) / 2) : 0));
  data.weights = { everyone: data.pop };
  for (const [group, share] of Object.entries(data.shares)) {
    data.weights[group] = Float32Array.from(data.pop, (p, i) => (Number.isFinite(share[i]) ? (p * share[i]) / 100 : 0));
  }
  return data;
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
    return (data.cost[service] || {})[`z${Math.min(zones, 4)}`] || null;
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
      v = zones <= 0 ? NaN : data.cost[service]?.[`z${Math.min(zones, 4)}`]?.[i];
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
  const window = data.meta.services[service]?.window;
  // Under a budget the diagnosis has to see the trip the traveller can
  // actually pay for, or a place priced off the bus would be reported as a
  // place the bus is too slow to reach.
  const pt = zones == null
    ? t.pt?.[i]
    : (zones <= 0 ? undefined : data.cost[service]?.[`z${Math.min(zones, 4)}`]?.[i]);
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
