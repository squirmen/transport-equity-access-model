// Schools: which ones are counted, and the times that follow from that.
//
// TEAM's published school times count every school that teaches the years of
// a service ("All"). For school services the build also sends, for each way
// of travelling, every school each hexagon reaches within the routing limit
// (data/<place>/schools/<service>_<mode>.json). From those lists this file
// rebuilds the minutes, the nearest school, the choice counts and the
// straight-line distance for a set of schools: State, In zone or One school,
// for girls, boys, or both. The rest of the app goes on reading data.t,
// data.nearestMode, data.choice and data.km, so the map, the headlines, the
// areas, the equity figures and the card all follow the choice.
//
// Nothing here touches the page, so every rule can be tested in Node.

export const SCHOOL_SERVICES = ['primary_school', 'intermediate_school', 'secondary_school'];
export const KINDS = ['all', 'state', 'zone', 'one'];
export const STUDENTS = ['both', 'girls', 'boys'];
// The ways of travelling the card and the map can show. pt_slow is in the
// export as well, but nothing here shows public transport at the slower pace.
export const REACH_MODES = ['walk', 'bike_low_stress', 'pt', 'bike', 'car'];
// The minutes counted, as for every other service (routing.py SERVICE_COUNT_MINUTES).
export const COUNT_LIMITS = [10, 15, 20, 30];

export const DEFAULT_CHOICE = Object.freeze({ kind: 'all', moe: null, students: 'both', zoneOnly: true });

export const isSchoolService = (service) => SCHOOL_SERVICES.includes(service);

// ---------------------------------------------------------------- links

/** The choice in a link: sch=state, sch=zone or sch=one:<Ministry number>;
 *  stu=girls or stu=boys; sz=0 when One school counts everyone rather than
 *  only its zone. A link with none of these means All, as every link made
 *  before them does. */
export function readChoice(sch, stu, sz) {
  const out = { ...DEFAULT_CHOICE };
  if (sch === 'state' || sch === 'zone') out.kind = sch;
  const one = /^one:(\d{1,7})$/.exec(sch || '');
  if (one) {
    out.kind = 'one';
    out.moe = Number(one[1]);
  }
  if (stu === 'girls' || stu === 'boys') out.students = stu;
  if (sz === '0') out.zoneOnly = false;
  return out;
}

/** The link parameters for a choice, leaving out anything at its default. */
export function choiceParams(choice) {
  const out = [];
  if (!choice || choice.kind === 'all') return out;
  if (choice.kind === 'one') {
    if (choice.moe == null) return out;
    out.push(['sch', `one:${choice.moe}`]);
    if (choice.zoneOnly === false) out.push(['sz', '0']);
    return out;
  }
  out.push(['sch', choice.kind]);
  if (choice.students !== 'both') out.push(['stu', choice.students]);
  return out;
}

/** A key that changes whenever the figures would. */
export function choiceKey(service, choice) {
  if (!choice || choice.kind === 'all') return null;
  if (choice.kind === 'one') return `${service}|one:${choice.moe}`;
  return `${service}|${choice.kind}|${choice.students}`;
}

// ---------------------------------------------------------------- what a school is

const OTHER_MEDIUM = { other: 'Māori- or Pacific-medium', maori: 'Māori-medium', pacific: 'Pacific-medium' };
const KIND_WORD = { state: 'state', integrated: 'state-integrated', private: 'private', charter: 'charter' };

export const serves = (dest, service) => Boolean(dest && Array.isArray(dest.services) && dest.services.includes(service));

/** Whether this build says what kind of school each one is. Builds before
 *  0.12 do not, and then only All can be shown. */
export function hasAttributes(destinations, service) {
  return (destinations || []).some((d) => serves(d, service) && typeof d.kind === 'string');
}

/** Taught in English, as the Ministry's Language_of_Instruction has it:
 *  schools where every student is taught in te reo Māori or a Pacific
 *  language are not; schools with a bilingual unit are. A school with no
 *  record counts as English-medium. */
export const englishMedium = (dest) => !(dest && dest.medium && dest.medium !== 'english');

/** A state school taught in English: what State and In zone count. */
export const isState = (dest) => Boolean(dest && dest.kind === 'state' && englishMedium(dest));

/** Co-ed, girls or boys, for the years of this service. King's College, for
 *  one, is a boys' school at Year 9 even though it takes girls later on. */
export function sexOf(dest, service) {
  const value = dest && dest.sex && typeof dest.sex === 'object' ? dest.sex[service] : null;
  return value === 'girls' || value === 'boys' ? value : 'co-ed';
}

/** Whether a girl (or a boy) can go to this school for this service. */
export function admits(dest, service, students) {
  const sex = sexOf(dest, service);
  if (students === 'girls') return sex !== 'boys';
  if (students === 'boys') return sex !== 'girls';
  return true;
}

/** The group a school falls in for the counting line. Kind comes first: a
 *  state-integrated kura counts as state-integrated. */
export function groupOf(dest) {
  if (!dest || !dest.kind) return 'unknown';
  if (dest.kind !== 'state') return dest.kind;
  return englishMedium(dest) ? 'state' : 'other_medium';
}

