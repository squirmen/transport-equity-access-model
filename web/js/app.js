// TEAM web app: state, derived figures, map colours and panels.

import { renderAbout } from './about.js';
import {
  byQuintile, decileBands, FEWEST, fetchJson, load, loadMore, loadOverlays, meetsFlags, peopleBelow, peopleByReason, pricedLayer, rankPlaces,
  choiceWithin, reasons as reasonCodes, setUrban, setWindow, times, tripTime, USUAL, weightedMedian, weightedShare,
  windowOf, windowsFor,
} from './data.js';
import {
  byGroup as shortfallByGroup, concentrationBreaks, concentrationClasses, concentrationIndex, CONCENTRATED, fgt, leaning,
  pricedOut, shortfallLeaning, shortfalls, whereTheyLive,
} from './equity.js';
import {
  affordableZones, budgetSentence, burdenClass, cheapestFareClasses, cheapestZones, dailyIncome, fare,
  fareClassCosts, fareSteps, freeTravel, hasCaps, incomeZones, money, paymentKey, payments, travellerSummary,
  weekCost, zoneCap,
} from './fares.js';
import { count, el, minutes, MODES, percent, place } from './format.js';
import {
  BASEMAPS, cellCollection, createMap, fitPlace, onCells, onPoints, OVERLAYS, paintCells, select, setBasemap,
  setCells, setOverlay, setOverlays, showDestinationsFor,
} from './map.js';
import {
  ACCESS, accessBreaks, classify, CONCENTRATION, DECILE, DENSITY, DESTINATION_COLOURS, DESTINATION_OTHER, FADED, FAIR,
  FAIR_BREAKS, FARE, JOBS, JOBS_BREAKS,
  PEOPLE, quartileBreaks, REASON_CLASS, REASON_GROUPS, REASON_PALETTE, SCORE, SCORE_BREAKS, VILLAGE,
} from './palette.js';
import {
  renderAccess, renderErrands, renderFareSurface, renderFixes, renderJobsAccess, renderJobsFixes, renderJobsPeople,
  renderBurden, renderChips, renderChoice, renderPeople, renderScore, renderServicePicker, renderTraveller, renderWhenPicker, SERVICE_NOUN,
  SERVICE_ORDER, SERVICE_SHORT, setServices,
} from './panel.js';
import { areaCsv, areaTable, sortAreas } from './areas.js';
import { nearestCity } from './cities.js';
import { renderPlace } from './place.js';
import { areaNamed, buildAreas, chainAt, chainOf, maskFor, pickArea } from './scope.js';

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
  // Who misses out, or where the group lives in the first place; and whether
  // that map keeps only the places that miss the standard.
  peopleShow: 'short',
  liveMissing: false,
  // Rest homes and retirement villages are left out of the 65+ counts unless put back.
  liveVillages: false,
  // The area the panel's figures are for, when set by a link or a click rather
  // than by where the map is: {level, name}, or {level: 'place'} for all of it.
  areaPin: null,
  // The errand round: which stops (null for all of them), how, the longest
  // stretch allowed, and the walking pace.
  errandStops: null,
  errandMode: 'walk',
  errandLeg: '10',
  pace: 'usual',
};

let data;
let map;
let current = null;
// What the panel shows: the figures for the area the map is on, or `current`.
let shown = null;
// Which council, ward, local board and suburb each hexagon is in.
let scope = null;
let cellOf = null;
// The whole place's figures, while the panel's are worked out for an area.
let placeRef = null;
// The level of that area, and the area, while they are.
let scopeLevel = null;
let scopeArea = null;
let areaKey = '';
// Set while only a headline figure is wanted, to skip the slower extras.
let figureOnly = false;
let userMoved = false;
const figureCache = new Map();
let frame = 0;
const cache = { best: new Map(), routed: new Map() };

// ---------------------------------------------------------------- state and URL

function standardFor(service) {
  const fallback = service === 'errands' ? data.meta.chains?.standard_minutes : data.meta.services[service]?.standard_minutes;
  return state.standard[service] ?? fallback ?? 20;
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
  const round = (params.get('e') || '').split('.');
  // A '+' typed into an address arrives as a space.
  if (round[0]) state.errandStops = round[0].split(/[+ ]/).filter((s) => /^[a-z_]+$/.test(s));
  if (['walk', 'pt', 'bike_low_stress'].includes(round[1])) state.errandMode = round[1];
  if (/^(\d+|any)$/.test(round[2] || '')) state.errandLeg = round[2];
  if (round[3] === 'slow') state.pace = 'slow';
  const region = params.get('r');
  if (region) {
    const dot = region.indexOf('.');
    state.areaPin = dot < 0 ? { level: region } : { level: region.slice(0, dot), name: region.slice(dot + 1) };
  }
  const live = (params.get('p') || '').split('.');
  if (live[0] === 'live') {
    state.peopleShow = 'live';
    state.liveMissing = live.includes('m');
    state.liveVillages = live.includes('v');
  }
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
  if (state.peopleShow === 'live') {
    params.set('p', ['live', state.liveMissing ? 'm' : '', state.liveVillages ? 'v' : ''].filter(Boolean).join('.'));
  }
  if (state.service === 'errands') {
    params.set('e', [errandStops().join('+'), state.errandMode, state.errandLeg, state.pace === 'slow' ? 'slow' : ''].join('.'));
  }
  if (state.group !== 'everyone') params.set('g', state.group);
  const where = areaNow();
  if (where) params.set('r', `${where.area.level}.${where.area.name}`);
  else if (state.areaPin && state.areaPin.level === 'place') params.set('r', 'place');
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
    if (place) {
      goToArea({ level: 'suburb', name: place.name }, place.bbox);
    }
    return;
  }
  if ('zoomBoard' in patch) {
    const found = scope && areaNamed(scope, 'board', patch.zoomBoard);
    if (found) goToArea({ level: found.area.level, name: found.area.name }, found.area.bbox);
    else {
      const box = boardBox(patch.zoomBoard);
      if (box) fitPlace(map, box);
    }
    return;
  }
  if ('download' in patch) {
    downloadAreas();
    return;
  }
  if ('service' in patch && patch.service !== state.service) state.reason = null;
  if ('errandToggle' in patch) {
    const stop = patch.errandToggle;
    delete patch.errandToggle;
    const now = errandStops();
    const most = data.meta.chains?.max_stops || 4;
    const next = now.includes(stop) ? now.filter((s) => s !== stop) : [...now, stop];
    if (next.length >= 2 && next.length <= most) patch.errandStops = next;
  }
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
  // A round is timed off-peak on a weekday only, and priced nowhere.
  if (state.service === 'errands') return false;
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
  if (service === 'errands') return roundTimes();
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
      slowWalk: Boolean(data.t[service]?.walk_slow),
      fare: fareClause(),
      share: weightedShare(flags, data.pop),
      below: peopleBelow(flags, data.pop),
      compare: compareNote(service, state.mode, standard, weightedShare(flags, data.pop)),
      robust: state.mode === 'best' && !figureOnly ? robustModel(service, standard) : null,
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
/** A figure for part of the population, or NaN when fewer than FEWEST
 *  people are in it: a suburb's most deprived fifth can be a few dozen. */
