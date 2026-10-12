// MATE in the hexagon card: how far each mobility profile gets on foot and by
// public transport, what is in the way, and the catchment on the map.
//
// Only behind ?mate=1, and only where MATE has data (Auckland). app.js imports
// this module the first time a hexagon is clicked, and the data follows: two
// files for the whole place, then one small file per resolution 6 area
// (MATE docs/team_export.md describes them all).

/* global h3 */

import { fetchJson } from './data.js';
import { fold } from './fold.js';
import { count, el } from './format.js';

export const PLACES = ['auckland'];

// The profiles in MATE's order, with a short name for the table and the group
// of residents each most nearly describes. The cargo bike has none.
// `tag` names a profile in a fold's summary line.
export const PROFILES = [
  { key: 'walk', short: 'Walking', tag: 'walking' },
  { key: 'older_walker', short: 'Older walker', tag: 'older walker', night: 'older_walker_night', group: 'older' },
  { key: 'manual_wheelchair', short: 'Manual wheelchair', tag: 'wheelchair', group: 'disabled' },
  { key: 'powered_chair_scooter', short: 'Powered chair or scooter', tag: 'scooter', group: 'disabled' },
  { key: 'pram', short: 'Pram or buggy', tag: 'pram', group: 'under5' },
  { key: 'child', short: 'Child on their own', tag: 'child', night: 'child_night', group: 'kids' },
  { key: 'cargo_bike', short: 'Cargo bike', tag: 'cargo bike' },
];
export const DEFAULT_PROFILE = 'manual_wheelchair';
const GROUP_LABEL = { older: '65+', kids: 'under 15', under5: 'under 5', disabled: 'disabled' };

// The map's colours for each status, as on MATE's own map: blue, orange, dark red and grey, checked for colour-blind
// readers there (MATE tests/test_palette.py). Not known is hatched in the bar (team.css).
export const STATUS = [
  { key: 'p', label: 'no known barrier', colour: '#3b7fb6' },
  { key: 'h', label: 'harder', colour: '#e8890c' },
  { key: 'u', label: 'not known', colour: '#8a938d' },
  { key: 'b', label: 'barrier', colour: '#a8172b' },
];

// The catchment: 5, 10 and 15 minutes in TEAM's blues, darker is quicker, and
// a light orange under a hatch for what walking reaches and the profile does not.
export const CATCHMENT = ['#184f95', '#3987e5', '#9ec5f4', '#fbe3d6'];
export const LOST = 3;

const VIEW_PHRASE = {
  nkb: 'no known barrier: what is not recorded counts as passable',
  cautious: 'cautious: what is not recorded takes three times as long',
};
const CAUTIOUS = 'if unrecorded parts take three times as long';

// ---------------------------------------------------------------- pure parts

export function profileOf(key) {
  return PROFILES.find((p) => p.key === key) || PROFILES.find((p) => p.key === DEFAULT_PROFILE);
}

/** The variant MATE's files use for a profile: its after-dark one when there is one and it is dark. */
export function variantOf(profile, dark) {
  const p = profileOf(profile);
  return dark && p.night ? p.night : p.key;
}

/** `o=` and `mp=` in the address: the cell, and the profile, after dark and the map's view. */
export function readMateHash(params) {
  const out = { cell: null, profile: DEFAULT_PROFILE, dark: false, view: 'nkb', map: true };
  const cell = params.get('o');
  if (cell && /^[0-9a-f]{15}$/.test(cell)) out.cell = cell;
  const [profile, flags = ''] = (params.get('mp') || '').split('.');
  if (PROFILES.some((p) => p.key === profile)) out.profile = profile;
  out.dark = flags.includes('d');
  if (flags.includes('c')) out.view = 'cautious';
  if (flags.includes('x')) out.map = false;
  return out;
}

export function mateHash(mate) {
  const flags = `${mate.dark ? 'd' : ''}${mate.view === 'cautious' ? 'c' : ''}${mate.map ? '' : 'x'}`;
  return flags ? `${mate.profile}.${flags}` : mate.profile;
}

/** "13, or 10": the no-known-barrier figure, then the cautious one when it differs. */
export function range(top, bottom, unit = '') {
  if (top == null) return '–';
  const a = `${top}${unit}`;
  if (bottom == null) return `${a}, or none`;
  return bottom === top ? a : `${a}, or ${bottom}${unit}`;
}

/** The same for minutes, where the cautious figure is the larger: "4, or 6". Beyond 30 is "–". */
export function minutesRange(nkb, cautious, unit = '') {
  if (nkb == null) return '–';
  if (cautious == null) return `${nkb}${unit}, or over 30`;
  return cautious === nkb ? `${nkb}${unit}` : `${nkb}${unit}, or ${cautious}${unit}`;
}

