// The left panel: what to reach, how, the three questions, and their answers.
// Every function here renders from a model built in app.js; none of them
// computes figures.
//
// Each tab body reads the same way: what the map shows (a small row of
// choices), the number and one sentence, at most a note, then folded detail.
// The map's key is not drawn here: each body leaves a key spec on its root
// (`root.keySpec`), and app.js draws it in the key docked under the panel.

import { bars, lines } from './charts.js';
import { fold } from './fold.js';
import { count, el, MODE_NOTES, MODES, percent, place, ptPhrase, transit } from './format.js';
import { keyIcon } from './symbols.js';

// Everyday errands first, then education in the order a child meets it, then
// jobs. A service the build does not have is dropped by setServices.
const PREFERRED_ORDER = [
  'supermarket', 'gp', 'pharmacy', 'errands', 'library', 'bank_post',
  'early_childhood', 'primary_school', 'intermediate_school', 'secondary_school', 'tertiary', 'trades_training',
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
  tertiary: 'Tertiary',
  trades_training: 'Trades training',
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
  tertiary: 'a tertiary or trades training campus',
  trades_training: 'a trades training campus',
};

export const SERVICE_PLURAL = {
  supermarket: 'supermarkets', gp: 'GPs', pharmacy: 'pharmacies', library: 'libraries', bank_post: 'banks and post shops',
  early_childhood: 'early childhood services', primary_school: 'primary schools', intermediate_school: 'intermediate schools',
  secondary_school: 'secondary schools', tertiary: 'tertiary campuses', trades_training: 'trades training campuses',
};

/** A service's short name inside a sentence: lower case, except an initialism like GP. */
export function lowerName(name) {
  return /^[A-Z]{2}/.test(name) ? name : name[0].toLowerCase() + name.slice(1);
}

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

// Who the figures count: everyone, or, for early childhood and the school
// services in a build with ages, the children of the service's ages (ages.js
// ageWords). Set by app.js before each panel is drawn.
let counted = { many: 'people', one: 'person', children: false };

/** Count `words.many` ("children aged 13–17") rather than people, or people
 *  again with null. */
export function setCounted(words) {
  counted = words && words.key ? { many: words.many, one: words.one, children: true } : { many: 'people', one: 'person', children: false };
}

// A group among children of one age: "Māori children aged 13–17".
const CHILD_PHRASE = {
  no_car: (w) => `${w} in households without a car`,
  low_income: (w) => `${w} in households under $70,000`,
  maori: (w) => `Māori ${w}`,
  pacific: (w) => `Pacific ${w}`,
  asian: (w) => `Asian ${w}`,
  disabled: (w) => `disabled ${w}`,
};

const phrase = (group) => {
  if (group === 'everyone' || !group) return counted.many;
  if (counted.children && CHILD_PHRASE[group]) return CHILD_PHRASE[group](counted.many);
  return GROUP_PHRASE[group] || 'people';
};

/** A group's phrase in a sentence, as the figures on screen count it:
 *  "people", "children aged 13–17", "Māori children aged 13–17". */
export const groupPhrase = (group) => phrase(group);

// Short names for the People list; the charts carry the full label.
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

// Under a service that counts children, "Everyone" is them.
const shortLabels = (groups) => groups.map(([key, label]) => [key, key === 'everyone' && counted.children ? capitalise(counted.many) : GROUP_SHORT[key] || label]);

const REASON_SENTENCE = {
  0: 'the nearest one is close in a straight line, but the walk there is indirect',
  1: 'a confident rider could get there in time on busy roads, but not on low-stress routes',
  2: 'public transport is too slow, usually because services are infrequent or indirect',
  3: 'the nearest one is too far away',
  4: 'public transport would get them there in time, but not on this budget',
};

const capitalise = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

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

function radios(label, options, current, onPick, { compact = true } = {}) {
  const field = el('div', 'field');
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const title = el('span', 'field-label', label);
  title.id = id;
  const group = el('div', `chips${compact ? ' chips-compact' : ''}`);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', id);
  group.dataset.group = id;
  for (const [value, text, hint] of options) group.append(chip(value, text, current, onPick, hint));
  field.append(title, group);
  return field;
}

/** A select with a label beside it: `options` are [value, text]. */
function selectRow(id, label, options, current, onPick, className = 'row-pick') {
  const row = el('div', className);
  const name = el('label', 'pick-label', label);
  name.htmlFor = id;
  const select = el('select', 'select');
  select.id = id;
  for (const [value, text] of options) {
    const option = el('option', null, text);
    option.value = value;
    option.selected = value === current;
    select.append(option);
  }
  select.addEventListener('change', () => onPick(select.value));
  row.append(name, select);
  return row;
}