function ifEnough(weights, mask, value) {
  let people = 0;
  for (let i = 0; i < weights.length; i += 1) if ((!mask || mask[i]) && weights[i] > 0) people += weights[i];
  return people >= FEWEST ? value() : NaN;
}

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
  const curve = (mask) => xs.map((x) => ifEnough(data.pop, mask, () => weightedShare(meetsFlags(best, x), data.pop, mask)));
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
        value: ((mask) => ifEnough(data.pop, mask, () => weightedShare(two, data.pop, mask)))(Uint8Array.from(data.quintile, (v) => (v === k ? 1 : 0))),
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

/** The name of the area being worked out, while one is. */
function scopeName() {
  if (!scopeLevel) return null;
  const where = areaNow();
  return where ? where.area.name : null;
}

/** Each hexagon's local board, by where its centre falls. */
function boardOfCells() {
  const board = data.areas && data.areas.board;
  if (board) return Array.from(board.cell, (b) => (b == null ? null : board.names[b]));
  return Array.from(data.place, (p) => (p != null && data.places[p] ? data.places[p].board || null : null));
}

function areaModel(gaps, weights, standard) {
  if (scopeLevel === 'suburb') return null;
  const levels = scopeLevel ? [['sa2', 'Suburb']] : areaLevels();
  const level = levels.some(([k]) => k === state.areaLevel) ? state.areaLevel : 'sa2';
  const areaOf = level === 'board' ? boardOfCells() : data.place;
  const rows = areaTable(areaOf, gaps, weights, data.nzdep, standard).map((row) => ({
    ...row,
    name: level === 'board' ? row.area : suburbName(row.area),
  }));
  const sorted = sortAreas(rows, state.areaSort === 'share' ? 'share' : 'missing').filter((r) => r.missing > 0);
  lastAreas = { rows: sorted, level, where: scopeName() };
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
    state.group, lastAreas.where ? lastAreas.where.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null,
    lastAreas.live ? 'where-they-live' : null, lastAreas.villagesOut ? 'without-rest-homes' : null,
    lastAreas.missingOnly ? 'missing-only' : null, state.when || 'usual',
    state.budget != null ? `budget-${state.budget}${state.budgetUnit === 'income' ? 'pct' : ''}` : null, label,
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
    // An average over fewer riders than this is too thin to show.
    return total >= FEWEST ? sum / total : NaN;
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

/** The time a home with no way there at all counts as.
 *
 *  A single trip is routed to 60 minutes, so no trip counts as 60. A round is
 *  several legs of up to 60 minutes each, so a missing round counts as longer
 *  than any round that exists, not as a middling one. */
function unreachable(service) {
  const single = data.meta.routing_max_minutes || 60;
  if (service !== 'errands') return single;
  const pace = slowPace() ? (data.meta.chains.usual_pace_kmh || 4.8) / data.meta.chains.slower_pace_kmh : 1;
  return (errandStops().length + 1) * single * pace + 1;
}

function peopleModel() {
  if (state.peopleShow === 'live') return liveModel();
  const service = state.service;
  const standard = standardFor(service);
  const shown = bestTimes(service, state.zonesNow);
  const weights = data.weights[state.group];
  const cap = unreachable(service);

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
      round: roundSummary(),
      modeNote: state.mode !== 'best' && state.service !== 'errands' ? 'Counted by the fastest of walking, low-stress cycling and public transport.' : null,
      q1: quintiles[0].share,
      q5: quintiles[4].share,
      // Both charts show the share missing, so they read the same way.
      byQuintile: quintiles.map((q, k) => ({ label: labels[k], value: Number.isFinite(q.share) ? 1 - q.share : NaN, emphasis: k === 4 })),
      groups: groupChips(),
      byGroup: groups.map((row) => ({
        label: row.label,
        value: row.people >= FEWEST ? row.rate : NaN,
        emphasis: row.key === state.group,
        detail: row.people >= FEWEST && row.rate > 0 && Number.isFinite(row.minutesShort) ? `${Math.round(row.minutesShort)} min` : null,
        title: row.people < FEWEST
          ? `${row.label}: fewer than ${FEWEST} here, too few to give a share`
          : Number.isFinite(row.minutesShort) && row.rate > 0
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

/** Where a group lives in the first place, and whether the places it is
 *  concentrated in can reach the service. For everyone, simply where people
 *  live. */
function liveModel() {
  const service = state.service;
  const standard = standardFor(service);
  const shown = bestTimes(service, state.zonesNow);
  const cap = unreachable(service);
  const gaps = shortfalls(shown, standard, cap);
  const everyone = state.group === 'everyone';
  // Rest homes and retirement villages house people 65 and over by design.
  // Left out, what remains is where people have aged in their own homes.
  const older = state.group === 'older';
  // Where the census suppresses a group's count there is no share to draw, and
  // those residents are left out of the place's share rather than counted as
  // having none of the group.
  const shares = everyone ? null : data.shares[state.group];
  const known = (i) => everyone || Number.isFinite(shares && shares[i]);
  const pop = everyone ? data.pop : Float32Array.from(data.pop, (p, i) => (known(i) ? p : 0));
  const weights = Float32Array.from(data.weights[state.group]);
  // Rest homes and retirement villages house people 65 and over by design.
  // In a hexagon holding part of one, the 65+ are counted block by block, so
  // they can be left out and what remains is where people have aged in place.
  const vil = older ? data.vil : null;
  const villagesOut = Boolean(vil) && !state.liveVillages;
  let inVillages = 0;
  if (vil) {
    for (const i of vil.cells) {
      // Only hexagons being counted: outside an area, or rural ones when only
      // urban areas are counted, have no people here.
      if (!known(i) || !(data.pop[i] > 0)) continue;
      inVillages += vil.older[i];
      weights[i] = villagesOut ? vil.home[i] : vil.home[i] + vil.older[i];
      if (villagesOut) pop[i] = Math.max(0, pop[i] - vil.pop[i]);
    }
  }
  // A hexagon mostly made up of them is marked rather than shaded. A large
  // rural block spreads a few residents thinly over many hexagons, so it takes
  // ten or more to mark one.
  const village = (i) => villagesOut && vil.pop[i] >= 10 && vil.pop[i] >= 0.5 * data.pop[i];
  // For part of the place, a concentration is still set against the whole
  // place's share, as the map is.
  const placeShare = placeRef && placeRef.summary ? placeRef.summary.share : null;
  const summary = whereTheyLive(weights, pop, gaps, placeShare);
  const norcs = older && !(vil && !villagesOut)
    ? (placeRef && placeRef.norcSet) || norcSuburbs(weights, pop, placeShare ?? summary.share)
    : null;
  const keep = state.liveMissing ? Array.from(gaps, (g) => g > 0) : null;
  const noun = GROUP_NOUN[state.group] || 'people';
  // Small groups need a decimal, or a 3% share and its edges round together.
  const digits = !everyone && summary.share < 0.1 ? 1 : 0;

  let classes;
  let colours;
  let legendItems;
  let divider;
  if (everyone) {
    const edges = quartileBreaks(data.pop);
    classes = Int8Array.from(data.pop, (v, i) => (v > 0 && (!keep || keep[i]) ? classify(v, edges) : -1));
    colours = DENSITY;
    legendItems = DENSITY.map((colour, k) => ({
      colour,
      label: k === 0 ? `up to ${edges[0]}` : k === DENSITY.length - 1 ? `over ${edges[edges.length - 1]}` : '',
    }));
  } else {
    const breaks = concentrationBreaks(summary.share);
    classes = concentrationClasses(weights, pop, breaks, keep);
    colours = CONCENTRATION;
    legendItems = CONCENTRATION.map((colour, k) => ({
      colour,
      label: k === 0 ? `under ${percent(breaks[0], digits)}` : `${percent(breaks[k - 1], digits)}+`,
    }));
    divider = 2;
    if (villagesOut) {
      // Marked in a colour of their own, after the scale.
      const mark = CONCENTRATION.length;
      colours = [...CONCENTRATION, VILLAGE];
      for (const i of vil.cells) {
        if (village(i) && (!keep || keep[i])) classes[i] = mark;
      }
    }
  }

  return {
    classes,
    colours,
    tooltip: (i) => {
      const lines = everyone
        ? [`About ${count(data.pop[i])} people`]
        : known(i)
          ? [`About ${count(weights[i])} ${noun}`, `${percent(pop[i] > 0 ? weights[i] / pop[i] : NaN, digits)} of residents`]
          : [`No census count of ${noun} here`];
      if (vil && vil.pop[i] > 0) {
        lines.push(`${villagesOut ? 'Not counted: ' : 'Counted: '}about ${count(vil.older[i])} ${noun} in a rest home or retirement village`);
        if (villagesOut) lines[0] = `About ${count(weights[i])} ${noun} outside it`;
      }
      if (!Number.isFinite(shown[i])) {
        lines.push(service === 'errands' ? 'No round within these limits' : `${SERVICE_SHORT[service]}: no route within ${cap} min`);
      }
      else if (gaps[i] > 0) lines.push(`${SERVICE_SHORT[service]}: ${Math.round(gaps[i] * standard)} min over the standard`);
      else lines.push(`${SERVICE_SHORT[service]}: within ${standard} min`);
      return lines;
    },
    panel: {
      live: true,
      noun: SERVICE_NOUN[service],
      standard,
      group: state.group,
      groups: groupChips(),
      fare: fareClause(),
      missingOnly: state.liveMissing,
      round: roundSummary(),
      summary,
      digits,
      concentrated: CONCENTRATED,
      legend: legendItems,
      divider,
      modeNote: state.mode !== 'best' && state.service !== 'errands' ? 'Counted by the fastest of walking, low-stress cycling and public transport.' : null,
      villages: vil && inVillages >= 10 ? { out: villagesOut, people: inVillages, colour: VILLAGE } : null,
      // Suburbs are flagged as NORCs only on the 65+ outside rest homes and
      // villages; a place with none has nothing to leave out.
      // NORCs are whole suburbs, judged on the whole place: inside a ward, a
      // suburb split by its boundary keeps the status it has on its own.
      norcSet: norcs,
      areas: liveAreas(gaps, weights, pop, standard, norcs),
    },
  };
}

// A suburb is taken to be a naturally occurring retirement community when
// people 65 and over in ordinary homes are at least one and a half times as
// common there as across the place, and number at least this many.
const NORC_PEOPLE = 300;

/** Areas by how many of the group live there, or by their share of residents.
 *
 *  `norcShare` is the place's 65+ share in ordinary homes, given only when
 *  rest homes and villages are left out; suburbs are then flagged as NORCs.
 */
/** Suburbs that are naturally occurring retirement communities: people 65 and
 *  over outside rest homes and villages at least one and a half times as
 *  common there as across the place, and at least NORC_PEOPLE of them. */
function norcSuburbs(weights, pop, share) {
  const older = new Float64Array(data.places.length);
  const people = new Float64Array(data.places.length);
  for (let i = 0; i < data.n; i += 1) {
    const p = data.place[i];
    if (p == null) continue;
    if (weights[i] > 0) older[p] += weights[i];
    if (pop[i] > 0) people[p] += pop[i];
  }
  const out = new Set();
  for (let p = 0; p < older.length; p += 1) {
    if (older[p] >= NORC_PEOPLE && people[p] > 0 && older[p] / people[p] >= CONCENTRATED * share * (1 - 1e-6)) out.add(p);
  }
  return out;
}

/** A suburb's name in a list for part of the place, marked when only part of
 *  the suburb is inside it. */
function suburbName(p) {
  const name = data.places[p] ? data.places[p].name : 'Unnamed area';
  return scopeArea && scopeArea.partial && scopeArea.partial.has(p) ? `${name} (part)` : name;
}

function liveAreas(gaps, weights, pop, standard, norcSet = null) {
  if (scopeLevel === 'suburb') return null;
  const levels = scopeLevel ? [['sa2', 'Suburb']] : areaLevels();
  const level = levels.some(([k]) => k === state.areaLevel) ? state.areaLevel : 'sa2';
  const areaOf = level === 'board' ? boardOfCells() : data.place;
  const residents = new Map(areaTable(areaOf, gaps, pop, data.nzdep, standard).map((row) => [row.area, row.people]));
  const rows = areaTable(areaOf, gaps, weights, data.nzdep, standard).map((row) => ({
    ...row,
    name: level === 'board' ? row.area : suburbName(row.area),
    residents: residents.get(row.area) || 0,
    ofResidents: residents.get(row.area) > 0 ? row.people / residents.get(row.area) : NaN,
  }));
  const flagNorcs = norcSet != null && level === 'sa2';
  if (flagNorcs) {
    for (const row of rows) row.norc = norcSet.has(row.area);
  }
  // Everyone is all of the residents, so a share of them sorts nothing.
  const sort = state.group !== 'everyone' && state.areaSort === 'share' ? 'share' : 'missing';
  // An area of a few dozen people can be almost all one group; a share means
  // more from an area of some size.
  const eligible = sort === 'share' ? rows.filter((r) => r.residents >= 200) : rows;
  // With only the places that miss the standard on the map, the list follows
  // it: the people there who miss out, most first.
  const by = state.liveMissing ? 'missing' : 'people';
  const sorted = [...eligible]
    .filter((r) => r[by] > 0)
    .sort((a, b) => (sort === 'share' ? b.ofResidents - a.ofResidents : b[by] - a[by]) || b[by] - a[by]);
  lastAreas = { rows: sorted, level, live: true, missingOnly: state.liveMissing, norc: flagNorcs, villagesOut: norcSet != null && Boolean(data.vil), where: scopeName() };
  return {
    level,
    levels,
    sort,
    norcs: flagNorcs ? rows.filter((r) => r.norc).length : null,
    norcPeople: flagNorcs ? rows.reduce((sum, r) => sum + (r.norc ? r.people : 0), 0) : null,
    total: sorted.length,
    showAll: state.areaAll,
    rows: state.areaAll ? sorted : sorted.slice(0, 10),
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
  // Inside one suburb, a list of suburbs has one row.
  const ranked = (scopeLevel === 'suburb' ? [] : rankPlaces(data, flags, codes, weights, 10)).map((row) => {
    const byClass = {};
    for (const [code, people] of Object.entries(row.reasons)) {
      const cls = REASON_CLASS[code];
      if (cls != null) byClass[cls] = (byClass[cls] || 0) + people;
    }
    const [main] = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
    const cls = main ? Number(main[0]) : 3;
    const place = data.places[row.place];
    return { index: row.place, name: place ? suburbName(row.place) : 'Unnamed area', below: row.below, colour: REASON_PALETTE[cls], reasonLabel: REASON_GROUPS[cls].label };
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

/** Whether the least-served 40% reach nothing at all, as opposed to there
 *  being too few hexagons to split them off. */
function leastServedNothing(values, weights) {
  const idx = [];
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i]) && weights[i] > 0) idx.push(i);
  idx.sort((a, b) => values[a] - values[b]);
  const total = idx.reduce((s, i) => s + weights[i], 0);
  let running = 0;
  let low = 0;
  let lowW = 0;
  for (const i of idx) {
    running += weights[i];
    if (running / total > 0.4) break;
    low += values[i] * weights[i];
    lowW += weights[i];
  }
  return lowW > 0 && low === 0;
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
    value: ((mask) => ifEnough(data.pop, mask, () => weightedMedian(share, data.pop, mask)))(Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0))),
    emphasis: k === 4,
  }));
  const byGroup = groupChips().map(([g, label]) => ({ label, value: ifEnough(data.weights[g], null, () => weightedMedian(share, data.weights[g])) }));
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
      lowNothing: leastServedNothing(share, data.pop),
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
        value: ((mask) => ifEnough(data.pop, mask, () => weightedMedian(values, data.pop, mask)))(Uint8Array.from(data.quintile, (v) => (v === q ? 1 : 0))),
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

// ---------------------------------------------------------------- errand rounds

let chainsLoading = null;

// A round starts on the three everyday stops; the others are added by hand.
const FIRST_ROUND = ['gp', 'pharmacy', 'supermarket'];

/** The stops of the round on screen, in the order the build lists them. */
function errandStops() {
  const all = data?.meta?.chains?.stops || [];
  const most = data?.meta?.chains?.max_stops || all.length;
  const start = FIRST_ROUND.filter((s) => all.includes(s));
  const chosen = (state.errandStops || (start.length >= 2 ? start : all)).filter((s) => all.includes(s));
  const ok = chosen.length >= 2 && chosen.length <= most;
  return all.filter((s) => (ok ? chosen : start.length >= 2 ? start : all.slice(0, most)).includes(s));
}

function slowPace() {
  return state.pace === 'slow' && state.errandMode !== 'bike_low_stress' && Boolean(data.meta.chains?.slower_pace_kmh);
}

/** Minutes of travel for the quickest round from each hexagon, as chosen. */
function roundTimes() {
  const set = errandStops().join('+');
  const mode = state.errandMode + (slowPace() ? '_slow' : '');
  const key = `round|${set}|${mode}|${state.errandLeg}`;
  if (!cache.best.has(key)) {
    const values = data.roundSets?.[set]?.modes?.[mode]?.[state.errandLeg];
    cache.best.set(key, values ? Float32Array.from(values, (v) => (v == null ? NaN : v)) : new Float32Array(data.n).fill(NaN));
  }
  return cache.best.get(key);
}

/** Whether the rounds for the stops on screen have arrived, fetching them if not.
 *  The index comes first, then one file per set of stops as each is picked. */
function roundsReady() {
  if (!data.chains) {
    requestChains();
    return false;
  }
  const set = errandStops().join('+');
  if (data.roundSets?.[set]) return true;
  requestSet(set);
  return false;
}

const setsLoading = new Set();

function requestSet(set) {
  const file = data.chains.sets?.[set];
  if (!file || setsLoading.has(set)) return;
  setsLoading.add(set);
  fetchJson(`${DATA_BASE}${CITY}/chains/`, file).then((body) => {
    data.roundSets = { ...(data.roundSets || {}), [set]: body };
    setsLoading.delete(set);
    update();
  }).catch((error) => {
    setsLoading.delete(set);
    console.warn('An errand round could not be loaded.', error);
    if (state.service === 'errands' && state.measure !== 'score') {
      $('view').replaceChildren(el('p', 'note', 'This errand round could not be loaded. Reload the page to try again.'));
    }
  });
}

/** The rounds are read only when the view is opened. */
function requestChains() {
  if (chainsLoading) return;
  chainsLoading = fetchJson(`${DATA_BASE}${CITY}/`, 'chains').then((chains) => {
    data.chains = chains;
    cache.best.clear();
    update();
  }).catch((error) => {
    chainsLoading = null;
    console.warn('The errand rounds could not be loaded.', error);
    if (state.service === 'errands' && state.measure !== 'score') {
      $('view').replaceChildren(el('p', 'note', 'The errand rounds could not be loaded. Reload the page to try again.'));
    }
  });
}

/** One trip on its own to the first stop, the same way and at the same pace,
 *  to set the round against. */
function singleTrip(stop) {
  const t = data.t[stop];
  if (!t) return null;
  const factor = slowPace() ? (data.meta.chains.usual_pace_kmh || 4.8) / data.meta.chains.slower_pace_kmh : 1;
  const walk = t.walk ? Float32Array.from(t.walk, (v) => v * factor) : null;
  let shown;
  if (state.errandMode === 'walk') shown = walk;
  else if (state.errandMode === 'bike_low_stress') shown = t.bike_low_stress;
  else {
    const pt = slowPace() ? data.tSlow?.[stop] : data.usual.t[stop];
    if (!pt || !walk) return null;
    shown = Float32Array.from(walk, (v, i) => Math.min(Number.isFinite(v) ? v : Infinity, Number.isFinite(pt[i]) ? pt[i] : Infinity));
  }
  if (!shown) return null;
  const standard = standardFor(stop);
  return { stop, standard, share: weightedShare(meetsFlags(shown, standard), data.pop) };
}

/** How the round on screen is made, for the sentences of other views. */
function roundSummary() {
  if (state.service !== 'errands') return null;
  return { stops: errandStops(), mode: state.errandMode, slow: slowPace(), leg: state.errandLeg };
}

function errandModel() {
  const standard = standardFor('errands');
  const shown = roundTimes();
  const edges = accessBreaks(standard);
  const classes = new Int8Array(data.n);
  for (let i = 0; i < data.n; i += 1) {
    const v = shown[i];
    classes[i] = Number.isFinite(v) ? classify(v, edges) : data.pop[i] > 0 ? 5 : -1;
  }
  const flags = meetsFlags(shown, standard);
  const top = edges[4] >= 60 ? 'over 60' : `over ${edges[4]}`;
  const labels = [`${edges[0]} or less`, `${edges[0]}–${edges[1]}`, `${edges[1]}–${standard}`, `${standard}–${edges[3]}`,
    edges[4] > edges[3] ? `${edges[3]}–${edges[4]}` : null, `${top} or none`];
  const spec = data.meta.chains;
  const stops = errandStops();
  const windowSpec = (data.meta.windows || {})[spec.window] || {};
  return {
    classes,
    colours: ACCESS,
    tooltip: (i) => [Number.isFinite(shown[i]) ? `Round: ${Math.round(shown[i])} min of travel` : 'No round within reach', `Standard: within ${standard} min`],
    panel: {
      standard,
      stops,
      allStops: spec.stops,
      maxStops: spec.max_stops || spec.stops.length,
      mode: state.errandMode,
      modes: spec.modes,
      slow: slowPace(),
      slowKmh: spec.slower_pace_kmh,
      leg: state.errandLeg,
      legLimits: spec.leg_limits,
      candidates: data.chains?.candidates || 5,
      windowText: windowSpec.phrase || 'off-peak on a weekday',
      share: weightedShare(flags, data.pop),
      below: peopleBelow(flags, data.pop),
      single: singleTrip(stops.includes('gp') ? 'gp' : stops[0]),
      legend: labels.map((label, k) => (label ? { colour: ACCESS[k], label } : null)).filter(Boolean),
    },
  };
}

/** Whether what is on screen reads the part of the data sent after the map. */
/** Whether this view has figures that can be given for part of the place. */
function hasFigures() {
  if (state.view === 'fixes' && (state.service === 'jobs' || state.service === 'errands') && state.measure !== 'score') return false;
  return true;
}

function needsMore() {
  if (data.complete) return false;
  return state.measure === 'score' || state.service === 'jobs' || state.view === 'fixes'
    || ['fare', 'burden', 'choice'].includes(state.show) || state.budget != null;
}

function compute() {
  const waiting = { waiting: true, classes: new Int8Array(data.n).fill(-1), colours: ACCESS, tooltip: () => ['Loading…'], panel: {} };
  if (needsMore()) return waiting;
  if (state.service === 'errands' && state.measure !== 'score') {
    state.zonesNow = null;
    if (!roundsReady()) return waiting;
    if (state.view === 'access') return errandModel();
    if (state.view === 'people') return peopleModel();
    return { classes: new Int8Array(data.n).fill(-1), colours: ACCESS, tooltip: () => [], panel: { note: true } };
  }
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

// ---------------------------------------------------------------- areas

/** Which council, ward, local board and suburb each hexagon is in. Built on
 *  everyone, so the areas do not change when only urban areas are counted. */
function prepareScope() {
  const centres = data.h3.map((id) => h3.cellToLatLng(id));
  cellOf = new Map(data.h3.map((id, i) => [id, i]));
  scope = buildAreas({ n: data.n, pop: data.everywhere.pop, place: data.place, places: data.places, areas: data.areas }, centres);
  figureCache.clear();
}

/** The hexagon at a point, or the nearest one within two rings of it. */
function cellNear(lat, lng) {
  if (!cellOf) return null;
  const id = h3.latLngToCell(lat, lng, 9);
  if (cellOf.has(id)) return cellOf.get(id);
  for (const k of [1, 2]) {
    for (const near of h3.gridDisk(id, k)) if (cellOf.has(near)) return cellOf.get(near);
  }
  return null;
}

/** The middle of the part of the map the panel leaves clear. It uses the
 *  same margins whether a phone's panel is open or folded, so opening it does
 *  not change which area the figures are for. */
function visibleCentre() {
  const box = map.getContainer().getBoundingClientRect();
  const pad = placePadding();
  return map.unproject([(pad.left + box.width - pad.right) / 2, (pad.top + box.height - pad.bottom) / 2]);
}

/** The area the panel's figures are for, with the areas around it, largest
 *  first; or null for the whole place. */
function areaNow() {
  if (!scope || !map) return null;
  const pin = state.areaPin;
  if (pin) {
    if (pin.level === 'place') return null;
    const found = pin.name ? areaNamed(scope, pin.level, pin.name) : null;
    if (found) return found;
    state.areaPin = null;
  }
  const centre = visibleCentre();
  const chain = chainAt(scope, cellNear(centre.lat, centre.lng));
  const area = pickArea(chain, map.getZoom(), centre.lat);
  // The areas around it are the ones most of its people live in, as they
  // would be for a link to it.
  return area ? chainOf(scope, area.level, area.id) : null;
}

// How an area is named in a sentence, and on its own.
function areaPhrase(area) {
  return area.level === 'board' ? `the ${area.name} Local Board area` : area.name;
}

function areaLabel(area) {
  return area.level === 'board' ? `${area.name} Local Board` : area.name;
}

/** Go to an area and show its figures until the map is moved by hand. */
function goToArea(pin, bbox) {
  state.areaPin = pin;
  userMoved = false;
  if (bbox) {
    const pad = placePadding();
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: pad.top + 30, bottom: pad.bottom + 30, left: pad.left + 30, right: pad.right + 30 }, maxZoom: 15, duration: 600,
    });
  }
  schedule();
}

