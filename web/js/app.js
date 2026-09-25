// TEAM web app: state, derived figures, map colours and panels.

import { renderAbout } from './about.js';
import {
  byQuintile, decileBands, load, loadOverlays, meetsFlags, peopleBelow, peopleByReason, rankPlaces,
  reasons as reasonCodes, times, weightedMedian, weightedShare,
} from './data.js';
import { affordableZones, budgetSentence, fareSteps, money, serviceHour, travellerSummary, ZONE_CAP } from './fares.js';
import { count, el, minutes, MODES } from './format.js';
import {
  BASEMAPS, cellCollection, createMap, fitPlace, onCells, OVERLAYS, paintCells, select, setBasemap,
  setCells, setOverlay, setOverlays, showDestinationsFor,
} from './map.js';
import {
  ACCESS, accessBreaks, classify, DECILE, FADED, FAIR, FAIR_BREAKS, JOBS, JOBS_BREAKS, PEOPLE, quartileBreaks,
  REASON_CLASS, REASON_GROUPS, REASON_PALETTE, SCORE, SCORE_BREAKS,
} from './palette.js';
import {
  renderAccess, renderFixes, renderJobsAccess, renderJobsFixes, renderJobsPeople, renderPeople,
  renderScore, renderServicePicker, renderTraveller, SERVICE_NOUN, SERVICE_ORDER, SERVICE_SHORT,
} from './panel.js';
import { renderPlace } from './place.js';

function dataBase() {
  // `?data=` accepts relative folders only, so a link cannot point the page at
  // someone else's figures. Used for the test fixture during development.
  const requested = new URLSearchParams(window.location.search).get('data');
  if (requested && /^(\.\.\/|[\w-]+\/)+$/.test(requested)) return requested;
  return window.TEAM_DATA_BASE || 'data/';
}

const DATA_BASE = dataBase();
const VIEWS = ['access', 'people', 'fixes'];
const GROUPS = ['everyone', 'no_car', 'children', 'older'];
const GROUP_NOUN = { everyone: 'people', no_car: 'people without a car', children: 'children', older: 'people 65+' };
const $ = (id) => document.getElementById(id);

const MEASURES = ['standards', 'score'];

const state = {
  measure: 'standards',
  scoreKey: 'all',
  scoreMode: 'pt',
  scoreDisplay: 'index',
  service: 'gp',
  view: 'access',
  mode: 'best',
  group: 'everyone',
  standard: {},
  jobsMode: 'pt',
  jobsLimit: '45',
  jobsFair: false,
  budget: null,
  profile: 'adult',
  payment: 'hop',
  returnTrip: true,
  zonesNow: null,
  basemap: 'light',
  overlays: {},
  reason: null,
  selected: null,
};

let data;
let map;
let current = null;
let frame = 0;
const cache = { best: new Map(), routed: new Map() };

// ---------------------------------------------------------------- state and URL

function standardFor(service) {
  return state.standard[service] ?? data.meta.services[service]?.standard_minutes ?? 20;
}

function readHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const service = params.get('s');
  if (SERVICE_ORDER.includes(service)) state.service = service;
  if (VIEWS.includes(params.get('v'))) state.view = params.get('v');
  if (MODES[params.get('m')]) state.mode = params.get('m');
  if (GROUPS.includes(params.get('g'))) state.group = params.get('g');
  if (BASEMAPS[params.get('b')]) state.basemap = params.get('b');
  const standard = Number(params.get('t'));
  if (standard >= 5 && standard <= 60 && state.service !== 'jobs') state.standard[state.service] = standard;
  if (MEASURES.includes(params.get('x'))) state.measure = params.get('x');
  const score = (params.get('a') || '').split('.');
  if (score[0]) state.scoreKey = score[0];
  if (score[1]) state.scoreMode = score[1];
  if (score[2] === 'd') state.scoreDisplay = 'decile';
  const cost = (params.get('c') || '').split('.');
  if (cost[0] !== undefined && cost[0] !== '') {
    const amount = Number(cost[0]);
    if (Number.isFinite(amount) && amount >= 0) state.budget = amount;
  }
  if (cost[1]) state.profile = cost[1];
  if (cost[2]) state.payment = cost[2] === 'cash' ? 'cash' : 'hop';
  if (cost[3]) state.returnTrip = cost[3] !== '1';
  const jobs = (params.get('j') || '').split('.');
  if (jobs[0]) state.jobsMode = jobs[0];
  if (jobs[1]) state.jobsLimit = jobs[1];
  state.jobsFair = jobs[2] === 'f';
  return params.get('at');
}

