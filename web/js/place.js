// The hexagon card: everything TEAM knows about one hexagon, answer first.
//
// It opens on the service and way of travelling on screen (the verdict band),
// a line for every standard, three numbers, then folded sections, each with a
// short summary so folding hides nothing.

import { bestMode, costLayer, pricedLayer, tripTime } from './data.js';
import { fare, freeTravel, money, paymentKey } from './fares.js';
import { diagnoseCell } from './diagnose.js';
import { fold } from './fold.js';
import { count, el, metres, minutes, MODES, place as placeNames } from './format.js';
import { lowerName, SERVICE_ORDER, SERVICE_SHORT } from './panel.js';
import { REASON_CLASS, REASON_GROUPS } from './palette.js';

const DETAIL_MODES = ['walk', 'bike_low_stress', 'bike', 'pt', 'car'];

// How a time was made, after the minutes: "3 min walking".
const HOW = {
  walk: 'walking',
  walk_slow: 'walking at 3.6 km/h',
  bike_low_stress: 'by low-stress cycling',
  bike: 'cycling on any street',
  pt: 'by public transport',
  car: 'by car',
  // Girls and boys together, each by their own fastest way.
  best: 'without a car',
};

function row(label, value) {
  const line = el('div', 'kv');
  line.append(el('span', 'kv-key', label), el('span', 'kv-value', value));
  return line;
}

/** The share of residents this cell beats on a measure, population weighted.
 *
 *  A number on its own says little: 31% of jobs within reach is good in one
 *  city and poor in another. Where it sits among everyone else is the part
 *  that carries meaning.
 */
export function rankAmong(values, weights, i) {
  if (!values || !Number.isFinite(values[i])) return NaN;
  const here = values[i];
  let below = 0;
  let total = 0;
  for (let k = 0; k < values.length; k += 1) {
    const w = weights[k];
    if (!(w > 0) || !Number.isFinite(values[k])) continue;
    total += w;
    if (values[k] < here) below += w;
  }
  return total > 0 ? below / total : NaN;
}

/** What the card should say about one service in one hexagon.
 *
 *  The card follows the travel mode shown on the map, so a place coloured as
 *  over the standard by public transport does not report "Meets" from a faster
 *  bike time. "Best without a car" is the fastest of the modes that count;
 *  car and any-street cycling are shown for reference and never count.
 */
export function timeFor(data, service, mode, i, zones = null) {
  if (mode !== 'pt' || zones == null) return data.t[service]?.[mode]?.[i];
  return pricedLayer(data, service, zones)?.[i] ?? NaN;
}

export function serviceVerdict(data, i, service, standard, viewMode, zones = null) {
  // Girls and boys together have a best time of their own (schools.js): the
  // slower of each one's fastest way, which no single way may give.
  const own = zones == null ? data.best?.[service] : null;
  const fastest = bestMode(data, service, i, zones);
  const best = own ? own[i] : fastest ? timeFor(data, service, fastest, i, zones) : NaN;
  const ownBest = own && Number.isFinite(best) ? 'best' : null;
  const mode = viewMode && viewMode !== 'best' ? viewMode : own ? ownBest : fastest;
  const shown = mode === 'best' ? best : mode ? timeFor(data, service, mode, i, zones) : NaN;
  // With no route at all within the routing limit, the place misses the
  // standard; it is not a mode that "doesn't count".
  // Walking at the slower pace is walking, so it counts like walking does.
  const counts = mode ? data.meta.standard_modes.includes(mode) || mode === 'walk_slow' || mode === 'best' : true;
  const meets = counts && Number.isFinite(shown) && shown <= standard;
  const pricedOut = mode === 'pt' && zones != null
    && Number.isFinite(data.t[service]?.pt?.[i]) && !Number.isFinite(shown);
  return { fastest, best, mode, shown, counts, meets, pricedOut, own: Boolean(own) };
}

