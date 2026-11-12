// TEAM web app: state, derived figures, map colours and panels.

import { renderAbout } from './about.js';
import { ageGroupFor, ageWords, schoolAgeKey, splitKey } from './ages.js';
import {
  byQuintile, decileBands, FEWEST, fetchJson, load, loadMore, loadOverlays, meetsFlags, peopleBelow, peopleByReason, pricedLayer, rankPlaces,
  choiceWithin, defaultStandard, reasons as reasonCodes, setAgeGroup, setCellShare, settingsChanged, setUrban, setWindow, times, tripTime, USUAL,
  weightedMedian, weightedShare, windowOf, windowsFor, ageArray,
} from './data.js';
import {
  byGroup as shortfallByGroup, concentrationBreaks, concentrationClasses, concentrationIndex, CONCENTRATED, fgt, leaning,
  pricedOut, shortfallLeaning, shortfalls, whereTheyLive,
} from './equity.js';
import {
  affordableZones, budgetSentence, burdenClass, cheapestFareClasses, cheapestZones, dailyIncome, fare,
  fareClassCosts, fareSteps, freeTravel, hasCaps, incomeZones, money, paymentKey, payments,
  weekCost, zoneCap,
} from './fares.js';
import { count, el, minutes, MODES, percent, place } from './format.js';
import {
  BASEMAPS, boundsOf, cellAtPoint, cellCollection, createMap, elementControl, fadeCells, fitPlace, onCells, onPoints, OVERLAYS, paintCells,
  select, setBasemap, setCells, setHatch, setOverlay, setOverlays, setPicking, setSchoolPins, setSchoolStops, setSchoolZone, setTrip, showDestinationsFor,
} from './map.js';
import {
  ACCESS, accessBreaks, classify, CONCENTRATION, DECILE, DENSITY, DESTINATION_COLOURS, DESTINATION_OTHER, FADED, FAIR,
  FAIR_BREAKS, FARE, JOBS, JOBS_BREAKS,
  PEOPLE, quartileBreaks, REASON_CLASS, REASON_GROUPS, REASON_PALETTE, SCORE, SCORE_BREAKS, VILLAGE,
} from './palette.js';
import {
  goalGroups, renderAccess, renderErrands, renderFareSurface, renderFixes, renderGoalPicker, renderJobsAccess, renderJobsFixes, renderNeedsZone,
  renderJobsPeople, renderBurden, renderChips, renderChoice, renderModePicker, renderPeople, renderSchools, renderScore, renderTraveller,
  groupPhrase, renderWhenPicker, SERVICE_NOUN, SERVICE_ORDER, SERVICE_PLURAL, SERVICE_SHORT, setCounted, setServices, shortScaleLabel, travelOptions,
} from './panel.js';
import { areaCsv, areaTable, sortAreas } from './areas.js';
import { nearestCity } from './cities.js';
import { placeHeader, renderPlace, tooltipLines } from './place.js';
import { areaNamed, buildAreas, chainAt, chainOf, maskFor, pickArea } from './scope.js';
import {
  ALL_CHOICE, applyToData, cardLines, choiceKey, choiceParams, choiceWords, chooseSchools, countingLine, decodeReach, decodeStops, decodeZones,
  DEFAULT_CHOICE, findSchools, formatOk, hasAttributes, isSchoolService, isZoned, listAnswers, noZoneSentence, ptCsvLine, readChoice, readSchoolsMeta,
  REACH_MODES, restoreData, schoolByMoe, schoolFacts, schoolsCsv, farStopsHeading, isFarStop, stopLine, stopsAt, stopsCsvLines, stopsIntro,
  stopsSplit, stopsSummary, tagOf, windowWords,
  zoneDates, zoneEntry, zoneShares,
} from './schools.js';

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
// MATE's sections (mobility profiles) are a preview, shown only with ?mate=1
// in the address. Without it nothing here changes and mate.js never loads.
const MATE = new URLSearchParams(window.location.search).get('mate') === '1';
// The places MATE has data for (mate.js PLACES), known before mate.js loads;
// trips and mobility profiles are offered there only.
const MATE_PLACES = ['auckland'];
let mate = null;
let mateImport = null;
// The MATE settings (mp=) from the address, until mate.js reads them.
let mateParams = null;
// The hexagon picked (o=) from the address, until the data is in.
let linkedCell = null;
// A trip's destination (d=, with ?mate=1 in Auckland), likewise.
let linkedDest = null;
const mateState = { profile: 'manual_wheelchair', dark: false, view: 'nkb', map: true };
const VIEWS = ['access', 'people', 'fixes'];
// Which groups exist depends on the census tables the build had, so they come
// from the data rather than being listed here.
// The groups the figures can be for. Under a service that counts children
// of one age, everyone is those children, and the groups that mean nothing
// among them (under 15, 65 and over) are left out.
const groupKeys = () => Object.keys(data.meta.groups || { everyone: 'Everyone' }).filter((g) => g === 'everyone' || data.weights[g]);
const groupChips = () => {
  const words = countedWords();
  return groupKeys().map((g) => [g, g === 'everyone' && words.key ? capitalise(words.many) : (data.meta.groups || {})[g] || g]);
};
/** The group the figures are for: the one picked, or everyone where it is not
 *  counted under the service on screen. */
const groupNow = () => (data && data.weights[state.group] ? state.group : 'everyone');
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
  // Which schools count for a school service: all, state, zone or one, with
  // the Ministry number of the one, girls and boys together or one of them,
  // and whether One school counts only its zone (schools.js).
  schools: { ...DEFAULT_CHOICE },
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
// What the map is painted with: the view on screen, or MATE's catchment.
let painted = null;

// ---------------------------------------------------------------- state and URL

