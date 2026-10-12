// MATE in the hexagon card: how far each mobility profile gets on foot and by
// public transport, what is in the way, and the catchment on the map.
//
// Only behind ?mate=1, and only where MATE has data (Auckland). app.js imports
// this module the first time a hexagon is clicked, and the data follows: two
// files for the whole place, then one small file per resolution 6 area
// (MATE docs/team_export.md describes them all).

/* global h3 */

import { fetchJson } from './data.js';
import { count, el } from './format.js';

export const PLACES = ['auckland'];

// The profiles in MATE's order, with a short name for the table and the group
// of residents each most nearly describes. The cargo bike has none.
export const PROFILES = [
  { key: 'walk', short: 'Walking' },
  { key: 'older_walker', short: 'Older walker', night: 'older_walker_night', group: 'older' },
  { key: 'manual_wheelchair', short: 'Manual wheelchair', group: 'disabled' },
  { key: 'powered_chair_scooter', short: 'Powered chair or scooter', group: 'disabled' },
  { key: 'pram', short: 'Pram or buggy', group: 'under5' },
  { key: 'child', short: 'Child on their own', night: 'child_night', group: 'kids' },
  { key: 'cargo_bike', short: 'Cargo bike' },
];
export const DEFAULT_PROFILE = 'manual_wheelchair';
const GROUP_LABEL = { older: '65+', kids: 'under 15', under5: 'under 5', disabled: 'disabled' };

// The map's colours for each status, as on MATE's own map.
export const STATUS = [
  { key: 'p', label: 'no known barrier', colour: '#0ca30c' },
  { key: 'h', label: 'harder', colour: '#fab219' },
  { key: 'u', label: 'not known', colour: '#848b90' },
  { key: 'b', label: 'barrier', colour: '#d03b3b' },
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

/** The crossings in a hexagon by what is known of their kerbs, recorded first. */
export function kerbs(cm, i) {
  const get = (k) => cm[`x_${k}`]?.[i] ?? 0;
  const out = {
    ok: get('ok'), raised: get('raised'), okEst: get('ok_est'), raisedEst: get('raised_est'),
    part: get('part'), unknown: get('unknown'), main: get('main'), mainNoSignals: get('main_no_signals'),
  };
  out.recorded = out.ok + out.raised;
  out.estimated = out.okEst + out.raisedEst;
  out.total = out.recorded + out.estimated + out.part + out.unknown;
  return out;
}

/** Lighting on the hexagon's footpath, % of it: recorded (lit or not lit), estimated, not known. */
export function lighting(cm, i) {
  if (cm.km[i] == null) return null;
  const v = (k) => cm[k]?.[i] ?? 0;
  return { lit: v('l1'), notLit: v('l3'), recorded: v('l1') + v('l3'), probably: v('l2'), unknown: v('l0'), lamps: v('lamps') };
}

export function servicesIn(bits, services) {
  if (bits == null) return [];
  return services.filter((_, k) => (bits >> k) & 1);
}

/** The public transport window: the one on screen if MATE has it, else off-peak. */
export function ptWindow(when, windows) {
  if (windows.includes(when)) return when;
  return windows.includes('interpeak') ? 'interpeak' : windows[0];
}

/** Everything the card says about one hexagon, as plain values. */
export function cardFigures(mate, i, { profile, dark, when, urban }) {
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
    const window = ptWindow(when, pt.windows);
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
    steps: cm.steps?.[i] ?? null,
    steep: cm.m12?.[i] ?? null,
    noSlope: cm.g0?.[i] ?? null,
    width: cm.km[i] == null ? null : { recorded: cm.wr[i] ?? 0, none: cm.w0[i] ?? 0, under12: cm.w1[i] ?? 0 },
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

function head(text) {
  return el('h4', 'mate-head', text);
}

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
    part.style.background = s.colour;
    bar.append(part);
    words.push(`${v}% ${s.label}`);
  }
  bar.setAttribute('aria-label', words.join(', '));
  return { bar, words };
}

function kerbLine(k) {
  if (!k.total) return 'No crossings mapped in this hexagon.';
  const parts = [];
  if (k.recorded) parts.push(`${k.recorded} recorded (${[k.ok ? `${k.ok} lowered or flush` : '', k.raised ? `${k.raised} raised` : ''].filter(Boolean).join(', ')})`);
  else parts.push('none recorded');
  if (k.estimated) parts.push(`${k.estimated} estimated from photos (${[k.okEst ? `${k.okEst} lowered` : '', k.raisedEst ? `${k.raisedEst} raised` : ''].filter(Boolean).join(', ')})`);
  const unknown = k.part + k.unknown;
  if (unknown) parts.push(`${unknown} not known${k.part ? `, ${k.part} of them read only in part` : ''}`);
  return `Kerbs at ${k.total} ${k.total === 1 ? 'crossing' : 'crossings'}: ${parts.join('; ')}.`;
}