/** The main reason a service misses the standard here, as a REASON_GROUPS entry. */
function reasonFor(data, i, service, standard, zones, best) {
  const code = diagnoseCell(
    {
      km: data.km[service]?.[i],
      walk: data.t[service].walk?.[i],
      bikeLow: data.t[service].bike_low_stress?.[i],
      bike: data.t[service].bike?.[i],
      pt: timeFor(data, service, 'pt', i, zones),
      car: data.t[service].car?.[i],
      best,
      freq: data.freq[data.activeWindow?.[service] || data.meta.services[service].window]?.[i],
      // With a budget, the best time at any price, so a fare barrier is named.
      unpriced: zones != null ? Math.min(...data.meta.standard_modes.map((m) => {
        const t = timeFor(data, service, m, i, null);
        return Number.isFinite(t) ? t : Infinity;
      })) : NaN,
    },
    standard,
  );
  return code in REASON_CLASS ? REASON_GROUPS[REASON_CLASS[code]] : null;
}

/** The destinations reached from hexagon i in `mode`'s time, by `mode`: the
 *  nearest and any reached in the same minute, as indexes into
 *  destinations.json. Builds before 0.12 send only the nearest by the fastest
 *  way, which names the way shown only when that is the fastest. */
export function namedFor(data, service, mode, i) {
  const byMode = data.nearestMode?.[service];
  if (byMode) {
    const m = mode === 'walk_slow' ? 'walk' : mode;
    const near = byMode[m];
    const k = near ? near[i] : null;
    if (k == null || k < 0) return [];
    const extra = data.ties?.[service]?.[m]?.[i] || [];
    return [k, ...extra.filter((d) => d != null && d !== k)];
  }
  const k = data.nearest?.[service]?.[i];
  if (k == null || mode !== bestMode(data, service, i)) return [];
  return [k];
}

/** "A", "A or B", "A, B or C". */
export function orNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** How the time on screen was made, and what it reaches.
 *
 *  A public transport time may be a walk the whole way, when no bus or train
 *  is quicker. Where it equals the walking time it is said as walking, and
 *  the places named are those reached on foot in that time. Where walking is
 *  quicker still (a trip by public transport may only walk 15 minutes
 *  straight to the door), that is said too. Under a fare budget the priced
 *  time may go somewhere else at the same minute, so nothing is named. */
export function tripWords(data, service, mode, i, zones = null) {
  const shown = timeFor(data, service, mode, i, zones);
  const out = { how: HOW[mode] || '', onFoot: false, quicker: null, names: [] };
  if (mode === 'best') return out;
  if (!Number.isFinite(shown)) {
    // None within the limit by public transport, but on foot there is one:
    // a trip by public transport may walk only so far straight to the door.
    const walk = mode === 'pt' && zones == null ? data.t[service]?.walk?.[i] : NaN;
    if (Number.isFinite(walk)) out.quicker = walk;
    return out;
  }
  const priced = mode === 'pt' && zones != null;
  if (mode === 'pt') {
    const walk = data.t[service]?.walk?.[i];
    // Girls and boys together say for themselves where the time shown is a
    // walk (schools.js onFoot): equal joint times are not enough there.
    const foot = !priced ? data.ptFoot?.[service] : null;
    if (foot ? foot.mask[i] === 1 : Number.isFinite(walk) && walk === shown) {
      out.how = 'on foot';
      out.onFoot = true;
      if (foot) out.names = foot.near[i] >= 0 ? [foot.near[i], ...(foot.ties[i] || [])] : [];
      else if (!priced) out.names = namedFor(data, service, 'walk', i);
      return out;
    }
    if (Number.isFinite(walk) && walk < shown) out.quicker = walk;
  }
  if (!priced) out.names = namedFor(data, service, mode, i);
  return out;
}

/** The verdict band for one service: { state, badge, strong, rest }.
 *
 *  `more` is for the service on screen when it is a school service:
 *  { short, label(d), lines(mode, i, names, shown) }, from schools.js, giving
 *  the choice's name, a tag after a school's name, and extra sentences. */
/** The card's first sentence for a service in hexagon i: the time on
 *  screen and how it is made ("9 min on foot. No bus or train is quicker.").
 *  The map's tooltip uses the same words, so the two never disagree.
 *  Returns { v, trip, strong }; trip is null where no time is shown. */