function goToPlace() {
  state.areaPin = { level: 'place' };
  userMoved = false;
  map.fitBounds(regionBounds(), { padding: placePadding(), duration: 600 });
  schedule();
}

/** Room around the whole place when it is fitted to the map, clear of the panel. */
function placePadding() {
  return window.matchMedia('(max-width: 760px)').matches
    ? { top: 120, bottom: 110, left: 16, right: 16 }
    : { top: 30, bottom: 30, left: 390, right: 30 };
}

/** When the map settles somewhere with a different area, redraw the panel. */
function refreshArea() {
  if (userMoved) state.areaPin = null;
  userMoved = false;
  const where = areaNow();
  const key = where ? `${where.area.level}:${where.area.id}` : '';
  if (key !== areaKey) schedule();
}

// Population and group counts outside an area set to nothing. Cached for the
// arrays they were made from, which change with the urban setting and when
// the rest of the data arrives.
const maskedCache = new WeakMap();

function maskedArrays(area) {
  if (!maskedCache.has(data.pop)) maskedCache.set(data.pop, new Map());
  const byArea = maskedCache.get(data.pop);
  const key = `${area.level}:${area.id}`;
  if (!byArea.has(key)) {
    const mask = maskFor(scope, area);
    const cut = (w) => Float32Array.from(w, (v, i) => (mask[i] ? v : 0));
    const pop = cut(data.pop);
    const weights = Object.fromEntries(Object.entries(data.weights).map(([k, w]) => [k, k === 'everyone' ? pop : cut(w)]));
    let people = 0;
    for (let i = 0; i < pop.length; i += 1) if (pop[i] > 0) people += pop[i];
    // Suburbs with some of their people outside the area.
    const inside = new Float64Array(data.places.length);
    const all = new Float64Array(data.places.length);
    for (let i = 0; i < data.n; i += 1) {
      const p = data.place[i];
      if (p == null || !(scope.pop[i] > 0)) continue;
      all[p] += scope.pop[i];
      if (mask[i]) inside[p] += scope.pop[i];
    }
    const partial = new Set();
    for (let p = 0; p < all.length; p += 1) if (inside[p] > 0 && inside[p] < 0.98 * all[p]) partial.add(p);
    byArea.set(key, { pop, weights, people, partial });
  }
  return byArea.get(key);
}

