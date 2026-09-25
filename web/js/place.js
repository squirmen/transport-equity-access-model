// The place panel: everything TEAM knows about one hexagon.

import { bestMode } from './data.js';
import { diagnoseCell } from './diagnose.js';
import { count, el, metres, minutes, MODES, place as placeNames } from './format.js';
import { SERVICE_ORDER, SERVICE_SHORT } from './panel.js';
import { REASON_CLASS, REASON_GROUPS } from './palette.js';

const DETAIL_MODES = ['walk', 'bike_low_stress', 'bike', 'pt', 'car'];

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

function section(title, ...children) {
  const box = el('section', 'place-section');
  box.append(el('h3', null, title), ...children);
  return box;
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
  if (zones <= 0) return NaN;
  return data.cost[service]?.[`z${Math.min(zones, 4)}`]?.[i];
}

export function serviceVerdict(data, i, service, standard, viewMode, zones = null) {
  const fastest = bestMode(data, service, i, zones);
  const best = fastest ? timeFor(data, service, fastest, i, zones) : NaN;
  const mode = viewMode && viewMode !== 'best' ? viewMode : fastest;
  const shown = mode ? timeFor(data, service, mode, i, zones) : NaN;
  const counts = mode ? data.meta.standard_modes.includes(mode) : false;
  const meets = counts && Number.isFinite(shown) && shown <= standard;
  const pricedOut = mode === 'pt' && zones != null
    && Number.isFinite(data.t[service]?.pt?.[i]) && !Number.isFinite(shown);
  return { fastest, best, mode, shown, counts, meets, pricedOut };
}

function serviceRow(data, i, service, standard, viewMode, zones) {  // eslint-disable-line max-statements
  const { fastest, best, mode, shown, counts, meets, pricedOut } = serviceVerdict(data, i, service, standard, viewMode, zones);
  const code = diagnoseCell(
    {
      km: data.km[service]?.[i],
      walk: data.t[service].walk?.[i],
      bikeLow: data.t[service].bike_low_stress?.[i],
      bike: data.t[service].bike?.[i],
      pt: timeFor(data, service, 'pt', i, zones),
      car: data.t[service].car?.[i],
      best,
      freq: data.freq[data.meta.services[service].window]?.[i],
    },
    standard,
  );
  const state = !counts ? 'is-reference' : meets ? 'is-met' : 'is-missed';
  const details = el('details', `service-row ${state}`);
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
  if (!counts) {
    details.append(el('p', 'service-reason', `Shown for comparison. A standard is met on foot, on a low-stress bike route or by public transport, so ${MODES[mode].short} never counts towards one.`));
  }
  if (counts && !meets && code in REASON_CLASS) {
    const group = REASON_GROUPS[REASON_CLASS[code]];
    details.append(el('p', 'service-reason', `${group.label}. ${group.fix}.`));
  }
  const grid = el('div', 'mode-grid');
  for (const m of DETAIL_MODES) {
    const t = timeFor(data, service, m, i, zones);
    grid.append(el('span', 'mode-name', MODES[m].label), el('span', 'mode-time', minutes(t)));
  }
  details.append(grid);
  const nearest = data.nearest[service]?.[i];
  if (nearest != null && fastest && data.destinations[nearest]?.name) {
    details.append(el('p', 'service-nearest', `Nearest by ${MODES[fastest].short}: ${data.destinations[nearest].name}`));
  }
  details.append(el('p', 'service-standard', `Standard: within ${standard} min. Straight-line distance ${metres((data.km[service]?.[i] ?? NaN) * 1000)}.`));
  return details;
}

