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

import { count } from './format.js';

export const SCHOOL_SERVICES = ['primary_school', 'intermediate_school', 'secondary_school'];
export const KINDS = ['all', 'state', 'zone', 'one'];
export const STUDENTS = ['both', 'girls', 'boys'];
// The ways of travelling the card and the map can show. pt_slow is in the
// export as well, but nothing here shows public transport at the slower pace.
export const REACH_MODES = ['walk', 'bike_low_stress', 'pt', 'bike', 'car'];
// The minutes counted, as for every other service (routing.py SERVICE_COUNT_MINUTES).
export const COUNT_LIMITS = [10, 15, 20, 30];

// The choice a link without sch= opens on, and the only place it is set:
// 'zone' (In zone) or 'all'. Every link the page writes carries sch=, so
// changing this later does not change what a link made before then shows.
// In zone is the closest of the choices to the Ministry's test of the
// nearest state school a student can enrol at. Open decision for Tim.
export const DEFAULT_SCHOOL_CHOICE = 'zone';

/** Every school that teaches the years: the measure before the Schools row. */
export const ALL_CHOICE = Object.freeze({ kind: 'all', moe: null, students: 'both', zoneOnly: true });
/** What the page opens on. */
export const DEFAULT_CHOICE = Object.freeze({ ...ALL_CHOICE, kind: DEFAULT_SCHOOL_CHOICE });

export const isSchoolService = (service) => SCHOOL_SERVICES.includes(service);

// ---------------------------------------------------------------- formats

// The school files this page reads, by kind, and the formats it knows. A
// build that lists its formats (summary.json meta.formats) must send that
// format; a file in any other is refused, and the page shows All from
// cells.json with a warning in the console.
export const FORMATS = Object.freeze({ school_reach: [1, 2], zones: [2], zone_outlines: [1], school_stops: [1] });

/** Whether a school file can be read: a format this page knows and, where
 *  the build lists its formats, the one it lists. */
export function formatOk(meta, kind, json) {
  if (!json || typeof json !== 'object') return false;
  if (!(FORMATS[kind] || []).includes(json.format)) return false;
  const listed = meta && meta.formats && typeof meta.formats === 'object' ? meta.formats[kind] : null;
  return listed == null || listed === json.format;
}

// Modes a reach list file can be for, longest first so "bike_low_stress" is
// not read as "bike".
const FILE_MODES = ['bike_low_stress', 'pt_slow', 'walk', 'bike', 'pt', 'car'];

/** summary.json's meta.schools, as the page uses it.
 *
 *  The build writes { directory: { file, retrieved, roll_dates, ... },
 *  dates: { directory, ... }, services, choices, zones, routed_to, buses,
 *  bus_note, files: { "<service>_<mode>.json": sizes } } (docs/schools.md).
 *  This returns { directory (date), roll_date, zones, reach: { service:
 *  [modes] }, school_buses (true, false or null), bus_note, counts, dates },
 *  and
 *  takes those keys as they are when a build already sends them. {} for a
 *  build before 0.12. */
export function readSchoolsMeta(meta) {
  const s = meta && meta.schools;
  if (!s || typeof s !== 'object') return {};
  const dir = s.directory;
  const directory = typeof dir === 'string' ? dir
    : (s.dates && s.dates.directory) || (dir && dir.retrieved ? String(dir.retrieved).slice(0, 10) : null);
  let rollDate = typeof s.roll_date === 'string' ? s.roll_date : null;
  if (!rollDate && dir && dir.roll_dates && typeof dir.roll_dates === 'object') {
    // The date most schools' rolls are at; schools with none are left aside.
    const dated = Object.entries(dir.roll_dates).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k));
    dated.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    rollDate = dated.length ? dated[0][0] : null;
  }
  let reach = s.reach && typeof s.reach === 'object' ? s.reach : null;
  if (!reach && s.files && typeof s.files === 'object') {
    reach = {};
    for (const name of Object.keys(s.files)) {
      const mode = FILE_MODES.find((m) => name.endsWith(`_${m}.json`));
      if (!mode) continue;
      const service = name.slice(0, -(`_${mode}.json`).length);
      (reach[service] || (reach[service] = [])).push(mode);
    }
  }
  let buses = null;
  if (typeof s.school_buses === 'boolean') buses = s.school_buses;
  else if (s.buses === 'in_timetable') buses = true;
  else if (s.buses === 'none_found') buses = false;
  // From 0.12.0 round 2 zones is an object (the file, its date, the date
  // zones are applied on, counts); a round-1 build sends null.
  const zones = s.zones && typeof s.zones === 'object' ? s.zones : null;
  const object = (v) => (v && typeof v === 'object' ? v : null);
  return {
    directory,
    roll_date: rollDate,
    zones: s.zones || null,
    zone_source: zones && object(zones.source),
    zone_reference: zones && typeof zones.reference_date === 'string' ? zones.reference_date : null,
    zone_upcoming: zones && Array.isArray(zones.upcoming) ? zones.upcoming : [],
    zone_counts: zones && object(zones.counts),
    choices: Array.isArray(s.choices) ? s.choices : null,
    reach,
    school_buses: buses,
    bus_note: typeof s.bus_note === 'string' ? s.bus_note : null,
    counts: s.services && typeof s.services === 'object' ? s.services : null,
    dates: s.dates && typeof s.dates === 'object' ? s.dates : null,
    stops: object(s.stops),
    points: object(s.points),
    formats: object(meta.formats),
    pt_or_walk: object(meta.pt_or_walk),
  };
}

// ---------------------------------------------------------------- links

/** The choice in a link: sch=all, sch=state, sch=zone or sch=one:<Ministry
 *  number>; stu=girls or stu=boys; sz=0 when One school counts everyone
 *  rather than only its zone. A link without sch, or with one this page does
 *  not know, opens `fallback` (DEFAULT_SCHOOL_CHOICE). */
export function readChoice(sch, stu, sz, fallback = DEFAULT_SCHOOL_CHOICE) {
  const out = { ...ALL_CHOICE, kind: ['all', 'state', 'zone'].includes(fallback) ? fallback : 'all' };
  if (sch === 'all' || sch === 'state' || sch === 'zone') out.kind = sch;
  const one = /^one:(\d{1,7})$/.exec(sch || '');
  if (one) {
    out.kind = 'one';
    out.moe = Number(one[1]);
  }
  if (stu === 'girls' || stu === 'boys') out.students = stu;
  if (sz === '0') out.zoneOnly = false;
  return out;
}

/** The link parameters for a choice. sch is always written, so a link keeps
 *  its meaning if the default changes; the rest only when not the default. */