function lightLine(l) {
  const recorded = l.recorded
    ? `Recorded on ${l.recorded}% of footpath here (${l.lit}% lit, ${l.notLit}% not lit)`
    : 'Not recorded on any footpath here';
  const rest = [l.probably ? `probably lit ${l.probably}% (estimated from mapped lamps)` : '', l.unknown ? `not known ${l.unknown}%` : ''].filter(Boolean).join('; ');
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

/** The section for the card. `ctx`: base, city, placeName, i, id (its H3 index), urban, when and windows (TEAM's),
 *  mate (profile, dark, view, map), serviceNames, set (to change the MATE settings), ready (to draw again when
 *  data arrives). */
export function section(ctx) {
  const box = el('section', 'place-section mate');
  box.id = 'mate-section';
  const title = el('h3', null, 'On foot, by profile');
  title.append(el('span', 'mate-tag', 'MATE preview'));
  box.append(title);
  if (!PLACES.includes(ctx.city)) {
    box.append(note(`MATE has no footpath data for ${ctx.placeName} yet.`));
    return box;
  }
  const got = request(ctx.base, ctx.id, ctx.ready);
  if (got.error) {
    box.append(note('MATE data could not be loaded. Reload the page to try again.'));
    return box;
  }
  if (!got.core) {
    box.append(note('Loading MATE…'));
    return box;
  }
  const cm = got.core.cells;
  const i = ctx.i;
  if (cm.km[i] == null && cm.o[i] == null) {
    box.append(note('MATE has no footpath data for this hexagon yet.'));
    return box;
  }
  const f = cardFigures(got.core, i, { profile: ctx.mate.profile, dark: ctx.mate.dark, when: ctx.when, urban: ctx.urban });
  const chosen = f.chosen;
  box.append(note('A preview for checking. Only Devonport has been checked on the ground.'));

  // Profile and after dark.
  const controls = el('div', 'mate-controls');
  const label = el('label', 'mate-field');
  label.append(el('span', 'field-label', 'Profile'));
  const select = el('select');
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
  box.append(controls);
  if (ctx.mate.dark) {
    box.append(note('After dark changes the older walker and the child only: footpaths tagged not lit count as harder, and those with no lighting recorded as not known.'));
  }

  // The headline for the chosen profile, then every profile side by side.
  if (f.row == null) {
    box.append(note('This hexagon\'s footpaths do not join the rest of MATE\'s network within 175 m of its centre, so it has no times.'));
  } else {
    const walk = f.rows[0];
    const hero = el('p', 'mate-hero');
    const top = chosen.reach.nkb;
    const bottom = chosen.reach.cautious;
    hero.append(el('strong', null, `${chosen.short}${chosen.night ? ', after dark' : ''}: `),
      document.createTextNode(`${top} ${top === 1 ? 'hexagon' : 'hexagons'} within 15 minutes`
        + (bottom !== top ? `, or ${bottom} ${CAUTIOUS}` : '')
        + (chosen.key !== 'walk' ? `. Walking: ${range(walk.reach.nkb, walk.reach.cautious)}.` : '.')));
    box.append(hero);
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
    box.append(table('mate-profiles', ['Profile', 'Reach', 'Stop', 'Frequent'], rows, 'Each profile on foot'));
    box.append(note(`Reach: hexagons within 15 minutes, this one included. Stop, Frequent: minutes to the nearest stop, and to one with 4 or more departures an hour. The second figure is ${CAUTIOUS}. A dash: none within 30 minutes.`));
    box.append(note('Residents: the census group each profile most nearly describes. Disabled people are a broader group than wheelchair users.'));

    // Services for the chosen profile.
    box.append(head(`Services on foot, ${chosen.short.toLowerCase()}${chosen.night ? ' after dark' : ''}`));
    const grid = el('div', 'mate-grid');
    for (const s of f.services) {
      grid.append(el('span', 'mate-grid-name', ctx.serviceNames[s.key] || s.key), el('span', 'num', s.nkb == null ? 'over 30 min' : minutesRange(s.nkb, s.cautious, ' min')));
    }
    box.append(grid);
  }

  // What is in the way, for the chosen profile.
  if (f.km != null) {
    box.append(head(`What is in the way, ${chosen.short.toLowerCase()}${chosen.night ? ' after dark' : ''}`));
    const { bar, words } = statusBar(f.shares);
    box.append(bar, el('p', 'mate-line', `${f.km.toFixed(f.km < 10 ? 1 : 0)} km of footpath: ${words.join(', ')}.`));
    const lines = [];
    if (f.steps) lines.push(`${f.steps} ${f.steps === 1 ? 'flight' : 'flights'} of steps.`);
    if (f.steep != null) lines.push(`${f.steep ? `${count(f.steep)} m steeper than 1:12` : 'Nothing steeper than 1:12'}${f.noSlope ? `; no slope reading on ${f.noSlope}%` : ''}.`);
    if (f.width) {
      const estimated = Math.max(0, 100 - f.width.recorded - f.width.none);
      lines.push(`Width recorded on ${f.width.recorded}% of footpath, estimated from photos on ${estimated}%, not known on ${f.width.none}%. Under 1.2 m: ${f.width.under12}%.`);
    }
    lines.push(kerbLine(f.kerbs));
    if (f.kerbs.main) lines.push(`${f.kerbs.main} ${f.kerbs.main === 1 ? 'crossing' : 'crossings'} of a main road, ${f.kerbs.mainNoSignals} with no signals recorded.`);
    if (f.notSeen) lines.push(`${f.notSeen.toFixed(1)} km of street side where the photos show no footpath, or trees hide it.`);
    for (const line of lines) box.append(el('p', 'mate-line', line));
    box.append(head('Lighting'));
    box.append(el('p', 'mate-line', lightLine(f.light)));
    box.append(note('Lit means tagged, or near a mapped street lamp. It does not measure how bright it is, or how safe.'));
  } else if (f.kerbs.total) {
    box.append(el('p', 'mate-line', kerbLine(f.kerbs)));
  }

  // Public transport for each profile.
  if (f.transit) {
    const t = f.transit;
    const spec = (ctx.windows || {})[t.window] || {};
    box.append(head(`By public transport, ${(spec.label || t.window).toLowerCase()} (estimate)`));
    if (t.state === 'no-origin') {
      box.append(note('No public transport figures: this hexagon has no times on MATE\'s network.'));
    } else if (t.state === 'not-urban') {
      box.append(note('TEAM times public transport from urban areas only.'));
    } else if (t.state === 'no-trip') {
      box.append(note(`TEAM's routing found no public transport trip from here ${spec.phrase || 'in this window'}.`));
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
      box.append(table('mate-transit', ['Profile and nearest stop', 'Reach', 'Jobs'], rows, 'Each profile by public transport'));
      const mine = t.rows.find((r) => r.key === chosen.key);
      if (mine && mine.services.nkb != null) {
        const have = servicesIn(mine.services.nkb, t.services);
        // Lower case inside a sentence, but not an initialism like GP.
        const missing = t.services.filter((s) => !have.includes(s)).map((s) => ctx.serviceNames[s] || s)
          .map((name) => (/^[A-Z]{2}/.test(name) ? name : name[0].toLowerCase() + name.slice(1)));
        box.append(el('p', 'mate-line', `${mine.short}: ${have.length} of ${t.servicesTotal} services within 45 minutes${missing.length ? ` (not ${missing.join(', ')})` : ''}.`));
      } else if (chosen.key === 'cargo_bike') {
        box.append(el('p', 'mate-line', 'Not worked out for the cargo bike.'));
      }
      box.append(note(`Reach: hexagons within 45 minutes, by public transport or within 15 on foot. Jobs: share of ${count(t.jobsTotal)} jobs in them. The second figure is ${CAUTIOUS}.`));
      box.append(note('An estimate. It keeps the walker\'s trip from TEAM\'s routing (a typical trip in the 2-hour window) and swaps in each profile\'s own walk to the first stop and from the last, on MATE\'s footpath map. No trip where the profile cannot make either walk within 15 minutes. Changes are walked at a walker\'s pace. Stop and vehicle access: no information.'));
    }
  }

  // The map, for a hexagon with times.
  if (f.row == null) return finish(box, cm, ctx);
  box.append(head('On the map'));
  box.append(chipGroup('mate-map', 'Map', [['nkb', 'No known barrier'], ['cautious', 'Cautious'], ['off', 'TEAM\'s map']],
    ctx.mate.map ? ctx.mate.view : 'off', (value) => ctx.set(value === 'off' ? { map: false } : { map: true, view: value })));
  box.append(note(ctx.mate.map
    ? `Hexagons by minutes on foot from this one for the profile chosen; hatched where walking gets there and the profile does not. ${VIEW_PHRASE[ctx.mate.view][0].toUpperCase()}${VIEW_PHRASE[ctx.mate.view].slice(1)}.`
    : 'The map shows TEAM\'s view.'));
  return finish(box, cm, ctx);
}

/** Assumptions and sources, at the foot of the section. */
function finish(box, cm, ctx) {
  const assume = el('p', 'note mate-sources');
  assume.append(document.createTextNode('Assumptions: harder parts take 1.5 times as long, and for the second figure unrecorded parts three times as long; the pram\'s slope limit, the child\'s main-road rule and after dark have no published source. '));
  const link = el('a', null, 'MATE\'s profiles');
  link.href = `${ctx.base}mate/profiles.html#routing-for-team`;
  link.target = '_blank';
  link.rel = 'noopener';
  assume.append(link, document.createTextNode('.'));
  box.append(assume);
  const osm = cm.meta.osm_date ? `OpenStreetMap to ${dateText(cm.meta.osm_date)}` : 'OpenStreetMap';
  box.append(note(`Sources: ${osm}; widths, kerbs and slope estimated from LINZ aerial photos and 1 m LiDAR where OpenStreetMap has none; residents from the 2023 Census; stops and trips from Auckland Transport's timetable. MATE data built ${dateText(cm.meta.built)}.`));
  return box;
}
