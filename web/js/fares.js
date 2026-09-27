// What a journey costs, and what a budget buys.
//
// Auckland Transport charges by the number of fare zones a journey passes
// through, capped at four, so a dollar budget comes down to a number of zones.
// The fare table is small and the rule is simple, so the conversion happens
// here in the browser: moving the budget slider picks a different layer of
// data that is already loaded, and the map redraws without asking for
// anything.

/** How many zone steps this network's fares have. Auckland has four,
 *  Wellington fourteen, and a flat fare has one. */
export function zoneCap(meta) {
  if (!meta) return 1;
  if (meta.kind === 'flat') return 1;
  if (meta.zone_cap) return Number(meta.zone_cap);
  const prices = (meta.fares || {}).adult || {};
  let most = 0;
  for (const scale of Object.values(prices)) {
    for (const key of Object.keys(scale || {})) {
      const step = Number(key);
      if (Number.isFinite(step)) most = Math.max(most, step);
    }
  }
  return most || 4;
}

/** The ways this network lets you pay, named as its own fare table names them. */
export function payments(meta) {
  const prices = (meta && meta.fares && meta.fares.adult) || {};
  const keys = Object.keys(prices);
  const seen = new Set();
  const out = [];
  for (const key of keys) {
    // snapper_peak and snapper_offpeak are one choice made at two times.
    const base = key.replace(/_(peak|offpeak)$/, '');
    if (seen.has(base)) continue;
    seen.add(base);
    // A network can name its own card: "card" is a Bee Card in most regions.
    out.push([base, (meta.payment_labels || {})[base] || PAYMENT_LABELS[base] || base.replace(/_/g, ' ')]);
  }
  return out.length ? out : [['hop', 'Card']];
}

const PAYMENT_LABELS = {
  hop: 'AT HOP or contactless',
  snapper: 'Snapper or contactless',
  card: 'Motu Move or contactless',
  cash: 'Cash',
};

/** Whether this hour is charged at the off-peak rate. */
export function isOffpeak(meta, hour, weekday = true) {
  const windows = (meta && meta.offpeak_hours) || [];
  if (!windows.length) return false;
  if (!weekday) return true;
  if (!Number.isFinite(hour)) return false;
  return windows.some(([from, to]) => hour >= from && hour < to);
}

/** The column of the fare table to read, given when the journey is made. */
export function paymentKey(meta, payment, hour, weekday = true) {
  const prices = (meta && meta.fares && meta.fares.adult) || {};
  if (payment === 'cash' || prices[payment]) return payment;
  const suffix = isOffpeak(meta, hour, weekday) ? 'offpeak' : 'peak';
  const candidate = `${payment}_${suffix}`;
  return prices[candidate] ? candidate : payment;
}

export const ZONE_CAP = 4;

/** The fare in dollars for a journey of this many zones.
 *  A traveller with no table of their own pays the adult fare, which is how
 *  AT prices a concession that only exists on an AT HOP card. */
export function fare(meta, zones, profile = 'adult', payment = 'hop') {
  const table = meta.fares || {};
  const prices = table[profile] || table.adult;
  if (!prices) return NaN;
  // A concession with no price for this way of paying pays the adult price.
  const scale = prices[payment] || (table.adult || {})[payment] || prices[Object.keys(prices)[0]];
  const capped = Math.max(1, Math.min(Math.round(zones), zoneCap(meta)));
  const value = scale ? scale[String(capped)] : undefined;
  return typeof value === 'number' ? value : NaN;
}

/** The weekday hours a SuperGold card rides free, as [from, to] pairs.
 *  Networks write this as a list of hours, as a start and end with an
 *  optional evening start, or as a start alone. */
export function freeHours(rule) {
  const clock = (value) => {
    const [h, m] = String(value).split(':');
    return Number(h) + (m ? Number(m) / 60 : 0);
  };
  if (Array.isArray(rule.free_hours_weekday)) return rule.free_hours_weekday.map(([a, b]) => [Number(a), Number(b)]);
  const start = clock(rule.free_from || '09:00');
  if (rule.free_until) {
    const hours = [[start, clock(rule.free_until)]];
    if (rule.free_after) hours.push([clock(rule.free_after), 24]);
    return hours;
  }
  return [[start, 24]];
}

