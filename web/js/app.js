// TEAM web app: state, derived figures, map colours and panels.

import { renderAbout } from './about.js';
import {
  byQuintile, decileBands, load, loadOverlays, meetsFlags, peopleBelow, peopleByReason, pricedLayer, rankPlaces,
  choiceWithin, reasons as reasonCodes, setUrban, setWindow, times, tripTime, USUAL, weightedMedian, weightedShare,
  windowOf, windowsFor,
} from './data.js';
import {
  byGroup as shortfallByGroup, concentrationIndex, fgt, leaning, pricedOut, shortfallLeaning, shortfalls,
} from './equity.js';
import {
  affordableZones, budgetSentence, burdenClass, cheapestFareClasses, cheapestZones, dailyIncome, fare,
  fareClassCosts, fareSteps, freeTravel, hasCaps, incomeZones, money, paymentKey, payments, travellerSummary,
  weekCost, zoneCap,
} from './fares.js';
import { count, el, minutes, MODES, place } from './format.js';
import {
  BASEMAPS, cellCollection, createMap, fitPlace, onCells, onPoints, OVERLAYS, paintCells, select, setBasemap,
  setCells, setOverlay, setOverlays, showDestinationsFor,
} from './map.js';
import {
  ACCESS, accessBreaks, classify, DECILE, FADED, FAIR, FAIR_BREAKS, FARE, JOBS, JOBS_BREAKS,
  PEOPLE, quartileBreaks, REASON_CLASS, REASON_GROUPS, REASON_PALETTE, SCORE, SCORE_BREAKS,
} from './palette.js';
import {
  renderAccess, renderFareSurface, renderFixes, renderJobsAccess, renderJobsFixes, renderJobsPeople,
  renderBurden, renderChips, renderChoice, renderPeople, renderScore, renderServicePicker, renderTraveller, renderWhenPicker, SERVICE_NOUN,
  SERVICE_ORDER, SERVICE_SHORT, setServices,
} from './panel.js';
import { areaCsv, areaTable, sortAreas } from './areas.js';
import { nearestCity } from './cities.js';
import { renderPlace } from './place.js';

function dataBase() {
  // `?data=` accepts relative folders only, so a link cannot point the page at
  // someone else's figures. Used for the test fixture during development.
  const requested = new URLSearchParams(window.location.search).get('data');
  if (requested && /^(\.\.\/|[\w-]+\/)+$/.test(requested)) return requested;
  return window.TEAM_DATA_BASE || 'data/';
}

/** The city being shown, from the address bar. Nothing means the opening view. */
function requestedCity() {
  const asked = new URLSearchParams(window.location.search).get('city');
  return asked && /^[a-z][a-z0-9_-]*$/.test(asked) ? asked : null;
}

// The last city a visitor looked at, so a return visit goes straight back to
// it instead of asking again. Kept in this browser only. Storage can be
// blocked or cleared, in which case the opening view simply shows as before.
const REMEMBER = 'team.city';

function rememberCity(slug) {
  try {
    window.localStorage.setItem(REMEMBER, slug);
  } catch {
    // nothing to do: the next visit asks again
  }
}