/** One origin's entries in a reach or stops block: n counts them, origin after origin. */
export function entries(block, k, key = 'c') {
  let start = 0;
  for (let j = 0; j < k; j += 1) start += block.n[j];
  const end = start + (block.n[k] || 0);
  return { ids: block[key].slice(start, end), minutes: block.m.slice(start, end) };
}

/** Map classes for a catchment: 0, 1, 2 for 5, 10 and 15 minutes, LOST for a hexagon walking reaches and the
 *  profile does not, -1 elsewhere. Also the minutes each way, for the tooltip. */
export function catchment(shard, cell, variant, view, n) {
  const k = shard.cells.indexOf(cell);
  const classes = new Int8Array(n).fill(-1);
  if (k < 0) return null;
  const mine = entries(shard.r[variant][view], k);
  const walk = entries(shard.r.walk[view], k);
  const minutes = new Map();
  mine.ids.forEach((c, j) => {
    const m = mine.minutes[j];
    minutes.set(c, m);
    classes[c] = m <= 5 ? 0 : m <= 10 ? 1 : 2;
  });
  const walking = new Map();
  const lost = [];
  walk.ids.forEach((c, j) => {
    walking.set(c, walk.minutes[j]);
    if (!minutes.has(c)) {
      classes[c] = LOST;
      lost.push(c);
    }
  });
  return { classes, minutes, walking, lost };
}

export function statusShares(cm, i, variant) {
  if (cm.km[i] == null) return null;
  return Object.fromEntries(STATUS.map((s) => [s.key, cm[`${s.key}_${variant}`]?.[i] ?? null]));
}

/** The crossings in a hexagon by what is known of their kerbs, recorded first; then what routing assumes:
 *  street junctions taken as crossings, and sidewalk ends joined, both with kerbs not recorded. */
export function kerbs(cm, i) {
  const get = (k) => cm[`x_${k}`]?.[i] ?? 0;
  const out = {
    ok: get('ok'), raised: get('raised'), rolled: get('rolled'), okEst: get('ok_est'), raisedEst: get('raised_est'),
    part: get('part'), unknown: get('unknown'), main: get('main'), mainNoSignals: get('main_no_signals'),
    junctions: get('junction'), joins: get('join'),
  };
  out.recorded = out.ok + out.raised + out.rolled;
  out.estimated = out.okEst + out.raisedEst;
  out.total = out.recorded + out.estimated + out.part + out.unknown;
  return out;
}

/** The street centre line routing follows where no footpath is drawn, and its status shares for a variant. */
export function streets(cm, i, variant) {
  const km = cm.kst?.[i];
  if (km == null || km <= 0) return null;
  return { km, shares: Object.fromEntries(STATUS.map((s) => [s.key, cm[`s${s.key}_${variant}`]?.[i] ?? null])) };
}

/** Footpath narrower than a profile's width limit, % of it: recorded (a barrier) and estimated (harder).
 *  Null for a profile with no limit. */
export function narrow(cm, i, profile) {
  const limit = cm.meta?.width_limits?.[profile];
  if (!limit || cm.km[i] == null) return null;
  const key = `wu${Math.round(limit * 100)}`;
  return { limit, recorded: cm[`${key}r`]?.[i] ?? 0, estimated: cm[`${key}e`]?.[i] ?? 0 };
}

/** Lighting on the hexagon's footpath, % of it: recorded (lit or not lit), estimated (probably lit, probably not
 *  lit), not known. police: the export has MATE's estimates from police notes at crashes after dark (l4). */
export function lighting(cm, i) {
  if (cm.km[i] == null) return null;
  const v = (k) => cm[k]?.[i] ?? 0;
  return {
    lit: v('l1'), notLit: v('l3'), recorded: v('l1') + v('l3'), probably: v('l2'), probablyNot: v('l4'), unknown: v('l0'),
    lamps: v('lamps'), police: Boolean(cm.l4),
  };
}

/** A hexagon's footpath for a profile, in one line: "1.3 km of footpath: 54% no known barrier, 18% harder, …".
 *  Null where MATE has no footpath data. `core` is what request() returns as core. */
export function footLine(core, i, profile, dark = false) {
  const cm = core?.cells;
  if (!cm || cm.km[i] == null) return null;
  const shares = statusShares(cm, i, variantOf(profile, dark));
  const words = STATUS.filter((s) => (shares[s.key] || 0) > 0).map((s) => `${shares[s.key]}% ${s.label}`);
  return `${cm.km[i].toFixed(cm.km[i] < 10 ? 1 : 0)} km of footpath: ${words.join(', ')}.`;
}