export function renderPlace(root, data, i, state) {
  const placeIndex = data.place[i];
  const place = placeIndex != null ? data.places[placeIndex] : null;
  root.title.textContent = place ? place.name : 'Unnamed area';
  const bits = [];
  if (Number.isFinite(data.pop[i])) bits.push(`about ${count(data.pop[i])} residents in this hexagon`);
  if (place && place.board) bits.push(place.board);
  root.sub.textContent = bits.join(' · ');

  const viewMode = state.measure === 'score' ? 'best' : state.mode;
  const zones = state.measure === 'score' ? null : state.zonesNow ?? null;
  const services = SERVICE_ORDER.filter((s) => s !== 'jobs' && data.t[s]).map((s) =>
    serviceRow(data, i, s, state.standard[s] ?? data.meta.services[s].standard_minutes, viewMode, zones),
  );

  const jobs = [];
  for (const [mode, label] of [['pt', 'Public transport'], ['bike_low_stress', 'Low-stress cycling'], ['walk', 'Walking']]) {
    const share = data.jobs[mode]?.['45']?.[i];
    if (Number.isFinite(share)) {
      const total = data.meta.jobs.total;
      jobs.push(row(`${label}, 45 min`, `${share.toFixed(share < 10 ? 1 : 0)}% · about ${count((share / 100) * total)} jobs`));
    }
  }
  const fair = data.fair.pt?.['45']?.[i];
  if (Number.isFinite(fair)) jobs.push(row('Allowing for competition', `${fair.toFixed(2)}× the ${placeNames.name} average`));

  const windows = Object.keys(data.freq);
  const around = [
    row('Frequent stop', metres(data.mStop[i])),
    ...windows.map((w) => row(`Busiest stop within 800 m, ${w === 'am_peak' ? '7–9am' : '10am–12pm'}`, `${Math.round(data.freq[w][i] || 0)} departures an hour`)),
    row('Train or ferry', metres(data.mRail[i])),
    row('Low-stress bike route', metres(data.mBike[i])),
  ];

  // A share of a small hexagon is hard to picture, so say how many people
  // that is as well.
  const residents = data.pop[i];
  const group = (key, label) => {
    const share = data.shares[key]?.[i];
    if (!Number.isFinite(share)) return null;
    const heads = Number.isFinite(residents) ? ` · about ${count((share / 100) * residents)}` : '';
    return row(label, `${share}%${heads}`);
  };
  const labels = data.meta.groups || {};
  const people = [
    row('Neighbourhood deprivation', Number.isFinite(data.nzdep[i]) ? `NZDep ${data.nzdep[i]} of 10` : '–'),
    group('no_car', labels.no_car || 'Households without a car'),
    group('children', labels.children || 'Children under 15'),
    group('older', labels.older || 'Aged 65 and over'),
    group('low_income', labels.low_income || 'Households under $70,000'),
    group('maori', labels.maori || 'Māori'),
    group('pacific', labels.pacific || 'Pacific peoples'),
    group('disabled', labels.disabled || 'Disabled people'),
  ].filter(Boolean);
  if (Number.isFinite(data.drive[i])) people.push(row('Drove to work (this SA2, 2023)', `${data.drive[i]}%`));
  if (data.zone && data.zone[i]) around.unshift(row('Fare zone', data.zone[i]));

  // What the whole basket of opportunities is worth from here, and what the
  // cheapest way to each service costs.
  const scoreMode = state.measure === 'score' ? state.scoreMode : (state.mode && state.mode !== 'best' ? state.mode : 'pt');
  const scores = data.access[scoreMode]?.all;
  const standing = [];
  if (scores && Number.isFinite(scores[i])) {
    standing.push(row(`Access score by ${MODES[scoreMode].short}`, `${Math.round(scores[i])} · ${placeNames.name} average is 100`));
    const better = rankAmong(scores, data.pop, i);
    if (Number.isFinite(better)) standing.push(row('Better than', `${Math.round(better * 100)}% of residents`));
  }
  if (data.cost && data.meta.fares) {
    const cheapest = SERVICE_ORDER.filter((sv) => sv !== 'jobs' && data.cost[sv]).map((sv) => {
      const standard = state.standard[sv] ?? data.meta.services[sv].standard_minutes;
      const free = ['walk', 'bike_low_stress'].some((m) => {
        const t = data.t[sv]?.[m]?.[i];
        return Number.isFinite(t) && t <= standard;
      });
      if (free) return 0;
      for (let z = 1; z <= 4; z += 1) {
        const t = data.cost[sv][`z${z}`]?.[i];
        if (Number.isFinite(t) && t <= standard) return z;
      }
      return null;
    });
    const freeCount = cheapest.filter((z) => z === 0).length;
    const payable = cheapest.filter((z) => z && z > 0).length;
    const never = cheapest.filter((z) => z === null).length;
    standing.push(row('Everyday services reachable', `${freeCount} free on foot or by bike, ${payable} for a fare, ${never} not at all`));
  }

  let heading = viewMode === 'best'
    ? 'Everyday services, fastest without a car'
    : `Everyday services by ${MODES[viewMode].short}`;
  if (zones != null) heading += zones <= 0 ? ', no fare affordable' : `, within ${zones} fare ${zones === 1 ? 'zone' : 'zones'}`;
  root.body.replaceChildren(
    ...[
      section(heading, ...services),
      standing.length ? section('How this place stands', ...standing) : null,
      section('Jobs within reach', ...jobs),
      section('Around here', ...around),
      section('Who lives here', ...people, el('p', 'note', 'Census shares describe the surrounding block, not this hexagon alone. Ethnic groups overlap, so they do not add to the population.')),
    ].filter(Boolean),
  );
}
