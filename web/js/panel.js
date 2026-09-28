// The left panel: what to reach, the three views, and their controls.
// Every function here renders from a model built in app.js; none of them
// computes figures.

import { bars, lines } from './charts.js';
import { count, el, minutes, MODE_NOTES, MODES, percent, place } from './format.js';

// Everyday errands first, then education in the order a child meets it, then
// jobs. A service the build does not have is dropped by setServices.
const PREFERRED_ORDER = [
  'supermarket', 'gp', 'pharmacy', 'errands', 'library', 'bank_post',
  'early_childhood', 'primary_school', 'intermediate_school', 'secondary_school',
  'jobs',
];

export let SERVICE_ORDER = [...PREFERRED_ORDER];

export const SERVICE_SHORT = {
  supermarket: 'Supermarket',
  gp: 'GP',
  pharmacy: 'Pharmacy',
  errands: 'Errand round',
  library: 'Library',
  bank_post: 'Bank or post',
  early_childhood: 'Early childhood',
  primary_school: 'Primary school',
  intermediate_school: 'Intermediate',
  secondary_school: 'Secondary school',
  jobs: 'Jobs',
};

export const SERVICE_NOUN = {
  supermarket: 'a supermarket',
  gp: 'a GP',
  pharmacy: 'a pharmacy',
  errands: 'an errand round',
  library: 'a library',
  bank_post: 'a bank or post shop',
  early_childhood: 'an early childhood service',
  primary_school: 'a primary school',
  intermediate_school: 'an intermediate school',
  secondary_school: 'a secondary school',
};

/** Which services this build actually has, in the order to show them.
 *  Anything the data carries but this file has not met is shown too, under a
 *  label made from its name, so a new destination type appears without an
 *  edit here. */
export function setServices(meta) {
  const have = Object.keys(meta.services || {});
  const known = PREFERRED_ORDER.filter((id) => have.includes(id));
  const extra = have.filter((id) => !PREFERRED_ORDER.includes(id));
  for (const id of extra) {
    if (!SERVICE_SHORT[id]) SERVICE_SHORT[id] = meta.services[id].label || id;
    if (!SERVICE_NOUN[id]) SERVICE_NOUN[id] = (meta.services[id].label || id).toLowerCase();
  }
  // An errand round is a trip to several services, offered where the build
  // worked the rounds out.
  if (meta.chains) known.splice(known.indexOf('pharmacy') + 1 || known.length, 0, 'errands');
  SERVICE_ORDER = [...known, ...extra, 'jobs'].filter((id, i, all) => all.indexOf(id) === i);
}

const GROUP_PHRASE = {
  everyone: 'people',
  no_car: 'people in households without a car',
  children: 'children under 15',
  older: 'people aged 65 and over',
  low_income: 'people in households under $70,000',
  maori: 'Māori',
  pacific: 'Pacific peoples',
  asian: 'Asian residents',
  disabled: 'disabled people',
};

const phrase = (group) => GROUP_PHRASE[group] || 'people';

// Chips have room for a couple of words; the charts carry the full label.
const GROUP_SHORT = {
  everyone: 'Everyone',
  no_car: 'No car',
  children: 'Children',
  older: '65 and over',
  low_income: 'Lower income',
  maori: 'Māori',
  pacific: 'Pacific',
  asian: 'Asian',
  disabled: 'Disabled',
};

const chipLabels = (groups) => groups.map(([key, label]) => [key, GROUP_SHORT[key] || label]);

const REASON_SENTENCE = {
  0: 'the nearest one is close in a straight line, but the walk there is indirect',
  1: 'a confident rider could get there in time on busy roads, but not on low-stress routes',
  2: 'public transport is too slow, usually because services are infrequent or indirect',
  3: 'the nearest one is too far away',
  4: 'public transport would get them there in time, but not on this budget',
};

/** One chip button. `data-value` lets the app put keyboard focus back on the
 *  same choice after the panel is redrawn. */
function chip(value, text, current, onPick, title) {
  const button = el('button', 'chip', text);
  button.type = 'button';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', String(value === current));
  button.dataset.value = String(value);
  if (title) button.title = title;
  button.addEventListener('click', () => onPick(value));
  return button;
}

function radios(label, options, current, onPick, { compact = false } = {}) {
  const field = el('div', 'field');
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const title = el('span', 'field-label', label);
  title.id = id;
  const group = el('div', `chips${compact ? ' chips-compact' : ''}`);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', id);
  group.dataset.group = id;
  for (const [value, text] of options) group.append(chip(value, text, current, onPick));
  field.append(title, group);
  return field;
}

/** A short line, with the detail folded away behind it.
 *
 *  Anyone who wants to know how a number was made can open it; anyone who
 *  just wants the number is not made to read a paragraph first.
 */
function method(summary, ...paragraphs) {
  const box = el('details', 'method');
  const head = el('summary');
  head.append(el('span', 'method-mark', 'i'), el('span', null, summary));
  box.append(head, ...paragraphs.filter(Boolean).map((text) => el('p', 'method-text', text)));
  return box;
}

function hero(figure, text, sub) {
  const box = el('div', 'hero');
  box.append(el('div', 'hero-figure', figure), el('p', 'hero-text', text));
  if (sub) box.append(el('p', 'hero-sub', sub));
  return box;
}

function legend(title, items, { note, divider } = {}) {
  const box = el('div', 'legend');
  box.append(el('span', 'field-label', title));
  const scale = el('div', 'legend-scale');
  scale.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;
  items.forEach((item, index) => {
    const step = el('div', `legend-step${divider === index ? ' is-divider' : ''}`);
    const swatch = el('span', 'legend-swatch');
    swatch.style.background = item.colour;
    step.append(swatch, el('span', 'legend-label', item.label));
    scale.append(step);
  });
  box.append(scale);
  if (note) box.append(el('p', 'note', note));
  return box;
}

// Eight destinations in one row wraps to three lines and reads as a wall.
// They fall into three kinds, and naming the kind first turns one long list
// into a short one plus whatever belongs under it. Picking a kind picks its
// first destination, so nobody has to click twice to get somewhere.
const SERVICE_GROUPS = [
  { key: 'everyday', label: 'Everyday', members: ['supermarket', 'gp', 'pharmacy', 'errands'] },
  { key: 'community', label: 'Community', members: ['library', 'bank_post'] },
  { key: 'education', label: 'Education', members: ['early_childhood', 'primary_school', 'intermediate_school', 'secondary_school'] },
  { key: 'jobs', label: 'Jobs', members: ['jobs'] },
];

