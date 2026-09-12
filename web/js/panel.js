// The left panel: what to reach, the three views, and their controls.
// Every function here renders from a model built in app.js; none of them
// computes figures.

import { bars } from './charts.js';
import { count, el, minutes, MODE_NOTES, MODES, percent } from './format.js';

export const SERVICE_ORDER = [
  'supermarket', 'gp', 'pharmacy', 'primary_school', 'intermediate_school', 'secondary_school', 'jobs',
];

export const SERVICE_SHORT = {
  supermarket: 'Supermarket',
  gp: 'GP',
  pharmacy: 'Pharmacy',
  primary_school: 'Primary school',
  intermediate_school: 'Intermediate',
  secondary_school: 'Secondary school',
  jobs: 'Jobs',
};

export const SERVICE_NOUN = {
  supermarket: 'a supermarket',
  gp: 'a GP',
  pharmacy: 'a pharmacy',
  primary_school: 'a primary school',
  intermediate_school: 'an intermediate school',
  secondary_school: 'a secondary school',
};

const GROUP_PHRASE = {
  everyone: 'people',
  no_car: 'people in households without a car',
  children: 'children under 15',
  older: 'people aged 65 and over',
};

const GROUP_CHIPS = [
  ['everyone', 'Everyone'],
  ['no_car', 'No car'],
  ['children', 'Children'],
  ['older', '65 and over'],
];

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

export function renderServicePicker(root, current, set) {
  root.replaceChildren(
    ...SERVICE_ORDER.map((id) => {
      const button = el('button', 'chip', SERVICE_SHORT[id]);
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(id === current));
      button.addEventListener('click', () => set({ service: id }));
      return button;
    }),
  );
}

function accessSentence(model) {
  const { noun, standard, mode } = model;
  switch (mode) {
    case 'walk':
      return `of Aucklanders can walk to ${noun} within ${standard} minutes.`;
    case 'bike_low_stress':
      return `of Aucklanders can cycle to ${noun} within ${standard} minutes on low-stress routes.`;
    case 'bike':
      return `of Aucklanders could cycle to ${noun} within ${standard} minutes on any street.`;
    case 'pt':
      return `of Aucklanders can reach ${noun} within ${standard} minutes by public transport.`;
    case 'car':
      return `of Aucklanders can drive to ${noun} within ${standard} minutes.`;
    default:
      return `of Aucklanders can reach ${noun} within ${standard} minutes without a car.`;
  }
}

export function renderAccess(root, model, set) {
  root.replaceChildren(
    hero(percent(model.share), accessSentence(model), model.mode === 'best' ? `${count(model.below)} people can't.` : null),
    radios('Travel by', Object.keys(MODES).map((m) => [m, MODES[m].label]), model.mode, (mode) => set({ mode }), { compact: true }),
    legend('Minutes to the nearest', model.legend, { divider: 3, note: MODE_NOTES[model.mode] }),
  );
}

export function renderPeople(root, model, set) {
  const chartQ = el('div', 'chart');
  const chartG = el('div', 'chart');
  bars(chartQ, model.byQuintile, {
    format: (v) => percent(v),
    caption: 'Share meeting the standard, by neighbourhood deprivation',
    label: 'Share meeting the standard by NZDep',
  });
  bars(chartG, model.byGroup, {
    format: (v) => percent(v),
    caption: 'Share meeting the standard, by group',
    label: 'Share meeting the standard by group',
  });
  const sub = Number.isFinite(model.q5) && Number.isFinite(model.q1)
    ? `In the most deprived fifth of neighbourhoods, ${percent(model.q5)} can, against ${percent(model.q1)} in the least deprived.`
    : null;
  const withoutCar = model.group === 'no_car' ? '' : ' without a car';
  root.replaceChildren(
    hero(count(model.below), `${GROUP_PHRASE[model.group]} can't reach ${model.noun} within ${model.standard} minutes${withoutCar}.`, sub),
    radios('Count', GROUP_CHIPS, model.group, (group) => set({ group }), { compact: true }),
    legend(`${GROUP_PHRASE[model.group][0].toUpperCase()}${GROUP_PHRASE[model.group].slice(1)} beyond the standard, per hexagon`, model.legend),
    chartQ,
    chartG,
  );
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
    const meta = el('span', 'rank-meta', `${count(place.below)} ${model.group === 'everyone' ? 'people' : GROUP_PHRASE[model.group]}`);
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
    hero(count(model.below), `${GROUP_PHRASE[model.group]} miss the ${model.standard}-minute standard for ${model.noun}.`, sub),
    radios('Count', GROUP_CHIPS, model.group, (group) => set({ group }), { compact: true }),
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
  const text = model.fair
    ? `the regional average: job access for a typical resident by ${MODES[model.mode].short}, within ${model.limit} minutes, allowing for other workers who can reach the same jobs.`
    : `of Auckland's jobs are within ${model.limit} minutes by ${MODES[model.mode].short} for a typical resident.`;
  const toggle = el('label', 'check');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = model.fair;
  box.disabled = !model.fairAvailable;
  box.addEventListener('change', () => set({ jobsFair: box.checked }));
  toggle.append(box, document.createTextNode(' Allow for other workers competing for the same jobs'));
  root.replaceChildren(
    hero(figure, text),
    radios('Travel by', modeOptions, model.mode, (jobsMode) => set({ jobsMode }), { compact: true }),
    radios('Within', model.limits.map((l) => [String(l), `${l} min`]), String(model.limit), (jobsLimit) => set({ jobsLimit }), { compact: true }),
    toggle,
    legend(model.fair ? 'Job access against the regional average' : "Share of Auckland's jobs within reach", model.legend, {
      note: model.fair
        ? 'Divides the jobs at each place by the working-age people who can reach them, then adds up what each home can reach. 1.0 is the Auckland average.'
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