export function headline(data, i, service, standard, viewMode, zones = null, name = SERVICE_SHORT[service] || service) {
  const v = serviceVerdict(data, i, service, standard, viewMode, zones);
  if (v.pricedOut) return { v, trip: null, strong: `${name}: costs too much by public transport.` };
  if (!v.counts) return { v, trip: null, strong: `${name}: ${minutes(v.shown)} ${HOW[v.mode] || ''}.` };
  if (!v.mode) return { v, trip: null, strong: `${name}: over 60 min without a car.` };
  const trip = tripWords(data, service, v.mode, i, zones);
  return { v, trip, strong: `${name}: ${minutes(v.shown)} ${trip.how}.${trip.onFoot ? ' No bus or train is quicker.' : ''}` };
}

/** The map's tooltip for a service: the card's first sentence, and walking
 *  where it is quicker than the public transport time the map shows. */
export function tooltipLines(data, i, service, standard, viewMode, zones = null, name = undefined) {
  const { trip, strong } = headline(data, i, service, standard, viewMode, zones, name);
  return [strong, trip && Number.isFinite(trip.quicker) ? `Walking is quicker: ${minutes(trip.quicker)}.` : null].filter(Boolean);
}

export function verdictLine(data, i, service, standard, viewMode, zones = null, more = null) {
  const name = more?.short || SERVICE_SHORT[service] || service;
  const { v, trip, strong } = headline(data, i, service, standard, viewMode, zones, name);
  if (v.pricedOut) {
    return {
      state: 'misses',
      badge: 'Misses',
      strong,
      rest: `Reachable in ${minutes(data.t[service].pt[i])}, but not on this fare budget. The standard is ${standard} min.`,
    };
  }
  if (!v.counts) {
    return {
      state: 'reference',
      badge: "Doesn't count",
      strong,
      rest: 'Shown for comparison: car and any-street cycling never count towards a standard.',
    };
  }
  if (!v.mode) {
    const extra = more ? more.lines(null, i, [], NaN) : [];
    return { state: 'misses', badge: 'Misses', strong, rest: [...extra, `The standard is ${standard} min.`].join(' ') };
  }
  const bits = [];
  if (Number.isFinite(trip.quicker)) bits.push(`Walking is quicker: ${minutes(trip.quicker)}.`);
  if (trip.names.length && !(more && more.one)) {
    const label = (k) => (more?.label ? more.label(k) : data.destinations?.[k]?.name || 'unnamed');
    const all = trip.names.length > 2 ? 'all' : 'both';
    bits.push(trip.names.length > 1
      ? `Nearest: ${orNames(trip.names.map(label))}, ${all} ${minutes(v.shown)}.`
      : `Nearest: ${label(trip.names[0])}.`);
  }
  if (more) bits.push(...more.lines(v.mode, i, trip.names, v.shown));
  if (v.meets) {
    return { state: 'meets', badge: 'Meets', strong, rest: [...bits, `The standard is ${standard} min.`].join(' ') };
  }
  const reason = reasonFor(data, i, service, standard, zones, v.best);
  return { state: 'misses', badge: 'Misses', strong, rest: [...bits, `The standard is ${standard} min.${reason ? ` ${reason.label}.` : ''}`].join(' ') };
}

/** "Meets all 11 standards without a car." or which it misses. */
export function rollup(data, i, standards, zones = null) {
  const services = SERVICE_ORDER.filter((s) => s !== 'jobs' && data.t[s]);
  const missed = [];
  for (const s of services) {
    const v = serviceVerdict(data, i, s, standards(s), 'best', zones);
    if (!v.meets) missed.push(`${lowerName(SERVICE_SHORT[s] || s)}, ${v.pricedOut ? 'costs too much' : minutes(v.best)}`);
  }
  const total = services.length;
  if (!missed.length) return `Meets all ${total} standards without a car.`;
  if (missed.length === total) return `Meets none of the ${total} standards without a car.`;
  const listed = missed.length > 3 ? `${missed.slice(0, 3).join('; ')} and ${missed.length - 3} more` : missed.join('; ');
  return `Meets ${total - missed.length} of ${total} standards without a car. Misses: ${listed}.`;
}

