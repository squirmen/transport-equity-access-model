// A trip from one hexagon to another, in the card: the Trip tab, the map's
// reach while a destination is picked, and the lines the map draws for a trip.
//
// Behind ?mate=1 and in Auckland only, as mate.js. app.js loads this module
// when a trip is planned and keeps the state; trip_data.js fetches the
// figures. The pure parts come first and are tested (tests/web/trip.test.mjs).

import { fold } from './fold.js';
import { el, metres } from './format.js';
import { PROFILES, profileOf, variantOf } from './mate.js';
import { REACH } from './palette.js';
import { PT_PROFILES, WINDOWS } from './trip_data.js';

// Every variant MATE's graph routes: the profiles, and the two after dark.
export const FOOT_VARIANTS = PROFILES.flatMap((p) => [p.key, p.night].filter(Boolean));

// Walking routes on MATE's map are worked out for trips up to this far in a
// straight line; further, nobody walks it within the 45 minutes looked for.
export const SHORT_KM = 3;
// How far a route on MATE's map is looked for, in minutes (trip_data.js ROUTE_LIMIT_S).
export const FOOT_LIMIT = 45;
export const REACH_BREAKS = [10, 20, 30, 45];
export { REACH };

const MODE_NAMES = { walk: 'Walking', bike_low_stress: 'Cycling, low stress', bike: 'Cycling, any street', pt: 'Public transport' };
// How a time was made, after the minutes: "12 min walking".
const HOW = { walk: 'walking', bike_low_stress: 'by low-stress cycling', bike: 'cycling on any street', pt: 'by public transport' };
const WINDOW_SHORT = { am_peak: 'Peak', interpeak: 'Off-peak', saturday: 'Sat' };
const LIMITS = { walk: 20, bike_low_stress: 20, bike: 20, pt: 45 };
const CAUTIOUS = 'The second figure: if unrecorded parts take three times as long.';

// ---------------------------------------------------------------- pure parts

/** Kilometres between two [lon, lat] points, on the sphere. */
export function kmBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

/** "7.9 km" or "850 m", for a trip's header. */
export function distanceText(km) {
  return km < 1 ? `${Math.round(km * 20) * 50} m` : `${km.toFixed(1)} km`;
}

/** The way of travelling a reach is worked out for: the mode on screen when TEAM times trips by it, else the
 *  fastest of walking, low-stress cycling and public transport ('best'). */
export function tripMode(viewMode) {
  return ['walk', 'bike_low_stress', 'bike', 'pt'].includes(viewMode) ? viewMode : 'best';
}

/** The window a trip is shown in: When, if it is one TEAM times trips in, else off-peak. */
export function tripWindowOf(when) {
  return WINDOWS.includes(when) ? when : 'interpeak';
}

/** Every cell the origin gets to, with its minutes and the mode that does it: a Map d -> { minutes, mode }.
 *  `times` is trip_data.js originTimes; on a tie walking wins, then cycling, then public transport. */
export function reachOf(times, mode, window) {
  const out = new Map();
  if (!times) return out;
  const modes = mode === 'best' ? ['walk', 'bike_low_stress', 'pt'] : [mode];
  for (const m of modes) {
    const got = m === 'pt' ? times.pt?.[window] : times[m];
    if (!got) continue;
    for (const [d, minutes] of got) {
      const now = out.get(d);
      if (!now || minutes < now.minutes) out.set(d, { minutes, mode: m });
    }
  }
  return out;
}

/** The longest a reach goes, in minutes: public transport's limit for 'best' and 'pt', else the mode's. */
export function reachLimit(mode, limits = LIMITS) {
  return mode === 'best' || mode === 'pt' ? limits.pt : limits[mode];
}

/** Map classes for a reach: 0 to 3 for 10, 20, 30 and 45 minutes, -1 beyond. */
export function reachClasses(reach, n) {
  const classes = new Int8Array(n).fill(-1);
  for (const [d, { minutes }] of reach) {
    const k = REACH_BREAKS.findIndex((b) => minutes <= b);
    if (k >= 0 && d >= 0 && d < n) classes[d] = k;
  }
  return classes;
}