/** Whether this traveller pays nothing at this time of day.
 *  SuperGold travels free after 9am on a weekday, so the same person pays an
 *  adult fare on the school run and nothing an hour later. */
export function freeTravel(meta, profile, hour, weekday = true) {
  if (profile === 'child_0_4') return true;
  if (profile !== 'supergold') return false;
  if (!weekday) return true;
  return Number.isFinite(hour) && freeHours((meta.free || {}).supergold || {}).some(([from, to]) => hour >= from && hour < to);
}

/** The most zones this traveller can pay for out of `budget`.
 *  A return trip is two fares, because the transfer window joins the legs of
 *  one journey and not a trip out and back. Zero means they cannot afford to
 *  board, which leaves walking and cycling. */
export function affordableZones(meta, { budget, profile = 'adult', payment = 'hop', returnTrip = true, hour, weekday = true }) {
  if (budget == null) return null;
  const cap = zoneCap(meta);
  if (freeTravel(meta, profile, hour, weekday)) return cap;
  const column = paymentKey(meta, payment, hour, weekday);
  const trips = returnTrip ? 2 : 1;
  let best = 0;
  for (let zones = 1; zones <= cap; zones += 1) {
    if (fare(meta, zones, profile, column) * trips <= budget + 1e-9) best = zones;
  }
  return best;
}

/** What each zone limit costs this traveller, so a slider can be marked. */
export function fareSteps(meta, { profile = 'adult', payment = 'hop', returnTrip = true, hour, weekday = true } = {}) {
  const trips = returnTrip ? 2 : 1;
  const column = paymentKey(meta, payment, hour, weekday);
  const steps = [];
  for (let zones = 1; zones <= zoneCap(meta); zones += 1) {
    const cost = fare(meta, zones, profile, column) * trips;
    if (Number.isFinite(cost)) steps.push({ zones, cost });
  }
  return steps;
}