/** Jobs within 45 minutes by whichever of public transport, low-stress
 *  cycling and walking reaches most. */
export function jobsTile(data, i) {
  let bestShare = NaN;
  let bestMode = null;
  for (const mode of ['pt', 'bike_low_stress', 'walk']) {
    const share = data.jobs?.[mode]?.['45']?.[i];
    if (Number.isFinite(share) && !(share <= bestShare)) {
      bestShare = share;
      bestMode = mode;
    }
  }
  if (!bestMode) return { figure: '–', label: 'no jobs figure here', short: null };
  const jobs = (bestShare / 100) * data.meta.jobs.total;
  const by = { pt: 'by public transport', bike_low_stress: 'by low-stress cycling', walk: 'on foot' }[bestMode];
  return { figure: count(jobs), label: `jobs in 45 min ${by}`, short: `${count(jobs)} ${{ pt: 'by PT', bike_low_stress: 'by cycling', walk: 'on foot' }[bestMode]}` };
}

function tile({ figure, label }) {
  const box = el('div', 'tile');
  box.append(el('strong', null, figure), el('span', null, label));
  return box;
}

function serviceRow(data, i, service, standard, viewMode, zones, chosen, more = null) {  // eslint-disable-line max-statements
  const { fastest, best, mode, shown, counts, meets, pricedOut, own } = serviceVerdict(data, i, service, standard, viewMode, zones);
  const state = !counts ? 'is-reference' : meets ? 'is-met' : 'is-missed';
  const details = el('details', `service-row ${state}${chosen ? ' is-chosen' : ''}`);
  details.dataset.service = service;
  const summary = el('summary');
  const badge = el('span', 'badge', !counts ? "Doesn't count" : meets ? 'Meets' : 'Misses');
  const what = el('span', 'service-name', more?.short || SERVICE_SHORT[service]);
  const time = el('span', 'service-time', pricedOut
    ? 'costs too much'
    : mode ? `${minutes(shown)} · ${MODES[mode].short}` : 'over 60 min');
  summary.append(badge, what, time);
  details.append(summary);
  const ownBest = mode === 'best';
  if (mode && !ownBest && Number.isFinite(best) && (own || (fastest && mode !== fastest))) {
    const verdict = best <= standard ? `within the ${standard}-minute standard` : `still over ${standard} minutes`;
    details.append(el('p', 'service-reason', own
      ? `Fastest without a car, for a girl and a boy each by their own fastest way: ${minutes(best)}, ${verdict}.`
      : `Fastest without a car: ${MODES[fastest].short}, ${minutes(best)}, ${verdict}.`));
  }
  if (ownBest) {
    details.append(el('p', 'service-reason', 'The slower of the fastest times for a girl and for a boy, who may each travel a different way.'));
  }
  if (pricedOut) {
    const full = data.t[service].pt[i];
    details.append(el('p', 'service-reason', `Reachable by public transport in ${minutes(full)}, but not on this fare budget.`));
  }
  if (!counts && mode) {
    details.append(el('p', 'service-reason', `Shown for comparison. A standard is met on foot, on a low-stress bike route or by public transport, so ${MODES[mode].short} never counts towards one.`));
  }
  if (counts && !meets) {
    const group = reasonFor(data, i, service, standard, zones, best);
    if (group) details.append(el('p', 'service-reason', `${group.label}. ${group.fix}.`));
  }
  const grid = el('div', 'mode-grid');
  // The slower pace sits under walking, for places built with one.
  const modes = data.t[service]?.walk_slow ? ['walk', 'walk_slow', ...DETAIL_MODES.slice(1)] : DETAIL_MODES;
  for (const m of modes) {
    // Under a school choice, a comparison way is worked out only while it is on screen.
    if (!data.t[service]?.[m]) continue;
    const t = timeFor(data, service, m, i, zones);
    grid.append(el('span', 'mode-name', MODES[m].label), el('span', 'mode-time', minutes(t)));
  }
  details.append(grid);
  // Named for the fastest way, from the fastest way's own nearest. Under a
  // fare budget the priced trip may go elsewhere, so nothing is named.
  const named = fastest && !own && !(fastest === 'pt' && zones != null) ? namedFor(data, service, fastest, i) : [];
  if (named.length && !more?.one) {
    const label = (k) => (more?.label ? more.label(k) : data.destinations?.[k]?.name || 'unnamed');
    details.append(el('p', 'service-nearest', `Nearest by ${MODES[fastest].short}: ${orNames(named.map(label))}`));
  }
  details.append(el('p', 'service-standard', `Standard: within ${standard} min. Straight-line distance ${metres((data.km[service]?.[i] ?? NaN) * 1000)}.`));
  return { node: details, meets: meets && counts, counts };
}