/** "19 min by public transport", or "over 45 min without a car". */
export function reachText(entry, mode, limits = LIMITS) {
  if (entry) return `${entry.minutes} min ${HOW[entry.mode]}`;
  return `over ${reachLimit(mode, limits)} min ${mode === 'best' ? 'without a car' : HOW[mode]}`;
}

/** The key while a destination is picked. */
export function reachKey(mode, windowLabel, limits = LIMITS) {
  const limit = reachLimit(mode, limits);
  const rows = [['10 min or less', 0, '10'], ['11 to 20 min', 1, '20'], ['21 to 30 min', 2, '30'], ['31 to 45 min', 3, '45 min']]
    .filter(([, k]) => REACH_BREAKS[k] <= limit);
  const how = mode === 'best'
    ? `The fastest of walking, low-stress cycling and public transport (${windowLabel.toLowerCase()})`
    : mode === 'pt' ? `Public transport (${windowLabel.toLowerCase()})` : MODE_NAMES[mode];
  return { rows, note: `${how} from the hexagon picked. Clear: over ${limit} minutes.` };
}

/** "12 min", or "over 20 min" beyond the limit TEAM keeps. */
export function minutesText(m, limit) {
  return m == null ? `over ${limit} min` : `${m} min`;
}

/** The Trip tab's first rows: walking and the two levels of cycling. */
export function modeRows(times) {
  const limits = times?.limits || LIMITS;
  return ['walk', 'bike_low_stress', 'bike'].map((m) => ({
    key: m,
    label: MODE_NAMES[m],
    text: minutesText(times?.[m] ?? null, limits[m]),
    comparison: m === 'bike',
  }));
}

/** Public transport in each window, the one shown first in bold: [{ window, label, text, on }]. */
export function ptCells(times, window) {
  const limit = times?.limits?.pt || LIMITS.pt;
  return WINDOWS.map((w) => {
    const m = times?.pt?.[w] ?? null;
    return { window: w, label: WINDOW_SHORT[w], text: m == null ? `over ${limit}` : String(m), on: w === window };
  });
}

/** The fastest way that counts, for the live region: "Trip: 22 minutes by public transport, off-peak." */
export function tripSentence(times, window, windowLabel) {
  if (!times) return 'Trip: no times for this pair.';
  const options = [['walk', times.walk], ['bike_low_stress', times.bike_low_stress], ['pt', times.pt?.[window]]]
    .filter(([, m]) => m != null);
  if (!options.length) return 'Trip: over 45 minutes without a car.';
  const [mode, m] = options.reduce((a, b) => (b[1] < a[1] ? b : a));
  return `Trip: ${m} ${m === 1 ? 'minute' : 'minutes'} ${HOW[mode]}${mode === 'pt' ? `, ${windowLabel.toLowerCase()}` : ''}.`;
}

/** A stop as the card names it: "Stop A Takapuna (3551)". */
export function stopLabel(stop) {
  if (!stop || !stop.name) return 'a stop';
  return stop.code ? `${stop.name} (${stop.code})` : stop.name;
}

const whole = (x) => Math.round(x);