function groupsPresent() {
  return SERVICE_GROUPS
    .map((group) => ({ ...group, members: group.members.filter((id) => SERVICE_ORDER.includes(id)) }))
    .filter((group) => group.members.length);
}

export function groupOf(service) {
  const found = groupsPresent().find((group) => group.members.includes(service));
  return found ? found.key : (groupsPresent()[0] || { key: 'everyday' }).key;
}

function chipRow(options, current, onPick, extraClass = '', label = '') {
  const row = el('div', `chips${extraClass}`);
  row.setAttribute('role', 'radiogroup');
  if (label) row.setAttribute('aria-label', label);
  row.dataset.group = label || extraClass;
  for (const [value, text] of options) row.append(chip(value, text, current, onPick));
  return row;
}

/** When the trip is made. Picking a time keeps it for everything that was
 *  timed then, so moving from GPs to jobs stays on Saturday; anything that
 *  was not, such as a school run, keeps its own time. */
export function renderWhenPicker(root, options, current, set) {
  renderChips(root, options, current, (when) => set({ when }));
}

/** A row of chips in an existing radio group: [value, text, title] each. */
export function renderChips(root, options, current, onPick) {
  root.dataset.group = root.id;
  root.replaceChildren(...options.map(([value, text, title]) => chip(value, text, current, onPick, title)));
}

export function renderServicePicker(root, current, set) {
  const groups = groupsPresent();
  const active = groupOf(current);
  const inGroup = (groups.find((g) => g.key === active) || groups[0]).members;
  const rows = [
    chipRow(groups.map((g) => [g.key, g.label]), active, (key) => {
      const group = groups.find((g) => g.key === key);
      if (group && !group.members.includes(current)) set({ service: group.members[0] });
    }, '', 'Kind'),
  ];
  // One destination in a kind needs no second row to choose from.
  if (inGroup.length > 1) {
    rows.push(chipRow(inGroup.map((id) => [id, SERVICE_SHORT[id]]), current, (id) => set({ service: id }), ' chips-sub', 'Destination'));
  }
  root.replaceChildren(...rows);
}

function accessSentence(model) {
  const { noun, standard, mode, fare = '' } = model;
  switch (mode) {
    case 'walk':
      return `of ${place.residents} can walk to ${noun} within ${standard} minutes.`;
    case 'walk_slow':
      return `of ${place.residents} can walk to ${noun} within ${standard} minutes at a slower pace.`;
    case 'bike_low_stress':
      return `of ${place.residents} can cycle to ${noun} within ${standard} minutes on low-stress routes.`;
    case 'bike':
      return `of ${place.residents} could cycle to ${noun} within ${standard} minutes on any street.`;
    case 'pt':
      return `of ${place.residents} can reach ${noun} within ${standard} minutes by public transport${fare}.`;
    case 'car':
      return `of ${place.residents} can drive to ${noun} within ${standard} minutes.`;
    default:
      return `of ${place.residents} can reach ${noun} within ${standard} minutes without a car${fare}.`;
  }
}

/** A line under the hero saying what the fare budget is doing, when one is set. */
function fareLine(model) {
  if (!model.fare) return null;
  if (model.fareNote) return el('p', 'note is-fare', model.fareNote);
  if (model.zones === 0) {
    return el('p', 'note is-fare', 'On this budget no fare is affordable, so only walking and cycling count.');
  }
  if (model.zones == null) return null;
  return el('p', 'note is-fare',
    `Public transport counts only where the trip stays inside ${model.zones} fare ${model.zones === 1 ? 'zone' : 'zones'}.`);
}

/** Travel by, split the way the measure splits it.
 *
 *  Four of these count towards a standard. Driving and riding on any street
 *  never do, and are kept for comparison, so they sit apart and say so rather
 *  than sitting in the same row looking like equals.
 */
function modePicker(current, set, standardModes, slowWalk = false) {
  const counts = ['best', ...standardModes];
  // Walking at the slower pace sits beside walking, where it is looked for.
  if (slowWalk) counts.splice(counts.indexOf('walk') + 1 || counts.length, 0, 'walk_slow');
  const compare = Object.keys(MODES).filter((m) => !counts.includes(m) && m !== 'walk_slow');
  const field = el('div', 'field');
  const title = el('span', 'field-label', 'Travel by');
  field.append(title, chipRow(counts.map((m) => [m, MODES[m].label]), current, (mode) => set({ mode }), ' chips-compact', 'Travel by'));
  if (compare.length) {
    const row = el('div', 'compare-row');
    row.append(el('span', 'compare-label', 'Compare with'));
    row.append(chipRow(compare.map((m) => [m, MODES[m].label]), current, (mode) => set({ mode }), ' chips-compact chips-quiet', 'Compare with'));
    field.append(row);
  }
  return field;
}

function showSwitch(current, set, available, burden = false, choice = true) {
  const options = [['minutes', 'Minutes']];
  if (choice) options.push(['choice', 'Choice']);
  if (available) options.push(['fare', 'What it costs']);
  if (available && burden) options.push(['burden', 'Fare burden']);
  if (options.length < 2) return null;
  return radios('Show', options, current, (show) => set({ show }), { compact: true });
}

/** Whether the answer holds at other times, by more than one way, and as the
 *  standard moves. Folded away: it is for anyone who wants to lean on the
 *  number, not for a first look. */
