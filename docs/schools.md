# Schools

How TEAM counts schools, what each school file holds, and every assumption
behind a school figure. Code: [`src/team/schools.py`](../src/team/schools.py).

## The directory

All twenty places read one dated copy of the Ministry of Education's schools
directory, `raw/nz/education/moe_schools_directory_<date>.csv`, made by
[`scripts/fetch_school_directory.py`](../scripts/fetch_school_directory.py)
from the data.govt.nz datastore (resource `4b292323-9fcc-41f8-814b-3c7b19cf14b3`,
CC BY 4.0). The metadata file beside it records when it was fetched, when the
Ministry last changed the dataset, the record count, the roll dates and a
checksum.

The current copy was fetched on 12 November 2026: 2,578 schools, 50 fields,
rolls at 1 October 2026 (68 schools have no roll). Each place keeps the
schools of the regional councils named under `schools.regions` in its config,
then those within about 8 km of the place, as before. Each config names only
the regions the place lies in (Nelson names Nelson and Tasman), so a school
over a regional boundary is not counted, however near: in Auckland, Pukeoware School (Waikato) is 160 m from an
Auckland hexagon, and about 2,000 rural Aucklanders have their nearest
secondary school, in a straight line, outside the region. Schools marked
"Proposed" are left out until they open.

### Which schools a service counts

A service counts the school types in its `school_types`. Every type in a
place's directory must be in a service or in `schools.EXCLUDED_TYPES`, and a
test fails otherwise.

| Service | Types |
| --- | --- |
| Primary | Contributing, Full Primary, Composite, Composite (Year 1-10) |
| Intermediate | Intermediate, Full Primary, Secondary (Year 7-15), Composite, Composite (Year 1-10), Restricted Composite (Year 7-10), Secondary (Year 7-10) |
| Secondary | Secondary (Year 7-15), Secondary (Year 9-15), Secondary (Year 11-15), Composite |
| None | Specialist School, Teen Parent Unit, Activity Centre, Correspondence School (enrolment by referral, or no site) |

Before 0.12.0 every config spelt the Restricted Composite type "(Yr 7-10)",
which matches nothing, and left out Secondary (Year 7-10). Both now count for
intermediate only, since these schools stop at Year 10.

### What each school is

| Field | From | Rule |
| --- | --- | --- |
| `kind` | Authority | state; integrated (State : Integrated); private (Private : Fully or Provisionally Registered); charter |
| `language` | Language_of_Instruction | english, maori or pacific. A school where all students are taught in te reo Māori or a Pacific language is maori or pacific. A school with some students in te reo Māori or a Pacific language is english, since most of its students are taught in English. Blank when the directory gives nothing. |
| `medium` | the same | english, other, or null when not given |
| `sex` | CoEd_Status, for each service | co-ed, girls or boys. "Primary Co-Ed/Secondary Girls" (or Boys) is co-ed for primary and girls (or boys) for intermediate and secondary. "Boys/Senior Co-Ed" (King's College, St Paul's Collegiate) takes girls only from Year 12, so it is boys for a student starting secondary school. Null when not given. |
| `years` | Org_Type | the range in the type's name; the Ministry counts to Year 15 for students who stay past Year 13 |
| `roll`, `roll_date` | Total, Roll_Date | the whole roll, all years; it weights the gravity scores |
| `scheme` | Enrolment_Scheme | whether the school has an enrolment scheme (a home zone) |

## Where a school trip ends

A school is routed to its checked entrances if it has any, and otherwise to
its directory map point. Its time is the fastest of its entrances.

- `configs/schools/points.csv` replaces a directory point that is wrong.
- `configs/schools/entrances.csv` lists entrances students use on school
  mornings, with the hours they are open.

A row in either file is used only when `checked_by` and `checked_on` are
filled. In 0.12.0 no row is checked: every school is routed to its
directory point, as before.

