// The About dialog. Plain statements of what TEAM shows, how, and its limits.

import { count, el, place } from './format.js';
import { DEFAULT_SCHOOL_CHOICE, readSchoolsMeta, stopHours } from './schools.js';

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
  for (const item of items) if (item) ul.append(el('li', null, item));
  return ul;
}

function link(label, href) {
  const a = el('a', null, label);
  a.href = href;
  a.rel = 'noopener';
  return a;
}

/** A date in the build ("2026-10-02") as "2 October 2026". */
function dated(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
}

/** How the Schools row counts, for builds that say what each school is. */
function schoolsHelp(meta) {
  if (!meta.schools) return [];
  const s = readSchoolsMeta(meta);
  const zoneFile = s.zone_source;
  const orWalk = Boolean(meta.pt_or_walk);
  const ages = Boolean(meta.ages);
  const choices = [
    'All: every school that teaches those years, whether state, state-integrated, private or charter, single-sex included. This is what TEAM showed before the row was added. A link says sch=all for it.',
    'State: state schools taught in English. A state school whose teaching language the directory does not give is left out, and the line under the headline says so. Girls and boys counts a place only when both a girl and a boy living there can reach a school they can go to, and uses the slower of the two times. Girls or Boys counts co-ed schools and that one\'s own. Home zones are not applied: a school with a zone counts for everyone, in or out of it.',
    'Secondary school where a school stops at Year 10 or starts at Year 11 (in Auckland and Hamilton): State and In zone count a place only when a student in Years 9 and 10 and one in Years 11 to 13 can each reach a school that teaches them, and use the slower time, as for girls and boys. All counts any school that teaches any of Years 9 to 13.',
  ];
  if (zoneFile) {
    const upcoming = s.zone_upcoming.filter((z) => z.applied).length;
    choices.push(`In zone: the state schools taught in English that must take a child living there. A state school with no enrolment scheme must take any student who applies, so it counts everywhere; a state school with a scheme counts only for homes inside its zone. `
      + `Zones are the Ministry of Education's, from its file of ${dated(zoneFile.version) || 'the date in the build'}, as they apply on ${dated(s.zone_reference) || 'the directory date'}: a zone counts from the date it takes effect. `
      + `Where the file holds only a zone that starts later${upcoming ? ` (${upcoming} ${upcoming === 1 ? 'school' : 'schools'} here)` : ''}, that zone is used, and the line under the headline names the school. `
      + 'A zone for some year levels only, such as Years 7 and 8, counts only for the service with those years. '
      + 'A school with a scheme but no zone in the file, or a zone in the file but no scheme in the directory, counts for everyone. '
      + 'Integrated, private and charter schools and kura are not counted: they enrol by their own rules. Nor are designated character schools (Vanguard Military School, Hagley College and others, from Gazette notices): their boards may decline a student whose family does not accept the school\'s character. Places offered out of zone by ballot are not counted. Girls, Boys, and Girls and boys work as under State.');
    choices.push('Each hexagon has one travel time, from its centre. Where a zone line crosses a hexagon, its residents are placed at their addresses (LINZ address points, each taking an equal share of its census block\'s residents), and the hexagon is counted with the zones most of its residents live in. The line under the headline says how many live in hexagons split this way, and how many of them live outside the zones their hexagon is counted with.');
  } else if (s.zones) {
    choices.push(`In zone: the state schools whose home zone covers at least half of a hexagon, and the state schools with no enrolment scheme. Zones are the Ministry of Education's, as at ${dated(s.zones) || 'the date in the build'}.`);
  }
  choices.push(`One school: minutes to one school, found by name or by clicking its pin. ${zoneFile
    ? 'For a school with a home zone, the headline is the share of those living in its zone who are within the standard of it, each hexagon counted by the share of its residents inside the zone, and its zone is outlined on the map. Who misses out and What would help count them too. Where part of the zone lies outside this place, only the part inside it is counted, and the headline says so. Living in a state-integrated school\'s zone does not by itself give a right to enrol: it takes children whose families accept its special character first. A school with no home zone has no catchment to give a share of, so the headline is how many live within the standard of it, and those two tabs are off. One school counts the children of the ages its own years cover (15 to 17 for a school that starts at Year 11), and for a girls\' or a boys\' school only girls or boys: the place\'s share of them in the 2018 Census, taken to live where the others do.'
    : s.zones
      ? 'With Only those living in its zone ticked, the figures count the people in its zone and nobody else. Without it, they count everyone, as below.'
      : 'School zones are not in this build yet, so the headline is the number of people who live within the standard of the school, and a share is given only for a local board, ward or suburb, named under the number. Who misses out and What would help are off for one school until zones are in.'} The area you pick stays when you change school, so two schools are compared for the same people. There are no car times to one school.`);
  if (s.stops) {
    choices.push(`Stops near the school, under One school: every stop and station within a ${s.stops.max_walk_minutes || 15}-minute walk of the school's map point, walking on the street network, with the routes and the trips arriving ${stopHours({ window: s.stops.window })}, where students can get off, on ${dated(s.stops.date) || 'the routing day'}, from the timetable used. A stop is listed whether or not the quickest trip uses it.`);
  }
  const listed = dated(s.directory);
  const points = s.points;
  const moved = points && Array.isArray(points.moved) ? points.moved.length : null;
  const paras = [
    el('h3', null, 'Schools'),
    para(`For primary, intermediate and secondary schools, the Schools row under Getting to sets which schools count. ${DEFAULT_SCHOOL_CHOICE === 'zone'
      ? 'The page opens on In zone, or on All where the build has no zones.'
      : 'The page opens on All.'}`),
    list(choices),
    para(`A line under every headline says which schools are counted, with counts from the Ministry of Education's school directory${listed ? ` as at ${listed}` : ''}. `
      + (meta.formats ? "Schools are those in the place's routing area, its census blocks plus about 8 km, from any region; early childhood services come from each region's own list. " : '')
      + (ages ? 'The figures count children of the ages that go to each kind of school (below). ' : 'The figures count all residents of each hexagon, of every age, not only school-age children. ')
      + 'Nearest means quickest by the way of travelling shown. The card names that school, and every school reached in the same minute, nearest in a straight line first. '
      + (orWalk
        ? 'A public transport time is the quicker of the trip and walking all the way, and a walk is said as one, with the bus or train time beside it. '
        : 'A public transport time that is no quicker than walking is a walk, and is said as one. A walk all the way counts as a public transport trip only up to 15 minutes, so further out public transport can be slower than walking; the card then says walking is quicker. ')
      + "Times are whole minutes from the routing, rounded down, so 30 min means under 31. They run from the middle of each hexagon to the Ministry's map point for the school, not to its nearest gate, unless the school's details under One school say otherwise. On a large site a gate can be several minutes nearer."
      + (s.school_buses === false ? ` ${s.bus_note || 'Dedicated school buses are not in the timetable used here, so they are not counted.'}` : '')
      + (s.school_buses === true ? ' School buses in the timetable are counted.' : '')
      + (s.roll_date ? ` Rolls are at ${dated(s.roll_date)}.` : '')),
  ];
  if (points && moved != null) {
    paras.push(para(`School points: a point is moved only when it is more than 100 m outside the school's own grounds in LINZ's NZ Facilities and the school's grounds in OpenStreetMap match LINZ's, and the point is inside no school's grounds; it then goes inside the grounds, 10 m in from the edge. ${moved === 0 ? 'No school here was moved.' : `${moved} ${moved === 1 ? 'school here was' : 'schools here were'} moved, and the card says so.`} Other points that looked wrong were listed for checking and not changed.`));
  }
  if (zoneFile) paras.push(para("The zones were checked against Eagle Technology's copy of them; nothing from it is published."));
  paras.push(para('Fare budgets and the fare maps are worked out for all schools only, so under State, In zone and One school they are off. A school link made for a fare before this release opens on All. Rows on the card for a school service not on screen count all schools, and say so.'));
  const line = para('Before version 0.12.0 the card could name a school reached a different way from the time it showed. ');
  line.append(link('What changed', LINKS.changes), document.createTextNode('.'));
  paras.push(line);
  return paras;
}