/** The walker's public transport trip as a bar and three steps (trip_data.js ptTrip, a ride). */
export function tripSteps(trip) {
  if (!trip || trip.kind !== 'ride') return null;
  const parts = [
    { kind: 'walk', minutes: trip.access, label: String(whole(trip.access)) },
    { kind: 'wait', minutes: trip.wait, label: `wait ${whole(trip.wait)}` },
    { kind: 'ride', minutes: trip.ride, label: `ride ${whole(trip.ride)}` },
    { kind: 'change', minutes: trip.transfer, label: String(whole(trip.transfer)) },
    { kind: 'walk', minutes: trip.egress, label: String(whole(trip.egress)) },
  ].filter((p) => p.minutes > 0);
  const sum = parts.reduce((s, p) => s + p.minutes, 0) || 1;
  for (const p of parts) p.share = p.minutes / sum;
  let change = '';
  if (trip.rides > 1) {
    change = trip.transfer >= 0.5 ? `, with ${whole(trip.transfer)} min walking between stops` : ', changing at the same stop';
  }
  const names = trip.routes.map((r) => r.name);
  return {
    total: whole(trip.total),
    parts,
    steps: [
      { minutes: whole(trip.access), text: `Walk to ${stopLabel(trip.board)}` },
      { minutes: whole(trip.between), routes: names, text: `${change}: ${whole(trip.wait)} min waiting, ${whole(trip.ride)} on board` },
      { minutes: whole(trip.egress), text: `Walk from ${stopLabel(trip.alight)}` },
    ],
    aria: `Walk ${whole(trip.access)} min, wait ${whole(trip.wait)} min, ride ${whole(trip.ride)} min`
      + `${trip.transfer >= 0.5 ? `, walk between stops ${whole(trip.transfer)} min` : ''}, walk ${whole(trip.egress)} min`,
  };
}

/** A range of minutes, no known barrier first: "3", "3, or 4", "11, or none", or "none". */
export function span(nkb, cautious) {
  if (nkb == null) return 'none';
  if (cautious == null) return `${nkb}, or none`;
  return cautious === nkb ? String(nkb) : `${nkb}, or ${cautious}`;
}

const roundOrNull = (x) => (x == null ? null : Math.round(x));

/** First and last mile for each public transport profile (trip_data.js legSwap): to the boarding stop, from the
 *  alighting stop, and the whole trip, each as a range. */
export function mileRows(swap, chosen) {
  if (!swap?.profiles) return [];
  return swap.profiles.map((row) => ({
    key: row.key,
    short: profileOf(row.key).short,
    chosen: row.key === chosen,
    to: span(row.nkb.toStop, row.cautious.toStop),
    from: span(row.nkb.fromStop, row.cautious.fromStop),
    trip: span(roundOrNull(row.nkb.total), roundOrNull(row.cautious.total)),
  }));
}

/** The fold's summary: the chosen profile's whole trip. */
export function mileSummary(swap, chosen) {
  if (!PT_PROFILES.includes(chosen)) return `${profileOf(chosen).tag}: not worked out`;
  const row = mileRows(swap, chosen).find((r) => r.chosen);
  return row ? `${profileOf(chosen).tag} ${row.trip}` : null;
}

/** A route's minutes on MATE's map as a range: "12", "12, or 15", "12, or over 45", "over 45", or "–" when no
 *  path the profile can use comes near one end. */
export function footSpan(nkb, cautious, limit = FOOT_LIMIT) {
  const reached = (r) => r && r.minutes != null;
  if (!reached(nkb)) return nkb && ['origin', 'destination'].includes(nkb.reason) ? '–' : `over ${limit}`;
  if (!reached(cautious)) return `${nkb.minutes}, or over ${limit}`;
  return cautious.minutes === nkb.minutes ? String(nkb.minutes) : `${nkb.minutes}, or ${cautious.minutes}`;
}

/** Each profile on foot from one end to the other (trip_data.js routeCells, every variant), after dark where
 *  that applies. */
