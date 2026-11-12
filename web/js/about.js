// The About dialog. Plain statements of what TEAM shows, how, and its limits.

import { count, el, place } from './format.js';
import { readSchoolsMeta } from './schools.js';

const LINKS = {
  method: 'https://github.com/squirmen/transport-equity-access-model/blob/main/docs/methodology.md',
  code: 'https://github.com/squirmen/transport-equity-access-model',
  lab: 'https://betterplaces.blogs.auckland.ac.nz',
  changes: 'https://github.com/squirmen/transport-equity-access-model/blob/main/CHANGELOG.md',
};


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

/** How the Schools row counts, for builds that say what each school is. */
function schoolsHelp(meta) {
  if (!meta.schools) return [];
  const s = readSchoolsMeta(meta);
  const dated = (value) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
  const choices = [
    'All: every school that teaches those years, whether state, state-integrated, private or charter, single-sex included. This is what TEAM showed before the row was added, and what a link without a choice shows.',
    'State: state schools taught in English. A state school whose teaching language the directory does not give is left out, and the line under the headline says so. Girls and boys counts a place only when both a girl and a boy living there can reach a school they can go to, and uses the slower of the two times. Girls or Boys counts co-ed schools and that one\'s own. Home zones are not applied: a school with a zone counts for everyone, in or out of it.',
  ];
  if (s.zones) {
    choices.push(`In zone: the state schools whose home zone covers at least half of a hexagon, and the state schools with no enrolment scheme. Zones are the Ministry of Education's, as at ${dated(s.zones) || 'the date in the build'}. Where a zone line crosses a hexagon, the headline says how many people live in such hexagons.`);
  }
  choices.push(`One school: minutes to one school, found by name or by clicking its pin. ${s.zones
    ? 'With Only people living in its zone ticked, the figures count the people in its zone and nobody else. Without it, they count everyone, as below.'
    : 'School zones are not in this build yet, so the headline is the number of people who live within the standard of the school, and a share is given only for a local board, ward or suburb, named under the number. Who misses out and What would help are off for one school until zones are in.'} The area you pick stays when you change school, so two schools are compared for the same people. There are no car times to one school.`);
  const listed = dated(s.directory);
  return [
    el('h3', null, 'Schools'),
    para('For primary, intermediate and secondary schools, the Schools row under Getting to sets which schools count.'),
    list(choices),
    para(`A line under every headline says which schools are counted, with counts from the Ministry of Education's school directory${listed ? ` as at ${listed}` : ''}. `
      + 'The figures count all residents of each hexagon, of every age, not only school-age children. '
      + 'Nearest means quickest by the way of travelling shown. The card names that school, and every school reached in the same minute, nearest in a straight line first. '
      + 'A public transport time that is no quicker than walking is a walk, and is said as one. A walk all the way counts as a public transport trip only up to 15 minutes, so further out public transport can be slower than walking; the card then says walking is quicker. '
      + "Times are whole minutes from the routing, rounded down, so 30 min means under 31. They run from the middle of each hexagon to the Ministry's map point for the school, not to its nearest gate, unless the school's details under One school say its entrances were checked. On a large site a gate can be several minutes nearer."
      + (s.school_buses === false ? ` ${s.bus_note || 'Dedicated school buses are not in the timetable used here, so they are not counted.'}` : '')
      + (s.school_buses === true ? ' School buses in the timetable are counted.' : '')
      + (s.roll_date ? ` Rolls are at ${dated(s.roll_date)}.` : '')),
    (() => {
      const line = para('Before version 0.12.0 the card could name a school reached a different way from the time it showed. ');
      line.append(link('What changed', LINKS.changes), document.createTextNode('.'));
      return line;
    })(),
  ];
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
    // The usual time first; the others are what the When control offers.
    const windows = service.windows || [service.window];
    const when = (w) => (meta.windows || {})[w]?.when || w;
    const times = windows.length > 1 ? `${when(windows[0])}; also ${windows.slice(1).map(when).join(', ')}` : when(windows[0]);
    tr.append(el('td', null, service.label), el('td', null, `${service.standard_minutes} min`), el('td', null, times));
    body.append(tr);
  }
  table.append(head, body);

  const links = el('p', 'about-links');
  const slug = (meta.naming || {}).slug;
  links.append(link('Method', LINKS.method), document.createTextNode(' · '), link('Download the data', slug ? `downloads/${slug}/` : 'downloads/'), document.createTextNode(' · '), link('Code', LINKS.code));

  root.replaceChildren(
    el('p', 'eyebrow', 'Better Places Lab'),
    Object.assign(el('h2', null, 'TEAM: Transport Equity and Access Model'), { id: 'about-title' }),
    para(`TEAM shows how long it takes to reach everyday services and jobs from each part of ${place.name} without a car, who lives where that is too long, and what kind of change would shorten it.`),
    el('h3', null, 'Reading the map'),
    para('Pick a place, what you are getting to and how you travel at the top of the panel, then one of three questions. The key under the panel names every colour on the map.'),
    list([
      'Access: minutes to the nearest service. Blue is within the standard, orange is beyond it. How robust is this? shows whether it holds at other times, by more than one way, and as the standard moves. The row above the number switches the map to Choice, Fare or Fare burden.',
      'Choice: how many are within the standard, not only the nearest.',
      'Fare: the cheapest fare to the nearest one in time, for the traveller you set.',
      "Fare burden: that fare as a share of a day's income where people live.",
      'Who misses out: where the people beyond the standard live, how far short they are, and how that differs by deprivation, income, age, car ownership, ethnicity and disability. These figures count the fastest way without a car.',
      'What would help: the main reason each place misses the standard, and the kind of fix that points to. Pick a reason in the key to show only those places. With a fare budget, the fare itself can be the reason.',
      'Jobs: how many jobs are within 30 or 45 minutes, for a typical resident and by deprivation.',
      'Access score, at the foot of Getting to: every destination counted, with nearer ones counting for more. 100 is the city average.',
      'Click a hexagon for its card: the service on screen first, then every standard, three numbers and the detail folded under them.',
    ]),
    para(`Zoomed out, the figures in the panel are for all of ${place.name}. Zoom in and they are for the council, ward, local board or suburb in the middle of the map, whichever fills the view, with the larger areas around it on a line underneath. The area's name in the headline opens a list of areas to pick from. The map's colours and key stay the same.`),
    ...schoolsHelp(meta),
    el('h3', null, 'Settings'),
    para('Under Settings: Who is counted can leave out rural land. When picks the weekday peak, weekday off-peak or a Saturday for public transport. The standard is the time a service should be within. Under Fares, a budget counts public transport only when the trip fits it, in dollars or as a share of local income, and Travelling as and Paying with set who is paying and how. The fare burden can count a week of daily trips after fare caps. Layers adds rail, frequent buses, stops, cycleways and the places you are getting to.'),
    el('h3', null, 'Standards'),
    para('A place meets a standard when walking, cycling on low-stress routes or public transport gets there in time. Car times and cycling on busy roads are shown for comparison, under More in Travel by, but never count. The Standard slider under Settings changes the standard.'),
    table,
    el('h3', null, 'How it is built'),
    list([
      `Travel times come from R5 routing on OpenStreetMap streets and paths and the ${place.agency} timetable for ${date}. Public transport times are the median across the time window and include walking to the stop and waiting. The When control switches between the weekday peak, weekday off-peak and a Saturday.`,
      meta.cycling_stress === 'span'
        ? 'Low-stress routes are paths, protected lanes and quiet streets: traffic stress level 2 or below, rated by SPAN from Auckland’s speeds, traffic volumes and facilities.'
        : 'Low-stress routes are paths, protected lanes and quiet streets: level 2 or below on R5’s traffic-stress scale.',
      'Hills slow walking and cycling, from LINZ elevation models.',
      `Each hexagon covers about 0.1 km². There are ${count(meta.totals.cells)} with residents, holding ${count(meta.totals.population)} people from the 2023 Census.`,
      `Jobs are Stats NZ business demography employee counts (2024), ${count(meta.jobs.total)} in total, placed by where people work.`,
      'The reasons are screening rules. They show which kind of fix to look at first; they do not replace a local study.',
    ]),
    links,
    el('h3', null, 'Limits'),
    list([
      meta.schools
        ? `The nearest service is not always one you can use. For schools, the Schools row can count only state${readSchoolsMeta(meta).zones ? ' or in-zone' : ''} schools, or one school${readSchoolsMeta(meta).zones ? '' : '; school zones are not in yet'}. GP enrolment, opening hours and store size are not modelled.`
        : 'The nearest service is not always one you can use: school zones, GP enrolment, opening hours and store size are not modelled.',
      'Times come from timetables, not real-world reliability or crowding.',
      'Walking and cycling times allow for hills, but not lighting, footpath condition or benches.',
      'Census shares describe small areas, not individual households. No car and lower income are shares of households, applied to residents.',
      'Incomes are area medians before tax, adjusted for household size and raised to 2026 by wage growth.',
    ]),
    el('h3', null, 'Credit'),
    para('Built by the Better Places Lab, Te Pare School of Architecture, Planning and Design, Waipapa Taumata Rau | University of Auckland.'),
    para(`Cite as: Welch, T. F. (2026). TEAM: Transport Equity and Access Model, ${place.name}. Version ${meta.version}. Better Places Lab, University of Auckland.`),
    Object.assign(el('p', 'about-contact'), { textContent: 'Questions or data to share: t.welch@auckland.ac.nz' }),
  );
}