/** What the map shows within a tab: a quiet row above the number. */
function viewRow(label, options, current, onPick) {
  if (options.length < 2) return null;
  const row = el('div', 'views');
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  row.dataset.group = `views-${label.replace(/\W+/g, '-').toLowerCase()}`;
  for (const [value, text, hint] of options) {
    const button = el('button', null, text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    button.dataset.value = String(value);
    if (hint) button.title = hint;
    button.addEventListener('click', () => {
      if (value !== current) onPick(value);
    });
    row.append(button);
  }
  return row;
}

// Who the figures are for: everyone in the place, or in the part of it the
// map is on (a council, ward, local board or suburb).
function residentsOf(model) {
  // One school's zone names its own people: "the 61,700 people in its zone".
  if (model && model.who) return model.who;
  return model && model.where ? `${counted.many} in ${model.where}` : `${counted.many} in ${place.name}`;
}

function placeOf(model) {
  return model && model.where ? model.where : place.name;
}

// How many can't, or that everyone can: likely enough for one suburb.
function cant(below) {
  const n = Math.round(below);
  if (n === 0) return counted.children ? 'All of them can.' : 'Everyone can.';
  return n === 1 ? `1 ${counted.one} can't.` : `${count(below)} ${counted.many} can't.`;
}

const GROUP_ONE = {
  everyone: 'person',
  no_car: 'person in a household without a car',
  children: 'child under 15',
  older: 'person aged 65 and over',
  low_income: 'person in a household under $70,000',
  maori: 'Māori person',
  pacific: 'Pacific person',
  asian: 'Asian resident',
  disabled: 'disabled person',
};

// The group's phrase, for one of them or for any other number.
function peopleWord(n, group = 'everyone') {
  if (Math.round(n) !== 1) return phrase(group);
  if (group === 'everyone' || !group) return counted.one;
  if (counted.children && CHILD_PHRASE[group]) return CHILD_PHRASE[group](counted.one);
  return GROUP_ONE[group] || 'person';
}

function hero(figure, text, sub) {
  const box = el('div', 'hero');
  box.append(el('div', 'hero-figure', figure), el('p', 'hero-text', text));
  if (sub) box.append(el('p', 'hero-sub', sub));
  return box;
}

/** The key for what this body draws on the map. It is shown in the docked
 *  key; nothing is added to the panel. */
function setKey(root, spec) {
  root.keySpec = spec;
}

const scaleOf = (items, divider) => ({ items, divider });

/** A key label cut to its upper figure, for a phone's strip: "10–15" to "15",
 *  "10 or less" to "10", "over 45" to "45+". Anything else stays. */
export function shortScaleLabel(label) {
  const text = String(label);
  let m = text.match(/^([\d.]+%?) or less$/);
  if (m) return m[1];
  m = text.match(/^[\d.]+(?:%|×)?–([\d.]+(?:%|×)?)$/);
  if (m) return m[1];
  m = text.match(/^over ([\d.]+.*)$/);
  if (m) return `${m[1]}+`;
  return text;
}

function leanLine(text, fair) {
  const line = el('p', 'lean');
  line.append(el('span', `lean-dot ${fair === true ? 'is-toward' : fair === false ? 'is-away' : 'is-even'}`), el('span', null, text));
  return line;
}

function chartBox(draw) {
  const box = el('div', 'chart');
  draw(box);
  return box;
}

const method = (key, ...paragraphs) => fold(key, 'How this is worked out', null, paragraphs.filter(Boolean).map((text) => el('p', 'method-text', text)));

// ---------------------------------------------------------------- Getting to

// Destinations by kind, so one long list reads as a few short ones. A
// destination the build has and this list does not know goes under Other.
export const SERVICE_GROUPS = [
  { key: 'everyday', label: 'Everyday', members: ['supermarket', 'gp', 'pharmacy', 'errands'] },
  { key: 'community', label: 'Community', members: ['library', 'bank_post'] },
  { key: 'education', label: 'Education', members: ['early_childhood', 'primary_school', 'intermediate_school', 'secondary_school', 'tertiary', 'trades_training'] },
  { key: 'work', label: 'Work', members: ['jobs'] },
];

const SCORE_GROUP = 'Everything, nearer counts more';
const SCORE_SHORT = { all: 'all', everyday: 'everyday', education: 'education', jobs: 'jobs' };

/** The Getting to list: groups of [value, label], with the access scores last.
 *  A score's value is `score:<key>`. */
export function goalGroups(order, scoreKeys = []) {
  const known = new Set(SERVICE_GROUPS.flatMap((g) => g.members));
  const groups = SERVICE_GROUPS
    .map((g) => ({ label: g.label, options: g.members.filter((id) => order.includes(id)).map((id) => [id, SERVICE_SHORT[id] || id]) }))
    .filter((g) => g.options.length);
  const other = order.filter((id) => !known.has(id)).map((id) => [id, SERVICE_SHORT[id] || id]);
  if (other.length) groups.splice(groups.length - 1, 0, { label: 'Other', options: other });
  if (scoreKeys.length) {
    groups.push({ label: SCORE_GROUP, options: scoreKeys.map(([key, label]) => [`score:${key}`, `Access score: ${SCORE_SHORT[key] || (label || key).toLowerCase()}`]) });
  }
  return groups;
}

export function renderGoalPicker(select, groups, current, onPick) {
  const nodes = groups.map((group) => {
    const box = el('optgroup');
    box.label = group.label;
    for (const [value, text] of group.options) {
      const option = el('option', null, text);
      option.value = value;
      option.selected = value === current;
      box.append(option);
    }
    return box;
  });
  select.replaceChildren(...nodes);
  select.value = current;
  if (!select.dataset.wired) {
    select.dataset.wired = '1';
    select.addEventListener('change', () => select.onPick && select.onPick(select.value));
  }
  select.onPick = onPick;
}

// ---------------------------------------------------------------- Travel by

const SEGMENT = {
  best: ['Best', 'Best without a car: the fastest of walking, low-stress cycling and public transport'],
  walk: ['Walk', 'Walking'],
  bike_low_stress: ['Cycle', 'Low-stress cycling: paths, protected lanes and quiet streets'],
  pt: ['PT', 'Public transport'],
};

/** The ways of travelling for what is on screen: the ones that count as
 *  segments, then the rest in a More list.
 *
 *  `kind` is 'service', 'jobs', 'errands' or 'score'. Returns
 *  { segments: [[mode, label, title]], more: [[mode, label]] }.
 */
export function travelOptions(kind, { standardModes = [], slowWalk = false, jobsModes = [], roundModes = [], scoreModes = [], betaModes = [], compare = ['bike', 'car'] } = {}) {
  const seg = (m, label) => [m, label || (SEGMENT[m] || [MODES[m]?.label || m])[0], (SEGMENT[m] || [null, MODES[m]?.label || m])[1]];
  if (kind === 'jobs') {
    return {
      segments: ['pt', 'walk', 'bike_low_stress'].filter((m) => jobsModes.includes(m)).map((m) => seg(m)),
      more: [['bike', 'Any bike route (comparison)'], ['car', 'Car (comparison)']].filter(([m]) => jobsModes.includes(m)),
    };
  }
  if (kind === 'errands') {
    return {
      segments: [['walk', 'Walk', 'Walking'], ['pt', 'Walk and PT', 'Walking and public transport'], ['bike_low_stress', 'Cycle', SEGMENT.bike_low_stress[1]]]
        .filter(([m]) => roundModes.includes(m)),
      more: [],
    };
  }
  if (kind === 'score') {
    return {
      segments: scoreModes.map((m) => {
        const [label, title] = SEGMENT[m] || [MODES[m]?.label || m, MODES[m]?.label || m];
        return betaModes.includes(m) ? [m, `${label} (beta)`, `${title}. Beta: the distance decay is not fitted to local trips.`] : [m, label, title];
      }),
      more: [],
    };
  }
  const counted = ['best', ...['walk', 'bike_low_stress', 'pt'].filter((m) => standardModes.includes(m))];
  const extraCounted = standardModes.filter((m) => !counted.includes(m));
  return {
    segments: [...counted, ...extraCounted].map((m) => seg(m)),
    more: [
      ...(slowWalk ? [['walk_slow', 'Walking, slower pace']] : []),
      ['bike', 'Any bike route (comparison)'],
      ['car', 'Car (comparison)'],
    ].filter(([m]) => m === 'walk_slow' || compare.includes(m)),
  };
}

/** Draw Travel by into `root`. With `fixedBest`, the figures on this tab
 *  count the fastest way whatever is set, so Best shows and the rest wait. */
export function renderModePicker(root, options, current, onPick, { fixedBest = false } = {}) {
  const nodes = options.segments.map(([value, text, title]) => {
    const button = el('button', null, text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    const on = fixedBest ? value === 'best' : value === current;
    button.setAttribute('aria-checked', String(on));
    button.dataset.value = value;
    button.title = fixedBest && value !== 'best' ? 'These figures count the fastest way without a car' : title;
    button.disabled = fixedBest && value !== 'best';
    button.addEventListener('click', () => {
      if (value !== current) onPick(value);
    });
    return button;
  });
  if (options.more.length) {
    const select = el('select', 'modes-more');
    select.setAttribute('aria-label', 'More ways to travel');
    const inMore = !fixedBest && options.more.some(([m]) => m === current);
    const first = el('option', null, 'More');
    first.value = '';
    first.disabled = true;
    first.selected = !inMore;
    select.append(first);
    for (const [value, text] of options.more) {
      const option = el('option', null, text);
      option.value = value;
      option.selected = inMore && value === current;
      select.append(option);
    }
    select.classList.toggle('is-on', inMore);
    select.disabled = fixedBest;
    select.title = fixedBest ? 'These figures count the fastest way without a car' : 'Walking at a slower pace; any bike route and car, for comparison';
    select.addEventListener('change', () => {
      if (select.value) onPick(select.value);
    });
    nodes.push(select);
  }
  root.replaceChildren(...nodes);
  root.classList.toggle('is-fixed', fixedBest);
}

// ---------------------------------------------------------------- Settings

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

/** Who is travelling, how they pay, and whether the budget has to cover the
 *  trip home. Age is a scenario here, not a filter: it decides what a journey
 *  costs, not who gets counted. */
export function renderTraveller(root, model, set) {
  const profiles = (model.profiles || []).map((p) => [p.key, p.label]);
  const fields = [
    selectRow('traveller-profile', 'Travelling as', profiles, model.profile, (profile) => set({ profile }), 'pick'),
    model.payments.length > 2
      ? selectRow('traveller-payment', 'Paying with', model.payments, model.payment, (payment) => set({ payment }), 'pick')
      : radios('Paying with', model.payments, model.payment, (payment) => set({ payment })),
    radios('Budget covers', [['return', 'There and back'], ['one', 'One way']], model.returnTrip ? 'return' : 'one',
      (value) => set({ returnTrip: value === 'return' })),
  ];
  const ages = (model.profiles || []).find((p) => p.key === model.profile);
  if (ages && ages.ages && !String(ages.ages).startsWith('any')) {
    fields.push(el('p', 'note', `${ages.label} fares: ages ${ages.ages}.`));
  }
  fields.push(el('p', 'note', model.timeNote));
  root.replaceChildren(...fields);
}

// ---------------------------------------------------------------- Access

/** The Access headline's sentence, after the share. */
export function accessSentence(model) {
  const { noun, standard, mode, fare = '' } = model;
  switch (mode) {
    case 'walk':
      return `of ${residentsOf(model)} can walk to ${noun} within ${standard} minutes.`;
    case 'walk_slow':
      return `of ${residentsOf(model)} can walk to ${noun} within ${standard} minutes at a slower pace.`;
    case 'bike_low_stress':
      return `of ${residentsOf(model)} can cycle to ${noun} within ${standard} minutes on low-stress routes.`;
    case 'bike':
      return `of ${residentsOf(model)} could cycle to ${noun} within ${standard} minutes on any street.`;
    case 'pt':
      return `of ${residentsOf(model)} can reach ${noun} within ${standard} minutes ${ptPhrase()}${fare}.`;
    case 'car':
      return `of ${residentsOf(model)} can drive to ${noun} within ${standard} minutes.`;
    default:
      return `of ${residentsOf(model)} can reach ${noun} within ${standard} minutes without a car${fare}.`;
  }
}

/** How a mode is said after a time: "on foot", "by public transport". */
function howOf(mode, fare = '') {
  return {
    walk: 'on foot', walk_slow: 'on foot at a slower pace', bike_low_stress: 'by low-stress cycling', bike: 'cycling on any street',
    pt: `${ptPhrase()}${fare}`, car: 'by car',
  }[mode] || `without a car${fare}`;
}

/** One school with everyone counted: how many live within the standard. A
 *  share of everyone in the place would mostly count people who would never
 *  go there, so it is given only for an area picked, and named as such. A
 *  school with no home zone says so (`model.noZone`). */
export function withinSentence(model) {
  const { noun, standard, mode, fare = '' } = model;
  const one = Math.round(model.within) === 1;
  const who = model.where ? `${one ? counted.one : counted.many} in ${model.where}` : (one ? counted.one : counted.many);
  const why = model.noZone ? ` ${model.noZone}` : '';
  return `${who} ${one ? 'lives' : 'live'} within ${standard} minutes of ${noun} ${howOf(mode, fare)}.${why}`;
}

/** One school with a home zone: the share of the children (or people)
 *  living in its zone who are within the standard of it. */
export function zoneSentence(model) {
  const { standard, mode, fare = '' } = model;
  return `of the ${count(model.people)} ${Math.round(model.people) === 1 ? counted.one : counted.many} living in ${model.zoneName} `
    + `${Math.round(model.people) === 1 ? 'is' : 'are'} within ${standard} minutes of it ${howOf(mode, fare)}.`;
}

/** What the fare budget is doing, when one is set. */
function fareText(model) {
  if (!model.fare) return null;
  if (model.fareNote) return model.fareNote;
  if (model.zones === 0) return 'On this budget no fare is affordable, so only walking and cycling count.';
  if (model.zones == null) return null;
  return `Public transport counts only where the trip stays inside ${model.zones} fare ${model.zones === 1 ? 'zone' : 'zones'}.`;
}

/** The comparison and the fare as one note under the headline. */
function oneNote(...texts) {
  const text = texts.filter(Boolean).join(' ');
  return text ? el('p', 'note is-fare', text) : null;
}

/** Minutes, Choice, Fare and Fare burden: what the Access tab maps. */
function accessViews(current, model, set) {
  const options = [['minutes', 'Minutes', model.oneSchool ? 'Minutes to the school' : 'Minutes to the nearest one']];
  if (model.canShowChoice !== false) options.push(['choice', 'Choice', 'How many are within the standard']);
  if (model.canShowFare) options.push(['fare', 'Fare', 'The cheapest fare to the nearest one in time']);
  if (model.canShowFare && model.canShowBurden) options.push(['burden', 'Fare burden', "That fare as a share of a day's income"]);
  return viewRow('The map shows', options, current, (show) => set({ show }));
}

const MODE_KEY = { best: 'best', walk: 'walking', walk_slow: 'walking, slower pace', bike_low_stress: 'low-stress cycling', bike: 'any bike route', pt: 'public transport', car: 'car' };

/** Whether the answer holds at other times, by more than one way, and as the
 *  standard moves. Folded away: it is for anyone who wants to lean on the
 *  number, not for a first look. */
function robustSection(model) {
  const r = model.robust;
  if (!r) return null;
  const row = (figure, text) => {
    const line = el('p', 'robust-row');
    line.append(el('strong', null, figure), el('span', null, text));
    return line;
  };
  const parts = [];
  if (r.everyTime != null) {
    parts.push(row(percent(r.everyTime), `meet the standard at every time of day this is timed for, against ${percent(r.now)} now.`));
  }
  parts.push(row(percent(r.twoOrMore), 'could get there in time more than one way: walking, low-stress cycling or public transport.'));
  parts.push(row(percent(r.onlyOne), 'have only one way, so one route or service change would put them out of reach.'));
  parts.push(chartBox((chart) => lines(chart, r.series, {
    xs: r.xs,
    marker: r.standard,
    format: (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–'),
    caption: 'Share meeting the standard as the standard changes (minutes)',
    label: 'Share meeting the standard at each standard from 5 to 60 minutes, for everyone and the most and least deprived areas',
  })));
  return fold('robust', 'How robust is this?', null, parts);
}

function accessKey(root, model) {
  const short = SERVICE_SHORT[model.service] || '';
  setKey(root, {
    mode: `${model.keyName || `Minutes to the nearest ${lowerName(short)}`}, ${(model.mode === 'pt' && transit.orWalk ? 'public transport or walking' : MODE_KEY[model.mode]) || model.mode}`,
    scale: scaleOf(model.legend, 3),
    notes: [`Blue is within the ${model.standard}-minute standard, orange beyond it.`, MODE_NOTES[model.mode], model.keyNote].filter(Boolean),
  });
}

export function renderAccess(root, model, set) {
  accessKey(root, model);
  let head;
  if (model.oneEveryone) {
    head = hero(count(model.within), withinSentence(model),
      [model.where && Number.isFinite(model.share) ? `${percent(model.share)} of the ${count(model.people)} ${counted.many} living there.` : null,
        model.sexNote].filter(Boolean).join(' ') || null);
  } else if (model.zoneName) {
    const not = Math.round(model.below);
    head = hero(percent(model.share), zoneSentence(model),
      [`${count(model.below)} ${not === 1 ? 'is' : 'are'} not.`, model.sexNote].filter(Boolean).join(' '));
  } else {
    head = hero(percent(model.share), accessSentence(model), model.mode === 'best' ? cant(model.below) : null);
  }
  root.replaceChildren(...[
    accessViews('minutes', model, set),
    head,
    oneNote(model.compare, fareText(model), model.zoneNote),
    zoneAreas(model, set),
    robustSection(model),
  ].filter(Boolean));
}

/** Who misses out and What would help under One school with everyone
 *  counted: both need to know who would go to the school, which its zone
 *  says, so they are off for a school with no zone, and until zones are in.
 *  `model.zoneWhy` is 'build' (no zones in this build), 'school' (it has no
 *  home zone: `model.noZone` says why) or 'everyone' (its zone is there, but
 *  everyone is counted). The map keeps the minutes. */
export function renderNeedsZone(root, model) {
  accessKey(root, model);
  const tab = model.needsZone === 'fixes' ? 'What would help' : 'Who misses out';
  const why = {
    build: 'Zones are not in this build yet, so it is off for one school.',
    school: `${(model.noZone || 'It has no home zone.').replace(/\.$/, '')}, so it is off for this school.`,
    everyone: 'Tick Only those living in its zone, under the school, to turn it on.',
  }[model.zoneWhy || 'build'];
  // Set out as the tab's headline, so the key never covers it.
  const box = el('div', 'hero');
  box.append(
    el('p', 'hero-text', `${tab} needs ${model.noun}'s home zone, to know who would go there.`),
    el('p', 'hero-sub', `${why} Access gives the minutes to the school from every hexagon.`),
  );
  root.replaceChildren(box);
}

/** One school's zone, area by area, the furthest first: the people in each
 *  part of the zone and the share of them within the standard. */
function zoneAreas(model, set) {
  const z = model.zoneAreas;
  if (!z || !z.rows.length) return null;
  const list = el('ol', 'rank-list');
  for (const row of z.rows) {
    const item = el('li');
    const button = el('button', 'rank-row');
    button.type = 'button';
    button.title = `Show ${row.name} on the map`;
    button.append(
      el('span', 'rank-name', row.name),
      el('span', 'rank-meta', percent(1 - row.share)),
      el('span', 'rank-reason', `of ${count(row.people)} ${peopleWord(row.people)} within ${model.standard} min`),
    );
    button.addEventListener('click', () => set({ zoomTo: row.area }));
    item.append(button);
    list.append(item);
  }
  return fold('zone-areas', z.title, z.rows[0] ? `${z.rows[0].name} ${percent(1 - z.rows[0].share)}` : null, [list]);
}

// ---------------------------------------------------------------- Schools

const KIND_TEXT = {
  all: ['All', 'Every school that teaches these years: state, state-integrated, private and charter'],
  state: ['State', 'State schools taught in English'],
  zone: ['In zone', 'State schools taught in English that must take a child living there: those whose zone covers the home, and those with no zone'],
  one: ['One school', 'Minutes to one school, picked by name or on the map'],
};
const STUDENT_TEXT = [
  ['both', 'Girls and boys', 'Counted where both a girl and a boy can reach a school they can go to; the slower time'],
  ['girls', 'Girls', "Co-ed and girls' schools"],
  ['boys', 'Boys', "Co-ed and boys' schools"],
];

/** The Schools row under Getting to, for school services: which schools are
 *  counted, a search for one school that is always there, and the school
 *  picked under One school. `model` = { kinds, choice, school, query, hint,
 *  status, find, moeOf, remember, onSearch, csv, budget }. */
export function renderSchools(root, model, set) {
  if (!model) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  root.hidden = false;
  const { choice } = model;
  const pick = (kind) => set({ schools: { ...choice, kind, ...(kind === 'one' ? {} : { moe: choice.moe }) }, ...(kind === 'one' ? { schoolFind: true } : {}) });

  const head = el('div', 'pick');
  const label = el('span', 'pick-label', 'Schools');
  label.id = 'schools-label';
  const segs = el('div', 'modes school-kinds');
  segs.setAttribute('role', 'radiogroup');
  segs.setAttribute('aria-labelledby', 'schools-label');
  segs.dataset.group = 'schools-kind';
  for (const kind of model.kinds) {
    const [text, title] = KIND_TEXT[kind];
    const button = el('button', null, text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(kind === choice.kind));
    button.dataset.value = kind;
    button.title = title;
    // One school pressed again puts the cursor in the search.
    button.addEventListener('click', () => {
      if (kind !== choice.kind) pick(kind);
      else if (kind === 'one') set({ schoolFind: true });
    });
    segs.append(button);
  }
  // On a phone the four choices are one select in the same place.
  const select = el('select', 'select school-select');
  select.id = 'schools-select';
  select.setAttribute('aria-labelledby', 'schools-label');
  for (const kind of model.kinds) {
    const option = el('option', null, kind === 'one' ? 'One school…' : kind === 'state' ? 'State schools taught in English' : `${KIND_TEXT[kind][0]} schools`);
    option.value = kind;
    option.selected = kind === choice.kind;
    select.append(option);
  }
  select.addEventListener('change', () => pick(select.value));
  head.append(label, el('div', 'school-controls'));
  head.lastChild.append(segs, select);
  const parts = [head];

  if (choice.kind === 'state' || choice.kind === 'zone') {
    const row = viewRow('Students', STUDENT_TEXT, choice.students, (students) => set({ schools: { ...choice, students } }));
    row.classList.add('school-students');
    parts.push(row);
  }

  const picked = choice.kind === 'one' && model.school ? model.school : null;
  if (picked) parts.push(pickedSchool(model, set));
  parts.push(schoolSearch(model, set, picked));
  if (picked && picked.hasZone) parts.push(zoneOnly(model, set));
  if (model.status) parts.push(el('p', `note school-status${model.statusKind === 'error' ? ' is-error' : ''}`, model.status));
  if (model.budget) parts.push(el('p', 'note', model.budget));
  root.replaceChildren(...parts);
}

/** Under the headline: the school picked's facts and the stops near it, and
 *  the CSV download. Above the headline only what changes the figure, so a
 *  laptop screen shows the headline and the map's key together. */
export function renderSchoolMore(root, model, set) {
  const parts = [];
  const picked = model && model.choice.kind === 'one' && model.school ? model.school : null;
  if (picked) {
    const facts = el('div', 'school-facts');
    facts.append(...picked.facts.map((text) => el('p', 'note', text)));
    parts.push(facts);
    if (picked.stops) parts.push(stopsSection(picked.stops, set));
  }
  if (model && model.csv) {
    const csv = el('button', 'text-button school-csv', 'Download hexagons as CSV');
    csv.type = 'button';
    csv.addEventListener('click', () => set({ schoolCsv: true }));
    parts.push(csv);
  }
  root.hidden = !parts.length;
  root.replaceChildren(...parts);
}

/** The school picked: its name, then Zoom to its zone and Clear. */
function pickedSchool(model, set) {
  const { school } = model;
  const box = el('div', 'school-picked');
  const name = el('strong', 'school-name', school.name);
  name.id = 'school-picked-name';
  name.tabIndex = -1;
  const line = el('div', 'school-name-row');
  line.append(keyIcon('school-picked', 0.5), name);
  const actions = el('div', 'school-actions');
  const zoom = el('button', 'small-button', school.hasZone ? 'Zoom to its zone' : 'Zoom to it');
  zoom.type = 'button';
  zoom.id = 'school-zoom';
  zoom.addEventListener('click', () => set({ schoolZoom: true }));
  const clear = el('button', 'small-button', 'Clear');
  clear.type = 'button';
  clear.id = 'school-clear';
  clear.title = 'Stop showing only this school';
  clear.addEventListener('click', () => set({ schoolClear: true }));
  actions.append(zoom, clear);
  box.append(line, actions);
  return box;
}

/** The school's zone tick box: it changes who the figure counts. */
function zoneOnly(model, set) {
  const { choice } = model;
  const box = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.id = 'school-zone-only';
  input.checked = choice.zoneOnly !== false;
  input.addEventListener('change', () => set({ schools: { ...choice, zoneOnly: input.checked } }));
  box.append(input, el('span', null, 'Only those living in its zone'));
  return box;
}

/** "Find a school": one line, a search that lists the schools whose name,
 *  initials or Ministry number match, as a list box. Picking one shows only
 *  it. How to use it shows under the box while it has the cursor and is
 *  empty. */
function schoolSearch(model, set, picked) {
  const field = el('div', 'school-search');
  const label = el('label', 'school-search-label visually-hidden', picked ? 'Find another school' : 'Find a school');
  label.htmlFor = 'school-search';
  const input = el('input', 'select school-input');
  input.type = 'search';
  input.id = 'school-search';
  input.placeholder = picked ? 'Find another school' : 'Find a school, e.g. MAGS';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = model.query || '';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'school-results');
  input.setAttribute('aria-expanded', 'false');
  const results = el('ul', 'school-results');
  results.id = 'school-results';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', 'Schools found');
  const hint = el('p', 'note school-hint', model.hint);
  hint.id = 'school-search-hint';
  hint.hidden = true;
  input.setAttribute('aria-describedby', hint.id);
  let active = -1;
  const options = () => [...results.querySelectorAll('[role="option"]')];
  const choose = (d) => set({ schoolPick: model.moeOf(d) });
  const mark = (k) => {
    const list = options();
    active = list.length ? (k + list.length) % list.length : -1;
    list.forEach((option, j) => option.setAttribute('aria-selected', String(j === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list[active].id);
      list[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const show = () => {
    const found = model.find(input.value);
    active = -1;
    input.removeAttribute('aria-activedescendant');
    results.replaceChildren(...found.map(([d, name, tag], k) => {
      const item = el('li', 'school-result');
      item.id = `school-result-${k}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.dataset.d = String(d);
      item.append(el('span', 'school-result-name', name));
      if (tag) item.append(el('span', 'school-result-tag', tag));
      // pointerdown, not click, so the field keeps the cursor until the pick.
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => choose(d));
      return item;
    }));
    input.setAttribute('aria-expanded', String(found.length > 0));
    results.hidden = !found.length && !input.value.trim();
    if (!found.length && input.value.trim()) {
      const none = el('li', 'note', 'No match among the schools that teach these years. Try part of the name, or the school on the map.');
      none.setAttribute('role', 'presentation');
      results.append(none);
    }
  };
  const hintNow = () => { hint.hidden = document.activeElement !== input || Boolean(input.value.trim()); };
  input.addEventListener('input', () => {
    model.remember(input.value);
    show();
    hintNow();
  });
  input.addEventListener('focus', () => {
    hintNow();
    if (model.onSearch) model.onSearch();
  });
  input.addEventListener('blur', () => { hint.hidden = true; });
  input.addEventListener('keydown', (event) => {
    const list = options();
    if (event.key === 'ArrowDown' && list.length) {
      event.preventDefault();
      mark(active + 1);
    } else if (event.key === 'ArrowUp' && list.length) {
      event.preventDefault();
      mark(active < 0 ? list.length - 1 : active - 1);
    } else if (event.key === 'Enter') {
      const target = list[active >= 0 ? active : 0];
      if (target) {
        event.preventDefault();
        choose(Number(target.dataset.d));
      }
    } else if (event.key === 'Escape' && input.value) {
      // Escape empties the search first; the next one closes what it would.
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      model.remember('');
      show();
    }
  });
  show();
  field.append(label, input, hint, results);
  return field;
}

/** Stops near the school (One school): { intro, rows, none, summary, quiet:
 *  { heading, rows } or null (those with no trips in the window), far: {
 *  heading, rows } or null }, each row { text, name, icon, walk, trips, k }.
 *  A row gives the stop's symbol and, where it has trips, its walking badge
 *  as the map draws them, and a Show button that finds it on the map. */
function stopsSection(stops, set) {
  const listOf = (rows) => {
    const list = el('ul', 'stop-list');
    for (const row of rows) {
      const item = el('li', 'stop-row');
      const marks = el('span', 'stop-marks');
      marks.append(keyIcon(row.icon, 0.7));
      if (row.trips) marks.append(keyIcon(`walk-${row.walk}`, 0.7));
      const show = el('button', 'small-button stop-show', 'Show');
      show.type = 'button';
      show.setAttribute('aria-label', `Show ${row.name} on the map`);
      show.addEventListener('click', () => set({ schoolStop: row.k }));
      item.append(marks, el('span', 'stop-text', row.text), show);
      list.append(item);
    }
    return list;
  };
  const after = (part) => {
    if (!part || !part.rows.length) return [];
    const list = listOf(part.rows);
    list.classList.add('is-far');
    return [el('p', 'stop-far-head', part.heading), list];
  };
  return fold('school-stops', 'Stops near the school', stops.summary, [
    el('p', 'note', stops.intro),
    stops.rows.length ? listOf(stops.rows) : el('p', 'note', stops.none),
    ...after(stops.quiet),
    ...after(stops.far),
  ], { reveal: true });
}

/** How many of a service are within the standard, not only whether one is. */
export function renderChoice(root, model, set) {
  const plural = capitalise(model.plural);
  setKey(root, {
    mode: `${plural} within ${model.minutes} min without a car`,
    scale: scaleOf(model.legend, 2),
    notes: ['Blue is two or more; orange is one or none.'],
  });
  root.replaceChildren(...[
    accessViews('choice', model, set),
    hero(percent(model.twoOrMore), `of ${residentsOf(model)} have two or more ${model.plural} within ${model.minutes} minutes without a car.`,
      `${percent(model.none)} have none.`),
    model.minutes < model.standard
      ? el('p', 'note', `Counted within ${model.minutes} minutes, the nearest step at or under the ${model.standard}-minute standard.`)
      : null,
    fold('choice-deprivation', 'By deprivation', null, [chartBox((chart) => bars(chart, model.byQuintile, {
      format: (v) => percent(v),
      caption: `Share with two or more ${model.plural} in time, by neighbourhood deprivation`,
      label: 'Share with two or more in time, by NZDep',
    }))]),
    method('choice-method',
      ['tertiary', 'trades_training'].includes(model.service)
        ? 'A choice matters where the nearest one does not teach what someone wants to study.'
        : "A choice matters where a practice's books are closed or the nearest one is small.",
      'Counts every one reachable within the time by walking, low-stress cycling or public transport, taking whichever of the '
        + 'three reaches the most. Public transport is at its usual time with no fare limit. Counts are kept at 10, 15, 20 and '
        + '30 minutes, so another standard uses the nearest step below it.'),
  ].filter(Boolean));
}

/** The cost surface: what the cheapest way to reach the nearest one costs.
 *
 *  This answers a question the minutes map cannot. Two places can both be
 *  twenty minutes from a supermarket, and one of them pays nothing to get
 *  there while the other pays a three zone fare.
 */
export function renderFareSurface(root, model, set) {
  setKey(root, {
    mode: `Cheapest way to ${model.noun}, ${model.trip}`,
    scale: scaleOf(model.legend, 1),
    notes: ['Blue is free on foot or by bike; orange darkens as the fare grows; grey is no way in time.'],
  });
  root.replaceChildren(...[
    accessViews('fare', { ...model, canShowFare: true }, set),
    hero(
      percent(model.freeShare),
      `of ${residentsOf(model)} can reach ${model.noun} within ${model.standard} minutes without paying a fare.`,
      model.paid > 0 ? `${count(model.paid)} more can, but only by paying.` : null,
    ),
    el('p', 'note', `${count(model.none)} ${peopleWord(model.none)}${model.where ? ` in ${model.where}` : ''} cannot reach ${model.noun} within ${model.standard} minutes at any price without a car.`),
    method('fare-method', model.note),
  ].filter(Boolean));
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
  const what = model.commute ? 'five return trips to work' : model.week ? 'a week of daily return trips' : `a ${model.trip} fare`;
  // What the fare pays for, as the subject of a sentence.
  const the = model.commute ? 'commuting by public transport' : `the fare to ${model.noun}`;
  let figure = '–';
  let text = model.commute
    ? (model.walking > 0
      ? `No fare is needed${model.where ? ` in ${model.where}` : ''}: half the jobs within 45 minutes of each home are a walk away.`
      : `Public transport reaches almost no jobs within 45 minutes${model.where ? ` of ${model.where}` : ''}.`)
    : `Nobody ${model.where ? `in ${model.where}` : 'here'} needs public transport to reach ${model.noun} within ${model.standard} minutes, or it can't get there in time.`;
  if (Number.isFinite(ratio)) {
    figure = `${ratio.toFixed(1)}×`;
    const areas = model.where ? `parts of ${model.where}` : 'areas';
    text = ratio >= 1.05
      ? `as much of ${period} goes on ${the} in the most deprived ${areas} as in the least deprived.`
      : ratio <= 0.95
        ? `the share of ${period} ${the} takes in the most deprived ${areas}, against the least deprived.`
        : `${capitalise(the)} takes about the same share of ${period} in more and less deprived ${areas}.`;
  } else if (model.paying > 0 && !Number.isFinite(model.overall)) {
    text = `Too few people in ${placeOf(model)} would ride public transport there to give an average.`;
  } else if (model.paying > 0) {
    // A city with no areas in one end of the deprivation scale has no ratio.
    figure = share(model.overall);
    text = model.commute
      ? `of ${period} goes on commuting by public transport, on average${model.where ? `, in ${model.where}` : ''}.`
      : `of ${period} goes on ${what} to ${model.noun}, on average${model.where ? `, in ${model.where}` : ''}.`;
  }
  const counted = model.commute
    ? `Counted for the ${count(model.paying)} ${peopleWord(model.paying)} who can reach jobs by public transport within 45 minutes${transit.orWalk ? ' and need a bus or train for it: a home where half the jobs in reach are a walk away pays no fare and is left out' : ''}.`
    : `Counted for the ${count(model.paying)} ${peopleWord(model.paying)} who would ride public transport there within ${model.standard} minutes.`;
  const sub = model.paying > 0
    ? (Number.isFinite(ratio)
      ? `${capitalise(what)} ${model.commute ? 'take' : 'takes'} ${share(model.most)} of ${period} in the most deprived fifth of areas and ${share(model.least)} in the least. `
      : '') + counted
    : null;
  const max = Math.max(...model.byQuintile.map((r) => r.value || 0), ...model.byGroup.map((r) => r.value || 0)) * 1.1 || 1;
  const meta = model.meta || {};
  setKey(root, {
    mode: model.commute
      ? "Commuting by public transport, share of a week's income"
      : `${capitalise(model.trip)} fare to ${model.noun}, share of ${period}`,
    scale: scaleOf(model.legend, 1),
    notes: [model.commute
      ? 'Five return trips to work a week at the morning peak. Blue is no fare.'
      : `By public transport within ${model.standard} min. Blue is no fare needed.`],
  });
  root.replaceChildren(...[
    model.commute ? jobsViews('burden', model, set) : accessViews('burden', { ...model, canShowFare: true, canShowBurden: true }, set),
    hero(figure, text, sub),
    model.canWeek
      ? viewRow('Counting', [['trip', 'One return trip'], ['week', 'Every day for a week']], model.basket, (basket) => set({ basket }))
      : null,
    el('p', 'note', `${count(model.heavy)} ${peopleWord(model.heavy, model.group)} would spend 5% or more of ${period} on ${what}.`),
    model.week && model.caps
      ? el('p', 'note', model.capped > 0
        ? `A fare cap lowers the week's cost for ${count(model.capped)} ${peopleWord(model.capped)}.`
        : 'No cap applies: a week of these trips stays under the cap, or this way of paying has none.')
      : null,
    fold(model.commute ? 'commute-charts' : 'burden-charts', 'By deprivation and group', null, [
      chartBox((chart) => bars(chart, model.byQuintile, {
        format: share, max, caption: `Share of ${period}, by neighbourhood deprivation`, label: 'Fare burden by NZDep quintile',
      })),
      chartBox((chart) => bars(chart, [...model.byGroup].sort((a, b) => (b.value || 0) - (a.value || 0)), {
        format: share, max, caption: 'By group, at their own concession where one applies', label: 'Fare burden by group',
      })),
    ]),
    method(
      model.commute ? 'commute-method' : 'burden-method',
      model.commute
        ? 'A commute is five return trips a week at the morning peak. From each home, the fare is for the fewest fare '
          + 'zones that take in half the jobs public transport reaches within 45 minutes inside the fare zones, so it stands '
          + "for the fare to a typical job within reach. The week is priced after the network's daily and weekly caps, where it "
          + "has them and the way of paying qualifies, and divided by a week's income where the traveller lives. Homes where "
          + 'public transport reaches almost no jobs within 45 minutes are shown apart, and homes outside the fare zones are '
          + 'left out. The fare follows the traveller and payment set under Settings.'
        : "Burden is the fare for the cheapest public transport trip that reaches the nearest one inside the standard, "
          + "divided by a day's income where the traveller lives. It counts whether or not the traveller could walk "
          + 'instead. Where no bus or train that gets there in time is quicker than walking all the way, the trip is a '
          + 'walk and needs no fare: the map shows no fare and the averages leave the home out. The fare follows '
          + 'the traveller, payment and time set under Settings; children and people 65 and over are priced at their own '
          + 'concession where the network has one.',
      "Income is the 2023 Census median household income of the area, divided by the square root of its average "
        + 'household size so a large household on the same income counts as less well off, and raised by '
        + `${((meta.uplift || 1) - 1) * 100 > 0 ? (((meta.uplift || 1) - 1) * 100).toFixed(1) : '0'}% for wage growth since `
        + 'then (average hourly earnings, March 2023 to June 2026). It is before tax, so against take-home pay the '
        + 'burden would be higher. Areas the census publishes above $200,000 are held at that figure.',
      model.commute ? null : 'A trip that takes a share of a day\'s income, made every day, takes that share of income over a month. That is '
        + 'the 60-trip month the World Bank uses to judge whether public transport is affordable (Carruthers, Dick and '
        + 'Saurkar, 2005). Every day for a week counts a return trip each day after the network\'s daily and weekly '
        + 'caps, where it has them and the way of paying qualifies, and sets it against a week\'s income.',
      'Incomes describe an area, not a household, so a low-income household in a well-off area is counted at the '
        + "area's income.",
    ),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- Who misses out

/** Missing out, or where the group lives in the first place. */
function peopleViews(current, set) {
  return viewRow('The map shows', [['short', 'Missing out', 'Where people miss the standard, and by how much'], ['live', 'Where they live', 'Where the group lives']],
    current, (peopleShow) => set({ peopleShow }));
}

function peopleSelect(model, set) {
  return selectRow('people', 'People', shortLabels(model.groups), model.group, (group) => set({ group }));
}

/** Among children of one age, a group is the children times its share of the
 *  census block, which is for every age: said under the People list. */
function ageNote(model) {
  return model.ageNote && model.group !== 'everyone' ? el('p', 'note', model.ageNote) : null;
}

/** The list of areas, sortable, and downloadable as a table. `describe`
 *  writes each row. */
function areaList(model, set, describe, { sorts = true } = {}) {
  const a = model.areas;
  if (!a || !a.total) return [];
  const parts = [];
  if (a.levels.length > 1) {
    parts.push(viewRow('Areas', a.levels, a.level, (areaLevel) => set({ areaLevel, areaAll: false })));
  }
  if (sorts) {
    parts.push(viewRow('Sort by', [['missing', 'Most people'], ['share', 'Highest share']], a.sort, (areaSort) => set({ areaSort })));
  }
  const list = el('ol', 'rank-list');
  for (const row of a.rows) {
    const item = el('li');
    const button = el('button', 'rank-row');
    button.type = 'button';
    button.append(...describe(row));
    button.addEventListener('click', () => set(a.level === 'board' ? { zoomBoard: row.area } : { zoomTo: row.area }));
    item.append(button);
    list.append(item);
  }
  parts.push(list);
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
  parts.push(actions);
  return parts;
}

/** The first area in a list and its figure, for a fold's summary. */
function topArea(a, figure) {
  return a && a.rows && a.rows.length ? `${a.rows[0].name} ${figure(a.rows[0])}` : null;
}

/** The measures behind the tab, as numbers, for anyone who wants to cite them. */
function figures(model) {
  const bits = [];
  const fixed = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
  bits.push(`Headcount rate ${percent(model.rate, 1)}`);
  bits.push(`poverty gap index ${fixed(model.depth, 3)}`);
  bits.push(`squared gap index ${fixed(model.severity, 3)}`);
  if (Number.isFinite(model.lean)) bits.push(`concentration index of the shortfall by NZDep ${fixed(model.lean, 3)}`);
  const who = model.group === 'everyone' ? 'Everyone' : capitalise(phrase(model.group));
  return `${who}: ${bits.join(', ').replace(/^Headcount/, 'headcount')}. The gap indices measure the shortfall as a share of the standard.`;
}

export function renderPeople(root, model, set) {
  if (model.live) {
    renderLive(root, model, set);
    return;
  }
  const withoutCar = model.group === 'no_car' ? '' : ' without a car';
  const depth = model.below >= 0.5 && Number.isFinite(model.minutesShort)
    ? `They are ${Math.round(model.minutesShort)} ${Math.round(model.minutesShort) === 1 ? 'minute' : 'minutes'} over, on average.`
    : null;
  setKey(root, {
    mode: `${capitalise(counted.many)} missing out × minutes short`,
    scale: scaleOf(model.legend),
    notes: [`Each hexagon by how many ${counted.many} miss the standard and how far short they are.`],
  });

  const parts = [
    peopleViews('short', set),
    hero(
      count(model.below),
      model.round
        ? `${peopleWord(model.below, model.group)}${model.where ? ` in ${model.where}` : ''} ${roundSentence({ ...model.round, standard: model.standard }, true)}`
        : `${peopleWord(model.below, model.group)}${model.where ? ` in ${model.where}` : ''} can't reach ${model.noun} within ${model.standard} minutes${withoutCar}${model.fare || ''}.`,
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

  // The shortfall landing on more deprived areas is the unfair direction.
  if (model.leanText) parts.push(leanLine(model.leanText, model.lean < -0.02 ? false : model.lean > 0.02 ? true : null));

  const worstGroup = [...model.byGroup].filter((r) => Number.isFinite(r.value)).sort((a, b) => b.value - a.value)[0];
  const q5 = model.byQuintile[4];
  const a = model.areas;
  parts.push(
    peopleSelect(model, set),
    ageNote(model),
    fold('people-groups', 'By group', worstGroup ? `${GROUP_SHORT_OF(worstGroup.label)} most, ${percent(worstGroup.value)}` : null, [
      chartBox((chart) => bars(chart, model.byGroup, {
        format: (v) => percent(v),
        caption: 'Share missing the standard, and how far short on average',
        label: 'Share missing the standard by group, with average minutes short',
      })),
    ]),
    fold('people-deprivation', 'By deprivation', q5 && Number.isFinite(q5.value) ? `most deprived ${percent(q5.value)}` : null, [
      chartBox((chart) => bars(chart, model.byQuintile, {
        format: (v) => percent(v),
        caption: `Share missing the standard, by neighbourhood deprivation${model.group !== 'everyone' ? `, ${phrase(model.group)}` : ''}`,
        label: 'Share missing the standard by NZDep',
      })),
    ]),
    a && a.total ? fold('people-areas', 'By area', topArea(a, (r) => count(r.missing)), areaList(model, set, (row) => {
      const short = Number.isFinite(row.minutesShort) ? ` · ${Math.round(row.minutesShort)} min short` : '';
      return [
        el('span', 'rank-name', row.name),
        el('span', 'rank-meta', `${count(row.missing)} · ${percent(row.share)}`),
        el('span', 'rank-reason', `of ${count(row.people)} ${peopleWord(row.people, model.group)}${short}`),
      ];
    })) : null,
    method(
      'people-method',
      'A headcount cannot tell a place three minutes over the standard from one forty minutes over, so the '
        + 'map shows both together: how many people miss out, and how far short they are.',
      'These are the Foster-Greer-Thorbecke measures, with the access standard used as the line. Somewhere '
        + 'with no route at all counts at the routing limit rather than being left out, because dropping it '
        + 'would flatter the result exactly where things are worst.',
      'Where the shortfall falls is a concentration index of the shortfall, ranking people by deprivation '
        + 'rather than by their own access, so it can say whether the places missing out are the poorer ones. '
        + 'A measure of spread alone, such as a Gini, cannot answer that.',
      model.round ? null : 'These figures count the fastest of walking, low-stress cycling and public transport, whatever Travel by is set to.',
      'Group figures come from census shares of the block around each hexagon, so they estimate people in an '
        + 'area rather than counting individuals.',
      figures(model),
    ),
  );
  root.replaceChildren(...parts.filter(Boolean));
}

// A chart label back to its short name, for a summary line.
const LONG_TO_SHORT = {
  'People in households without a car': 'No car',
  'Children under 15': 'Children',
  'People aged 65 and over': '65+',
  'People in households under $70,000': 'Lower income',
  'Pacific peoples': 'Pacific',
  'Disabled people': 'Disabled',
};
function GROUP_SHORT_OF(label) {
  return LONG_TO_SHORT[label] || label;
}

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
  const rows = [{
    label: 'Only where they miss the standard',
    sub: everyone ? 'Hide the places that meet it' : `Hide the places where ${who} meet it`,
    toggle: true,
    pressed: model.missingOnly,
    onPick: () => set({ liveMissing: !model.missingOnly }),
  }];
  if (model.villages) {
    rows.push({
      colour: model.villages.colour,
      label: 'Rest homes and villages left out',
      sub: model.villages.out
        ? `About ${count(model.villages.people)} people aged 65+ live in them. Hexagons mostly made up of them are marked.`
        : `About ${count(model.villages.people)} people aged 65+ live in them, counted here with everyone else.`,
      toggle: true,
      pressed: model.villages.out,
      onPick: () => set({ liveVillages: model.villages.out }),
    });
  }
  setKey(root, {
    mode: everyone ? `${capitalise(counted.many)} per hexagon` : `${capitalise(who)}, share of ${counted.children ? counted.many : 'residents'}`,
    scale: scaleOf(model.legend, model.divider),
    notes: [everyone ? null : `Purple is above the ${place.name} share of ${percent(model.whole ? model.whole.summary.share : s.share, model.digits)}${((model.whole || model).villages || {}).out ? ', outside rest homes and villages' : ''}.`],
    rows,
  });
  const parts = [peopleViews('live', set)];
  if (everyone) {
    parts.push(hero(count(s.everyone), `${Math.round(s.everyone) === 1 ? `${counted.one} lives` : `${counted.many} live`} in ${placeOf(model)}.`, `${percent(s.missingRate)} can't ${reach}.`));
  } else if (!(s.everyone > 0)) {
    // The census suppresses a small group's count, and in a small area that can be all of it.
    parts.push(hero('–', `The census gives no count of ${who} in ${placeOf(model)}.`));
  } else {
    // With rest homes and villages left out, every figure is for the rest.
    const outside = model.villages && model.villages.out ? ' outside rest homes and retirement villages' : '';
    parts.push(hero(
      count(s.group),
      outside
        ? `${who} live in ${placeOf(model)}${outside}, ${percent(s.share, model.digits)} of the residents there.`
        : `${who} live in ${placeOf(model)}, ${percent(s.share, model.digits)} of ${counted.children ? counted.many : 'residents'}.`,
      s.concentrated > 0
        ? `${count(s.concentrated)} of them (${percent(s.concentratedShare)}) live where they are at least one and a half times as common as across ${place.name}.`
        : null,
    ));
    if (s.concentrated > 0) {
      const worse = s.concentratedMissingRate > s.missingRate + 0.02;
      const better = s.concentratedMissingRate < s.missingRate - 0.02;
      parts.push(leanLine(`There, ${percent(s.concentratedMissingRate)} can't ${reach}, against ${percent(s.missingRate)} of all ${who}${model.where ? ` in ${model.where}` : ''}${outside}.`,
        worse ? false : better ? true : null));
    }
  }
  const a = model.areas;
  parts.push(
    peopleSelect(model, set),
    ageNote(model),
    a && a.total ? fold('live-areas', 'By area', topArea(a, (r) => count(model.missingOnly ? r.missing : r.people)), [
      a.norcs != null
        ? el('p', 'note', a.norcs > 0
          ? `${a.norcs} ${a.norcs === 1 ? 'suburb is a' : 'suburbs are'} naturally occurring retirement ${a.norcs === 1 ? 'community' : 'communities'} (NORC), with ${count(a.norcPeople)} people aged 65+.`
          : 'No suburb here is a naturally occurring retirement community (NORC) by this measure.')
        : null,
      ...areaList(model, set, (row) => {
        const ofResidents = everyone ? '' : `, ${percent(row.ofResidents, model.digits)} of residents`;
        // With only the places that miss the standard shown, the list is ranked by
        // the people there who miss out, so that is the number it leads with.
        const task = model.round ? `make the round in ${model.standard} min` : `reach ${model.noun} in ${model.standard} min`;
        const reason = model.missingOnly
          ? `of ${count(row.people)} here${ofResidents}, can't ${task}`
          : `${everyone ? '' : `${percent(row.ofResidents, model.digits)} of residents · `}${percent(row.share)} can't ${task}`;
        const name = el('span', 'rank-name', row.name);
        if (row.norc) name.append(' ', el('span', 'tag', 'NORC'));
        return [name, el('span', 'rank-meta', count(model.missingOnly ? row.missing : row.people)), el('span', 'rank-reason', reason)];
      }, { sorts: !everyone }),
    ]) : null,
    method(
      'live-method',
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
          + 'for the service, standard, time and any fare set under Settings.',
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

// ---------------------------------------------------------------- What would help

// Whether the list of places shows all ten, kept while the panel is redrawn.
let rankedAll = false;

export function renderFixes(root, model, set) {
  const top = model.reasons.reduce((a, b) => (b.people > a.people ? b : a), model.reasons[0]);
  const sub = top && top.people > 0 && model.below > 0
    ? `For ${count(top.people)} of them (${percent(top.people / model.below)}), ${REASON_SENTENCE[top.cls]}.`
    : null;
  setKey(root, {
    mode: `Main reason · ${count(model.below)} ${peopleWord(model.below, model.group)}`,
    rows: model.reasons.map((reason) => ({
      colour: reason.colour,
      label: reason.label,
      sub: reason.fix,
      count: count(reason.people),
      pressed: model.focus === reason.cls,
      faded: model.focus != null && model.focus !== reason.cls,
      onPick: () => set({ reason: model.focus === reason.cls ? null : reason.cls }),
    })),
    notes: ['Pick a reason to show only those places.'],
  });
  const ranked = el('ol', 'rank-list');
  const shown = rankedAll ? model.ranked : model.ranked.slice(0, 3);
  for (const spot of shown) {
    const item = el('li');
    const button = el('button', 'rank-row');
    button.type = 'button';
    const dot = el('span', 'reason-dot');
    dot.style.background = spot.colour;
    const why = el('span', 'rank-reason');
    why.append(dot, document.createTextNode(spot.reasonLabel));
    button.append(el('span', 'rank-name', spot.name), el('span', 'rank-meta', `${count(spot.below)} ${peopleWord(spot.below, model.group)}`), why);
    button.addEventListener('click', () => set({ zoomTo: spot.index }));
    item.append(button);
    ranked.append(item);
  }
  let more = null;
  if (model.ranked.length > 3) {
    more = el('button', 'text-button', rankedAll ? 'Show fewer' : `Show all ${model.ranked.length}`);
    more.type = 'button';
    more.addEventListener('click', () => {
      rankedAll = !rankedAll;
      set({});
    });
  }
  root.replaceChildren(...[
    hero(count(model.below), `${peopleWord(model.below, model.group)}${model.where ? ` in ${model.where}` : ''} ${Math.round(model.below) === 1 ? 'misses' : 'miss'} the ${model.standard}-minute standard for ${model.noun}${model.fare || ''}.`, sub),
    peopleSelect(model, set),
    ageNote(model),
    model.ranked.length ? el('p', 'field-label list-title', 'Where most people miss out') : null,
    model.ranked.length ? ranked : null,
    more,
    el('p', 'note', 'Screening rules, not a verdict: they show which kind of fix to look at first. The reasons and their counts are in the key.'),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- Jobs

/** Jobs within reach, the same allowing for competition, or what commuting costs. */
function jobsViews(current, model, set) {
  const options = [['jobs', 'Jobs', 'Jobs within reach']];
  if (model.fairAvailable && !model.priced) options.push(['fair', 'Allowing for competition', 'Allow for other workers competing for the same jobs']);
  if (model.canCommute) options.push(['burden', 'Commuting cost', 'Five return trips to work a week, against income']);
  return viewRow('The map shows', options, current, (value) => set(value === 'burden'
    ? { show: 'burden' }
    : { show: 'minutes', jobsFair: value === 'fair' }));
}

export function renderJobsAccess(root, model, set) {
  // Jobs lead with a count, which compares across cities; the share of the
  // city's own jobs follows.
  const jobsCount = Number.isFinite(model.median) && model.total ? Math.round((model.median / 100) * model.total) : NaN;
  const shareText = percent(model.median / 100, model.median < 10 ? 1 : 0);
  const byMode = model.priced ? 'public transport' : MODES[model.mode].short;
  const figure = model.fair ? `${model.median.toFixed(2)}×` : Number.isFinite(jobsCount) ? count(jobsCount) : shareText;
  const text = model.fair
    ? `the ${place.name} average: job access for a typical resident${model.where ? ` of ${model.where}` : ''} by ${byMode} within ${model.limit} minutes${model.when || ''}, allowing for everyone else who could reach the same jobs.`
    : `jobs within ${model.limit} minutes by ${byMode}${model.priced ? model.fare : model.when || ''}, for a typical resident${model.where ? ` of ${model.where}` : ''}. That is ${shareText} of ${place.possessive} jobs.`;
  setKey(root, {
    mode: model.fair ? `Job access against the ${place.name} average, ${MODES[model.mode].short}` : `Share of ${place.possessive} jobs within ${model.limit} min`,
    scale: scaleOf(model.legend),
    notes: [model.fair
      ? 'Divides the jobs at each place by the working-age people who could get there in time by car or by this mode, '
        + `then adds up what each home can reach. 1.0 is the ${place.name} average by this mode.`
      : 'Jobs counted from Stats NZ business demography (2024), by where people work.'],
  });
  root.replaceChildren(...[
    jobsViews(model.fair ? 'fair' : 'jobs', model, set),
    hero(figure, text),
    model.priced
      ? el('p', 'note is-fare', model.fareNote ? `With a fare budget, jobs are counted within ${model.limit} minutes. ${model.fareNote}` : model.zones === 0
        ? 'On this budget no fare is affordable, so no job is reachable by public transport.'
        : `With a fare budget, jobs are counted within ${model.limit} minutes, on trips inside ${model.zones} fare ${model.zones === 1 ? 'zone' : 'zones'}.`)
      : null,
  ].filter(Boolean));
}

export function renderJobsPeople(root, model) {
  const format = (v) => (Number.isFinite(v) ? `${v.toFixed(v < 10 ? 1 : 0)}%` : '–');
  const how = `By ${MODES[model.mode].short}, within ${model.limit} minutes${model.fare || model.when || ''}.`;
  setKey(root, {
    mode: model.fair ? `Job access against the ${place.name} average` : `Share of ${place.possessive} jobs within ${model.limit} min`,
    scale: scaleOf(model.legend),
  });
  // The least-served 40% can reach nothing at all on a tight budget, and then
  // there is no ratio to give.
  const heroBox = Number.isFinite(model.palma)
    ? hero(`${model.palma.toFixed(1)}×`, `as many jobs for the best-served tenth of ${residentsOf(model)} as for the least-served 40%.`, how)
    : model.lowNothing
      ? hero('0', `jobs within reach for the least-served 40% of ${residentsOf(model)}.`, how)
      : hero('–', `Too few hexagons in ${placeOf(model)} to set the best-served tenth against the least-served 40%.`, how);
  const q5 = model.byQuintile[4];
  root.replaceChildren(...[
    heroBox,
    model.leanText ? leanLine(model.leanText, model.lean < -0.02 ? true : model.lean > 0.02 ? false : null) : null,
    fold('jobs-deprivation', 'By deprivation', q5 && Number.isFinite(q5.value) ? `most deprived ${format(q5.value)}` : null, [
      chartBox((chart) => bars(chart, model.byQuintile, { format, max: model.max, caption: `Typical share of jobs within ${model.limit} min by ${MODES[model.mode].short}, by deprivation` })),
    ]),
    fold('jobs-groups', 'By group', null, [chartBox((chart) => bars(chart, model.byGroup, { format, max: model.max, caption: 'By group' }))]),
  ].filter(Boolean));
}

export function renderJobsFixes(root, model) {
  // The map keeps showing job access, so the key does too.
  setKey(root, model && model.legend ? {
    mode: model.fair ? `Job access against the ${place.name} average` : `Share of ${place.possessive} jobs within ${model.limit} min`,
    scale: scaleOf(model.legend),
  } : null);
  root.replaceChildren(
    el('p', 'hero-text', 'Jobs have no single standard, so there is no reason map for them.'),
    el('p', 'note', 'Use Access to see where job access is lowest, and Who misses out to see how it differs by deprivation and group. Reasons are mapped for every destination with a time standard.'),
  );
}

// ---------------------------------------------------------------- Access score

const SCORE_NOUN = {
  jobs: 'jobs',
  everyday: 'everyday services',
  education: 'schools',
  all: 'opportunities',
};

export function renderScore(root, model, set) {
  const { key, mode, display, median, palma, byQuintile, note } = model;
  const noun = SCORE_NOUN[key] || 'opportunities';
  const modeLabel = MODES[mode] ? MODES[mode].short : mode;
  const figure = Number.isFinite(median) ? String(Math.round(median)) : '–';
  const text = model.when
    ? `is the typical score${model.where ? ` in ${model.where}` : ''} for ${noun} by ${modeLabel}${model.when}, where 100 is the ${place.name} average at the usual time.`
    : `is the typical score${model.where ? ` in ${model.where}` : ''} for ${noun} by ${modeLabel}, where 100 is the ${place.name} average.`;
  const sub = Number.isFinite(palma)
    ? `The best-served tenth of ${residentsOf(model)} score ${palma.toFixed(1)} times the least-served 40%.`
    : null;
  setKey(root, {
    mode: display === 'decile' ? 'Decile: 1 has the least access' : `Score, where 100 is the ${place.name} average`,
    scale: scaleOf(model.legend),
    notes: [display === 'decile' ? 'Each tenth of residents, from the least access (1) to the most (10).' : `Access to ${noun} by ${modeLabel}.`],
  });
  const q5 = byQuintile[4];
  root.replaceChildren(...[
    viewRow('The map shows', [['index', 'Score'], ['decile', 'Decile']], display, (value) => set({ scoreDisplay: value })),
    hero(figure, text, sub),
    model.leanText ? leanLine(model.leanText, model.lean < -0.02 ? true : model.lean > 0.02 ? false : null) : null,
    fold('score-deprivation', 'By deprivation', q5 && Number.isFinite(q5.value) ? `most deprived ${Math.round(q5.value)}` : null, [
      chartBox((chart) => bars(chart, byQuintile, {
        max: Math.max(1, ...byQuintile.map((row) => row.value).filter(Number.isFinite)),
        format: (v) => (Number.isFinite(v) ? String(Math.round(v)) : '–'),
        caption: 'Typical score by neighbourhood deprivation',
        label: 'Score by NZDep quintile',
      })),
    ]),
    method('score-method', note),
  ].filter(Boolean));
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
  setKey(root, {
    mode: 'Minutes of travel for the whole round',
    scale: scaleOf(model.legend, 3),
    notes: [`Blue is within the ${model.standard}-minute standard, orange beyond it.`],
  });
  const names = model.stops.map((s) => lowerName(SERVICE_SHORT[s] || s));
  const summary = `${capitalise(names.join(', '))}${model.leg === 'any' ? '' : ` · stretches ≤ ${model.leg} min`}`;
  root.replaceChildren(...[
    hero(percent(model.share), `of ${residentsOf(model)} ${roundSentence(model)}`, cant(model.below)),
    model.single
      ? el('p', 'note', `For one trip on its own, ${percent(model.single.share)} can ${ROUND_HOW[model.mode]}${model.slow ? ' at the same pace' : ''} to ${STOP_NAME[model.single.stop] || SERVICE_NOUN[model.single.stop]} within ${model.single.standard} minutes.`)
      : null,
    fold('errand-round', 'The round', summary, [
      toggles('Stops', model.allStops.map((s) => [s, SERVICE_SHORT[s] || s]), model.stops, (stop) => set({ errandToggle: stop }), model.maxStops),
      model.mode === 'bike_low_stress' || !model.slowKmh ? null : radios('Walking pace', [['usual', 'Usual, 4.8 km/h'], ['slow', `Slower, ${model.slowKmh} km/h`]],
        model.slow ? 'slow' : 'usual', (pace) => set({ pace })),
      radios('Longest stretch', [...model.legLimits.map((m) => [String(m), `${m} min`]), ['any', 'No limit']], model.leg,
        (errandLeg) => set({ errandLeg })),
    ], { open: true }),
    method(
      'errand-method',
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
  ].filter(Boolean));
}