export function footRows(routes, { dark = false, chosen = null } = {}) {
  return PROFILES.map((p) => {
    const variant = variantOf(p.key, dark);
    const r = routes?.[variant] || {};
    return { key: p.key, variant, short: p.short, night: variant !== p.key, chosen: p.key === chosen, text: footSpan(r.nkb, r.cautious) };
  });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The route on foot the map draws: the profile's (after dark where that applies), in the view MATE's map
 *  switch is on (no known barrier unless cautious). */
export function routeFor(routes, profile, dark = false, view = 'nkb') {
  const r = routes?.[variantOf(profile, dark)];
  return r ? r[view === 'cautious' ? 'cautious' : 'nkb'] || null : null;
}

/** What a route passes, for the profile it was worked out for: lines of text. */
export function routeWay(route) {
  if (!route || route.minutes == null) return [];
  const [ok, harder, unknown] = route.metres;
  const parts = [`${metres(ok)} no known barrier`];
  if (harder >= 5) parts.push(`${metres(harder)} harder`);
  if (unknown >= 5) parts.push(`${metres(unknown)} not known`);
  const lines = [`${metres(ok + harder + unknown)} on paths and streets: ${parts.join(', ')}.`];
  const c = route.crossings;
  const crossing = [];
  if (c.mapped) crossing.push(`${plural(c.mapped, 'mapped crossing', 'mapped crossings')}${c.mappedUnrecorded ? ` (${c.mappedUnrecorded} with kerbs not recorded)` : ''}`);
  if (c.junctions) crossing.push(`${plural(c.junctions, 'street junction', 'street junctions')} with no crossing mapped`);
  if (c.joins) crossing.push(`${plural(c.joins, 'gap', 'gaps')} between footpaths, joined`);
  lines.push(crossing.length ? `Crosses at ${crossing.join(', ')}.` : 'No street crossings.');
  if (route.steps) lines.push(`${plural(route.steps, 'flight', 'flights')} of steps.`);
  if (unknown >= 5) lines.push(`This route depends on ${metres(unknown)} nobody has recorded.`);
  return lines;
}

/** The route's runs of one status as map features, with the straight lines from each hexagon's centre to the
 *  network (which count as passable). */
export function routeFeatures(route, start = null, end = null) {
  if (!route || route.minutes == null || !route.coords) return [];
  const line = (status, coordinates) => ({ type: 'Feature', properties: { kind: 'route', status }, geometry: { type: 'LineString', coordinates } });
  const out = [];
  if (route.coords.length) {
    if (start) out.push(line(0, [start, route.coords[0]]));
    for (const run of route.runs) out.push(line(run.status, route.coords.slice(run.from, run.to + 1)));
    if (end) out.push(line(0, [route.coords[route.coords.length - 1], end]));
  } else if (start && end) {
    out.push(line(0, [start, end]));
  }
  return out.filter((f) => f.geometry.coordinates.length >= 2);
}

/** Metres between two [lon, lat] points near each other. */
function near(a, b) {
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111320;
  const y = (b[1] - a[1]) * 111320;
  return Math.hypot(x, y);
}

/** The part of a line between the points nearest a and b, from a to b; null when either is further than maxM. */
export function sliceLine(coords, a, b, maxM = 150) {
  const nearest = (p) => coords.reduce((best, c, k) => {
    const m = near(p, c);
    return m < best.m ? { k, m } : best;
  }, { k: -1, m: Infinity });
  const na = nearest(a);
  const nb = nearest(b);
  if (na.m > maxM || nb.m > maxM || na.k === nb.k) return null;
  const part = na.k < nb.k ? coords.slice(na.k, nb.k + 1) : coords.slice(nb.k, na.k + 1).reverse();
  return { coords: [a, ...part, b], off: na.m + nb.m };
}

/** The ride along the line the map draws for its route (rail, busway, ferry, frequent bus), for a trip of one
 *  ride; null otherwise, and the card draws it straight between the stops. transit: transit.json. */
export function rideShape(transit, trip) {
  if (!transit || !trip || trip.kind !== 'ride' || trip.rides !== 1) return null;
  const a = [trip.board.lon, trip.board.lat];
  const b = [trip.alight.lon, trip.alight.lat];
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;
  const lines = new Set((transit.lines || []).filter((l) => l.routes.includes(trip.routes[0].id)).map((l) => l.id));
  if (!lines.size) return null;
  let best = null;
  for (const f of transit.drawn?.features || []) {
    if (!(f.properties.lines || []).some((id) => lines.has(id)) || f.geometry.type !== 'LineString') continue;
    const got = sliceLine(f.geometry.coordinates, a, b);
    if (got && (!best || got.off < best.off)) best = got;
  }
  return best ? best.coords : null;
}

/** What the map draws for a trip: lines (walks dashed, the ride, the route on foot by status), the two stops
 *  and a label with the route names. show: { pt, foot }. */
export function tripDrawing({ start, end, trip = null, shape = null, route = null, show = { pt: true, foot: false } }) {
  const lines = [];
  const stops = [];
  let label = null;
  if (show.pt && trip?.kind === 'ride' && Number.isFinite(trip.board?.lon) && Number.isFinite(trip.alight?.lon)) {
    const a = [trip.board.lon, trip.board.lat];
    const b = [trip.alight.lon, trip.alight.lat];
    const ride = shape || [a, b];
    const feature = (kind, coordinates) => ({ type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates } });
    lines.push(feature('walk', [start, a]), feature('ride', ride), feature('walk', [b, end]));
    stops.push({ lon: a[0], lat: a[1], label: 'A', name: stopLabel(trip.board) }, { lon: b[0], lat: b[1], label: 'B', name: stopLabel(trip.alight) });
    const mid = ride[Math.floor(ride.length / 2)];
    const at = ride.length === 2 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : mid;
    label = { lon: at[0], lat: at[1], text: trip.routes.map((r) => r.name).join(' · ') };
  }
  if (show.foot && route) lines.push(...routeFeatures(route, start, end));
  return { lines, stops, label };
}