function rememberedCity() {
  try {
    const slug = window.localStorage.getItem(REMEMBER);
    return slug && /^[a-z][a-z0-9_-]*$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/** Asked for the list of places on purpose, from the place picker. */
const WANTS_LIST = new URLSearchParams(window.location.search).has('places');

function goToList() {
  const url = new URL(window.location.href);
  url.search = '?places';
  url.hash = '';
  window.location.assign(url.toString());
}

/** Switching city reloads the page. A city is a megabyte and a half of its own
 *  data and its own map layers, so starting cleanly beats unpicking the old
 *  one, and it keeps the address bar honest about what is on screen. */
function goToCity(slug) {
  const url = new URL(window.location.href);
  url.searchParams.delete('places');
  url.searchParams.set('city', slug);
  url.hash = '';
  window.location.assign(url.toString());
}

const DATA_BASE = dataBase();
const CITY = requestedCity();
const VIEWS = ['access', 'people', 'fixes'];
// Which groups exist depends on the census tables the build had, so they come
// from the data rather than being listed here.
const GROUP_NOUN = {
  everyone: 'people',
  no_car: 'people without a car',
  children: 'children',
  older: 'people 65+',
  low_income: 'people on lower household incomes',
  maori: 'Māori',
  pacific: 'Pacific peoples',
  asian: 'Asian residents',
  disabled: 'disabled people',
};
const groupKeys = () => Object.keys(data.meta.groups || { everyone: 'Everyone' });
const groupChips = () => groupKeys().map((g) => [g, (data.meta.groups || {})[g] || g]);
const $ = (id) => document.getElementById(id);

const MEASURES = ['standards', 'score'];
const INCOME_MAX = 15;
const INCOME_DEFAULT = 5;

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
  // 'dollars' for one budget for everyone, 'income' for a share of a day's
  // income in each area, so the same slider asks what a low income buys.
  budgetUnit: 'dollars',
  when: null,
  profile: 'adult',
  payment: 'hop',
  returnTrip: true,
  show: 'minutes',
  zonesNow: null,
  basemap: 'light',
  overlays: {},
  reason: null,
  selected: null,
  // The fare burden of one return trip, or of a return trip every day for a
  // week after the network's daily and weekly caps.
  basket: 'trip',
  // Count only people in urban areas of 1,000 or more.
  urbanOnly: false,
  areaLevel: 'sa2',
  areaSort: 'missing',
  areaAll: false,
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
  const group = params.get('g');
  if (group) state.group = group;
  if (BASEMAPS[params.get('b')]) state.basemap = params.get('b');
  const standard = Number(params.get('t'));
  if (standard >= 5 && standard <= 60 && state.service !== 'jobs') state.standard[state.service] = standard;
  if (MEASURES.includes(params.get('x'))) state.measure = params.get('x');
  const score = (params.get('a') || '').split('.');
  if (score[0]) state.scoreKey = score[0];
  if (score[1]) state.scoreMode = score[1];
  if (score[2] === 'd') state.scoreDisplay = 'decile';
  if (['fare', 'burden', 'choice'].includes(params.get('w'))) state.show = params.get('w');
  const cost = (params.get('c') || '').split('.');
  if (cost[0] !== undefined && cost[0] !== '') {
    const amount = Number(cost[0]);
    if (Number.isFinite(amount) && amount >= 0) state.budget = amount;
  }
  if (cost[1]) state.profile = cost[1];
  if (cost[2]) state.payment = cost[2] === 'cash' ? 'cash' : 'hop';
  if (cost[3]) state.returnTrip = cost[3] !== '1';
  if (cost[4] === 'i') state.budgetUnit = 'income';
  if (params.get('u') === '1') state.urbanOnly = true;
  const when = params.get('h');
  if (when && /^[a-z_]+$/.test(when)) state.when = when;
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
  if (state.show !== 'minutes') params.set('w', state.show);
  // The traveller changes what the cost and burden views show even with no
  // budget, so it travels with the link whenever it is not the default.
  const defaultPayment = (payments(data.meta.fares || {})[0] || [])[0];
  const traveller = state.profile !== 'adult' || (defaultPayment && state.payment !== defaultPayment) || !state.returnTrip;
  if (state.budget != null || traveller || state.budgetUnit === 'income') {
    params.set('c', [state.budget ?? '', state.profile, state.payment, state.returnTrip ? 'r' : '1', state.budgetUnit === 'income' ? 'i' : ''].join('.'));
  }
  if (state.when) params.set('h', state.when);
  if (state.urbanOnly) params.set('u', '1');
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
  if ('profile' in patch || 'payment' in patch || 'returnTrip' in patch || 'budget' in patch || 'budgetUnit' in patch) {
    cache.best.clear();
  }
  if ('urbanOnly' in patch && patch.urbanOnly !== state.urbanOnly) setUrban(data, patch.urbanOnly);
  if ('when' in patch && patch.when !== state.when) {
    setWindow(data, patch.when);
    cache.best.clear();
    cache.routed.clear();
  }
  if ('zoomTo' in patch) {
    const place = data.places[patch.zoomTo];
    if (place) fitPlace(map, place.bbox);
    return;
  }
  if ('zoomBoard' in patch) {
    const box = boardBox(patch.zoomBoard);
    if (box) fitPlace(map, box);
    return;
  }
  if ('download' in patch) {
    downloadAreas();
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

/** What the map is about right now, for choosing a time window: a service,
 *  'jobs', or an access score. */
function subject() {
  if (state.measure === 'score') return `score:${scoreChoice().key}`;
  return state.service;
}

/** Whether public transport is part of what is on screen, which is the only
 *  thing the time of day changes. */
function transitShown() {
  if (state.measure === 'score') return scoreChoice().mode === 'pt';
  if (state.service === 'jobs') return jobsChoice().mode === 'pt';
  return state.view !== 'access' || state.mode === 'best' || state.mode === 'pt';
}

/** The window a trip for `thing` is timed in, and when that is. */
function tripWindow(thing = subject()) {
  const window = windowOf(data, thing, state.when);
  return { window, ...tripTime(data, window), spec: (data.meta.windows || {})[window] || {} };
}

/** ", on a Saturday" when the time on screen is not the usual one for what is
 *  being looked at, and nothing otherwise. */
function whenClause(thing = subject()) {
  const { window, spec } = tripWindow(thing);
  if (!window || window === windowsFor(data, thing)[0] || !spec.phrase) return '';
  return `, ${spec.phrase}`;
}

/** Whether this build has the income behind the fare burden. */
function incomeAvailable() {
  return Boolean(data.income && data.meta.affordability && data.meta.affordability.median_income);
}

function byIncome() {
  return state.budgetUnit === 'income' && incomeAvailable();
}

let daily = null;
const incomeCache = new Map();

/** Fare zones this traveller can afford for a trip to `service`.
 *
 *  Null when no budget is set, which leaves every measure as it was. With a
 *  dollar budget it is one number for everyone. With a budget as a share of
 *  income it is one number per hexagon, because the same share of a lower
 *  income buys fewer zones.
 */
function zonesFor(service) {
  if (state.budget == null || state.measure === 'score') return null;
  const meta = data.meta.fares;
  if (!meta || !meta.fares || !data.cost[service]) return null;
  const { hour, weekday } = tripWindow(service);
  if (!byIncome()) {
    // A budget that buys the whole network is no constraint at all. The priced
    // layers stop at 45 minutes, so treating it as one would lose access.
    const zones = affordableZones(meta, { ...state, hour, weekday });
    return zones >= zoneCap(meta) ? null : zones;
  }
  daily = daily || dailyIncome(data);
  const key = [state.budget, state.profile, state.payment, state.returnTrip, hour, weekday].join('|');
  if (!incomeCache.has(key)) incomeCache.set(key, incomeZones(meta, daily, state.budget, { ...state, hour, weekday }));
  return incomeCache.get(key);
}

/** Share of jobs reachable by public transport within the zones each place
 *  can afford: none where no fare is affordable. */
function pricedJobs(zones) {
  if (typeof zones === 'number') {
    return zones <= 0 ? new Float32Array(data.n).fill(0) : data.cost.jobs[`z${Math.min(zones, zoneCap(data.meta.fares))}`];
  }
  const layer = pricedLayer(data, 'jobs', zones);
  const cap = zoneCap(data.meta.fares);
  const full = data.jobs.pt?.['45'];
  return Float32Array.from(layer, (v, i) => (zones[i] >= cap && full ? full[i] : zones[i] > 0 ? v : 0));
}

/** The line under a figure saying what a per-area budget is doing. */
function fareNote(zones) {
  if (zones == null || typeof zones === 'number') return null;
  return `Each area can spend ${percentText(state.budget)} of a day's income on the trip, `
    + 'so the same budget buys more zones where incomes are higher.';
}

/** A cache key for a zone limit, which may be one number or one per hexagon. */
function zonesKey(zones) {
  if (zones == null) return 'any';
  if (typeof zones === 'number') return String(zones);
  return `inc:${state.budget}|${state.profile}|${state.payment}|${state.returnTrip}|${state.when}`;
}

function bestTimes(service, zones) {
  const key = `${service}|${zonesKey(zones)}`;
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

/** Where to open the map: around the people, not around the whole region.
 *
 *  Taken from the middle 98% of residents so one remote settlement cannot
 *  pull the first view out to sea.
 */
function regionBounds() {
  const lons = [];
  const lats = [];
  for (const spot of data.places) {
    if (!spot || !spot.bbox) continue;
    lons.push(spot.lon);
    lats.push(spot.lat);
  }
  if (!lons.length) return [[174.6, -37.08], [174.95, -36.72]];
  const span = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * 0.01);
    return [sorted[cut], sorted[sorted.length - 1 - cut]];
  };
  const [west, east] = span(lons);
  const [south, north] = span(lats);
  return [[west, south], [east, north]];
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
      fareNote: fareNote(zones),
      canShowFare: fareAvailable() && Boolean(data.cost[service]),
      canShowBurden: fareAvailable() && Boolean(data.cost[service]) && incomeAvailable(),
      standardModes: data.meta.standard_modes,
      fare: fareClause(),
      share: weightedShare(flags, data.pop),
      below: peopleBelow(flags, data.pop),
      compare: compareNote(service, state.mode, standard, weightedShare(flags, data.pop)),
      robust: state.mode === 'best' ? robustModel(service, standard) : null,
      canShowChoice: Boolean(data.choice[service]),
      legend,
    },
  };
}

/** What it costs to reach the nearest one inside the standard, per cell. */
function fareSurfaceModel() {
  const service = state.service;
  const standard = standardFor(service);
  const { hour, weekday } = tripWindow(service);
  // A traveller who rides free at this time pays nothing for any trip.
  const rideFree = freeTravel(data.meta.fares, state.profile, hour, weekday);
  const classes = Int8Array.from(cheapestFareClasses(data, service, standard), (c) => (rideFree && c > 0 && c < 5 ? 0 : c));
  const costs = fareClassCosts(data.meta.fares, state, hour, weekday);
  const trip = state.returnTrip ? 'return' : 'one way';
  // Four zone classes fit on the map; a network with more puts the rest in the last.
  const many = zoneCap(data.meta.fares) > 4;
  // One fare covers any trip on a flat-fare network, so its key has one price.
  const flat = zoneCap(data.meta.fares) <= 1;
  const legend = FARE.map((colour, k) => ({
    colour,
    label: k === 0 ? 'Free' : k === 5 ? 'No way' : `${money(costs[k])}${many && k === 4 ? '+' : ''}`,
  })).filter((item, k) => !flat || k === 0 || k === 1 || k === 5);
  let free = 0;
  let paid = 0;
  let none = 0;
  for (let i = 0; i < data.n; i += 1) {
    const w = data.pop[i];
    if (!(w > 0)) continue;
    if (classes[i] === 0) free += w;
    else if (classes[i] > 0 && classes[i] < 5) paid += w;
    else none += w;  // nothing in time, or no route at all
  }
  const total = free + paid + none;
  return {
    classes,
    colours: FARE,
    tooltip: (i) => {
      const cls = classes[i];
      if (cls < 0) return ['Not routed'];
      if (cls === 0) {
        return [rideFree
          ? `${SERVICE_SHORT[service]}: free for this traveller at this time`
          : `${SERVICE_SHORT[service]}: free, on foot or by bike within ${standard} min`];
      }
      if (cls === 5) return [`${SERVICE_SHORT[service]}: no way to get there within ${standard} min`];
      const zonesText = flat ? 'by public transport'
        : `${many && cls === 4 ? '4 or more fare zones' : `${cls} fare ${cls === 1 ? 'zone' : 'zones'}`} by public transport`;
      return [`${SERVICE_SHORT[service]}: ${money(costs[cls])}${many && cls === 4 ? '+' : ''} ${trip}`, zonesText];
    },
    panel: {
      noun: SERVICE_NOUN[service],
      standard,
      show: 'fare',
      canShowBurden: incomeAvailable(),
      trip,
      freeShare: total > 0 ? free / total : NaN,
      paid,
      none,
      legend,
      note: 'The cheapest way to reach the nearest one inside the standard. Free means walking or a '
        + 'low-stress bike route already does it. The rest is what the fare would cost this traveller, '
        + 'so the map changes when the traveller does.',
    },
  };
}

