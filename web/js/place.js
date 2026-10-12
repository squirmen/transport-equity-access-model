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
  const fastest = bestMode(data, service, i, zones);
  const best = fastest ? timeFor(data, service, fastest, i, zones) : NaN;
  const mode = viewMode && viewMode !== 'best' ? viewMode : fastest;
  const shown = mode ? timeFor(data, service, mode, i, zones) : NaN;
  // With no route at all within the routing limit, the place misses the
  // standard; it is not a mode that "doesn't count".
  // Walking at the slower pace is walking, so it counts like walking does.
  const counts = mode ? data.meta.standard_modes.includes(mode) || mode === 'walk_slow' : true;
  const meets = counts && Number.isFinite(shown) && shown <= standard;
  const pricedOut = mode === 'pt' && zones != null
    && Number.isFinite(data.t[service]?.pt?.[i]) && !Number.isFinite(shown);
  return { fastest, best, mode, shown, counts, meets, pricedOut };
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

/** The verdict band for one service: { state, badge, strong, rest }. */
export function verdictLine(data, i, service, standard, viewMode, zones = null) {
  const v = serviceVerdict(data, i, service, standard, viewMode, zones);
  const name = SERVICE_SHORT[service] || service;
  const nearest = data.nearest?.[service]?.[i];
  const nearName = nearest != null && v.fastest ? data.destinations?.[nearest]?.name : null;
  if (v.pricedOut) {
    return {
      state: 'misses',
      badge: 'Misses',
      strong: `${name}: costs too much by public transport.`,
      rest: `Reachable in ${minutes(data.t[service].pt[i])}, but not on this fare budget. The standard is ${standard} min.`,
    };
  }
  if (!v.counts) {
    return {
      state: 'reference',
      badge: "Doesn't count",
      strong: `${name}: ${minutes(v.shown)} ${HOW[v.mode] || ''}.`,
      rest: 'Shown for comparison: car and any-street cycling never count towards a standard.',
    };
  }
  if (!v.mode) {
    return { state: 'misses', badge: 'Misses', strong: `${name}: over 60 min without a car.`, rest: `The standard is ${standard} min.` };
  }
  const strong = `${name}: ${minutes(v.shown)} ${HOW[v.mode] || ''}.`;
  if (v.meets) {
    return { state: 'meets', badge: 'Meets', strong, rest: `The standard is ${standard} min.${nearName ? ` Nearest: ${nearName}.` : ''}` };
  }
  const reason = reasonFor(data, i, service, standard, zones, v.best);
  return { state: 'misses', badge: 'Misses', strong, rest: `The standard is ${standard} min.${reason ? ` ${reason.label}.` : ''}` };
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

function serviceRow(data, i, service, standard, viewMode, zones, chosen) {  // eslint-disable-line max-statements
  const { fastest, best, mode, shown, counts, meets, pricedOut } = serviceVerdict(data, i, service, standard, viewMode, zones);
  const state = !counts ? 'is-reference' : meets ? 'is-met' : 'is-missed';
  const details = el('details', `service-row ${state}${chosen ? ' is-chosen' : ''}`);
  details.dataset.service = service;
  const summary = el('summary');
  const badge = el('span', 'badge', !counts ? "Doesn't count" : meets ? 'Meets' : 'Misses');
  const what = el('span', 'service-name', SERVICE_SHORT[service]);
  const time = el('span', 'service-time', pricedOut
    ? 'costs too much'
    : mode ? `${minutes(shown)} · ${MODES[mode].short}` : 'over 60 min');
  summary.append(badge, what, time);
  details.append(summary);
  if (mode && mode !== fastest && Number.isFinite(best)) {
    const verdict = best <= standard ? `within the ${standard}-minute standard` : `still over ${standard} minutes`;
    details.append(
      el('p', 'service-reason', `Fastest without a car: ${MODES[fastest].short}, ${minutes(best)}, ${verdict}.`),
    );
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
    const t = timeFor(data, service, m, i, zones);
    grid.append(el('span', 'mode-name', MODES[m].label), el('span', 'mode-time', minutes(t)));
  }
  details.append(grid);
  const nearest = data.nearest[service]?.[i];
  if (nearest != null && fastest && data.destinations[nearest]?.name) {
    details.append(el('p', 'service-nearest', `Nearest by ${MODES[fastest].short}: ${data.destinations[nearest].name}`));
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
 *  works out); `opts.slot` goes under the tiles (trips); `opts.extra` holds
 *  sections after TEAM's own, such as MATE's behind ?mate=1. `opts.key`
 *  prefixes the fold keys, so a trip's From and To cards fold apart. */
export function renderPlace(root, data, i, state, opts = {}) {
  const { extra = [], slot = null, lead = null, key = 'card' } = opts;
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
  else if (!band && data.t[state.service]) band = verdictLine(data, i, state.service, standards(state.service), viewMode, zones);

  const services = SERVICE_ORDER.filter((s) => s !== 'jobs' && data.t[s]).map((s) =>
    serviceRow(data, i, s, standards(s), viewMode, zones, s === state.service));
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
    better = rankAmong(scores, data.pop, i);
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
    band ? verdictBand(band) : null,
    el('p', 'rollup', rollup(data, i, standards, zones)),
    tiles([jobTile, stopTile, scoreTile]),
    slot,
    el('div', 'folds', null),
  ].filter(Boolean));
  root.body.querySelector('.folds').append(...[
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