/** The model worked out for the people in an area only. The map keeps the
 *  whole place's colours and key; definitions that are set against the whole
 *  place, such as a concentration of older people, stay set against it. */
function scopedModel(area, whole) {
  const masked = maskedArrays(area);
  if (!(masked.people > 0)) return { empty: true, panel: { where: areaPhrase(area) } };
  const base = { pop: data.pop, weights: data.weights };
  data.pop = masked.pop;
  data.weights = masked.weights;
  placeRef = whole.panel;
  scopeLevel = area.level;
  scopeArea = { ...area, partial: masked.partial };
  let model;
  try {
    model = compute();
  } finally {
    data.pop = base.pop;
    data.weights = base.weights;
    placeRef = null;
    scopeLevel = null;
    scopeArea = null;
  }
  if (model.waiting) return model;
  return {
    ...model,
    panel: {
      ...model.panel,
      legend: whole.panel.legend,
      divider: whole.panel.divider,
      digits: whole.panel.digits ?? model.panel.digits,
      where: areaPhrase(area),
      small: area.level === 'suburb',
      whole: whole.panel,
      // Within one suburb, which end of the deprivation scale gets more is a
      // question of a few blocks, so it is not asked.
      ...(area.level === 'suburb' ? { lean: NaN, leanText: null } : {}),
    },
  };
}