/** The card's header for hexagon `i`: eyebrow, title, subtitle. */
export function placeHeader(data, i) {
  const placeIndex = data.place[i];
  const spot = placeIndex != null ? data.places[placeIndex] : null;
  // Everyone who lives here, even when only urban areas are being counted.
  const living = (data.everywhere || data).pop[i];
  const bits = [];
  if (Number.isFinite(living)) bits.push(`About ${count(living)} residents`);
  if (data.zone && data.zone[i]) bits.push(`fare zone ${data.zone[i]}`);
  return {
    eyebrow: `Hexagon · ${spot && spot.board ? spot.board : placeNames.name}`,
    title: spot ? spot.name : 'Unnamed area',
    sub: bits.join(' · '),
  };
}

/** The card for hexagon `i`.
 *
 *  `opts.lead` replaces the verdict band (the errand round, which app.js
 *  works out); `opts.top` goes first (the line shown while a trip's
 *  destination is picked); `opts.slot` goes under the tiles (trips);
 *  `opts.extra` holds sections after TEAM's own, such as MATE's behind
 *  ?mate=1. `opts.key` prefixes the fold keys, so a trip's From and To cards
 *  fold apart. `opts.school` is the schools wording for the service on
 *  screen (see verdictLine), and `opts.schoolFold` a fold of its own that
 *  goes first. */