/** How far the answer holds: at every time of day, by more than one way of
 *  travelling, and as the standard moves. Only for the fastest way without a
 *  car, which is what a standard is about. */
function robustModel(service, standard) {
  const counting = data.meta.standard_modes;
  const zones = state.zonesNow;
  const perMode = counting.map((m) => times(data, service, m, zones));
  const best = bestTimes(service, zones);
  const q = (k) => Uint8Array.from(data.quintile, (v) => (v === k ? 1 : 0));

  // Every time of day the service is timed at, with no fare limit.
  const windows = windowsFor(data, service);
  let everyTime = null;
  if (windows.length > 1 && zones == null) {
    const ok = new Uint8Array(data.n).fill(1);
    for (const w of windows) {
      const pt = w === windows[0] ? data.usual.t[service] : data.windowed.t[service]?.[w];
      for (let i = 0; i < data.n; i += 1) {
        let fastest = pt ? pt[i] : NaN;
        for (const m of counting) {
          if (m === 'pt') continue;
          const v = data.t[service]?.[m]?.[i];
          if (Number.isFinite(v) && !(v >= fastest)) fastest = v;
        }
        if (!(fastest <= standard)) ok[i] = 0;
      }
    }
    everyTime = weightedShare(ok, data.pop);
  }

  // More than one way to get there in time.
  const ways = Uint8Array.from({ length: data.n }, (_, i) => perMode.filter((t) => t[i] <= standard).length);
  const twoOrMore = weightedShare(Uint8Array.from(ways, (w) => (w >= 2 ? 1 : 0)), data.pop);
  const onlyOne = weightedShare(Uint8Array.from(ways, (w) => (w === 1 ? 1 : 0)), data.pop);

  // The share meeting it as the standard moves, for everyone and each end of
  // the deprivation scale.
  const xs = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const curve = (mask) => xs.map((x) => weightedShare(meetsFlags(best, x), data.pop, mask));
  return {
    everyTime,
    now: weightedShare(meetsFlags(best, standard), data.pop),
    twoOrMore,
    onlyOne,
    xs,
    standard,
    series: [
      { label: 'Least deprived', values: curve(q(1)), colour: '#2a78d6' },
      { label: 'Everyone', values: curve(null), colour: '#0c0c48', emphasis: true },
      { label: 'Most deprived', values: curve(q(5)), colour: '#d65d15' },
    ],
  };
}

/** How many of a service people can reach in time, not just the nearest.
 *  Choice matters where a GP's books are closed or a supermarket is small. */
function choiceModel() {
  const service = state.service;
  const standard = standardFor(service);
  const found = choiceWithin(data, service, standard);
  if (!found) return null;
  const counts = found.counts;
  const cls = (v) => (!Number.isFinite(v) ? -1 : v <= 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : v <= 4 ? 3 : 4);
  const classes = Int8Array.from(counts, cls);
  const routed = routedMask(service);
  for (let i = 0; i < data.n; i += 1) if (classes[i] === 0 && !routed[i]) classes[i] = -1;
  const two = Uint8Array.from(counts, (v) => (v >= 2 ? 1 : 0));
  const none = Uint8Array.from(counts, (v) => (!(v >= 1) ? 1 : 0));
  const labels = ['Least deprived', 'NZDep 3–4', 'NZDep 5–6', 'NZDep 7–8', 'Most deprived'];
  const colours = ['#d65d15', '#f8ad8b', '#9ec5f4', '#3987e5', '#184f95'];
  return {
    classes,
    colours,
    tooltip: (i) => [`${SERVICE_SHORT[service]}: ${Number.isFinite(counts[i]) ? counts[i] : 0} within ${found.minutes} min without a car`],
    panel: {
      show: 'choice',
      noun: SERVICE_NOUN[service],
      plural: SERVICE_PLURAL[service] || `${SERVICE_SHORT[service].toLowerCase()}s`,
      standard,
      minutes: found.minutes,
      twoOrMore: weightedShare(two, data.pop),
      none: weightedShare(none, data.pop),
      canShowFare: fareAvailable() && Boolean(data.cost[service]),
      canShowBurden: fareAvailable() && Boolean(data.cost[service]) && incomeAvailable(),
      byQuintile: [1, 2, 3, 4, 5].map((k, j) => ({
        label: labels[j],
        value: weightedShare(two, data.pop, Uint8Array.from(data.quintile, (v) => (v === k ? 1 : 0))),
        emphasis: k === 5,
      })),
      legend: ['None', '1', '2', '3–4', '5 or more'].map((label, k) => ({ colour: colours[k], label })),
    },
  };
}

const SERVICE_PLURAL = {
  supermarket: 'supermarkets', gp: 'GPs', pharmacy: 'pharmacies', early_childhood: 'early childhood services',
  primary_school: 'primary schools', intermediate_school: 'intermediate schools', secondary_school: 'secondary schools',
};

/** A line saying how the time or budget on screen compares with the usual
 *  case, so a control that changes nothing says so instead of seeming broken. */
function compareNote(service, mode, standard, share) {
  const involvesPt = mode === 'best' || mode === 'pt';
  if (!involvesPt) return null;
  const pct = (v) => Math.round(v * 100);
  if (state.zonesNow != null) {
    const unpriced = weightedShare(meetsFlags(times(data, service, mode, null), standard), data.pop);
    const lost = pct(unpriced) - pct(share);
    return lost <= 0
      ? 'This budget changes nothing here: every trip that meets the standard fits within it.'
      : `At any fare it would be ${pct(unpriced)}%, ${lost} ${lost === 1 ? 'point' : 'points'} higher.`;
  }
  const windows = windowsFor(data, service);
  const now = data.activeWindow?.[service];
  if (!now || now === windows[0]) return null;
  // The same view in the usual window, read straight from the stored layers.
  const usualPt = data.usual.t[service];
  const counting = mode === 'best' ? data.meta.standard_modes : ['pt'];
  const usual = new Float32Array(data.n).fill(NaN);
  for (const m of counting) {
    const layer = m === 'pt' ? usualPt : data.t[service]?.[m];
    if (!layer) continue;
    for (let i = 0; i < data.n; i += 1) if (Number.isFinite(layer[i]) && !(layer[i] >= usual[i])) usual[i] = layer[i];
  }
  const before = weightedShare(meetsFlags(usual, standard), data.pop);
  const diff = pct(share) - pct(before);
  const usualName = (data.meta.windows || {})[windows[0]]?.phrase || 'at the usual time';
  if (diff === 0) return `The same as ${usualName}.`;
  return `${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'point' : 'points'} ${diff < 0 ? 'lower' : 'higher'} than ${usualName} (${pct(before)}%).`;
}

/** Area names for each hexagon at the chosen level: suburb (SA2), or local
 *  board where the city has them. */
function areaLevels() {
  const levels = [['sa2', 'Suburb']];
  if (data.places.some((p) => p && p.board)) levels.push(['board', 'Local board']);
  return levels;
}

function areaModel(gaps, weights, standard) {
  const levels = areaLevels();
  const level = levels.some(([k]) => k === state.areaLevel) ? state.areaLevel : 'sa2';
  const areaOf = level === 'board'
    ? Array.from(data.place, (p) => (p != null && data.places[p] ? data.places[p].board || null : null))
    : data.place;
  const rows = areaTable(areaOf, gaps, weights, data.nzdep, standard).map((row) => ({
    ...row,
    name: level === 'board' ? row.area : (data.places[row.area] ? data.places[row.area].name : 'Unnamed area'),
  }));
  const sorted = sortAreas(rows, state.areaSort === 'share' ? 'share' : 'missing').filter((r) => r.missing > 0);
  lastAreas = { rows: sorted, level };
  return {
    level,
    levels,
    sort: state.areaSort === 'share' ? 'share' : 'missing',
    total: sorted.length,
    showAll: state.areaAll,
    rows: state.areaAll ? sorted : sorted.slice(0, 10),
  };
}