export function choiceParams(choice) {
  const out = [];
  if (!choice || choice.kind === 'all') return [['sch', 'all']];
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

const OTHER_MEDIUM = { other: 'Māori- or Pacific-medium', maori: 'Māori-medium', pacific: 'Pacific-medium', unknown: 'teaching language not recorded' };
const KIND_WORD = { state: 'state', integrated: 'state-integrated', private: 'private', charter: 'charter' };

export const serves = (dest, service) => Boolean(dest && Array.isArray(dest.services) && dest.services.includes(service));

/** Whether this build says what kind of school each one is. Builds before
 *  0.12 do not, and then only All can be shown. */
export function hasAttributes(destinations, service) {
  return (destinations || []).some((d) => serves(d, service) && typeof d.kind === 'string');
}

/** The teaching language, from the Ministry's Language_of_Instruction:
 *  english, maori or pacific (`language`), or english or other (`medium`)
 *  where only that is sent; null where the directory gives none. Schools
 *  where every student is taught in te reo Māori or a Pacific language are
 *  maori or pacific; schools with a bilingual unit are english. */
export function mediumOf(dest) {
  if (!dest) return null;
  if (['english', 'maori', 'pacific'].includes(dest.language)) return dest.language;
  if (['english', 'maori', 'pacific', 'other'].includes(dest.medium)) return dest.medium;
  return null;
}

/** Taught in English. A school whose teaching language is not recorded is
 *  not, so State leaves it out and the counting line says so, as the build
 *  does (schools.py eligible). */
export const englishMedium = (dest) => mediumOf(dest) === 'english';

/** A state school taught in English: what State counts. */
export const isState = (dest) => Boolean(dest && dest.kind === 'state' && englishMedium(dest));

/** A designated character school (Education and Training Act 2020, s 204),
 *  from a checked row in configs/schools/attributes.csv: its board may
 *  decline a student whose family does not accept the school's character. */
export const isDesignated = (dest) => Boolean(dest && dest.character === 'designated');

/** What In zone counts: a state school taught in English that is not a
 *  designated character school (schools.py in_zone_school). */
export const isInZoneSchool = (dest) => isState(dest) && !isDesignated(dest);

/** Secondary school in two stages (schools.py STAGES): where a place has a
 *  Years 7–10 (or 1–10) school or a Years 11–15 school, State and In zone
 *  count a hexagon only when a student in Years 9–10 and one in Years 11–13
 *  can each reach a school that teaches them. */
export const STAGES = Object.freeze({ secondary_school: Object.freeze({ junior: [9, 10], senior: [11, 13] }) });
export const STAGE_WORDS = Object.freeze({ junior: 'Years 9–10', senior: 'Years 11–13' });

/** Whether a school teaches any year of a stage; true where its years are not given. */
export function teachesStage(dest, service, stage) {
  const span = stage ? STAGES[service]?.[stage] : null;
  if (!span) return true;
  const years = Array.isArray(dest?.years) ? dest.years.map(Number) : null;
  if (!years || !Number.isFinite(years[0]) || !Number.isFinite(years[1])) return true;
  return years[0] <= span[1] && years[1] >= span[0];
}

/** The stages a service is split into here, or null: only where some school
 *  teaching it teaches one stage and not the other. */
export function stagesFor(destinations, service) {
  const stages = STAGES[service];
  if (!stages) return null;
  const names = Object.keys(stages);
  for (const dest of destinations || []) {
    if (!serves(dest, service) || dest.moe == null) continue;
    if (names.filter((st) => teachesStage(dest, service, st)).length === 1) return names;
  }
  return null;
}

/** Co-ed, girls or boys, for the years of this service, or null where the
 *  directory does not say. King's College, for one, is a boys' school at
 *  Year 9 even though it takes girls later on. */
export function sexOf(dest, service) {
  const value = dest && dest.sex && typeof dest.sex === 'object' ? dest.sex[service] : null;
  return value === 'co-ed' || value === 'girls' || value === 'boys' ? value : null;
}

/** Whether a girl (or a boy) can go to this school for this service: a co-ed
 *  school or one of their own. A school that does not say is counted for
 *  neither, as the build does (schools.py takes). */
export function admits(dest, service, students) {
  const sex = sexOf(dest, service);
  if (students === 'girls') return sex === 'co-ed' || sex === 'girls';
  if (students === 'boys') return sex === 'co-ed' || sex === 'boys';
  return true;
}

const SEX_WORD = { girls: "girls' school", boys: "boys' school" };

/** The group a school falls in for the counting line. Kind comes first: a
 *  state-integrated kura counts as state-integrated. */
export function groupOf(dest) {
  if (!dest || !dest.kind) return 'unknown';
  if (dest.kind !== 'state') return dest.kind;
  const medium = mediumOf(dest);
  if (medium === 'english') return 'state';
  return medium ? 'other_medium' : 'language_unknown';
}

/** How a school differs from a state, English-medium, co-ed school, for a tag
 *  after its name: "state, Māori-medium", "state-integrated, girls' school".
 *  Empty for a school that does not differ. */
export function tagOf(dest, service, { years = false } = {}) {
  if (!dest || !dest.kind) return '';
  const bits = [];
  const sex = sexOf(dest, service);
  const medium = mediumOf(dest);
  const other = medium !== 'english';
  if (dest.kind !== 'state' || other || SEX_WORD[sex]) bits.push(KIND_WORD[dest.kind] || dest.kind);
  if (other) bits.push(OTHER_MEDIUM[medium || 'unknown']);
  if (SEX_WORD[sex]) bits.push(SEX_WORD[sex]);
  // A secondary school that teaches one stage only, where a name is shown:
  // under All a junior high can be the nearest for a 16-year-old.
  if (years && STAGES[service] && Array.isArray(dest.years)) {
    const one = Object.keys(STAGES[service]).filter((st) => teachesStage(dest, service, st));
    if (one.length === 1) bits.push(`Years ${dest.years[0]}–${Math.min(13, Number(dest.years[1]))}`);
  }
  return bits.join(', ');
}

/** Whether a school is counted under a choice, setting zones aside. In zone
 *  starts from the same schools as State; which of them count then depends
 *  on the hexagon. */
export function counts(dest, service, choice, students = choice.students, stage = null) {
  if (!serves(dest, service)) return false;
  if (choice.kind === 'all') return true;
  if (choice.kind === 'one') return choice.moe != null && Number(dest.moe) === Number(choice.moe);
  if (!(choice.kind === 'zone' ? isInZoneSchool(dest) : isState(dest))) return false;
  return admits(dest, service, students) && teachesStage(dest, service, stage);
}

// ---------------------------------------------------------------- reach lists

/** One reach list, as typed arrays. `o` holds where each hexagon's schools
 *  start in `d` and `m`: n + 1 offsets, or n with the end implied.
 *
 *  Format 2 public transport lists (pt_or_walk: true) are "public transport,
 *  or walking where that is quicker": `m` is the lower of R5's time and the
 *  walk, and `r5` lists the entries where R5's own time is slower or missing
 *  ({k: [positions], m: [minutes or null]}). Decoded, `r5` holds R5's minutes
 *  for every entry: `m` where it is not listed, Infinity where R5 has none
 *  within the limit. An entry listed is a walk, with no bus or train. */
export function decodeReach(json, n) {
  if (!json || ![1, 2].includes(json.format) || !Array.isArray(json.o) || !Array.isArray(json.d) || !Array.isArray(json.m)) {
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
  // complete: false is a short list (by car): the nearest school under All
  // and State only, so it cannot answer One school; `holds` says whether it
  // also has the nearest under In zone.
  const out = {
    start, d: Int32Array.from(json.d), m: numeric(json.m), lo: null, hi: null, r5: null, walked: null,
    complete: json.complete !== false, format: json.format, ptOrWalk: json.pt_or_walk === true,
    holds: Array.isArray(json.holds) ? json.holds.slice() : null,
  };
  if (Array.isArray(json.lo) && json.lo.length === json.d.length) out.lo = numeric(json.lo);
  if (Array.isArray(json.hi) && json.hi.length === json.d.length) out.hi = numeric(json.hi);
  if (json.r5 && Array.isArray(json.r5.k) && Array.isArray(json.r5.m)) {
    if (json.r5.k.length !== json.r5.m.length) throw new Error('The school times give R5 minutes for more entries than they name.');
    const r5 = Float32Array.from(out.m);
    const walked = new Uint8Array(out.m.length);
    json.r5.k.forEach((k, j) => {
      if (!(Number.isInteger(k) && k >= 0 && k < r5.length)) throw new Error('The school times name an R5 entry that is not in the list.');
      r5[k] = json.r5.m[j] == null ? Infinity : json.r5.m[j];
      walked[k] = 1;
    });
    out.r5 = r5;
    out.walked = walked;
  }
  return out;
}

/** Whether a reach list can answer a choice: a full list answers any; a
 *  short list (by car) answers All and State, and In zone when it says so. */
export function listAnswers(list, choice) {
  if (!list) return false;
  if (list.complete) return true;
  if (choice.kind === 'one') return false;
  if (choice.kind === 'zone') return Array.isArray(list.holds) && list.holds.includes('zone');
  return true;
}

/** Every school hexagon i reaches by one way of travelling, nearest first:
 *  [{ d, m, lo, hi }]. Times over the routing limit are left out. Schools
 *  reached in the same minute keep the build's order (see below). */
export function reachAt(reach, i, maxMinutes = 60) {
  if (!reach) return [];
  const out = [];
  for (let k = reach.start[i]; k < reach.start[i + 1]; k += 1) {
    const m = reach.m[k];
    if (!(m <= maxMinutes)) continue;
    out.push({ d: reach.d[k], m, lo: reach.lo ? reach.lo[k] : NaN, hi: reach.hi ? reach.hi[k] : NaN });
  }
  return out.sort((a, b) => a.m - b.m);
}

// ---------------------------------------------------------------- zones
//
// schools/zones.json, format 2 (docs/schools.md). For each service, `in`
// gives each hexagon's In zone set: the zones most of its residents live in,
// zoned schools only. `share` gives the share of its residents inside every
// zone that applies to the service and holds any of them. `split` lists the
// hexagons whose residents live in more than one set. `schools[d].status`
// says how school d's zone is applied on the reference date:
//
//   in_force       its zone in force then: counted only inside it
//   upcoming_used  the Ministry's file holds only a later zone, which is used
//   no_map         an enrolment scheme with no zone in the map file: everyone
//   none           no enrolment scheme: everyone
//   not_applied    a zone in the file, but the directory says no scheme: everyone
//   unclear_years  zones whose year levels could not be read: everyone
//
// and `polygons[service]` the zones that apply to each service it teaches
// (Balmoral School's Zone A for Years 1 to 6, Zone B for 7 and 8).

/** Statuses whose zone is applied: the school counts only inside it. */
export const ZONED = Object.freeze(['in_force', 'upcoming_used']);

function emptyList(n) {
  return { start: new Int32Array(n + 1), d: new Int32Array(0), m: new Float32Array(0), lo: null, hi: null, r5: null, complete: true };
}

/** The zones for one service, from zones.json format 2: { in, share, split,
 *  schools, source, reference, rule }. Null when the file is not one this
 *  page reads. */
export function decodeZones(json, service, n) {
  if (!json || json.format !== 2) return null;
  const list = (block, weights = false) => {
    if (!block || !Array.isArray(block.o) || !Array.isArray(block.d)) return null;
    try {
      const out = decodeReach({ format: 1, o: block.o, d: block.d, m: block.d.map(() => 0) }, n);
      if (weights) {
        if (!Array.isArray(block.w) || block.w.length !== block.d.length) return null;
        out.w = Float32Array.from(block.w, (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0));
      }
      return out;
    } catch {
      return null;
    }
  };
  // A service with no zones at all (Blenheim's colleges) has empty blocks.
  const inBlock = (json.in || {})[service];
  const inSet = inBlock ? list(inBlock) : emptyList(n);
  if (!inSet) return null;
  const shareBlock = (json.share || {})[service];
  const share = shareBlock ? list(shareBlock, true) : null;
  if (shareBlock && !share) return null;
  const split = new Uint8Array(n);
  for (const i of (json.split || {})[service] || []) if (Number.isInteger(i) && i >= 0 && i < n) split[i] = 1;
  return {
    format: 2,
    service,
    in: inSet,
    share: share || { ...emptyList(n), w: new Float32Array(0) },
    split,
    schools: json.schools && typeof json.schools === 'object' ? json.schools : {},
    source: json.source || null,
    reference: json.reference_date || null,
    rule: json.rule || null,
  };
}

const has = (list, i, d) => {
  if (!list) return false;
  for (let k = list.start[i]; k < list.start[i + 1]; k += 1) if (list.d[k] === d) return true;
  return false;
};

/** School d's record in zones.json, or null. */
export function zoneEntry(zones, d) {
  if (!zones || !zones.schools || d == null || d < 0) return null;
  return zones.schools[d] || zones.schools[String(d)] || null;
}

/** How school d's zone is applied for a service: a status above, read from
 *  zones.json, then from the school's own entry in destinations.json, then
 *  from whether the directory says it has an enrolment scheme. A zoned
 *  school none of whose zones applies to the years of this service has no
 *  zone for it ('no_zone_for_years') and, for those years, takes anyone. */
export function zoneStatus(zones, dest, d, service) {
  const z = zoneEntry(zones, d);
  const pick = (value) => (value && typeof value === 'object' ? value[service] : value);
  let status = pick(z && z.status) || pick(dest && dest.zone && dest.zone.status) || null;
  if (!status) status = dest && dest.scheme === true ? 'no_map' : 'none';
  if (ZONED.includes(status) && z && z.polygons && typeof z.polygons === 'object'
    && !(Array.isArray(z.polygons[service]) && z.polygons[service].length)) status = 'no_zone_for_years';
  return status;
}

/** Whether school d counts only inside its zone for this service. */
export const isZoned = (zones, dest, d, service) => Boolean(zones) && ZONED.includes(zoneStatus(zones, dest, d, service));

/** Whether school d's zone is in hexagon i's In zone set. */
export const inZone = (zones, i, d) => has(zones && zones.in, i, d);

/** The share of hexagon i's residents living in school d's zone, 0 to 1. */
export function zoneShareAt(zones, i, d) {
  const share = zones && zones.share;
  if (!share || !share.w) return 0;
  for (let k = share.start[i]; k < share.start[i + 1]; k += 1) if (share.d[k] === d) return share.w[k];
  return 0;
}

/** Every hexagon's share of residents in school d's zone (Float32Array), the
 *  hexagons a zone line crosses (0 < share < 1), and whether any has some. */
export function zoneShares(zones, d, n) {
  const share = new Float32Array(n);
  const crossed = new Uint8Array(n);
  let any = false;
  if (!zones || !zones.share) return { share, crossed, any };
  const list = zones.share;
  for (let i = 0; i < n; i += 1) {
    for (let k = list.start[i]; k < list.start[i + 1]; k += 1) {
      if (list.d[k] !== d) continue;
      const w = list.w[k];
      share[i] = w;
      if (w > 0) any = true;
      if (w > 0 && w < 1) crossed[i] = 1;
    }
  }
  return { share, crossed, any };
}

/** The zone dates of school d, as zones.json gives them: { status, from,
 *  next } with `next` the start of a later zone that is not applied. */
export function zoneDates(zones, dest, d, service) {
  const z = zoneEntry(zones, d) || (dest && dest.zone) || {};
  return {
    status: zoneStatus(zones, dest, d, service),
    from: z.from || (dest && dest.zone_from) || null,
    next: z.next && z.next.from ? z.next.from : null,
  };
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

/** Tied schools in the build's order. Each hexagon's reach list comes
 *  sorted by minutes, then straight-line metres (NZTM, whole metres), then
 *  Ministry number (schools.py ordered_reach), which is the order cells.json
 *  names ties in. Using that order, rather than working distances out again
 *  here, names the same school the build does every time. Schools not in
 *  the list go last, by index. */
export function orderTies(ids, reach, i) {
  if (ids.length < 2 || !reach) return ids;
  const at = new Map();
  for (let k = reach.start[i]; k < reach.start[i + 1]; k += 1) if (!at.has(reach.d[k])) at.set(reach.d[k], k);
  const pos = (d) => (at.has(d) ? at.get(d) : Infinity);
  return [...ids].sort((a, b) => pos(a) - pos(b) || a - b);
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
 *  school. `r5` is R5's own public transport time to the nearest counted
 *  school by bus or train (NaN for none within the limit), where the list
 *  gives it (format 2); null otherwise. */
function solve({ reach, n, destinations, ok, eligible, centres, standardModes, maxMinutes, limits }) {
  const t = {};
  const near = {};
  const ties = {};
  let r5 = null;
  for (const [mode, list] of Object.entries(reach)) {
    const time = new Float32Array(n).fill(NaN);
    const first = new Int32Array(n).fill(-1);
    const tied = {};
    const own = mode === 'pt' && list.r5 ? new Float32Array(n).fill(NaN) : null;
    for (let i = 0; i < n; i += 1) {
      let best = Infinity;
      let at = -1;
      let extra = null;
      let bus = Infinity;
      for (let k = list.start[i]; k < list.start[i + 1]; k += 1) {
        const m = list.m[k];
        if (own && list.r5[k] <= maxMinutes && list.r5[k] < bus && ok(i, list.d[k])) bus = list.r5[k];
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
      if (own && Number.isFinite(bus)) own[i] = bus;
      if (at < 0) continue;
      // The list is in the build's order, so the first school found is the
      // one named and the rest follow in order.
      time[i] = best;
      first[i] = at;
      if (extra) tied[i] = extra;
    }
    t[mode] = time;
    near[mode] = first;
    ties[mode] = tied;
    if (own) r5 = own;
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

  // The straight line to the nearest school that counts here. The nearest is
  // found on a flat projection about the hexagon's own latitude, which ranks
  // schools a few kilometres away as the sphere does, and only its distance
  // is then worked out on the sphere.
  const km = new Float32Array(n).fill(NaN);
  if (centres) {
    const everywhere = [];
    const somewhere = [];
    for (let d = 0; d < destinations.length; d += 1) {
      const dest = destinations[d];
      if (!Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) continue;
      if (eligible[d] === 1) everywhere.push(d);
      else if (eligible[d] === 2) somewhere.push(d);
    }
    const lat = Float64Array.from(destinations, (x) => x.lat);
    const lon = Float64Array.from(destinations, (x) => x.lon);
    for (let i = 0; i < n; i += 1) {
      const centre = centres[i];
      if (!centre) continue;
      const squeeze = Math.cos(centre[0] * RAD) ** 2;
      let best = Infinity;
      let at = -1;
      const consider = (d) => {
        const dy = lat[d] - centre[0];
        const dx = lon[d] - centre[1];
        const flat = dy * dy + dx * dx * squeeze;
        if (flat < best) {
          best = flat;
          at = d;
        }
      };
      for (const d of everywhere) consider(d);
      for (const d of somewhere) if (ok(i, d)) consider(d);
      if (at >= 0) km[i] = kmBetween(centre, destinations[at]);
    }
  }
  return { t, near, ties, choice, km, r5 };
}

const fastestOf = (t, modes, i) => {
  let best = NaN;
  for (const m of modes) {
    const v = t[m] ? t[m][i] : NaN;
    if (Number.isFinite(v) && !(v >= best)) best = v;
  }
  return best;
};

/** Students counted together (girls and boys, or the two stages of
 *  secondary school): a hexagon counts only when each of them has a school
 *  they can go to within the time, so each time is the slowest of theirs.
 *  Best without a car is the slowest of each one's own fastest way, since
 *  each may travel differently. Counts are the smallest, and the straight
 *  line the longest. `parts` are solve() results, each with `best`, and
 *  `base` lists the single runs behind them (for onFoot). */
function combine(parts, { n, reach }, base = parts) {
  const t = {};
  const near = {};
  const ties = {};
  for (const mode of Object.keys(parts[0].t)) {
    const time = new Float32Array(n).fill(NaN);
    const first = new Int32Array(n).fill(-1);
    const tied = {};
    for (let i = 0; i < n; i += 1) {
      let slowest = -Infinity;
      let missing = false;
      for (const s of parts) {
        const v = s.t[mode][i];
        if (!Number.isFinite(v)) { missing = true; break; }
        if (v > slowest) slowest = v;
      }
      if (missing) continue;
      time[i] = slowest;
      // The schools that set the time: the slowest one's, or all of those tied.
      const ids = [];
      for (const s of parts) {
        if (s.t[mode][i] !== slowest) continue;
        const k = s.near[mode][i];
        if (k >= 0 && !ids.includes(k)) ids.push(k);
        for (const extra of s.ties[mode][i] || []) if (!ids.includes(extra)) ids.push(extra);
      }
      const ordered = orderTies(ids, reach[mode], i);
      first[i] = ordered[0] ?? -1;
      if (ordered.length > 1) tied[i] = ordered.slice(1);
    }
    t[mode] = time;
    near[mode] = first;
    ties[mode] = tied;
  }
  const best = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i += 1) {
    let slowest = -Infinity;
    let missing = false;
    for (const s of parts) {
      const v = s.best[i];
      if (!Number.isFinite(v)) { missing = true; break; }
      if (v > slowest) slowest = v;
    }
    if (!missing) best[i] = slowest;
  }
  const choice = {};
  for (const limit of Object.keys(parts[0].choice)) {
    choice[limit] = Float32Array.from(parts[0].choice[limit], (v, i) => Math.min(v, ...parts.slice(1).map((s) => s.choice[limit][i])));
  }
  const km = Float32Array.from(parts[0].km, (v, i) => {
    let far = v;
    for (const s of parts.slice(1)) far = Number.isFinite(far) && Number.isFinite(s.km[i]) ? Math.max(far, s.km[i]) : NaN;
    return Number.isFinite(far) ? far : NaN;
  });
  // By bus or train alone: the slowest, none if any has none.
  const r5 = parts.every((s) => s.r5)
    ? Float32Array.from(parts[0].r5, (v, i) => {
      let slow = v;
      for (const s of parts.slice(1)) slow = Number.isFinite(slow) && Number.isFinite(s.r5[i]) ? Math.max(slow, s.r5[i]) : NaN;
      return slow;
    })
    : null;
  const eligible = Uint8Array.from(parts[0].eligible, (v, d) => Math.max(v, ...parts.slice(1).map((s) => s.eligible[d])));
  return { t, near, ties, choice, km, best, r5, eligible, ptFoot: onFoot(base, t, n, reach) };
}

/** Where the public transport time shown for students counted together is
 *  a walk. The time shown is the slowest student's; it is said as a walk
 *  only when, for each student whose time it is, walking takes as long as
 *  public transport. Comparing the joint walking and public transport times
 *  alone would also say it where a girl's walk sets one and a boy's bus trip
 *  the other. { mask, near, ties }, near and ties naming the schools those
 *  students walk to, or null without both lists. */
function onFoot(runs, t, n, reach) {
  if (!t.pt || !t.walk || !reach.walk) return null;
  const mask = new Uint8Array(n);
  const near = new Int32Array(n).fill(-1);
  const ties = {};
  for (let i = 0; i < n; i += 1) {
    const shown = t.pt[i];
    if (!Number.isFinite(shown) || t.walk[i] !== shown) continue;
    const binding = runs.filter((s) => s.t.pt[i] === shown);
    if (!binding.length || !binding.every((s) => s.t.walk[i] === shown)) continue;
    mask[i] = 1;
    const ids = [];
    for (const s of binding) {
      for (const d of [s.near.walk[i], ...(s.ties.walk[i] || [])]) if (d >= 0 && !ids.includes(d)) ids.push(d);
    }
    const ordered = orderTies(ids, reach.walk, i);
    near[i] = ordered.length ? ordered[0] : -1;
    if (ordered.length > 1) ties[i] = ordered.slice(1);
  }
  return { mask, near, ties };
}

/** Everything the app swaps in for one service under a choice.
 *
 *  `reach` maps each way of travelling to its decoded reach list; `zones` is
 *  decodeZones' result (needed for In zone only); `centres[i]` is the middle
 *  of hexagon i as [lat, lng]. Returns { t, near, ties, choice, km, best,
 *  r5, counted, bySex, groups }: `best` only where students are counted
 *  together (girls and boys, or the two stages of secondary school), whose
 *  fastest ways can differ; `r5` R5's own time by bus or train to the
 *  nearest counted school; `counted` marks the schools that count anywhere
 *  (1) or only in their zone (2), for the pins; `bySex` holds the girls' and
 *  boys' own figures, and `groups` every student group's (with `students`
 *  and `stage`), for the card.
 *
 *  In zone counts the state schools taught in English that take the
 *  student: those with no zone for these years everywhere, and the others
 *  only in hexagons whose In zone set holds their zone. */
export function chooseSchools({
  destinations, service, choice, reach, zones = null, n, centres = null,
  standardModes = ['walk', 'bike_low_stress', 'pt'], maxMinutes = 60, limits = COUNT_LIMITS,
}) {
  const base = { reach, n, destinations, centres, standardModes, maxMinutes, limits };
  const run = (students, stage = null) => {
    // 1: counts everywhere; 2: counts only where its zone is in the
    // hexagon's In zone set (zones.json `in`).
    const eligible = new Uint8Array(destinations.length);
    for (let d = 0; d < destinations.length; d += 1) {
      const dest = destinations[d];
      if (!counts(dest, service, choice, students, stage)) continue;
      eligible[d] = choice.kind === 'zone' && isZoned(zones, dest, d, service) ? 2 : 1;
    }
    const ok = (i, d) => eligible[d] === 1 || (eligible[d] === 2 && inZone(zones, i, d));
    const out = solve({ ...base, ok, eligible });
    const best = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i += 1) best[i] = fastestOf(out.t, standardModes, i);
    return { ...out, eligible, best, students, stage };
  };
  const pooled = choice.kind === 'state' || choice.kind === 'zone';
  const stages = pooled ? stagesFor(destinations, service) : null;
  const sexes = pooled && choice.students === 'both' ? ['girls', 'boys'] : [choice.students];
  if (!stages && sexes.length === 1) {
    const one = run(choice.students);
    return { ...one, best: null, counted: one.eligible, bySex: null, groups: null };
  }
  // Each student group on its own, then together: every stage for each sex,
  // then the sexes.
  const groups = [];
  const bySexParts = sexes.map((students) => {
    const runs = (stages || [null]).map((stage) => run(students, stage));
    groups.push(...runs);
    return runs.length > 1 ? { ...combine(runs, base), students } : runs[0];
  });
  const all = bySexParts.length > 1 ? combine(bySexParts, base, groups) : { ...bySexParts[0], ptFoot: onFoot(groups, bySexParts[0].t, n, reach) };
  const bySex = sexes.length === 2 ? { girls: bySexParts[0], boys: bySexParts[1] } : null;
  return { ...all, counted: all.eligible, bySex, groups };
}

/** The nearest school hexagon i reaches by one way, among those `ok(d)`
 *  allows: { m, ds } with ties in the steady order, or null. For the card,
 *  which looks at one hexagon. */
export function nearestAt(reach, i, ok, { maxMinutes = 60 } = {}) {
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
  return { m: best, ds: orderTies(ds, reach, i) };
}

/** Minutes from hexagon i to school d by one way, with the 10th and 90th
 *  percentiles where the build sends them, and R5's own minutes by bus or
 *  train (`r5`: NaN for none within the limit; undefined where the list does
 *  not say). NaN when it is not reached. */
export function minutesTo(reach, i, d, maxMinutes = 60) {
  const out = { m: NaN, lo: NaN, hi: NaN, r5: undefined };
  if (!reach) return out;
  for (let k = reach.start[i]; k < reach.start[i + 1]; k += 1) {
    if (reach.d[k] !== d || !(reach.m[k] <= maxMinutes)) continue;
    if (!(reach.m[k] >= out.m)) {
      out.m = reach.m[k];
      out.lo = reach.lo ? reach.lo[k] : NaN;
      out.hi = reach.hi ? reach.hi[k] : NaN;
      if (reach.r5) out.r5 = reach.r5[k] <= maxMinutes ? reach.r5[k] : NaN;
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
  // Girls and boys together: where the public transport time is a walk (place.js tripWords).
  data.ptFoot = { ...(data.ptFoot || {}) };
  if (result.ptFoot) data.ptFoot[service] = result.ptFoot;
  else delete data.ptFoot[service];
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
  // R5's own time by bus or train to the nearest school counted, for the
  // card's "By bus or train" line (place.js busTime).
  data.r5t = { ...(data.r5t || {}) };
  if (result.r5) data.r5t[service] = result.r5;
  else delete data.r5t[service];
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
    if (data.ptFoot) {
      data.ptFoot = { ...data.ptFoot };
      delete data.ptFoot[service];
    }
    if (data.r5t) {
      data.r5t = { ...data.r5t };
      delete data.r5t[service];
    }
  }
  data.schoolsAll = {};
}

// ---------------------------------------------------------------- words

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-01" as "1 Oct 2026". Anything else as it came. */
export function day(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return value ? String(value) : '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2018-06-06" as "6 June 2018". Anything else as it came. */
export function longDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return value ? String(value) : '';
  return `${Number(m[3])} ${FULL_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
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
const possessive = (name) => (/s$/.test(name) ? `${name}'` : `${name}'s`);

/** The school chosen under One school, by its Ministry number. */
export function schoolByMoe(destinations, service, moe) {
  if (moe == null) return -1;
  return (destinations || []).findIndex((d) => serves(d, service) && Number(d.moe) === Number(moe));
}

/** What to call what is being reached, for headlines, the key and the card.
 *  `base` is the service's own words: { short, noun, plural }. `children` is
 *  true where the figures count children rather than all residents, so In
 *  zone can say "a school that must take them". */
export function choiceWords(base, choice, school = null, { children = false } = {}) {
  if (!choice || choice.kind === 'all') return { ...base, nearest: `the nearest ${stripArticle(base.noun)}` };
  if (choice.kind === 'one') {
    const name = school && school.name ? school.name : 'the school picked';
    return { short: name, noun: name, plural: name, nearest: name, one: true };
  }
  const plain = stripArticle(base.noun);
  const sexed = choice.students === 'girls' ? ', girls' : choice.students === 'boys' ? ', boys' : '';
  if (choice.kind === 'zone') {
    // In zone: the state schools that must take a child living there, which
    // is what the Ministry's transport test asks of the nearest school.
    const who = choice.students === 'girls' ? 'a girl living there' : choice.students === 'boys' ? 'a boy living there'
      : children ? 'them' : 'a child living there';
    return {
      short: `${capital(`state ${plain}`)}, in zone${sexed}`,
      noun: `a state ${plain} that must take ${who}`,
      plural: `state ${base.plural} that must take ${who}`,
      nearest: `the nearest state ${plain} that must take ${who}`,
      nearestLabel: `Nearest state school that must take ${who}`,
      zone: true,
    };
  }
  const who = choice.students === 'girls' ? ' that takes girls' : choice.students === 'boys' ? ' that takes boys' : '';
  const thing = `state ${plain}`;
  // State counts schools taught in English only, as the counting line says;
  // a state kura is a state school too, so the noun says which.
  return {
    short: capital(thing) + sexed,
    noun: `${article(thing)} ${thing} taught in English${who}`,
    plural: `state ${base.plural}`,
    nearest: `the nearest ${thing} taught in English${who}`,
  };
}

/** How many schools of each group teach a service: { all, state, other_medium,
 *  integrated, private, charter, unknown }. */
export function groupCounts(destinations, service, students = 'both') {
  const out = { all: 0, state: 0, other_medium: 0, language_unknown: 0, integrated: 0, private: 0, charter: 0, unknown: 0 };
  for (const dest of destinations || []) {
    if (!serves(dest, service)) continue;
    out.all += 1;
    const group = groupOf(dest);
    if (group === 'state' && students !== 'both' && !admits(dest, service, students)) continue;
    out[group] = (out[group] || 0) + 1;
  }
  return out;
}

/** Who the figures count, under every school headline and in the CSV, in a
 *  build with no ages. A build with them says which children instead
 *  (ages.js ageWords). */
export const RESIDENTS = 'Figures count all residents, not only school-age children.';
/** Under State: home zones are not applied. */
export const NO_ZONES = 'Home zones are not applied: a school with a zone counts for everyone, in or out of it.';

const LEFT_OUT = [
  ['integrated', 'state-integrated'],
  ['private', 'private'],
  ['charter', 'charter'],
  ['other_medium', 'Māori- or Pacific-medium'],
  ['language_unknown', 'state with no record of their teaching language'],
  ['unknown', 'with no record of their kind'],
];

/** "Māori-medium" when every such school is, and so on. */
function otherMediumWord(destinations, service) {
  const seen = new Set();
  for (const dest of destinations || []) {
    if (serves(dest, service) && groupOf(dest) === 'other_medium') seen.add(mediumOf(dest));
  }
  return seen.size === 1 ? OTHER_MEDIUM[[...seen][0]] || OTHER_MEDIUM.other : OTHER_MEDIUM.other;
}

/** The state schools whose teaching language the build took from their
 *  peak body, because the directory gives none (Te Wharekura o Tāmaki ki te
 *  Tonga, rule D7). */
function fromPeakBody(destinations, service) {
  return (destinations || []).filter((dest) => serves(dest, service) && groupOf(dest) === 'other_medium' && dest.language_source === 'peak_body')
    .map((dest) => dest.name);
}

/** "27 state-integrated, 29 private and 8 Māori-medium", with any school
 *  whose teaching language came from its peak body named. */
function leftOutList(destinations, service, c) {
  const otherWord = otherMediumWord(destinations, service);
  const peak = fromPeakBody(destinations, service);
  return LEFT_OUT.filter(([key]) => c[key]).map(([key, word]) => {
    if (key !== 'other_medium') return `${thousands(c[key])} ${word}`;
    const note = peak.length ? ` (${andList(peak)} from ${peak.length > 1 ? 'their peak bodies' : 'its peak body'})` : '';
    return `${thousands(c[key])} ${otherWord}${note}`;
  });
}

/** The state schools taught in English that teach a service and take the
 *  student, by how In zone counts them (designated character schools left
 *  out). */
export function zoneTally(destinations, service, zones, students = 'both') {
  const out = { zoned: [], open: [], no_map: [], not_applied: [], unclear_years: [], upcoming: [] };
  (destinations || []).forEach((dest, d) => {
    if (!serves(dest, service) || !isInZoneSchool(dest) || !admits(dest, service, students)) return;
    const status = zoneStatus(zones, dest, d, service);
    if (ZONED.includes(status)) {
      out.zoned.push(d);
      if (status === 'upcoming_used') out.upcoming.push(d);
    } else if (out[status]) out[status].push(d);
    else out.open.push(d);
  });
  return out;
}

const isAre = (n) => (n === 1 ? 'is' : 'are');
const itThey = (n) => (n === 1 ? 'it counts' : 'they count');

/** The line under every headline that says which schools are counted, with
 *  the counts taken from the build's own list. `plural` is the service's
 *  plural ("secondary schools"); `zones` is decodeZones' result; `ages` is
 *  ages.js ageWords for the service, or null where the figures count all
 *  residents; `splitPeople` is how many of those counted live in hexagons a
 *  zone line splits, for In zone. */
export function countingLine(destinations, service, choice, {
  plural = 'schools', zones = null, meta = {}, ages = null, splitPeople = null, outsideSet = null, zoneOutside = null,
} = {}) {
  const c = groupCounts(destinations, service);
  // Who the figures weight: children of the service's ages, or everyone.
  const whoLine = ages && ages.line ? ages.line : RESIDENTS;
  const listed = ` ${whoLine}${meta.directory ? ` School list as at ${day(meta.directory)}.` : ''}`;
  const otherWord = otherMediumWord(destinations, service);
  if (!choice || choice.kind === 'all') {
    const peak = fromPeakBody(destinations, service);
    const parts = [
      c.state ? `${c.state} state` : null,
      c.other_medium ? `${c.other_medium} state ${otherWord}${peak.length ? ` (${andList(peak)} from ${peak.length > 1 ? 'their peak bodies' : 'its peak body'})` : ''}` : null,
      c.language_unknown ? `${c.language_unknown} state with no record of their teaching language` : null,
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
    const dest = d >= 0 ? destinations[d] : null;
    const name = dest ? dest.name : 'the school picked';
    let zoneText = '';
    if (dest && zones) {
      const status = zoneStatus(zones, dest, d, service);
      if (ZONED.includes(status) && zoneOutside) {
        // A school over a regional boundary whose zone holds none of the place's homes.
        zoneText = ` Its zone lies outside ${zoneOutside}, where TEAM has no homes, so everyone is counted.`;
      } else if (ZONED.includes(status)) {
        zoneText = choice.zoneOnly !== false
          ? ' Only those living in its zone are counted, each hexagon by the share of its residents inside the zone.'
          : ' Everyone is counted, not only its zone.';
        const note = integratedZoneNote(dest);
        if (note) zoneText += ` ${note}`;
      } else {
        zoneText = ` ${capital(NO_ZONE[status] || NO_ZONE.none)}, so everyone is counted.`;
      }
    } else if (dest && dest.scheme === true) {
      zoneText = ' Its zone is not in this build, so people in and out of its zone are counted alike.';
    }
    return `Counting ${name} only.${zoneText}${listed}`;
  }
  const sexed = choice.students !== 'both' ? groupCounts(destinations, service, choice.students) : c;
  const notCounted = leftOutList(destinations, service, c);
  let who = '';
  if (choice.students === 'girls') who = ` Counting co-ed and girls' schools: ${thousands(sexed.state)} of the ${thousands(c.state)}.`;
  else if (choice.students === 'boys') who = ` Counting co-ed and boys' schools: ${thousands(sexed.state)} of the ${thousands(c.state)}.`;
  else who = ' Girls and boys: both must be able to reach one they can go to, and the time is the slower of the two.';
  // Secondary school in two stages, where a school here takes only one.
  if (stagesFor(destinations, service)) {
    const junior = (destinations || []).filter((d) => serves(d, service) && teachesStage(d, service, 'junior') && !teachesStage(d, service, 'senior')).length;
    const senior = (destinations || []).filter((d) => serves(d, service) && teachesStage(d, service, 'senior') && !teachesStage(d, service, 'junior')).length;
    who += ` ${thousands(junior)} ${junior === 1 ? 'school here stops' : 'schools here stop'} at Year 10 and ${thousands(senior)} ${senior === 1 ? 'starts' : 'start'} at Year 11, so a student in Years 9–10 and one in Years 11–13 must each reach a school that teaches them, and the time is the slower.`;
  }
  if (choice.kind === 'state') {
    const left = notCounted.length ? ` Not counted: ${andList(notCounted)}.` : '';
    const designated = (destinations || []).filter((dest) => serves(dest, service) && isState(dest) && isDesignated(dest)).map((dest) => dest.name);
    const character = designated.length
      ? ` Counted, though ${designated.length === 1 ? 'its board' : 'their boards'} may decline a student whose family does not accept the school's character: ${andList(designated)} (designated character; In zone leaves ${designated.length === 1 ? 'it' : 'them'} out).`
      : '';
    return `Counting ${thousands(c.state)} state ${plural} taught in English.${left}${character}${who} ${NO_ZONES}${listed}`;
  }
  // In zone: the state schools taught in English that must take a child living here.
  const z = zoneTally(destinations, service, zones, choice.students);
  const child = choice.students === 'girls' ? 'a girl' : choice.students === 'boys' ? 'a boy' : 'a child';
  const names = (ds) => andList(ds.map((d) => destinations[d].name));
  const parts = [];
  if (!z.zoned.length) {
    parts.push(`In zone: none of the ${thousands(z.open.length + z.no_map.length + z.not_applied.length + z.unclear_years.length)} state ${plural} taught in English here `
      + `that take ${child} has a home zone for these years, so each must take any student who applies, as under State.`);
  } else {
    const open = z.open.length ? ` and the ${thousands(z.open.length)} with no zone, which must take any student who applies` : '';
    parts.push(`In zone: state ${plural} taught in English that must take ${child} living here: the ${thousands(z.zoned.length)} whose home zone covers the home${open}.`);
  }
  if (z.no_map.length) {
    parts.push(`${names(z.no_map)} ${z.no_map.length === 1 ? 'has' : 'have'} an enrolment scheme but no zone in the Ministry's map file, so ${itThey(z.no_map.length)} for everyone.`);
  }
  if (z.not_applied.length) {
    parts.push(`${names(z.not_applied)} ${z.not_applied.length === 1 ? 'has a zone' : 'have zones'} in the Ministry's file but no enrolment scheme in the directory, so ${itThey(z.not_applied.length)} for everyone.`);
  }
  if (z.unclear_years.length) {
    parts.push(`The year levels of the zones of ${names(z.unclear_years)} could not be read, so ${itThey(z.unclear_years.length)} for everyone.`);
  }
  // Schools whose only zone in the file starts later: grouped by that date.
  const byDate = new Map();
  for (const d of z.upcoming) {
    const from = zoneDates(zones, destinations[d], d, service).from || '';
    byDate.set(from, [...(byDate.get(from) || []), d]);
  }
  for (const [from, ds] of byDate) {
    parts.push(ds.length === 1
      ? `${names(ds)}: the Ministry's file holds only its zone from ${longDay(from) || 'a later date'}, which is used.`
      : `${names(ds)}: the Ministry's file holds only their zones from ${longDay(from) || 'a later date'}, which are used.`);
  }
  parts.push(`Integrated, private and charter schools and kura are not counted: they enrol by their own rules${notCounted.length ? ` (${andList(notCounted)})` : ''}.`);
  const designated = (destinations || []).filter((dest) => serves(dest, service) && isState(dest) && isDesignated(dest));
  if (designated.length) {
    parts.push(`Nor ${designated.length === 1 ? 'is' : 'are'} ${andList(designated.map((dest) => dest.name))}: designated character ${designated.length === 1 ? 'school' : 'schools'}, whose board may decline a student whose family does not accept its character.`);
  }
  const source = (zones && zones.source) || meta.zone_source || {};
  const reference = (zones && zones.reference) || meta.zone_reference;
  if (source.version || reference) {
    parts.push(`Zones from the Ministry's file${source.version ? ` of ${longDay(source.version)}` : ''}${reference ? `, as in force on ${longDay(reference)}` : ''}.`);
  }
  if (splitPeople != null && splitPeople >= 0.5) {
    const away = outsideSet != null && outsideSet >= 0.5
      ? ` ${count(outsideSet)} of them live outside those zones, and are counted with the hexagon all the same.` : '';
    parts.push(`${count(splitPeople)} ${ages ? ages.many : 'people'} live in hexagons a zone line splits; each hexagon is counted with the zones most of its residents live in.${away}`);
  }
  return `${parts.join(' ')}${who}${listed}`;
}

/** Why a school has no zone that counts, as a clause: "it has no home zone". */
const NO_ZONE = {
  none: 'it has no home zone',
  no_map: "its zone is not in the Ministry's map file",
  not_applied: "the directory says it has no enrolment scheme, so the zone in the Ministry's file is not applied",
  unclear_years: 'the year levels of its zones could not be read',
  no_zone_for_years: 'its zone is for other years',
};

/** For a zoned state-integrated school: living in its zone is not by
 *  itself a right to enrol. Null for any other school. */
export function integratedZoneNote(dest) {
  if (!dest || dest.kind !== 'integrated') return null;
  return 'State-integrated: it takes children whose families accept its special character first; living in its zone does not by itself give a right to enrol.';
}

/** Why school d has no zone that counts for this service, as a sentence, or
 *  null where it has one (or the build has no zones). */
export function noZoneSentence(zones, dest, d, service) {
  if (!zones || !dest) return null;
  const status = zoneStatus(zones, dest, d, service);
  return ZONED.includes(status) ? null : `${capital(NO_ZONE[status] || NO_ZONE.none)}.`;
}

/** Facts about one school for the panel: kind, sex, years, roll, zone, where
 *  its times go to, and its Ministry number. `zones` is decodeZones' result
 *  (null in a build without them); `moved` is how far its point was moved,
 *  in metres, where the build corrected it. */
export function schoolFacts(dest, service, { zones = null, d = -1, moved = null } = {}) {
  if (!dest) return [];
  const kind = KIND_WORD[dest.kind] || dest.kind || 'kind not recorded';
  const sex = sexOf(dest, service);
  const bits = [capital(kind), SEX_WORD[sex] || (sex === 'co-ed' ? 'co-ed' : 'co-ed or single-sex not recorded')];
  const medium = mediumOf(dest);
  if (medium !== 'english') bits.push(capital(OTHER_MEDIUM[medium || 'unknown']) + (dest.language_source === 'peak_body' ? ' (from its peak body)' : ''));
  const years = Array.isArray(dest.years) ? dest.years : String(dest.years || '').match(/\d+/g);
  if (years && years.length >= 2) bits.push(`Years ${years[0]}–${years[years.length - 1]}`);
  if (Number.isFinite(Number(dest.roll)) && dest.roll != null) bits.push(`roll ${thousands(dest.roll)}${dest.roll_date ? ` (${day(dest.roll_date)})` : ''}`);
  const more = [];
  if (zones) {
    const z = zoneDates(zones, dest, d, service);
    if (z.status === 'in_force') {
      more.push(`Zone in force since ${longDay(z.from) || 'a date the file does not give'}.`);
      if (z.next) more.push(`A new zone starts on ${longDay(z.next)}; it is not applied.`);
    } else if (z.status === 'upcoming_used') {
      more.push(`The Ministry's file holds only its new zone, from ${longDay(z.from) || 'a later date'}, so that zone is used.`);
    } else {
      more.push(z.status === 'none' ? 'No enrolment scheme.' : `${capital(NO_ZONE[z.status] || NO_ZONE.none)}.`);
      if (z.next) more.push(`A zone starts on ${longDay(z.next)}; it is not applied.`);
    }
  } else if (dest.scheme === true) {
    more.push(dest.zone_from ? `Zone in force from ${day(dest.zone_from)}.` : 'Has an enrolment scheme; its zone is not in this build.');
  } else if (dest.scheme === false) {
    more.push('No enrolment scheme.');
  }
  const to = dest.routed_to;
  if (dest.point === 'corrected') {
    more.push(`Times go to a corrected point inside the school's grounds${Number(moved) > 0 ? `; the Ministry's map point is ${distance(Number(moved) / 1000)} away` : ''}.`);
  } else {
    more.push(Number(to) > 0
      ? `Times go to the nearest of ${to} checked ${Number(to) === 1 ? 'entrance' : 'entrances'}.`
      : "Times go to the Ministry's map point for the school.");
  }
  if (dest.moe != null) more.push(`Ministry number ${dest.moe}.`);
  return [bits.join(' · '), more.join(' ')];
}

/** Schools that teach a service whose name (or Ministry number) matches what
 *  was typed, best matches first. */
export function findSchools(destinations, service, query, limit = 8) {
  // Macrons fold, and Mount and Saint match the Ministry's Mt and St.
  const SAME = { mount: 'mt', saint: 'st' };
  const fold = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/'/g, '').split(/[^a-z0-9]+/).filter(Boolean).map((w) => SAME[w] || w);
  const words = fold(query);
  if (!words.length) return [];
  // One word of three or more letters may be initials: MAGS, EGGS, AGS.
  const initials = words.length === 1 && /^[a-z]{3,6}$/.test(words[0]) ? words[0] : null;
  const out = [];
  (destinations || []).forEach((dest, d) => {
    if (!serves(dest, service) || dest.moe == null) return;
    const parts = fold(dest.name);
    const name = parts.join(' ');
    const number = String(dest.moe);
    if (initials && parts.map((p) => p[0]).join('') === initials) {
      out.push([10, dest.name || '', d]);
      return;
    }
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

/** "250 m", "1.2 km": a straight-line distance, to 50 m or 0.1 km. The
 *  school points in destinations.json are rounded to about 10 m, so finer
 *  would claim more than the file holds. */
export function distance(km) {
  if (!Number.isFinite(km)) return '';
  return km < 0.975 ? `${Math.max(50, Math.round(km * 20) * 50)} m` : `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

/** When a public transport time was timed: "between 7am and 9am on Tuesday
 *  15 September 2026". The routing used one weekday's timetable, so it names
 *  the day rather than "weekdays". `spec` is a window from meta.windows. */
export function windowWords(spec, routingDate) {
  if (!spec || !/^\d{1,2}:\d{2}$/.test(String(spec.start || ''))) return null;
  const [h, m] = String(spec.start).split(':').map(Number);
  const end = h * 60 + m + Number(spec.minutes || 0);
  const clock = (mins) => {
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    if (hh === 12 && mm === 0) return 'midday';
    const twelve = hh % 12 === 0 ? 12 : hh % 12;
    return `${twelve}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${hh < 12 ? 'am' : 'pm'}`;
  };
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(spec.date || routingDate || ''));
  // Spelt out here rather than by the browser's locale, so every browser says the same.
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const when = date
    ? `${DAYS[new Date(Date.UTC(+date[1], +date[2] - 1, +date[3])).getUTCDay()]} ${Number(date[3])} ${FULL[Number(date[2]) - 1]} ${date[1]}`
    : null;
  return `between ${clock(h * 60 + m)} and ${clock(end)}${when ? ` on ${when}` : ''}`;
}

const HOW = { walk: 'on foot', walk_slow: 'on foot at the slower pace', bike_low_stress: 'by low-stress cycling', bike: 'cycling on any street', pt: 'by public transport', car: 'by car' };

/** "Mt Albert Grammar School, 15 min on foot" for one way of travelling from
 *  hexagon i, among the schools `ok` allows. With public transport, a time no
 *  quicker than walking is said as walking, which it is. */
export function nearestPhrase(reachByMode, mode, i, ok, { destinations, maxMinutes = 60, label = (d) => destinations[d]?.name || 'unnamed' } = {}) {
  const opts = { maxMinutes };
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
 *  zones, centres, maxMinutes, words, moved (metres a school's point was
 *  moved, by Ministry number) }. `named` is the schools the band names for
 *  `mode` in hexagon i. Returns a list of sentences. */
export function cardLines(ctx, mode, i, named = []) {
  const { destinations, service, choice, reach = {}, result = null, zones = null, maxMinutes = 60 } = ctx;
  const label = (d) => destinations[d]?.name || 'unnamed';
  const lines = [];
  const real = mode && mode !== 'best' ? (mode === 'walk_slow' ? 'walk' : mode) : null;
  // Whether school buses are in the timetable differs by place (meta.schools.school_buses).
  const buses = real === 'pt' && ctx.schoolBuses === false ? 'Dedicated school buses are not in the timetable used, so they are not counted.' : null;
  const done = () => (buses ? [...lines, buses] : lines);

  if (!choice || choice.kind === 'all') {
    // All: when the school named is not a state, English-medium co-ed school,
    // say what it is and give the nearest state school as well.
    const odd = named.filter((d) => tagOf(destinations[d], service));
    if (real && odd.length && reach[real]) {
      const state = (students) => (d) => isState(destinations[d]) && admits(destinations[d], service, students);
      const g = nearestPhrase(reach, real, i, state('girls'), { destinations, maxMinutes });
      const b = nearestPhrase(reach, real, i, state('boys'), { destinations, maxMinutes });
      // None by public transport may still be a walk: say so.
      const none = (students) => {
        const walk = real === 'pt' && reach.walk ? nearestPhrase(reach, 'walk', i, state(students), { destinations, maxMinutes }) : null;
        const base = `none within ${maxMinutes} min ${HOW[real] || ''}`.trim();
        return walk ? `${base}, though ${orList(walk.ds.map(label))} ${walk.ds.length > 1 ? 'are' : 'is'} ${Math.round(walk.m)} min on foot` : base;
      };
      // "State" here is what the State choice counts: taught in English.
      if (!g && !b) lines.push(`No state school taught in English within ${maxMinutes} min ${HOW[real] || ''}.`.replace(' .', '.'));
      else if (g && b && g.text === b.text) lines.push(`Nearest state school taught in English: ${g.text}.`);
      else {
        lines.push(`Nearest state school taught in English, for a girl: ${g ? g.text : none('girls')}.`);
        lines.push(`For a boy: ${b ? b.text : none('boys')}.`);
      }
    }
    return done();
  }

  if (choice.kind === 'one') {
    const d = schoolByMoe(destinations, service, choice.moe);
    if (d < 0) return lines;
    if (real === 'pt' && reach.pt) {
      const spread = minutesTo(reach.pt, i, d, maxMinutes);
      // A walk all the way takes the same time whenever you leave: the spread
      // is given only for a trip by bus or train.
      const flat = spread.lo === spread.hi && spread.hi === spread.m;
      const walk = reach.walk ? minutesTo(reach.walk, i, d, maxMinutes).m : NaN;
      const walked = Number.isFinite(walk) && walk <= spread.m;
      if (Number.isFinite(spread.lo) && Number.isFinite(spread.hi) && Number.isFinite(spread.m) && !flat && !walked) {
        const when = ctx.when ? ` ${ctx.when}` : '';
        lines.push(`By public transport, usually ${Math.round(spread.lo)}–${Math.round(spread.hi)} min, depending on when you leave${when} (10th to 90th percentile).`);
      }
    }
    if (zones) {
      if (isZoned(zones, destinations[d], d, service)) {
        const w = zoneShareAt(zones, i, d);
        if (w >= 0.995) lines.push('Inside its enrolment zone.');
        else if (w > 0) lines.push(`About ${Math.min(99, Math.max(1, Math.round(w * 100)))}% of the people here live inside its enrolment zone; a zone line crosses this hexagon.`);
        else lines.push('Outside its enrolment zone.');
        const note = integratedZoneNote(destinations[d]);
        if (note) lines.push(note);
      } else {
        lines.push(noZoneSentence(zones, destinations[d], d, service));
      }
    } else if (destinations[d].scheme === false) {
      lines.push('It has no enrolment scheme.');
    }
    if (real && reach[real] && reach[real].complete) {
      // The nearest other state school that takes the same students: a girl
      // at a girls' school, a boy at a boys' school, and for a co-ed school
      // one that takes girls and boys. Designated character schools, which
      // may decline a student, are left out, as under In zone.
      const own = sexOf(destinations[d], service);
      const sameStudents = (k) => {
        const sex = sexOf(destinations[k], service);
        return own === 'girls' || own === 'boys' ? sex === 'co-ed' || sex === own : sex === 'co-ed';
      };
      const ok = (k) => k !== d && isInZoneSchool(destinations[k]) && sameStudents(k);
      const other = nearestPhrase(reach, real, i, ok, { destinations, maxMinutes });
      const whom = own === 'girls' ? ' that takes girls' : own === 'boys' ? ' that takes boys' : ', co-ed';
      lines.push(other ? `Nearest other state school taught in English${whom}: ${other.text}.` : `No other state school taught in English${whom} within ${maxMinutes} min ${HOW[real] || ''}.`.replace(' .', '.'));
    }
    // Where the times end. A large site may have a gate much nearer.
    const to = destinations[d].routed_to;
    if (destinations[d].point === 'corrected') {
      const moved = ctx.moved ? ctx.moved[destinations[d].moe] : null;
      lines.push(`Times go to a corrected point inside the school's grounds${Number(moved) > 0 ? `; the Ministry's map point is ${distance(Number(moved) / 1000)} away` : ''}.`);
    } else if (!(Number(to) > 0)) {
      const centre = ctx.centres ? ctx.centres[i] : null;
      const far = centre && Number.isFinite(destinations[d].lat) ? ` (the pin, about ${distance(kmBetween(centre, destinations[d]))} away in a straight line)` : ' (the pin)';
      lines.push(`Times go to the Ministry's map point for the school${far}, not to its nearest gate.`);
    }
    return done();
  }

  // State and In zone: each group of students apart (girls and boys, and
  // Years 9–10 and 11–13 where secondary school is split) when they differ.
  // Best without a car takes each one's own fastest way.
  if (mode && result && Array.isArray(result.groups) && result.groups.length > 1) {
    const counting = ctx.standardModes || ['walk', 'bike_low_stress', 'pt'];
    const say = (s) => {
      let way = real;
      if (!way) {
        for (const m of counting) if (s.t[m] && Number.isFinite(s.t[m][i]) && !(s.t[m][i] >= (way ? s.t[way][i] : Infinity))) way = m;
      }
      const t = way && s.t[way] ? s.t[way][i] : NaN;
      if (!Number.isFinite(t)) {
        const base = `none within ${maxMinutes} min${way ? ` ${HOW[way] || ''}` : ' without a car'}`.trim();
        // None by public transport may still be a walk: say so.
        const walk = way === 'pt' && s.t.walk ? s.t.walk[i] : NaN;
        if (!Number.isFinite(walk)) return base;
        const ds = [s.near.walk[i], ...(s.ties.walk[i] || [])].filter((k) => k >= 0);
        return `${base}, though ${orList(ds.map(label))} ${ds.length > 1 ? 'are' : 'is'} ${Math.round(walk)} min on foot`;
      }
      let ds = [s.near[way][i], ...(s.ties[way][i] || [])].filter((k) => k >= 0);
      let how = HOW[way] || '';
      if (way === 'pt' && s.t.walk && s.t.walk[i] === t) {
        ds = [s.near.walk[i], ...(s.ties.walk[i] || [])].filter((k) => k >= 0);
        how = 'on foot';
      }
      return `${orList(ds.map(label))}, ${Math.round(t)} min ${how}`;
    };
    const who = (s) => {
      const sex = s.students === 'girls' ? 'a girl' : s.students === 'boys' ? 'a boy' : null;
      const stage = s.stage ? STAGE_WORDS[s.stage] : null;
      const text = sex && stage ? `${sex} in ${stage}` : sex || stage || 'a student';
      return capital(text);
    };
    const said = result.groups.map((s) => [who(s), say(s)]);
    if (said.every(([, text]) => text === said[0][1])) {
      if (!real) lines.push(`Nearest: ${said[0][1]}.`);
    } else {
      lines.push(said.map(([w, text]) => `For ${w[0].toLowerCase()}${w.slice(1)}: ${text}.`).join(' ').replace(/For years/g, 'For Years'));
    }
  }

  // In zone, where a zone line splits the hexagon: whose times these are.
  if (choice.kind === 'zone' && zones && zones.split && zones.split[i]) {
    const first = named.length ? named[0] : -1;
    const w = first >= 0 && isZoned(zones, destinations[first], first, service) ? zoneShareAt(zones, i, first) : 0;
    lines.push(w > 0 && w < 1
      ? `A zone line crosses this hexagon: ${Math.min(99, Math.max(1, Math.round(w * 100)))}% of its residents live in ${possessive(label(first))} zone; times are for them.`
      : 'A zone line crosses this hexagon; times are for the zones most of its residents live in.');
  }

  // The nearer schools this choice leaves out, so a reader can see why the
  // figure differs from All. A short list (by car) does not hold them all.
  if (real && reach[real] && reach[real].complete) {
    const shown = named.length && Number.isFinite(ctx.shownMinutes) ? ctx.shownMinutes : Infinity;
    const counted = (d) => {
      const dest = destinations[d];
      if (!counts(dest, service, choice)) return false;
      if (choice.kind === 'zone' && isZoned(zones, dest, d, service)) return inZone(zones, i, d);
      return true;
    };
    const left = reachAt(reach[real], i, maxMinutes).filter((r) => r.m < shown && !counted(r.d)).slice(0, 3);
    if (left.length) {
      const why = (d) => {
        const dest = destinations[d];
        const tag = tagOf(dest, service);
        if (choice.kind === 'zone' && isState(dest) && admits(dest, service, choice.students)) return tag ? `${tag}, out of zone` : 'out of zone';
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
 *  number, and the choice and data dates in a header.
 *
 *  `residents` is everyone living in each hexagon (`pop` in older calls);
 *  `children`, where the figures count children, is how many of the
 *  service's ages live there, written as `childrenColumn`; `include` says
 *  which hexagons get a row (by default those with residents). Numbers have
 *  one decimal place, except a share of residents in a zone, which has the
 *  three zones.json gives it. */
export function schoolsCsv({
  h3, residents = null, pop = null, children = null, childrenColumn = null, include = null,
  placeNames, t, near, ties, destinations, modes, header = [], extra = {},
}) {
  const people = residents || pop;
  const quote = (v) => (/[",\n#]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const value = (v, digits = 1) => (Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : '');
  const DIGITS = { zone_share: 3 };
  const moeOf = (mode, i) => {
    const first = near[mode] ? near[mode][i] : -1;
    if (first == null || first < 0) return '';
    return [first, ...((ties[mode] || {})[i] || [])].map((d) => destinations[d]?.moe ?? '').join('|');
  };
  const extraKeys = Object.keys(extra);
  const kids = children && childrenColumn ? [childrenColumn] : [];
  const head = ['h3', 'suburb', 'residents', ...kids, ...modes.flatMap((m) => [`minutes_${m}`, `moe_${m}`]), ...extraKeys];
  const lines = header.map((line) => `# ${line}`);
  lines.push(head.join(','));
  for (let i = 0; i < h3.length; i += 1) {
    if (include ? !include[i] : !(people[i] > 0)) continue;
    const cells = [h3[i], quote(placeNames[i] || ''), value(people[i])];
    if (kids.length) cells.push(value(children[i]));
    for (const m of modes) cells.push(value(t[m] ? t[m][i] : NaN), moeOf(m, i));
    for (const key of extraKeys) {
      const v = extra[key][i];
      cells.push(typeof v === 'number' ? value(v, DIGITS[key]) : quote(v ?? ''));
    }
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** The CSV's line for public transport: what minutes_pt is. `ptOrWalk` for
 *  a build where public transport is the quicker of the trip and the walk. */
export function ptCsvLine(when, ptOrWalk) {
  const window = when || 'in the usual window';
  return ptOrWalk
    ? `Public transport, or walking where that is quicker: minutes_pt is the lower of the public transport time (minutes_pt_r5, the median of trips leaving each minute ${window}) and minutes_walk.`
    : `Public transport: the median of trips leaving each minute ${window}, on that day's timetable. A walk all the way counts as a public transport trip only up to 15 minutes, so minutes_pt can be more than minutes_walk.`;
}

// ---------------------------------------------------------------- stops near a school
//
// schools/stops.json, format 1 (docs/schools.md "Stops near a school"):
// {format, date, window: [start, end], max_walk_minutes, gtfs, stops: [{id,
// code, name, station, lat, lon}], schools: {"<dest index>": [{s, walk,
// metres, routes: [{route, mode, headsigns, trips}], trips}]}}. Loaded only
// under One school.

/** The stops file as the page uses it, or null when it is not one it reads. */
export function decodeStops(json) {
  if (!json || json.format !== 1 || !Array.isArray(json.stops) || !json.schools || typeof json.schools !== 'object') return null;
  const window = Array.isArray(json.window) && json.window.length === 2 ? json.window : null;
  return {
    date: typeof json.date === 'string' ? json.date : null,
    // 'arrivals' from 0.12.0 round 2: trips setting down there in the window.
    counts: typeof json.counts === 'string' ? json.counts : null,
    window,
    maxWalk: Number.isFinite(json.max_walk_minutes) ? json.max_walk_minutes : 15,
    gtfs: typeof json.gtfs === 'string' ? json.gtfs : null,
    stops: json.stops,
    schools: json.schools,
  };
}

/** School d's stops, quickest walk first, or null where the file does not
 *  cover it ([] where it does and there are none). */
export function stopsAt(stops, d) {
  if (!stops || d == null || d < 0) return null;
  const rows = stops.schools[d] || stops.schools[String(d)];
  if (!Array.isArray(rows)) return null;
  return rows.filter((row) => row && stops.stops[row.s])
    .sort((a, b) => a.walk - b.walk || (a.metres ?? 0) - (b.metres ?? 0));
}

const clockOf = (text) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(text || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The window as minutes from midnight, the end the minute after the last
 *  departure counted (08:59 is up to 9am). */
function stopWindow(stops) {
  const start = clockOf(stops && stops.window ? stops.window[0] : '07:00');
  const last = clockOf(stops && stops.window ? stops.window[1] : '08:59');
  return { start: start ?? 420, end: (last ?? 539) + 1 };
}

const hourWord = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return { n: `${twelve}${m ? `:${String(m).padStart(2, '0')}` : ''}`, half: h < 12 ? 'am' : 'pm' };
};

/** "7–9am", or "7am-9am" with `ascii`. */
export function stopHours(stops, { ascii = false } = {}) {
  const { start, end } = stopWindow(stops);
  const a = hourWord(start);
  const b = hourWord(end);
  if (ascii) return `${a.n}${a.half}-${b.n}${b.half}`;
  return a.half === b.half ? `${a.n}–${b.n}${b.half}` : `${a.n}${a.half}–${b.n}${b.half}`;
}

/** What the section says first. */
export function stopsIntro(stops) {
  const { start, end } = stopWindow(stops);
  const when = windowWords({ start: `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`, minutes: end - start, date: stops && stops.date }, null);
  const arriving = stops && stops.counts === 'arrivals';
  return `Stops and stations within a ${stops ? stops.maxWalk : 15}-minute walk of the school's map point, on the street network. `
    + `${arriving ? 'Buses and trains arriving' : 'Buses and trains stopping'} ${when || 'in the morning window'}${arriving ? ', where students can get off' : ''}.`;
}

/** A stop's name as the section lists it: the station for a platform, with
 *  the stop number where there is one. */
/** A stop's name. The build groups a station's platforms under the station:
 *  `station` true and the station's name (an older file gave the station's
 *  name in `station`). */
function stopTitle(stop) {
  return (typeof stop.station === 'string' && stop.station) || stop.name || 'Unnamed stop';
}

/** With its stop number wherever the feed gives one, a station's too:
 *  Auckland's bus interchange bays are stations, and three near Mt Albert
 *  Grammar School are all called St Lukes. */
function stopName(stop) {
  return stop.code ? `${stopTitle(stop)} (stop ${stop.code})` : stopTitle(stop);
}

/** "Mount Albert Grammar School (stop 1427) · 1 min walk · 14 trips arriving 7–9am · 22N, 22R". */
export function stopLine(row, stops) {
  const stop = stops.stops[row.s];
  const hours = stopHours(stops);
  const trips = Number(row.trips) || 0;
  const routes = (row.routes || []).map((r) => r.route).filter(Boolean);
  const shown = routes.length > 6 ? `${routes.slice(0, 6).join(', ')} and ${routes.length - 6} more` : routes.join(', ');
  const arriving = stops.counts === 'arrivals' ? ' arriving' : '';
  return [
    stopName(stop),
    `${row.walk} min walk`,
    trips ? `${thousands(trips)} ${trips === 1 ? 'trip' : 'trips'}${arriving} ${hours}`
      : stop.served === false ? 'no trips on any day in the timetable used' : `no trips${arriving} ${hours} in the timetable used`,
    shown || null,
  ].filter(Boolean).join(' · ');
}

/** The lines the One school CSV starts with about the stops. */
export function stopsCsvLines(stops, d) {
  const rows = stopsAt(stops, d);
  if (!rows) return [];
  const { start, end } = stopWindow(stops);
  const when = windowWords({ start: `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}`, minutes: end - start, date: stops.date }, null) || '';
  const day = when.replace(/^between .* on /, '');
  const verb = stops.counts === 'arrivals' ? 'arriving' : 'stopping';
  const out = [`Stops within a ${stops.maxWalk}-minute walk of the school's map point (walking minutes on the street network, rounded down; trips ${verb} ${stopHours(stops, { ascii: true })}${day ? ` on ${day}` : ''}${stops.gtfs ? `, ${stops.gtfs}` : ''}):`];
  if (!rows.length) out.push(`No stop within a ${stops.maxWalk}-minute walk.`);
  for (const row of rows) {
    const stop = stops.stops[row.s];
    const modes = [...new Set((row.routes || []).map((r) => r.mode).filter(Boolean))];
    const byRoute = (row.routes || []).map((r) => `${r.route} ${r.trips}`).join(', ');
    const none = stop.served === false ? ' (none on any day in the timetable)' : '';
    const what = modes.join('/') || (stop.served === false ? 'no service' : 'no trips in window');
    out.push(`stop ${stop.code || stop.id} ${stopTitle(stop)}: ${what}, ${row.walk} min walk, ${Number(row.trips) || 0} ${Number(row.trips) === 1 ? 'trip' : 'trips'} ${verb}${byRoute ? ` (${byRoute})` : ''}${none}`);
  }
  return out;
}