A directory point can sit deep inside a large site. Mt Albert Grammar
School's (174.72535, -36.88471) is 59 m inside its 19.5 ha grounds
(OpenStreetMap way 24530357, about 660 m by 740 m). R5 places it 23 m away,
on a path inside the grounds, and every walk to it takes within a minute of
the walk to the drive off Alberton Avenue on the west side, so in effect
every trip ends there. From the hexagons east and south of the school the
walk goes round the site: from the St Lukes hexagon on the councillors'
slide (89bb50021a3ffff), 80 m from the grounds, it is 15 minutes. `entrances.csv` lists three candidate entrances for the school, none
checked: the Alberton Avenue drive, a footpath on the north-east side
(OpenStreetMap way 260845395) and a gate on the south-east side (node
266732026, tagged locked, for customers, open 7:00 to 9:30 on weekdays). They
change nothing until a person confirms with the school which of them students
may use on school mornings. A check run to them, not published, is in the
0.12.0 changelog.

`scripts/school_points_review.py` writes two sheets for a person to work
through, and changes nothing itself:

- directory points compared with the school's grounds in LINZ NZ Facilities
  (matched on the MoE number). In Auckland, 7 of 551 points lie more than 50 m
  outside their own grounds and 29 schools have no grounds in the file.
- OpenStreetMap gates and crossings on each school's edge. Of 497 in Auckland,
  140 are tagged private or locked, so none is used without a check.

## Routing

Schools have runs of their own, `schools_<mode>` (dataset `schools`), so a
change to the directory, a point or an entrance re-routes schools only. The
settings are the same as every other run: hexagon centres to school points,
60-minute limit, public transport on Tuesday 15 September 2026, every
departure minute from 7:00 to 8:59.

- **Median and spread.** A public transport time is the median over the
  departure minutes. School runs also keep the 10th and 90th percentiles
  (`lo`, `hi`), for "usually X–Y min". R5's percentile of n departure
  times is the value at position ceil(p × n / 100) in the sorted times.
- **Whole minutes.** R5 gives whole minutes, rounded down: 30 min means under
  31.
- **The limit.** R5 can return a time a minute or more past 60 for the walk
  from the street to the point. Every count and pair already stopped at 60;
  from 0.12.0 the published times do too, for every service.
- **Every school, not only the nearest.** A school run keeps every school
  reached within 60 minutes from every hexagon, so any choice of schools can
  be worked out without routing again.
- **Ties.** Minutes are whole, so two schools often tie. The one named is the
  nearer in a straight line from the hexagon centre (to the whole metre), then
  the lower MoE number. Every tied school is listed.
- **Walking inside a public transport trip.** R5 lets a public transport trip
  walk up to 15 minutes to or from stops, and counts walking all the way only
  when the walk is within that 15-minute limit. When the public transport
  time equals the walking time, no bus or train gets there sooner than
  walking; the trip may be the walk itself. Where the walk is longer than the
  limit and no bus or train helps, public transport is slower than walking.
  Walking times are whole minutes rounded down, so a walk shown as 15 minutes
  can be up to 15:59 and over the limit. In Auckland, for secondary schools,
  151 of the 303 school pairs with a 15-minute walk have a slower public
  transport time (or none), and no pair with a walk of 14 minutes or less
  does. In R5's detailed itineraries, ten of those 151 walks took 914 to 954
  seconds; ten of the other 152 took 901 to 946 seconds too, and in the one
  looked at (to MAGS, a 906-second walk) public transport matched it with a
  bus trip of 15:26, so it still reads 15.
  Public transport is slower than walking in 1,718 hexagons for secondary
  school, 80 of them with a 15-minute walk. TEAM counts public transport as
  R5 routes it, as it does for every other service: the card and the map's
  tooltip say "Walking is quicker" there, and the key says a walk counts only
  up to 15 minutes. Counting the quicker of public transport and walking
  instead would put 77,139 more Aucklanders (845 hexagons) within 30 minutes
  of a secondary school by public transport, 84.5% against 79.8%; that is a
  change of measure for every service, not made here.

### Checks