/** A view's headline figure, as its panel would show it. */
function figureOf(model) {
  if (!model || model.waiting || model.empty) return null;
  const box = el('div');
  try {
    renderInto(box, model);
  } catch (error) {
    return null;
  }
  return box.querySelector('.hero-figure')?.textContent || null;
}

/** The same figure for the areas around this one and for the whole place,
 *  nearest first, each a link to go there. */
function aroundFigures(where) {
  const sig = `${JSON.stringify(state, (k, v) => (k === 'selected' || k === 'areaPin' ? undefined : v))}|${data.complete}`;
  if (figureCache.size > 200) figureCache.clear();
  const cached = (key, make) => {
    const full = `${sig}|${key}`;
    if (!figureCache.has(full)) figureCache.set(full, make());
    return figureCache.get(full);
  };
  const rows = where.chain.slice(0, -1).reverse().map((area) => ({
    label: areaLabel(area),
    figure: cached(`${area.level}:${area.id}`, () => {
      // Working these out redraws the area lists; the download keeps the one shown.
      const kept = lastAreas;
      figureOnly = true;
      try {
        return figureOf(scopedModel(area, current));
      } finally {
        figureOnly = false;
        lastAreas = kept;
      }
    }),
    go: () => goToArea({ level: area.level, name: area.name }, area.bbox),
  }));
  rows.push({ label: place.name, figure: cached('place', () => figureOf(current)), go: goToPlace });
  return rows.filter((row) => row.figure);
}