/** Whether MATE has footpath data for a hexagon: footpath counted in it, or times from it. */
export function hasData(core, i) {
  const cm = core?.cells;
  return Boolean(cm && (cm.km[i] != null || cm.o[i] != null));
}

export function servicesIn(bits, services) {
  if (bits == null) return [];
  return services.filter((_, k) => (bits >> k) & 1);
}

/** The public transport window: the one on screen if MATE has it, else the one TEAM's jobs line above is in,
 *  else off-peak. */
export function ptWindow(when, windows, usual = null) {
  if (windows.includes(when)) return when;
  if (windows.includes(usual)) return usual;
  return windows.includes('interpeak') ? 'interpeak' : windows[0];
}

/** Everything the card says about one hexagon, as plain values. */
export function cardFigures(mate, i, { profile, dark, when, urban, jobsWindow = null, teamJobs = null }) {
  const cm = mate.cells;
  const tm = mate.times;
  const row = cm.o[i];
  const variants = PROFILES.map((p) => ({ ...p, variant: variantOf(p.key, dark) }));
  const time = (variant, view, target) => (row == null ? null : tm.t[variant]?.[view]?.[target]?.[row] ?? null);
  const near = (variant, view, target) => {
    const k = row == null ? null : tm.near?.[variant]?.[view]?.[target]?.[row];
    return k == null ? null : { name: tm.near_stops.name[k], code: tm.near_stops.code[k], kind: tm.near_stops.kind[k] };
  };
  const rows = variants.map((p) => ({
    key: p.key,
    variant: p.variant,
    short: p.short,
    night: p.variant !== p.key,
    group: p.group ? { key: p.group, label: GROUP_LABEL[p.group], share: cm[p.group]?.[i] ?? null } : null,
    reach: { nkb: cm[`r_${p.variant}_nkb`]?.[i] ?? null, cautious: cm[`r_${p.variant}_cautious`]?.[i] ?? null, known: cm[`r_${p.variant}_known`]?.[i] ?? null },
    stop: { nkb: time(p.variant, 'nkb', 'stop'), cautious: time(p.variant, 'cautious', 'stop') },
    frequent: { nkb: time(p.variant, 'nkb', 'frequent_stop'), cautious: time(p.variant, 'cautious', 'frequent_stop') },
    nearStop: { nkb: near(p.variant, 'nkb', 'stop'), cautious: near(p.variant, 'cautious', 'stop') },
  }));
  const chosen = rows.find((r) => r.key === profile) || rows.find((r) => r.key === DEFAULT_PROFILE);
  const services = (tm.meta.targets || []).filter((t) => !['stop', 'frequent_stop', 'station'].includes(t))
    .map((t) => ({ key: t, nkb: time(chosen.variant, 'nkb', t), cautious: time(chosen.variant, 'cautious', t) }));

  // Public transport is timed by day, so it uses the daytime profile.
  const pt = cm.meta.pt;
  let transit = null;
  if (pt && cm.pt) {
    const window = ptWindow(when, pt.windows, jobsWindow);
    const ptRows = rows.filter((r) => pt.variants.includes(r.key)).map((r) => {
      const at = (view, field) => cm.pt[window]?.[r.key]?.[view]?.[field]?.[row] ?? null;
      return {
        key: r.key,
        short: r.short,
        stop: near(r.key, 'nkb', 'stop'),
        stopMinutes: time(r.key, 'nkb', 'stop'),
        cells: { nkb: at('nkb', 'c'), cautious: at('cautious', 'c') },
        jobs: { nkb: at('nkb', 'j'), cautious: at('cautious', 'j') },
        services: { nkb: at('nkb', 's'), cautious: at('cautious', 's') },
      };
    });
    const any = ptRows.some((r) => r.cells.nkb != null);
    transit = {
      window,
      rows: ptRows,
      state: row == null ? 'no-origin' : !urban ? 'not-urban' : any ? 'ok' : 'no-trip',
      servicesTotal: pt.services.length,
      services: pt.services,
      jobsTotal: pt.jobs_total,
      // TEAM's own figure for walking to public transport, when it is for the same window.
      team: window === jobsWindow && Number.isFinite(teamJobs) ? teamJobs : null,
    };
  }
  return {
    row,
    km: cm.km[i],
    notSeen: cm.km_not_seen?.[i] ?? null,
    rows,
    chosen,
    services,
    shares: statusShares(cm, i, chosen.variant),
    streets: streets(cm, i, chosen.variant),
    steps: cm.steps?.[i] ?? null,
    steep: cm.m12?.[i] ?? null,
    noSlope: cm.g0?.[i] ?? null,
    width: cm.km[i] == null ? null : { recorded: cm.wr[i] ?? 0, none: cm.w0[i] ?? 0, narrow: narrow(cm, i, chosen.key) },
    kerbs: kerbs(cm, i),
    light: lighting(cm, i),
    transit,
  };
}