/** Who the figures count: children for early childhood and schools, in a
 *  build with ages. */
function whoHelp(meta) {
  const a = meta.ages;
  if (!a) return [];
  const shape = a.shape === 'census2023_sa2'
    ? "split into single years using the 2023 Census single years of the area around it (SA2)"
    : "split into single years using the 2018 Census mix of single years in the area around it (SA2), because the 2023 single years are not open";
  return [
    el('h3', null, 'Who is counted'),
    para('For early childhood and the three school services, the figures count children of the ages that go there: 0 to 4 for early childhood, 5 to 10 for primary (Years 1 to 6), 11 and 12 for intermediate (Years 7 and 8) and 13 to 17 for secondary (Years 9 to 13). Everything else counts all residents.'),
    para(`The 2023 Census gives ages in five-year groups for each small area (SA1). TEAM ${shape}, then spreads the children onto hexagons as it spreads residents. `
      + 'An even split goes badly wrong where students live: in Campus North, Dunedin, an even fifth of each year gives 873 people aged 13 to 17, against the 132 the 2018 Census counted. '
      + "A child's school year is taken from their age. Ages are on census day, in March 2023, early in the school year, so about a third of Year 7 and of Year 9 students are counted with the age group below, and some 17-year-olds have left school. Within a hexagon, children are taken to live where its residents do."),
    para('Under these services the groups in Who misses out are the children times the group\'s share of the census block, which is for all ages. Under 15 and 65 and over are left out.'),
  ];
}