// ---------------------------------------------------------------- the Trip tab

function note(text) {
  return el('p', 'note', text);
}

function preview() {
  return el('span', 'badge is-preview', 'MATE preview');
}

function table(className, headers, rows, caption) {
  const t = el('table', `mate-table ${className}`);
  if (caption) t.append(el('caption', 'visually-hidden', caption));
  if (headers) {
    const thead = el('thead');
    const tr = el('tr');
    headers.forEach((h, k) => {
      const th = el('th', k ? 'num' : null, h);
      th.scope = 'col';
      tr.append(th);
    });
    thead.append(tr);
    t.append(thead);
  }
  const body = el('tbody');
  body.append(...rows);
  t.append(body);
  return t;
}

function toggle(id, text, on, pick) {
  const button = el('button', 'btn is-quiet trip-toggle', text);
  button.type = 'button';
  button.id = id;
  button.setAttribute('aria-pressed', String(on));
  button.addEventListener('click', () => pick(!on));
  return button;
}

function windowLabel(windows, w) {
  return windows?.[w]?.label || WINDOW_SHORT[w] || w;
}

/** "off-peak", "peak", "Saturday": a window's label inside a sentence. */
function windowWord(windows, w) {
  const label = windowLabel(windows, w);
  return /^[A-Z][a-z]+day$/.test(label) ? label : label.toLowerCase();
}

/** The modes table: walking, cycling, and public transport in each window (the window shown in bold, each a
 *  button that changes When). */
function modesTable(ctx) {
  const rows = modeRows(ctx.times).map((m) => {
    const tr = el('tr');
    const th = el('th', null, m.label);
    th.scope = 'row';
    if (m.comparison) th.append(' ', el('span', 'badge is-reference-badge', 'comparison'));
    tr.append(th, el('td', 'num', m.text));
    return tr;
  });
  const pt = el('tr');
  const th = el('th', null, 'Public transport');
  th.scope = 'row';
  const cell = el('td', 'num');
  if (ctx.times && !ctx.times.ptFrom) {
    cell.textContent = 'not timed';
  } else {
    const group = el('span', 'trip-windows');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Public transport by time of day, minutes');
    group.dataset.group = 'trip-windows';
    for (const c of ptCells(ctx.times, ctx.window)) {
      const button = el('button', 'trip-window', `${c.label} ${c.text}`);
      button.type = 'button';
      button.dataset.value = c.window;
      button.setAttribute('aria-pressed', String(c.on));
      button.title = `${windowLabel(ctx.windows, c.window)}, ${ctx.windows?.[c.window]?.when || ''}`.replace(/, $/, '');
      button.addEventListener('click', () => ctx.onWindow(c.window));
      group.append(button);
    }
    cell.append(group);
  }
  pt.append(th, cell);
  rows.push(pt);
  return table('trip-modes', null, rows, 'Minutes by each way of travelling');
}