/** How a school differs from a state, English-medium, co-ed school, for a tag
 *  after its name: "state, Māori-medium", "state-integrated, girls' school".
 *  Empty for a school that does not differ. */
export function tagOf(dest, service) {
  if (!dest || !dest.kind) return '';
  const bits = [];
  const sex = sexOf(dest, service);
  const other = !englishMedium(dest);
  if (dest.kind !== 'state' || other || sex !== 'co-ed') bits.push(KIND_WORD[dest.kind] || dest.kind);
  if (other) bits.push(OTHER_MEDIUM[dest.medium] || OTHER_MEDIUM.other);
  if (sex !== 'co-ed') bits.push(`${sex}' school`);
  return bits.join(', ');
}

/** Whether a school is counted under a choice, setting zones aside. In zone
 *  starts from the same schools as State; which of them count then depends
 *  on the hexagon. */
export function counts(dest, service, choice, students = choice.students) {
  if (!serves(dest, service)) return false;
  if (choice.kind === 'all') return true;
  if (choice.kind === 'one') return choice.moe != null && Number(dest.moe) === Number(choice.moe);
  return isState(dest) && admits(dest, service, students);
}

// ---------------------------------------------------------------- reach lists

/** One reach list, as typed arrays. `o` holds where each hexagon's schools
 *  start in `d` and `m`: n + 1 offsets, or n with the end implied. */
export function decodeReach(json, n) {
  if (!json || json.format !== 1 || !Array.isArray(json.o) || !Array.isArray(json.d) || !Array.isArray(json.m)) {
    throw new Error('The school times are not in a format this page reads.');
  }
  if (json.d.length !== json.m.length) throw new Error('The school times have more schools than minutes.');
  const start = new Int32Array(n + 1);
  if (json.o.length === n + 1) start.set(json.o);
  else if (json.o.length === n) {
    start.set(json.o);
    start[n] = json.d.length;
  } else {
    throw new Error(`The school times have ${json.o.length} offsets for ${n} hexagons.`);
  }
  for (let i = 0; i < n; i += 1) {
    if (!(start[i] <= start[i + 1])) throw new Error('The school times are out of order.');
  }
  if (start[0] !== 0 || start[n] !== json.d.length) throw new Error('The school times do not cover every hexagon.');
  const numeric = (values) => Float32Array.from(values, (v) => (v == null ? NaN : v));
  const out = { start, d: Int32Array.from(json.d), m: numeric(json.m), lo: null, hi: null };
  if (Array.isArray(json.lo) && json.lo.length === json.d.length) out.lo = numeric(json.lo);
  if (Array.isArray(json.hi) && json.hi.length === json.d.length) out.hi = numeric(json.hi);
  return out;
}

/** Every school hexagon i reaches by one way of travelling, nearest first:
 *  [{ d, m, lo, hi }]. Times over the routing limit are left out. */
export function reachAt(reach, i, maxMinutes = 60) {
  if (!reach) return [];
  const out = [];
  for (let k = reach.start[i]; k < reach.start[i + 1]; k += 1) {
    const m = reach.m[k];
    if (!(m <= maxMinutes)) continue;
    out.push({ d: reach.d[k], m, lo: reach.lo ? reach.lo[k] : NaN, hi: reach.hi ? reach.hi[k] : NaN });
  }
  return out.sort((a, b) => a.m - b.m || a.d - b.d);
}

/** In-zone lists for a service, from zones.json: the schools whose zone
 *  covers at least half of each hexagon, and those whose zone line crosses it. */
export function decodeZones(json, service, n) {
  if (!json || !json.format) return null;
  const list = (block) => {
    if (!block || !Array.isArray(block.o) || !Array.isArray(block.d)) return null;
    try {
      return decodeReach({ format: 1, o: block.o, d: block.d, m: block.d.map(() => 0) }, n);
    } catch {
      return null;
    }
  };
  const inZone = list((json.in || json.cells || {})[service]);
  if (!inZone) return null;
  return {
    in: inZone,
    cut: list((json.cut || {})[service]),
    schools: json.schools || {},
    date: json.date || json.source?.date || json.source?.file_date || null,
  };
}

const has = (list, i, d) => {
  if (!list) return false;
  for (let k = list.start[i]; k < list.start[i + 1]; k += 1) if (list.d[k] === d) return true;
  return false;
};

/** Whether hexagon i is in school d's zone, and whether its zone line crosses it. */
export const inZone = (zones, i, d) => has(zones && zones.in, i, d);
export const zoneCrosses = (zones, i, d) => has(zones && zones.cut, i, d);

/** The hexagons in school d's zone, as a mask, and those its line crosses. */
export function zoneCells(zones, d, n) {
  const mask = new Uint8Array(n);
  const cut = new Uint8Array(n);
  if (!zones) return { mask, cut, any: false };
  let any = false;
  for (let i = 0; i < n; i += 1) {
    if (has(zones.in, i, d)) {
      mask[i] = 1;
      any = true;
    }
    if (has(zones.cut, i, d)) cut[i] = 1;
  }
  return { mask, cut, any };
}

// ---------------------------------------------------------------- distances

const RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Straight-line km between two points given as [lat, lng] and {lat, lon}. */
export function kmBetween(centre, dest) {
  const [lat, lng] = centre;
  const dLat = (dest.lat - lat) * RAD;
  const dLng = (dest.lon - lng) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * RAD) * Math.cos(dest.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Tied schools in a steady order: nearest in a straight line, then the
 *  lower Ministry number, then the lower index. The same every time, however
 *  the routing returned them. */
export function orderTies(ids, destinations, centre) {
  if (ids.length < 2) return ids;
  const key = (d) => {
    const dest = destinations[d] || {};
    const km = centre && Number.isFinite(dest.lat) ? kmBetween(centre, dest) : Infinity;
    return [km, Number.isFinite(Number(dest.moe)) ? Number(dest.moe) : Infinity, d];
  };
  const keyed = ids.map((d) => [key(d), d]);
  keyed.sort((a, b) => {
    // Distances within a metre are the same place; the number decides.
    if (Math.abs(a[0][0] - b[0][0]) > 0.001) return a[0][0] - b[0][0];
    return a[0][1] - b[0][1] || a[0][2] - b[0][2];
  });
  return keyed.map(([, d]) => d);
}

// ---------------------------------------------------------------- the engine

/** Times, nearest schools and counts for one set of schools.
 *
 *  `ok(i, d)` says whether school d counts for someone living in hexagon i.
 *  For each way of travelling: `t` the minutes to the nearest, `near` its
 *  index (-1 for none within the limit), `ties` the others reached in the
 *  same minute ({i: [d, ...]}). `choice` counts the schools within 10, 15,
 *  20 and 30 minutes by whichever counting way reaches most, as the build
 *  does for every service. `km` is the straight line to the nearest counted
 *  school. */
function solve({ reach, n, destinations, ok, eligible, centres, standardModes, maxMinutes, limits }) {
  const t = {};
  const near = {};
  const ties = {};
  for (const [mode, list] of Object.entries(reach)) {
    const time = new Float32Array(n).fill(NaN);
    const first = new Int32Array(n).fill(-1);
    const tied = {};
    for (let i = 0; i < n; i += 1) {
      let best = Infinity;
      let at = -1;
      let extra = null;
      for (let k = list.start[i]; k < list.start[i + 1]; k += 1) {
        const m = list.m[k];
        if (!(m <= maxMinutes) || m > best) continue;
        const d = list.d[k];
        if (!ok(i, d)) continue;
        if (m < best) {
          best = m;
          at = d;
          extra = null;
        } else if (d !== at && !(extra && extra.includes(d))) {
          (extra || (extra = [])).push(d);
        }
      }
      if (at < 0) continue;
      time[i] = best;
      if (extra) {
        const ordered = orderTies([at, ...extra], destinations, centres ? centres[i] : null);
        first[i] = ordered[0];
        tied[i] = ordered.slice(1);
      } else {
        first[i] = at;
      }
    }
    t[mode] = time;
    near[mode] = first;
    ties[mode] = tied;
  }

  // How many within each step, by the counting way that reaches most.
  const choice = {};
  const counting = standardModes.filter((m) => reach[m]);
  for (const limit of limits) {
    const most = new Float32Array(n);
    for (const mode of counting) {
      const list = reach[mode];
      for (let i = 0; i < n; i += 1) {
        let c = 0;
        for (let k = list.start[i]; k < list.start[i + 1]; k += 1) {
          if (list.m[k] <= limit && list.m[k] <= maxMinutes && ok(i, list.d[k])) c += 1;
        }
        if (c > most[i]) most[i] = c;
      }
    }
    choice[String(limit)] = most;
  }

  // The straight line to the nearest school that counts here.
  const km = new Float32Array(n).fill(NaN);
  if (centres) {
    const everywhere = [];
    const somewhere = [];
    for (let d = 0; d < destinations.length; d += 1) {
      if (eligible[d] === 1) everywhere.push(d);
      else if (eligible[d] === 2) somewhere.push(d);
    }
    for (let i = 0; i < n; i += 1) {
      const centre = centres[i];
      if (!centre) continue;
      let best = Infinity;
      for (const d of everywhere) {
        const dist = kmBetween(centre, destinations[d]);
        if (dist < best) best = dist;
      }
      for (const d of somewhere) {
        if (!ok(i, d)) continue;
        const dist = kmBetween(centre, destinations[d]);
        if (dist < best) best = dist;
      }
      if (Number.isFinite(best)) km[i] = best;
    }
  }
  return { t, near, ties, choice, km };
}

const fastestOf = (t, modes, i) => {
  let best = NaN;
  for (const m of modes) {
    const v = t[m] ? t[m][i] : NaN;
    if (Number.isFinite(v) && !(v >= best)) best = v;
  }
  return best;
};

/** Girls and boys together: a hexagon counts only when both a girl and a boy
 *  living there have a school they can go to within the time, so each time is
 *  the slower of the two. Best without a car is the slower of each one's
 *  fastest way, since a girl and a boy may each travel differently. Counts
 *  are the smaller of the two, and the straight line the longer. */
function combine(girls, boys, { n, standardModes, centres, destinations }) {
  const t = {};
  const near = {};
  const ties = {};
  for (const mode of Object.keys(girls.t)) {
    const g = girls.t[mode];
    const b = boys.t[mode];
    const time = new Float32Array(n).fill(NaN);
    const first = new Int32Array(n).fill(-1);
    const tied = {};
    for (let i = 0; i < n; i += 1) {
      if (!Number.isFinite(g[i]) || !Number.isFinite(b[i])) continue;
      time[i] = Math.max(g[i], b[i]);
      // The school that sets the time: the slower one's, or both when equal.
      const from = g[i] > b[i] ? [girls] : b[i] > g[i] ? [boys] : [girls, boys];
      const ids = [];
      for (const s of from) {
        const k = s.near[mode][i];
        if (k >= 0 && !ids.includes(k)) ids.push(k);
        for (const extra of s.ties[mode][i] || []) if (!ids.includes(extra)) ids.push(extra);
      }
      const ordered = orderTies(ids, destinations, centres ? centres[i] : null);
      first[i] = ordered[0] ?? -1;
      if (ordered.length > 1) tied[i] = ordered.slice(1);
    }
    t[mode] = time;
    near[mode] = first;
    ties[mode] = tied;
  }
  const best = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i += 1) {
    const g = fastestOf(girls.t, standardModes, i);
    const b = fastestOf(boys.t, standardModes, i);
    if (Number.isFinite(g) && Number.isFinite(b)) best[i] = Math.max(g, b);
  }
  const choice = {};
  for (const limit of Object.keys(girls.choice)) {
    choice[limit] = Float32Array.from(girls.choice[limit], (v, i) => Math.min(v, boys.choice[limit][i]));
  }
  const km = Float32Array.from(girls.km, (v, i) => (Number.isFinite(v) && Number.isFinite(boys.km[i]) ? Math.max(v, boys.km[i]) : NaN));
  return { t, near, ties, choice, km, best };
}

