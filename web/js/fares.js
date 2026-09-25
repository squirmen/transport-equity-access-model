// What a journey costs, and what a budget buys.
//
// Auckland Transport charges by the number of fare zones a journey passes
// through, capped at four, so a dollar budget comes down to a number of zones.
// The fare table is small and the rule is simple, so the conversion happens
// here in the browser: moving the budget slider picks a different layer of
// data that is already loaded, and the map redraws without asking for
// anything.

export const ZONE_CAP = 4;

/** The fare in dollars for a journey of this many zones.
 *  A traveller with no table of their own pays the adult fare, which is how
 *  AT prices a concession that only exists on an AT HOP card. */
export function fare(meta, zones, profile = 'adult', payment = 'hop') {
  const table = meta.fares || {};
  const prices = table[profile] || table.adult;
  if (!prices) return NaN;
  const scale = prices[payment] || prices.hop;
  const capped = Math.max(1, Math.min(Math.round(zones), ZONE_CAP));
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
  if (freeTravel(meta, profile, hour, weekday)) return ZONE_CAP;
  const trips = returnTrip ? 2 : 1;
  let best = 0;
  for (let zones = 1; zones <= ZONE_CAP; zones += 1) {
    if (fare(meta, zones, profile, payment) * trips <= budget + 1e-9) best = zones;
  }
  return best;
}

/** What each zone limit costs this traveller, so a slider can be marked. */
export function fareSteps(meta, { profile = 'adult', payment = 'hop', returnTrip = true } = {}) {
  const trips = returnTrip ? 2 : 1;
  const steps = [];
  for (let zones = 1; zones <= ZONE_CAP; zones += 1) {
    const cost = fare(meta, zones, profile, payment) * trips;
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
  if (zones == null) return 'No limit on the fare. The marks show what one to four zones cost.';
  const trip = state.returnTrip ? 'return' : 'one way';
  if (freeTravel(meta, state.profile, hour, true)) {
    const clock = `${String(hour).padStart(2, '0')}:00`;
    return `Free at ${clock}, so the whole network is within reach.`;
  }
  if (zones === 0) {
    const cheapest = fare(meta, 1, state.profile, state.payment) * (state.returnTrip ? 2 : 1);
    return `Not enough to board: the cheapest ${trip} trip is ${money(cheapest)}. Walking and cycling only.`;
  }
  const paid = fare(meta, zones, state.profile, state.payment) * (state.returnTrip ? 2 : 1);
  const next = zones < ZONE_CAP ? fare(meta, zones + 1, state.profile, state.payment) * (state.returnTrip ? 2 : 1) : null;
  const more = next ? ` ${money(next)} would buy ${zones + 1}.` : ' That covers the whole network.';
  return `Buys ${zones} ${zones === 1 ? 'zone' : 'zones'} ${trip}, at ${money(paid)}.${more}`;
}

/** How the traveller reads in the collapsed summary line. */
export function travellerSummary(meta, state, hour) {
  const profile = (meta.profiles || []).find((p) => p.key === state.profile);
  const label = profile ? profile.label : 'Adult';
  const clock = Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}:00` : 'weekday';
  const pay = state.payment === 'cash' ? 'cash' : 'HOP';
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
      for (let z = 1; z <= ZONE_CAP; z += 1) {
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
  return [0, 1, 2, 3, 4].map((z) => (z === 0 ? 0 : fare(meta, z, state.profile, state.payment) * trips));
}