function stepsBlock(steps, ctx) {
  const box = el('div', 'trip-ride');
  box.append(el('p', 'sec-title', `A typical ${windowWord(ctx.windows, ctx.window)} trip, ${steps.total} min`));
  const bar = el('div', 'legs');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', steps.aria);
  for (const p of steps.parts) {
    const part = el('span', `leg is-${p.kind}`, p.share > 0.09 ? p.label : '');
    part.style.flexGrow = String(p.share);
    bar.append(part);
  }
  box.append(bar);
  const list = el('ol', 'steps');
  for (const s of steps.steps) {
    const item = el('li');
    const text = el('span', 'step-text');
    if (s.routes) {
      s.routes.forEach((name, k) => {
        if (k) text.append(' then ');
        text.append(el('span', 'route-no', name));
      });
      text.append(s.text);
    } else {
      text.textContent = s.text;
    }
    item.append(el('span', 'step-m', String(s.minutes)), text);
    list.append(item);
  }
  box.append(list);
  return box;
}

/** The public transport part: the walker's trip in the window shown, or why there is none. */
function ptBlock(ctx) {
  const out = [];
  const times = ctx.times;
  if (times && !times.ptFrom) {
    out.push(note('Public transport trips are timed from urban areas only.'));
    return out;
  }
  const swap = ctx.swap;
  if (swap === undefined) {
    out.push(note('Loading the public transport trip…'));
    return out;
  }
  const phrase = ctx.windows?.[ctx.window]?.phrase || windowWord(ctx.windows, ctx.window);
  if (!swap || swap.state === 'no-trip') {
    out.push(note(`No public transport trip within 45 minutes ${phrase}.`));
    return out;
  }
  const trip = swap.trip;
  if (trip.kind === 'walk') {
    out.push(el('p', 'sec-title', `Walked all the way: ${trip.minutes} min`));
    return out;
  }
  if (trip.kind === 'no-path') {
    out.push(note('No path was recorded for this trip.'));
    return out;
  }
  const steps = tripSteps(trip);
  out.push(stepsBlock(steps, ctx));
  const when = ctx.windows?.[ctx.window]?.when;
  out.push(note(`The path used in ${trip.use}% of departures${when ? `, ${when}` : ''}. The median over the window is ${trip.minutes} min. Stop and vehicle access: no information.`));
  out.push(toggle('trip-show-pt', 'Stops and ride on the map', ctx.show.pt, (on) => ctx.onShow('pt', on)));
  return out;
}

function profileButton(text, key, ctx) {
  const pick = el('button', 'mate-pick', text);
  pick.type = 'button';
  pick.dataset.value = key;
  pick.addEventListener('click', () => ctx.onProfile(key));
  return pick;
}