function hashNow() {
  const params = new URLSearchParams();
  if (state.measure !== 'standards') {
    params.set('x', state.measure);
    params.set('a', [state.scoreKey, state.scoreMode, state.scoreDisplay === 'decile' ? 'd' : ''].join('.'));
  }
  params.set('s', state.service);
  params.set('v', state.view);
  if (state.service === 'jobs') {
    params.set('j', [state.jobsMode, state.jobsLimit, state.jobsFair ? 'f' : ''].join('.'));
  } else {
    params.set('m', state.mode);
    params.set('t', String(standardFor(state.service)));
  }
  if (state.budget != null) {
    params.set('c', [state.budget, state.profile, state.payment, state.returnTrip ? 'r' : '1'].join('.'));
  }
  if (state.group !== 'everyone') params.set('g', state.group);
  if (state.basemap !== 'light') params.set('b', state.basemap);
  if (map) {
    const c = map.getCenter();
    params.set('at', `${map.getZoom().toFixed(1)}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`);
  }
  window.history.replaceState(null, '', `#${params.toString()}`);
}

let hashTimer = 0;
function writeHash() {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(hashNow, 250);
}

function set(patch) {
  if ('profile' in patch || 'payment' in patch || 'returnTrip' in patch || 'budget' in patch) cache.best.clear();
  if ('zoomTo' in patch) {
    const place = data.places[patch.zoomTo];
    if (place) fitPlace(map, place.bbox);
    return;
  }
  if ('service' in patch && patch.service !== state.service) state.reason = null;
  Object.assign(state, patch);
  schedule();
  writeHash();
}

function schedule() {
  window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(update);
}

// ---------------------------------------------------------------- derived figures

/** Fare zones this traveller can afford for a trip to `service`.
 *  Null when no budget is set, which leaves every measure as it was. */
function zonesFor(service) {
  if (state.budget == null || state.measure === 'score') return null;
  const meta = data.meta.fares;
  if (!meta || !meta.fares || !data.cost[service]) return null;
  return affordableZones(meta, { ...state, hour: serviceHour(data.meta, service) });
}

function bestTimes(service, zones) {
  const key = `${service}|${zones == null ? 'any' : zones}`;
  if (!cache.best.has(key)) cache.best.set(key, times(data, service, 'best', zones));
  return cache.best.get(key);
}

function routedMask(service) {
  if (!cache.routed.has(service)) {
    const modes = Object.values(data.t[service] || {});
    cache.routed.set(service, Uint8Array.from({ length: data.n }, (_, i) => (modes.some((t) => Number.isFinite(t[i])) ? 1 : 0)));
  }
  return cache.routed.get(service);
}

function placeName(i) {
  const p = data.place[i];
  return p != null && data.places[p] ? data.places[p].name : 'Unnamed area';
}

function accessModel() {
  const service = state.service;
  const standard = standardFor(service);
  const zones = state.zonesNow;
  const shown = times(data, service, state.mode, zones);
  const routed = routedMask(service);
  const edges = accessBreaks(standard);
  const classes = new Int8Array(data.n);
  for (let i = 0; i < data.n; i += 1) {
    const v = shown[i];
    classes[i] = Number.isFinite(v) ? classify(v, edges) : routed[i] ? 5 : -1;
  }
  const flags = meetsFlags(shown, standard);
  const labels = [
    `${edges[0]} or less`,
    `${edges[0]}–${edges[1]}`,
    `${edges[1]}–${standard}`,
    `${standard}–${edges[3]}`,
    edges[4] > edges[3] ? `${edges[3]}–${edges[4]}` : null,
    edges[4] >= 60 ? 'over 60' : `over ${edges[4]}`,
  ];
  const legend = labels.map((label, k) => (label ? { colour: ACCESS[k], label } : null)).filter(Boolean);
  return {
    classes,
    colours: ACCESS,
    tooltip: (i) => [`${SERVICE_SHORT[service]}: ${minutes(shown[i])} by ${MODES[state.mode].short}`, `Standard: within ${standard} min`],
    panel: {
      noun: SERVICE_NOUN[service],
      standard,
      mode: state.mode,
      zones,
      fare: fareClause(),
      share: weightedShare(flags, data.pop),
      below: peopleBelow(flags, data.pop),
      legend,
    },
  };
}