export function renderPlace(root, data, i, state, opts = {}) {
  const { extra = [], slot = null, lead = null, key = 'card', top = null, schoolFold = null } = opts;
  const head = placeHeader(data, i);
  const standards = (s) => state.standard[s] ?? data.meta.services[s].standard_minutes;

  const viewMode = state.measure === 'score' ? 'best' : state.mode;
  // A budget set as a share of income gives each hexagon its own limit; the
  // card is about one hexagon, so it reads that one.
  let zones = state.measure === 'score' ? null : state.zonesNow ?? null;
  if (zones != null && typeof zones !== 'number') zones = zones[i];

  // The answer first: the service and way of travelling on screen.
  let band = lead;
  if (!band && state.measure === 'score') band = scoreLead(data, i, state);
  else if (!band && state.service === 'jobs') band = jobsLead(data, i, state, zones);
  else if (!band && data.t[state.service]) band = verdictLine(data, i, state.service, standards(state.service), viewMode, zones, opts.school || null);

  const services = SERVICE_ORDER.filter((s) => s !== 'jobs' && data.t[s]).map((s) =>
    serviceRow(data, i, s, standards(s), viewMode, zones, s === state.service, s === state.service ? opts.school || null : null));
  const counted = services.filter((s) => s.counts);
  const servicesSum = counted.length ? `${services.filter((s) => s.meets).length} of ${services.length}` : null;

  // Jobs follow the time and the fare budget, like everything else here.
  const jobs = [];
  const windows = data.meta.windows || {};
  const jobsWindow = data.activeWindow?.jobs;
  const jobsWhen = jobsWindow && jobsWindow !== data.meta.jobs.window ? `, ${windows[jobsWindow]?.label || jobsWindow}` : '';
  const jobsLayer = zones != null && zones > 0 ? costLayer(data, 'jobs', zones) : null;
  for (const [mode, label] of [['pt', 'Public transport'], ['bike_low_stress', 'Low-stress cycling'], ['walk', 'Walking']]) {
    const priced = mode === 'pt' && zones != null;
    const share = priced ? (zones <= 0 ? 0 : jobsLayer?.[i]) : data.jobs[mode]?.['45']?.[i];
    if (Number.isFinite(share)) {
      const total = data.meta.jobs.total;
      const name = mode === 'pt' ? `${label}, 45 min${jobsWhen}${priced ? ', on this budget' : ''}` : `${label}, 45 min`;
      jobs.push(row(name, `${share.toFixed(share < 10 ? 1 : 0)}% · about ${count((share / 100) * total)} jobs`));
    }
  }
  const fair = data.fair.pt?.['45']?.[i];
  if (Number.isFinite(fair)) jobs.push(row('Allowing for competition', `${fair.toFixed(2)}× the ${placeNames.name} average by public transport`));
  const jobTile = jobsTile(data, i);

  // One row for the busiest nearby stop in every window, rather than one each.
  const timed = Object.keys(data.freq).filter((w) => windows[w]);
  const around = [
    row('Stop with 4+ departures an hour', metres(data.mStop[i])),
    row(`Busiest stop within 800 m, departures an hour (${timed.map((w) => windows[w].label || w).join(' / ')})`,
      timed.map((w) => Math.round(data.freq[w][i] || 0)).join(' / ')),
    row('Train or ferry', metres(data.mRail[i])),
    row('Nearest cycleway or shared path', metres(data.mBike[i])),
  ];
  if (data.zone && data.zone[i]) around.unshift(row('Fare zone', data.zone[i]));
  const usualWindow = data.activeWindow?.[state.service] || timed[0];
  const busiest = Math.round(data.freq[usualWindow]?.[i] || 0);
  const aroundSum = Number.isFinite(data.mStop[i]) ? `stop ${metres(data.mStop[i])}` : `busiest stop ${busiest} an hour`;

  // A share of a small hexagon is hard to picture, so say how many people
  // that is as well.
  const residents = (data.everywhere || data).pop[i];
  const group = (k, label) => {
    const share = data.shares[k]?.[i];
    if (!Number.isFinite(share)) return null;
    const heads = Number.isFinite(residents) ? ` · about ${count((share / 100) * residents)}` : '';
    return row(label, `${share}%${heads}`);
  };
  const labels = data.meta.groups || {};
  const people = [
    row('Neighbourhood deprivation', Number.isFinite(data.nzdep[i]) ? `NZDep ${data.nzdep[i]} of 10` : 'not given'),
    group('no_car', labels.no_car || 'Households without a car'),
    group('children', labels.children || 'Children under 15'),
    group('older', labels.older || 'Aged 65 and over'),
    group('low_income', labels.low_income || 'Households under $70,000'),
    group('maori', labels.maori || 'Māori'),
    group('pacific', labels.pacific || 'Pacific peoples'),
    group('asian', labels.asian || 'Asian'),
    group('disabled', labels.disabled || 'Disabled people'),
  ].filter(Boolean);
  if (Number.isFinite(data.drive[i])) people.push(row('Drove to work (this SA2, 2023)', `${data.drive[i]}%`));
  const whoSum = Number.isFinite(data.nzdep[i]) ? `NZDep ${data.nzdep[i]} of 10`
    : Number.isFinite(data.drive[i]) ? `${data.drive[i]}% drove to work` : null;

  // What the whole basket of opportunities is worth from here, and what the
  // cheapest way to each service costs.
  const scoreMode = state.measure === 'score' ? state.scoreMode : (state.mode && data.access[state.mode] ? state.mode : 'pt');
  const scores = data.access[scoreMode]?.all;
  const standing = [];
  let better = NaN;
  if (scores && Number.isFinite(scores[i])) {
    standing.push(row(`Access score by ${MODES[scoreMode].short}`, `${Math.round(scores[i])} · ${placeNames.name} average is 100`));
    // Against everyone counted, but not narrowed to one school's zone: the
    // score is about everything, not that school.
    const counted = data.cellMask ? (data.urbanOn && data.urbanOnly ? data.urbanOnly.pop : data.everywhere?.pop) || data.pop : data.pop;
    better = rankAmong(scores, counted, i);
    if (Number.isFinite(better)) standing.push(row('Better than', `${Math.floor(better * 100)}% of residents`));
  }
  if (data.cost && data.meta.fares) {
    const cheapest = SERVICE_ORDER.filter((sv) => sv !== 'jobs' && data.cost[sv]).map((sv) => {
      const standard = standards(sv);
      const free = ['walk', 'bike_low_stress'].some((m) => {
        const t = data.t[sv]?.[m]?.[i];
        return Number.isFinite(t) && t <= standard;
      });
      if (free) return 0;
      for (let z = 1; data.cost[sv][`z${z}`]; z += 1) {
        const t = data.cost[sv][`z${z}`][i];
        if (Number.isFinite(t) && t <= standard) return z;
      }
      return null;
    });
    const freeCount = cheapest.filter((z) => z === 0).length;
    const payable = cheapest.filter((z) => z && z > 0).length;
    const never = cheapest.filter((z) => z === null).length;
    standing.push(row('Services within the standard', `${freeCount} free on foot or by bike, ${payable} for a fare, ${never} not at all`));
  }
  // What the cheapest fare means here, against what people here earn.
  const income = data.income?.[i];
  if (data.meta.fares?.fares && Number.isFinite(income) && income > 0) {
    const meta = data.meta.fares;
    const { hour, weekday } = tripTime(data, data.activeWindow?.gp || data.meta.services?.gp?.window);
    const trips = state.returnTrip ? 2 : 1;
    const cost = freeTravel(meta, state.profile, hour, weekday)
      ? 0 : fare(meta, 1, state.profile, paymentKey(meta, state.payment, hour, weekday)) * trips;
    standing.push(row('Income per person, after household size', `about $${Math.round(income / 1000)}k a year`));
    if (Number.isFinite(cost)) {
      const pct = (cost / (income / 365)) * 100;
      const oneZone = (meta.kind || 'zones') !== 'flat' ? '1-zone ' : '';
      standing.push(row(`A ${oneZone}${state.returnTrip ? 'return' : 'one-way'} fare of ${money(cost)}`, `${pct.toFixed(pct < 10 ? 1 : 0)}% of a day's income here`));
    }
  }
  const scoreTile = scores && Number.isFinite(scores[i])
    ? { figure: String(Math.round(scores[i])), label: `access score (${placeNames.name} 100)` }
    : { figure: '–', label: 'no access score here' };
  const stopTile = Number.isFinite(data.mStop[i])
    ? { figure: metres(data.mStop[i]), label: 'to a stop with 4+ an hour' }
    : { figure: '–', label: 'no stop with 4+ an hour' };

  let heading = viewMode === 'best'
    ? 'Services, fastest without a car'
    : `Services by ${MODES[viewMode].short}`;
  // A time only applies to what was timed then; the rest keep their usual time.
  let untimed = null;
  if (state.when && windows[state.when] && ['best', 'pt'].includes(viewMode)) {
    heading += `, ${windows[state.when].label || state.when}`;
    const others = SERVICE_ORDER.filter((s) => s !== 'jobs' && data.t[s] && data.activeWindow?.[s] !== state.when);
    if (others.length) {
      const names = others.map((s) => lowerName(SERVICE_SHORT[s]));
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      untimed = el('p', 'note', `${list[0].toUpperCase()}${list.slice(1)} ${others.length > 1 ? 'are' : 'is'} shown at the usual time.`);
    }
  }
  if (zones != null) heading += zones <= 0 ? ', no fare affordable' : `, within ${zones} fare ${zones === 1 ? 'zone' : 'zones'}`;

  // The title goes on with the body, never before it, so a card can never
  // show one place's name over another place's figures.
  if (root.eyebrow) root.eyebrow.textContent = head.eyebrow;
  root.title.textContent = head.title;
  root.sub.textContent = head.sub;
  root.body.replaceChildren(...[
    ...[].concat(top || []),
    band ? verdictBand(band) : null,
    el('p', 'rollup', rollup(data, i, standards, zones)),
    tiles([jobTile, stopTile, scoreTile]),
    slot,
    el('div', 'folds', null),
  ].filter(Boolean));
  root.body.querySelector('.folds').append(...[
    schoolFold,
    fold(`${key}-services`, heading, servicesSum, [...services.map((s) => s.node), untimed]),
    fold(`${key}-jobs`, 'Jobs within reach', jobTile.short, jobs.length ? jobs : [el('p', 'note', 'No job figures for this hexagon.')]),
    fold(`${key}-around`, 'Around here', aroundSum, around),
    fold(`${key}-who`, 'Who lives here', whoSum, [...people, el('p', 'note', 'Census shares describe the surrounding block, not this hexagon alone. Ethnic groups overlap, so they do not add to the population.')]),
    standing.length ? fold(`${key}-stands`, 'How this place stands', Number.isFinite(better) ? `better than ${Math.floor(better * 100)}%` : null, standing) : null,
    ...extra,
  ].filter(Boolean));
}