/** The line under the headline with the areas around this one. */
function renderAround(rows) {
  const heroBox = $('view').querySelector('.hero');
  if (!heroBox) return;
  // A view can lead with a ratio in one area and an average in another (the
  // fare burden does, where one end of the deprivation scale is missing).
  // Only figures of the same kind as the headline sit beside it.
  const kind = (text) => (/×$/.test(text) ? 'times' : /%$/.test(text) ? 'share' : /^[\d,.]+$/.test(text) ? 'number' : 'other');
  const own = kind(heroBox.querySelector('.hero-figure')?.textContent || '');
  rows = rows.filter((row) => kind(row.figure) === own && own !== 'other');
  if (!rows.length) return;
  const line = el('p', 'hero-whole');
  rows.forEach((row, k) => {
    if (k) line.append(document.createTextNode(' · '));
    const button = el('button', 'hero-whole-item');
    button.type = 'button';
    button.title = `Show the figures for ${row.label}`;
    button.append(el('span', null, `${row.label} `), el('strong', null, row.figure));
    button.addEventListener('click', row.go);
    line.append(button);
  });
  heroBox.append(line);
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
  const fallback = state.service === 'errands' ? data.meta.chains.standard_minutes : data.meta.services[state.service].standard_minutes;
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
  if (model.waiting) {
    if (!score) {
      renderServicePicker($('service-picker'), state.service, set);
      for (const tab of document.querySelectorAll('[role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
    }
    $('view').replaceChildren(el('p', 'note', 'Loading the rest of the data for this view…'));
    return;
  }
  if (!score) {
    renderServicePicker($('service-picker'), state.service, set);
    for (const tab of document.querySelectorAll('[role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
    $('view').setAttribute('aria-labelledby', `tab-${state.view}`);
  }
  if (model.empty) {
    $('view').replaceChildren(el('div', 'hero', null));
    $('view').firstChild.append(el('p', 'hero-text', `Nobody in ${model.panel.where} is counted with these settings.`));
    return;
  }
  renderInto($('view'), model);
}

/** The panel for a model, drawn into any element. */
function renderInto(root, model) {
  if (state.measure === 'score') {
    renderScore(root, model.panel, set);
    return;
  }
  if (state.service === 'jobs') {
    if (state.view === 'access') renderJobsAccess(root, model.panel, set);
    else if (state.view === 'people') renderJobsPeople(root, model.panel);
    else renderJobsFixes(root);
    return;
  }
  if (state.service === 'errands') {
    if (state.view === 'access') renderErrands(root, model.panel, set);
    else if (state.view === 'people') renderPeople(root, model.panel, set);
    else root.replaceChildren(el('p', 'note', 'What would help is worked out for single trips. Pick one of the stops to see it.'));
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

function renderMini(area = null) {
  if (area && shown && shown.empty) {
    $('mini').textContent = `${areaLabel(area)} · nobody counted with these settings`;
    return;
  }
  if (area) {
    const masked = maskedArrays(area);
    const base = data.pop;
    data.pop = masked.pop;
    try {
      miniLine();
    } finally {
      data.pop = base;
    }
    $('mini').textContent = `${areaLabel(area)} · ${$('mini').textContent}`;
    return;
  }
  miniLine();
}

function miniLine() {
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
    const panel = shown && shown.panel;
    const median = panel ? panel.median : NaN;
    const figure = panel && panel.fair
      ? `${Number.isFinite(median) ? median.toFixed(2) : '–'}× the average`
      : `${Number.isFinite(median) ? median.toFixed(median < 10 ? 1 : 0) : '–'}% of jobs`;
    const limit = panel ? panel.limit : jobsChoice().limit;
    const extra = panel && panel.priced ? panel.fare : (jobsChoice().mode === 'pt' ? whenClause('jobs') : '');
    mini.textContent = `Jobs · typical resident reaches ${figure} within ${limit} min${extra}`;
    return;
  }
  if (state.service === 'errands') {
    const share = data.roundSets?.[errandStops().join('+')] ? weightedShare(meetsFlags(roundTimes(), standardFor('errands')), data.pop) : NaN;
    const leg = state.errandLeg === 'any' ? '' : `, stretches ≤ ${state.errandLeg} min`;
    mini.textContent = `Errand round · ${Number.isFinite(share) ? `${Math.round(share * 100)}%` : '…'} within ${standardFor('errands')} min${leg}`;
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
  if (redrawKey && state.service !== lastService) redrawKey();
  // The panel is worth drawing even when the basemap has not arrived.
  try {
    paintCells(map, current.classes, current.colours);
  } catch (error) {
    console.warn('The map is not ready to paint yet.', error);
  }
  const t2 = performance.now();
  if (current.waiting) {
    // The controls for this view read the data still on its way; they are
    // drawn when it arrives.
    shown = current;
    renderView(current);
    return;
  }
  // Zoomed in on part of the place, the panel's figures are for that part,
  // with the areas around it and the whole place on a line underneath.
  const where = areaNow();
  areaKey = where ? `${where.area.level}:${where.area.id}` : '';
  const t3 = performance.now();
  shown = where && hasFigures() ? scopedModel(where.area, current) : current;
  if (shown.waiting) shown = current;
  renderWhere();
  renderWhen();
  renderStandard();
  renderBudget();
  renderTravellerLine();
  renderView(shown);
  if (shown !== current) renderAround(aroundFigures(where));
  const t4 = performance.now();
  renderSettings();
  renderMini(shown !== current ? where.area : null);
  restoreFocus(focused);
  announce();
  window.team.timing = { compute: Math.round(t1 - t0), paint: Math.round(t2 - t1), panel: Math.round(performance.now() - t2), area: Math.round(t4 - t3) };
  try {
    showDestinationsFor(map, state.service === 'jobs' || state.service === 'errands' || state.measure === 'score' ? null : state.service);
  } catch (error) {
    console.warn('Destination pins are not ready yet.', error);
  }
  if (state.selected != null) showPlace(state.selected);
}

function showPlace(i) {
  $('place').hidden = false;
  document.body.dataset.place = 'open';
  if (!data.complete) {
    // The card reads the measures sent after the map; it is drawn again when
    // they arrive.
    $('place-title').textContent = placeName(i);
    $('place-sub').textContent = '';
    $('place-body').replaceChildren(el('p', 'note', 'Loading the details for this place…'));
    return;
  }
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
    lastService = state.service;
    const rows = [];
    for (const [key, spec] of Object.entries(OVERLAYS)) {
      if (!shown.has(key) || !spec.key) continue;
      for (const entry of spec.key) {
        const row = el('div', 'key-row');
        const swatch = el('span', `key-swatch key-${entry.swatch}`);
        swatch.style.setProperty('--swatch', entry.colour || DESTINATION_COLOURS[state.service] || DESTINATION_OTHER);
        row.append(swatch, el('span', 'key-label', entry.label));
        rows.push(row);
      }
    }
    mapKey.replaceChildren(...rows);
    mapKey.hidden = rows.length === 0;
  };
  redrawKey = drawKey;
  for (const [key, spec] of Object.entries(OVERLAYS)) {
    const label = el('label', 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      state.overlays[key] = box.checked;
      applyOverlays();
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
    tooltip.hidden = true;
    new window.maplibregl.Popup({ closeButton: true, offset: 10, className: 'point-popup' })
      .setLngLat(lngLat)
      .setDOMContent(box)
      .addTo(map);
  }, {
    hover({ kind, properties }, point) {
      const title = kind === 'stop' ? 'Public transport stop' : (properties.name || 'Unnamed');
      const services = String(properties.services || '').replace(/[[\]"]/g, '').split(',').filter(Boolean);
      const named = kind === 'stop' ? '' : services.map((id) => SERVICE_SHORT[id.trim()] || id.trim()).join(', ');
      showTooltip([el('strong', null, title), named ? el('span', null, named) : null,
        el('span', 'tooltip-hint', kind === 'stop' ? 'Click for departures' : 'Click for details')], point);
    },
    leave() {
      tooltip.hidden = true;
    },
  });

  const tooltip = $('tooltip');
  function showTooltip(lines, point) {
    tooltip.replaceChildren(...lines.filter(Boolean));
    tooltip.hidden = false;
    // Keep the tooltip clear of the place panel and the window edge.
    const room = window.innerWidth - ($('place').hidden ? 0 : 360);
    const x = Math.round(point.x + 14);
    const y = Math.round(point.y + 14);
    tooltip.style.transform = point.x + 300 > room
      ? `translate(${Math.round(point.x - 14)}px, ${y}px) translateX(-100%)`
      : `translate(${x}px, ${y}px)`;
  }
  onCells(map, {
    hover(i, point) {
      if (!current) return;
      showTooltip([el('strong', null, placeName(i)), ...current.tooltip(i).map((line) => el('span', null, line))], point);
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
  // A move by hand lets the panel follow the map again.
  const byHand = (event) => {
    if (event.originalEvent) userMoved = true;
  };
  map.on('movestart', byHand);
  map.on('zoomstart', byHand);
  map.on('wheel', () => { userMoved = true; });
  map.on('dragstart', () => { userMoved = true; });
  map.on('moveend', () => {
    refreshArea();
    writeHash();
  });
}


// The map key names the destination's colour, which changes with the service.
let redrawKey = null;
let lastService = null;

/** Show the layers ticked in the Layers menu. A tick made before the basemap
 *  style has arrived is kept and applied when it does. */
function applyOverlays() {
  if (!map) return;
  for (const [key, on] of Object.entries(state.overlays)) {
    try {
      setOverlay(map, key, on);
    } catch {
      // The style is not in yet; adding the layers applies every tick again.
    }
  }
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
    + `${(index.totals.population / 1e6).toFixed(1)} million people in ${index.totals.cities} New Zealand cities and towns. `
    + 'Pick a place to open its map.';
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
    const open = el('span', 'start-open', 'Open the map');
    open.setAttribute('aria-hidden', 'true');
    button.append(thumb, head, stats, open);
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
      el('span', 'start-go', '›'),
    );
    button.setAttribute('aria-label', `${city.place}, ${count(city.population)} people, ${everyday(city)} reach all three everyday services, `
      + `${jobs(city)} jobs by public transport in 45 minutes`);
    button.addEventListener('click', () => goToCity(city.slug));
    return button;
  }));
  const built = new Date(`${index.built}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  $('start-note').textContent = 'Each place takes in the towns and rural land that commute into it, as Stats NZ draws '
    + `its functional urban areas. Timetables from September 2026, 2023 Census. Built ${built}. Version ${index.version}.`;
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
  // For checks from the console and tests: the area the panel is for.
  window.team = { map, state, area: () => { const w = areaNow(); return w && { level: w.area.level, name: w.area.name, chain: w.chain.map((a) => a.name) }; } };
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
    const index = await fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    const city = index && index.cities.find((c) => c.slug === CITY);
    const box = $('loading');
    if (index && !city) {
      const link = el('a', null, 'See the places TEAM covers');
      link.href = '?places';
      box.replaceChildren(document.createTextNode(`TEAM has no place called "${CITY}". `), link);
    } else if (window.location.protocol === 'file:') {
      box.textContent = 'The data could not be loaded. Serve the folder over HTTP rather than opening the file.';
    } else {
      // Most often a connection that dropped part way through the download.
      const again = el('button', 'text-button', 'Try again');
      again.type = 'button';
      again.addEventListener('click', () => window.location.reload());
      box.replaceChildren(document.createTextNode(`The map data for ${city ? city.place : 'this place'} did not finish loading. `), again);
    }
    // The picker still works, so another place is one step away.
    if (index) wireCityPicker(index, CITY);
    throw error;
  }
  rememberCity(CITY);
  setServices(data.meta);
  if (!SERVICE_ORDER.includes(state.service)) state.service = SERVICE_ORDER[0];
  if (state.when && !(data.meta.windows || {})[state.when]) state.when = null;
  // A link can carry values this city does not have; fall back rather than fail.
  if (!data.weights[state.group]) state.group = 'everyone';
  prepareScope();
  if (state.urbanOnly) setUrban(data, true);
  const profiles = ((data.meta.fares || {}).profiles || []).map((p) => p.key);
  if (profiles.length && !profiles.includes(state.profile)) state.profile = profiles.includes('adult') ? 'adult' : profiles[0];
  if (!MODES[state.mode]) state.mode = 'best';
  // A link to the slower pace, opened on a place built without one.
  if (state.mode === 'walk_slow' && !Object.values(data.t)[0]?.walk_slow) state.mode = 'walk';
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
    applyOverlays();
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
  if (!data.complete) {
    // The rest of the data follows the map. When it arrives the whole set is
    // rebuilt with the settings already chosen, and whatever is open is drawn
    // again, including a view that was waiting for it.
    loadMore(`${DATA_BASE}${CITY}/`, data).then((full) => {
      full.chains = data.chains;
      full.roundSets = data.roundSets;
      data = full;
      prepareScope();
      if (state.urbanOnly) setUrban(data, true);
      setWindow(data, state.when);
      cache.best.clear();
      cache.routed.clear();
      update();
    }).catch((error) => {
      console.warn('The rest of the data could not be loaded.', error);
      $('loading').hidden = false;
      $('loading').textContent = 'Some views could not load. Reload the page to try again.';
    });
  }
  if (at) {
    const [zoom, lat, lng] = at.split('/').map(Number);
    if ([zoom, lat, lng].every(Number.isFinite)) map.jumpTo({ center: [lng, lat], zoom });
  } else {
    // Opened on the whole place, its figures are the whole place's until the
    // map is moved, however large the screen.
    if (!state.areaPin) state.areaPin = { level: 'place' };
    map.fitBounds(regionBounds(), { padding: placePadding(), duration: 0 });
  }
  $('loading').hidden = true;
  // Network lines only show when a layer is switched on, so they load after the first view.
  fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((index) => { if (index) wireCityPicker(index, CITY); })
    .catch(() => { /* one city on its own still works */ });
}

init();
