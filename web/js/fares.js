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
    out.push([base, PAYMENT_LABELS[base] || base.replace(/_/g, ' ')]);
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
  const scale = prices[payment] || prices.hop || prices[Object.keys(prices)[0]];
  const capped = Math.max(1, Math.min(Math.round(zones), zoneCap(meta)));
  const value = scale ? scale[String(capped)] : undefined;
  return typeof value === 'number' ? value : NaN;
}

/** Whether this traveller pays nothing at this time of day.
 *  SuperGold travels free after 9am on a weekday, so the same person pays an
 *  adult fare on the school run and nothing an hour later. */
export function freeTravel(meta, profile, hour, weekday = true) {
  if (profile === 'child_0_4') return true;
  if (profile !== 'supergold') return false;
  if (!weekday) return true;
  const from = ((meta.free || {}).supergold || {}).free_from || '09:00';
  return Number.isFinite(hour) && hour >= Number(String(from).split(':')[0]);
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
export function fareSteps(meta, { profile = 'adult', payment = 'hop', returnTrip = true, hour } = {}) {
  const trips = returnTrip ? 2 : 1;
  const column = paymentKey(meta, payment, hour);
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

/** The departure hour of the window a service is routed in. */
export function serviceHour(meta, service) {
  const window = (meta.services[service] || {}).window;
  const spec = (meta.windows || {})[window];
  if (!spec) return null;
  return Number(String(spec.start).split(':')[0]);
}

/** One line saying what the budget buys, in plain words.
 *  `hour` is when the trip is timetabled, which decides SuperGold. */
export function budgetSentence(meta, state, hour) {
  const zones = affordableZones(meta, { ...state, hour });
  if (zones == null) {
    const cap = zoneCap(meta);
    return cap <= 1
      ? 'No limit on the fare. One fare covers any journey here.'
      : `No limit on the fare. The marks show what 1 to ${cap} zones cost.`;
  }
  const trip = state.returnTrip ? 'return' : 'one way';
  if (freeTravel(meta, state.profile, hour, true)) {
    const clock = `${String(hour).padStart(2, '0')}:00`;
    return `Free at ${clock}, so the whole network is within reach.`;
  }
  if (zones === 0) {
    const cheapest = fare(meta, 1, state.profile, paymentKey(meta, state.payment, hour)) * (state.returnTrip ? 2 : 1);
    return `Not enough to board: the cheapest ${trip} trip is ${money(cheapest)}. Walking and cycling only.`;
  }
  const column = paymentKey(meta, state.payment, hour);
  const paid = fare(meta, zones, state.profile, column) * (state.returnTrip ? 2 : 1);
  const next = zones < zoneCap(meta) ? fare(meta, zones + 1, state.profile, column) * (state.returnTrip ? 2 : 1) : null;
  const more = next ? ` ${money(next)} would buy ${zones + 1}.` : ' That covers the whole network.';
  return `Buys ${zones} ${zones === 1 ? 'zone' : 'zones'} ${trip}, at ${money(paid)}.${more}`;
}

/** How the traveller reads in the collapsed summary line. */
const PAYMENT_SHORT = { hop: 'HOP', snapper: 'Snapper', card: 'Motu Move', cash: 'cash' };

export function travellerSummary(meta, state, hour) {
  const profile = (meta.profiles || []).find((p) => p.key === state.profile);
  const label = profile ? profile.label : 'Adult';
  const clock = Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}:00` : 'weekday';
  const pay = state.payment === 'cash' ? 'cash' : (PAYMENT_SHORT[state.payment] || 'card');
  return `${label} · ${pay} · ${state.returnTrip ? 'return' : 'one way'} · ${clock}`;
}

/** The cheapest way to reach the nearest one inside the time standard.
 *
 *  Returns a class per cell: 0 when walking or cycling already does it, 1 to 4
 *  for the number of zones that must be paid for, 5 when nothing reaches it
 *  inside the standard, and -1 where there is no route at all.
 *
 *  Walking and cycling are free, so they are checked first. Otherwise the
 *  answer is the smallest zone count whose journey is inside the standard,
 *  which is what the priced layers already hold.
 */
export function cheapestFareClasses(data, service, standard) {
  const cap = zoneCap(data.meta.fares);
  const free = data.meta.standard_modes.filter((m) => m !== 'pt');
  const priced = data.cost[service] || {};
  const out = new Int8Array(data.n).fill(-1);
  for (let i = 0; i < data.n; i += 1) {
    let cls = -1;
    for (const mode of free) {
      const t = data.t[service]?.[mode]?.[i];
      if (Number.isFinite(t)) {
        cls = t <= standard ? 0 : 5;
        break;
      }
    }
    if (cls !== 0) {
      for (let z = 1; z <= Math.min(cap, 4); z += 1) {
        const t = priced[`z${z}`]?.[i];
        if (Number.isFinite(t)) {
          if (t <= standard) { cls = z; break; }
          cls = 5;
        }
      }
    }
    out[i] = cls;
  }
  return out;
}

/** What each fare class costs this traveller, for the legend. */
export function fareClassCosts(meta, state) {
  const trips = state.returnTrip ? 2 : 1;
  const column = paymentKey(meta, state.payment, state.hour);
  return [0, 1, 2, 3, 4].map((z) => (z === 0 ? 0 : fare(meta, z, state.profile, column) * trips));
}