export function money(value) {
  if (!Number.isFinite(value)) return '–';
  return value % 1 === 0 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

/** One line saying what the budget buys, in plain words.
 *  `hour` and `weekday` are when the trip is timetabled, which decides
 *  SuperGold and, where a network has them, peak and off-peak fares. */
export function budgetSentence(meta, state, hour, weekday = true) {
  const zones = affordableZones(meta, { ...state, hour, weekday });
  if (zones == null) {
    const cap = zoneCap(meta);
    return cap <= 1
      ? 'No limit on the fare. One fare covers any journey here.'
      : `No limit on the fare. The marks show what 1 to ${cap} zones cost.`;
  }
  const trip = state.returnTrip ? 'return' : 'one way';
  if (freeTravel(meta, state.profile, hour, weekday)) {
    const clock = `${String(hour).padStart(2, '0')}:00`;
    return weekday
      ? `Free at ${clock}, so the whole network is within reach.`
      : 'Free at the weekend, so the whole network is within reach.';
  }
  const flat = zoneCap(meta) <= 1;
  if (zones === 0) {
    const cheapest = fare(meta, 1, state.profile, paymentKey(meta, state.payment, hour, weekday)) * (state.returnTrip ? 2 : 1);
    return flat
      ? `Not enough for the ${money(cheapest)} ${trip} fare. Walking and cycling only.`
      : `Not enough to board: the cheapest ${trip} trip is ${money(cheapest)}. Walking and cycling only.`;
  }
  const column = paymentKey(meta, state.payment, hour, weekday);
  const paid = fare(meta, zones, state.profile, column) * (state.returnTrip ? 2 : 1);
  if (paid === 0) return 'Free for this traveller at this time.';
  // One fare covers any trip, so there are no zones to talk about.
  if (flat) return `Covers the ${money(paid)} ${trip} fare.`;
  const next = zones < zoneCap(meta) ? fare(meta, zones + 1, state.profile, column) * (state.returnTrip ? 2 : 1) : null;
  const more = next ? ` ${money(next)} would buy ${zones + 1}.` : ' That covers the whole network.';
  return `Buys ${zones} ${zones === 1 ? 'zone' : 'zones'} ${trip}, at ${money(paid)}.${more}`;
}

/** How the traveller reads in the collapsed summary line. */
const PAYMENT_SHORT = { hop: 'HOP', snapper: 'Snapper', card: 'Motu Move', cash: 'cash' };

/** `when` is the hour the trip starts, or a short name for the time such as
 *  "Saturday". */
export function travellerSummary(meta, state, when) {
  const profile = (meta.profiles || []).find((p) => p.key === state.profile);
  const label = profile ? profile.label : 'Adult';
  const clock = typeof when === 'string' ? when
    : Number.isFinite(when) ? `${String(when).padStart(2, '0')}:00` : 'weekday';
  const pay = state.payment === 'cash' ? 'cash'
    : ((meta.payment_labels || {})[state.payment] || PAYMENT_SHORT[state.payment] || 'card');
  return `${label} · ${pay} · ${state.returnTrip ? 'return' : 'one way'} · ${clock}`;
}

/** The cheapest way to reach the nearest one inside the time standard, as a
 *  map class: 0 when walking or low-stress cycling already does it, 1 to 4
 *  for the number of zones that must be paid for, 5 when nothing reaches it
 *  inside the standard, and -1 where there is no route at all. A network with
 *  more than four zone steps puts four and over in class 4.
 */
export function cheapestFareClasses(data, service, standard) {
  const zones = cheapestZones(data, service, standard);
  return Int8Array.from(zones, (z) => (z === -1 ? -1 : z === -2 ? 5 : Math.min(z, 4)));
}

/** What each fare class costs this traveller, for the legend. Class 4 is the
 *  cost of four zones, which is the least a class of "four and over" costs.
 *  A traveller who rides free at this time pays nothing in every class. */
export function fareClassCosts(meta, state, hour = state.hour, weekday = true) {
  const trips = state.returnTrip ? 2 : 1;
  if (freeTravel(meta, state.profile, hour, weekday)) return [0, 0, 0, 0, 0];
  const column = paymentKey(meta, state.payment, hour, weekday);
  return [0, 1, 2, 3, 4].map((z) => (z === 0 ? 0 : fare(meta, z, state.profile, column) * trips));
}

// ------------------------------------------------------------ fares and income
//
// A fare means more where incomes are lower. The burden of a trip is its
// return fare as a share of a day's income where the traveller lives:
//
//     burden = return fare / (income / 365)
//
// with income the area's median household income divided by the square root
// of its household size, in 2026 dollars (see src/team/affordability.py). A
// burden made every day is the same share of income spent on a month of daily
// return trips, the World Bank's 60-trip affordability basket.

/** A day's income in each hexagon, with the city's median where the census
 *  has none, so every place still gets a budget. */
export function dailyIncome(data) {
  const income = data.income;
  if (!income) return null;
  const fallback = (data.meta.affordability || {}).median_income;
  return Float32Array.from(income, (v) => ((Number.isFinite(v) && v > 0 ? v : fallback) || NaN) / 365);
}

/** Fare zones each hexagon can afford when its budget for a return trip, or a
 *  single one, is `share` percent of a day's local income. */
export function incomeZones(meta, daily, share, state) {
  const cap = zoneCap(meta);
  const out = new Int8Array(daily.length);
  if (freeTravel(meta, state.profile, state.hour, state.weekday)) return out.fill(cap);
  const steps = fareSteps(meta, state);
  for (let i = 0; i < daily.length; i += 1) {
    const budget = (share / 100) * daily[i];
    let zones = 0;
    for (const step of steps) if (step.cost <= budget + 1e-9) zones = step.zones;
    out[i] = zones;
  }
  return out;
}

// A public transport trip may be a walk the whole way when the walk is short
// enough, and then nobody pays for it. Routing allows up to 15 minutes of
// walking, so a trip no faster than walking inside that limit is taken to be
// a walk.
const WALK_ONLY_MINUTES = 15.5;

function walkOnly(walk, pt) {
  return Number.isFinite(walk) && walk <= WALK_ONLY_MINUTES && Number.isFinite(pt) && pt >= walk - 0.5;
}

/** The fewest zones that reach the nearest one inside the standard: 0 when no
 *  fare is needed, -2 when the place is routed but nothing gets there in time,
 *  and -1 when there is no route at all. The true count is kept on networks
 *  with more than four zones.
 *
 *  By default walking and low-stress cycling count as free, so this is the
 *  cheapest way to get there. With `walkable` false it asks about public
 *  transport alone: the fewest zones of a trip that boards something and gets
 *  there in time, whether or not the traveller could walk instead. A "public
 *  transport" trip that is really a walk needs no fare, and is 0. */
export function cheapestZones(data, service, standard, { walkable = true } = {}) {
  const cap = zoneCap(data.meta.fares);
  const times = data.t[service] || {};
  const free = walkable ? data.meta.standard_modes.filter((m) => m !== 'pt') : [];
  const every = Object.values(times);
  const priced = data.cost[service] || {};
  const out = new Int8Array(data.n).fill(-1);
  for (let i = 0; i < data.n; i += 1) {
    if (free.some((m) => times[m]?.[i] <= standard)) {
      out[i] = 0;
      continue;
    }
    let found = -1;
    for (let z = 1; z <= cap; z += 1) {
      const t = priced[`z${z}`]?.[i];
      if (!(t <= standard)) continue;
      found = walkOnly(times.walk?.[i], t) ? 0 : z;
      break;
    }
    if (found === -1) {
      const routed = every.some((layer) => Number.isFinite(layer?.[i]))
        || Object.values(priced).some((layer) => Number.isFinite(layer?.[i]));
      found = routed ? -2 : -1;
    }
    out[i] = found;
  }
  return out;
}

/** Burden bands for the map: free, under 2.5%, 2.5 to 5%, 5 to 10%, 10% and
 *  over, and no way within the standard. */
export const BURDEN_BREAKS = [0.025, 0.05, 0.1];

export function burdenClass(value) {
  if (!Number.isFinite(value)) return -1;
  if (value <= 0) return 0;
  let k = 1;
  for (const edge of BURDEN_BREAKS) if (value >= edge) k += 1;
  return k;
}

// ------------------------------------------------------------ fare caps
//
// Several networks cap what a card pays in a day or a week, so someone who
// travels every day pays less than every fare added up. `meta.caps` holds
// them as {payments, daily, weekly}: a cap per traveller, either one figure
// or one per number of zones travelled.

/** The cap for this traveller and trip length, or Infinity if none applies.
 *  A traveller with no cap of their own pays the adult fare, and so gets the
 *  adult cap, but only where their fare is the adult fare. */
export function capValue(table, meta, profile, zones, column) {
  if (!table) return Infinity;
  let cap = table[profile];
  if (cap == null && table.adult != null) {
    const own = fare(meta, zones, profile, column);
    const adult = fare(meta, zones, 'adult', column);
    if (Number.isFinite(own) && own === adult) cap = table.adult;
  }
  if (cap == null) return Infinity;
  if (typeof cap === 'number') return cap;
  const steps = Object.keys(cap).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!steps.length) return Infinity;
  const step = steps.find((s) => s >= zones) ?? steps[steps.length - 1];
  return Number(cap[String(step)]);
}

/** What a return trip every day for a week costs this traveller, after any
 *  daily and weekly caps their way of paying qualifies for. */
export function weekCost(meta, zones, { profile = 'adult', payment = 'hop', hour, weekday = true } = {}) {
  if (!(zones > 0)) return 0;
  if (freeTravel(meta, profile, hour, weekday)) return 0;
  const column = paymentKey(meta, payment, hour, weekday);
  const single = fare(meta, zones, profile, column);
  if (!Number.isFinite(single)) return NaN;
  const caps = meta.caps || {};
  const applies = !caps.payments || caps.payments.includes(payment);
  const day = Math.min(single * 2, applies ? capValue(caps.daily, meta, profile, zones, column) : Infinity);
  return Math.min(day * 7, applies ? capValue(caps.weekly, meta, profile, zones, column) : Infinity);
}

/** Whether this network caps anything, so a week can cost less than seven days. */
export function hasCaps(meta) {
  const caps = (meta && meta.caps) || {};
  return Boolean(caps.daily || caps.weekly);
}