let lastAreas = null;

/** The whole area table for the current settings, as a CSV file. */
function downloadAreas() {
  if (!lastAreas) return;
  const label = lastAreas.level === 'board' ? 'local_board' : 'sa2';
  const text = areaCsv(lastAreas.rows, label);
  const name = [
    'team', data.meta.naming.slug, state.service, `${standardFor(state.service)}min`,
    state.group, state.when || 'usual', state.budget != null ? `budget-${state.budget}${state.budgetUnit === 'income' ? 'pct' : ''}` : null, label,
  ].filter(Boolean).join('_');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  link.download = `${name}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** The bounding box of every suburb in a local board, to zoom to it. */
function boardBox(board) {
  let box = null;
  for (const p of data.places) {
    if (!p || p.board !== board || !p.bbox) continue;
    box = box ? [Math.min(box[0], p.bbox[0]), Math.min(box[1], p.bbox[1]), Math.max(box[2], p.bbox[2]), Math.max(box[3], p.bbox[3])] : [...p.bbox];
  }
  return box;
}

/** What the bus fare to the nearest one means against local income.
 *
 *  The same fare is a different burden in different places, so this maps the
 *  fare for the cheapest bus trip that gets there in time as a share of a
 *  day's income where each person lives. It asks about the bus whether or not
 *  someone could walk instead, because plenty of people cannot. The panel
 *  compares the most and least deprived areas, which a dollar map cannot.
 */
function burdenModel() {
  const service = state.service;
  const standard = standardFor(service);
  const meta = data.meta.fares;
  const { hour, weekday } = tripWindow(service);
  const zones = cheapestZones(data, service, standard, { walkable: false });
  const trips = state.returnTrip ? 2 : 1;
  const trip = state.returnTrip ? 'return' : 'one way';
  // The fare for `z` zones for a traveller type; nothing when they ride free.
  // Over a week it is a return trip every day, after any caps, and set
  // against a week's income, so the two read on the same scale.
  const week = state.basket === 'week' && hasCaps(meta);
  const pricer = (profile) => {
    const column = paymentKey(meta, state.payment, hour, weekday);
    const free = freeTravel(meta, profile, hour, weekday);
    if (week) return (z) => weekCost(meta, z, { profile, payment: state.payment, hour, weekday }) / 7;
    return (z) => (z <= 0 || free ? 0 : fare(meta, z, profile, column) * trips);
  };
  const costOf = pricer(state.profile);
  // Burden for everyone whose trip there in time boards something. A trip
  // that is really a walk needs no fare and is left out of the figures, not
  // counted as nothing; a free fare is counted as nothing, because for that
  // traveller it is.
  const burdenFor = (price) => {
    const out = new Float32Array(data.n).fill(NaN);
    for (let i = 0; i < data.n; i += 1) {
      const z = zones[i];
      const income = data.income[i];
      if (z > 0 && income > 0) out[i] = price(z) / (income / 365);
    }
    return out;
  };
  const burden = burdenFor(costOf);
  const classes = new Int8Array(data.n).fill(-1);
  for (let i = 0; i < data.n; i += 1) {
    const z = zones[i];
    if (z === -1) continue;
    if (z === -2) { classes[i] = 5; continue; }
    if (z === 0) { classes[i] = 0; continue; }
    if (Number.isFinite(burden[i])) classes[i] = burdenClass(burden[i]);
  }
  const meanOf = (values, weights, mask) => {
    let total = 0;
    let sum = 0;
    for (let i = 0; i < data.n; i += 1) {
      if (mask && !mask[i]) continue;
      const w = weights[i];
      if (!(w > 0) || !Number.isFinite(values[i])) continue;
      total += w;
      sum += w * values[i];
    }
    return total > 0 ? sum / total : NaN;
  };
  const meanBurden = (weights, mask) => meanOf(burden, weights, mask);
  // Children and people 65 and over mostly pay their own concession, so their
  // rows are priced at it where the network has one.
  const profiles = (meta.profiles || []).map((p) => p.key);
  const ownProfile = {
    children: ['child_5_15', 'child'].find((k) => profiles.includes(k)),
    older: profiles.includes('supergold') ? 'supergold' : undefined,
  };
  const weights = data.weights[state.group];
  const labels = ['Least deprived', 'NZDep 3–4', 'NZDep 5–6', 'NZDep 7–8', 'Most deprived'];
  const byQuintile = [1, 2, 3, 4, 5].map((q, k) => ({
    label: labels[k],
    value: meanBurden(weights, Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0))),
    emphasis: k === 4,
  }));
  const byGroup = groupChips().map(([g, label]) => {
    const profile = ownProfile[g];
    const values = profile && profile !== state.profile ? burdenFor(pricer(profile)) : burden;
    const concession = profile ? ((meta.profiles || []).find((p) => p.key === profile) || {}).label : null;
    return {
      label: concession && profile !== state.profile ? `${label} (${concession})` : label,
      value: meanOf(values, data.weights[g]),
      emphasis: g === state.group,
    };
  });
  let heavy = 0;
  let paying = 0;
  let capped = 0;
  const uncapped = week ? ((z) => {
    const column = paymentKey(meta, state.payment, hour, weekday);
    return freeTravel(meta, state.profile, hour, weekday) ? 0 : fare(meta, z, state.profile, column) * 2;
  }) : null;
  for (let i = 0; i < data.n; i += 1) {
    if (!(weights[i] > 0) || !Number.isFinite(burden[i])) continue;
    paying += weights[i];
    if (burden[i] >= 0.05) heavy += weights[i];
    // Whether a cap brings this week's cost under seven days of fares.
    if (week && costOf(zones[i]) < uncapped(zones[i]) - 1e-9) capped += weights[i];
  }
  return {
    classes,
    colours: FARE,
    tooltip: (i) => {
      if (classes[i] === 5) return [`${SERVICE_SHORT[service]}: public transport can't get there within ${standard} min`];
      if (zones[i] === 0) return [`${SERVICE_SHORT[service]}: close enough to walk, so no fare is needed`];
      if (!Number.isFinite(burden[i])) return [zones[i] === -1 ? 'Not routed' : 'No income figure for this area'];
      if (burden[i] === 0) return [`${SERVICE_SHORT[service]}: free for this traveller at this time`];
      const perYear = Math.round(data.income[i] / 1000);
      return [
        week
          ? `${SERVICE_SHORT[service]}: ${money(costOf(zones[i]) * 7)} a week, ${percentOf(burden[i])} of a week's income here`
          : `${SERVICE_SHORT[service]}: ${money(costOf(zones[i]))} ${trip}, ${percentOf(burden[i])} of a day's income here`,
        `Income about $${perYear}k a year per person, after household size`,
      ];
    },
    panel: {
      noun: SERVICE_NOUN[service],
      standard,
      trip,
      group: state.group,
      groups: groupChips(),
      least: byQuintile[0].value,
      most: byQuintile[4].value,
      overall: meanBurden(weights),
      heavy,
      paying,
      byQuintile,
      byGroup,
      show: 'burden',
      week,
      capped,
      canWeek: hasCaps(meta),
      basket: week ? 'week' : 'trip',
      canShowFare: true,
      canShowBurden: true,
      meta: data.meta.affordability,
      legend: ['No fare', 'under 2.5%', '2.5–5%', '5–10%', '10% or more', 'Not in time'].map((label, k) => ({ colour: FARE[k], label })),
    },
  };
}

