// The About dialog. Plain statements of what TEAM shows, how, and its limits.

import { count, el, place } from './format.js';

const LINKS = {
  method: 'https://github.com/squirmen/transport-equity-access-model/blob/main/docs/methodology.md',
  code: 'https://github.com/squirmen/transport-equity-access-model',
  lab: 'https://betterplaces.blogs.auckland.ac.nz',
};

const WINDOW_LABEL = { am_peak: 'weekday 7–9am', interpeak: 'weekday 10am–12pm' };

function para(text) {
  return el('p', null, text);
}

function list(items) {
  const ul = el('ul');
  for (const item of items) ul.append(el('li', null, item));
  return ul;
}

function link(label, href) {
  const a = el('a', null, label);
  a.href = href;
  a.rel = 'noopener';
  return a;
}

export function renderAbout(root, meta) {
  const date = new Date(`${meta.routing_date}T12:00:00`).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const table = el('table', 'about-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const h of ['Service', 'Standard', 'Time of day']) headRow.append(el('th', null, h));
  head.append(headRow);
  const body = el('tbody');
  for (const service of Object.values(meta.services)) {
    const tr = el('tr');
    tr.append(el('td', null, service.label), el('td', null, `${service.standard_minutes} min`), el('td', null, WINDOW_LABEL[service.window] || service.window));
    body.append(tr);
  }
  table.append(head, body);

  const links = el('p', 'about-links');
  links.append(link('Method', LINKS.method), document.createTextNode(' · '), link('Download the data', 'downloads/'), document.createTextNode(' · '), link('Code', LINKS.code));

  root.replaceChildren(
    el('p', 'eyebrow', 'Better Places Lab'),
    Object.assign(el('h2', null, 'TEAM: Transport Equity and Access Model'), { id: 'about-title' }),
    para(`TEAM shows how long it takes to reach everyday services and jobs from each part of ${place.name} without a car, who lives where that is too long, and what kind of change would shorten it.`),
    el('h3', null, 'Reading the map'),
    list([
      'Access: minutes to the nearest service. Blue is within the standard, orange is beyond it.',
      'Who misses out: where the people beyond the standard live, and how that differs by deprivation, car ownership and age.',
      'What would help: the main reason each place misses the standard, and the kind of fix that points to.',
    ]),
    el('h3', null, 'Standards'),
    para('A place meets a standard when walking, cycling on low-stress routes or public transport gets there in time. Car times and cycling on busy roads are shown for comparison but never count. The slider changes the standard.'),
    table,
    el('h3', null, 'How it is built'),
    list([
      `Travel times come from R5 routing on OpenStreetMap streets and paths and the ${place.agency} timetable for ${date}. Public transport times are the median across the time window and include walking to the stop and waiting.`,
      'Low-stress routes are paths, protected lanes and quiet streets: level 2 or below on R5’s traffic-stress scale.',
      `Each hexagon covers about 0.1 km². There are ${count(meta.totals.cells)} with residents, holding ${count(meta.totals.population)} people from the 2023 Census.`,
      `Jobs are Stats NZ business demography employee counts (2024), ${count(meta.jobs.total)} in total, placed by where people work.`,
      'The reasons are screening rules. They show which kind of fix to look at first; they do not replace a local study.',
    ]),
    links,
    el('h3', null, 'Limits'),
    list([
      'The nearest service is not always one you can use: school zones, GP enrolment, opening hours and store size are not modelled.',
      'Times come from timetables, not real-world reliability or crowding.',
      'Walking and cycling times ignore hills, lighting and footpath condition.',
      'Census shares describe small areas, not individual households.',
    ]),
    el('h3', null, 'Credit'),
    para('Built by the Better Places Lab, Te Pare School of Architecture, Planning and Design, Waipapa Taumata Rau | University of Auckland.'),
    para(`Cite as: Welch, T. F. (2026). TEAM: Transport Equity and Access Model, ${place.name}. Version ${meta.version}. Better Places Lab, University of Auckland.`),
    Object.assign(el('p', 'about-contact'), { textContent: 'Questions or data to share: t.welch@auckland.ac.nz' }),
  );
}