function peopleModel() {
  const service = state.service;
  const standard = standardFor(service);
  const flags = meetsFlags(bestTimes(service, state.zonesNow), standard);
  const weights = data.weights[state.group];
  const values = Float32Array.from(weights, (w, i) => (flags[i] ? 0 : w));
  const edges = quartileBreaks(values);
  const classes = Int8Array.from(values, (v) => (v > 0 ? classify(v, edges) : -1));
  const quintiles = byQuintile(data, flags, weights);
  const labels = ['Least deprived', 'NZDep 3–4', 'NZDep 5–6', 'NZDep 7–8', 'Most deprived'];
  return {
    classes,
    colours: PEOPLE,
    tooltip: (i) => [values[i] > 0 ? `About ${count(values[i])} ${GROUP_NOUN[state.group]} beyond ${standard} min` : `Within ${standard} min`],
    panel: {
      noun: SERVICE_NOUN[service],
      standard,
      group: state.group,
      fare: fareClause(),
      below: peopleBelow(flags, weights),
      q1: quintiles[0].share,
      q5: quintiles[4].share,
      byQuintile: quintiles.map((q, k) => ({ label: labels[k], value: q.share, emphasis: k === 4 })),
      byGroup: [
        ['everyone', 'Everyone'],
        ['no_car', 'No-car households'],
        ['children', 'Children under 15'],
        ['older', 'Aged 65 and over'],
      ].map(([g, label]) => ({ label, value: weightedShare(flags, data.weights[g]), emphasis: g === state.group })),
      legend: [
        { colour: PEOPLE[0], label: `${edges[0]} or fewer` },
        { colour: PEOPLE[1], label: `${edges[0]}–${edges[1]}` },
        { colour: PEOPLE[2], label: `${edges[1]}–${edges[2]}` },
        { colour: PEOPLE[3], label: `over ${edges[2]}` },
      ],
    },
  };
}

function fixesModel() {
  const service = state.service;
  const standard = standardFor(service);
  const best = bestTimes(service, state.zonesNow);
  const flags = meetsFlags(best, standard);
  const codes = reasonCodes(data, service, standard, best, state.zonesNow);
  const weights = data.weights[state.group];
  const classes = Int8Array.from(codes, (code) => {
    const cls = REASON_CLASS[code];
    if (cls == null) return -1;
    return state.reason != null && cls !== state.reason ? FADED : cls;
  });
  const byCode = peopleByReason(codes, weights);
  const reasons = REASON_GROUPS.map((g) => ({
    ...g,
    colour: REASON_PALETTE[g.cls],
    people: g.codes.reduce((sum, code) => sum + (byCode[code] || 0), 0),
  }));
  const ranked = rankPlaces(data, flags, codes, weights, 10).map((row) => {
    const byClass = {};
    for (const [code, people] of Object.entries(row.reasons)) {
      const cls = REASON_CLASS[code];
      if (cls != null) byClass[cls] = (byClass[cls] || 0) + people;
    }
    const [main] = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
    const cls = main ? Number(main[0]) : 3;
    const place = data.places[row.place];
    return { index: row.place, name: place ? place.name : 'Unnamed area', below: row.below, colour: REASON_PALETTE[cls], reasonLabel: REASON_GROUPS[cls].label };
  });
  return {
    classes,
    colours: REASON_PALETTE,
    tooltip: (i) => {
      const cls = REASON_CLASS[codes[i]];
      if (cls == null) return [codes[i] === 0 ? `Meets the ${standard}-min standard` : 'Not routed'];
      return [REASON_GROUPS[cls].label, REASON_GROUPS[cls].fix];
    },
    panel: { noun: SERVICE_NOUN[service], standard, group: state.group, fare: fareClause(), below: peopleBelow(flags, weights), reasons, ranked, focus: state.reason },
  };
}

function jobsChoice() {
  const modes = Object.keys(data.jobs);
  const mode = modes.includes(state.jobsMode) ? state.jobsMode : modes[0];
  const limits = Object.keys(data.jobs[mode]).map(Number).sort((a, b) => a - b);
  const limit = limits.includes(Number(state.jobsLimit)) ? Number(state.jobsLimit) : limits[limits.length - 1];
  const fairAvailable = Boolean(data.fair[mode] && data.fair[mode][String(limit)]);
  return { modes, mode, limits, limit, fairAvailable, fair: state.jobsFair && fairAvailable };
}

