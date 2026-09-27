// The left panel: what to reach, the three views, and their controls.
// Every function here renders from a model built in app.js; none of them
// computes figures.

import { bars } from './charts.js';
import { count, el, minutes, MODE_NOTES, MODES, percent, place } from './format.js';

// Everyday errands first, then education in the order a child meets it, then
// jobs. A service the build does not have is dropped by setServices.
const PREFERRED_ORDER = [
  'supermarket', 'gp', 'pharmacy',
  'early_childhood', 'primary_school', 'intermediate_school', 'secondary_school',
  'jobs',
];

export let SERVICE_ORDER = [...PREFERRED_ORDER];

export const SERVICE_SHORT = {
  supermarket: 'Supermarket',
  gp: 'GP',
  pharmacy: 'Pharmacy',
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
};

function radios(label, options, current, onPick, { compact = false } = {}) {
  const field = el('div', 'field');
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const title = el('span', 'field-label', label);
  title.id = id;
  const group = el('div', `chips${compact ? ' chips-compact' : ''}`);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', id);
  for (const [value, text] of options) {
    const button = el('button', 'chip', text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    button.addEventListener('click', () => onPick(value));
    group.append(button);
  }
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
  box.append(head, ...paragraphs.map((text) => el('p', 'method-text', text)));
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
  { key: 'everyday', label: 'Everyday', members: ['supermarket', 'gp', 'pharmacy'] },
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

function chipRow(options, current, onPick, extraClass = '') {
  const row = el('div', `chips${extraClass}`);
  row.setAttribute('role', 'radiogroup');
  for (const [value, text] of options) {
    const button = el('button', 'chip', text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    button.addEventListener('click', () => onPick(value));
    row.append(button);
  }
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
  const buttons = options.map(([value, text, title]) => {
    const button = el('button', 'chip', text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    if (title) button.title = title;
    button.addEventListener('click', () => onPick(value));
    return button;
  });
  root.replaceChildren(...buttons);
}

export function renderServicePicker(root, current, set) {
  const groups = groupsPresent();
  const active = groupOf(current);
  const inGroup = (groups.find((g) => g.key === active) || groups[0]).members;
  const rows = [
    chipRow(groups.map((g) => [g.key, g.label]), active, (key) => {
      const group = groups.find((g) => g.key === key);
      if (group && !group.members.includes(current)) set({ service: group.members[0] });
    }),
  ];
  // One destination in a kind needs no second row to choose from.
  if (inGroup.length > 1) {
    rows.push(chipRow(inGroup.map((id) => [id, SERVICE_SHORT[id]]), current, (id) => set({ service: id }), ' chips-sub'));
  }
  root.replaceChildren(...rows);
}

function accessSentence(model) {
  const { noun, standard, mode, fare = '' } = model;
  switch (mode) {
    case 'walk':
      return `of ${place.residents} can walk to ${noun} within ${standard} minutes.`;
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
function modePicker(current, set, standardModes) {
  const counts = ['best', ...standardModes];
  const compare = Object.keys(MODES).filter((m) => !counts.includes(m));
  const field = el('div', 'field');
  const title = el('span', 'field-label', 'Travel by');
  field.append(title, chipRow(counts.map((m) => [m, MODES[m].label]), current, (mode) => set({ mode }), ' chips-compact'));
  if (compare.length) {
    const row = el('div', 'compare-row');
    row.append(el('span', 'compare-label', 'Compare with'));
    row.append(chipRow(compare.map((m) => [m, MODES[m].label]), current, (mode) => set({ mode }), ' chips-compact chips-quiet'));
    field.append(row);
  }
  return field;
}

function showSwitch(current, set, available, burden = false) {
  if (!available) return null;
  const options = [['minutes', 'Minutes'], ['fare', 'What it costs']];
  if (burden) options.push(['burden', 'Share of income']);
  return radios('Show', options, current, (show) => set({ show }), { compact: true });
}

export function renderAccess(root, model, set) {
  root.replaceChildren(
    ...[
      hero(percent(model.share), accessSentence(model), model.mode === 'best' ? `${count(model.below)} people can't.` : null),
      fareLine(model),
      showSwitch('minutes', set, model.canShowFare, model.canShowBurden),
      modePicker(model.mode, set, model.standardModes),
      legend('Minutes to the nearest', model.legend, { divider: 3, note: MODE_NOTES[model.mode] }),
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
    showSwitch('fare', set, true, model.canShowBurden),
    legend(`Cheapest way to reach ${model.noun}, ${model.trip}`, model.legend, { divider: 1, note: model.note }),
    el('p', 'note', `${count(model.none)} people cannot reach ${model.noun} within ${model.standard} minutes at any price without a car.`),
  );
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
  let figure = '–';
  let text = `Nobody here has to pay to reach ${model.noun} within ${model.standard} minutes.`;
  if (Number.isFinite(ratio)) {
    figure = `${ratio.toFixed(1)}×`;
    text = ratio >= 1.05
      ? `as much of a day's income goes on the fare to ${model.noun} in the most deprived areas as in the least deprived.`
      : ratio <= 0.95
        ? `the share of a day's income the fare to ${model.noun} takes in the most deprived areas, against the least deprived.`
        : `The fare to ${model.noun} takes about the same share of a day's income in more and less deprived areas.`;
  } else if (model.paying > 0) {
    figure = share(model.most || model.least);
    text = `of a day's income goes on a ${model.trip} fare to ${model.noun}, for the people who have to pay.`;
  }
  const sub = Number.isFinite(ratio)
    ? `A ${model.trip} fare takes ${share(model.most)} of a day's income in the most deprived fifth of areas and ${share(model.least)} in the least, for the ${count(model.paying)} people who have to pay to get there in time.`
    : null;
  const chartQ = el('div', 'chart');
  bars(chartQ, model.byQuintile, {
    format: share,
    max: Math.max(...model.byQuintile.map((r) => r.value || 0), ...model.byGroup.map((r) => r.value || 0)) * 1.1 || 1,
    caption: "Share of a day's income, for those who pay, by neighbourhood deprivation",
    label: 'Fare burden by NZDep quintile',
  });
  const chartG = el('div', 'chart');
  bars(chartG, [...model.byGroup].sort((a, b) => (b.value || 0) - (a.value || 0)), {
    format: share,
    max: Math.max(...model.byQuintile.map((r) => r.value || 0), ...model.byGroup.map((r) => r.value || 0)) * 1.1 || 1,
    caption: 'By group, for those who pay',
    label: 'Fare burden by group',
  });
  const meta = model.meta || {};
  root.replaceChildren(
    hero(figure, text, sub),
    showSwitch('burden', set, true, true),
    legend(`Cheapest way to reach ${model.noun} within ${model.standard} min, as a share of a day's income`, model.legend, { divider: 1 }),
    el('p', 'note', `${count(model.heavy)} ${phrase(model.group)} would spend 5% or more of a day's income on the ${model.trip} fare.`),
    chartQ,
    chartG,
    method(
      'How this is worked out',
      "Burden is the fare for the cheapest way to reach the nearest one inside the standard, divided by a day's "
        + 'income where the traveller lives. The fare follows the traveller, payment and time chosen above.',
      "Income is the 2023 Census median household income of the area, divided by the square root of its average "
        + 'household size so a large household on the same income counts as less well off, and raised by '
        + `${((meta.uplift || 1) - 1) * 100 > 0 ? (((meta.uplift || 1) - 1) * 100).toFixed(1) : '0'}% for wage growth since `
        + 'then (average hourly earnings, March 2023 to June 2026). It is before tax, so against take-home pay the '
        + 'burden would be higher. Areas the census publishes above $200,000 are held at that figure.',
      'A trip that takes a share of a day\'s income, made every day, takes that share of income over a month. That is '
        + 'the 60-trip month the World Bank uses to judge whether public transport is affordable (Carruthers, Dick and '
        + 'Saurkar, 2005). Weekly fare caps would lower the cost of travelling that often, and are not applied here.',
      'Incomes describe an area, not a household, so a low-income household in a well-off area is counted at the '
        + "area's income.",
    ),
  );
}

export function renderPeople(root, model, set) {
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
    caption: 'Share meeting the standard, by neighbourhood deprivation',
    label: 'Share meeting the standard by NZDep',
  });

  const withoutCar = model.group === 'no_car' ? '' : ' without a car';
  const depth = Number.isFinite(model.minutesShort)
    ? `On average they are ${Math.round(model.minutesShort)} minutes short of it.`
    : null;

  const parts = [
    hero(
      count(model.below),
      `${phrase(model.group)} can't reach ${model.noun} within ${model.standard} minutes${withoutCar}${model.fare || ''}.`,
      depth,
    ),
  ];

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
    radios('Count', chipLabels(model.groups), model.group, (group) => set({ group }), { compact: true }),
    legend('Where the shortfall piles up: how many people, and how far short', model.legend),
    chartG,
    chartQ,
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
  const list = el('div', 'reason-list');
  list.setAttribute('role', 'list');
  for (const reason of model.reasons) {
    const row = el('button', `reason-row${model.focus === reason.cls ? ' is-focus' : ''}`);
    row.type = 'button';
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-pressed', String(model.focus === reason.cls));
    const swatch = el('span', 'reason-swatch');
    swatch.style.background = reason.colour;
    const text = el('span', 'reason-text');
    text.append(el('strong', null, reason.label), el('span', 'reason-fix', reason.fix));
    row.append(swatch, text, el('span', 'reason-count', count(reason.people)));
    row.addEventListener('click', () => set({ reason: model.focus === reason.cls ? null : reason.cls }));
    list.append(row);
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
    radios('Count', chipLabels(model.groups), model.group, (group) => set({ group }), { compact: true }),
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
  const figure = model.fair ? `${model.median.toFixed(2)}×` : percent(model.median / 100, model.median < 10 ? 1 : 0);
  const text = model.priced
    ? `of ${place.possessive} jobs are within ${model.limit} minutes by public transport for a typical resident${model.fare}.`
    : model.fair
      ? `the regional average: job access for a typical resident by ${MODES[model.mode].short}, within ${model.limit} minutes, allowing for other workers who can reach the same jobs.`
      : `of ${place.possessive} jobs are within ${model.limit} minutes by ${MODES[model.mode].short}${model.when || ''} for a typical resident.`;
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
        ? el('p', 'note is-fare', model.fareNote ? `Counted over ${model.limit} minutes. ${model.fareNote}` : model.zones === 0
          ? 'On this budget no fare is affordable, so no job is reachable by public transport.'
          : `Counted over ${model.limit} minutes, the cap the priced layer is built at, and only where the trip stays inside ${model.zones} fare ${model.zones === 1 ? 'zone' : 'zones'}.`)
        : null,
      radios('Travel by', modeOptions, model.mode, (jobsMode) => set({ jobsMode }), { compact: true }),
    ].filter(Boolean),
    ...(model.priced ? [] : [radios('Within', model.limits.map((l) => [String(l), `${l} min`]), String(model.limit), (jobsLimit) => set({ jobsLimit }), { compact: true })]),
    ...(model.priced ? [] : [toggle]),
    legend(model.fair ? 'Job access against the regional average' : `Share of ${place.possessive} jobs within reach`, model.legend, {
      note: model.fair
        ? 'Divides the jobs at each place by the working-age people who can reach them, then adds up what each home can reach. '
          + `1.0 is the ${place.name} average.`
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
  root.replaceChildren(
    hero(`${model.palma.toFixed(1)}×`, `The best-served tenth of residents can reach ${model.palma.toFixed(1)} times as many jobs as the least-served 40%.`, `By ${MODES[model.mode].short}, within ${model.limit} minutes.`),
    chartQ,
    chartG,
  );
}

export function renderJobsFixes(root) {
  root.replaceChildren(
    el('p', 'hero-text', 'Jobs have no single standard, so there is no reason map for them.'),
    el('p', 'note', 'Use Access to see where job access is lowest, and Who misses out to see how it differs by deprivation and group. The reason maps cover the six everyday services.'),
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
    ? `is the typical ${place.name} score for ${noun} by ${modeLabel}${model.when}, where 100 is the regional average at the usual time.`
    : `is the typical ${place.name} score for ${noun} by ${modeLabel}, where 100 is the regional average.`;
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
    el('p', 'note', note),
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
  if (ages && ages.ages && ages.ages !== 'any') {
    fields.push(el('p', 'note', `Fares for ${ages.label.toLowerCase()} apply to ages ${ages.ages}.`));
  }
  fields.push(el('p', 'note', model.timeNote));
  root.replaceChildren(...fields);
}