/** First and last mile for each profile: the leg swap, an estimate. */
function mileFold(ctx) {
  const swap = ctx.swap;
  if (!swap || swap.state === 'no-trip' || !swap.trip || swap.trip.kind !== 'ride') return null;
  const key = `${ctx.key}-mile`;
  const title = [document.createTextNode('First and last mile, by profile '), preview()];
  const trip = swap.trip;
  const body = [];
  if (swap.state === 'no-mate') {
    const missing = [!swap.mate.from ? ctx.names.o : null, !swap.mate.to ? ctx.names.d : null].filter(Boolean);
    body.push(note(`MATE has no footpath data at ${missing.join(' or ')} yet.`));
    return fold(key, title, null, body);
  }
  body.push(el('p', 'mate-line', `First stop: ${stopLabel(trip.board)}. Last stop: ${stopLabel(trip.alight)}.`));
  const rows = mileRows(swap, ctx.profile).map((r) => {
    const tr = el('tr', r.chosen ? 'is-chosen' : null);
    const name = el('th', 'mate-name');
    name.scope = 'row';
    name.append(profileButton(r.short, r.key, ctx));
    // A range breaks after its comma, never inside "or none".
    const cell = (text) => el('td', 'num', text.replace(/ or /g, ' or\u00a0'));
    tr.append(name, cell(r.to), cell(r.from), cell(r.trip));
    return tr;
  });
  const mileTable = table('trip-mile', [`${windowLabel(ctx.windows, ctx.window)}, minutes`, 'To stop', 'From stop', 'Trip'], rows,
    'Each profile\'s walk to the first stop and from the last, and the whole trip');
  mileTable.dataset.group = 'trip-mile';
  body.push(mileTable);
  const estimate = el('p', 'note');
  estimate.append(el('span', 'badge is-estimate', 'Estimate'), ` The walker's trip with each profile's own walk to and from the same stops, on MATE's footpath map. ${CAUTIOUS} None: no walk within 15 minutes. Cargo bike: not worked out.`);
  body.push(estimate);
  if (ctx.dark) body.push(note('Public transport figures are by day: TEAM\'s windows are all in daylight.'));
  const chosen = profileOf(ctx.profile);
  const ends = ctx.ends ? [[ctx.names.o, ctx.ends.o], [ctx.names.d, ctx.ends.d]].map(([name, line]) => {
    const p = el('p', 'mate-line');
    p.append(el('strong', null, `${name}: `), line || 'MATE has no footpath data here yet.');
    return p;
  }) : [note('Loading MATE…')];
  ends.push(note('The footpath in each end\'s hexagon for the profile chosen, by day: the share of it with no known barrier, harder, not known and a barrier.'));
  body.push(fold(`${key}-ends`, 'What is in the way at each end', chosen.tag, ends));
  return fold(key, title, mileSummary(swap, ctx.profile), body);
}