function percentOf(value) {
  if (!Number.isFinite(value)) return '–';
  const pct = value * 100;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

function peopleModel() {
  const service = state.service;
  const standard = standardFor(service);
  const shown = bestTimes(service, state.zonesNow);
  const weights = data.weights[state.group];
  const cap = data.meta.routing_max_minutes || 60;

  // The map shows where the shortfall actually piles up: how many people, and
  // how far short each of them is. Somewhere three minutes over and somewhere
  // forty minutes over are the same colour on a headcount map, and should not be.
  const gaps = shortfalls(shown, standard, cap);
  const burden = Float32Array.from(weights, (w, i) => (gaps[i] > 0 ? w * gaps[i] : 0));
  const edges = quartileBreaks(burden);
  const classes = Int8Array.from(burden, (v) => (v > 0 ? classify(v, edges) : -1));

  const overall = fgt(shown, weights, standard, cap);
  const groups = shortfallByGroup(shown, standard, groupChips().map(([g, label]) => [g, label, data.weights[g]]), cap);
  const regional = fgt(shown, data.pop, standard, cap);

  // Priced out only means something once a budget is set.
  const unlimited = state.zonesNow != null ? bestTimes(service, null) : null;
  const split = unlimited ? pricedOut(shown, unlimited, weights, standard) : null;

  // Where the shortfall falls, ranked by deprivation, among the people being
  // counted. It is worked out from the shortfall itself, so it answers for
  // exactly what is on screen: this standard, mode, time and fare.
  const lean = concentrationIndex(gaps, weights, data.nzdep);

  const flags = meetsFlags(shown, standard);
  const quintiles = byQuintile(data, flags, weights);
  const labels = ['Least deprived', 'NZDep 3–4', 'NZDep 5–6', 'NZDep 7–8', 'Most deprived'];
  const areas = areaModel(gaps, weights, standard);
  return {
    classes,
    colours: PEOPLE,
    tooltip: (i) => {
      if (!(gaps[i] > 0)) return [`Within ${standard} min`];
      const short = Math.round(gaps[i] * standard);
      return [`About ${count(weights[i])} ${GROUP_NOUN[state.group] || 'people'} miss out`, `Short by ${short} min`];
    },
    panel: {
      noun: SERVICE_NOUN[service],
      standard,
      group: state.group,
      fare: fareClause(),
      below: overall.below,
      minutesShort: overall.minutesShort,
      depth: overall.depth,
      severity: overall.severity,
      regionalRate: regional.rate,
      split,
      lean,
      leanText: shortfallLeaning(lean),
      rate: overall.rate,
      modeNote: state.mode !== 'best' ? 'Counted by the fastest of walking, low-stress cycling and public transport.' : null,
      q1: quintiles[0].share,
      q5: quintiles[4].share,
      // Both charts show the share missing, so they read the same way.
      byQuintile: quintiles.map((q, k) => ({ label: labels[k], value: Number.isFinite(q.share) ? 1 - q.share : NaN, emphasis: k === 4 })),
      groups: groupChips(),
      byGroup: groups.map((row) => ({
        label: row.label,
        value: row.rate,
        emphasis: row.key === state.group,
        detail: row.rate > 0 && Number.isFinite(row.minutesShort) ? `${Math.round(row.minutesShort)} min` : null,
        title: Number.isFinite(row.minutesShort) && row.rate > 0
          ? `${row.label}: those who miss out are ${Math.round(row.minutesShort)} minutes short on average`
          : row.label,
      })),
      areas,
      legend: [
        { colour: PEOPLE[0], label: 'less' },
        { colour: PEOPLE[1], label: '' },
        { colour: PEOPLE[2], label: '' },
        { colour: PEOPLE[3], label: 'more' },
      ],
    },
  };
}

function fixesModel() {
  const service = state.service;
  const standard = standardFor(service);
  const best = bestTimes(service, state.zonesNow);
  const flags = meetsFlags(best, standard);
  const codes = reasonCodes(data, service, standard, best, state.zonesNow, state.zonesNow != null ? bestTimes(service, null) : null);
  const weights = data.weights[state.group];
  const classes = Int8Array.from(codes, (code) => {
    const cls = REASON_CLASS[code];
    if (cls == null) return -1;
    return state.reason != null && cls !== state.reason ? FADED : cls;
  });
  const byCode = peopleByReason(codes, weights);
  const reasons = REASON_GROUPS.filter((g) => !g.budgetOnly || state.zonesNow != null).map((g) => ({
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
    panel: { noun: SERVICE_NOUN[service], standard, group: state.group, groups: groupChips(), fare: fareClause(), below: peopleBelow(flags, weights), reasons, ranked, focus: state.reason },
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
  const priced = zones != null && choice.mode === 'pt' && data.cost.jobs ? pricedJobs(zones) : null;
  // The priced layer is a share of jobs, so the competition ratio can't apply to it.
  if (priced) choice.fair = false;
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
  const byGroup = groupChips().map(([g, label]) => ({ label, value: weightedMedian(share, data.weights[g]) }));
  const max = Math.max(...byQ.map((r) => r.value || 0), ...byGroup.map((r) => r.value || 0)) * 1.1 || 1;
  // Which way job access leans with deprivation: the ordered measure, where
  // the Palma ratio only says how spread out it is.
  const lean = concentrationIndex(share, data.pop, data.nzdep);
  return {
    classes,
    colours: choice.fair ? FAIR : JOBS,
    tooltip: (i) => [choice.fair
      ? `${Number.isFinite(values[i]) ? values[i].toFixed(2) : '–'}× the ${place.name} average`
      : `${Number.isFinite(values[i]) ? values[i].toFixed(1) : '–'}% of ${place.possessive} jobs within ${choice.limit} min`],
    panel: {
      ...choice,
      priced: Boolean(priced),
      zones,
      total: data.meta.jobs.total,
      fareNote: fareNote(zones),
      fare: fareClause(),
      when: choice.mode === 'pt' ? whenClause('jobs') : '',
      limit: priced ? (data.meta.fares.max_minutes || choice.limit) : choice.limit,
      median: weightedMedian(values, data.pop),
      legend,
      byQuintile: byQ,
      byGroup,
      max,
      palma: palma(share, data.pop),
      lean,
      leanText: leaning(lean, { noun: 'Job access', groupNoun: 'more deprived areas' }),
      lowShare: weightedMedian(share, data.pop),
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
  // Which way the score leans with deprivation: the ordered measure, where a
  // Palma ratio only says how spread out it is.
  const lean = concentrationIndex(values, data.pop, data.nzdep);
  const scoreNoun = { jobs: 'jobs', everyday: 'everyday services', education: 'schools', all: 'opportunities' }[choice.key] || 'opportunities';
  return {
    classes,
    colours: decile ? DECILE : SCORE,
    tooltip: (i) => [
      Number.isFinite(values[i])
        ? `${keyLabels[choice.key] || choice.key} by ${MODES[choice.mode].short}: score ${Math.round(values[i])}`
        : 'No score here',
      Number.isFinite(values[i]) ? `Decile ${bands[i] + 1} of 10; the ${place.name} average is 100` : '',
    ].filter(Boolean),
    panel: {
      key: choice.key,
      mode: choice.mode,
      when: choice.mode === 'pt' ? whenClause() : '',
      display: choice.display,
      keys: choice.keys.map((k) => [k, keyLabels[k] || k]),
      modes: choice.available.map((m) => [m, (meta.beta_modes || []).includes(m) ? `${MODES[m].label} (beta)` : MODES[m].label]),
      median: weightedMedian(values, data.pop),
      palma: palma(values, data.pop),
      lean,
      leanText: leaning(lean, { noun: `Access to ${scoreNoun}`, groupNoun: 'more deprived areas' }),
      legend,
      byQuintile: [1, 2, 3, 4, 5].map((q, k) => ({
        label: quintileLabels[k],
        value: weightedMedian(values, data.pop, Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0))),
        emphasis: k === 4,
      })),
      note: 'Every opportunity counts, discounted by how long it takes to reach. The curves for walking '
        + 'and public transport are the travel time parameters the NZ Transport Agency published for the New '
        + 'Zealand accessibility analysis methodology, fitted to the New Zealand Household Travel Survey. Each '
        + 'purpose stops counting where 95% of trips of that kind are done, which is what that method does. '
        + 'Cycling is beta: it uses the Propensity to Cycle Tool\'s distance decay, because the local cycling '
        + 'samples are too small to fit a curve to.',
    },
  };
}

function scoreAvailable() {
  const choice = scoreChoice();
  return Boolean(choice.mode && choice.key && data.access[choice.mode]?.[choice.key]);
}

/** The fare and time clause for a sentence: empty when neither is set. */
function fareClause() {
  const when = whenClause();
  if (state.budget == null || state.measure === 'score') return when;
  const trip = state.returnTrip ? 'return' : 'one-way';
  if (byIncome()) return `, spending up to ${percentText(state.budget)} of a day's income on a ${trip} fare${when}`;
  return `, on a ${money(state.budget)} ${trip} fare${when}`;
}

function percentText(value) {
  return `${Number(value).toFixed(value % 1 ? 1 : 0)}%`;
}

/** The dollars a share of income buys where incomes are lowest and highest,
 *  among the middle 80% of residents, so the sentence is about real places. */
function incomeRange(share) {
  daily = daily || dailyIncome(data);
  const idx = [];
  for (let i = 0; i < data.n; i += 1) if (Number.isFinite(daily[i]) && data.pop[i] > 0) idx.push(i);
  idx.sort((a, b) => daily[a] - daily[b]);
  const total = idx.reduce((sum, i) => sum + data.pop[i], 0);
  const at = (p) => {
    let running = 0;
    for (const i of idx) {
      running += data.pop[i];
      if (running >= p * total) return daily[i];
    }
    return daily[idx[idx.length - 1]];
  };
  return [at(0.1) * share / 100, at(0.9) * share / 100];
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
  if (state.show === 'fare' && fareAvailable() && data.cost[state.service]) return fareSurfaceModel();
  if (state.show === 'burden' && fareAvailable() && data.cost[state.service] && incomeAvailable()) return burdenModel();
  if (state.show === 'choice' && data.choice[state.service]) {
    const model = choiceModel();
    if (model) return model;
  }
  return accessModel();
}

// ---------------------------------------------------------------- rendering

function renderWhen() {
  const field = $('when-field');
  const windows = windowsFor(data, subject());
  const specs = data.meta.windows || {};
  // The time only changes public transport, so it stays out of the way
  // whenever public transport is not on screen.
  if (!transitShown() || !windows.length) {
    field.hidden = true;
    return;
  }
  field.hidden = false;
  const { window, spec } = tripWindow();
  $('when-value').textContent = window === USUAL ? 'each trip at its usual time' : (spec.when || '');
  const picker = $('when-picker');
  picker.hidden = windows.length < 2;
  if (windows.length < 2) return;
  // Chips come in the order the config lists windows, so they read the same
  // way for every service that has them.
  const ordered = [...(windows.includes(USUAL) ? [USUAL] : []), ...Object.keys(specs).filter((w) => windows.includes(w))];
  const named = (w) => (w === USUAL ? ['Usual', 'each trip at its usual time'] : [specs[w].label || w, specs[w].when]);
  renderWhenPicker(picker, ordered.map((w) => [w, ...named(w)]), window, set);
}

function renderStandard() {
  const field = $('standard-field');
  const jobs = state.service === 'jobs' || state.measure === 'score';
  field.hidden = jobs;
  if (jobs) return;
  const value = standardFor(state.service);
  const fallback = data.meta.services[state.service].standard_minutes;
  $('standard').value = String(value);
  $('standard-value').textContent = `within ${value} min`;
  $('standard').setAttribute('aria-valuetext', `within ${value} minutes`);
  const reset = $('standard-reset');
  reset.hidden = value === fallback;
  reset.textContent = `Reset to ${fallback} min`;
}

function fareAvailable() {
  const meta = data.meta.fares;
  return Boolean(meta && meta.fares && Object.keys(data.cost || {}).length);
}

function renderBudget() {
  const field = $('budget-field');
  // A fare only changes public transport, so it stays out of the way otherwise.
  const hide = state.measure === 'score' || !fareAvailable() || !transitShown();
  field.hidden = hide;
  if (hide) return;
  const meta = data.meta.fares;
  const spec = meta.budget || {};
  const income = byIncome();
  // As a share of income the slider runs to 15% of a day's income, which is
  // already past what the World Bank calls unaffordable.
  const max = income ? INCOME_MAX : Number(spec.max ?? 20);
  const slider = $('budget');
  slider.min = String(income ? 0 : spec.min ?? 0);
  slider.max = String(max);
  slider.step = String(income ? 0.5 : spec.step ?? 0.5);
  slider.value = String(state.budget == null ? max : state.budget);
  const trip = state.returnTrip ? 'return' : 'one way';
  $('budget-value').textContent = state.budget == null
    ? 'any fare'
    : income ? `${percentText(state.budget)} of a day's income` : `${money(state.budget)} ${trip}`;
  $('budget').setAttribute('aria-valuetext', $('budget-value').textContent);
  const reset = $('budget-reset');
  reset.hidden = state.budget == null;
  const unit = $('budget-unit');
  unit.hidden = !incomeAvailable();
  if (incomeAvailable()) {
    const units = [['dollars', 'Dollars'], ['income', '% of income', "A share of a day's income in each area"]];
    renderChips(unit, units, state.budgetUnit, (value) => {
      if (value === state.budgetUnit) return;
      // A dollar figure means nothing as a percentage, so each unit starts
      // from its own default.
      set({ budgetUnit: value, budget: value === 'income' ? INCOME_DEFAULT : null });
    });
  }
  const { hour, weekday } = tripWindow(state.service);
  if (income) {
    const [low, high] = state.budget == null ? [NaN, NaN] : incomeRange(state.budget);
    $('budget-note').textContent = state.budget == null
      ? "Each area's budget is a share of its own income, after household size."
      : `Each area gets its own budget: ${money(low)} ${trip} where incomes are lowest, `
        + `${money(high)} where they are highest.`;
    $('budget-ticks').replaceChildren();
    return;
  }
  $('budget-note').textContent = budgetSentence(meta, state, hour, weekday);

  // Ticks sit where each extra zone starts costing, and move when the
  // traveller changes, which is the clearest way to show that a concession
  // changes what money buys.
  const ticks = $('budget-ticks');
  const steps = fareSteps(meta, { ...state, hour, weekday })
    .filter((step) => step.cost <= max);
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
  const hide = state.measure === 'score' || !fareAvailable() || !transitShown();
  box.hidden = hide;
  if (hide) return;
  const { hour, spec } = tripWindow(state.service);
  const clock = spec.date ? (spec.label || 'weekend') : hour;
  $('traveller-summary').textContent = travellerSummary(data.meta.fares, state, clock);
  const timed = spec.when || 'in the modelled window';
  renderTraveller($('traveller-body'), {
    profiles: data.meta.fares.profiles || [],
    payments: payments(data.meta.fares),
    profile: state.profile,
    payment: state.payment,
    returnTrip: state.returnTrip,
    timeNote: `Trips are timed ${timed}. `
      + (((data.meta.fares || {}).offpeak_hours || []).length
        ? 'The time decides peak or off-peak fares, and whether a SuperGold trip is free.'
        : 'The time decides whether a SuperGold trip is free.'),
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
  $('view').setAttribute('aria-labelledby', `tab-${state.view}`);
  const root = $('view');
  if (state.service === 'jobs') {
    if (state.view === 'access') renderJobsAccess(root, model.panel, set);
    else if (state.view === 'people') renderJobsPeople(root, model.panel);
    else renderJobsFixes(root);
    return;
  }
  if (state.view === 'access') {
    if (model.panel.show === 'fare') renderFareSurface(root, model.panel, set);
    else if (model.panel.show === 'burden') renderBurden(root, model.panel, set);
    else if (model.panel.show === 'choice') renderChoice(root, model.panel, set);
    else renderAccess(root, model.panel, set);
  }
  else if (state.view === 'people') renderPeople(root, model.panel, set);
  else renderFixes(root, model.panel, set);
}

function renderWhere() {
  const field = $('where-field');
  field.hidden = !data.urban;
  if (!data.urban) return;
  renderChips($('where-picker'), [['all', 'Everywhere'], ['urban', 'Urban areas only', 'Towns and cities of 1,000 people or more']],
    state.urbanOnly ? 'urban' : 'all', (value) => set({ urbanOnly: value === 'urban' }));
}

/** The one line the folded settings show: everything that is set, in order. */
function renderSettings() {
  const parts = [];
  if (!$('where-field').hidden && state.urbanOnly) parts.push('urban areas only');
  if (!$('when-field').hidden) {
    const { window, spec } = tripWindow();
    parts.push(window === USUAL ? 'Usual times' : (spec.label ? `${spec.label}, ${spec.when}` : spec.when || ''));
  }
  if (!$('standard-field').hidden) parts.push(`within ${standardFor(state.service)} min`);
  if (!$('traveller').hidden) {
    const profile = ((data.meta.fares || {}).profiles || []).find((p) => p.key === state.profile);
    if (profile && state.profile !== 'adult') parts.push(profile.label);
  }
  if (!$('budget-field').hidden) parts.push(state.budget == null ? 'any fare' : $('budget-value').textContent);
  const box = $('settings');
  box.hidden = !['where-field', 'when-field', 'standard-field', 'traveller', 'budget-field'].some((id) => !$(id).hidden);
  $('settings-summary').textContent = parts.filter(Boolean).join(' · ') || 'Everyone, everywhere';
}

let announceTimer = 0;
/** Say the headline once the panel settles, not the whole panel every change. */
function announce() {
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    const heroBox = document.querySelector('#view .hero');
    $('announce').textContent = heroBox ? heroBox.innerText.split('\n').filter(Boolean).slice(0, 2).join(' ') : '';
  }, 600);
}

function renderMini() {
  // One line shown in the header when the panel is folded away (and on phones at first).
  const mini = $('mini');
  if (state.measure === 'score' && scoreAvailable()) {
    const choice = scoreChoice();
    const median = weightedMedian(data.access[choice.mode][choice.key], data.pop);
    const label = (data.meta.access.keys || {})[choice.key] || choice.key;
    const when = choice.mode === 'pt' ? whenClause() : '';
    mini.textContent = `${label} by ${MODES[choice.mode].short}${when} · typical score ${Math.round(median)} (${place.name} average 100)`;
    return;
  }
  if (state.service === 'jobs') {
    const panel = current && current.panel;
    const median = panel ? panel.median : NaN;
    const figure = panel && panel.fair
      ? `${Number.isFinite(median) ? median.toFixed(2) : '–'}× the average`
      : `${Number.isFinite(median) ? median.toFixed(median < 10 ? 1 : 0) : '–'}% of jobs`;
    const limit = panel ? panel.limit : jobsChoice().limit;
    const extra = panel && panel.priced ? panel.fare : (jobsChoice().mode === 'pt' ? whenClause('jobs') : '');
    mini.textContent = `Jobs · typical resident reaches ${figure} within ${limit} min${extra}`;
    return;
  }
  const standard = standardFor(state.service);
  // The mode on screen, on the Access tab; the other tabs count the fastest.
  const mode = state.view === 'access' ? state.mode : 'best';
  const share = weightedShare(meetsFlags(times(data, state.service, mode, state.zonesNow), standard), data.pop);
  const how = mode === 'best' ? 'without a car' : `by ${MODES[mode].short}`;
  mini.textContent = `${SERVICE_SHORT[state.service]} · ${Math.round(share * 100)}% within ${standard} min ${how}${fareClause()}`;
}

/** Where keyboard focus was, as a chip group and value, so it can be put back
 *  on the same choice after the panel is redrawn. */
function focusKey() {
  const active = document.activeElement;
  if (!active || active.dataset?.value == null) return null;
  const group = active.closest('[data-group]');
  return group ? [group.dataset.group, active.dataset.value] : null;
}

function restoreFocus(key) {
  if (!key || document.activeElement !== document.body) return;
  const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : v);
  document.querySelector(`[data-group="${esc(key[0])}"] [data-value="${esc(key[1])}"]`)?.focus();
}

function update() {
  const focused = focusKey();
  const t0 = performance.now();
  current = compute();
  // Rural hexagons are left off the map when only urban areas are counted.
  if (state.urbanOnly && data.urban) {
    current.classes = Int8Array.from(current.classes, (c, i) => (data.urban[i] ? c : -1));
  }
  const t1 = performance.now();
  // The panel is worth drawing even when the basemap has not arrived.
  try {
    paintCells(map, current.classes, current.colours);
  } catch (error) {
    console.warn('The map is not ready to paint yet.', error);
  }
  const t2 = performance.now();
  renderWhere();
  renderWhen();
  renderStandard();
  renderBudget();
  renderTravellerLine();
  renderView(current);
  renderSettings();
  renderMini();
  restoreFocus(focused);
  announce();
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
  try {
    renderPlace({ title: $('place-title'), sub: $('place-sub'), body: $('place-body') }, data, i, state);
  } catch (error) {
    // Better an honest gap than the last place's figures under a new name.
    $('place-title').textContent = placeName(i);
    $('place-sub').textContent = '';
    $('place-body').replaceChildren(el('p', 'note', 'The details for this place could not be shown.'));
    console.error('Place card failed', i, error);
  }
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
  // Switching a layer on adds its key to the map, so nothing is drawn that
  // the reader has no way of naming.
  const layers = $('layer-list');
  const mapKey = $('map-key');
  const shown = new Set();
  const drawKey = () => {
    const rows = [];
    for (const [key, spec] of Object.entries(OVERLAYS)) {
      if (!shown.has(key) || !spec.key) continue;
      for (const entry of spec.key) {
        const row = el('div', 'key-row');
        const swatch = el('span', `key-swatch key-${entry.swatch}`);
        swatch.style.setProperty('--swatch', entry.colour);
        row.append(swatch, el('span', 'key-label', entry.label));
        rows.push(row);
      }
    }
    mapKey.replaceChildren(...rows);
    mapKey.hidden = rows.length === 0;
  };
  for (const [key, spec] of Object.entries(OVERLAYS)) {
    const label = el('label', 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      setOverlay(map, key, box.checked);
      if (box.checked) shown.add(key); else shown.delete(key);
      drawKey();
    });
    label.append(box, document.createTextNode(` ${spec.label}`));
    layers.append(label);
  }
  drawKey();

  onPoints(map, ({ kind, properties, lngLat }) => {
    const box = el('div', 'point-card');
    if (kind === 'stop') {
      const names = { rail_ferry: 'Train or ferry stop', frequent: 'Frequent stop', other: 'Bus stop' };
      box.append(el('strong', null, names[properties.kind] || 'Stop'));
      const rate = Number(properties.per_hour);
      const window = 'at its busiest time';
      box.append(el('span', null, Number.isFinite(rate)
        ? `${rate.toFixed(rate < 10 ? 1 : 0)} departures an hour, ${window}`
        : 'Departures not counted'));
    } else {
      box.append(el('strong', null, properties.name || 'Unnamed'));
      const services = String(properties.services || '').replace(/[[\]"]/g, '').split(',').filter(Boolean);
      const named = services.map((id) => SERVICE_SHORT[id.trim()] || id.trim()).join(', ');
      if (named) box.append(el('span', null, named));
    }
    new window.maplibregl.Popup({ closeButton: true, offset: 10, className: 'point-popup' })
      .setLngLat(lngLat)
      .setDOMContent(box)
      .addTo(map);
  });

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


/** The opening view: every city, and what each one is like. */
async function start() {
  const response = await fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load the list of places (${response.status})`);
  const index = await response.json();
  $('loading').hidden = true;
  $('start').hidden = false;
  // The controls behind the list do nothing until a place is picked, so keep
  // keyboard and screen readers out of them.
  $('panel').inert = true;
  $('panel').setAttribute('aria-hidden', 'true');
  $('start-lede').textContent = `How much people can reach without a car: everyday services and jobs for `
    + `${(index.totals.population / 1e6).toFixed(1)} million people in ${index.totals.cities} New Zealand urban areas.`;
  const everyday = (city) => (Number.isFinite(city.everyday_all_share) ? `${Math.round(city.everyday_all_share * 100)}%` : '–');
  const jobs = (city) => (Number.isFinite(city.jobs_pt_45_typical) ? count(city.jobs_pt_45_typical) : '–');

  // The three largest places lead, each with a map drawn from its own data.
  const featured = index.cities.slice(0, 3);
  $('start-featured').replaceChildren(...featured.map((city) => {
    const item = el('li');
    const button = el('button', 'start-feature');
    button.type = 'button';
    const thumb = el('img', 'start-thumb');
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.src = `${DATA_BASE}${city.thumb}`;
    const stats = el('span', 'start-stats');
    const stat = (figure, text) => {
      const box = el('span', 'start-stat');
      box.append(el('strong', null, figure), el('span', null, text));
      return box;
    };
    stats.append(
      stat(everyday(city), 'reach a supermarket, GP and pharmacy without a car'),
      stat(jobs(city), 'jobs by public transport in 45 min, for a typical resident'),
    );
    const head = el('span', 'start-feature-head');
    head.append(el('span', 'start-city-name', city.place), el('span', 'start-city-people', `${count(city.population)} people`));
    button.append(thumb, head, stats);
    button.addEventListener('click', () => goToCity(city.slug));
    item.append(button);
    return item;
  }));

  // The rest as rows that compare at a glance, with bars on a shared scale.
  const others = index.cities.slice(3);
  const mostJobs = Math.max(...index.cities.map((c) => c.jobs_pt_45_typical || 0)) || 1;
  // The label shows only on narrow screens, where the column heads are hidden.
  const bar = (value, share, label) => {
    const cell = el('span', 'start-bar');
    const fill = el('span', 'start-bar-fill');
    fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
    cell.append(el('span', 'start-bar-value', value), fill, el('span', 'start-bar-label', label));
    return cell;
  };
  const list = $('start-list');
  list.replaceChildren(...others.map((city) => {
    const button = el('button', 'start-row');
    button.type = 'button';
    button.setAttribute('role', 'listitem');
    button.append(
      el('span', 'start-city-name', city.place),
      el('span', 'start-city-people', count(city.population)),
      bar(everyday(city), city.everyday_all_share || 0, 'all three services'),
      bar(jobs(city), (city.jobs_pt_45_typical || 0) / mostJobs, 'jobs, 45 min'),
    );
    button.setAttribute('aria-label', `${city.place}, ${count(city.population)} people, ${everyday(city)} reach all three everyday services, `
      + `${jobs(city)} jobs by public transport in 45 minutes`);
    button.addEventListener('click', () => goToCity(city.slug));
    return button;
  }));
  const built = new Date(`${index.built}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  $('start-note').textContent = `Timetables from September 2026, 2023 Census. Built ${built}. Version ${index.version}.`;
  wireCityPicker(index, null);
  wireLocate(index);
  $('start-featured').querySelector('.start-feature')?.focus();
}

/** Ask where the visitor is only when they ask to be located. */
function wireLocate(index) {
  const button = $('start-locate');
  const note = $('start-locate-note');
  if (!button) return;
  if (!('geolocation' in navigator)) {
    button.hidden = true;
    return;
  }
  button.addEventListener('click', () => {
    note.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const city = nearestCity(index.cities, position.coords.longitude, position.coords.latitude);
        if (city) goToCity(city.slug);
        else note.textContent = 'TEAM does not cover where you are yet. Pick the nearest place below.';
      },
      () => { note.textContent = 'Location is not available. Pick a place below.'; },
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}

function wireCityPicker(index, current) {
  const picker = $('city');
  if (!picker) return;
  // The picker shows the place on screen. Picking another goes there; the
  // last entry goes back to the list that compares them all.
  const options = [];
  if (!current) {
    const prompt = el('option', null, 'Pick a place');
    prompt.value = '';
    prompt.disabled = true;
    prompt.selected = true;
    options.push(prompt);
  }
  for (const city of index.cities) {
    const option = el('option', null, city.place);
    option.value = city.slug;
    if (city.slug === current) option.selected = true;
    options.push(option);
  }
  if (current) {
    const rule = el('option', null, '──────────');
    rule.disabled = true;
    const list = el('option', null, 'Compare all places');
    list.value = '*';
    options.push(rule, list);
  }
  picker.replaceChildren(...options);
  picker.disabled = false;
  picker.addEventListener('change', () => {
    if (picker.value === '*') goToList();
    else if (picker.value && picker.value !== current) goToCity(picker.value);
  });
}

async function init() {
  if (!CITY) {
    // Someone who has been here before goes back to the place they last
    // looked at, unless they asked for the list.
    const last = WANTS_LIST ? null : rememberedCity();
    if (last && window.location.hash.length <= 1) {
      try {
        const response = await fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' });
        const index = response.ok ? await response.json() : null;
        if (index && index.cities.some((city) => city.slug === last)) {
          const url = new URL(window.location.href);
          url.search = `?city=${last}`;
          window.location.replace(url.toString());
          return;
        }
      } catch {
        // fall through to the front page
      }
    }
    // A link made before there was more than one city carries a hash and no
    // city. Those links should still land where they were pointed, so a hash
    // means the first city rather than the front page.
    if (window.location.hash.length > 1) {
      try {
        const response = await fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' });
        const index = response.ok ? await response.json() : null;
        const first = index && index.cities && index.cities[0];
        if (first) {
          const url = new URL(window.location.href);
          url.searchParams.set('city', first.slug);
          window.location.replace(url.toString());
          return;
        }
      } catch {
        // fall through to the front page
      }
    }
    try {
      await start();
    } catch (error) {
      $('loading').textContent = 'The list of places could not be loaded.';
      throw error;
    }
    return;
  }
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
    data = await load(`${DATA_BASE}${CITY}/`);
  } catch (error) {
    // A mistyped place gets the list, not a message about file access.
    const known = await fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .then((index) => index && index.cities.some((city) => city.slug === CITY))
      .catch(() => null);
    const box = $('loading');
    if (known === false) {
      const link = el('a', null, 'See the places TEAM covers');
      link.href = '?places';
      box.replaceChildren(document.createTextNode(`TEAM has no place called "${CITY}". `), link);
    } else {
      box.textContent = 'The data could not be loaded. If you opened this file directly, serve the folder over HTTP instead.';
    }
    throw error;
  }
  rememberCity(CITY);
  setServices(data.meta);
  if (!SERVICE_ORDER.includes(state.service)) state.service = SERVICE_ORDER[0];
  if (state.when && !(data.meta.windows || {})[state.when]) state.when = null;
  // A link can carry values this city does not have; fall back rather than fail.
  if (!data.weights[state.group]) state.group = 'everyone';
  if (state.urbanOnly) setUrban(data, true);
  const profiles = ((data.meta.fares || {}).profiles || []).map((p) => p.key);
  if (profiles.length && !profiles.includes(state.profile)) state.profile = profiles.includes('adult') ? 'adult' : profiles[0];
  if (!MODES[state.mode]) state.mode = 'best';
  setWindow(data, state.when);

  // A network names its own ways of paying, so start on one this one has
  // rather than on Auckland's card.
  const ways = payments(data.meta.fares || {}).map(([key]) => key);
  if (ways.length && !ways.includes(state.payment)) state.payment = ways[0];

  await ready;
  // Network lines load separately and may arrive before or after the style.
  const overlaysReady = loadOverlays(`${DATA_BASE}${CITY}/`).catch((error) => {
    console.warn('Network layers could not be loaded.', error);
    return {};
  });
  const addLayers = () => {
    setCells(map, cellCollection(data.h3));
    setOverlays(map, {}, data.destinations);
    setBasemap(map, state.basemap);
    overlaysReady.then((overlays) => setOverlays(map, overlays, data.destinations));
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
  // The weekday and any other day a window was timed on, such as a Saturday.
  const days = [...new Set([data.meta.routing_date, ...Object.values(data.meta.windows || {}).map((w) => w.date).filter(Boolean)])].sort();
  const last = new Date(`${days[days.length - 1]}T12:00:00`);
  const dayList = days.map((d) => new Date(`${d}T12:00:00`).getDate()).join(' and ');
  const month = last.toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' });
  $('build-note').textContent = `Timetables ${dayList} ${month} · Census 2023 · v${data.meta.version}`;
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
    map.fitBounds(regionBounds(), { padding, duration: 0 });
  }
  $('loading').hidden = true;
  // Network lines only show when a layer is switched on, so they load after the first view.
  fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((index) => { if (index) wireCityPicker(index, CITY); })
    .catch(() => { /* one city on its own still works */ });
}

init();