- Before any point changed, the school runs gave exactly the minutes the
  services runs gave, for every pair and mode:
  [`scripts/check_school_runs.py`](../scripts/check_school_runs.py). Auckland:
  18.6 million pairs, 16.3 million of them by car, none different; all twenty
  places, 38.0 million pairs, none different. The only schools left out of the
  comparison are the ones the new directory added or moved. Run it after every
  school routing: in Christchurch the first routing of one batch of 2,000
  hexagons gave two of them different times (by a minute by car, and by 3 to
  4 minutes on foot to two schools), while three other routings of the same
  inputs, including the 0.11.0 services run, agree. That batch was routed
  again and now matches.
- Asking R5 for the 10th, 50th and 90th percentiles gives the same median as
  asking for the 50th alone (checked on 300 origins and all 551 Auckland
  schools: 33,741 pairs, none different).
- Five trips checked by hand against the timetable give the same medians from
  the school run (16, 32, 41, 24 and 24 minutes), and their 10th and 90th
  percentiles match the 120 departure minutes behind them
  (`tests/fixtures/schools/hand_trips.json`).

## The choices

| Choice | Counts |
| --- | --- |
| All | every school in the directory that teaches the service's years: today's measure |
| State | state schools taught in English: not integrated, private, charter, or a school where all students are taught in te reo Māori or a Pacific language. A school whose teaching language is not given is left out and counted as such. Home zones are not applied: a zoned school counts for everyone, in or out of its zone, and the line under the headline says so. |
| In zone | not yet: needs the Ministry's zone file (below) |
| One school | that school alone; see below |

Under State (and In zone, when it comes), a second row picks who is counted:

- **Girls** counts co-ed and girls' schools; **Boys** counts co-ed and boys'
  schools.
- **Girls and boys** (the default) counts a hexagon only if both a girl and a
  boy living there can reach a school in time. A mode's time is the slower of
  the girls' and the boys' times by that mode. The fastest-way time is the
  slower of the girls' fastest and the boys' fastest: each takes their own
  quickest way. This is not the quickest of the per-mode times, which would
  make both use one way.

The default stays All in 0.12.0, so every published figure and link keeps its
meaning.

Every school figure weights hexagons by all their residents (Census 2023),
of every age, not by school-age children; the line under every school
headline says so.

### One school without its zone

Until zones are in, nobody can be said to be in or out of a school's
catchment, and a share of everyone in the place would mostly count people
who would never go there (Mt Albert Grammar School by public transport: 3%
of Aucklanders, against 50% of the Albert-Eden Local Board area). So under
One school:

- the headline is the number of people who live within the standard of the
  school by the way shown (Mt Albert Grammar School, public transport, 30
  minutes: 57,003 people, shown as 57,000);
- for a local board, ward or suburb, the share of its residents follows,
  under the count;
- the area picked or in the link stays when the school changes, so two
  schools are compared for the same people;
- Who misses out and What would help are off, with a line saying why.

## In zone (when the zone file is in)

The code is in place and tested on made-up zones; nothing is published yet.

- Source: the Ministry's enrolment scheme master file
  (https://www.educationcounts.govt.nz/__data/assets/file/0003/108606/Enrolmentschememaster.zip,
  CC BY 3.0 NZ), downloaded by hand. Its projection is read from the file; a
  file with none is refused.
- A zone counts when its effective date is on or before the directory date.
  Later zones are listed, not applied.
- A zone whose name gives year levels ("(Year 7-8)") counts only for the
  service with those years.
- A hexagon is in a zone when the zone covers at least half its area.
  Hexagons a zone line crosses are flagged.
- In zone counts state English-medium schools whose zone covers the hexagon,
  plus state English-medium schools with no enrolment scheme, which must take
  any student who applies (to confirm with the Ministry). Integrated schools
  and kura are not in In zone: they enrol by their own rules.
- Eagle Technology's copy of the zones was used only to check this during
  development. Its terms are not open and nothing from it is published.

## What the site reads

### `cells.json` and `cells_more.json`

| Key | File | Holds |
| --- | --- | --- |
| `nearest` | cells.json | as before: the nearest by the fastest counting mode. Kept for older pages. |
| `nearest_mode[service][mode]` | cells.json (school services), cells_more.json (every service) | index into destinations.json of the destination reached in `t[service][mode]`, or null. The page merges the two files key by key, so the fuller copy replaces the first. |
| `ties[service][mode]` | cells.json | `{cell index: [destination indices]}`: other schools reached in the same minute, in the order above |

