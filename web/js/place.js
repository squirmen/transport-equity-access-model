// The place panel: everything TEAM knows about one hexagon.

import { bestMode } from './data.js';
import { diagnoseCell } from './diagnose.js';
import { count, el, metres, minutes, MODES } from './format.js';
import { SERVICE_ORDER, SERVICE_SHORT } from './panel.js';
import { REASON_CLASS, REASON_GROUPS } from './palette.js';

const DETAIL_MODES = ['walk', 'bike_low_stress', 'bike', 'pt', 'car'];

function row(label, value) {
  const line = el('div', 'kv');
  line.append(el('span', 'kv-key', label), el('span', 'kv-value', value));
  return line;
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
export function serviceVerdict(data, i, service, standard, viewMode) {
  const fastest = bestMode(data, service, i);
  const best = fastest ? data.t[service][fastest][i] : NaN;
  const mode = viewMode && viewMode !== 'best' ? viewMode : fastest;
  const shown = mode ? data.t[service][mode]?.[i] : NaN;
  const counts = mode ? data.meta.standard_modes.includes(mode) : false;
  const meets = counts && Number.isFinite(shown) && shown <= standard;
  return { fastest, best, mode, shown, counts, meets };
}

function serviceRow(data, i, service, standard, viewMode) {
  const { fastest, best, mode, shown, counts, meets } = serviceVerdict(data, i, service, standard, viewMode);
  const code = diagnoseCell(
    {
      km: data.km[service]?.[i],
      walk: data.t[service].walk?.[i],
      bikeLow: data.t[service].bike_low_stress?.[i],
      bike: data.t[service].bike?.[i],
      pt: data.t[service].pt?.[i],
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
  const time = el('span', 'service-time', mode ? `${minutes(shown)} · ${MODES[mode].short}` : 'over 60 min');
  summary.append(badge, what, time);
  details.append(summary);
  if (mode && mode !== fastest && Number.isFinite(best)) {
    const verdict = best <= standard ? `within the ${standard}-minute standard` : `still over ${standard} minutes`;
    details.append(
      el('p', 'service-reason', `Fastest without a car: ${MODES[fastest].short}, ${minutes(best)}, ${verdict}.`),
    );
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
    const t = data.t[service][m]?.[i];
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
  const services = SERVICE_ORDER.filter((s) => s !== 'jobs' && data.t[s]).map((s) =>
    serviceRow(data, i, s, state.standard[s] ?? data.meta.services[s].standard_minutes, viewMode),
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
  if (Number.isFinite(fair)) jobs.push(row('Allowing for competition', `${fair.toFixed(2)}× the Auckland average`));

  const windows = Object.keys(data.freq);
  const around = [
    row('Frequent stop', metres(data.mStop[i])),
    ...windows.map((w) => row(`Busiest stop within 800 m, ${w === 'am_peak' ? '7–9am' : '10am–12pm'}`, `${Math.round(data.freq[w][i] || 0)} departures an hour`)),
    row('Train or ferry', metres(data.mRail[i])),
    row('Low-stress bike route', metres(data.mBike[i])),
  ];

  const people = [
    row('Neighbourhood deprivation', Number.isFinite(data.nzdep[i]) ? `NZDep ${data.nzdep[i]} of 10` : '–'),
    row('Households without a car', Number.isFinite(data.shares.no_car[i]) ? `${data.shares.no_car[i]}%` : '–'),
    row('Children under 15', Number.isFinite(data.shares.children[i]) ? `${data.shares.children[i]}%` : '–'),
    row('Aged 65 and over', Number.isFinite(data.shares.older[i]) ? `${data.shares.older[i]}%` : '–'),
  ];
  if (Number.isFinite(data.drive[i])) people.push(row('Drove to work (this SA2, 2023)', `${data.drive[i]}%`));

  const heading = viewMode === 'best'
    ? 'Everyday services, fastest without a car'
    : `Everyday services by ${MODES[viewMode].short}`;
  root.body.replaceChildren(
    section(heading, ...services),
    section('Jobs within reach', ...jobs),
    section('Around here', ...around),
    section('Who lives here', ...people, el('p', 'note', 'Census shares describe the surrounding block, not this hexagon alone.')),
  );
}