// ---------------------------------------------------------------- loading

const store = { base: null, core: null, coreLoading: null, error: null, shards: new Map(), shardLoading: new Set() };

export function shardOf(id) {
  return h3.cellToParent(id, 6);
}

/** Start whatever this hexagon needs and has not been fetched; `ready` is called as each part arrives.
 *  Returns what is in hand now. */
export function request(base, id, ready) {
  if (store.base !== base) {
    Object.assign(store, { base, core: null, coreLoading: null, error: null, shards: new Map(), shardLoading: new Set() });
  }
  if (!store.core && !store.coreLoading && !store.error) {
    store.coreLoading = Promise.all([fetchJson(`${base}mate/`, 'cells_mate'), fetchJson(`${base}mate/`, 'times')])
      .then(([cells, times]) => {
        store.core = { cells, times };
        store.coreLoading = null;
        ready();
      })
      .catch((error) => {
        store.error = error;
        store.coreLoading = null;
        console.warn('MATE data could not be loaded.', error);
        ready();
      });
  }
  const shard = id && store.core?.cells.meta.shards.includes(shardOf(id)) ? shardOf(id) : null;
  if (shard && !store.shards.has(shard) && !store.shardLoading.has(shard)) {
    store.shardLoading.add(shard);
    fetchJson(`${base}mate/reach/`, shard).then((body) => {
      store.shards.set(shard, body);
      store.shardLoading.delete(shard);
      ready();
    }).catch((error) => {
      store.shardLoading.delete(shard);
      console.warn('A MATE catchment could not be loaded.', error);
    });
  }
  return { core: store.core, error: store.error, shard: shard ? store.shards.get(shard) || null : null };
}

// ---------------------------------------------------------------- the map

/** The catchment to paint for the selected hexagon, or null to leave TEAM's map. */
export function catchmentModel(got, i, mate, n) {
  if (!got.core || !got.shard || !mate.map) return null;
  const variant = variantOf(mate.profile, mate.dark);
  const c = catchment(got.shard, i, variant, mate.view, n);
  if (!c) return null;
  const profileName = profileOf(mate.profile).short;
  const walkName = 'Walking';
  return {
    ...c,
    colours: CATCHMENT,
    tooltip: (j) => {
      const mine = c.minutes.get(j);
      const walk = c.walking.get(j);
      if (mine != null) return [`${profileName}: ${mine} min`, variant !== 'walk' && walk != null ? `${walkName}: ${walk} min` : null].filter(Boolean);
      if (walk != null) return [`${walkName}: ${walk} min`, `${profileName}: not within 15 min`];
      return ['Not within 15 min on foot'];
    },
    key: {
      title: `${profileName}${variant !== mate.profile ? ', after dark' : ''}: from the selected hexagon`,
      // Each row: label, class, and a short label for the strip a phone shows.
      rows: [['5 min or less', 0, '5'], ['6 to 10 min', 1, '10'], ['11 to 15 min', 2, '15 min'],
        ...(c.lost.length ? [['Walking reaches, this profile does not', LOST, 'walking only']] : [])],
      note: VIEW_PHRASE[mate.view],
    },
  };
}

// ---------------------------------------------------------------- the card

function note(text) {
  return el('p', 'note', text);
}

function chipGroup(id, label, options, current, pick) {
  const group = el('div', 'chips chips-compact mate-chips');
  group.id = id;
  group.dataset.group = id;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const button = el('button', 'chip', text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    button.dataset.value = value;
    button.addEventListener('click', () => pick(value));
    group.append(button);
  }
  return group;
}