function palma(values, weights) {
  const idx = [];
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i]) && weights[i] > 0) idx.push(i);
  idx.sort((a, b) => values[a] - values[b]);
  const total = idx.reduce((s, i) => s + weights[i], 0);
  let running = 0;
  let low = 0;
  let lowW = 0;
  let high = 0;
  let highW = 0;
  for (const i of idx) {
    running += weights[i];
    const share = running / total;
    if (share <= 0.4) { low += values[i] * weights[i]; lowW += weights[i]; }
    if (share > 0.9) { high += values[i] * weights[i]; highW += weights[i]; }
  }
  return lowW > 0 && low > 0 && highW > 0 ? high / highW / (low / lowW) : NaN;
}

function jobsModel() {
  const choice = jobsChoice();
  const zones = state.zonesNow;
  // A budget only changes public transport, and the priced layer is built at
  // the gravity cap rather than the job thresholds, so it replaces the values
  // and says so rather than pretending the threshold still applies.
  const priced = zones != null && choice.mode === 'pt' && data.cost.jobs
    ? (zones <= 0 ? new Float32Array(data.n).fill(0) : data.cost.jobs[`z${Math.min(zones, ZONE_CAP)}`])
    : null;
  const values = priced || (choice.fair ? data.fair[choice.mode][String(choice.limit)] : data.jobs[choice.mode][String(choice.limit)]);
  const edges = choice.fair ? FAIR_BREAKS : JOBS_BREAKS;
  const classes = Int8Array.from(values, (v) => (Number.isFinite(v) ? classify(v, edges) : -1));
  const legend = choice.fair
    ? ['under 0.5×', '0.5–0.8×', '0.8–1.25×', '1.25–2×', 'over 2×'].map((label, k) => ({ colour: FAIR[k], label }))
    : ['2% or less', '2–5%', '5–10%', '10–25%', 'over 25%'].map((label, k) => ({ colour: JOBS[k], label }));
  const share = priced || data.jobs[choice.mode][String(choice.limit)];
  const quintileLabels = ['Least deprived', 'NZDep 3–4', 'NZDep 5–6', 'NZDep 7–8', 'Most deprived'];
  const byQ = [1, 2, 3, 4, 5].map((q, k) => ({
    label: quintileLabels[k],
    value: weightedMedian(share, data.pop, Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0))),
    emphasis: k === 4,
  }));
  const byGroup = [['everyone', 'Everyone'], ['no_car', 'No-car households'], ['children', 'Children under 15'], ['older', 'Aged 65 and over']]
    .map(([g, label]) => ({ label, value: weightedMedian(share, data.weights[g]) }));
  const max = Math.max(...byQ.map((r) => r.value || 0), ...byGroup.map((r) => r.value || 0)) * 1.1 || 1;
  return {
    classes,
    colours: choice.fair ? FAIR : JOBS,
    tooltip: (i) => [choice.fair
      ? `${Number.isFinite(values[i]) ? values[i].toFixed(2) : '–'}× the Auckland average`
      : `${Number.isFinite(values[i]) ? values[i].toFixed(1) : '–'}% of Auckland's jobs within ${choice.limit} min`],
    panel: {
      ...choice,
      priced: Boolean(priced),
      zones,
      fare: fareClause(),
      limit: priced ? (data.meta.fares.max_minutes || choice.limit) : choice.limit,
      median: weightedMedian(values, data.pop),
      legend,
      byQuintile: byQ,
      byGroup,
      max,
      palma: palma(share, data.pop),
    },
  };
}

function scoreChoice() {
  const meta = data.meta.access || {};
  const available = (meta.modes || []).filter((m) => data.access[m] && Object.keys(data.access[m]).length);
  const mode = available.includes(state.scoreMode) ? state.scoreMode : available[0];
  const keys = mode ? Object.keys(data.access[mode]) : [];
  const key = keys.includes(state.scoreKey) ? state.scoreKey : keys[keys.length - 1];
  return { available, mode, keys, key, display: state.scoreDisplay === 'decile' ? 'decile' : 'index' };
}