function standardFor(service) {
  return state.standard[service] ?? defaultStandard(data, service);
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
  state.schools = readChoice(params.get('sch'), params.get('stu'), params.get('sz'));
  // A school link made before 0.12.0 round 2 for a fare, a fare burden or a
  // fare budget has no sch; fares are worked out for all schools only, so it
  // opens All, as it was made.
  if (!params.has('sch') && isSchoolService(state.service) && (['fare', 'burden'].includes(state.show) || state.budget != null)) {
    state.schools = { ...ALL_CHOICE };
  }
  const cell = params.get('o');
  if (cell && /^[0-9a-f]{15}$/.test(cell)) linkedCell = cell;
  const dest = params.get('d');
  if (MATE && dest && /^[0-9a-f]{15}$/.test(dest)) linkedDest = dest;
  if (MATE) mateParams = params;
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
  // The schools counted, only where a school service is on screen.
  if (schoolsAvailable()) for (const [key, value] of choiceParams(state.schools)) params.set(key, value);
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
  if (groupNow() !== 'everyone') params.set('g', groupNow());
  const where = areaNow();
  if (where) params.set('r', `${where.area.level}.${where.area.name}`);
  else if (state.areaPin && state.areaPin.level === 'place') params.set('r', 'place');
  if (state.basemap !== 'light') params.set('b', state.basemap);
  // The hexagon picked, so a link opens the same card.
  if (state.selected != null && data.h3[state.selected]) params.set('o', data.h3[state.selected]);
  if (tripOpen()) params.set('d', data.h3[card.dest]);
  if (MATE) {
    if (mate) params.set('mp', mate.mateHash(mateState));
    else if (mateParams?.get('mp')) params.set('mp', mateParams.get('mp'));
  }
  if (map) {
    const c = map.getCenter();
    params.set('at', `${map.getZoom().toFixed(1)}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`);
  }
  // A school number reads as sch=one:69, which is how it is written by hand.
  window.history.replaceState(null, '', `#${params.toString().replace(/(^|&)sch=one%3A(\d+)/, '$1sch=one:$2')}`);
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
  if ('schoolCsv' in patch) {
    downloadSchools();
    return;
  }
  if ('schoolSearching' in patch) {
    schoolUi.searching = patch.schoolSearching;
    if ('schoolQuery' in patch) schoolUi.query = patch.schoolQuery;
    delete patch.schoolSearching;
    delete patch.schoolQuery;
  }
  if ('schoolFit' in patch) {
    schoolUi.fit = patch.schoolFit;
    delete patch.schoolFit;
  }
  if ('schools' in patch) {
    const next = { ...ALL_CHOICE, ...patch.schools };
    if (next.kind !== 'one' && state.schools.kind === 'one') schoolUi.searching = false;
    // Picking One school with none chosen yet opens the search.
    if (next.kind === 'one' && next.moe == null) schoolUi.searching = true;
    if (next.kind !== state.schools.kind) schoolUi.message = null;
    patch.schools = next;
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
  // The commute is always by public transport.
  if (state.service === 'jobs') return jobsChoice().mode === 'pt' || commuteShown();
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
    // With no fare affordable, the jobs within reach on foot, where the build sends them (z0).
    if (zones <= 0) return data.cost.jobs.z0 || new Float32Array(data.n).fill(0);
    return data.cost.jobs[`z${Math.min(zones, zoneCap(data.meta.fares))}`];
  }
  const layer = pricedLayer(data, 'jobs', zones);
  const cap = zoneCap(data.meta.fares);
  const full = data.jobs.pt?.['45'];
  return Float32Array.from(layer, (v, i) => (zones[i] >= cap && full ? full[i] : zones[i] > 0 || data.cost.jobs.z0 ? v : 0));
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
    // A hexagon is routed when it reaches any of the service at all, so one
    // school out of reach reads as over 60 rather than as not routed.
    const modes = Object.values(data.schoolsAll?.[service]?.t || data.t[service] || {});
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

// ---------------------------------------------------------------- schools

// What the Schools row is doing beyond the link: the search box, a message
// when a choice cannot be shown, and the zone shares last worked out.
const schoolUi = { searching: false, query: '', fit: false, message: null, maskKey: null, cells: null, sig: null };
// Reach lists, zones, zone outlines and stops as they arrive. They are kept
// when the rest of the data arrives and the data set is rebuilt, since the
// hexagons are the same.
const schoolStore = { reach: new Map(), zones: null, outlines: new Map(), stops: null };
// False while the times a school choice needs are still on their way.
let schoolsReady = true;
// The middle of each hexagon as [lat, lng], for straight-line distances.
let cellCentres = null;

const ZONES_MISSING = 'Zones could not be loaded; showing all schools.';
// Hexagons outside one school's zone, on the map.
const OUTSIDE_ZONE = '#b4bbc2';

/** meta.schools as the page uses it (schools.js readSchoolsMeta), worked
 *  out once for each data set. */
const schoolsMetaCache = new WeakMap();
function schoolsMeta() {
  if (!data || !data.meta) return {};
  if (!schoolsMetaCache.has(data.meta)) schoolsMetaCache.set(data.meta, readSchoolsMeta(data.meta));
  return schoolsMetaCache.get(data.meta);
}

/** The age group the figures for a service count (ages.js), or null for all
 *  residents: early childhood and the school services, in a build with ages. */
function ageKeyFor(service = state.service) {
  if (!data || state.measure === 'score') return null;
  // One school counts the children of the ages its own years cover, and of
  // its sex for a girls' or a boys' school (ages.js schoolAgeKey).
  const choice = service === state.service ? activeChoice() : null;
  if (choice && choice.kind === 'one') {
    const d = schoolIndex(service);
    if (d >= 0) return schoolAgeKey(data.meta, data.ages, service, data.destinations[d]);
  }
  return ageGroupFor(data.meta, data.ages, service);
}

/** Who the figures on screen count, in words (ages.js ageWords). */
function countedWords(service = state.service) {
  return ageWords(data && data.meta, ageKeyFor(service));
}

/** Whether the Schools row applies: a school service on screen, in a build
 *  that says what kind of school each one is. */
function schoolsAvailable(service = state.service) {
  return Boolean(data) && state.measure !== 'score' && isSchoolService(service) && hasAttributes(data.destinations, service);
}

/** Zones are offered once the build has the Ministry's zone file, and until
 *  the file fails to load. */
function zonesAvailable() {
  const s = schoolsMeta();
  if (!s.zones) return false;
  if (s.choices && !s.choices.includes('zone')) return false;
  return !(schoolStore.zones && schoolStore.zones.status === 'missing');
}

function schoolIndex(service = state.service) {
  return schoolByMoe(data.destinations, service, state.schools.moe);
}

/** The choice picked, where it can be shown; null for All. */
function activeChoice() {
  if (!schoolsAvailable()) return null;
  const c = state.schools;
  if (c.kind === 'all') return null;
  if (c.kind === 'zone' && !zonesAvailable()) return null;
  if (c.kind === 'one' && schoolIndex() < 0) return null;
  return c;
}

/** The choice the figures in `data` follow right now; null for All. */
function appliedChoice() {
  return data && data.schoolKey ? activeChoice() : null;
}

/** The ways of travelling the service has times for in this build. */
function schoolModes(service) {
  const own = data.schoolsAll?.[service]?.t || data.t[service] || {};
  const listed = schoolsMeta().reach?.[service];
  return REACH_MODES.filter((m) => own[m] && (!listed || listed.includes(m)));
}

/** The ways a choice needs: the ones that count, and a comparison way (any
 *  bike route, car) only while it is on screen, since a car reaches nearly
 *  every school and its list is large. */
function schoolModesNeeded(service) {
  const counting = data.meta.standard_modes;
  return schoolModes(service).filter((m) => counting.includes(m) || (m === state.mode && state.view === 'access'));
}

/** A school file, loaded once: { status: loading | ready | missing, value }.
 *  `kind` is its format family (schools.js FORMATS); a file in a format this
 *  page does not read is refused, with a warning, as if it were missing. */
function requestSchoolFile(store, key, name, kind, decode) {
  if (store.has(key)) return store.get(key);
  const entry = { status: 'loading', value: null, error: null };
  store.set(key, entry);
  fetchJson(`${DATA_BASE}${CITY}/`, `schools/${name}`)
    .then((json) => {
      if (!formatOk(data.meta, kind, json)) {
        throw new Error(`schools/${name}.json is format ${json && json.format}, which this page does not read`);
      }
      entry.value = decode(json);
      entry.list = entry.value;
      entry.status = 'ready';
    })
    .catch((error) => {
      entry.status = 'missing';
      entry.error = error.message;
      console.warn(`School file ${name} could not be used.`, error);
    })
    .finally(schedule);
  return entry;
}

function requestReach(service, mode) {
  const key = `${service}_${mode}`;
  return requestSchoolFile(schoolStore.reach, key, key, 'school_reach', (json) => decodeReach(json, data.n));
}

/** The zones for a service: an object once in, 'loading', or 'missing'. */
function schoolZonesOf(service) {
  if (!schoolStore.zones) {
    const entry = { status: 'loading', json: null, byService: new Map() };
    schoolStore.zones = entry;
    fetchJson(`${DATA_BASE}${CITY}/`, 'schools/zones')
      .then((json) => {
        if (!formatOk(data.meta, 'zones', json)) throw new Error(`schools/zones.json is format ${json && json.format}, which this page does not read`);
        entry.json = json;
        entry.status = 'ready';
      })
      .catch((error) => {
        entry.status = 'missing';
        console.warn('School zones could not be loaded.', error);
      })
      .finally(schedule);
  }
  const entry = schoolStore.zones;
  if (entry.status !== 'ready') return entry.status;
  if (!entry.byService.has(service)) entry.byService.set(service, decodeZones(entry.json, service, data.n) || 'missing');
  return entry.byService.get(service);
}

/** One school's zone outline for a service (GeoJSON), loaded only for One
 *  school; null until it is in, or where there is none. */
function zoneOutline(service, d) {
  if (!schoolsMeta().zones || d < 0) return null;
  const entry = requestSchoolFile(schoolStore.outlines, service, `zone_outlines_${service}`, 'zone_outlines', (json) => json.schools || {});
  if (entry.status !== 'ready') return null;
  return entry.value[d] || entry.value[String(d)] || null;
}

/** The stops near each school, loaded only for One school; null until in. */
function schoolStops() {
  if (!schoolsMeta().stops) return null;
  if (!schoolStore.stops) schoolStore.stops = new Map();
  const entry = requestSchoolFile(schoolStore.stops, 'stops', 'stops', 'school_stops', decodeStops);
  return entry.status === 'ready' ? entry.value : null;
}

function afterSchoolSwap() {
  cache.best.clear();
  cache.routed.clear();
  figureCache.clear();
}

/** One school's zone shares, when only its zone is counted. */
function schoolShare() {
  const c = appliedChoice();
  if (!c || c.kind !== 'one' || c.zoneOnly === false || !data.schoolZones) return null;
  const cells = schoolCells();
  return cells && cells.any ? cells.share : null;
}

/** The one school's zone: each hexagon's share of residents in it, and the
 *  hexagons its zone line crosses. Null where it has no zone for the years. */
function schoolCells() {
  const c = appliedChoice();
  if (!c || c.kind !== 'one' || !data.schoolZones) return null;
  const d = schoolIndex();
  if (d < 0 || !isZoned(data.schoolZones, data.destinations[d], d, state.service)) return null;
  const key = `${state.service}|${d}`;
  if (schoolUi.maskKey !== key) {
    schoolUi.maskKey = key;
    schoolUi.cells = zoneShares(data.schoolZones, d, data.n);
  }
  return schoolUi.cells;
}

/** Count the children of the service's ages, or everyone, and say so in the
 *  panel's words. */
function syncCounted() {
  const changed = setAgeGroup(data, ageKeyFor());
  setCounted(countedWords());
  if (changed) afterSchoolSwap();
}

/** Put the figures for the school service on screen onto the choice, or
 *  back onto All. False while the times it needs are on their way. */
function syncSchools() {
  syncCounted();
  // In zone with no zones to read (a build without them, or the file failed):
  // say so, and show All.
  if (schoolsAvailable() && state.schools.kind === 'zone' && !zonesAvailable()) {
    schoolUi.message = ZONES_MISSING;
    state.schools = { ...state.schools, kind: 'all' };
    writeHash();
  }
  const choice = activeChoice();
  const service = state.service;
  const needed = choice ? schoolModesNeeded(service) : [];
  const key = choice ? `${choiceKey(service, choice)}|${needed.join('+')}|${data.complete ? 'full' : 'core'}` : null;
  if (key !== (data.schoolKey || null)) {
    if (!choice) {
      restoreData(data);
      data.schoolKey = null;
      data.schoolResult = null;
      data.schoolZones = null;
      data.schoolLists = null;
      afterSchoolSwap();
    } else {
      const modes = needed;
      const lists = {};
      let waiting = false;
      const missing = [];
      for (const m of modes) {
        const entry = requestReach(service, m);
        if (entry.status === 'loading') waiting = true;
        // A short list (by car) holds the nearest under All and State, and
        // under In zone when the build says so; never One school.
        else if (entry.status === 'ready' && !listAnswers(entry.list, choice)) missing.push(m);
        else if (entry.status === 'ready') lists[m] = entry.list;
        else missing.push(m);
      }
      let zones = null;
      if (choice.kind === 'zone' || (choice.kind === 'one' && zonesAvailable())) {
        const found = schoolZonesOf(service);
        if (found === 'loading') waiting = true;
        else if (found && typeof found === 'object') zones = found;
        else if (choice.kind === 'zone') missing.push('zones');
      }
      if (waiting) return false;
      const counting = data.meta.standard_modes;
      if (missing.length && missing.every((m) => !counting.includes(m) && m !== 'zones')) {
        // A comparison way the build has no school times for: back to Best.
        schoolUi.message = choice.kind === 'one'
          ? `${MODES[missing[0]].label} times to one school are not in this build, so Best is shown.`
          : `${MODES[missing[0]].label} times for a set of schools are not in this build, so Best is shown.`;
        state.mode = 'best';
        writeHash();
        return syncSchools();
      }
      if (missing.length || !counting.every((m) => !schoolModes(service).includes(m) || lists[m])) {
        // Say so, and show what can be shown, rather than a figure for
        // something other than what was asked.
        schoolUi.message = choice.kind === 'zone' && missing.includes('zones')
          ? ZONES_MISSING
          : 'The school times for this choice are not in this build, so all schools are shown.';
        state.schools = { ...ALL_CHOICE };
        writeHash();
        return syncSchools();
      }
      restoreData(data);
      const result = chooseSchools({
        destinations: data.destinations,
        service,
        choice,
        reach: lists,
        zones,
        n: data.n,
        centres: cellCentres,
        standardModes: data.meta.standard_modes,
        maxMinutes: data.meta.routing_max_minutes || 60,
      });
      applyToData(data, service, result);
      data.schoolKey = key;
      data.schoolResult = result;
      data.schoolZones = zones;
      data.schoolLists = lists;
      afterSchoolSwap();
    }
  }
  const share = schoolShare();
  if (share !== (data.cellShare || null)) {
    setCellShare(data, share);
    afterSchoolSwap();
  }
  return true;
}

function baseWords(service) {
  const short = SERVICE_SHORT[service] || service;
  return { short, noun: SERVICE_NOUN[service] || short.toLowerCase(), plural: SERVICE_PLURAL[service] || `${short.toLowerCase()}s` };
}

/** What is being reached, as the figures on screen count it. */
function wordsFor(service = state.service) {
  const choice = service === state.service ? appliedChoice() : null;
  const school = choice && choice.kind === 'one' ? data.destinations[schoolIndex()] : null;
  return choiceWords(baseWords(service), choice, school, { children: Boolean(countedWords(service).key) });
}

/** Only one school's zone is counted. */
function zoneOnlyNow() {
  return Boolean(data.cellShare) && appliedChoice()?.kind === 'one';
}

/** One school, with everyone counted rather than only its zone: a school
 *  with no home zone, its zone left out by choice, or a build without zones.
 *  A share of the whole place then mostly counts people who would never go
 *  there, so the headline is a count, and Who misses out and What would help,
 *  which need to know who would, are off. */
function oneSchoolEveryone() {
  return appliedChoice()?.kind === 'one' && !zoneOnlyNow();
}

/** Why One school counts everyone: 'build' (no zones in this build),
 *  'school' (it has no zone for these years) or 'everyone' (left out by the
 *  tick box). */
function zoneWhy() {
  if (!data.schoolZones) return 'build';
  return schoolCells()?.any ? 'everyone' : 'school';
}

/** "It has no home zone, so there is no catchment to give a share of.", for
 *  One school with no zone in a build with zones; null otherwise. */
function noCatchment() {
  if (!oneSchoolEveryone() || zoneWhy() !== 'school') return null;
  const why = noZoneNow();
  return why ? `${why.replace(/\.$/, '')}, so there is no catchment to give a share of.` : null;
}

/** Whether the one school has a zone for these years that holds none of
 *  this place's homes: a school over a regional boundary (Putāruru College
 *  for Tauranga). */
function zoneOutside() {
  const d = schoolIndex();
  return d >= 0 && Boolean(data.schoolZones) && isZoned(data.schoolZones, data.destinations[d], d, state.service) && !schoolCells()?.any;
}

/** Why the one school has no zone that counts here, as a sentence, or null. */
function noZoneNow() {
  const d = schoolIndex();
  if (d < 0 || !data.schoolZones) return null;
  if (zoneOutside()) return `Its zone lies outside ${place.name}, where TEAM has no homes.`;
  return noZoneSentence(data.schoolZones, data.destinations[d], d, state.service);
}

/** When public transport was timed for a service: "between 7am and 9am on
 *  Tuesday 15 September 2026". */
function timedWhen(service) {
  const spec = (data.meta.windows || {})[data.activeWindow?.[service] || data.meta.services?.[service]?.window];
  return windowWords(spec, data.meta.routing_date);
}

const nounOf = (service) => (zoneOnlyNow() && service === state.service ? 'it' : wordsFor(service).noun);
const shortOf = (service) => wordsFor(service).short;

/** The panel's words when only one school's zone is counted: its zone is
 *  where the people are, and the school is "it". */
function schoolPanel(panel) {
  if (!panel || appliedChoice()?.kind !== 'one') return panel;
  const dest = data.destinations[schoolIndex()];
  // A girls' or a boys' school counts girls (or boys) only: the place's
  // share of them, taken to live where the others of their age do.
  const words = countedWords();
  const sexNote = splitKey(words.key).sex && words.sexShare != null
    ? `It takes ${splitKey(words.key).sex} only: ${splitKey(words.key).sex} are ${Math.round(words.sexShare * 100)}% of the children of these ages in ${place.name} (2018 Census), taken to live where the others do.`
    : null;
  if (!zoneOnlyNow()) return sexNote ? { ...panel, sexNote } : panel;
  // Most of a zone can lie outside the place (a school over a regional
  // boundary): then only its part inside the place is counted, and said so.
  const inside = zoneInside(dest);
  const zone = inside != null && inside < 0.9 ? `the part of ${dest.name}'s zone inside ${place.name}` : `${dest.name}'s zone`;
  const where = panel.where ? `the part of ${panel.where} in ${zone.replace(/^the part of /, '')}` : zone;
  const out = { ...panel, where, sexNote };
  const many = words.many;
  if (state.view === 'access' && Number.isFinite(panel.people) && (panel.show == null || panel.show === 'minutes')) {
    // "84% of the 3,900 children aged 13–17 living in Mt Albert Grammar
    // School's zone are within 30 minutes of it ..."
    out.zoneName = where;
  } else if (Number.isFinite(panel.people)) {
    out.who = `the ${count(panel.people)} ${Math.round(panel.people) === 1 ? words.one : many} in ${where}`;
  }
  return out;
}

/** The share of the homes in the one school's zone that are inside this
 *  place, from zones.json (sent only where under 99.5%), or null. */
function zoneInside(dest) {
  const d = schoolIndex();
  const entry = d >= 0 && data.schoolZones ? zoneEntry(data.schoolZones, d) : null;
  const value = entry && entry.inside ? entry.inside[state.service] : null;
  return Number.isFinite(value) ? value : null;
}

/** People in the hexagons flagged, counted as the figures count them. */
function peopleIn(mask) {
  let total = 0;
  for (let i = 0; i < data.n; i += 1) if (mask[i] && data.pop[i] > 0) total += data.pop[i];
  return total;
}

/** A line about hexagons one school's zone line crosses, which count only
 *  the share of their residents inside it. In zone says the same in its
 *  counting line. */
function zoneNote() {
  const choice = appliedChoice();
  if (!choice || !data.schoolZones || choice.kind !== 'one' || !zoneOnlyNow()) return null;
  const cells = schoolCells();
  if (!cells || !cells.any) return null;
  const people = peopleIn(cells.crossed);
  return people >= 0.5
    ? `${count(people)} of them live in hexagons its zone line crosses; each hexagon counts the share of its residents living inside the zone, from address points.`
    : null;
}

/** How many of those counted live outside the zones their hexagon is
 *  counted with, for In zone: the build's figure for the place, of children
 *  of the service's ages where those are counted (meta.schools.zones). */
function outsideSet() {
  const choice = appliedChoice();
  if (!choice || choice.kind !== 'zone') return null;
  const zones = schoolsMeta().zones || {};
  const block = countedWords().key ? zones.children_outside_set : zones.people_outside_set;
  const value = block ? block[state.service] : null;
  return Number.isFinite(value) && !state.areaPin?.name ? value : null;
}

/** How many of those counted live in hexagons a zone line splits, for In zone. */
function splitPeople() {
  const choice = appliedChoice();
  if (!choice || choice.kind !== 'zone' || !data.schoolZones || !data.schoolZones.split) return null;
  return peopleIn(data.schoolZones.split);
}

/** The parts of one school's zone, the furthest first. */
function zoneAreasModel(shownTimes, standard) {
  if (!zoneOnlyNow() || scopeLevel) return null;
  const gaps = Float32Array.from(shownTimes, (v) => (Number.isFinite(v) && v <= standard ? 0 : 1));
  const rows = areaTable(data.place, gaps, data.pop, data.nzdep, standard)
    .filter((row) => row.people >= 20)
    .sort((a, b) => b.share - a.share || b.people - a.people)
    .slice(0, 12)
    .map((row) => ({ ...row, name: suburbName(row.area) }));
  return rows.length ? { title: 'Areas in the zone, lowest share first', rows } : null;
}

/** How far each corrected school point was moved, by Ministry number. */
function movedPoints() {
  const moved = schoolsMeta().points?.moved;
  return Array.isArray(moved) ? Object.fromEntries(moved.map((m) => [m.moe, m.metres])) : {};
}

/** The wording the card uses for the school service on screen. */
function schoolCard() {
  if (!schoolsAvailable() || !schoolsReady) return null;
  const service = state.service;
  const choice = appliedChoice();
  const words = wordsFor(service);
  const lists = {};
  for (const m of schoolModes(service)) {
    const entry = schoolStore.reach.get(`${service}_${m}`);
    if (entry && entry.status === 'ready') lists[m] = entry.list;
  }
  const maxMinutes = data.meta.routing_max_minutes || 60;
  const ctx = {
    destinations: data.destinations,
    service,
    choice: choice || ALL_CHOICE,
    reach: lists,
    result: choice ? data.schoolResult : null,
    zones: choice ? data.schoolZones : null,
    centres: cellCentres,
    maxMinutes,
    when: timedWhen(service),
    schoolBuses: schoolsMeta().school_buses,
    standardModes: data.meta.standard_modes,
    moved: movedPoints(),
  };
  return {
    short: words.short,
    one: Boolean(words.one),
    // Whether a choice other than All applies, so the card row says which.
    choice: Boolean(choice),
    nearestLabel: words.nearestLabel || null,
    label: (d) => {
      const dest = data.destinations[d];
      const tag = !choice ? tagOf(dest, service, { years: true }) : '';
      return `${dest?.name || 'unnamed'}${tag ? ` (${tag})` : ''}`;
    },
    lines: (mode, i, named, shownMinutes) => {
      const real = mode === 'walk_slow' ? 'walk' : mode;
      // All: the nearest state school needs the times to every school, which
      // load the first time a card asks for them.
      if (!choice && real && real !== 'best' && named.some((d) => tagOf(data.destinations[d], service))) {
        const wanted = real === 'pt' ? ['pt', 'walk'] : [real];
        for (const m of wanted) if (schoolModes(service).includes(m)) requestReach(service, m);
      }
      return cardLines({ ...ctx, shownMinutes }, mode, i, named);
    },
  };
}

/** Stops near the school, for the One school panel: null where the build
 *  has no stops, or none for this school. The school's nearest train or
 *  ferry stations beyond the walk come after, under a line of their own. */
function stopsModel(d) {
  const stops = schoolStops();
  const split = stops ? stopsSplit(stops, d) : null;
  if (!split) return null;
  return {
    intro: stopsIntro(stops),
    rows: split.near.map((row) => stopLine(row, stops)),
    none: `No stop within a ${stops.maxWalk}-minute walk.`,
    summary: stopsSummary(split, stops),
    far: split.far.length ? { heading: farStopsHeading(split.far, stops), rows: split.far.map((row) => stopLine(row, stops)) } : null,
  };
}

/** The Schools row under Getting to. */
function renderSchoolsField() {
  const root = $('school-field');
  if (!schoolsAvailable()) {
    schoolUi.sig = null;
    renderSchools(root, null, set);
    return;
  }
  const service = state.service;
  const choice = state.schools.kind === 'zone' && !zonesAvailable() ? { ...state.schools, kind: 'all' } : state.schools;
  const kinds = ['all', 'state', ...(zonesAvailable() ? ['zone'] : []), 'one'];
  const d = choice.kind === 'one' ? schoolIndex() : -1;
  const dest = d >= 0 ? data.destinations[d] : null;
  const zones = choice.kind === 'one' && appliedChoice() ? data.schoolZones : null;
  const cells = zones ? schoolCells() : null;
  let status = null;
  let statusKind = null;
  if (!schoolsReady) status = 'Loading the school times…';
  else if (schoolUi.message) {
    status = schoolUi.message;
    statusKind = 'error';
  } else if (choice.kind === 'one' && choice.moe != null && d < 0) {
    status = `School number ${choice.moe} does not teach these years here. Pick another school, or All.`;
    statusKind = 'error';
  }
  const stops = dest && appliedChoice() ? stopsModel(d) : null;
  const model = {
    kinds,
    choice,
    school: dest ? {
      name: dest.name,
      facts: schoolFacts(dest, service, { zones, d, moved: movedPoints()[dest.moe] }),
      hasZone: Boolean(cells && cells.any),
      stops,
    } : null,
    searching: choice.kind === 'one' && (schoolUi.searching || !dest),
    query: schoolUi.query,
    hint: 'Or click a school on the map.',
    status,
    statusKind,
    budget: state.budget != null && appliedChoice() ? 'Fare budgets and fare maps are worked out for all schools only, so they are off for this choice. Pick All to use them.' : null,
    csv: schoolsReady && !(choice.kind === 'one' && !appliedChoice()),
  };
  // Redrawn only when it changes, so typing in the search box is never cut off.
  const sig = JSON.stringify([service, model.kinds, model.choice, model.school, model.searching, status, model.budget, model.csv]);
  if (sig === schoolUi.sig && root.childNodes.length) return;
  schoolUi.sig = sig;
  renderSchools(root, {
    ...model,
    remember: (q) => { schoolUi.query = q; },
    find: (q) => findSchools(data.destinations, service, q).map((k) => [k, data.destinations[k].name, tagOf(data.destinations[k], service, { years: true })]),
    moeOf: (k) => data.destinations[k].moe,
  }, set);
}

/** The pins, the zone outline, the stops and the school's label on the map. */
function renderSchoolMap() {
  if (!map) return false;
  const service = state.service;
  const choice = appliedChoice();
  const picking = schoolsAvailable() && state.schools.kind === 'one' && !activeChoice();
  let spec = null;
  if (choice && data.schoolResult) {
    spec = { service, counted: data.schoolResult.counted, focus: choice.kind === 'one' ? schoolIndex() : null, key: data.schoolKey };
  } else if (picking) {
    spec = { service, counted: null, focus: null, key: `pick|${service}` };
  }
  const d = choice && choice.kind === 'one' ? schoolIndex() : -1;
  // The outline of a school with a zone for these years, loaded when asked for.
  const outline = d >= 0 && schoolCells()?.any ? zoneOutline(service, d) : null;
  const stops = d >= 0 ? schoolStops() : null;
  const near = stops ? stopsAt(stops, d) : null;
  try {
    setSchoolPins(map, spec, data.destinations);
    setSchoolZone(map, outline);
    setSchoolStops(map, near ? near.map((row) => ({ ...stops.stops[row.s], walk: row.walk, metres: row.metres, far: isFarStop(row, stops) })) : null,
      d >= 0 ? `${service}|${d}` : null);
  } catch (error) {
    console.warn('School pins are not ready yet.', error);
  }
  if (schoolUi.fit && d >= 0) {
    const dest = data.destinations[d];
    const zoned = Boolean(schoolCells()?.any);
    // Wait for a zoned school's outline, so the map fits the whole zone.
    if (!zoned || outline || !schoolsMeta().zones || schoolStore.outlines.get(service)?.status === 'missing') {
      schoolUi.fit = false;
      const box = outline ? boundsOf(outline) : null;
      userMoved = false;
      const pad = placePadding();
      if (box) {
        // With its zone counted, the figures are those of the whole zone until
        // the map is moved by hand. Otherwise the area picked or linked stays,
        // so two schools are compared for the same people.
        state.areaPin = { level: 'place' };
        map.fitBounds([[box[0], box[1]], [box[2], box[3]]], {
          padding: { top: pad.top + 20, bottom: pad.bottom + 20, left: pad.left + 20, right: pad.right + 20 }, maxZoom: 15, duration: 600,
        });
      } else if (Number.isFinite(dest.lon)) {
        map.flyTo({ center: [dest.lon, dest.lat], zoom: Math.max(map.getZoom(), 12.5), duration: 600 });
      }
    }
  }
  return Boolean(spec);
}

/** Every hexagon counted, with its minutes to the schools counted, as a CSV
 *  file whose first lines say what was counted and when. */
function downloadSchools() {
  const service = state.service;
  const choice = appliedChoice() || ALL_CHOICE;
  const modes = REACH_MODES.filter((m) => data.t[service]?.[m]);
  const near = {};
  const ties = {};
  for (const m of modes) {
    near[m] = data.nearestMode?.[service]?.[m] || [];
    ties[m] = data.ties?.[service]?.[m] || {};
  }
  const orWalk = Boolean(data.meta.pt_or_walk);
  const extra = { minutes_best: times(data, service, 'best', null) };
  // R5's own public transport time, where public transport is the quicker of it and the walk.
  if (orWalk && data.t[service]?.pt) {
    const own = data.r5t?.[service];
    const ptr = data.ptr?.[service];
    if (own || (ptr && !data.schoolsAll?.[service])) {
      extra.minutes_pt_r5 = own || Float32Array.from(data.t[service].pt, (v, i) => {
        const key = String(i);
        if (!Object.prototype.hasOwnProperty.call(ptr, key)) return v;
        return ptr[key] == null ? NaN : ptr[key];
      });
    }
  }
  const result = choice.kind !== 'all' ? data.schoolResult : null;
  if (result && result.bySex) {
    for (const m of data.meta.standard_modes) {
      if (!result.bySex.girls.t[m]) continue;
      extra[`minutes_${m}_girls`] = result.bySex.girls.t[m];
      extra[`minutes_${m}_boys`] = result.bySex.boys.t[m];
    }
  }
  const d = choice.kind === 'one' ? schoolIndex() : -1;
  if (d >= 0 && data.schoolLists?.pt?.lo) {
    const lo = new Float32Array(data.n).fill(NaN);
    const hi = new Float32Array(data.n).fill(NaN);
    const pt = data.schoolLists.pt;
    for (let i = 0; i < data.n; i += 1) {
      for (let k = pt.start[i]; k < pt.start[i + 1]; k += 1) {
        if (pt.d[k] === d) {
          lo[i] = pt.lo[k];
          hi[i] = pt.hi ? pt.hi[k] : NaN;
        }
      }
    }
    extra.pt_p10 = lo;
    extra.pt_p90 = hi;
  }
  const cells = d >= 0 ? schoolCells() : null;
  if (cells && cells.any) extra.zone_share = cells.share;
  const meta = schoolsMeta();
  const words = wordsFor(service);
  const kids = countedWords(service);
  const zoneLine = (() => {
    if (!cells || !cells.any) return null;
    const z = zoneDates(data.schoolZones, data.destinations[d], d, service);
    const version = data.schoolZones.source?.version || meta.zone_source?.version;
    const when = z.status === 'upcoming_used' ? `the Ministry's file holds only its zone from ${z.from}, which is used` : `in force since ${z.from || 'a date not given'}`;
    return `Zone: ${when}${version ? `, from the Ministry's file of ${version}` : ''}. zone_share is the share of the hexagon's residents in the zone, from LINZ address points.`;
  })();
  const header = [
    `TEAM ${data.meta.version}, ${place.name}. ${baseWords(service).short}, ${choice.kind === 'one' ? words.short : choice.kind === 'all' ? 'all schools' : words.plural}.`,
    countingLine(data.destinations, service, choice, {
      plural: baseWords(service).plural, zones: data.schoolZones, meta, ages: kids.key ? kids : null, splitPeople: splitPeople(), outsideSet: outsideSet(), zoneOutside: zoneOutside() ? place.name : null,
    }),
    `Minutes from the middle of each hexagon to each school's map point in the Ministry's directory (not its nearest gate), whole minutes as the routing gives them, rounded down; blank is none within ${data.meta.routing_max_minutes || 60} minutes.`,
    ptCsvLine(timedWhen(service), orWalk),
    kids.key
      ? `${kids.column}: ${kids.many.replace(/^children aged .*/, 'children of these ages')} living in the hexagon, 2023 Census; residents: everyone, of all ages.`
      : 'residents: everyone living in the hexagon, of all ages (Census 2023).',
    'moe_<mode> is the Ministry school number of the nearest school counted by that way; tied schools are joined with |.',
    choice.students === 'both' && result && result.bySex ? 'Girls and boys: each minutes_<mode> is the slower of the girls and boys columns; minutes_best is the slower of each one\'s fastest way.' : null,
    zoneLine,
    // The counting line above gives the directory date already.
    meta.roll_date ? `Rolls at ${meta.roll_date}.` : null,
    meta.dates ? `Data dates: timetable written ${meta.dates.timetable_written || 'not recorded'}, OpenStreetMap ${meta.dates.osm_downloaded || 'not recorded'}, routing day ${meta.dates.routing_date || data.meta.routing_date}.` : null,
    meta.bus_note ? meta.bus_note : null,
    !meta.zone_source && meta.zones ? `Zones as at ${typeof meta.zones === 'string' ? meta.zones : 'the date in the build'}.` : null,
    state.urbanOnly ? 'Urban areas only.' : null,
    ...(d >= 0 ? stopsCsvLines(schoolStops(), d) : []),
  ].filter(Boolean);
  // A row for each hexagon counted: with residents, and inside the zone
  // where only the zone is counted.
  const residents = state.urbanOnly && data.urbanOnly ? data.urbanOnly.pop : data.everywhere.pop;
  const share = data.cellShare;
  const text = schoolsCsv({
    h3: data.h3,
    residents,
    children: kids.key ? ageArray(data, kids.key) : null,
    childrenColumn: kids.key ? kids.column : null,
    include: Uint8Array.from(residents, (v, i) => (v > 0 && (!share || share[i] > 0) ? 1 : 0)),
    placeNames: Array.from(data.place, (p) => (p != null && data.places[p] ? data.places[p].name : '')),
    t: data.t[service],
    near,
    ties,
    destinations: data.destinations,
    modes,
    header,
    extra,
  });
  const what = choice.kind === 'one' ? `school-${choice.moe}` : choice.kind === 'all' ? 'all' : `${choice.kind}${choice.students !== 'both' ? `-${choice.students}` : ''}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  link.download = `team_${data.meta.naming.slug}_${service}_${what}_hexagons.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
  const words = wordsFor(service);
  const oneEveryone = oneSchoolEveryone();
  // The way drawn, kept for the tooltip, which is read later.
  const drawn = state.mode;
  let people = 0;
  for (let i = 0; i < data.n; i += 1) if (data.pop[i] > 0) people += data.pop[i];
  return {
    classes,
    colours: ACCESS,
    // The card's first sentence, so a walk is never called a bus trip.
    tooltip: (i) => [
      ...tooltipLines(data, i, service, standard, drawn, zones != null && typeof zones !== 'number' ? zones[i] : zones, shortOf(service)),
      `Standard: within ${standard} min`,
    ],
    panel: {
      service,
      noun: nounOf(service),
      keyName: words.one ? `Minutes to ${words.short}` : appliedChoice() ? `Minutes to ${words.nearest}` : null,
      oneSchool: Boolean(words.one),
      oneEveryone,
      noZone: oneEveryone ? noCatchment() : null,
      within: peopleWithin(flags, data.pop),
      keyNote: !schoolsAvailable(service) ? null : words.one
        ? (data.destinations[schoolIndex()]?.point === 'corrected'
          ? "Times go to a corrected point inside the school's grounds."
          : "Times go to the Ministry's map point for the school (the pin), not to its nearest gate.")
        : 'Nearest is the quickest by the way shown. Schools reached in the same minute are all named on the card, nearest in a straight line first.',
      people,
      zoneNote: zoneNote(),
      zoneAreas: zoneAreasModel(shown, standard),
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
      compare: oneEveryone ? null : compareNote(service, state.mode, standard, weightedShare(flags, data.pop)),
      robust: state.mode === 'best' && !figureOnly && !oneEveryone ? robustModel(service, standard) : null,
      canShowChoice: Boolean(data.choice[service]) && !words.one,
      legend,
    },
  };
}

/** People in the hexagons flagged. */
function peopleWithin(flags, pop) {
  let total = 0;
  for (let i = 0; i < pop.length; i += 1) if (flags[i] && pop[i] > 0) total += pop[i];
  return total;
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
          ? `${shortOf(service)}: free for this traveller at this time`
          : `${shortOf(service)}: free, on foot or by bike within ${standard} min`];
      }
      if (cls === 5) return [`${shortOf(service)}: no way to get there within ${standard} min`];
      const zonesText = flat ? 'by public transport'
        : `${many && cls === 4 ? '4 or more fare zones' : `${cls} fare ${cls === 1 ? 'zone' : 'zones'}`} by public transport`;
      return [`${shortOf(service)}: ${money(costs[cls])}${many && cls === 4 ? '+' : ''} ${trip}`, zonesText];
    },
    panel: {
      service,
      noun: nounOf(service),
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

  // More than one way to get there in time. Where public transport is the
  // quicker of the trip and the walk, it is a way of its own only where a
  // bus or train is quicker than walking; otherwise the walk would count twice.
  const walkAt = counting.indexOf('walk');
  const ptAt = counting.indexOf('pt');
  const orWalk = Boolean(data.meta.pt_or_walk) && walkAt >= 0 && ptAt >= 0;
  const ways = Uint8Array.from({ length: data.n }, (_, i) => perMode.filter((t, k) => {
    if (!(t[i] <= standard)) return false;
    if (orWalk && k === ptAt && perMode[walkAt][i] <= t[i]) return false;
    return true;
  }).length);
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
    tooltip: (i) => [`${shortOf(service)}: ${Number.isFinite(counts[i]) ? counts[i] : 0} within ${found.minutes} min without a car`],
    panel: {
      show: 'choice',
      noun: nounOf(service),
      plural: wordsFor(service).plural,
      service,
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
    groupNow(), lastAreas.where ? lastAreas.where.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null,
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
 *  someone could walk instead, because plenty of people cannot; only where no
 *  bus in time is quicker than walking all the way (cost z0, from 0.12.0) is
 *  the trip a walk, with no fare. The panel
 *  compares the most and least deprived areas, which a dollar map cannot.
 */
/** Whether the commuting cost is the view on screen. */
function commuteShown() {
  return state.service === 'jobs' && state.view === 'access' && state.show === 'burden' && state.measure !== 'score' && commuteAvailable();
}

/** Whether the commuting fare burden can be worked out here. */
function commuteAvailable() {
  const cost = data.cost && data.cost.jobs;
  return fareAvailable() && incomeAvailable() && Boolean(cost && cost.z1) && Boolean(data.jobs.pt && data.jobs.pt['45']);
}

/** For a commute: in each hexagon, the fewest fare zones that take in half
 *  the jobs within 45 minutes by public transport, a fair stand-in for where a
 *  typical job reachable from there is; 0 where half of them are a walk
 *  away, so the typical commute needs no fare. -2 where no job is in reach. */
function commuteZones() {
  // Always the morning peak's figures, whatever time is picked elsewhere.
  const cost = data.usual.cost.jobs || data.cost.jobs;
  const cap = zoneCap(data.meta.fares);
  const within = (data.usual.jobs || data.jobs.pt)['45'];
  const top = cost[`z${cap}`];
  const out = new Int8Array(data.n).fill(-1);
  for (let i = 0; i < data.n; i += 1) {
    const total = within[i];
    if (!Number.isFinite(total)) continue;
    if (!(total > 0)) {
      out[i] = -2;
      continue;
    }
    // A home outside every fare zone, or whose jobs all lie outside them, has
    // no fare to price; it is left out rather than charged the top fare.
    const priced = top ? top[i] : NaN;
    if (!(priced > 0)) continue;
    // Where half the jobs in reach are a walk away (z0, from 0.12.0), the
    // typical commute is a walk: no fare, and left out of the burden.
    const onFoot = cost.z0 ? cost.z0[i] : NaN;
    if (Number.isFinite(onFoot) && onFoot >= 0.5 * priced * (1 - 1e-6)) {
      out[i] = 0;
      continue;
    }
    if (data.zone && data.zone[i] == null) continue;
    let zones = cap;
    for (let k = 1; k <= cap; k += 1) {
      const reached = cost[`z${k}`] ? cost[`z${k}`][i] : NaN;
      if (Number.isFinite(reached) && reached >= 0.5 * priced * (1 - 1e-6)) {
        zones = k;
        break;
      }
    }
    out[i] = zones;
  }
  return out;
}

// A working week of return trips.
const WORK_DAYS = 5;

function burdenModel() {
  const service = state.service;
  // Commuting: the fare to work, five return trips a week at the peak.
  const commute = service === 'jobs';
  const standard = commute ? 45 : standardFor(service);
  const meta = data.meta.fares;
  // A commute is priced at the morning peak, the jobs' usual window.
  const { hour, weekday } = commute ? tripTime(data, windowsFor(data, 'jobs')[0]) : tripWindow(service);
  const zones = commute ? commuteZones() : cheapestZones(data, service, standard, { walkable: false });
  const trips = state.returnTrip ? 2 : 1;
  const trip = commute ? 'return' : state.returnTrip ? 'return' : 'one way';
  // The fare for `z` zones for a traveller type; nothing when they ride free.
  // Over a week it is a return trip every day, after any caps, and set
  // against a week's income, so the two read on the same scale.
  const week = commute || (state.basket === 'week' && hasCaps(meta));
  const days = commute ? WORK_DAYS : 7;
  const pricer = (profile) => {
    const column = paymentKey(meta, state.payment, hour, weekday);
    const free = freeTravel(meta, profile, hour, weekday);
    if (week) return (z) => weekCost(meta, z, { profile, payment: state.payment, hour, weekday, days }) / 7;
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
  const meanOf = (values, weights, mask, floor = FEWEST) => {
    let total = 0;
    let sum = 0;
    for (let i = 0; i < data.n; i += 1) {
      if (mask && !mask[i]) continue;
      const w = weights[i];
      if (!(w > 0) || !Number.isFinite(values[i])) continue;
      total += w;
      sum += w * values[i];
    }
    // An average over fewer riders than this is too thin to show, except for
    // the headline, which says how many it counts.
    return total > 0 && total >= floor ? sum / total : NaN;
  };
  const meanBurden = (weights, mask) => meanOf(burden, weights, mask);
  // Children and people 65 and over mostly pay their own concession, so their
  // rows are priced at it where the network has one.
  const profiles = (meta.profiles || []).map((p) => p.key);
  const ownProfile = {
    children: ['child_5_15', 'child'].find((k) => profiles.includes(k)),
    older: profiles.includes('supergold') ? 'supergold' : undefined,
  };
  const weights = data.weights[groupNow()];
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
      emphasis: g === groupNow(),
    };
  });
  let heavy = 0;
  let paying = 0;
  let capped = 0;
  const uncapped = week ? ((z) => {
    const column = paymentKey(meta, state.payment, hour, weekday);
    return freeTravel(meta, state.profile, hour, weekday) ? 0 : (fare(meta, z, state.profile, column) * 2 * days) / 7;
  }) : null;
  // Homes whose trip is a walk, with no fare (z0): the commute where half the
  // jobs in reach are a walk away, or a service no bus or train beats walking to.
  let walking = 0;
  for (let i = 0; i < data.n; i += 1) if (zones[i] === 0 && weights[i] > 0) walking += weights[i];
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
      if (commute) {
        if (classes[i] === 5) return ['Public transport reaches almost no jobs within 45 min'];
        if (zones[i] === 0) return ['Commuting: half the jobs within 45 min are a walk away, so no fare is needed'];
        if (zones[i] === -1) return ['Outside the fare zones, so not priced'];
        if (!Number.isFinite(burden[i])) return ['No income figure for this area'];
        if (burden[i] === 0) return ['Commuting: free for this traveller at the peak'];
        return [
          `Commuting: ${money(costOf(zones[i]) * 7)} a week, ${percentOf(burden[i])} of a week's income here`,
          // Flat-fare networks have no zones to speak of.
          zoneCap(meta) > 1 ? `${zones[i]} fare ${zones[i] === 1 ? 'zone takes' : 'zones take'} in half the jobs within 45 min` : null,
          `Income about $${Math.round(data.income[i] / 1000)}k a year per person, after household size`,
        ].filter(Boolean);
      }
      if (classes[i] === 5) return [`${shortOf(service)}: public transport can't get there within ${standard} min`];
      if (zones[i] === 0) return [`${shortOf(service)}: no bus or train is quicker than walking, so no fare is needed`];
      if (!Number.isFinite(burden[i])) return [zones[i] === -1 ? 'Not routed' : 'No income figure for this area'];
      if (burden[i] === 0) return [`${shortOf(service)}: free for this traveller at this time`];
      const perYear = Math.round(data.income[i] / 1000);
      return [
        week
          ? `${shortOf(service)}: ${money(costOf(zones[i]) * 7)} a week, ${percentOf(burden[i])} of a week's income here`
          : `${shortOf(service)}: ${money(costOf(zones[i]))} ${trip}, ${percentOf(burden[i])} of a day's income here`,
        `Income about $${perYear}k a year per person, after household size`,
      ];
    },
    panel: {
      noun: commute ? 'work' : nounOf(service),
      commute,
      standard,
      trip,
      group: groupNow(),
      groups: groupChips(),
      least: byQuintile[0].value,
      most: byQuintile[4].value,
      overall: meanOf(burden, weights, null, 0),
      heavy,
      paying,
      walking,
      byQuintile,
      byGroup,
      show: 'burden',
      week,
      capped,
      canWeek: !commute && hasCaps(meta),
      caps: hasCaps(meta),
      basket: week ? 'week' : 'trip',
      canShowFare: true,
      canShowBurden: true,
      meta: data.meta.affordability,
      legend: ['No fare', 'under 2.5%', '2.5–5%', '5–10%', '10% or more', commute ? 'Almost no jobs in 45 min' : 'Not in time'].map((label, k) => ({ colour: FARE[k], label })),
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
  const weights = data.weights[groupNow()];
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
      return [`About ${count(weights[i])} ${groupPhrase(groupNow())} miss out`, `Short by ${short} min`];
    },
    panel: {
      noun: nounOf(service),
      standard,
      group: groupNow(),
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
        emphasis: row.key === groupNow(),
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
  const everyone = groupNow() === 'everyone';
  // Rest homes and retirement villages house people 65 and over by design.
  // Left out, what remains is where people have aged in their own homes.
  const older = groupNow() === 'older';
  // Where the census suppresses a group's count there is no share to draw, and
  // those residents are left out of the place's share rather than counted as
  // having none of the group.
  const shares = everyone ? null : data.shares[groupNow()];
  const known = (i) => everyone || Number.isFinite(shares && shares[i]);
  const pop = everyone ? data.pop : Float32Array.from(data.pop, (p, i) => (known(i) ? p : 0));
  const weights = Float32Array.from(data.weights[groupNow()]);
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
  const noun = groupPhrase(groupNow());
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
        lines.push(service === 'errands' ? 'No round within these limits' : `${shortOf(service)}: no route within ${cap} min`);
      }
      else if (gaps[i] > 0) lines.push(`${shortOf(service)}: ${Math.round(gaps[i] * standard)} min over the standard`);
      else lines.push(`${shortOf(service)}: within ${standard} min`);
      return lines;
    },
    panel: {
      live: true,
      noun: nounOf(service),
      standard,
      group: groupNow(),
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
  const sort = groupNow() !== 'everyone' && state.areaSort === 'share' ? 'share' : 'missing';
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
  const weights = data.weights[groupNow()];
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
    panel: { service, noun: nounOf(service), standard, group: groupNow(), groups: groupChips(), fare: fareClause(), below: peopleBelow(flags, weights), reasons, ranked, focus: state.reason },
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
/** Whether fares are off for the service on screen: under a school choice
 *  the priced layers, which count every school, are not used. */
function faresOff() {
  return isSchoolService(state.service) && Boolean(appliedChoice());
}

function fareClause() {
  const when = whenClause();
  if (state.budget == null || state.measure === 'score' || faresOff()) return when;
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
  if (!schoolsReady && state.measure !== 'score') return { ...waiting, message: 'Loading the school times…' };
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
  if (state.service === 'jobs') {
    if (state.view === 'access' && state.show === 'burden' && commuteAvailable()) return burdenModel();
    return jobsModel();
  }
  if ((state.view === 'people' || state.view === 'fixes') && oneSchoolEveryone()) {
    // The map keeps the minutes to the school, by the fastest way as these
    // tabs count (Travel by shows Best); the panel says why the tab is off.
    const kept = state.mode;
    state.mode = 'best';
    try {
      const model = accessModel();
      return { ...model, panel: { ...model.panel, needsZone: state.view, zoneWhy: zoneWhy(), noZone: noZoneNow() } };
    } finally {
      state.mode = kept;
    }
  }
  if (state.view === 'people') return peopleModel();
  if (state.view === 'fixes') return fixesModel();
  if (state.show === 'fare' && fareAvailable() && data.cost[state.service]) return fareSurfaceModel();
  if (state.show === 'burden' && fareAvailable() && data.cost[state.service] && incomeAvailable()) return burdenModel();
  // Choice counts schools, which means nothing for one school.
  if (state.show === 'choice' && data.choice[state.service] && appliedChoice()?.kind !== 'one') {
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
  cellCentres = centres;
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
  // About a megabyte an area in Auckland: keep the few most recent.
  if (!byArea.has(key) && byArea.size >= 12) byArea.delete(byArea.keys().next().value);
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
  // A commute is priced at the morning peak, so there is no time to pick.
  if (!transitShown() || !windows.length || commuteShown()) {
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
  const fallback = defaultStandard(data, state.service);
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
  const hide = state.measure === 'score' || !fareAvailable() || !transitShown() || faresOff();
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

function renderTravellerFields() {
  const box = $('traveller');
  const hide = state.measure === 'score' || !fareAvailable() || !transitShown() || faresOff();
  box.hidden = hide;
  $('fares-group').hidden = hide && $('budget-field').hidden;
  if (hide) return;
  const { spec } = tripWindow(state.service);
  const timed = spec.when || 'in the modelled window';
  renderTraveller(box, {
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

/** Jobs within 30 or 45 minutes, under Settings. */
function renderLimit() {
  const field = $('limit-field');
  const show = state.service === 'jobs' && state.measure !== 'score' && data.complete && Object.keys(data.jobs).length > 0
    && !(state.zonesNow != null && jobsChoice().mode === 'pt') && !commuteShown();
  field.hidden = !show;
  if (!show) return;
  const choice = jobsChoice();
  renderChips($('limit-picker'), choice.limits.map((l) => [String(l), `${l} min`]), String(choice.limit), (jobsLimit) => set({ jobsLimit }));
}

// The access scores in Getting to, in this order; any other the build has after them.
const SCORE_ORDER = ['all', 'everyday', 'education', 'jobs'];

/** Getting to, Travel by and the tabs: what the panel is about. */
function renderPickers() {
  const score = state.measure === 'score';
  const access = data.meta.access || {};
  const labels = access.keys || {};
  const keys = (access.modes || []).length
    ? [...SCORE_ORDER.filter((k) => labels[k]), ...Object.keys(labels).filter((k) => !SCORE_ORDER.includes(k))]
    : [];
  const scoreKey = data.complete && scoreAvailable() ? scoreChoice().key : state.scoreKey;
  renderGoalPicker($('goal'), goalGroups(SERVICE_ORDER, keys.map((k) => [k, labels[k]])), score ? `score:${scoreKey}` : state.service, (value) => {
    if (value.startsWith('score:')) set({ measure: 'score', scoreKey: value.slice(6) });
    else set({ measure: 'standards', service: value });
  });

  const root = $('mode-picker');
  if (score) {
    const choice = data.complete ? scoreChoice() : { available: access.modes || [], mode: state.scoreMode };
    const modes = choice.available.length ? choice.available : access.modes || [];
    renderModePicker(root, travelOptions('score', { scoreModes: modes, betaModes: access.beta_modes || [] }), choice.mode || state.scoreMode,
      (scoreMode) => set({ scoreMode }));
  } else if (state.service === 'jobs') {
    const ready = data.complete && Object.keys(data.jobs).length > 0;
    const modes = ready ? Object.keys(data.jobs) : ['pt', 'walk', 'bike_low_stress'];
    renderModePicker(root, travelOptions('jobs', { jobsModes: modes }), ready ? jobsChoice().mode : state.jobsMode, (jobsMode) => set({ jobsMode }));
  } else if (state.service === 'errands') {
    renderModePicker(root, travelOptions('errands', { roundModes: data.meta.chains?.modes || [] }), state.errandMode,
      (errandMode) => set({ errandMode }));
  } else {
    // Who misses out and What would help count the fastest way whatever is
    // set, so on those tabs Travel by shows Best and the rest wait.
    // Under a school choice, the comparison ways the build has school times for.
    const compare = activeChoice() ? ['bike', 'car'].filter((m) => schoolModes(state.service).includes(m)) : ['bike', 'car'];
    renderModePicker(root, travelOptions('service', {
      standardModes: data.meta.standard_modes, slowWalk: Boolean((data.schoolsAll?.[state.service]?.t || data.t[state.service])?.walk_slow), compare,
    }), state.mode, (mode) => set({ mode }), { fixedBest: state.view !== 'access' });
  }

  $('tabs').hidden = score;
  for (const tab of document.querySelectorAll('#tabs [role="tab"]')) {
    const on = tab.dataset.view === state.view;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  $('view').setAttribute('aria-labelledby', score ? 'goal-label' : `tab-${state.view}`);
}

function renderView(model) {
  renderPickers();
  renderSchoolsField();
  if (model.waiting) {
    $('view').keySpec = null;
    $('view').replaceChildren(el('p', 'note', model.message || 'Loading the rest of the data for this view…'));
    return;
  }
  if (model.empty) {
    $('view').keySpec = current && current.panel ? keySpecOf(current) : null;
    $('view').replaceChildren(el('div', 'hero', null));
    const where = schoolPanel(model.panel).where;
    $('view').firstChild.append(el('p', 'hero-text', `Nobody in ${where} is counted with these settings.`));
    return;
  }
  $('view').keySpec = null;
  renderInto($('view'), { ...model, panel: schoolPanel(model.panel) });
  // Which schools the figure counts, under every headline for a school
  // service, and who: children of the service's ages where the build has them.
  const kids = countedWords();
  const heroBox = $('view').querySelector('.hero');
  if (schoolsAvailable() && state.service !== 'jobs') {
    const choice = appliedChoice() || ALL_CHOICE;
    const line = countingLine(data.destinations, state.service, choice, {
      plural: baseWords(state.service).plural, zones: data.schoolZones, meta: schoolsMeta(), ages: kids.key ? kids : null, splitPeople: splitPeople(), outsideSet: outsideSet(), zoneOutside: zoneOutside() ? place.name : null,
    });
    if (heroBox) heroBox.after(el('p', 'note counting', line));
  } else if (kids.key && heroBox) {
    heroBox.after(el('p', 'note counting', kids.line));
  }
}

/** The key spec a model would leave, without drawing it anywhere visible. */
function keySpecOf(model) {
  const box = el('div');
  try {
    renderInto(box, model);
  } catch {
    return null;
  }
  return box.keySpec || null;
}

/** The panel for a model, drawn into any element. */
function renderInto(root, model) {
  if (state.measure === 'score') {
    renderScore(root, model.panel, set);
    return;
  }
  if (state.service === 'jobs') {
    const choice = data.complete && Object.keys(data.jobs).length ? jobsChoice() : { fairAvailable: false };
    if (state.view === 'access' && model.panel.show === 'burden') renderBurden(root, { ...model.panel, canCommute: true, fairAvailable: choice.fairAvailable }, set);
    else if (state.view === 'access') renderJobsAccess(root, { ...model.panel, canCommute: commuteAvailable() }, set);
    else if (state.view === 'people') renderJobsPeople(root, model.panel);
    else renderJobsFixes(root, model.panel);
    return;
  }
  if (state.service === 'errands') {
    if (state.view === 'access') renderErrands(root, model.panel, set);
    else if (state.view === 'people') renderPeople(root, model.panel, set);
    else {
      root.keySpec = null;
      root.replaceChildren(el('p', 'note', 'What would help is worked out for single trips. Pick one of the stops under Getting to to see it.'));
    }
    return;
  }
  if (model.panel && model.panel.needsZone) {
    renderNeedsZone(root, model.panel);
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

/** The Settings button's line: everything that is set, in order, and a count
 *  of what differs from the defaults. */
function renderSettings() {
  const parts = [];
  let changed = 0;
  if (!$('where-field').hidden && state.urbanOnly) {
    parts.push('urban areas only');
    changed += 1;
  }
  // When and the standard count only where they differ from the build's defaults, so a link or a reload
  // that spells the defaults out shows no count.
  const differs = settingsChanged(data, subject(), {
    wanted: state.when,
    service: $('standard-field').hidden ? null : state.service,
    standard: $('standard-field').hidden ? null : standardFor(state.service),
  });
  if (!$('when-field').hidden) {
    const { window, spec } = tripWindow();
    parts.push(window === USUAL ? 'usual times' : (spec.label || spec.when || ''));
    if (differs.includes('when')) changed += 1;
  }
  if (!$('standard-field').hidden) {
    parts.push(`${standardFor(state.service)} min`);
    if (differs.includes('standard')) changed += 1;
  }
  if (!$('limit-field').hidden) {
    parts.push(`jobs within ${jobsChoice().limit} min`);
    if (jobsChoice().limit !== jobsChoice().limits[jobsChoice().limits.length - 1]) changed += 1;
  }
  if (!$('traveller').hidden) {
    const profile = ((data.meta.fares || {}).profiles || []).find((p) => p.key === state.profile);
    if (profile && state.profile !== 'adult') {
      parts.push(profile.label);
      changed += 1;
    }
    const firstPayment = (payments(data.meta.fares || {})[0] || [])[0];
    if (firstPayment && state.payment !== firstPayment) changed += 1;
    if (!state.returnTrip) changed += 1;
  }
  if (!$('budget-field').hidden) {
    parts.push(state.budget == null ? 'any fare' : $('budget-value').textContent);
    if (state.budget != null) changed += 1;
  }
  const any = ['where-field', 'when-field', 'standard-field', 'limit-field', 'traveller', 'budget-field'].some((id) => !$(id).hidden);
  $('open-settings').hidden = !any;
  if (!any && openDrawer === 'settings') setDrawer(null);
  const line = parts.filter(Boolean).join(' · ') || 'Everyone, everywhere';
  $('settings-summary').textContent = line[0].toUpperCase() + line.slice(1);
  const badge = $('settings-count');
  badge.hidden = changed === 0;
  badge.textContent = String(changed);
  badge.title = `${changed} ${changed === 1 ? 'setting differs' : 'settings differ'} from the default`;
}

// ---------------------------------------------------------------- the key

/** Everything the key could show now: the view's key, or MATE's catchment
 *  when one is painted, then the layers that are on. */
function keyNow(catchment) {
  let spec = $('view').keySpec || null;
  if (catchment && catchment.kind === 'reach') {
    // Picking a trip's destination: how far the origin gets.
    spec = {
      mode: catchment.key.title,
      short: 'From here',
      scale: { items: catchment.key.rows.map(([label, k, short]) => ({ colour: catchment.colours[k], label, short })) },
      notes: [catchment.key.note],
    };
  } else if (catchment) {
    spec = {
      mode: catchment.key.title,
      short: catchment.key.title.split(':')[0],
      scale: { items: catchment.key.rows.map(([label, k, short]) => ({ colour: catchment.colours[k], label, short, hatch: k === mate.LOST })) },
      notes: [`${catchment.key.note[0].toUpperCase()}${catchment.key.note.slice(1)}.`],
    };
  }
  const out = spec ? { ...spec } : { mode: current && current.waiting ? 'Loading…' : '', notes: [] };
  // MATE's map switch, for a hexagon with a catchment to show.
  const focus = focusCell();
  const tripTab = tripOpen() && card.tab === 'trip';
  if (MATE && mate && focus != null && !card.picking && !tripTab && MATE_PLACES.includes(CITY) && mateHasTimes(focus)) {
    out.after = [el('p', 'k-sub', tripOpen() ? `Hexagon: ${card.tab === 'to' ? 'To' : 'From'}` : 'Hexagon picked'), mate.mapSwitch(mateState, setMate, 'key-mate-map')];
  }
  // On the Trip tab, what the trip draws; TEAM's hexagons are faded under it, and so is their scale here.
  // The scale keeps its title; its notes give way to the trip's lines.
  const legend = tripLegendNow();
  if (legend.length) {
    out.trip = legend;
    out.faded = true;
    out.notes = [];
  }
  out.onMap = [];
  // Under a school choice the schools are pinned, counted or not.
  const choice = appliedChoice();
  const schoolPins = Boolean(choice) || (schoolsAvailable() && state.schools.kind === 'one');
  if (schoolPins) {
    const colour = DESTINATION_COLOURS[state.service] || DESTINATION_OTHER;
    if (choice && choice.kind === 'one') {
      out.onMap.push({ swatch: 'dot', colour: '#0c0c48', label: wordsFor().short });
      if (schoolCells()?.any) out.onMap.push({ swatch: 'line', colour: '#0c0c48', label: 'Its zone' });
      if (data.cellShare) out.onMap.push({ swatch: 'square', colour: OUTSIDE_ZONE, label: 'Outside its zone, not counted' });
      const stops = schoolStops();
      const listed = stops ? stopsAt(stops, schoolIndex()) : null;
      if (listed && listed.some((row) => !isFarStop(row, stops))) {
        out.onMap.push({ swatch: 'stop', colour: '#ffffff', label: `Stops within a ${stops.maxWalk}-minute walk, with the minutes; a dot where numbers would overlap` });
      }
      if (listed && listed.some((row) => stops.stops[row.s]?.mode)) out.onMap.push({ swatch: 'station', colour: '#0c0c48', label: 'Train or ferry station, with the minutes' });
      out.onMap.push({ swatch: 'ring', colour: '#6b767c', label: 'Other schools' });
    } else if (choice) {
      out.onMap.push({ swatch: 'dot', colour, label: 'School counted' }, { swatch: 'ring', colour: '#6b767c', label: 'Not counted' });
    } else {
      out.onMap.push({ swatch: 'dot', colour, label: 'Click a school to pick it' });
    }
  }
  for (const [k, spec2] of Object.entries(OVERLAYS)) {
    if (!state.overlays[k] || !spec2.key) continue;
    for (const entry of spec2.key) {
      const destination = k === 'destinations';
      if (destination && (!singleService() || schoolPins)) continue;
      out.onMap.push({
        swatch: entry.swatch,
        colour: entry.colour || DESTINATION_COLOURS[state.service] || DESTINATION_OTHER,
        label: destination ? capitalise(SERVICE_PLURAL[state.service] || SERVICE_SHORT[state.service]) : entry.label,
      });
    }
  }
  return out;
}

const capitalise = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

function singleService() {
  return state.measure !== 'score' && state.service !== 'jobs' && state.service !== 'errands';
}

function swatchOf(kind, colour, hatch = false) {
  const swatch = el('span', `key-swatch key-${kind}${hatch ? ' key-hatch' : ''}`);
  swatch.style.setProperty('--swatch', colour);
  return swatch;
}

/** The key's contents. `compact` is the strip a phone shows under the headline. */
function keyContent(spec, { compact = false } = {}) {
  const nodes = [];
  if (spec.scale && spec.scale.items && spec.scale.items.length) {
    const box = el('div', `scale${spec.faded ? ' is-faded' : ''}`);
    if (compact && spec.mode) box.append(el('span', 'k-what', spec.short || spec.mode));
    const bars = el('div', 'scale-bars');
    const columns = `repeat(${spec.scale.items.length}, minmax(0, 1fr))`;
    const swatches = el('div', 'scale-bar');
    const labels = el('div', 'scale-lab');
    swatches.style.gridTemplateColumns = columns;
    labels.style.gridTemplateColumns = columns;
    spec.scale.items.forEach((item, k) => {
      const sw = el('span', `sw${spec.scale.divider === k ? ' is-std' : ''}${item.hatch ? ' key-hatch' : ''}`);
      sw.style.background = item.hatch ? '' : item.colour;
      if (item.hatch) sw.style.setProperty('--swatch', item.colour);
      swatches.append(sw);
      labels.append(el('span', null, compact ? item.short || shortScaleLabel(item.label) : item.label));
    });
    bars.append(swatches, labels);
    box.append(bars);
    nodes.push(box);
  }
  if (spec.rows && spec.rows.length) {
    const list = el('div', 'k-rows');
    list.dataset.group = compact ? 'key-strip-rows' : 'key-rows';
    spec.rows.forEach((row, k) => {
      const item = el(row.onPick ? 'button' : 'div', `k-row${row.faded ? ' is-faded' : ''}`);
      if (row.onPick) {
        item.type = 'button';
        item.setAttribute('aria-pressed', String(Boolean(row.pressed)));
        item.dataset.value = String(k);
        item.addEventListener('click', row.onPick);
      }
      // A switch shows a tick, with any colour it draws beside its label; a
      // reason shows its colour.
      if (row.toggle) item.classList.add('is-toggle');
      item.append(row.toggle || !row.colour ? el('span', `k-check${row.pressed ? ' is-on' : ''}`) : swatchOf('square', row.colour));
      const text = el('span', 'k-text');
      const name = el('span', null, row.label);
      if (row.toggle && row.colour) name.prepend(swatchOf('square', row.colour));
      text.append(name);
      if (row.sub && !compact) text.append(el('span', 'k-fix', row.sub));
      item.append(text, el('span', 'k-count', row.count || ''));
      list.append(item);
    });
    nodes.push(list);
  }
  const notes = (spec.notes || []).filter(Boolean);
  for (const text of compact ? notes.slice(0, 1) : notes) nodes.push(el('p', 'note', text));
  if (spec.after) nodes.push(...spec.after);
  // A trip on the Trip tab: what is drawn, a short line for each part.
  if (spec.trip && spec.trip.length) {
    if (!compact) nodes.push(el('p', 'k-sub', 'Trip'));
    for (const group of spec.trip) {
      const line = el('p', 'k-trip');
      line.dataset.group = `key-trip-${group.key}`;
      if (group.title) line.append(el('span', 'k-trip-title', group.title));
      for (const item of group.items) {
        const part = el('span', 'k-trip-item');
        part.append(swatchOf(item.swatch, item.colour), el('span', null, item.label));
        line.append(part);
      }
      nodes.push(line);
    }
  }
  if (spec.onMap && spec.onMap.length) {
    nodes.push(el('p', 'k-sub', 'On the map'));
    const list = el('div', 'k-rows k-layers');
    for (const row of spec.onMap) {
      const item = el('div', 'k-row');
      item.append(swatchOf(row.swatch, row.colour), el('span', 'k-text', row.label), el('span'));
      list.append(item);
    }
    nodes.push(list);
  }
  return nodes;
}

let lastKey = null;


/** Draw the docked key, the strip under the headline on a phone, and the
 *  strip above the card when a phone shows one. */
function renderKey(catchment) {
  const spec = keyNow(catchment);
  lastKey = spec;
  $('key-mode').textContent = spec.mode || '';
  $('key-body').replaceChildren(...keyContent(spec));
  // A phone shows the key as a strip in the sheet, under the headline.
  const heroBox = $('view').querySelector('.hero');
  $('view').querySelector('.key-inline')?.remove();
  if (phone() && heroBox) {
    const strip = el('div', 'key-inline');
    strip.append(...keyContent(spec, { compact: true }));
    // After the line that says which schools are counted, which belongs to the headline.
    ($('view').querySelector('.counting') || heroBox).after(strip);
  }
  // With the card open on a phone, the strip sits over the map, above the card.
  let float = $('key-strip');
  if (!float) {
    float = el('div', 'key-strip');
    float.id = 'key-strip';
    float.setAttribute('aria-label', 'Map key');
    float.setAttribute('role', 'group');
    document.body.append(float);
  }
  const showFloat = phone() && state.selected != null && !$('place').hidden && Boolean(spec.scale || spec.trip);
  float.hidden = !showFloat;
  if (showFloat) float.replaceChildren(...keyContent({ mode: spec.mode, short: spec.short, scale: spec.scale, faded: spec.faded, trip: spec.trip }, { compact: true }));
  window.requestAnimationFrame(() => {
    document.body.style.setProperty('--strip-h', showFloat ? `${Math.round(float.getBoundingClientRect().height) + 8}px` : '0px');
  });
  fitKey();
}

/** Beside the map, the panel and the key share the left column. The panel keeps room down to the end of its
 *  headline (the figure and its sentence), so a long key never hides it; the key takes what is left, up to its
 *  usual share, and scrolls inside that. A phone shows the key elsewhere. */
function fitKey() {
  const key = $('key');
  const body = $('panel-body');
  const hero = $('view').querySelector('.hero');
  const parts = hero ? [...hero.children].filter((node) => /hero-(figure|text|sub)/.test(node.className)) : [];
  // Which schools a figure counts is part of its headline.
  const counting = parts.length ? $('view').querySelector('.counting') : null;
  if (counting) parts.push(counting);
  if (phone() || !parts.length || openDrawer || document.body.dataset.panel === 'collapsed' || !body.clientHeight) {
    key.style.removeProperty('--key-room');
    return;
  }
  const top = body.getBoundingClientRect().top - body.scrollTop;
  const end = Math.max(...parts.map((node) => node.getBoundingClientRect().bottom)) - top;
  const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
  const side = $('side');
  const gap = parseFloat(getComputedStyle(side).rowGap) || 0;
  // The panel outside its scrolling body: the header, the drawer buttons and the foot.
  const rest = $('panel').getBoundingClientRect().height - body.clientHeight;
  const room = side.clientHeight - gap - rest - Math.ceil(end + pad);
  // Never less than the key's own header.
  key.style.setProperty('--key-room', `${Math.max(Math.floor(room), 42)}px`);
}

// ---------------------------------------------------------------- drawers

let openDrawer = null;

/** Open Settings or Layers, or close both: one at a time. The tab's body and
 *  the key step aside while one is open; the pickers and tabs stay. */
function setDrawer(name) {
  openDrawer = name;
  const side = $('side');
  if (name) side.dataset.drawer = name;
  else delete side.dataset.drawer;
  for (const button of document.querySelectorAll('.drawers [data-drawer]')) {
    const on = button.dataset.drawer === name;
    button.setAttribute('aria-expanded', String(on));
    $(`drawer-${button.dataset.drawer}`).hidden = !on;
  }
  fitKey();
}

/** The Layers drawer: grouped rows, each with its symbol and a caption, and
 *  the count of layers on, on its button. */
function renderLayers() {
  for (const [k, spec] of Object.entries(OVERLAYS)) {
    const row = document.querySelector(`#layer-list [data-layer="${k}"]`);
    if (!row) continue;
    const box = row.querySelector('input');
    box.checked = Boolean(state.overlays[k]);
    if (k === 'destinations') {
      const single = singleService();
      row.querySelector('.layer-name').textContent = single ? capitalise(SERVICE_PLURAL[state.service] || SERVICE_SHORT[state.service]) : spec.label;
      row.querySelector('.layer-cap').textContent = single ? 'Follows Getting to · click one for its name' : 'Pick one service under Getting to';
      const sw = row.querySelector('.key-swatch');
      sw.style.setProperty('--swatch', DESTINATION_COLOURS[state.service] || DESTINATION_OTHER);
    }
  }
  const on = Object.keys(OVERLAYS).filter((k) => state.overlays[k]).length;
  const badge = $('layer-count');
  badge.hidden = on === 0;
  badge.textContent = String(on);
  $('layers-summary').textContent = `${BASEMAPS[state.basemap].label} basemap${on ? '' : ' · none on'}`;
}

function renderBasemaps() {
  for (const button of document.querySelectorAll('[data-basemap]')) {
    button.setAttribute('aria-pressed', String(button.dataset.basemap === state.basemap));
  }
}

// ---------------------------------------------------------------- the area list

/** The area in the headline is a button that opens the list of areas the
 *  panel's figures can be for. */
function linkAreaName() {
  const text = $('view').querySelector('.hero .hero-text');
  if (!text || !scope) return;
  const where = areaNow();
  const name = where ? areaPhrase(where.area).replace(/^the /, '') : place.name;
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    // Only where the sentence is about the area ("people in Auckland", "a
    // resident of Albany"), not "the Auckland average" or "Auckland's jobs".
    let at = -1;
    for (let from = 0; ; from = at + 1) {
      at = node.textContent.indexOf(name, from);
      if (at < 0) break;
      const before = node.textContent.slice(0, at);
      const next = node.textContent[at + name.length] || '';
      if (/\b(in|of) (the )?$/.test(before) && !/['’]/.test(next)) break;
    }
    if (at < 0) continue;
    const after = node.splitText(at);
    after.splitText(name.length);
    const button = el('button', 'area-pick', name);
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'area-menu');
    button.title = 'Figures for another area';
    button.addEventListener('click', () => openAreaMenu(button));
    after.replaceWith(button);
    return;
  }
}

function openAreaMenu(trigger) {
  const menu = $('area-menu');
  const centre = visibleCentre();
  const chain = chainAt(scope, cellNear(centre.lat, centre.lng));
  const where = areaNow();
  const items = [];
  const add = (label, hint, go, current) => {
    const item = el('button', `area-item${current ? ' is-current' : ''}`);
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.append(el('span', null, label), hint ? el('span', 'area-hint', hint) : '');
    item.addEventListener('click', () => {
      closeAreaMenu(false);
      go();
    });
    items.push(item);
  };
  const heading = (text) => {
    const h = el('p', 'area-group', text);
    h.setAttribute('role', 'presentation');
    items.push(h);
  };
  add(place.name, 'all of it', goToPlace, !where);
  if (chain.length) heading('Under the middle of the map');
  for (const area of chain) {
    const hint = areaLabel(area).toLowerCase().includes(LEVEL_NAME[area.level]) ? null : LEVEL_NAME[area.level];
    add(areaLabel(area), hint, () => goToArea({ level: area.level, name: area.name }, area.bbox),
      where && where.area.level === area.level && where.area.id === area.id);
  }
  const boards = scope.levels.board ? scope.levels.board.names.map((n, id) => ({ n, id })).filter(({ id }) => scope.levels.board.people[id] > 0) : [];
  if (boards.length) {
    heading('Local boards');
    for (const { n } of [...boards].sort((a, b) => a.n.localeCompare(b.n))) {
      const found = areaNamed(scope, 'board', n);
      add(`${n} Local Board`, null, () => goToArea({ level: 'board', name: n }, found && found.area.bbox),
        where && where.area.level === 'board' && where.area.name === n);
    }
  }
  menu.replaceChildren(...items);
  menu.hidden = false;
  const box = trigger.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
  const below = window.innerHeight - box.bottom - 12;
  menu.style.maxHeight = `${Math.max(180, Math.min(420, below > 200 ? below : box.top - 12))}px`;
  if (below > 200) {
    menu.style.top = `${box.bottom + 4}px`;
    menu.style.bottom = '';
  } else {
    menu.style.top = '';
    menu.style.bottom = `${window.innerHeight - box.top + 4}px`;
  }
  trigger.setAttribute('aria-expanded', 'true');
  menu.trigger = trigger;
  (menu.querySelector('.is-current') || menu.querySelector('[role="menuitem"]'))?.focus();
}

function closeAreaMenu(refocus = true) {
  const menu = $('area-menu');
  if (menu.hidden) return false;
  menu.hidden = true;
  if (menu.trigger) {
    menu.trigger.setAttribute('aria-expanded', 'false');
    if (refocus && document.contains(menu.trigger)) menu.trigger.focus();
  }
  return true;
}

const LEVEL_NAME = { council: 'council', ward: 'ward', board: 'local board', suburb: 'suburb' };

// ---------------------------------------------------------------- phone sheet

const PHONE = window.matchMedia('(max-width: 760px)');
const phone = () => PHONE.matches;
const SHEETS = ['peek', 'half', 'full'];

/** Set a sheet's height on a phone: peek, half or full. */
function setSheet(box, size) {
  box.dataset.sheet = size;
  box.style.height = '';
  const handle = box.querySelector('.sheet-handle');
  if (handle) handle.setAttribute('aria-label', size === 'full' ? 'Show less' : 'Show more');
  if (box === $('side')) {
    document.body.dataset.sheet = size;
    if (size === 'peek') box.scrollTop = 0;
  }
  window.requestAnimationFrame(sheetHeight);
}

/** How much of the map the sheet covers, for the credits and the scale. */
function sheetHeight() {
  if (!phone()) {
    document.body.style.removeProperty('--sheet-h');
    return;
  }
  const open = !$('place').hidden ? $('place') : $('side');
  document.body.style.setProperty('--sheet-h', `${Math.round(open.getBoundingClientRect().height)}px`);
}

/** Tap the handle to go up a size (and from full back to peek); drag it to
 *  any height and it settles on the nearest. */
function wireSheet(box, handle, { sizes = SHEETS } = {}) {
  let start = null;
  handle.addEventListener('click', () => {
    if (start && start.moved) return;
    const now = sizes.indexOf(box.dataset.sheet);
    setSheet(box, sizes[(now + 1) % sizes.length]);
  });
  handle.addEventListener('pointerdown', (event) => {
    if (!phone()) return;
    start = { y: event.clientY, h: box.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(event.pointerId);
    box.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dy = start.y - event.clientY;
    if (Math.abs(dy) > 6) start.moved = true;
    if (start.moved) box.style.height = `${Math.max(120, Math.min(window.innerHeight - 40, start.h + dy))}px`;
  });
  const end = () => {
    if (!start) return;
    box.classList.remove('dragging');
    if (start.moved) {
      const h = box.getBoundingClientRect().height;
      const targets = { peek: 190, half: window.innerHeight * 0.56, full: window.innerHeight - 52 };
      const near = sizes.reduce((a, b) => (Math.abs(targets[b] - h) < Math.abs(targets[a] - h) ? b : a), sizes[0]);
      setSheet(box, near);
      // The click that follows a drag is not a tap.
      window.setTimeout(() => { start = null; }, 0);
    } else {
      start = null;
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/** The sheet at its lowest: what is on screen and the headline, in one look. */
function renderPeek() {
  const peek = $('peek');
  const heroBox = $('view').querySelector('.hero');
  const figure = heroBox?.querySelector('.hero-figure')?.textContent || '';
  const text = heroBox?.querySelector('.hero-text')?.textContent || $('view').textContent.trim().slice(0, 160);
  const sub = heroBox?.querySelector('.hero-sub')?.textContent || '';
  const goal = state.measure === 'score'
    ? $('goal').selectedOptions[0]?.textContent || 'Access score'
    : shortOf(state.service);
  const how = state.view !== 'access' && state.measure !== 'score'
    ? { people: 'Who misses out', fixes: 'What would help' }[state.view]
    : $('mode-picker').querySelector('[aria-checked="true"]')?.title?.split(':')[0]
      || $('mode-picker').querySelector('.modes-more.is-on')?.selectedOptions[0]?.textContent || '';
  const what = el('span', 'peek-what', [place.name, goal, how].filter(Boolean).join(' · '));
  const line = el('span', 'peek-line');
  line.append(el('span', 'hero-figure', figure), el('span', 'peek-text', `${text}${sub ? ` ${sub}` : ''}`));
  const strip = el('span', 'peek-key');
  if (lastKey && lastKey.scale) strip.append(...keyContent({ mode: lastKey.mode, short: lastKey.short, scale: lastKey.scale }, { compact: true }));
  peek.replaceChildren(what, line, strip);
}

let announceTimer = 0;
/** Say the headline once the panel settles, not the whole panel every change. */
function announce() {
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    // What a trip just said is not talked over.
    if (Date.now() < sayUntil) return;
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
  if (state.service === 'jobs' && shown && shown.panel && shown.panel.show === 'burden') {
    mini.textContent = `Commuting by public transport · ${percentOf(shown.panel.overall)} of a week's income on average`;
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
  mini.textContent = `${shortOf(state.service)} · ${Math.round(share * 100)}% within ${standard} min ${how}${fareClause()}`;
}

/** Where keyboard focus was, so it can be put back after the panel is
 *  redrawn: a choice in a group, an element with an id, or a fold. */
function focusKey() {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  if (active.dataset?.value != null) {
    const group = active.closest('[data-group]');
    if (group) return ['group', group.dataset.group, active.dataset.value];
  }
  if (active.id) return ['id', active.id];
  if (active.tagName === 'SUMMARY' && active.parentElement?.dataset.fold) return ['fold', active.parentElement.dataset.fold];
  return null;
}

function restoreFocus(key, within = document) {
  if (!key || (document.activeElement && document.activeElement !== document.body)) return;
  const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : v);
  let target = null;
  if (key[0] === 'group') target = within.querySelector(`[data-group="${esc(key[1])}"] [data-value="${esc(key[2])}"]`);
  else if (key[0] === 'id') target = document.getElementById(key[1]);
  else if (key[0] === 'fold') target = within.querySelector(`[data-fold="${esc(key[1])}"] > summary`);
  target?.focus();
}

function update() {
  const focused = focusKey();
  const t0 = performance.now();
  schoolsReady = syncSchools();
  current = compute();
  // Rural hexagons are left off the map when only urban areas are counted.
  if (state.urbanOnly && data.urban) {
    current.classes = Int8Array.from(current.classes, (c, i) => (data.urban[i] ? c : -1));
  }
  // The hexagons outside one school's zone, when only it is counted, are
  // greyed: lived in, but not counted. Hexagons partly inside keep their colour.
  if (data.cellShare && !current.waiting) {
    const grey = current.colours.length;
    const living = data.everywhere.pop;
    current.classes = Int8Array.from(current.classes, (c, i) => (data.cellShare[i] > 0 ? c : living[i] > 0 ? grey : -1));
    current.colours = [...current.colours, OUTSIDE_ZONE];
  }
  const t1 = performance.now();
  // With MATE on and a hexagon picked, the map shows its catchment instead;
  // while a trip's destination is picked, how far the origin gets.
  const catchment = card.picking ? pickModel() : mateCatchment();
  painted = catchment || current;
  // The panel is worth drawing even when the basemap has not arrived.
  try {
    paintCells(map, painted.classes, painted.colours);
    if (MATE) setHatch(map, catchment ? catchment.lost : []);
  } catch (error) {
    console.warn('The map is not ready to paint yet.', error);
  }
  const t2 = performance.now();
  renderLayers();
  if (current.waiting) {
    // The controls for this view read the data still on its way; they are
    // drawn when it arrives.
    shown = current;
    renderView(current);
    renderKey(catchment);
    renderPeek();
    renderSchoolMap();
    if (state.selected != null) showPlace(state.selected);
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
  renderLimit();
  renderBudget();
  renderTravellerFields();
  // The key stays the whole place's, as the map is, wherever the figures are for.
  renderView(shown);
  if (shown !== current) renderAround(aroundFigures(where));
  linkAreaName();
  renderKey(catchment);
  const t4 = performance.now();
  renderSettings();
  renderMini(shown !== current ? where.area : null);
  renderPeek();
  restoreFocus(focused);
  announce();
  window.team.timing = { compute: Math.round(t1 - t0), paint: Math.round(t2 - t1), panel: Math.round(performance.now() - t2), area: Math.round(t4 - t3) };
  const schoolPins = renderSchoolMap();
  try {
    showDestinationsFor(map, singleService() && !schoolPins ? state.service : null);
  } catch (error) {
    console.warn('Destination pins are not ready yet.', error);
  }
  if (state.selected != null) showPlace(state.selected);
  if (TRIPS) drawTrip();
}

/** The verdict band for an errand round, which only this file can time. */
function errandLead(i) {
  if (state.service !== 'errands' || state.measure === 'score' || !data.roundSets?.[errandStops().join('+')]) return null;
  const t = roundTimes()[i];
  const standard = standardFor('errands');
  const meets = Number.isFinite(t) && t <= standard;
  return {
    state: meets ? 'meets' : 'misses',
    badge: meets ? 'Meets' : 'Misses',
    strong: Number.isFinite(t) ? `Errand round: ${Math.round(t)} min of travel.` : 'Errand round: none within these limits.',
    rest: `The standard is ${standard} min.`,
  };
}

/** Under the tiles: Plan a trip from here (behind ?mate=1, in Auckland), or a
 *  line saying trips are not yet here. Nothing without ?mate=1, on a trip's To
 *  tab, or while a destination is being picked. */
function tripSlot(tab = null) {
  if (!MATE) return null;
  if (!MATE_PLACES.includes(CITY)) return el('p', 'not-yet', 'Trips and mobility profiles: not yet for this place.');
  if (tab === 'to' || card.picking) return null;
  const slot = el('div', 'trip-slot');
  slot.id = 'trip-slot';
  const plan = el('button', 'btn', 'Plan a trip from here');
  plan.type = 'button';
  plan.id = 'trip-plan';
  plan.addEventListener('click', startPicking);
  slot.append(plan);
  return slot;
}

/** At the top of the card while a destination is picked: what to do, and Cancel. */
function pickTop() {
  if (!card.picking || !trips.view) return null;
  const strip = trips.view.pickStrip({ phone: phone(), message: card.message, onCancel: cancelPicking, limit: pickLimit() });
  if (phone()) return strip;
  return [strip, el('p', 'note', `The map shows where you can get from here within ${pickLimit()} minutes. Escape cancels.`)];
}

/** A trip's From or To card opens on which end it is. */
function endLine(i, tab) {
  const head = placeHeader(data, i);
  const line = el('p', 'end-head');
  line.append(el('span', `map-tag is-${tab}`, tab === 'to' ? 'To' : 'From'), el('strong', null, head.title));
  if (head.sub) line.append(el('span', 'end-sub', head.sub));
  return line;
}

function showPlace(i) {
  const box = $('place');
  const opening = box.hidden;
  box.hidden = false;
  document.body.dataset.place = 'open';
  if (opening && phone()) setSheet(box, 'half');
  const trip = tripOpen();
  const head = placeHeader(data, i);
  if (!data.complete || !schoolsReady) {
    // The card reads the measures sent after the map, and under a school
    // choice the school times; it is drawn again when they arrive.
    $('place-eyebrow').textContent = head.eyebrow;
    $('place-title').textContent = head.title;
    $('place-sub').textContent = head.sub;
    $('place-body').replaceChildren(el('p', 'note', 'Loading the details for this place…'));
    renderCardTabs();
    return;
  }
  // The card is drawn afresh, so keep focus on the control that had it.
  const active = document.activeElement;
  const keep = active && box.contains(active) ? focusKey() : null;
  try {
    if (trip) renderTripHead();
    if (trip && card.tab === 'trip') {
      renderTripTab();
    } else {
      // With a trip open, the To tab is the same card for the destination.
      const cell = trip && card.tab === 'to' ? card.dest : i;
      const key = trip ? `card-${card.tab}` : 'card';
      const extra = MATE && MATE_PLACES.includes(CITY) ? [mateSection(cell, key)] : [];
      // A trip's header names both ends, so each end's own goes in a line of its own.
      const header = trip ? { title: el('h2'), sub: el('p') } : { eyebrow: $('place-eyebrow'), title: $('place-title'), sub: $('place-sub') };
      renderPlace({ ...header, body: $('place-body') }, data, cell, state, {
        lead: errandLead(cell),
        top: pickTop(),
        slot: tripSlot(trip ? card.tab : null),
        extra,
        key,
        school: state.measure !== 'score' ? schoolCard() : null,
      });
      if (trip) $('place-body').prepend(endLine(cell, card.tab));
    }
  } catch (error) {
    // Better an honest gap than the last place's figures under a new name.
    $('place-eyebrow').textContent = head.eyebrow;
    $('place-title').textContent = head.title;
    $('place-sub').textContent = '';
    $('place-body').replaceChildren(el('p', 'note', 'The details for this place could not be shown.'));
    console.error('Place card failed', i, error);
  }
  renderCardTabs();
  renderCardActions();
  if (keep) restoreFocus(keep, box);
  window.requestAnimationFrame(sheetHeight);
}

function closePlace() {
  if (card.picking) endPicking();
  card.trip = false;
  card.tab = 'from';
  card.dest = null;
  drawTrip();
  select(map, state.selected, null);
  state.selected = null;
  $('place').hidden = true;
  delete document.body.dataset.place;
  schedule();
  writeHash();
  window.requestAnimationFrame(sheetHeight);
}

// ---------------------------------------------------------------- trips (?mate=1, Auckland)

// A trip goes from the hexagon picked (state.selected) to `card.dest`. The
// card then has From, To and Trip tabs (From and To are the one-hexagon card
// for each end, folding apart as `card-from` and `card-to`). `card.picking`
// is set while the destination is being picked. trip_data.js fetches the
// figures and trip.js draws the Trip tab; both load the first time a trip is
// planned, and only with ?mate=1 in Auckland.
const card = { tab: 'from', trip: false, dest: null, picking: false, message: null };
const TRIPS = MATE && MATE_PLACES.includes(CITY);
const trips = {
  data: null,
  view: null,
  loading: null,
  store: null,
  // pairs/index.json: undefined until asked for, null when this build has no trips.
  index: undefined,
  // The origin's times to every cell, while a destination is picked.
  origin: null,
  cache: new Map(),
  // What the map draws for the trip, when set by hand; null for the default.
  show: { pt: null, foot: null },
  drawn: '',
  fitted: '',
  said: '',
};

function tripOpen() {
  return TRIPS && card.trip && card.dest != null && state.selected != null;
}

/** The hexagon whose card is on screen: the trip's To end on the To tab, else the one picked. */
function focusCell() {
  return tripOpen() && card.tab === 'to' ? card.dest : state.selected;
}

/** trip_data.js, trip.js and the place's pairs index, the first time a trip is asked for. */
function requestTrips() {
  if (!TRIPS) return Promise.resolve();
  if (trips.loading) return trips.loading;
  requestMateModule();
  trips.loading = Promise.all([import('./trip_data.js'), import('./trip.js')]).then(async ([dataModule, viewModule]) => {
    trips.data = dataModule;
    trips.view = viewModule;
    // Without the order check (no SubtleCrypto), the pairs are taken as they are.
    const order = await dataModule.cellOrder(data.h3).catch(() => null);
    trips.store = dataModule.tripStore({ base: `${DATA_BASE}${CITY}/`, ids: data.h3, order });
    trips.index = await dataModule.pairsIndex(trips.store).catch(() => null);
    tripChanged();
  }).catch((error) => {
    console.warn('Trips could not be loaded.', error);
    trips.index = null;
    tripChanged();
  });
  return trips.loading;
}

/** The window a trip is shown in: When, if it is one trips are timed in, else off-peak. */
function tripWindowNow() {
  return ['am_peak', 'interpeak', 'saturday'].includes(state.when) ? state.when : 'interpeak';
}

function cellLngLat(i) {
  const [lat, lng] = h3.cellToLatLng(data.h3[i]);
  return [lng, lat];
}

function tripKm(o, d) {
  return h3.greatCircleDistance(h3.cellToLatLng(data.h3[o]), h3.cellToLatLng(data.h3[d]), 'km');
}

/** The open trip's figures, fetched as they are needed: times, the walker's trip in the window shown, and for a
 *  short trip the routes on MATE's footpath map. Null until the trip modules are in. */
function tripEntry() {
  if (!tripOpen() || !trips.store || !trips.index) return null;
  const o = state.selected;
  const d = card.dest;
  const key = `${o}>${d}`;
  let entry = trips.cache.get(key);
  const D = trips.data;
  if (!entry) {
    const km = tripKm(o, d);
    entry = { o, d, km, short: km <= trips.view.SHORT_KM, times: undefined, swaps: new Map(), shapes: new Map(), routes: undefined };
    trips.cache.set(key, entry);
    D.pairTimes(trips.store, o, d).then((times) => { entry.times = times; }).catch((error) => {
      console.warn('Trip times could not be loaded.', error);
      entry.times = null;
    }).then(tripChanged);
    if (entry.short) {
      D.routeCells(trips.store, o, d, { variants: trips.view.FOOT_VARIANTS }).then((routes) => { entry.routes = routes; }).catch((error) => {
        console.warn('Routes on MATE\'s footpath map could not be worked out.', error);
        entry.routes = null;
      }).then(tripChanged);
    } else {
      entry.routes = null;
    }
  }
  const w = tripWindowNow();
  if (!entry.swaps.has(w)) {
    entry.swaps.set(w, undefined);
    D.legSwap(trips.store, o, d, w).then(async (swap) => {
      entry.swaps.set(w, swap);
      if (swap?.trip?.kind === 'ride') {
        const transit = await D.transitFile(trips.store).catch(() => null);
        entry.shapes.set(w, trips.view.rideShape(transit, swap.trip));
      }
    }).catch((error) => {
      console.warn('The public transport trip could not be loaded.', error);
      entry.swaps.set(w, null);
    }).then(tripChanged);
  }
  return entry;
}

/** The route on foot the map would draw for this trip, and what is drawn: { pt, foot }. */
function tripShow(entry) {
  const swap = entry ? entry.swaps.get(tripWindowNow()) : null;
  const route = entry && entry.routes && trips.view ? trips.view.routeFor(entry.routes, mateState.profile, mateState.dark, mateState.view) : null;
  const foot = Boolean(route && route.minutes != null);
  const pt = swap?.trip?.kind === 'ride';
  return {
    route,
    swap,
    foot: foot && (trips.show.foot ?? true),
    pt: pt && (trips.show.pt ?? !foot),
  };
}

/** Draw the open trip on the map, or clear it. Both ends are ringed and named on every tab; the lines and stops
 *  are drawn on the Trip tab, where they are switched on and off and the key explains them, with TEAM's
 *  hexagons faded under them. */
function drawTrip() {
  if (!map) return;
  let spec = null;
  if (tripOpen()) {
    const entry = card.tab === 'trip' ? tripEntry() : null;
    const show = tripShow(entry);
    const drawing = entry && trips.view ? trips.view.tripDrawing({
      start: cellLngLat(state.selected),
      end: cellLngLat(card.dest),
      trip: show.swap?.trip,
      shape: entry.shapes.get(tripWindowNow()),
      route: show.route,
      show,
    }) : null;
    spec = { origin: state.selected, dest: card.dest, drawing };
  }
  const signature = spec ? JSON.stringify([spec.origin, spec.dest, spec.drawing]) : '';
  if (signature === trips.drawn) return;
  try {
    setTrip(map, spec);
    fadeCells(map, Boolean(spec?.drawing?.lines?.length));
    trips.drawn = signature;
    if (spec?.drawing?.stops?.length) keepStopsInView(spec.drawing.stops);
  } catch (error) {
    console.warn('The trip is not ready to draw yet.', error);
  }
}

/** What the trip draws on the Trip tab, for the key: groups of short items (trip.js tripLegend). The two ends
 *  need none: each is named on the map. */
function tripLegendNow() {
  if (!tripOpen() || card.tab !== 'trip' || !trips.view) return [];
  const entry = tripEntry();
  const show = tripShow(entry);
  return trips.view.tripLegend({
    pt: show.pt,
    foot: show.foot,
    // A ride follows its line only where the map draws one and there is no change.
    straight: show.pt && !entry?.shapes.get(tripWindowNow()),
    profile: mateState.profile,
    dark: mateState.dark,
    view: mateState.view,
  });
}

/** Something new about the trip arrived or changed: draw it again. */
function tripChanged() {
  if (card.picking) {
    schedule();
    return;
  }
  if (!tripOpen()) return;
  drawTrip();
  if (state.selected != null) showPlace(state.selected);
  renderKey(painted && painted !== current ? painted : null);
  sayTrip();
}

/** Say the trip's answer once its times are in, once for each trip and window. */
function sayTrip() {
  const entry = tripEntry();
  if (!entry || entry.times === undefined || !trips.view) return;
  const w = tripWindowNow();
  const key = `${entry.o}>${entry.d}@${w}`;
  if (trips.said === key) return;
  trips.said = key;
  say(trips.view.tripSentence(entry.times, w, (data.meta.windows || {})[w]?.label || w));
}

/** The card's header for a trip: how far, from where to where, and when. */
function renderTripHead() {
  const w = tripWindowNow();
  const spec = (data.meta.windows || {})[w] || {};
  const km = tripKm(state.selected, card.dest);
  const distance = km < 1 ? `${Math.round(km * 20) * 50} m` : `${km.toFixed(1)} km`;
  $('place-eyebrow').textContent = `Trip · ${distance} in a straight line`;
  $('place-title').textContent = `${placeName(state.selected)} → ${placeName(card.dest)}`;
  $('place-sub').textContent = [spec.label, spec.when].filter(Boolean).join(', ');
}

/** What MATE knows of each end's footpath, for the profile chosen, by day. */
function tripEnds() {
  const got = mate ? mate.request(`${DATA_BASE}${CITY}/`, data.h3[state.selected], mateReady) : null;
  const core = got?.core;
  return {
    missing: { o: Boolean(core) && !mate.hasData(core, state.selected), d: Boolean(core) && !mate.hasData(core, card.dest) },
    // Null until MATE's data is in.
    lines: core ? { o: mate.footLine(core, state.selected, mateState.profile), d: mate.footLine(core, card.dest, mateState.profile) } : null,
  };
}

function renderTripTab() {
  const root = $('place-trip');
  if (!trips.view || trips.index === undefined) {
    requestTrips();
    root.replaceChildren(el('p', 'note', 'Loading the trip…'));
    return;
  }
  const entry = tripEntry();
  const show = tripShow(entry);
  const ends = tripEnds();
  trips.view.renderTrip(root, {
    status: trips.index === null ? 'unavailable' : entry ? 'ready' : 'loading',
    names: { o: placeName(state.selected), d: placeName(card.dest) },
    window: tripWindowNow(),
    windows: data.meta.windows || {},
    times: entry?.times,
    swap: show.swap,
    short: Boolean(entry?.short),
    routes: entry?.routes,
    mateMissing: ends.missing,
    ends: ends.lines,
    profile: mateState.profile,
    dark: mateState.dark,
    view: mateState.view,
    show,
    onWindow: (w) => set({ when: w }),
    onProfile: (profile) => setMate({ profile }),
    onShow: (kind, on) => {
      trips.show[kind] = on;
      tripChanged();
    },
    key: 'trip',
  });
}

// The live region for what a trip says. It sits outside the panel, which a
// phone hides while the card is open; the headline waits its turn.
let sayUntil = 0;
function say(text) {
  sayUntil = Date.now() + 3000;
  let region = $('trip-announce');
  if (!region) {
    region = el('p', 'visually-hidden');
    region.id = 'trip-announce';
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  region.textContent = text;
}

/** The longest the map's reach goes while picking, in minutes. */
function pickLimit() {
  const mode = trips.view ? trips.view.tripMode(pickViewMode()) : 'best';
  return mode === 'best' || mode === 'pt' ? 45 : 20;
}

/** The mode on screen, when the reach can follow it. */
function pickViewMode() {
  return state.view === 'access' && singleService() ? state.mode : 'best';
}

/** The origin's times to every cell, fetched when picking starts. Undefined while loading. */
function pickTimes() {
  const o = state.selected;
  if (trips.origin && trips.origin.o === o) return trips.origin.times;
  const entry = { o, times: undefined };
  trips.origin = entry;
  requestTrips()
    .then(() => (trips.index ? trips.data.originTimes(trips.store, o) : null))
    .then((times) => { entry.times = times; })
    .catch(() => { entry.times = null; })
    .then(() => {
      if (!card.picking) return;
      fitReach(entry);
      schedule();
    });
  return undefined;
}

/** Seen from far out, picking zooms to where the origin gets within 45 minutes. */
function fitReach(entry) {
  if (!entry.times || map.getZoom() >= 11.5) return;
  const reached = new Set([entry.o]);
  for (const m of ['walk', 'bike_low_stress']) for (const d of entry.times[m].keys()) reached.add(d);
  for (const d of entry.times.pt[tripWindowNow()].keys()) reached.add(d);
  const lons = [];
  const lats = [];
  for (const i of reached) {
    const [lng, lat] = cellLngLat(i);
    lons.push(lng);
    lats.push(lat);
  }
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: tripPadding(), maxZoom: 14, duration: 600 });
}

/** The map while a destination is picked: how far the origin gets. */
function pickModel() {
  if (!card.picking || !trips.view || state.selected == null) return null;
  const V = trips.view;
  const times = pickTimes();
  const mode = V.tripMode(pickViewMode());
  const w = tripWindowNow();
  const reach = V.reachOf(times, mode, w);
  const limits = times?.limits;
  const key = V.reachKey(mode, (data.meta.windows || {})[w]?.label || 'off-peak', limits);
  const origin = state.selected;
  return {
    kind: 'reach',
    classes: V.reachClasses(reach, data.n),
    colours: V.REACH,
    lost: [],
    tooltip: (j) => {
      if (j === origin) return ['The trip starts here'];
      if (times === undefined) return ['Loading…'];
      if (times === null) return ['No trips are timed from the hexagon picked'];
      return [V.reachText(reach.get(j), mode, limits)];
    },
    key: { title: `From ${placeName(origin)}`, rows: key.rows, note: key.note },
  };
}

// The mark in the middle of the map that Enter picks, for keyboards.
let pickMark = null;

function markPoint() {
  const box = map.getContainer().getBoundingClientRect();
  const card2 = $('place');
  if (phone()) {
    const bottom = card2.hidden ? box.height : card2.getBoundingClientRect().top - box.top;
    return { x: box.width / 2, y: Math.max(60, (60 + bottom) / 2) };
  }
  const left = $('side').getBoundingClientRect().right - box.left;
  const right = card2.hidden ? box.width : card2.getBoundingClientRect().left - box.left;
  return { x: (left + right) / 2, y: box.height / 2 };
}

function showPickMark(on) {
  if (!pickMark) {
    pickMark = el('div', 'pick-mark');
    pickMark.setAttribute('aria-hidden', 'true');
    document.body.append(pickMark);
  }
  pickMark.hidden = !on;
  if (!on) return;
  const box = map.getContainer().getBoundingClientRect();
  const p = markPoint();
  pickMark.style.left = `${Math.round(box.left + p.x)}px`;
  pickMark.style.top = `${Math.round(box.top + p.y)}px`;
}

function startPicking() {
  if (!TRIPS || state.selected == null) return;
  requestTrips();
  // A new destination replaces the trip that is open.
  if (card.trip) {
    card.trip = false;
    card.dest = null;
    card.tab = 'from';
    drawTrip();
  }
  card.picking = true;
  card.message = null;
  document.body.dataset.picking = 'true';
  setPicking(map, true);
  if (phone()) setSheet($('place'), 'peek');
  pickTimes();
  schedule();
  writeHash();
  say(phone() ? 'Tap where to go.' : 'Pick where to go. Click a hexagon on the map, or move the map with the arrow keys and press Enter.');
  if (!phone()) map.getCanvas().focus();
}

function endPicking() {
  card.picking = false;
  card.message = null;
  delete document.body.dataset.picking;
  setPicking(map, false);
  showPickMark(false);
}

function cancelPicking() {
  endPicking();
  if (phone()) setSheet($('place'), 'half');
  schedule();
  say('Trip cancelled.');
  window.requestAnimationFrame(() => $('trip-plan')?.focus());
}

function pickDestination(i) {
  if (i === state.selected) {
    card.message = 'That is the same hexagon. Pick another.';
    say(card.message);
    showPlace(state.selected);
    return;
  }
  endPicking();
  card.trip = true;
  card.dest = i;
  card.tab = 'trip';
  trips.show = { pt: null, foot: null };
  if (phone()) setSheet($('place'), 'half');
  drawTrip();
  fitTrip();
  schedule();
  writeHash();
  window.requestAnimationFrame(() => $('ctab-trip')?.focus());
}

/** Back to the From card, with no trip. */
function endTrip() {
  card.trip = false;
  card.dest = null;
  card.tab = 'from';
  drawTrip();
  schedule();
  writeHash();
  window.requestAnimationFrame(() => $('trip-plan')?.focus());
}

function swapTrip() {
  if (!tripOpen()) return;
  const from = state.selected;
  state.selected = card.dest;
  card.dest = from;
  select(map, from, state.selected);
  drawTrip();
  schedule();
  writeHash();
}

/** The part of the map the panel and card (or a phone's sheet) leave clear, as padding. */
function tripPadding() {
  const w = map.getContainer().clientWidth;
  const h = map.getContainer().clientHeight;
  // A phone's card sheet takes the lower 56% (196 px while picking), with the key's strip above it.
  return phone()
    ? { top: 80, bottom: (card.picking ? 196 : Math.round(h * 0.56)) + 90, left: 30, right: 30 }
    : { top: 60, bottom: 50, left: Math.min(400, Math.round(w * 0.3)), right: Math.min(390, Math.round(w * 0.3)) };
}

/** Fit both ends of the trip, whole hexagons and any `extra` points ([lon, lat]), into the part of the map the
 *  panel and card leave clear. */
function fitTrip(extra = []) {
  if (!map || !tripOpen()) return;
  const points = [...[state.selected, card.dest].flatMap((i) => h3.cellToBoundary(data.h3[i], true)), ...extra];
  const lons = points.map((q) => q[0]);
  const lats = points.map((q) => q[1]);
  const box = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
  // Room above each end for its label.
  const padding = tripPadding();
  padding.top += 24;
  map.fitBounds(box, { padding, maxZoom: 15.5, duration: 600 });
}

/** Once a trip's stops are drawn, bring them into view if they fell outside it. */
function keepStopsInView(stops) {
  const key = `${state.selected}>${card.dest}`;
  if (!stops || !stops.length || trips.fitted === key) return;
  trips.fitted = key;
  const pad = tripPadding();
  const box = map.getContainer().getBoundingClientRect();
  const outside = stops.some((stop) => {
    const p = map.project([stop.lon, stop.lat]);
    return p.x < pad.left || p.x > box.width - pad.right || p.y < pad.top || p.y > box.height - pad.bottom;
  });
  if (outside) fitTrip(stops.map((stop) => [stop.lon, stop.lat]));
}

/** The card's tabs, From, To and Trip, while a trip is open. */
function renderCardTabs() {
  const show = tripOpen();
  $('place-tabs').hidden = !show;
  $('place-trip').hidden = !show || card.tab !== 'trip';
  $('place-body').hidden = show && card.tab === 'trip';
  $('place-body').setAttribute('role', show ? 'tabpanel' : 'region');
  if (show) $('place-body').setAttribute('aria-labelledby', `ctab-${card.tab === 'trip' ? 'from' : card.tab}`);
  else $('place-body').removeAttribute('aria-labelledby');
  for (const tab of $('place-tabs').querySelectorAll('[role="tab"]')) {
    const on = tab.dataset.ctab === card.tab;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
}

/** Swap, in the card's header while a trip is open; Close then closes the trip. */
function renderCardActions() {
  const actions = $('place-actions');
  const open = tripOpen();
  $('place-close').setAttribute('aria-label', open ? 'Close the trip' : 'Close');
  $('place-close').title = open ? 'Close the trip' : '';
  if (!open) {
    actions.replaceChildren();
    return;
  }
  if ($('trip-swap')) return;
  const swap = el('button', 'icon-button');
  swap.type = 'button';
  swap.id = 'trip-swap';
  swap.title = 'Swap';
  swap.setAttribute('aria-label', 'Swap from and to');
  swap.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
  swap.addEventListener('click', swapTrip);
  actions.replaceChildren(swap);
}

function setCardTab(tab) {
  card.tab = tab;
  renderCardTabs();
  if (state.selected != null) showPlace(state.selected);
  // The map's catchment follows the end on screen.
  schedule();
}

// ---------------------------------------------------------------- MATE (?mate=1)

/** mate.js, the first time a hexagon is clicked. */
function requestMateModule() {
  if (mate || mateImport) return;
  mateImport = import('./mate.js').then((module) => {
    mate = module;
    if (mateParams) {
      const read = mate.readMateHash(mateParams);
      Object.assign(mateState, { profile: read.profile, dark: read.dark, view: read.view, map: read.map });
    }
    schedule();
  }).catch((error) => {
    mateImport = null;
    console.warn('MATE could not be loaded.', error);
  });
}

function mateReady() {
  schedule();
}

function setMate(patch) {
  Object.assign(mateState, patch);
  schedule();
  writeHash();
}

function mateSection(i, key = 'card') {
  if (!mate) {
    requestMateModule();
    const box = el('p', 'note', 'Loading MATE…');
    return box;
  }
  return mate.section({
    base: `${DATA_BASE}${CITY}/`,
    city: CITY,
    placeName: place.name,
    i,
    id: data.h3[i],
    urban: data.urban ? data.urban[i] === 1 : true,
    when: state.when,
    windows: data.meta.windows || {},
    // TEAM's jobs line: its window, and its share by public transport within 45 minutes.
    jobsWindow: data.activeWindow?.jobs || data.meta.jobs?.window || null,
    teamJobs: data.jobs?.pt?.['45']?.[i] ?? null,
    mate: mateState,
    serviceNames: SERVICE_SHORT,
    set: setMate,
    ready: mateReady,
    key,
  });
}

/** Whether MATE has times for this hexagon, once its data is in. */
function mateHasTimes(i) {
  const got = mate.request(`${DATA_BASE}${CITY}/`, data.h3[i], mateReady);
  return Boolean(got.core && got.core.cells.o[i] != null);
}

/** The catchment of the hexagon picked, for the map, once its data is in. */
function mateCatchment() {
  const i = focusCell();
  if (!MATE || !mate || i == null || !MATE_PLACES.includes(CITY) || !data.complete) return null;
  // On a trip's Trip tab the map is TEAM's, with the trip drawn on it.
  if (tripOpen() && card.tab === 'trip') return null;
  const got = mate.request(`${DATA_BASE}${CITY}/`, data.h3[i], mateReady);
  return mate.catchmentModel(got, i, mateState, data.n);
}

// ---------------------------------------------------------------- wiring

/** The basemap buttons: on the map, and again at the foot of the Layers drawer. */
function basemapButtons(container) {
  for (const [key, spec] of Object.entries(BASEMAPS)) {
    const button = el('button', null, spec.label);
    button.type = 'button';
    button.dataset.basemap = key;
    button.setAttribute('aria-pressed', String(key === state.basemap));
    button.addEventListener('click', () => {
      // On a phone the map shows only the basemap in use; a tap opens the rest.
      if (phone() && container.id === 'map-basemaps' && !container.classList.contains('open') && key === state.basemap) {
        container.classList.add('open');
        return;
      }
      container.classList.remove('open');
      if (key === state.basemap) return;
      state.basemap = key;
      setBasemap(map, key);
      renderBasemaps();
      renderLayers();
      writeHash();
    });
    container.append(button);
  }
}

/** The rows of the Layers drawer, grouped, each with its symbol and caption. */
function layerRows() {
  const list = $('layer-list');
  const groups = new Map();
  for (const [key, spec] of Object.entries(OVERLAYS)) {
    if (!groups.has(spec.group)) groups.set(spec.group, []);
    groups.get(spec.group).push([key, spec]);
  }
  const nodes = [];
  for (const [group, entries] of groups) {
    nodes.push(el('p', 'group-title', group));
    for (const [key, spec] of entries) {
      const row = el('label', 'layer');
      row.dataset.layer = key;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = `layer-${key === 'frequent_bus' ? 'bus' : key}`;
      box.addEventListener('change', () => {
        state.overlays[key] = box.checked;
        applyOverlays();
        renderLayers();
        renderKey(painted && painted !== current ? painted : null);
        renderPeek();
      });
      const first = spec.key[0];
      const swatch = el('span', `key-swatch key-${first.swatch}`);
      swatch.style.setProperty('--swatch', first.colour || DESTINATION_OTHER);
      row.append(box, swatch, el('span', 'layer-name', spec.label), el('span', 'layer-cap', spec.caption ? spec.caption(data.meta) : ''));
      nodes.push(row);
    }
  }
  list.replaceChildren(...nodes);
}

function wireControls() {
  for (const tab of document.querySelectorAll('#tabs [role="tab"]')) {
    tab.addEventListener('click', () => set({ view: tab.dataset.view }));
    tab.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: 1, ArrowLeft: 2, Home: 'first', End: 'last' };
      if (!(event.key in keys)) return;
      event.preventDefault();
      const step = keys[event.key];
      const next = step === 'first' ? 0 : step === 'last' ? 2 : (VIEWS.indexOf(state.view) + step) % 3;
      set({ view: VIEWS[next] });
      document.querySelector(`#tabs [data-view="${VIEWS[next]}"]`).focus();
    });
  }
  const cardTabs = ['from', 'to', 'trip'];
  for (const tab of $('place-tabs').querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => setCardTab(tab.dataset.ctab));
    tab.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: 1, ArrowLeft: 2, Home: 'first', End: 'last' };
      if (!(event.key in keys)) return;
      event.preventDefault();
      const step = keys[event.key];
      const next = step === 'first' ? 0 : step === 'last' ? 2 : (cardTabs.indexOf(card.tab) + step) % 3;
      setCardTab(cardTabs[next]);
      $(`ctab-${cardTabs[next]}`).focus();
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
  for (const button of document.querySelectorAll('.drawers [data-drawer]')) {
    button.addEventListener('click', () => {
      setDrawer(openDrawer === button.dataset.drawer ? null : button.dataset.drawer);
      // On a phone the drawer opens in the sheet, so give it the room.
      if (openDrawer && phone() && $('side').dataset.sheet !== 'full') setSheet($('side'), 'full');
    });
  }
  $('key-fold').addEventListener('click', () => {
    const open = $('key-fold').getAttribute('aria-expanded') !== 'true';
    $('key-fold').setAttribute('aria-expanded', String(open));
    $('key').classList.toggle('is-folded', !open);
  });
  // Close ends a trip and goes back to the From card; otherwise it closes the card.
  $('place-close').addEventListener('click', () => {
    if (card.picking) cancelPicking();
    else if (tripOpen()) endTrip();
    else closePlace();
  });
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
  const about = () => {
    renderAbout($('about-body'), data.meta);
    $('about').showModal();
  };
  $('about-open').addEventListener('click', about);
  $('brand-chip').addEventListener('click', about);
  $('panel-toggle').addEventListener('click', () => {
    const collapsed = document.body.dataset.panel === 'collapsed';
    if (collapsed) delete document.body.dataset.panel;
    else document.body.dataset.panel = 'collapsed';
    $('panel-toggle').setAttribute('aria-expanded', String(collapsed));
    $('panel-toggle').setAttribute('aria-label', collapsed ? 'Hide controls' : 'Show controls');
    fitKey();
  });
  // Escape cancels picking a trip's destination first; then it closes what
  // was opened last: the area list, a drawer, the trip, then the card.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || $('about').open) return;
    if (card.picking) {
      cancelPicking();
      return;
    }
    if (closeAreaMenu()) return;
    if (openDrawer) {
      const button = document.querySelector(`.drawers [data-drawer="${openDrawer}"]`);
      setDrawer(null);
      button?.focus();
      return;
    }
    if (tripOpen()) {
      endTrip();
      return;
    }
    if (state.selected != null) closePlace();
  });
  // While picking, Enter on the map picks the hexagon under the mark in its middle.
  const canvas = map.getCanvas();
  canvas.addEventListener('focus', () => {
    if (card.picking && canvas.matches(':focus-visible')) showPickMark(true);
  });
  canvas.addEventListener('blur', () => showPickMark(false));
  canvas.addEventListener('keydown', (event) => {
    if (!card.picking || event.key !== 'Enter') return;
    event.preventDefault();
    showPickMark(true);
    const p = markPoint();
    const i = cellAtPoint(map, [p.x, p.y]);
    if (i == null) {
      say('No hexagon there. Move the map with the arrow keys.');
      return;
    }
    pickDestination(i);
  });
  // The area list closes on a click elsewhere, and moves with the arrow keys.
  document.addEventListener('pointerdown', (event) => {
    const menu = $('area-menu');
    if (!menu.hidden && !menu.contains(event.target) && event.target !== menu.trigger) closeAreaMenu(false);
  });
  $('area-menu').addEventListener('keydown', (event) => {
    const items = [...$('area-menu').querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (go == null) {
      if (event.key === 'Tab') closeAreaMenu(false);
      return;
    }
    event.preventDefault();
    items[(go + items.length) % items.length]?.focus();
  });

  // The phone's sheets.
  wireSheet($('side'), $('sheet-handle'));
  wireSheet($('place'), $('place-handle'), { sizes: ['half', 'full'] });
  $('peek').addEventListener('click', () => setSheet($('side'), 'half'));
  const media = () => {
    if (!phone()) {
      delete document.body.dataset.sheet;
      $('map-basemaps')?.classList.remove('open');
    } else {
      setSheet($('side'), $('side').dataset.sheet || 'peek');
    }
    schedule();
    window.requestAnimationFrame(sheetHeight);
  };
  if (PHONE.addEventListener) PHONE.addEventListener('change', media);
  window.addEventListener('resize', () => window.requestAnimationFrame(sheetHeight));
  // The headline moves when the column changes height, its text wraps afresh (fonts, or a stylesheet that
  // arrives after the first drawing in WebKit), or the panel's content changes: the key fits again.
  if (window.ResizeObserver) {
    const refit = new ResizeObserver(() => fitKey());
    refit.observe($('side'));
    refit.observe($('view'));
  }

  basemapButtons($('drawer-basemaps'));
  layerRows();
  renderLayers();

  onPoints(map, ({ kind, id, properties, lngLat }) => {
    // Picking One school: a school's pin picks it.
    const schoolPin = kind === 'destination' && id != null && schoolsAvailable() && data.destinations[id]?.services?.includes(state.service)
      && data.destinations[id].moe != null;
    if (schoolPin && state.schools.kind === 'one' && (schoolUi.searching || !activeChoice())) {
      tooltip.hidden = true;
      set({ schools: { ...state.schools, kind: 'one', moe: data.destinations[id].moe }, schoolSearching: false, schoolQuery: '' });
      return;
    }
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
      const named = services.map((sid) => SERVICE_SHORT[sid.trim()] || sid.trim()).join(', ');
      if (named) box.append(el('span', null, named));
      if (schoolPin) {
        const dest = data.destinations[id];
        const tag = tagOf(dest, state.service);
        if (tag) box.append(el('span', null, tag[0].toUpperCase() + tag.slice(1)));
        const chosen = activeChoice()?.kind === 'one' && schoolIndex() === id;
        if (!chosen) {
          const pick = el('button', 'text-button', 'Minutes to this school');
          pick.type = 'button';
          pick.addEventListener('click', () => {
            document.querySelector('.point-popup')?.remove();
            $('sheet-pop').hidden = true;
            set({ schools: { ...state.schools, kind: 'one', moe: dest.moe }, schoolSearching: false, schoolQuery: '', schoolFit: false });
          });
          box.append(pick);
        }
      }
    }
    tooltip.hidden = true;
    if (phone()) {
      // On a phone a stop or a place opens in the sheet rather than over the map.
      if (state.selected != null) closePlace();
      const pop = $('sheet-pop');
      const close = el('button', 'icon-button sheet-pop-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => {
        pop.hidden = true;
        window.requestAnimationFrame(sheetHeight);
      });
      pop.replaceChildren(box, close);
      pop.hidden = false;
      if ($('side').dataset.sheet === 'peek') setSheet($('side'), 'half');
      $('side').scrollTop = 0;
      return;
    }
    new window.maplibregl.Popup({ closeButton: true, offset: 10, className: 'point-popup' })
      .setLngLat(lngLat)
      .setDOMContent(box)
      .addTo(map);
  }, {
    hover({ kind, id, properties }, point) {
      const title = kind === 'stop' ? 'Public transport stop' : (properties.name || 'Unnamed');
      const services = String(properties.services || '').replace(/[[\]"]/g, '').split(',').filter(Boolean);
      const named = kind === 'stop' ? '' : services.map((sid) => SERVICE_SHORT[sid.trim()] || sid.trim()).join(', ');
      const picking = kind === 'destination' && id != null && schoolsAvailable() && state.schools.kind === 'one'
        && (schoolUi.searching || !activeChoice()) && data.destinations[id]?.services?.includes(state.service);
      showTooltip([el('strong', null, title), named ? el('span', null, named) : null,
        el('span', 'tooltip-hint', kind === 'stop' ? 'Click for departures' : picking ? 'Click to pick this school' : 'Click for details')], point);
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
      if (!current || phone()) return;
      showTooltip([el('strong', null, placeName(i)), ...(painted || current).tooltip(i).map((line) => el('span', null, line))], point);
    },
    leave() {
      tooltip.hidden = true;
    },
    click(i) {
      if (card.picking) {
        tooltip.hidden = true;
        pickDestination(i);
        return;
      }
      // Another hexagon opens its own card, and ends a trip that was open.
      if (card.trip) {
        card.trip = false;
        card.dest = null;
        card.tab = 'from';
      }
      select(map, state.selected, i);
      state.selected = i;
      $('sheet-pop').hidden = true;
      // The tooltip shown at the click described the map before the card.
      tooltip.hidden = true;
      showPlace(i);
      if (phone()) keepInView(i);
      schedule();
      writeHash();
    },
  });
  // A move by hand lets the panel follow the map again.
  const byHand = (event) => {
    if (event.originalEvent) userMoved = true;
  };
  map.on('movestart', byHand);
  map.on('zoomstart', byHand);
  map.on('wheel', () => { userMoved = true; });
  map.on('dragstart', () => {
    userMoved = true;
    $('map-basemaps')?.classList.remove('open');
  });
  map.on('moveend', () => {
    refreshArea();
    writeHash();
  });
}

/** On a phone the card covers the lower half of the map: move the map so the
 *  hexagon picked sits in the part left clear. */
function keepInView(i) {
  window.requestAnimationFrame(() => {
    const [lat, lng] = h3.cellToLatLng(data.h3[i]);
    const at = map.project([lng, lat]);
    const box = map.getContainer().getBoundingClientRect();
    const covered = $('place').getBoundingClientRect().top - box.top;
    const clear = covered - 90;
    if (at.y > clear || at.y < 70) map.panBy([0, at.y - Math.max(110, clear / 2)], { duration: 300 });
  });
}

/** Show the layers ticked in the Layers drawer. A tick made before the basemap
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
  $('side').inert = true;
  $('side').setAttribute('aria-hidden', 'true');
  $('brand-chip').hidden = true;
  $('start-lede').textContent = `How much people can reach without a car: everyday services and jobs for `
    + `${(index.totals.population / 1e6).toFixed(1)} million people in ${index.totals.cities} New Zealand cities and towns. `
    + 'Pick a place to open its map.';
  const everyday = (city) => (Number.isFinite(city.everyday_all_share) ? `${Math.round(city.everyday_all_share * 100)}%` : '–');
  const jobs = (city) => (Number.isFinite(city.jobs_pt_45_typical) ? count(city.jobs_pt_45_typical) : '–');
  // From 0.12.0 the jobs figure takes the walk where it is quicker, so in a
  // small town it is mostly jobs on foot; the label says so.
  const orWalk = index.cities.some((c) => c.jobs_pt_or_walk);
  const byPt = orWalk ? 'by public transport or on foot' : 'by public transport';
  const head = document.getElementById('start-jobs-head');
  if (head) head.textContent = orWalk ? 'Jobs by public transport or on foot, 45 min' : 'Jobs by public transport, 45 min';

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
      stat(jobs(city), `jobs ${byPt} in 45 min, for a typical resident`),
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
      + `${jobs(city)} jobs ${byPt} in 45 minutes`);
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

/** Resolves once team.css applies (or after a few seconds, to be safe). */
function stylesheetReady() {
  const link = document.getElementById('team-css');
  const applied = () => window.getComputedStyle($('side')).position === 'absolute';
  if (!link || applied()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearInterval(poll);
      resolve();
    };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    const poll = window.setInterval(() => { if (applied()) done(); }, 50);
    window.setTimeout(done, 5000);
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
  // The page reads the address once. A link pasted over it that differs only
  // after the # loads nothing, so read it afresh. The page's own updates use
  // replaceState, which fires no hashchange, and the skip link's #panel is not
  // a view, so neither reloads.
  window.addEventListener('hashchange', () => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (['s', 'x', 'v', 'm', 'o', 'sch'].some((k) => params.has(k))) window.location.reload();
  });
  // WebKit can run this before the stylesheet applies; the map waits for it.
  await stylesheetReady();
  const basemaps = el('div', 'segmented basemaps');
  basemaps.id = 'map-basemaps';
  basemaps.setAttribute('role', 'group');
  basemaps.setAttribute('aria-label', 'Basemap');
  basemapButtons(basemaps);
  map = createMap('map', { topRight: elementControl(basemaps) });
  // Exposed for browser tests and scripted tours.
  // For checks from the console and tests: the area the panel is for.
  window.team = {
    map,
    state,
    area: () => { const w = areaNow(); return w && { level: w.area.level, name: w.area.name, chain: w.chain.map((a) => a.name) }; },
    // A phone's sheet, for tests: peek, half or full.
    sheet: (size) => setSheet($('side'), size),
    drawer: (name) => setDrawer(name),
  };
  if (MATE) window.team.mate = () => ({ ...mateState, loaded: Boolean(mate), painted: painted && painted !== current ? (painted.kind || 'catchment') : 'team' });
  // For tests: where a trip stands.
  if (TRIPS) {
    window.team.trip = () => {
      const entry = tripOpen() ? trips.cache.get(`${state.selected}>${card.dest}`) : null;
      const swap = entry ? entry.swaps.get(tripWindowNow()) : undefined;
      return {
        picking: card.picking,
        open: tripOpen(),
        tab: card.tab,
        o: state.selected == null ? null : data.h3[state.selected],
        d: card.dest == null ? null : data.h3[card.dest],
        window: tripWindowNow(),
        ready: Boolean(entry && entry.times !== undefined && swap !== undefined && entry.routes !== undefined),
        short: entry ? entry.short : null,
        drawn: trips.drawn ? JSON.parse(trips.drawn)[2] : null,
      };
    };
  }
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
  // The place picker shows this place until the list of places arrives.
  const here = el('option', null, place.name);
  here.value = CITY;
  $('city').replaceChildren(here);
  if (!SERVICE_ORDER.includes(state.service)) state.service = SERVICE_ORDER[0];
  // A link with a hexagon picked opens with its card, as a click would.
  const linked = linkedCell;
  if (state.when && !(data.meta.windows || {})[state.when]) state.when = null;
  // A link can carry values this city does not have; fall back rather than fail.
  if (!(data.everywhere || data).weights[state.group]) state.group = 'everyone';
  prepareScope();
  if (linked && cellOf.has(linked)) state.selected = cellOf.get(linked);
  // A link to a trip opens on its Trip tab.
  if (TRIPS && state.selected != null && linkedDest && cellOf.has(linkedDest) && cellOf.get(linkedDest) !== state.selected) {
    card.trip = true;
    card.dest = cellOf.get(linkedDest);
    card.tab = 'trip';
    requestTrips();
  }
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
    if (state.selected != null) select(map, null, state.selected);
    trips.drawn = '';
    if (TRIPS) drawTrip();
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
  // Phones open on the map, with the sheet at its lowest.
  if (phone()) setSheet($('side'), 'peek');
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
    // A link to a trip shows both ends.
    if (tripOpen()) fitTrip();
    else if (state.selected != null) {
      // A link to a hexagon written by hand, with no map position in it,
      // opens on that hexagon, clear of the card on a phone.
      const [lat, lng] = h3.cellToLatLng(data.h3[state.selected]);
      map.jumpTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13) });
      if (phone()) keepInView(state.selected);
    } else if (state.schools.kind === 'one') {
      // A link to one school opens on it once its times are in.
      schoolUi.fit = true;
    }
  }
  $('loading').hidden = true;
  // Network lines only show when a layer is switched on, so they load after the first view.
  fetch(`${DATA_BASE}cities.json`, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((index) => { if (index) wireCityPicker(index, CITY); })
    .catch(() => { /* one city on its own still works */ });
}

init();