function statusBar(shares) {
  const bar = el('div', 'mate-bar');
  bar.setAttribute('role', 'img');
  const words = [];
  for (const s of STATUS) {
    const v = shares[s.key] || 0;
    if (v <= 0) continue;
    const part = el('span', `mate-bar-part is-${s.key}`);
    part.style.width = `${v}%`;
    part.style.backgroundColor = s.colour;
    bar.append(part);
    words.push(`${v}% ${s.label}`);
  }
  bar.setAttribute('aria-label', words.join(', '));
  return { bar, words };
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function kerbLine(k) {
  let mapped = 'No crossings mapped in this hexagon.';
  if (k.total) {
    const parts = [];
    if (k.recorded) parts.push(`${k.recorded} recorded (${[k.ok ? `${k.ok} lowered or flush` : '', k.raised ? `${k.raised} raised` : '', k.rolled ? `${k.rolled} rolled` : ''].filter(Boolean).join(', ')})`);
    else parts.push('none recorded');
    if (k.estimated) parts.push(`${k.estimated} estimated from photos (${[k.okEst ? `${k.okEst} lowered` : '', k.raisedEst ? `${k.raisedEst} raised` : ''].filter(Boolean).join(', ')})`);
    const unknown = k.part + k.unknown;
    if (unknown) parts.push(`${unknown} not known${k.part ? `, ${k.part} of them read only in part` : ''}`);
    mapped = `Kerbs at ${plural(k.total, 'mapped crossing', 'mapped crossings')}: ${parts.join('; ')}.`;
  }
  // What routing assumes on top of the mapped crossings, which the cautious figure counts against.
  const assumed = [];
  if (k.junctions) assumed.push(`${plural(k.junctions, 'street junction', 'street junctions')} with no crossing mapped ${k.junctions === 1 ? 'counts' : 'count'} as ${k.junctions === 1 ? 'a crossing' : 'crossings'}`);
  if (k.joins) assumed.push(`${plural(k.joins, 'footpath that stops', 'footpaths that stop')} just short of another ${k.joins === 1 ? 'is' : 'are'} joined to it`);
  return assumed.length ? `${mapped} Assumed: ${assumed.join('; ')}, with kerbs not recorded.` : mapped;
}

function lightLine(l) {
  const recorded = l.recorded
    ? `Recorded on ${l.recorded}% of footpath here (${l.lit}% lit, ${l.notLit}% not lit)`
    : 'Not recorded on any footpath here';
  const from = l.police ? 'mapped lamps or police notes at crashes after dark' : 'mapped lamps';
  const rest = [
    l.probably ? `probably lit ${l.probably}% (estimated from ${from})` : '',
    l.probablyNot ? `probably not lit ${l.probablyNot}% (estimated from police notes)` : '',
    l.unknown ? `not known ${l.unknown}%` : '',
  ].filter(Boolean).join('; ');
  const lamps = l.lamps ? `${l.lamps} street ${l.lamps === 1 ? 'lamp' : 'lamps'} mapped.` : 'No street lamps mapped.';
  return `${recorded}${rest ? `; ${rest}` : ''}. ${lamps}`;
}

function table(className, headers, rows, caption) {
  const t = el('table', `mate-table ${className}`);
  if (caption) t.append(el('caption', 'visually-hidden', caption));
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach((h, k) => {
    const th = el('th', k ? 'num' : null, h);
    th.scope = 'col';
    tr.append(th);
  });
  thead.append(tr);
  const body = el('tbody');
  for (const r of rows) body.append(r);
  t.append(thead, body);
  return t;
}

function dateText(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The section for the card, as a fold. `ctx`: base, city, placeName, i, id (its H3 index), urban, when and
 *  windows (TEAM's), jobsWindow and teamJobs (the window and share of TEAM's public transport jobs line), mate
 *  (profile, dark, view, map), serviceNames, set (to change the MATE settings), ready (to draw again when data
 *  arrives), key (the prefix for its folds).
 *
 *  The fold opens on the profile picker and after dark, the headline for the profile and its footpath status bar;
 *  everything else is folded inside it, each part with its own line. */
export function section(ctx) {
  const key = `${ctx.key || 'card'}-mate`;
  const title = [document.createTextNode('On foot, by profile '), el('span', 'badge is-preview', 'MATE preview')];
  const box = (summary, children) => {
    const out = fold(key, title, summary, children);
    out.id = 'mate-section';
    out.classList.add('mate');
    return out;
  };
  if (!PLACES.includes(ctx.city)) return box(null, [note(`MATE has no footpath data for ${ctx.placeName} yet.`)]);
  const got = request(ctx.base, ctx.id, ctx.ready);
  if (got.error) return box(null, [note('MATE data could not be loaded. Reload the page to try again.')]);
  if (!got.core) return box('loading', [note('Loading MATE…')]);
  const cm = got.core.cells;
  const i = ctx.i;
  if (cm.km[i] == null && cm.o[i] == null) return box(null, [note('MATE has no footpath data for this hexagon yet.')]);
  const f = cardFigures(got.core, i, {
    profile: ctx.mate.profile, dark: ctx.mate.dark, when: ctx.when, urban: ctx.urban, jobsWindow: ctx.jobsWindow, teamJobs: ctx.teamJobs,
  });
  const chosen = f.chosen;
  const who = `${chosen.short.toLowerCase()}${chosen.night ? ' after dark' : ''}`;
  const parts = [note('A preview for checking. Only Devonport has been checked on the ground.')];

  // Profile and after dark, at the top.
  const controls = el('div', 'mate-controls');
  const label = el('label', 'mate-field');
  label.append(el('span', 'field-label', 'Profile'));
  const select = el('select', 'select');
  select.id = 'mate-profile';
  for (const p of PROFILES) {
    const option = el('option', null, p.short);
    option.value = p.key;
    option.selected = p.key === chosen.key;
    select.append(option);
  }
  select.addEventListener('change', () => ctx.set({ profile: select.value }));
  label.append(select);
  const dark = el('label', 'check mate-dark');
  const box2 = document.createElement('input');
  box2.type = 'checkbox';
  box2.id = 'mate-dark';
  box2.checked = ctx.mate.dark;
  box2.addEventListener('change', () => ctx.set({ dark: box2.checked }));
  dark.append(box2, document.createTextNode(' After dark'));
  controls.append(label, dark);
  parts.push(controls);
  if (ctx.mate.dark) {
    const unlit = cm.l4 ? 'tagged not lit, or probably not lit from police notes,' : 'tagged not lit';
    parts.push(note(`After dark changes the older walker and the child only: footpaths ${unlit} count as harder, and those with no lighting recorded as not known.`));
  }

  // The headline for the chosen profile, and its footpath here.
  let summary = null;
  if (f.row == null) {
    parts.push(note('This hexagon\'s footpaths do not join the rest of MATE\'s network within 175 m of its centre, so it has no times.'));
  } else {
    const walk = f.rows[0];
    const hero = el('p', 'mate-hero');
    const top = chosen.reach.nkb;
    const bottom = chosen.reach.cautious;
    hero.append(el('strong', null, `${chosen.short}${chosen.night ? ', after dark' : ''}: `),
      document.createTextNode(`${top} ${top === 1 ? 'hexagon' : 'hexagons'} within 15 minutes`
        + (bottom !== top ? `, or ${bottom} ${CAUTIOUS}` : '')
        + (chosen.key !== 'walk' ? `. Walking: ${range(walk.reach.nkb, walk.reach.cautious)}.` : '.')));
    parts.push(hero);
    summary = `${profileOf(chosen.key).tag} ${range(top, bottom)}`;
  }
  if (f.km != null) {
    const { bar, words } = statusBar(f.shares);
    parts.push(bar, el('p', 'mate-line', `${f.km.toFixed(f.km < 10 ? 1 : 0)} km of footpath: ${words.join(', ')}.`));
  }

  if (f.row != null) {
    // Every profile side by side.
    const rows = f.rows.map((r) => {
      const tr = el('tr', r.key === chosen.key ? 'is-chosen' : null);
      const name = el('th', 'mate-name');
      name.scope = 'row';
      const pick = el('button', 'mate-pick', `${r.short}${r.night ? ', after dark' : ''}`);
      pick.type = 'button';
      pick.addEventListener('click', () => ctx.set({ profile: r.key }));
      name.append(pick);
      if (r.group && r.group.share != null) name.append(el('span', 'mate-group', `${r.group.share}% of residents ${r.group.label}`));
      tr.append(name,
        el('td', 'num', range(r.reach.nkb, r.reach.cautious)),
        el('td', 'num', minutesRange(r.stop.nkb, r.stop.cautious)),
        el('td', 'num', minutesRange(r.frequent.nkb, r.frequent.cautious)));
      return tr;
    });
    parts.push(fold(`${key}-profiles`, 'Every profile', null, [
      table('mate-profiles', ['Profile', 'Reach', 'Stop', 'Frequent'], rows, 'Each profile on foot'),
      note(`Reach: hexagons within 15 minutes, this one included. Stop, Frequent: minutes to the nearest stop, and to one with 4 or more departures an hour. The second figure is ${CAUTIOUS}. A dash: none within 30 minutes.`),
      note('Residents: the census group each profile most nearly describes. Disabled people are a broader group than wheelchair users.'),
    ]));
    // The third view, on request: only what is recorded as passable.
    parts.push(fold(`${key}-known`, 'Using only what is recorded', null, [
      el('p', 'mate-line', f.rows.map((r) => `${r.short} ${r.reach.known ?? '–'}`).join(' · ')),
      note('Hexagons within 15 minutes on what is recorded as passable, leaving out the rest. For most profiles this is little more than the hexagon itself, because most kerbs are not recorded.'),
    ]));
    // Services for the chosen profile.
    const grid = el('div', 'mate-grid');
    for (const s of f.services) {
      grid.append(el('span', 'mate-grid-name', ctx.serviceNames[s.key] || s.key), el('span', 'num', s.nkb == null ? 'over 30 min' : minutesRange(s.nkb, s.cautious, ' min')));
    }
    parts.push(fold(`${key}-services`, 'Services on foot', who, [grid]));
  }

  // What is in the way, for the chosen profile.
  if (f.km != null) {
    const lines = [];
    if (f.streets) {
      const bits = STATUS.filter((s) => (f.streets.shares[s.key] || 0) > 0).map((s) => `${f.streets.shares[s.key]}% ${s.label}`);
      lines.push(`Where no footpath is drawn, routes follow ${f.streets.km.toFixed(1)} km of street centre line${bits.length ? `: ${bits.join(', ')}` : ''}.`);
    }
    if (f.steps) lines.push(`${f.steps} ${f.steps === 1 ? 'flight' : 'flights'} of steps.`);
    if (f.steep != null) lines.push(`${f.steep ? `${count(f.steep)} m steeper than 1:12` : 'Nothing steeper than 1:12'}${f.noSlope ? `; no slope reading on ${f.noSlope}%` : ''}.`);
    if (f.width) {
      const estimated = Math.max(0, 100 - f.width.recorded - f.width.none);
      const n = f.width.narrow;
      const narrowText = n ? ` Under ${n.limit} m, this profile's limit: ${n.recorded}% recorded, ${n.estimated}% estimated.` : '';
      lines.push(`Width recorded on ${f.width.recorded}% of footpath, estimated from photos on ${estimated}%, not known on ${f.width.none}%.${narrowText}`);
    }
    lines.push(kerbLine(f.kerbs));
    if (f.kerbs.main) lines.push(`${f.kerbs.main} ${f.kerbs.main === 1 ? 'crossing' : 'crossings'} of a main road, ${f.kerbs.mainNoSignals} with no signals recorded.`);
    if (f.notSeen) lines.push(`${f.notSeen.toFixed(1)} km of street side where the photos show no footpath, or trees hide it.`);
    parts.push(fold(`${key}-way`, 'What is in the way', who, lines.map((line) => el('p', 'mate-line', line))));
    parts.push(fold(`${key}-light`, 'Lighting', f.light && f.light.recorded ? `recorded on ${f.light.recorded}%` : 'not recorded', [
      el('p', 'mate-line', lightLine(f.light)),
      note('Lit means tagged, or near a mapped street lamp. It does not measure how bright it is, or how safe.'),
    ]));
  } else if (f.kerbs.total || f.kerbs.junctions || f.kerbs.joins) {
    parts.push(fold(`${key}-way`, 'What is in the way', who, [el('p', 'mate-line', kerbLine(f.kerbs))]));
  }

  // Public transport for each profile.
  if (f.transit) {
    const t = f.transit;
    const spec = (ctx.windows || {})[t.window] || {};
    const body = [];
    if (ctx.mate.dark) body.push(note('Public transport figures are by day: TEAM\'s windows are all in daylight.'));
    let transitSum = null;
    if (t.state === 'no-origin') {
      body.push(note('No public transport figures: this hexagon has no times on MATE\'s network.'));
    } else if (t.state === 'not-urban') {
      body.push(note('TEAM times public transport from urban areas only.'));
    } else if (t.state === 'no-trip') {
      body.push(note(`TEAM's routing found no public transport trip from here ${spec.phrase || 'in this window'}.`));
    } else {
      const rows = t.rows.map((r) => {
        const tr = el('tr', r.key === chosen.key ? 'is-chosen' : null);
        const name = el('th', 'mate-name', r.short);
        name.scope = 'row';
        if (r.stop) name.append(el('span', 'mate-group', `${r.stop.name}, ${r.stopMinutes} min`));
        else name.append(el('span', 'mate-group', 'No stop within 15 min'));
        const jobs = r.jobs.nkb == null ? '–' : range(r.jobs.nkb, r.jobs.cautious, '%');
        tr.append(name, el('td', 'num', range(r.cells.nkb, r.cells.cautious)), el('td', 'num', jobs));
        return tr;
      });
      body.push(table('mate-transit', ['Profile and nearest stop', 'Reach', 'Jobs'], rows, 'Each profile by public transport'));
      const mine = t.rows.find((r) => r.key === chosen.key);
      if (mine && mine.cells.nkb != null) transitSum = `${profileOf(chosen.key).tag} ${range(mine.cells.nkb, mine.cells.cautious)}`;
      if (mine && mine.services.nkb != null) {
        const have = servicesIn(mine.services.nkb, t.services);
        // Lower case inside a sentence, but not an initialism like GP.
        const missing = t.services.filter((s) => !have.includes(s)).map((s) => ctx.serviceNames[s] || s)
          .map((name) => (/^[A-Z]{2}/.test(name) ? name : name[0].toLowerCase() + name.slice(1)));
        body.push(el('p', 'mate-line', `${mine.short}: ${have.length} of ${t.servicesTotal} services within 45 minutes${missing.length ? ` (not ${missing.join(', ')})` : ''}.`));
      } else if (chosen.key === 'cargo_bike') {
        body.push(el('p', 'mate-line', 'Not worked out for the cargo bike.'));
      }
      body.push(note(`Reach: hexagons within 45 minutes, by public transport or within 15 on foot. Jobs: share of ${count(t.jobsTotal)} jobs in them. The second figure is ${CAUTIOUS}.`));
      const teamShare = t.team == null ? 'TEAM\'s own figure' : `TEAM's own figure, ${t.team.toFixed(t.team < 10 ? 1 : 0)}% under Jobs within reach,`;
      body.push(note(`Walking here is MATE's estimate, made the same way as the other rows, so compare the profiles with it. ${teamShare} differs: MATE walks on its own footpath map, counts jobs in the hexagons people live in, and keeps one typical trip rather than the median.`));
      body.push(note('An estimate. It keeps the walker\'s trip from TEAM\'s routing (a typical trip in the 2-hour window) and swaps in each profile\'s own walk to the first stop and from the last, on MATE\'s footpath map. No trip where the profile cannot make either walk within 15 minutes. Changes are walked at a walker\'s pace. Stop and vehicle access: no information.'));
    }
    parts.push(fold(`${key}-transit`, `By public transport, ${(spec.label || t.window).toLowerCase()}`, transitSum, body));
  }

  // The map, for a hexagon with times.
  if (f.row != null) {
    parts.push(fold(`${key}-map`, 'On the map', ctx.mate.map ? (ctx.mate.view === 'cautious' ? 'cautious' : 'no known barrier') : 'TEAM\'s map', [
      mapSwitch(ctx.mate, ctx.set),
      note(ctx.mate.map
        ? `Hexagons by minutes on foot from this one for the profile chosen; hatched where walking gets there and the profile does not. ${VIEW_PHRASE[ctx.mate.view][0].toUpperCase()}${VIEW_PHRASE[ctx.mate.view].slice(1)}.`
        : 'The map shows TEAM\'s view.'),
    ]));
  }
  parts.push(fold(`${key}-sources`, 'Assumptions and sources', null, sources(cm, ctx)));
  return box(summary, parts);
}

/** No known barrier, Cautious or TEAM's map: what the map shows for the hexagon picked. Also in the key. */
export function mapSwitch(mate, set, id = 'mate-map') {
  return chipGroup(id, 'Map', [['nkb', 'No known barrier'], ['cautious', 'Cautious'], ['off', 'TEAM\'s map']],
    mate.map ? mate.view : 'off', (value) => set(value === 'off' ? { map: false } : { map: true, view: value }));
}

/** Assumptions and sources. */
function sources(cm, ctx) {
  const assume = el('p', 'note mate-sources');
  assume.append(document.createTextNode('Assumptions: harder parts take 1.5 times as long, and for the second figure unrecorded parts three times as long; times start at the hexagon\'s centre, joined by a straight line of up to 175 m to the nearest paths the profile can use, and that line counts as passable; the pram\'s slope limit, the child\'s main-road rule and after dark have no published source. '));
  const link = el('a', null, 'MATE\'s profiles');
  link.href = `${ctx.base}mate/profiles.html#routing-for-team`;
  link.target = '_blank';
  link.rel = 'noopener';
  assume.append(link, document.createTextNode('.'));
  const osm = cm.meta.osm_date ? `OpenStreetMap to ${dateText(cm.meta.osm_date)}` : 'OpenStreetMap';
  return [assume, note(`Sources: ${osm}; widths, kerbs and slope estimated from LINZ aerial photos and 1 m LiDAR where OpenStreetMap has none; residents from the 2023 Census; stops and trips from Auckland Transport's timetable. MATE data built ${dateText(cm.meta.built)}.`)];
}