function tiles(list) {
  const box = el('div', 'tiles');
  box.append(...list.map(tile));
  return box;
}

function verdictBand(band) {
  const box = el('div', `verdict is-${band.state}`);
  box.setAttribute('role', 'status');
  if (band.badge) box.append(el('span', 'badge', band.badge));
  const text = el('p', 'verdict-text');
  text.append(el('strong', null, band.strong), document.createTextNode(band.rest ? ` ${band.rest}` : ''));
  box.append(text);
  return box;
}

/** The score on screen, for this hexagon. */
function scoreLead(data, i, state) {
  const modes = Object.keys(data.access || {});
  const mode = modes.includes(state.scoreMode) ? state.scoreMode : modes[0];
  const keys = mode ? Object.keys(data.access[mode]) : [];
  const key = keys.includes(state.scoreKey) ? state.scoreKey : keys[keys.length - 1];
  const values = data.access[mode]?.[key];
  if (!values || !Number.isFinite(values[i])) return { state: 'info', strong: 'No access score here.', rest: '' };
  const label = (data.meta.access?.keys || {})[key] || key;
  const better = rankAmong(values, data.pop, i);
  return {
    state: 'info',
    strong: `${label}: score ${Math.round(values[i])} by ${MODES[mode]?.short || mode}.`,
    rest: `The ${placeNames.name} average is 100${Number.isFinite(better) ? `; better than ${Math.floor(better * 100)}% of residents` : ''}.`,
  };
}