function scoreModel() {
  const choice = scoreChoice();
  const meta = data.meta.access || {};
  // An older cells.json has no scores in it. Fall back rather than fail: a
  // stale file in a browser cache should cost a feature, not the whole page.
  if (!choice.mode || !choice.key || !data.access[choice.mode]?.[choice.key]) return null;
  const values = data.access[choice.mode][choice.key];
  const bands = decileBands(values, data.pop);
  const decile = choice.display === 'decile';
  const classes = decile
    ? Int8Array.from(bands)
    : Int8Array.from(values, (v) => (Number.isFinite(v) ? classify(v, SCORE_BREAKS) : -1));
  const legend = decile
    ? DECILE.map((colour, k) => ({ colour, label: k === 0 ? '1' : k === 9 ? '10' : String(k + 1) }))
    : ['under 25', '25–50', '50–100', '100–200', '200–400', 'over 400'].map((label, k) => ({ colour: SCORE[k], label }));
  const quintileLabels = ['Least deprived', 'NZDep 3–4', 'NZDep 5–6', 'NZDep 7–8', 'Most deprived'];
  const keyLabels = meta.keys || {};
  const cap = meta.max_minutes || 45;
  return {
    classes,
    colours: decile ? DECILE : SCORE,
    tooltip: (i) => [
      Number.isFinite(values[i])
        ? `${keyLabels[choice.key] || choice.key} by ${MODES[choice.mode].short}: score ${Math.round(values[i])}`
        : 'No score here',
      Number.isFinite(values[i]) ? `Decile ${bands[i] + 1} of 10; Auckland average is 100` : '',
    ].filter(Boolean),
    panel: {
      key: choice.key,
      mode: choice.mode,
      display: choice.display,
      keys: choice.keys.map((k) => [k, keyLabels[k] || k]),
      modes: choice.available.map((m) => [m, (meta.beta_modes || []).includes(m) ? `${MODES[m].label} (beta)` : MODES[m].label]),
      median: weightedMedian(values, data.pop),
      palma: palma(values, data.pop),
      legend,
      byQuintile: [1, 2, 3, 4, 5].map((q, k) => ({
        label: quintileLabels[k],
        value: weightedMedian(values, data.pop, Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0))),
        emphasis: k === 4,
      })),
      note: `Every opportunity within ${cap} minutes counts, discounted by how long it takes to reach. `
        + 'The curves for walking and public transport are those Transport for NSW published for TAI-PT, fitted to '
        + 'the New South Wales Household Travel Survey. Cycling is beta: it uses the Propensity to Cycle Tool\'s '
        + 'distance decay, because no local curve exists yet. Both are starting points, not Auckland calibrations.',
    },
  };
}

function scoreAvailable() {
  const choice = scoreChoice();
  return Boolean(choice.mode && choice.key && data.access[choice.mode]?.[choice.key]);
}

/** The fare clause for a sentence, or an empty string when no budget is set. */
function fareClause() {
  if (state.budget == null || state.measure === 'score') return '';
  return ` for ${money(state.budget)}${state.returnTrip ? ' return' : ' one way'}`;
}

function compute() {
  state.zonesNow = zonesFor(state.service);
  if (state.measure === 'score') {
    const model = scoreModel();
    if (model) return model;
    state.measure = 'standards';
  }
  if (state.service === 'jobs') return jobsModel();
  if (state.view === 'people') return peopleModel();
  if (state.view === 'fixes') return fixesModel();
  return accessModel();
}

// ---------------------------------------------------------------- rendering

function renderStandard() {
  const field = $('standard-field');
  const jobs = state.service === 'jobs' || state.measure === 'score';
  field.hidden = jobs;
  if (jobs) return;
  const value = standardFor(state.service);
  const fallback = data.meta.services[state.service].standard_minutes;
  $('standard').value = String(value);
  $('standard-value').textContent = `within ${value} min`;
  const reset = $('standard-reset');
  reset.hidden = value === fallback;
  reset.textContent = `Reset to ${fallback}`;
}

function fareAvailable() {
  const meta = data.meta.fares;
  return Boolean(meta && meta.fares && Object.keys(data.cost || {}).length);
}