/** Each profile on foot, for a short trip, with the route for one of them. */
function footFold(ctx) {
  if (!ctx.short) return null;
  const key = `${ctx.key}-foot`;
  const title = [document.createTextNode('On foot, by profile '), preview()];
  if (ctx.routes === undefined) return fold(key, title, 'loading', [note('Working out routes on MATE\'s footpath map…')]);
  if (!ctx.routes) return fold(key, title, null, [note('MATE\'s footpath map is not available here.')]);
  const missing = [ctx.mateMissing?.o ? ctx.names.o : null, ctx.mateMissing?.d ? ctx.names.d : null].filter(Boolean);
  if (missing.length) return fold(key, title, null, [note(`MATE has no footpath data at ${missing.join(' or ')} yet.`)]);
  const rows = footRows(ctx.routes, { dark: ctx.dark, chosen: ctx.profile });
  const body = [];
  const trs = rows.map((r) => {
    const tr = el('tr', r.chosen ? 'is-chosen' : null);
    const name = el('th', 'mate-name');
    name.scope = 'row';
    name.append(profileButton(`${r.short}${r.night ? ', after dark' : ''}`, r.key, ctx));
    tr.append(name, el('td', 'num', r.text));
    return tr;
  });
  const footTable = table('trip-foot', ['Minutes on MATE\'s footpath map', 'Trip'], trs, 'Each profile on foot');
  footTable.dataset.group = 'trip-foot';
  body.push(footTable);
  body.push(note(`${CAUTIOUS} Over ${FOOT_LIMIT}: not within ${FOOT_LIMIT} minutes. A dash: no path this profile can use near one end.`));
  if (ctx.dark) body.push(note('After dark changes the older walker and the child only: unlit paths count as harder.'));

  // The route for one profile, drawn on the map.
  const label = el('label', 'mate-field trip-route-for');
  label.append(el('span', 'field-label', 'Route for'));
  const select = el('select', 'select');
  select.id = 'trip-route-profile';
  for (const p of PROFILES) {
    const option = el('option', null, p.short);
    option.value = p.key;
    option.selected = p.key === ctx.profile;
    select.append(option);
  }
  select.addEventListener('change', () => ctx.onProfile(select.value));
  label.append(select);
  body.push(label);
  const chosen = rows.find((r) => r.chosen) || rows[0];
  const route = routeFor(ctx.routes, chosen.key, ctx.dark, ctx.view);
  const viewWord = ctx.view === 'cautious' ? ', cautious' : '';
  if (route && route.minutes != null) {
    body.push(el('p', 'mate-hero', `${chosen.short}${chosen.night ? ', after dark' : ''}${viewWord}: ${route.minutes} min.`));
    body.push(...routeWay(route).map((line) => el('p', 'mate-line', line)));
    body.push(note('No known barrier: nothing recorded says otherwise. Each route starts and ends at the hexagon\'s centre, joined by a straight line to the nearest path.'));
    body.push(toggle('trip-show-foot', 'Route on the map', ctx.show.foot, (on) => ctx.onShow('foot', on)));
  } else if (route && ['origin', 'destination'].includes(route.reason)) {
    const end = route.reason === 'origin' ? ctx.names.o : ctx.names.d;
    body.push(note(`No path a ${chosen.short.toLowerCase()} can use comes within 175 m of the middle of ${end}.`));
  } else {
    body.push(note(`${chosen.short}: not within ${FOOT_LIMIT} minutes on MATE's footpath map.`));
  }
  const summary = `${profileOf(chosen.key).tag} ${chosen.text}`;
  return fold(key, title, summary, body);
}

/** The Trip tab. ctx: status ('loading', 'unavailable' or 'ready'), names {o, d}, window, windows (TEAM's window
 *  labels and times), times (pairTimes), swap (legSwap; undefined while loading), short, routes (routeCells;
 *  undefined while loading), mateMissing {o, d}, ends {o, d} (what is in the way at each end), profile, dark, view,
 *  show {pt, foot}, onWindow, onProfile, onShow, key (fold prefix). */
export function renderTrip(root, ctx) {
  const parts = [];
  if (ctx.status === 'unavailable') {
    root.replaceChildren(note('Trips are not available for this build.'));
    return;
  }
  if (ctx.status === 'loading' || ctx.times === undefined) {
    root.replaceChildren(note('Loading the trip…'));
    return;
  }
  if (!ctx.times) {
    root.replaceChildren(note('No trips are timed from this hexagon.'));
    return;
  }
  parts.push(modesTable(ctx));
  parts.push(note('Car trips are not shown. Walking and cycling are kept to 20 minutes, public transport to 45.'));
  parts.push(...ptBlock(ctx));
  const folds = el('div', 'folds');
  folds.append(...[footFold(ctx), mileFold(ctx)].filter(Boolean));
  if (folds.childElementCount) parts.push(folds);
  root.replaceChildren(...parts);
}

/** The line shown while a destination is picked: what to do, and Cancel. */
export function pickStrip({ phone = false, message = null, onCancel, limit = 45 }) {
  const box = el('div', 'pick-strip');
  box.setAttribute('role', 'status');
  const text = el('span', 'grow');
  if (message) {
    text.append(el('strong', null, message));
  } else {
    text.append(el('strong', null, phone ? 'Tap where to go.' : 'Pick where to go.'), phone ? ` Hexagons in blue are within ${limit} minutes.` : ' Click a hexagon on the map.');
  }
  const cancel = el('button', null, 'Cancel');
  cancel.type = 'button';
  cancel.id = 'pick-cancel';
  cancel.addEventListener('click', onCancel);
  box.append(text, cancel);
  return box;
}