Modes are walk, bike_low_stress, bike, pt and car.

### `destinations.json`

A school's entry adds `moe`, `kind`, `medium`, `language`, `sex`
(`{service: co-ed | girls | boys | null}`), `years` ([from, to]), `roll`,
`roll_date`, `scheme`, `zone_from` (null until zones are in), `routed_to`
("point" or the number of checked entrances) and `point` (directory or
corrected). Schools are keyed `moe:<School_Id>` in every build file, so the
MoE number is the link to a school across rebuilds (`sch=one:69`).

### `schools/<service>_<mode>.json`

Every school within 60 minutes of each hexagon, for one service and mode
(walk, bike_low_stress, bike, pt, pt_slow, car), loaded only when a school
choice is made.

```text
{format: 1, service, mode, window, max_minutes, order,
 o: [n + 1 offsets],   cell i's schools are positions o[i] to o[i+1] - 1
 d: [destination index], m: [minutes],
 lo: [...], hi: [...]}  pt only: 10th and 90th percentiles; hi is null past 60 minutes
```

Each cell's list is in the order above (minutes, metres, MoE number), so the
first school that a choice counts is its nearest.

By car nearly every school is within 60 minutes, so the car files are short
lists (`complete: false`): for each cell, only the nearest school under All,
State, State girls and State boys, and the schools tied with each. They answer
those choices exactly; One school is not shown by car. The full car lists
would be 9 MB brotli for Auckland; the short ones are 0.06 MB each.

Auckland's eighteen files come to 4.5 MB brotli; the largest is primary
school by public transport, 0.85 MB.

### `summary.json`

`meta.schools` gives the directory file and its dates, the counts behind the
"Counting ..." line for each service (`services`), how many schools are routed
to a point or to entrances, whether the place's timetable has school buses,
and each file's size. The page reads it through `readSchoolsMeta` in
`web/js/schools.js`: the directory date is `dates.directory`, the roll date is
the date most schools' rolls are at, the reach lists on offer are the names in
`files`, and `buses` is `in_timetable` or `none_found`.

### `schools/zones.json` (not written yet)