function renderBudget() {
  const field = $('budget-field');
  const hide = state.measure === 'score' || !fareAvailable();
  field.hidden = hide;
  if (hide) return;
  const meta = data.meta.fares;
  const spec = meta.budget || {};
  const max = Number(spec.max ?? 20);
  const slider = $('budget');
  slider.min = String(spec.min ?? 0);
  slider.max = String(max);
  slider.step = String(spec.step ?? 0.5);
  slider.value = String(state.budget == null ? max : state.budget);
  $('budget-value').textContent = state.budget == null
    ? 'any fare'
    : `${money(state.budget)} ${state.returnTrip ? 'return' : 'one way'}`;
  const reset = $('budget-reset');
  reset.hidden = state.budget == null;
  $('budget-note').textContent = budgetSentence(meta, state, serviceHour(data.meta, state.service));

  // Ticks sit where each extra zone starts costing, and move when the
  // traveller changes, which is the clearest way to show that a concession
  // changes what money buys.
  const ticks = $('budget-ticks');
  const steps = fareSteps(meta, state).filter((step) => step.cost <= max);
  ticks.replaceChildren(
    ...steps.map((step) => {
      const tick = el('span', 'tick', String(step.zones));
      tick.style.left = `${(step.cost / max) * 100}%`;
      tick.title = `${step.zones} ${step.zones === 1 ? 'zone' : 'zones'}: ${money(step.cost)}`;
      return tick;
    }),
  );
}