function robustSection(model) {
  const r = model.robust;
  if (!r) return null;
  const box = el('details', 'robust');
  box.append(el('summary', null, 'How robust is this?'));
  const body = el('div', 'robust-body');
  const row = (figure, text) => {
    const line = el('p', 'robust-row');
    line.append(el('strong', null, figure), el('span', null, text));
    return line;
  };
  if (r.everyTime != null) {
    body.append(row(percent(r.everyTime), `meet the standard at every time of day this is timed for, against ${percent(r.now)} now.`));
  }
  body.append(row(percent(r.twoOrMore), 'could get there in time more than one way: walking, low-stress cycling or public transport.'));
  body.append(row(percent(r.onlyOne), 'have only one way, so one route or service change would put them out of reach.'));
  const chart = el('div', 'chart');
  lines(chart, r.series, {
    xs: r.xs,
    marker: r.standard,
    format: (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–'),
    caption: 'Share meeting the standard as the standard changes (minutes)',
    label: 'Share meeting the standard at each standard from 5 to 60 minutes, for everyone and the most and least deprived areas',
  });
  body.append(chart);
  box.append(body);
  return box;
}

/** How many of a service are within the standard, not only whether one is. */
export function renderChoice(root, model, set) {
  const chart = el('div', 'chart');
  bars(chart, model.byQuintile, {
    format: (v) => percent(v),
    caption: `Share with two or more ${model.plural} in time, by neighbourhood deprivation`,
    label: 'Share with two or more in time, by NZDep',
  });
  const step = model.minutes < model.standard
    ? el('p', 'note', `Counted within ${model.minutes} minutes, the nearest step at or under the ${model.standard}-minute standard.`)
    : null;
  root.replaceChildren(...[
    hero(percent(model.twoOrMore), `of ${place.residents} have two or more ${model.plural} within ${model.minutes} minutes without a car.`,
      `${percent(model.none)} have none. A choice matters where a practice's books are closed or the nearest one is small.`),
    step,
    showSwitch('choice', set, model.canShowFare, model.canShowBurden),
    legend(`${model.plural[0].toUpperCase()}${model.plural.slice(1)} within ${model.minutes} min without a car`, model.legend, { divider: 2 }),
    chart,
    method('How this is worked out',
      'Counts every one reachable within the time by walking, low-stress cycling or public transport, taking whichever of the '
        + 'three reaches the most. Public transport is at its usual time with no fare limit. Counts are kept at 10, 15, 20 and '
        + '30 minutes, so another standard uses the nearest step below it.'),
  ].filter(Boolean));
}

export function renderAccess(root, model, set) {
  root.replaceChildren(
    ...[
      hero(percent(model.share), accessSentence(model), model.mode === 'best' ? `${count(model.below)} people can't.` : null),
      model.compare ? el('p', 'note is-fare', model.compare) : null,
      fareLine(model),
      showSwitch('minutes', set, model.canShowFare, model.canShowBurden, model.canShowChoice),
      modePicker(model.mode, set, model.standardModes, model.slowWalk),
      legend('Minutes to the nearest', model.legend, { divider: 3, note: MODE_NOTES[model.mode] }),
      robustSection(model),
    ].filter(Boolean),
  );
}

/** The cost surface: what the cheapest way to reach the nearest one costs.
 *
 *  This answers a question the minutes map cannot. Two places can both be
 *  twenty minutes from a supermarket, and one of them pays nothing to get
 *  there while the other pays a three zone fare.
 */
export function renderFareSurface(root, model, set) {
  root.replaceChildren(
    hero(
      percent(model.freeShare),
      `of ${place.residents} can reach ${model.noun} within ${model.standard} minutes without paying a fare.`,
      model.paid > 0 ? `${count(model.paid)} more can, but only by paying.` : null,
    ),
    showSwitch('fare', set, true, model.canShowBurden, true),
    legend(`Cheapest way to reach ${model.noun}, ${model.trip}`, model.legend, { divider: 1, note: model.note }),
    el('p', 'note', `${count(model.none)} people cannot reach ${model.noun} within ${model.standard} minutes at any price without a car.`),
  );
}

/** Who misses out, area by area, sortable, and downloadable as a table. */
function areaSection(model, set) {
  const a = model.areas;
  const box = el('div', 'field areas');
  if (!a || !a.total) return box;
  box.append(el('span', 'field-label', 'By area'));
  if (a.levels.length > 1) {
    box.append(chipRow(a.levels, a.level, (areaLevel) => set({ areaLevel, areaAll: false }), ' chips-compact', 'Areas'));
  }
  box.append(chipRow([['missing', 'Most people'], ['share', 'Highest share']], a.sort, (areaSort) => set({ areaSort }), ' chips-compact chips-quiet', 'Sort by'));
  const list = el('ol', 'rank-list');
  for (const row of a.rows) {
    const item = el('li');
    const button = el('button', 'rank-row');
    button.type = 'button';
    const short = Number.isFinite(row.minutesShort) ? ` · ${Math.round(row.minutesShort)} min short` : '';
    button.append(
      el('span', 'rank-name', row.name),
      el('span', 'rank-meta', `${count(row.missing)} · ${percent(row.share)}`),
      el('span', 'rank-reason', `of ${count(row.people)} ${phrase(model.group)}${short}`),
    );
    button.addEventListener('click', () => set(a.level === 'board' ? { zoomBoard: row.area } : { zoomTo: row.area }));
    item.append(button);
    list.append(item);
  }
  box.append(list);
  const actions = el('div', 'area-actions');
  if (a.total > 10) {
    const more = el('button', 'text-button', a.showAll ? 'Show fewer' : `Show all ${a.total}`);
    more.type = 'button';
    more.addEventListener('click', () => set({ areaAll: !a.showAll }));
    actions.append(more);
  }
  const csv = el('button', 'text-button', 'Download as CSV');
  csv.type = 'button';
  csv.addEventListener('click', () => set({ download: true }));
  actions.append(csv);
  box.append(actions);
  return box;
}

/** The measures behind the tab, as numbers, for anyone who wants to cite them. */
function figures(model) {
  const bits = [];
  const fixed = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
  bits.push(`Headcount rate ${percent(model.rate, 1)}`);
  bits.push(`poverty gap index ${fixed(model.depth, 3)}`);
  bits.push(`squared gap index ${fixed(model.severity, 3)}`);
  if (Number.isFinite(model.lean)) bits.push(`concentration index of the shortfall by NZDep ${fixed(model.lean, 3)}`);
  const who = model.group === 'everyone' ? 'Everyone' : `${phrase(model.group)[0].toUpperCase()}${phrase(model.group).slice(1)}`;
  return `${who}: ${bits.join(', ').replace(/^Headcount/, 'headcount')}. The gap indices measure the shortfall as a share of the standard.`;
}

/** What the fare means against local income.
 *
 *  A dollar map says the same $6 everywhere. This says what $6 is to the
 *  people who pay it, and whether the places paying most of their income are
 *  the poorer ones.
 */
export function renderBurden(root, model, set) {
  const share = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%` : '–');
  const ratio = model.least > 0 ? model.most / model.least : NaN;
  // Per trip against a day's income, or per week against a week's.
  const period = model.week ? "a week's income" : "a day's income";
  const what = model.week ? 'a week of daily return trips' : `a ${model.trip} fare`;
  let figure = '–';
  let text = `Nobody here needs public transport to reach ${model.noun} within ${model.standard} minutes, or it can't get there in time.`;
  if (Number.isFinite(ratio)) {
    figure = `${ratio.toFixed(1)}×`;
    text = ratio >= 1.05
      ? `as much of ${period} goes on the fare to ${model.noun} in the most deprived areas as in the least deprived.`
      : ratio <= 0.95
        ? `the share of ${period} the fare to ${model.noun} takes in the most deprived areas, against the least deprived.`
        : `The fare to ${model.noun} takes about the same share of ${period} in more and less deprived areas.`;
  } else if (model.paying > 0) {
    // A city with no areas in one end of the deprivation scale has no ratio.
    figure = share(model.overall);
    text = `of ${period} goes on ${what} to ${model.noun}, on average.`;
  }
  const sub = model.paying > 0
    ? (Number.isFinite(ratio)
      ? `${what[0].toUpperCase()}${what.slice(1)} takes ${share(model.most)} of ${period} in the most deprived fifth of areas and ${share(model.least)} in the least. `
      : '') + `Counted for the ${count(model.paying)} people who would ride public transport there within ${model.standard} minutes.`
    : null;
  const chartQ = el('div', 'chart');
  bars(chartQ, model.byQuintile, {
    format: share,
    max: Math.max(...model.byQuintile.map((r) => r.value || 0), ...model.byGroup.map((r) => r.value || 0)) * 1.1 || 1,
    caption: `Share of ${period}, by neighbourhood deprivation`,
    label: 'Fare burden by NZDep quintile',
  });
  const chartG = el('div', 'chart');
  bars(chartG, [...model.byGroup].sort((a, b) => (b.value || 0) - (a.value || 0)), {
    format: share,
    max: Math.max(...model.byQuintile.map((r) => r.value || 0), ...model.byGroup.map((r) => r.value || 0)) * 1.1 || 1,
    caption: 'By group, at their own concession where one applies',
    label: 'Fare burden by group',
  });
  const meta = model.meta || {};
  root.replaceChildren(...[
    hero(figure, text, sub),
    showSwitch('burden', set, true, true, true),
    model.canWeek
      ? radios('Counting', [['trip', 'One return trip'], ['week', 'Every day for a week']], model.basket, (basket) => set({ basket }), { compact: true })
      : null,
    legend(`Fare to ${model.noun} by public transport, within ${model.standard} min, as a share of ${period}`, model.legend, { divider: 1 }),
    el('p', 'note', `${count(model.heavy)} ${phrase(model.group)} would spend 5% or more of ${period} on ${what}.`),
    model.week
      ? el('p', 'note', model.capped > 0
        ? `A fare cap lowers the week's cost for ${count(model.capped)} of them.`
        : 'No cap applies: a week of these trips stays under the cap, or this way of paying has none.')
      : null,
    chartQ,
    chartG,
    method(
      'How this is worked out',
      "Burden is the fare for the cheapest public transport trip that reaches the nearest one inside the standard, "
        + "divided by a day's income where the traveller lives. It counts whether or not the traveller could walk "
        + 'instead, but a trip short enough to be a walk the whole way needs no fare and is left out. The fare follows '
        + 'the traveller, payment and time chosen above; children and people 65 and over are priced at their own '
        + 'concession where the network has one.',
      "Income is the 2023 Census median household income of the area, divided by the square root of its average "
        + 'household size so a large household on the same income counts as less well off, and raised by '
        + `${((meta.uplift || 1) - 1) * 100 > 0 ? (((meta.uplift || 1) - 1) * 100).toFixed(1) : '0'}% for wage growth since `
        + 'then (average hourly earnings, March 2023 to June 2026). It is before tax, so against take-home pay the '
        + 'burden would be higher. Areas the census publishes above $200,000 are held at that figure.',
      'A trip that takes a share of a day\'s income, made every day, takes that share of income over a month. That is '
        + 'the 60-trip month the World Bank uses to judge whether public transport is affordable (Carruthers, Dick and '
        + 'Saurkar, 2005). Every day for a week counts a return trip each day after the network\'s daily and weekly '
        + 'caps, where it has them and the way of paying qualifies, and sets it against a week\'s income.',
      'Incomes describe an area, not a household, so a low-income household in a well-off area is counted at the '
        + "area's income.",
    ),
  ].filter(Boolean));
}

/** Who misses out, or where the group lives in the first place. */
function peopleSwitch(current, set) {
  return radios('Show', [['short', 'Who misses out'], ['live', 'Where they live']], current, (peopleShow) => set({ peopleShow }), { compact: true });
}

const capitalise = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** Where a group lives, set against its share across the whole place, and
 *  whether its concentrations can reach the service. */
function renderLive(root, model, set) {
  const s = model.summary;
  const everyone = model.group === 'everyone';
  const who = phrase(model.group);
  const withoutCar = model.group === 'no_car' ? '' : ' without a car';
  const reach = model.round
    ? roundSentence({ ...model.round, standard: model.standard }).replace(/^can /, '').replace(/\.$/, '')
    : `reach ${model.noun} within ${model.standard} minutes${withoutCar}${model.fare || ''}`;
  const parts = [];
  if (everyone) {
    parts.push(hero(count(s.everyone), `people live in ${place.name}.`, `${percent(s.missingRate)} can't ${reach}.`));
  } else {
    // With rest homes and villages left out, every figure is for the rest.
    const outside = model.villages && model.villages.out ? ' outside rest homes and retirement villages' : '';
    parts.push(hero(
      count(s.group),
      outside
        ? `${who} live in ${place.name}${outside}, ${percent(s.share, model.digits)} of the residents there.`
        : `${who} live in ${place.name}, ${percent(s.share, model.digits)} of residents.`,
      s.concentrated > 0
        ? `${count(s.concentrated)} of them (${percent(s.concentratedShare)}) live where they are at least one and a half times as common as across ${place.name}.`
        : null,
    ));
    if (s.concentrated > 0) {
      const line = el('p', 'lean');
      const worse = s.concentratedMissingRate > s.missingRate + 0.02;
      const better = s.concentratedMissingRate < s.missingRate - 0.02;
      line.append(
        el('span', `lean-dot ${worse ? 'is-away' : better ? 'is-toward' : 'is-even'}`),
        el('span', null, `There, ${percent(s.concentratedMissingRate)} can't ${reach}, against ${percent(s.missingRate)} of all ${who}${outside}.`),
      );
      parts.push(line);
    }
  }
  if (model.modeNote) parts.push(el('p', 'note', model.modeNote));
  parts.push(
    peopleSwitch('live', set),
    radios('People', chipLabels(model.groups), model.group, (group) => set({ group }), { compact: true }),
    radios('Map', [['all', everyone ? 'Everyone' : 'All of them'], ['missing', 'Only where they miss the standard']],
      model.missingOnly ? 'missing' : 'all', (value) => set({ liveMissing: value === 'missing' }), { compact: true }),
    model.villages
      ? radios('Rest homes and villages', [['out', 'Leave out'], ['in', 'Include']],
        model.villages.out ? 'out' : 'in', (value) => set({ liveVillages: value === 'in' }), { compact: true })
      : null,
    legend(everyone ? 'People per hexagon' : `${capitalise(who)}, as a share of residents`, model.legend, {
      divider: model.divider,
      note: everyone ? null : `Purple is above the ${place.name} share of ${percent(s.share, model.digits)}${model.villages && model.villages.out ? ', outside rest homes and villages' : ''}.`,
    }),
    model.villages ? villageKey(model.villages) : null,
    liveAreaSection(model, set),
    method(
      'How this is worked out',
      everyone
        ? 'Each hexagon is coloured by how many people live in it, from the 2023 Census.'
        : `Each hexagon is coloured by the share of its residents who are ${who}, set against their share across ${place.name}. `
          + 'Grey is below that share and purple above it; the darkest purple is twice it or more.',
      everyone ? '' : `A concentration is anywhere ${who} are at least ${model.concentrated === 1.5 ? 'one and a half' : model.concentrated} times as common as across the place. `
        + (model.group === 'older'
          ? 'Where older people gather like this without anyone planning it, it is sometimes called a naturally occurring retirement community.'
          : ''),
      model.round
        ? 'Whether a place makes the round is counted by the way of travelling, pace and longest stretch chosen for the round.'
        : 'Whether a place meets the standard is counted by the fastest of walking, low-stress cycling and public transport, '
          + 'for the service, standard, time and any fare set above.',
      model.group === 'older'
        ? (model.villages
          ? 'A census block counts as a rest home or retirement village when at least 60% of its residents are 65 or over, '
            + 'or when it holds an aged care facility on Health New Zealand\'s register and at least 30% are. '
            + 'Left out, the figures are for everyone else, most of them in their own homes. '
          : '')
          + `A suburb is marked NORC, a naturally occurring retirement community, when people 65 and over${model.villages ? ' outside rest homes and villages' : ''} `
          + `are at least one and a half times as common there as across ${place.name} and number at least 300.`
        : '',
      'Group figures come from census shares of the block around each hexagon, so they estimate people in an area rather than counting individuals.',
    ),
  );
  root.replaceChildren(...parts.filter(Boolean));
}

/** The rest home and village mark, apart from the share scale. */
function villageKey(villages) {
  const line = el('p', 'note village-key');
  const swatch = el('span', 'village-swatch');
  swatch.style.background = villages.colour;
  line.append(
    swatch,
    el('span', null, villages.out
      ? `Mostly rest homes or retirement villages. About ${count(villages.people)} people aged 65+ live in them, left out of these figures.`
      : `About ${count(villages.people)} people aged 65+ live in rest homes and retirement villages, counted here with everyone else.`),
  );
  if (!villages.out) swatch.remove();
  return line;
}

function liveAreaSection(model, set) {
  const a = model.areas;
  const box = el('div', 'field areas');
  if (!a || !a.total) return box;
  box.append(el('span', 'field-label', 'By area'));
  if (a.levels.length > 1) {
    box.append(chipRow(a.levels, a.level, (areaLevel) => set({ areaLevel, areaAll: false }), ' chips-compact', 'Areas'));
  }
  const everyone = model.group === 'everyone';
  if (!everyone) {
    box.append(chipRow([['missing', 'Most people'], ['share', 'Highest share']], a.sort, (areaSort) => set({ areaSort }), ' chips-compact chips-quiet', 'Sort by'));
  }
  if (a.norcs != null) {
    box.append(el('p', 'note', a.norcs > 0
      ? `${a.norcs} ${a.norcs === 1 ? 'suburb is a' : 'suburbs are'} naturally occurring retirement ${a.norcs === 1 ? 'community' : 'communities'} (NORC), with ${count(a.norcPeople)} people aged 65+.`
      : 'No suburb here is a naturally occurring retirement community (NORC) by this measure.'));
  }
  const list = el('ol', 'rank-list');
  for (const row of a.rows) {
    const item = el('li');
    const button = el('button', 'rank-row');
    button.type = 'button';
    const ofResidents = everyone ? '' : `, ${percent(row.ofResidents, model.digits)} of residents`;
    // With only the places that miss the standard shown, the list is ranked by
    // the people there who miss out, so that is the number it leads with.
    const task = model.round ? `make the round in ${model.standard} min` : `reach ${model.noun} in ${model.standard} min`;
    const reason = model.missingOnly
      ? `of ${count(row.people)} here${ofResidents}, can't ${task}`
      : `${everyone ? '' : `${percent(row.ofResidents, model.digits)} of residents · `}${percent(row.share)} can't ${task}`;
    const name = el('span', 'rank-name', row.name);
    if (row.norc) name.append(' ', el('span', 'tag', 'NORC'));
    button.append(
      name,
      el('span', 'rank-meta', count(model.missingOnly ? row.missing : row.people)),
      el('span', 'rank-reason', reason),
    );
    button.addEventListener('click', () => set(a.level === 'board' ? { zoomBoard: row.area } : { zoomTo: row.area }));
    item.append(button);
    list.append(item);
  }
  box.append(list);
  const actions = el('div', 'area-actions');
  if (a.total > 10) {
    const more = el('button', 'text-button', a.showAll ? 'Show fewer' : `Show all ${a.total}`);
    more.type = 'button';
    more.addEventListener('click', () => set({ areaAll: !a.showAll }));
    actions.append(more);
  }
  const csv = el('button', 'text-button', 'Download as CSV');
  csv.type = 'button';
  csv.addEventListener('click', () => set({ download: true }));
  actions.append(csv);
  box.append(actions);
  return box;
}

export function renderPeople(root, model, set) {
  if (model.live) {
    renderLive(root, model, set);
    return;
  }
  const chartG = el('div', 'chart');
  const chartQ = el('div', 'chart');
  // Groups are sorted worst first, with the regional rate as the line to beat.
  bars(chartG, model.byGroup, {
    format: (v) => percent(v),
    caption: 'Share missing the standard, and how far short on average',
    label: 'Share missing the standard by group, with average minutes short',
  });
  bars(chartQ, model.byQuintile, {
    format: (v) => percent(v),
    caption: `Share missing the standard, by neighbourhood deprivation${model.group !== 'everyone' ? `, ${phrase(model.group)}` : ''}`,
    label: 'Share missing the standard by NZDep',
  });

  const withoutCar = model.group === 'no_car' ? '' : ' without a car';
  const depth = Number.isFinite(model.minutesShort)
    ? `Those who miss out are ${Math.round(model.minutesShort)} minutes over it, on average.`
    : null;

  const parts = [
    hero(
      count(model.below),
      model.round
        ? `${phrase(model.group)} ${roundSentence({ ...model.round, standard: model.standard }, true)}`
        : `${phrase(model.group)} can't reach ${model.noun} within ${model.standard} minutes${withoutCar}${model.fare || ''}.`,
      depth,
    ),
  ];

  if (model.modeNote) parts.push(el('p', 'note', model.modeNote));

  // The split no other tool can make: near enough, but priced out of it.
  if (model.split && (model.split.priced > 0 || model.split.distance > 0)) {
    const box = el('div', 'split');
    const priced = el('div', 'split-row');
    priced.append(el('strong', null, count(model.split.priced)), el('span', null, 'could get there in time, but not on this budget'));
    const far = el('div', 'split-row');
    far.append(el('strong', null, count(model.split.distance)), el('span', null, 'are too far away at any price'));
    box.append(priced, far);
    parts.push(box);
  }

  if (model.leanText) {
    // The shortfall landing on more deprived areas is the unfair direction.
    const lean = el('p', 'lean');
    lean.append(el('span', `lean-dot ${model.lean < -0.02 ? 'is-away' : model.lean > 0.02 ? 'is-toward' : 'is-even'}`), el('span', null, model.leanText));
    parts.push(lean);
  }

  parts.push(
    peopleSwitch('short', set),
    radios('People', chipLabels(model.groups), model.group, (group) => set({ group }), { compact: true }),
    legend('People missing out × minutes short, per hexagon', model.legend),
    chartG,
    chartQ,
    areaSection(model, set),
    method(
      'How this is worked out',
      'A headcount cannot tell a place three minutes over the standard from one forty minutes over, so the '
        + 'map shows both together: how many people miss out, and how far short they are.',
      'These are the Foster-Greer-Thorbecke measures, with the access standard used as the line. Somewhere '
        + 'with no route at all counts at the routing limit rather than being left out, because dropping it '
        + 'would flatter the result exactly where things are worst.',
      'Where the shortfall falls is a concentration index of the shortfall, ranking people by deprivation '
        + 'rather than by their own access, so it can say whether the places missing out are the poorer ones. '
        + 'A measure of spread alone, such as a Gini, cannot answer that.',
      'Group figures come from census shares of the block around each hexagon, so they estimate people in an '
        + 'area rather than counting individuals.',
      figures(model),
    ),
  );
  root.replaceChildren(...parts);
}

export function renderFixes(root, model, set) {
  const top = model.reasons.reduce((a, b) => (b.people > a.people ? b : a), model.reasons[0]);
  const sub = top && top.people > 0 && model.below > 0
    ? `For ${count(top.people)} of them (${percent(top.people / model.below)}), ${REASON_SENTENCE[top.cls]}.`
    : null;
  const list = el('ul', 'reason-list');
  for (const reason of model.reasons) {
    const item = el('li');
    const row = el('button', `reason-row${model.focus === reason.cls ? ' is-focus' : ''}`);
    row.type = 'button';
    row.setAttribute('aria-pressed', String(model.focus === reason.cls));
    item.append(row);
    const swatch = el('span', 'reason-swatch');
    swatch.style.background = reason.colour;
    const text = el('span', 'reason-text');
    text.append(el('strong', null, reason.label), el('span', 'reason-fix', reason.fix));
    row.append(swatch, text, el('span', 'reason-count', count(reason.people)));
    row.addEventListener('click', () => set({ reason: model.focus === reason.cls ? null : reason.cls }));
    list.append(item);
  }
  const ranked = el('ol', 'rank-list');
  for (const place of model.ranked) {
    const item = el('li');
    const button = el('button', 'rank-row');
    button.type = 'button';
    const name = el('span', 'rank-name', place.name);
    const meta = el('span', 'rank-meta', `${count(place.below)} ${phrase(model.group)}`);
    const chip = el('span', 'rank-reason');
    const dot = el('span', 'reason-dot');
    dot.style.background = place.colour;
    chip.append(dot, document.createTextNode(place.reasonLabel));
    button.append(name, meta, chip);
    button.addEventListener('click', () => set({ zoomTo: place.index }));
    item.append(button);
    ranked.append(item);
  }
  root.replaceChildren(
    hero(count(model.below), `${phrase(model.group)} miss the ${model.standard}-minute standard for ${model.noun}${model.fare || ''}.`, sub),
    radios('People', chipLabels(model.groups), model.group, (group) => set({ group }), { compact: true }),
    el('span', 'field-label', 'Main reason, and what would help'),
    list,
    el('p', 'note', 'Screening rules, not a verdict: they show which kind of fix to look at first. Pick a reason to show only those places.'),
    el('span', 'field-label', 'Where most people miss out'),
    ranked,
  );
}

export function renderJobsAccess(root, model, set) {
  const modeOptions = [['pt', 'Public transport'], ['bike_low_stress', 'Low-stress cycling'], ['bike', 'Any bike route'], ['walk', 'Walking'], ['car', 'Car']]
    .filter(([m]) => model.modes.includes(m));
  // Jobs lead with a count, which compares across cities; the share of the
  // city's own jobs follows.
  const jobsCount = Number.isFinite(model.median) && model.total ? Math.round((model.median / 100) * model.total) : NaN;
  const shareText = percent(model.median / 100, model.median < 10 ? 1 : 0);
  const byMode = model.priced ? 'public transport' : MODES[model.mode].short;
  const figure = model.fair ? `${model.median.toFixed(2)}×` : Number.isFinite(jobsCount) ? count(jobsCount) : shareText;
  const text = model.fair
    ? `the average: job access for a typical resident by ${byMode} within ${model.limit} minutes${model.when || ''}, allowing for everyone else who could reach the same jobs.`
    : `jobs within ${model.limit} minutes by ${byMode}${model.priced ? model.fare : model.when || ''}, for a typical resident. That is ${shareText} of ${place.possessive} jobs.`;
  const toggle = el('label', 'check');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = model.fair;
  box.disabled = !model.fairAvailable;
  box.addEventListener('change', () => set({ jobsFair: box.checked }));
  toggle.append(box, document.createTextNode(' Allow for other workers competing for the same jobs'));
  root.replaceChildren(
    ...[
      hero(figure, text),
      model.priced
        ? el('p', 'note is-fare', model.fareNote ? `With a fare budget, jobs are counted within ${model.limit} minutes. ${model.fareNote}` : model.zones === 0
          ? 'On this budget no fare is affordable, so no job is reachable by public transport.'
          : `With a fare budget, jobs are counted within ${model.limit} minutes, on trips inside ${model.zones} fare ${model.zones === 1 ? 'zone' : 'zones'}.`)
        : null,
      radios('Travel by', modeOptions, model.mode, (jobsMode) => set({ jobsMode }), { compact: true }),
    ].filter(Boolean),
    ...(model.priced ? [] : [radios('Within', model.limits.map((l) => [String(l), `${l} min`]), String(model.limit), (jobsLimit) => set({ jobsLimit }), { compact: true })]),
    ...(model.priced ? [] : [toggle]),
    legend(model.fair ? `Job access against the ${place.name} average by ${MODES[model.mode].short}` : `Share of ${place.possessive} jobs within reach`, model.legend, {
      note: model.fair
        ? 'Divides the jobs at each place by the working-age people who could get there in time by car or by this mode, '
          + `then adds up what each home can reach. 1.0 is the ${place.name} average by this mode.`
        : 'Jobs counted from Stats NZ business demography (2024), by where people work.',
    }),
  );
}

export function renderJobsPeople(root, model) {
  const chartQ = el('div', 'chart');
  const chartG = el('div', 'chart');
  const format = (v) => (Number.isFinite(v) ? `${v.toFixed(v < 10 ? 1 : 0)}%` : '–');
  bars(chartQ, model.byQuintile, { format, max: model.max, caption: `Typical share of jobs within ${model.limit} min by ${MODES[model.mode].short}, by deprivation` });
  bars(chartG, model.byGroup, { format, max: model.max, caption: 'By group' });
  const how = `By ${MODES[model.mode].short}, within ${model.limit} minutes${model.fare || model.when || ''}.`;
  // The least-served 40% can reach nothing at all on a tight budget, and then
  // there is no ratio to give.
  const heroBox = Number.isFinite(model.palma)
    ? hero(`${model.palma.toFixed(1)}×`, `as many jobs for the best-served tenth of residents as for the least-served 40%.`, how)
    : hero('0', `jobs within reach for the least-served 40% of residents.`, how);
  let lean = null;
  if (model.leanText) {
    lean = el('p', 'lean');
    lean.append(el('span', `lean-dot ${model.lean < -0.02 ? 'is-toward' : model.lean > 0.02 ? 'is-away' : 'is-even'}`), el('span', null, model.leanText));
  }
  root.replaceChildren(...[heroBox, lean, chartQ, chartG].filter(Boolean));
}

export function renderJobsFixes(root) {
  root.replaceChildren(
    el('p', 'hero-text', 'Jobs have no single standard, so there is no reason map for them.'),
    el('p', 'note', 'Use Access to see where job access is lowest, and Who misses out to see how it differs by deprivation and group. Reasons are mapped for every destination with a time standard.'),
  );
}


const SCORE_NOUN = {
  jobs: 'jobs',
  everyday: 'everyday services',
  education: 'schools',
  all: 'opportunities',
};

export function renderScore(root, model, set) {
  const { key, mode, display, median, palma, keys, modes, byQuintile, note } = model;
  const noun = SCORE_NOUN[key] || 'opportunities';
  const modeLabel = MODES[mode] ? MODES[mode].short : mode;
  const figure = Number.isFinite(median) ? String(Math.round(median)) : '–';
  const text = model.when
    ? `is the typical score for ${noun} by ${modeLabel}${model.when}, where 100 is the ${place.name} average at the usual time.`
    : `is the typical score for ${noun} by ${modeLabel}, where 100 is the ${place.name} average.`;
  const sub = Number.isFinite(palma)
    ? `The best-served tenth of residents score ${palma.toFixed(1)} times the least-served 40%.`
    : null;
  const chart = el('div', 'chart');
  bars(chart, byQuintile, {
    format: (v) => (Number.isFinite(v) ? String(Math.round(v)) : '–'),
    caption: 'Typical score by neighbourhood deprivation',
    label: 'Score by NZDep quintile',
  });
  let lean = null;
  if (model.leanText) {
    lean = el('p', 'lean');
    lean.append(el('span', `lean-dot ${model.lean < -0.02 ? 'is-toward' : model.lean > 0.02 ? 'is-away' : 'is-even'}`), el('span', null, model.leanText));
  }
  root.replaceChildren(
    ...[hero(figure, text, sub), lean].filter(Boolean),
    radios('Score for', keys, key, (value) => set({ scoreKey: value }), { compact: true }),
    radios('By', modes, mode, (value) => set({ scoreMode: value }), { compact: true }),
    radios('Show', [['index', 'Score'], ['decile', 'Decile']], display, (value) => set({ scoreDisplay: value }), { compact: true }),
    legend(display === 'decile' ? 'Decile: 1 is the tenth of residents with the least access' : `Score, where 100 is the ${place.name} average`, model.legend),
    chart,
    method('How this is worked out', note),
  );
}


// ------------------------------------------------------------------ traveller

/** The controls behind the traveller line: who is travelling, how they pay,
 *  and whether the budget has to cover the trip home. Age is a scenario here,
 *  not a filter: it decides what a journey costs, not who gets counted. */
export function renderTraveller(root, model, set) {
  const profiles = (model.profiles || []).map((p) => [p.key, p.label]);
  const fields = [
    radios('Travelling as', profiles, model.profile, (profile) => set({ profile }), { compact: true }),
    radios('Paying with', model.payments, model.payment, (payment) => set({ payment }), { compact: true }),
    radios('Budget covers', [['return', 'There and back'], ['one', 'One way']], model.returnTrip ? 'return' : 'one',
      (value) => set({ returnTrip: value === 'return' }), { compact: true }),
  ];
  const ages = (model.profiles || []).find((p) => p.key === model.profile);
  if (ages && ages.ages && !String(ages.ages).startsWith('any')) {
    fields.push(el('p', 'note', `${ages.label} fares: ages ${ages.ages}.`));
  }
  fields.push(el('p', 'note', model.timeNote));
  root.replaceChildren(...fields);
}


// ---------------------------------------------------------------- errand rounds

const STOP_NAME = {
  gp: 'the GP', pharmacy: 'the pharmacy', supermarket: 'the supermarket', library: 'the library', bank_post: 'the bank or post shop',
};
const ROUND_HOW = {
  walk: 'walk',
  pt: 'walk or take public transport',
  bike_low_stress: 'cycle on low-stress routes',
};
const ROUND_WAYS = [['walk', 'Walking'], ['pt', 'Walking and public transport'], ['bike_low_stress', 'Low-stress cycling']];

/** "the GP, the pharmacy and the supermarket" */
export function stopList(stops) {
  const names = stops.map((s) => STOP_NAME[s] || SERVICE_NOUN[s] || s);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '';
}

/** Chips that turn on and off independently, for choosing the stops. A round
 *  has at least two stops and at most `most`. */
function toggles(label, options, selected, onToggle, most = options.length) {
  const field = el('div', 'field');
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const title = el('span', 'field-label', label);
  title.id = id;
  const group = el('div', 'chips chips-compact');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', id);
  group.dataset.group = id;
  for (const [value, text] of options) {
    const on = selected.includes(value);
    const button = el('button', 'chip', text);
    button.type = 'button';
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', String(on));
    button.dataset.value = value;
    // A round needs two stops, so the last two cannot be turned off; and it
    // has at most `most`, so a full round takes no more.
    if (on && selected.length <= 2) {
      button.disabled = true;
      button.title = 'A round needs at least two stops';
    } else if (!on && selected.length >= most) {
      button.disabled = true;
      button.title = `A round has up to ${most} stops`;
    }
    button.addEventListener('click', () => onToggle(value));
    group.append(button);
  }
  field.append(title, group);
  return field;
}

export function roundSentence(model, negative = false) {
  const pace = model.slow ? ' at a slower pace' : '';
  const leg = model.leg === 'any' ? '' : `, with no stretch longer than ${model.leg} minutes`;
  return `can${negative ? "'t" : ''} ${ROUND_HOW[model.mode]}${pace} to ${stopList(model.stops)}, and home again, within ${model.standard} minutes${leg}.`;
}

/** One trip from home to several services and back. */
export function renderErrands(root, model, set) {
  const parts = [
    hero(percent(model.share), `of ${place.residents} ${roundSentence(model)}`, `${count(model.below)} people can't.`),
  ];
  if (model.single) {
    parts.push(el('p', 'note', `For one trip on its own, ${percent(model.single.share)} can ${ROUND_HOW[model.mode]}${model.slow ? ' at the same pace' : ''} to ${STOP_NAME[model.single.stop] || SERVICE_NOUN[model.single.stop]} within ${model.single.standard} minutes.`));
  }
  parts.push(
    toggles('Stops', model.allStops.map((s) => [s, SERVICE_SHORT[s] || s]), model.stops, (stop) => set({ errandToggle: stop }), model.maxStops),
    radios('Travel by', ROUND_WAYS.filter(([m]) => model.modes.includes(m)), model.mode, (errandMode) => set({ errandMode }), { compact: true }),
    model.mode === 'bike_low_stress' || !model.slowKmh ? null : radios('Walking pace', [['usual', 'Usual, 4.8 km/h'], ['slow', `Slower, ${model.slowKmh} km/h`]],
      model.slow ? 'slow' : 'usual', (pace) => set({ pace }), { compact: true }),
    radios('Longest stretch', [...model.legLimits.map((m) => [String(m), `${m} min`]), ['any', 'No limit']], model.leg,
      (errandLeg) => set({ errandLeg }), { compact: true }),
    legend('Minutes of travel for the whole round', model.legend, { divider: 3 }),
    method(
      'How this is worked out',
      'A round starts at home, stops at each place in turn and comes home again. Its length is the travel time only, '
        + 'not the time spent inside. The pharmacy comes after the GP, where the prescription is written; the other stops '
        + 'can come in any order.',
      `Each home tries the ${model.candidates} nearest of each kind of stop in every order allowed and keeps the quickest `
        + 'round. The nearest GP and then the pharmacy nearest to it can miss a better round, such as a GP a little further '
        + 'off with a pharmacy next door.',
      'A limit on the longest stretch keeps only rounds where no single walk or ride is longer than that, because many '
        + 'people can manage several short walks and not one long one.',
      `The slower pace is 3.6 km/h, about the walking speed of people in their eighties. Hills slow walking and cycling. `
        + `Public transport is timed ${model.windowText}. The way home from the last stop is routed for walking and cycling, `
        + 'so a climb home counts; by public transport it is taken as the way out. Opening hours are not checked.',
    ),
  );
  root.replaceChildren(...parts.filter(Boolean));
}