/** Everything the app swaps in for one service under a choice.
 *
 *  `reach` maps each way of travelling to its decoded reach list; `zones` is
 *  decodeZones' result (needed for In zone only); `centres[i]` is the middle
 *  of hexagon i as [lat, lng]. Returns { t, near, ties, choice, km, best,
 *  counted, bySex }: `best` only for girls and boys together, where the
 *  fastest way can differ between them; `counted` marks the schools that
 *  count anywhere (for the pins); `bySex` holds the girls' and boys' own
 *  figures for the card. */
export function chooseSchools({
  destinations, service, choice, reach, zones = null, n, centres = null,
  standardModes = ['walk', 'bike_low_stress', 'pt'], maxMinutes = 60, limits = COUNT_LIMITS,
}) {
  const base = { reach, n, destinations, centres, standardModes, maxMinutes, limits };
  const run = (students) => {
    // 1: counts everywhere; 2: counts only where its zone covers the hexagon.
    const eligible = new Uint8Array(destinations.length);
    for (let d = 0; d < destinations.length; d += 1) {
      const dest = destinations[d];
      if (!counts(dest, service, choice, students)) continue;
      eligible[d] = choice.kind === 'zone' && dest.scheme === true ? 2 : 1;
    }
    const ok = (i, d) => eligible[d] === 1 || (eligible[d] === 2 && inZone(zones, i, d));
    return { ...solve({ ...base, ok, eligible }), eligible };
  };
  const split = (choice.kind === 'state' || choice.kind === 'zone') && choice.students === 'both';
  if (!split) {
    const one = run(choice.students);
    return { ...one, best: null, counted: one.eligible, bySex: null };
  }
  const girls = run('girls');
  const boys = run('boys');
  const both = combine(girls, boys, base);
  const counted = Uint8Array.from(girls.eligible, (v, d) => Math.max(v, boys.eligible[d]));
  return { ...both, counted, bySex: { girls, boys } };
}

/** The nearest school hexagon i reaches by one way, among those `ok(d)`
 *  allows: { m, ds } with ties in the steady order, or null. For the card,
 *  which looks at one hexagon. */
export function nearestAt(reach, i, ok, { destinations, centre = null, maxMinutes = 60 } = {}) {
  if (!reach) return null;
  let best = Infinity;
  let ds = [];
  for (let k = reach.start[i]; k < reach.start[i + 1]; k += 1) {
    const m = reach.m[k];
    if (!(m <= maxMinutes) || m > best || !ok(reach.d[k])) continue;
    if (m < best) {
      best = m;
      ds = [reach.d[k]];
    } else if (!ds.includes(reach.d[k])) {
      ds.push(reach.d[k]);
    }
  }
  if (!ds.length) return null;
  return { m: best, ds: destinations ? orderTies(ds, destinations, centre) : ds };
}

/** Minutes from hexagon i to school d by one way, with the 10th and 90th
 *  percentiles where the build sends them. NaN when it is not reached. */
export function minutesTo(reach, i, d, maxMinutes = 60) {
  const out = { m: NaN, lo: NaN, hi: NaN };
  if (!reach) return out;
  for (let k = reach.start[i]; k < reach.start[i + 1]; k += 1) {
    if (reach.d[k] !== d || !(reach.m[k] <= maxMinutes)) continue;
    if (!(reach.m[k] >= out.m)) {
      out.m = reach.m[k];
      out.lo = reach.lo ? reach.lo[k] : NaN;
      out.hi = reach.hi ? reach.hi[k] : NaN;
    }
  }
  return out;
}