/** How public transport times are worked out, in a build that takes the
 *  walk where it is quicker. */
function timesHelp(meta) {
  if (!meta.pt_or_walk) return [];
  return [
    el('h3', null, 'How times are worked out'),
    para('Public transport times are the quicker of the public transport trip and walking all the way. The routing engine lets a trip walk up to 15 minutes to and from stops and drops a walk all the way once it passes that, so on its own it can make public transport look slower than walking. From 0.12.0 TEAM takes the walk wherever it is quicker, for every service, for jobs, for the access scores and for fares. A trip on foot has no fare.'),
    para('Trips from one hexagon to another, behind ?mate=1, are not covered: they are R5\'s own.'),
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
    ...whoHelp(meta),
    ...timesHelp(meta),
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
      meta.schools
        ? "Schools are from the Ministry of Education's directory (CC BY 4.0) and its enrolment zone file (CC BY 3.0 NZ). Residents in hexagons a zone line crosses are placed by LINZ NZ Addresses, and school grounds are checked against LINZ NZ Facilities and OpenStreetMap (CC BY 4.0; ODbL)."
        : null,
      `Each hexagon covers about 0.1 km². There are ${count(meta.totals.cells)} with residents, holding ${count(meta.totals.population)} people from the 2023 Census.`,
      `Jobs are Stats NZ business demography employee counts (2024), ${count(meta.jobs.total)} in total, placed by where people work.`,
      'The reasons are screening rules. They show which kind of fix to look at first; they do not replace a local study.',
    ]),
    links,
    el('h3', null, 'Limits'),
    list([
      meta.schools
        ? `The nearest service is not always one you can use. For schools, the Schools row can count only state${readSchoolsMeta(meta).zones ? ' or in-zone' : ''} schools, or one school${readSchoolsMeta(meta).zones ? '' : '; school zones are not in yet'}. Schools are timed leaving at any minute from 7am to 9am, not to arrive by the bell. GP enrolment, opening hours and store size are not modelled.`
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