function renderTravellerLine() {
  const box = $('traveller');
  const hide = state.measure === 'score' || !fareAvailable();
  box.hidden = hide;
  if (hide) return;
  const hour = serviceHour(data.meta, state.service);
  $('traveller-summary').textContent = travellerSummary(data.meta.fares, state, hour);
  const clock = Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}:00` : 'the modelled window';
  renderTraveller($('traveller-body'), {
    profiles: data.meta.fares.profiles || [],
    profile: state.profile,
    payment: state.payment,
    returnTrip: state.returnTrip,
    timeNote: `Trips to ${SERVICE_SHORT[state.service].toLowerCase()} are timed from ${clock} on a weekday, `
      + 'which is when the timetable was routed. That is why a SuperGold fare is free for some trips and not others.',
  }, set);
}

function renderView(model) {
  const score = state.measure === 'score';
  for (const button of document.querySelectorAll('#measure-picker button')) {
    button.setAttribute('aria-checked', String(button.dataset.measure === state.measure));
    if (button.dataset.measure === 'score') button.hidden = !scoreAvailable();
  }
  $('service-field').hidden = score;
  $('tabs').hidden = score;
  if (score) {
    renderScore($('view'), model.panel, set);
    return;
  }
  renderServicePicker($('service-picker'), state.service, set);
  for (const tab of document.querySelectorAll('[role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
  const root = $('view');
  if (state.service === 'jobs') {
    if (state.view === 'access') renderJobsAccess(root, model.panel, set);
    else if (state.view === 'people') renderJobsPeople(root, model.panel);
    else renderJobsFixes(root);
    return;
  }
  if (state.view === 'access') renderAccess(root, model.panel, set);
  else if (state.view === 'people') renderPeople(root, model.panel, set);
  else renderFixes(root, model.panel, set);
}

function renderMini() {
  // One line shown in the header when the panel is folded away (and on phones at first).
  const mini = $('mini');
  if (state.measure === 'score' && scoreAvailable()) {
    const choice = scoreChoice();
    const median = weightedMedian(data.access[choice.mode][choice.key], data.pop);
    const label = (data.meta.access.keys || {})[choice.key] || choice.key;
    mini.textContent = `${label} by ${MODES[choice.mode].short} · typical score ${Math.round(median)} of 100`;
    return;
  }
  if (state.service === 'jobs') {
    const choice = jobsChoice();
    const median = weightedMedian(data.jobs[choice.mode][String(choice.limit)], data.pop);
    const figure = Number.isFinite(median) ? median.toFixed(median < 10 ? 1 : 0) : '–';
    mini.textContent = `Jobs · typical resident reaches ${figure}% within ${choice.limit} min`;
    return;
  }
  const standard = standardFor(state.service);
  const share = weightedShare(meetsFlags(bestTimes(state.service, state.zonesNow), standard), data.pop);
  mini.textContent = `${SERVICE_SHORT[state.service]} · ${Math.round(share * 100)}% within ${standard} min without a car${fareClause()}`;
}

function update() {
  const t0 = performance.now();
  current = compute();
  const t1 = performance.now();
  // The panel is worth drawing even when the basemap has not arrived.
  try {
    paintCells(map, current.classes, current.colours);
  } catch (error) {
    console.warn('The map is not ready to paint yet.', error);
  }
  const t2 = performance.now();
  renderStandard();
  renderBudget();
  renderTravellerLine();
  renderView(current);
  renderMini();
  window.team.timing = { compute: Math.round(t1 - t0), paint: Math.round(t2 - t1), panel: Math.round(performance.now() - t2) };
  try {
    showDestinationsFor(map, state.service === 'jobs' || state.measure === 'score' ? null : state.service);
  } catch (error) {
    console.warn('Destination pins are not ready yet.', error);
  }
  if (state.selected != null) showPlace(state.selected);
}

function showPlace(i) {
  $('place').hidden = false;
  document.body.dataset.place = 'open';
  renderPlace({ title: $('place-title'), sub: $('place-sub'), body: $('place-body') }, data, i, state);
}

function closePlace() {
  select(map, state.selected, null);
  state.selected = null;
  $('place').hidden = true;
  delete document.body.dataset.place;
}

// ---------------------------------------------------------------- wiring

function wireControls() {
  for (const button of document.querySelectorAll('#measure-picker button')) {
    button.addEventListener('click', () => set({ measure: button.dataset.measure }));
  }
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => set({ view: tab.dataset.view }));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = (VIEWS.indexOf(state.view) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      set({ view: VIEWS[next] });
      document.querySelector(`[data-view="${VIEWS[next]}"]`).focus();
    });
  }
  $('standard').addEventListener('input', (event) => {
    state.standard[state.service] = Number(event.target.value);
    $('standard-value').textContent = `within ${event.target.value} min`;
    schedule();
    writeHash();
  });
  $('budget').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    const max = Number(event.target.max);
    // The top of the slider means no limit, which is true as well as simple:
    // it is already more than the dearest return fare.
    state.budget = value >= max ? null : value;
    cache.best.clear();
    schedule();
    writeHash();
  });
  $('budget-reset').addEventListener('click', () => {
    state.budget = null;
    cache.best.clear();
    schedule();
    writeHash();
  });
  $('standard-reset').addEventListener('click', () => {
    delete state.standard[state.service];
    schedule();
    writeHash();
  });
  $('place-close').addEventListener('click', closePlace);
  $('share').addEventListener('click', async () => {
    hashNow();
    const button = $('share');
    try {
      await navigator.clipboard.writeText(window.location.href);
      button.textContent = 'Link copied';
    } catch {
      button.textContent = 'Copy the address bar';
    }
    window.setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
  });
  $('about-open').addEventListener('click', () => {
    renderAbout($('about-body'), data.meta);
    $('about').showModal();
  });
  $('panel-toggle').addEventListener('click', () => {
    const collapsed = document.body.dataset.panel === 'collapsed';
    if (collapsed) delete document.body.dataset.panel;
    else document.body.dataset.panel = 'collapsed';
    $('panel-toggle').setAttribute('aria-expanded', String(collapsed));
    $('panel-toggle').setAttribute('aria-label', collapsed ? 'Hide controls' : 'Show controls');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected != null && !$('about').open) closePlace();
  });

  const basemaps = $('basemaps');
  for (const [key, spec] of Object.entries(BASEMAPS)) {
    const button = el('button', null, spec.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(key === state.basemap));
    button.addEventListener('click', () => {
      state.basemap = key;
      setBasemap(map, key);
      for (const b of basemaps.children) b.setAttribute('aria-pressed', String(b === button));
      writeHash();
    });
    basemaps.append(button);
  }
  const layers = $('layer-list');
  for (const [key, spec] of Object.entries(OVERLAYS)) {
    const label = el('label', 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => setOverlay(map, key, box.checked));
    label.append(box, document.createTextNode(` ${spec.label}`));
    layers.append(label);
  }

  const tooltip = $('tooltip');
  onCells(map, {
    hover(i, point) {
      if (!current) return;
      tooltip.replaceChildren(el('strong', null, placeName(i)), ...current.tooltip(i).map((line) => el('span', null, line)));
      tooltip.hidden = false;
      // Keep the tooltip clear of the place panel and the window edge.
      const room = window.innerWidth - ($('place').hidden ? 0 : 360);
      const x = Math.round(point.x + 14);
      const y = Math.round(point.y + 14);
      tooltip.style.transform = point.x + 300 > room
        ? `translate(${Math.round(point.x - 14)}px, ${y}px) translateX(-100%)`
        : `translate(${x}px, ${y}px)`;
    },
    leave() {
      tooltip.hidden = true;
    },
    click(i) {
      select(map, state.selected, i);
      state.selected = i;
      showPlace(i);
    },
  });
  map.on('moveend', writeHash);
}

function wireSearch() {
  const input = $('search');
  const list = $('search-results');
  const names = data.places.map((p, i) => ({ i, name: p.name, board: p.board, key: p.name.toLowerCase() }));
  let hits = [];
  let active = -1;
  const hide = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const choose = (hit) => {
    input.value = hit.name;
    fitPlace(map, data.places[hit.i].bbox);
    hide();
  };
  const render = () => {
    list.replaceChildren(
      ...hits.map((hit, k) => {
        const item = el('li', k === active ? 'is-active' : null);
        item.setAttribute('role', 'option');
        item.append(el('span', null, hit.name), el('span', 'search-board', hit.board || ''));
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(hit);
        });
        return item;
      }),
    );
    list.hidden = hits.length === 0;
    input.setAttribute('aria-expanded', String(hits.length > 0));
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    hits = q.length < 2 ? [] : names.filter((n) => n.key.includes(q)).sort((a, b) => a.key.indexOf(q) - b.key.indexOf(q)).slice(0, 8);
    active = hits.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && hits.length) { active = (active + 1) % hits.length; render(); event.preventDefault(); }
    if (event.key === 'ArrowUp' && hits.length) { active = (active - 1 + hits.length) % hits.length; render(); event.preventDefault(); }
    if (event.key === 'Enter' && active >= 0) choose(hits[active]);
    if (event.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => window.setTimeout(hide, 120));
}

async function init() {
  const at = readHash();
  map = createMap('map');
  // Exposed for browser tests and scripted tours.
  window.team = { map, state };
  // Start once the style is ready. The 'load' event also waits for every basemap
  // tile, which would hold up the whole app on a slow connection.
  //
  // The basemap comes from someone else's server, so it can be slow or fail
  // outright. The figures are all local, so they should not wait on it: after
  // a few seconds the panel is drawn anyway and the hexagons are added
  // whenever the style turns up.
  let styleReady = false;
  const ready = new Promise((resolve) => {
    map.once('style.load', () => { styleReady = true; resolve(); });
    window.setTimeout(resolve, 6000);
  });
  try {
    data = await load(DATA_BASE);
  } catch (error) {
    $('loading').textContent = 'The data could not be loaded. If you opened this file directly, serve the folder over HTTP instead.';
    throw error;
  }
  await ready;
  const addLayers = () => {
    setCells(map, cellCollection(data.h3));
    setOverlays(map, {}, data.destinations);
    setBasemap(map, state.basemap);
  };
  if (styleReady) {
    addLayers();
  } else {
    console.warn('The basemap is slow to load. Showing the figures now and the map when it arrives.');
    map.once('style.load', () => {
      addLayers();
      update();
    });
  }
  wireControls();
  wireSearch();
  const date = new Date(`${data.meta.routing_date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  $('build-note').textContent = `Timetable ${date} · Census 2023 · v${data.meta.version}`;
  const phone = window.matchMedia('(max-width: 760px)').matches;
  if (phone) {
    // Phones open on the map, with the controls folded into one bar.
    document.body.dataset.panel = 'collapsed';
    $('panel-toggle').setAttribute('aria-expanded', 'false');
    $('panel-toggle').setAttribute('aria-label', 'Show controls');
  }
  update();
  if (at) {
    const [zoom, lat, lng] = at.split('/').map(Number);
    if ([zoom, lat, lng].every(Number.isFinite)) map.jumpTo({ center: [lng, lat], zoom });
  } else {
    const padding = phone ? { top: 120, bottom: 110, left: 16, right: 16 } : { top: 30, bottom: 30, left: 390, right: 30 };
    map.fitBounds([[174.6, -37.08], [174.95, -36.72]], { padding, duration: 0 });
  }
  $('loading').hidden = true;
  // Network lines only show when a layer is switched on, so they load after the first view.
  loadOverlays(DATA_BASE)
    .then((overlays) => setOverlays(map, overlays, data.destinations))
    .catch((error) => console.warn('Network layers could not be loaded.', error));
}

init();