// ---------------------------------------------------------------- swapping it in

/** The walking time at the slower pace, for places built with one. */
export function slowFactor(meta) {
  const chains = meta && meta.chains;
  return chains && chains.slower_pace_kmh ? (chains.usual_pace_kmh || 4.8) / chains.slower_pace_kmh : null;
}

/** Put a choice's figures in place of a service's own, keeping the originals
 *  to put back. Fares are left out: the priced layers count every school, so
 *  under a choice no fare budget or fare view is offered. */
export function applyToData(data, service, result) {
  data.schoolsAll = data.schoolsAll || {};
  if (!data.schoolsAll[service]) {
    data.schoolsAll[service] = {
      t: data.t[service],
      usualPt: data.usual?.t?.[service],
      nearestMode: data.nearestMode?.[service],
      ties: data.ties?.[service],
      nearest: data.nearest?.[service],
      choice: data.choice?.[service],
      km: data.km?.[service],
      cost: data.cost?.[service],
      usualCost: data.usual?.cost?.[service],
      best: data.best?.[service],
    };
  }
  const kept = data.schoolsAll[service];
  const t = { ...result.t };
  const factor = slowFactor(data.meta);
  if (kept.t && kept.t.walk_slow && factor && t.walk) t.walk_slow = Float32Array.from(t.walk, (v) => v * factor);
  data.t[service] = t;
  if (data.usual && data.usual.t) data.usual.t[service] = t.pt;
  data.nearestMode = { ...(data.nearestMode || {}), [service]: result.near };
  data.ties = { ...(data.ties || {}), [service]: result.ties };
  if (data.nearest) data.nearest = { ...data.nearest, [service]: null };
  // Counts and distances come with the rest of the data; until then there
  // are none to replace.
  if (data.choice && kept.choice) data.choice[service] = result.choice;
  if (data.km) data.km[service] = result.km;
  if (data.cost) delete data.cost[service];
  if (data.usual && data.usual.cost) delete data.usual.cost[service];
  data.best = { ...(data.best || {}) };
  if (result.best) data.best[service] = result.best;
  else delete data.best[service];
}

/** Put every service's own figures back. */
export function restoreData(data) {
  for (const [service, kept] of Object.entries(data.schoolsAll || {})) {
    data.t[service] = kept.t;
    if (data.usual && data.usual.t) data.usual.t[service] = kept.usualPt;
    if (data.nearestMode) data.nearestMode = { ...data.nearestMode, [service]: kept.nearestMode };
    if (data.ties) data.ties = { ...data.ties, [service]: kept.ties };
    if (data.nearest) data.nearest = { ...data.nearest, [service]: kept.nearest };
    if (data.choice && kept.choice) data.choice[service] = kept.choice;
    if (data.km && kept.km) data.km[service] = kept.km;
    if (data.cost && kept.cost) data.cost[service] = kept.cost;
    if (data.usual && data.usual.cost && kept.usualCost) data.usual.cost[service] = kept.usualCost;
    if (data.best) {
      data.best = { ...data.best };
      if (kept.best) data.best[service] = kept.best;
      else delete data.best[service];
    }
  }
  data.schoolsAll = {};
}