/** Jobs on screen, for this hexagon: the mode and limit picked. */
function jobsLead(data, i, state, zones) {
  const modes = Object.keys(data.jobs || {});
  const mode = modes.includes(state.jobsMode) ? state.jobsMode : modes[0];
  if (!mode) return null;
  const limits = Object.keys(data.jobs[mode]).map(Number).sort((a, b) => a - b);
  const limit = limits.includes(Number(state.jobsLimit)) ? Number(state.jobsLimit) : limits[limits.length - 1];
  const priced = mode === 'pt' && zones != null && data.cost.jobs;
  const share = priced ? (zones <= 0 ? 0 : costLayer(data, 'jobs', zones)?.[i]) : data.jobs[mode][String(limit)]?.[i];
  if (!Number.isFinite(share)) return { state: 'info', strong: 'No job figure for this hexagon.', rest: '' };
  const jobs = (share / 100) * data.meta.jobs.total;
  const minutesLimit = priced ? (data.meta.fares.max_minutes || limit) : limit;
  return {
    state: 'info',
    strong: `${count(jobs)} jobs within ${minutesLimit} min by ${MODES[mode].short}${priced ? ', on this budget' : ''}.`,
    rest: `${share.toFixed(share < 10 ? 1 : 0)}% of ${placeNames.possessive} jobs.`,
  };
}