The page offers In zone only when `meta.schools.zones` is set (the zone
file's date). It then reads `schools/zones.json`:

```text
{format: 1, date,
 schools: {"<destination index>": {moe, from, outline: GeoJSON geometry}},
 in:  {service: {o: [n + 1 offsets], d: [destination index]}},   zone covers at least half the hexagon
 cut: {service: {o, d}}}                                          zone line crosses the hexagon
```

### Downloads

`team_<place>_schools.csv`: every school counted, with the fields above and
its map point.

## The page

The Schools row sits under Getting to for the three school services: All,
State, In zone (once zones are in) and One school, with Girls and boys, Girls
or Boys under State. A link without `sch` means All. `web/js/schools.js`
works every choice out from the reach lists and puts its times in place of
All's, so the map, headlines, areas and card all follow it. It follows the
build's rules exactly:

- **Order.** The school named, and the order of tied schools, is the order of
  the reach list. The page does not work distances out again: done that way,
  on the sphere rather than in NZTM metres, it named a different tied school
  from the build in 256 Auckland hexagons for primary school on foot.
- **Teaching language or sex not recorded.** A state school whose teaching
  language the directory does not give is not counted under State (in 0.12.0,
  Te Wharekura o Tāmaki ki te Tonga, Auckland primary and intermediate), and
  the counting line says so. A school that does not say whether it is co-ed
  counts for neither girls nor boys (Nova Innovation College, a private
  school, so State is not affected).
- **Car.** A short car list answers All and State only. Under One school the
  page has no car times and shows Best instead; the card's "Not counted" line
  is left out by car.
- **On foot, for girls and boys together.** The public transport time shown
  is the slower student's. It is said as a walk ("No bus or train is
  quicker") only where, for each student whose time it is, walking takes as
  long as public transport. Equal joint times are not enough: in 0.12.0 that
  would have said it wrongly in 17 hexagons (15 for secondary school, 2 for
  intermediate) across Auckland, Christchurch, Dunedin, Hamilton,
  Invercargill and Nelson.
- **None by public transport, but a walk.** A public transport trip may walk
  only so far straight to the door, so where no bus helps a school 22 minutes
  away on foot can be over 60 minutes by public transport (a girl in central
  Blenheim, to Marlborough Girls' College). The card then says "Walking is
  quicker" and names the school within reach on foot. The figures are not
  changed: public transport is counted as R5 routes it.

## Figures for testing the site

`scripts/school_golden.py` works every choice out from a place's published
files and writes `tests/fixtures/schools/golden_<place>.json`: the share of
people within the standard for each choice, service and mode, every figure
and the schools named for the hexagons given, and checks that the files agree
(the school named is the first in the reach list, its minutes are the time
shown, tied schools have the same minutes, no time is over 60). Auckland's
covers the slide hexagon and the hexagons around MAGS, with MAGS, Marist,
TKKM o Nga Maungarongo, Western Springs College, Auckland Grammar and Epsom
Girls Grammar as one school each; Wellington's and Blenheim's cover two
hexagons and three and two schools.

`tests/web/schools_parity.test.mjs` works the same figures out with the
page's code and must match every one, to 1e-6 of a share. It also rebuilds All
from the reach lists and checks it gives cells.json's times, school named,
ties and choice counts for every hexagon, and that the counting line's counts
equal `meta.schools.services`. It needs the built files:

```sh
TEAM_SITE=<site>/data node --test tests/web/schools_parity.test.mjs
TEAM_SITE=<site>/data PYTHONPATH=src pytest tests/test_schools.py
```

## School buses

Wellington's Metlink timetable has 123 school bus routes, Dunedin's has 8
routes named for schools and Palmerston North's has 10. Auckland Transport's
dedicated school buses
(https://at.govt.nz/bus-train-ferry/timetables/school-bus-timetables) are
not in its open timetable, so they are not counted. A few public routes run
school-time trips on the routing day, and those are counted: on Tuesday 15
September 2026, route 747 Panmure to Selwyn College at 7:35, route 989
Ahutoetoe School to Hibiscus Coast Station at 7:26, and route 997 Warkworth
to Omaha (AM School) at 8:25. Each place's config says which
(`schools.buses`, `schools.bus_note`); the card says dedicated school buses
are not counted wherever none were found.

### Reading the card and the map

- **Nearest** means quickest by the way shown. Every school reached in the
  same minute is named, nearest in a straight line first. The key says so.
- **The tooltip** on the map uses the card's own first sentence, so a public
  transport time that is a walk reads "9 min on foot. No bus or train is
  quicker." on both, and Best names the way ("6 min by low-stress
  cycling"). Where walking is quicker than public transport, the tooltip
  says so too.
- **State** on the card means what the State choice counts: "Nearest state
  school taught in English".
- **When.** Public transport was routed on one day, Tuesday 15 September
  2026, leaving each minute from 7:00 to 8:59. The spread on the One school
  card ("By public transport, usually 23–30 min") and the CSV name that day
  rather than "weekdays".
- **Where the times end.** The One school card says the time goes to the
  Ministry's map point for the school, not its nearest gate, with the pin's
  straight-line distance from the hexagon. The CSV says the same.
- **Links.** A link pasted into a page already open, differing only after
  the `#`, reloads the page, so the figures match the link.
- **Search.** "Mount" finds "Mt", "Saint" finds "St", and initials find a
  school (MAGS, EGGS, AGS).

## Not in this release

- In zone, until the Ministry's zone file is in. Until then One school's
  headline is a count of people, and Who misses out and What would help are
  off for one school.
- Checked entrances and corrected points: the review sheets are ready, and
  Mt Albert Grammar School's candidates are listed.
- The walking inside a public transport trip to one school (to the first
  stop, from the last), from R5's itineraries.
- Weighting by school-age children rather than all residents.
- Schools across a regional boundary.
- Two schools side by side.
- Arriving by the school bell, rather than leaving at any minute from 7 to 9.
- Rolls for Years 9 to 13 only, as weights.
- Routing chosen schools beyond 60 minutes.