// ---------------------------------------------------------------- words

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-01" as "1 Oct 2026". Anything else as it came. */
export function day(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return value ? String(value) : '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const thousands = (n) => Number(n).toLocaleString('en-NZ');

/** "A", "A or B", "A, B or C". */
export function orList(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const andList = (items) => (items.length <= 1 ? items[0] || '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const stripArticle = (noun) => String(noun).replace(/^(a|an) /, '');
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** The school chosen under One school, by its Ministry number. */
export function schoolByMoe(destinations, service, moe) {
  if (moe == null) return -1;
  return (destinations || []).findIndex((d) => serves(d, service) && Number(d.moe) === Number(moe));
}

/** What to call what is being reached, for headlines, the key and the card.
 *  `base` is the service's own words: { short, noun, plural }. */
export function choiceWords(base, choice, school = null) {
  if (!choice || choice.kind === 'all') return { ...base, nearest: `the nearest ${stripArticle(base.noun)}` };
  if (choice.kind === 'one') {
    const name = school && school.name ? school.name : 'the school picked';
    return { short: name, noun: name, plural: name, nearest: name, one: true };
  }
  const plain = stripArticle(base.noun);
  const adjective = choice.kind === 'zone' ? 'in-zone state' : 'state';
  const who = choice.students === 'girls' ? ' that takes girls' : choice.students === 'boys' ? ' that takes boys' : '';
  const thing = `${adjective} ${plain}`;
  return {
    short: capital(thing) + (choice.students === 'girls' ? ', girls' : choice.students === 'boys' ? ', boys' : ''),
    noun: `${article(adjective)} ${thing}${who}`,
    plural: `${adjective} ${base.plural}`,
    nearest: `the nearest ${thing}${who}`,
  };
}

/** How many schools of each group teach a service: { all, state, other_medium,
 *  integrated, private, charter, unknown }. */
export function groupCounts(destinations, service, students = 'both') {
  const out = { all: 0, state: 0, other_medium: 0, integrated: 0, private: 0, charter: 0, unknown: 0 };
  for (const dest of destinations || []) {
    if (!serves(dest, service)) continue;
    out.all += 1;
    const group = groupOf(dest);
    if (group === 'state' && students !== 'both' && !admits(dest, service, students)) continue;
    out[group] = (out[group] || 0) + 1;
  }
  return out;
}

const LEFT_OUT = [
  ['integrated', 'state-integrated'],
  ['private', 'private'],
  ['charter', 'charter'],
  ['other_medium', 'Māori- or Pacific-medium'],
  ['unknown', 'with no record of their kind'],
];

/** The line under every headline that says which schools are counted, with
 *  the counts taken from the build's own list. `plural` is the service's
 *  plural ("secondary schools"); `zones` is decodeZones' result. */
export function countingLine(destinations, service, choice, { plural = 'schools', zones = null, meta = {} } = {}) {
  const c = groupCounts(destinations, service);
  const listed = meta.directory ? ` School list as at ${day(meta.directory)}.` : '';
  if (!choice || choice.kind === 'all') {
    const parts = [
      c.state ? `${c.state} state` : null,
      c.other_medium ? `${c.other_medium} state Māori- or Pacific-medium` : null,
      c.integrated ? `${c.integrated} state-integrated` : null,
      c.private ? `${c.private} private` : null,
      c.charter ? `${c.charter} charter` : null,
      c.unknown ? `${c.unknown} with no record of their kind` : null,
    ].filter(Boolean);
    const kinds = parts.length > 1 && c.all > c.unknown ? `: ${andList(parts)}` : '';
    return `Counting all ${thousands(c.all)} ${plural}${kinds}. Single-sex schools count for everyone.${listed}`;
  }
  if (choice.kind === 'one') {
    const d = schoolByMoe(destinations, service, choice.moe);
    const name = d >= 0 ? destinations[d].name : 'the school picked';
    const z = d >= 0 && zones ? zones.schools?.[d] || zones.schools?.[String(d)] : null;
    const zoneText = !z
      ? ''
      : choice.zoneOnly !== false
        ? ` Only people living in its zone${z.from ? ` (in force from ${day(z.from)})` : ''} are counted.`
        : ' Everyone is counted, not only its zone.';
    return `Counting ${name} only.${zoneText}${listed}`;
  }
  const sexed = choice.students !== 'both' ? groupCounts(destinations, service, choice.students) : c;
  const notCounted = LEFT_OUT.filter(([key]) => c[key]).map(([key, word]) => `${thousands(c[key])} ${word}`);
  const left = notCounted.length ? ` Not counted: ${andList(notCounted)}.` : '';
  let who = '';
  if (choice.students === 'girls') who = ` Counting co-ed and girls' schools: ${thousands(sexed.state)} of the ${thousands(c.state)}.`;
  else if (choice.students === 'boys') who = ` Counting co-ed and boys' schools: ${thousands(sexed.state)} of the ${thousands(c.state)}.`;
  else who = ' Girls and boys: both must be able to reach one they can go to, and the time is the slower of the two.';
  if (choice.kind === 'state') {
    return `Counting ${thousands(c.state)} state ${plural} taught in English.${left}${who}${listed}`;
  }
  // In zone: the same schools, each counted only inside its own zone.
  let zoned = 0;
  let open = 0;
  let missing = 0;
  (destinations || []).forEach((dest, d) => {
    if (!serves(dest, service) || !isState(dest)) return;
    if (dest.scheme === true) {
      zoned += 1;
      if (zones && !(zones.schools?.[d] || zones.schools?.[String(d)])) missing += 1;
    } else {
      open += 1;
    }
  });
  const gap = missing ? ` ${thousands(missing)} have an enrolment scheme but no zone in the file, so they are not counted.` : '';
  const date = zones && zones.date ? ` Zones as at ${day(zones.date)}.` : '';
  return `Counting state ${plural} taught in English whose zone covers at least half of the hexagon (${thousands(zoned)} of the `
    + `${thousands(c.state)} have a zone), and the ${thousands(open)} with no enrolment scheme.${gap}${left}${who}${date}${listed}`;
}

/** Facts about one school for the panel: kind, sex, years, roll, zone, where
 *  its times go to, and its Ministry number. */
export function schoolFacts(dest, service, { zone = null } = {}) {
  if (!dest) return [];
  const kind = KIND_WORD[dest.kind] || dest.kind || 'kind not recorded';
  const sex = sexOf(dest, service);
  const bits = [capital(kind), sex === 'co-ed' ? 'co-ed' : `${sex}' school`];
  if (!englishMedium(dest)) bits.push(OTHER_MEDIUM[dest.medium] || OTHER_MEDIUM.other);
  const years = Array.isArray(dest.years) ? dest.years : String(dest.years || '').match(/\d+/g);
  if (years && years.length >= 2) bits.push(`Years ${years[0]}–${years[years.length - 1]}`);
  if (Number.isFinite(Number(dest.roll)) && dest.roll != null) bits.push(`roll ${thousands(dest.roll)}${dest.roll_date ? ` (${day(dest.roll_date)})` : ''}`);
  const more = [];
  if (dest.scheme === true) {
    more.push(zone ? `Zone in force from ${day(zone.from || dest.zone_from) || 'a date not given'}.` : 'Has an enrolment scheme; its zone is not in this build.');
  } else if (dest.scheme === false) {
    more.push('No enrolment scheme.');
  }
  const to = dest.routed_to;
  more.push(Number(to) > 0
    ? `Times go to the nearest of ${to} checked ${Number(to) === 1 ? 'entrance' : 'entrances'}.`
    : "Times go to the Ministry's map point for the school.");
  if (dest.moe != null) more.push(`Ministry number ${dest.moe}.`);
  return [bits.join(' · '), more.join(' ')];
}

/** Schools that teach a service whose name (or Ministry number) matches what
 *  was typed, best matches first. */
export function findSchools(destinations, service, query, limit = 8) {
  const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = fold(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  (destinations || []).forEach((dest, d) => {
    if (!serves(dest, service) || dest.moe == null) return;
    const name = fold(dest.name);
    const parts = name.split(/[^a-z0-9]+/);
    const number = String(dest.moe);
    let score = 0;
    for (const w of words) {
      if (number === w) score += 3;
      else if (parts.some((p) => p.startsWith(w))) score += 2;
      else if (name.includes(w)) score += 1;
      else return;
    }
    if (name.startsWith(words[0])) score += 1;
    out.push([score, dest.name || '', d]);
  });
  return out.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1])).slice(0, limit).map(([, , d]) => d);
}

// ---------------------------------------------------------------- the card

const HOW = { walk: 'on foot', walk_slow: 'on foot at the slower pace', bike_low_stress: 'by low-stress cycling', bike: 'cycling on any street', pt: 'by public transport', car: 'by car' };

/** "Mt Albert Grammar School, 15 min on foot" for one way of travelling from
 *  hexagon i, among the schools `ok` allows. With public transport, a time no
 *  quicker than walking is said as walking, which it is. */
export function nearestPhrase(reachByMode, mode, i, ok, { destinations, centre, maxMinutes = 60, label = (d) => destinations[d]?.name || 'unnamed' } = {}) {
  const opts = { destinations, centre, maxMinutes };
  const found = nearestAt(reachByMode[mode], i, ok, opts);
  if (!found) return null;
  let { m, ds } = found;
  let how = HOW[mode] || '';
  if (mode === 'pt' && reachByMode.walk) {
    const walk = nearestAt(reachByMode.walk, i, ok, opts);
    if (walk && walk.m === m) {
      ds = walk.ds;
      how = 'on foot';
    }
  }
  const names = orList(ds.map(label));
  const tie = ds.length > 2 ? 'all ' : ds.length === 2 ? 'both ' : '';
  return { m, ds, how, text: `${names}, ${tie}${Math.round(m)} min ${how}` };
}

/** What the card adds for a school service: the extra lines of its verdict.
 *
 *  `ctx` = { destinations, service, choice, reach (decoded lists by mode,
 *  any of them missing), result (chooseSchools' output, or null for All),
 *  zones, centres, maxMinutes, words }. `named` is the schools the band names
 *  for `mode` in hexagon i. Returns a list of sentences. */
export function cardLines(ctx, mode, i, named = []) {
  const { destinations, service, choice, reach = {}, result = null, zones = null, centres = null, maxMinutes = 60 } = ctx;
  const centre = centres ? centres[i] : null;
  const label = (d) => destinations[d]?.name || 'unnamed';
  const lines = [];
  const real = mode && mode !== 'best' ? (mode === 'walk_slow' ? 'walk' : mode) : null;
  // Whether school buses are in the timetable differs by place (meta.schools.school_buses).
  const buses = real === 'pt' && ctx.schoolBuses === false ? 'School buses are not in the timetable used, so a trip by school bus is not counted.' : null;
  const done = () => (buses ? [...lines, buses] : lines);

  if (!choice || choice.kind === 'all') {
    // All: when the school named is not a state, English-medium co-ed school,
    // say what it is and give the nearest state school as well.
    const odd = named.filter((d) => tagOf(destinations[d], service));
    if (real && odd.length && reach[real]) {
      const state = (students) => (d) => isState(destinations[d]) && admits(destinations[d], service, students);
      const g = nearestPhrase(reach, real, i, state('girls'), { destinations, centre, maxMinutes });
      const b = nearestPhrase(reach, real, i, state('boys'), { destinations, centre, maxMinutes });
      if (!g && !b) lines.push(`No state school within ${maxMinutes} min ${HOW[real] || ''}.`.replace(' .', '.'));
      else if (g && b && g.text === b.text) lines.push(`Nearest state school: ${g.text}.`);
      else {
        lines.push(`Nearest state school for a girl: ${g ? g.text : `none within ${maxMinutes} min`}.`);
        lines.push(`For a boy: ${b ? b.text : `none within ${maxMinutes} min`}.`);
      }
    }
    return done();
  }

  if (choice.kind === 'one') {
    const d = schoolByMoe(destinations, service, choice.moe);
    if (d < 0) return lines;
    if (real === 'pt' && reach.pt) {
      const spread = minutesTo(reach.pt, i, d, maxMinutes);
      // A walk all the way takes the same time whenever you leave: no spread to give.
      const flat = spread.lo === spread.hi && spread.hi === spread.m;
      if (Number.isFinite(spread.lo) && Number.isFinite(spread.hi) && Number.isFinite(spread.m) && !flat) {
        const when = ctx.when ? `${ctx.when}, ` : '';
        lines.push(`Usually ${Math.round(spread.lo)}–${Math.round(spread.hi)} min, depending on when you leave (${when}10th to 90th percentile).`);
      }
    }
    if (zones && (zones.schools?.[d] || zones.schools?.[String(d)])) {
      if (zoneCrosses(zones, i, d)) lines.push(`Its zone line crosses this hexagon; ${inZone(zones, i, d) ? 'at least half of it is in the zone' : 'less than half of it is in the zone'}.`);
      else lines.push(inZone(zones, i, d) ? 'This hexagon is in its zone.' : 'This hexagon is not in its zone.');
    } else if (destinations[d].scheme === false) {
      lines.push('It has no enrolment scheme.');
    }
    if (real && reach[real]) {
      const other = nearestPhrase(reach, real, i, (k) => k !== d && isState(destinations[k]), { destinations, centre, maxMinutes });
      lines.push(other ? `Nearest other state school: ${other.text}.` : `No other state school within ${maxMinutes} min ${HOW[real] || ''}.`.replace(' .', '.'));
    }
    return done();
  }

  // State and In zone: girls and boys apart when they differ.
  if (real && result && result.bySex) {
    const g = result.bySex.girls;
    const b = result.bySex.boys;
    const say = (s) => {
      const t = s.t[real] ? s.t[real][i] : NaN;
      if (!Number.isFinite(t)) return `none within ${maxMinutes} min`;
      let ds = [s.near[real][i], ...(s.ties[real][i] || [])].filter((k) => k >= 0);
      let how = HOW[real] || '';
      if (real === 'pt' && s.t.walk && s.t.walk[i] === t) {
        ds = [s.near.walk[i], ...(s.ties.walk[i] || [])].filter((k) => k >= 0);
        how = 'on foot';
      }
      return `${orList(ds.map(label))}, ${Math.round(t)} min ${how}`;
    };
    const gs = say(g);
    const bs = say(b);
    if (gs !== bs) lines.push(`For a girl: ${gs}. For a boy: ${bs}.`);
  }

  // The nearer schools this choice leaves out, so a reader can see why the
  // figure differs from All.
  if (real && reach[real]) {
    const shown = named.length && Number.isFinite(ctx.shownMinutes) ? ctx.shownMinutes : Infinity;
    const counted = (d) => {
      const dest = destinations[d];
      if (!counts(dest, service, choice)) return false;
      if (choice.kind === 'zone' && dest.scheme === true) return inZone(zones, i, d);
      return true;
    };
    const left = reachAt(reach[real], i, maxMinutes).filter((r) => r.m < shown && !counted(r.d)).slice(0, 3);
    if (left.length) {
      const why = (d) => {
        const dest = destinations[d];
        const tag = tagOf(dest, service);
        if (choice.kind === 'zone' && isState(dest)) return tag ? `${tag}, out of zone` : 'out of zone';
        return tag;
      };
      lines.push(`Not counted: ${left.map((r) => `${label(r.d)}, ${Math.round(r.m)} min${why(r.d) ? ` (${why(r.d)})` : ''}`).join('; ')}.`);
    }
  }
  return done();
}

// ---------------------------------------------------------------- the CSV

/** Every hexagon counted, with its minutes by each way of travelling to the
 *  nearest school counted (or to the one school), the school's Ministry
 *  number, and the choice and data dates in a header. */
export function schoolsCsv({ h3, pop, placeNames, t, near, ties, destinations, modes, header = [], extra = {} }) {
  const quote = (v) => (/[",\n#]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const value = (v) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '');
  const moeOf = (mode, i) => {
    const first = near[mode] ? near[mode][i] : -1;
    if (first == null || first < 0) return '';
    return [first, ...((ties[mode] || {})[i] || [])].map((d) => destinations[d]?.moe ?? '').join('|');
  };
  const extraKeys = Object.keys(extra);
  const head = ['h3', 'suburb', 'residents', ...modes.flatMap((m) => [`minutes_${m}`, `moe_${m}`]), ...extraKeys];
  const lines = header.map((line) => `# ${line}`);
  lines.push(head.join(','));
  for (let i = 0; i < h3.length; i += 1) {
    if (!(pop[i] > 0)) continue;
    const cells = [h3[i], quote(placeNames[i] || ''), value(pop[i])];
    for (const m of modes) cells.push(value(t[m] ? t[m][i] : NaN), moeOf(m, i));
    for (const key of extraKeys) {
      const v = extra[key][i];
      cells.push(typeof v === 'number' ? value(v) : quote(v ?? ''));
    }
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}
