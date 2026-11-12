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
rolls at 1 October 2026 (68 schools have no roll). Schools marked "Proposed"
are left out until they open.

### Which schools a place keeps

From 0.12.0 a place keeps every open school, from any region, whose map point
is

- inside the place's routing area: its census blocks plus 0.08 degrees (about
  8 km), the cut every national destination file gets
  (`destinations.city_bounds`), and
- within 1 km of a street a person can walk on in the place's street file
  (`schools.STREET_REACH_M`). R5 links a point to the nearest street within
  1,600 m, but the street file stops a little beyond the census blocks, so
  past about a kilometre the nearest street in it is seldom the school's own
  and the trip would be timed to the wrong road.

Before, each config named its regional councils (`schools.regions`) and a
school over a boundary was never counted, however near. That setting is gone;
`meta.schools.directory.regional_councils` counts the schools a place keeps
by regional council.

This adds 60 schools in five places: Auckland 43 (30 in Waikato, 13 in
Northland, among them Pukeoware School, 160 m from an Auckland hexagon, Tuakau
College, Pokeno School and Mangawhai Beach School; Coromandel Area School and
Thames High School fall inside Auckland's box because of the Gulf islands and
are mostly beyond 60 minutes), Wellington 7 (Horowhenua and Tararua: Levin
East School, Waiopehu College, Manakau, Ohau, Taitoko, Eketāhuna and Alfredton
schools), Rotorua 4, Nelson 3 (Marlborough: Rai Valley Area School, Wairau
Valley and Canvastown) and Tauranga 3 (Putāruru College, Kuranui and Te Poi).

The street rule leaves out schools in the box that the street file does not
reach, listed under `far_from_streets` in `destinations/schools_summary.json`
and `meta.schools.directory`: Onewhero Area School, Meremere, Pukekawa and Te
Kohanga schools south of Auckland's file (3 to 4 km from its last street), the
Levin schools north of Wellington's (Horowhenua College 1.4 km), and 9 schools
that round 1 had counted: Kawhia and Kio Kio (Hamilton), Coley Street
(Palmerston North), Kawerau Putauaki (Rotorua), TKKM o Rotoiti (Tauranga),
Mangakino (Tokoroa), Te Wharekura o Ruatoki, Tāwera Bilingual and Waimana
(Whakatāne) and Mangamahu Primary (Whanganui). None of the 9 had a time on
foot, by bike or by public transport from any hexagon; 4 had car times, to
the edge of the street file. No other figure changes for them.

Early childhood services still come from each place's regional file and are
cut by `city_bounds` alone; the regional boundary rule here is for schools.

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
| `language_source` | how `language` was set | `directory`; `attributes` (a checked row in `configs/schools/attributes.csv`); `peak_body` (below) |
| `region` | Regional_Council | the school's regional council, for the record of where schools come from |
| `point`, `point_source`, `point_moved_m` | configs/schools/points.csv | `directory` or `corrected`, where the point came from, and how far it moved from the directory's |

**No teaching language, a Māori-medium peak body.** A state school the
directory gives no teaching language for, whose `KMEPeakBody` is Ngā Kura ā
Iwi o Aotearoa or Te Rūnanga nui o ngā Kura Kaupapa Māori o Aotearoa, is taken
as Māori-medium (`language_source` "peak_body"). Of the 113 open schools in
the 12 November 2026 directory with either peak body, 106 teach all students
in te reo Māori, 5 some students, 1 none and 1 does not say. This affects one
school: Te Wharekura o Tāmaki ki te Tonga (4575, Clendon Park, opened 12
October 2026), Auckland primary and intermediate. It was already left out of
State for having no teaching language, so no figure changes; the counting
line now names it as Māori-medium "from its peak body"
(`state_maori_peak_body` in `meta.schools.services`).

`configs/schools/attributes.csv` (moe, name, field, value, source,
checked_by, checked_on) replaces any directory field for one school, as the
directory would write it, once a person has checked it. It has no rows.

## Where a school trip ends

A school is routed to its checked entrances if it has any, and otherwise to
its map point: the Ministry's, or a corrected one. Its time is the fastest of
its entrances.

- `configs/schools/points.csv` replaces a directory point that is wrong.
- `configs/schools/entrances.csv` lists entrances students use on school
  mornings, with the hours they are open.

A row in either file is used only when `checked_by` and `checked_on` are
filled. No entrance is checked.

**Mt Albert Grammar School keeps the Ministry's point.** Its point
(174.72535, -36.88471) is 59 m inside its 19.5 ha grounds (OpenStreetMap way
24530357). R5 links it 23 m away, on a path inside the grounds, and every walk
to it takes within a minute of the walk to the drive off Alberton Avenue on
the west side, so in effect every trip ends there. Google Maps also routes
trips to the school to the Alberton Avenue entrance, wherever they start
(Tim Welch tried several, November 2026). The three candidate entrances in
`entrances.csv` (the Alberton Avenue drive, a north-east footpath and a
south-east gate tagged locked) stay unchecked and unused, and the round-1
figures for the east gates stay unpublished.

### Checking every map point

`scripts/school_points_audit.py` (and `team schools audit-points` for one
place) checks every school's directory point against two records of where its
grounds are, and against the streets
([`src/team/school_points.py`](../src/team/school_points.py)):

- LINZ NZ Facilities (https://data.linz.govt.nz/layer/105588-nz-facilities/,
  CC BY 4.0), fetched from its public copy
  (https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Facilities/FeatureServer/0)
  by `scripts/fetch_school_grounds.py` on 12 November 2026 into
  `raw/nz/education/linz_nz_facilities_2026-11-12.gpkg` (data last edited
  19 March 2026; 2,525 school polygons, matched on `source_facility_id`, the
  MoE number; 5 hospital polygons with a blank use left out);
- OpenStreetMap school grounds (`amenity=school` areas) in the place's street
  file, matched on their `MOE:id` tag, or by name within 200 m when they have
  none (shown, never used to move a point);
- the streets: straight-line metres to the nearest way a person can walk on,
  and to where R5 links the point for walking (`team schools stops` writes
  these to `destinations/school_snap.json`).

**Rule D5-1** is the only rule that moves a point. It moves one only when the
point is more than 100 m outside its own LINZ grounds, its OpenStreetMap
grounds (matched by MoE number) overlap the LINZ grounds with an intersection
over union of at least 0.5, so the two sources agree where the school is, and
the point is inside no school's grounds in either source. The new point is
inside the LINZ grounds, 10 m in from the edge nearest the old point (their
representative point if the grounds are narrower than 20 m). The rule's rows
go into `points.csv` with `rule` D5-1, `checked_by` "rule D5-1" and the
sources and distance in `source`; a row a person checked is never replaced.
Moved schools are routed again (below).

Across the 20 places (1,902 school entries, 1,894 schools) 1,785 points are
inside their own LINZ grounds, 69 within 50 m of them and 23 more than 50 m
outside; 25 schools have no LINZ grounds, mostly charter schools and schools
opened since 2023. The rule moves three:

| School | Place | Directory point outside its grounds | Moved |
| --- | --- | ---: | ---: |
| Te Aute College (232) | Napier and Hastings | 250 m | 263 m |
| Te Kura aa Iwi o Ngaati Kauwhata (3618) | Palmerston North | 589 m | 602 m |
| Porirua Montessori Primary School (3641) | Wellington | 185 m | 219 m |

Every other school that needs a look is listed, unchanged, in
`school_points_to_check.csv` (with a map link): more than 50 m outside its
own grounds, inside another school's grounds, more than 150 m from a
walkable way or from where R5 links it, or with no LINZ grounds. The furthest
outside are Twin Oaks Classical School (4.5 km; no OpenStreetMap grounds),
OneSchool Global (2.5 km; the two sources disagree) and Hare Krishna School
(592 m; they disagree). Each place's audit is `destinations/school_points_audit.csv`;
`meta.schools.points` gives the rule, the moves and the counts, and the
schools CSV gives `point_source` and `point_moved_m`.

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

### Public transport, or walking where that is quicker

R5 lets a public transport trip walk up to 15 minutes to or from stops, and
drops a walk all the way once it passes that limit. Walking times are whole
minutes rounded down, so a walk shown as 15 minutes can be up to 15:59. On
its own R5 therefore shows public transport slower than walking wherever the
walk is over the limit and no bus or train helps: from the hexagon south-east
of MAGS (89bb50021b7ffff) a 15-minute walk comes out as 26 minutes by public
transport (usually 23 to 30), and a girl in central Blenheim (89bb29ba32fffff)
is 22 minutes on foot from Marlborough Girls' College and over 60 by public
transport.

From 0.12.0 a public transport time is the quicker of R5's trip and walking,
school by school and hexagon by hexagon, for every place and service
([`src/team/pt_or_walk.py`](../src/team/pt_or_walk.py)):

- **Pairs.** For each hexagon and school, minutes = min(R5's public transport
  minutes, walking minutes). At the slower walking pace (`pt_slow`) the walk
  is the walking time × 4.8 / 3.6, rounded down. A pair where walking is at
  least as quick is a walk: no fare, no bus or train.
- **Spread.** For every departure minute the trip is the quicker of the bus
  leaving then and the walk, which does not depend on the clock. R5's
  percentile is a position in the sorted minutes, and taking the quicker of
  each and the walk does not reorder them, so the new 10th and 90th
  percentiles are exactly the lower of R5's and the walk. Where R5 has no
  trip within 60 minutes, the trip is the walk at every minute.
- **Lists.** The public transport reach lists now hold every school reached
  on foot too, sorted again in the usual order (minutes, metres, MoE number),
  so the school named and its ties follow from the lists as before. R5's own
  minutes are kept where they are slower or missing (`r5`, below).
- **Everything else.** The same holds for the other services, for jobs within
  30 and 45 minutes, the competition-adjusted job measure, the gravity scores
  and fares (methodology.md, section 3). Best, and Who misses out by Best, do
  not change: Best already took the quicker of walking and public transport,
  and ties go to walking. Public transport counts as a way of its own in
  `options_` only where a bus or train is quicker than walking. Errand rounds
  already took the faster of the two leg by leg. The cell-to-cell trips behind
  `?mate=1` keep R5's paths and are not changed.
- **Checked first.** The build works from each run's cached pairs, and stops
  if they do not give the run's own nearest times and counts (and jobs to
  within float rounding): `tests/test_pt_or_walk.py`
  `test_cached_pairs_reproduce_the_runs`, every place and run.

Before and after, every place, service and window, all residents and every
school counted: `scripts/pt_or_walk_report.py`. In Auckland secondary school
by public transport goes from 79.8% of residents within 30 minutes to 84.5%
(77,140 more people; 4,355 hexagons have a new time) and intermediate school
from 63.1% to 72.4% within 20 minutes; Blenheim secondary from 36.4% to
81.4%. The file is in the round-2 reports (`d2_before_after.csv`).

### Re-routing only the schools that changed

`team schools reroute` routes only schools that were added, moved or removed
since the runs were routed (docs/running.md), so every other school's
minutes stay as published. In 0.12.0 it routed the 60 schools the regional
boundary rule added and the 3 points rule D5-1 moved, and dropped the 13
schools left out for being off the street file, in 11 places, for every
school mode including car. Each reroute ended with 300 sampled hexagons
routed to every school in a fresh process; every pair matched
(`verified` in each run's manifest), and `check_school_runs.py --before`
found every other school's pairs unchanged.

## Stops near a school

For each school, every stop or platform in the place's timetable within
1,300 m in a straight line is routed on foot to the school's routing point
(the Ministry's point, or the corrected one) with r5py: the place's walking
network and heights, 4.8 km/h, whole minutes rounded down. Stops with a walk
of 15 minutes or less are listed, quickest first. Platforms with a parent
station are listed once, as the station, at the walk to its quickest
platform. For each stop: the routes and trips with a departure from 07:00:00
to 08:59:59 on Tuesday 15 September 2026, the day and window school trips are
routed in, counting the services that run that day by `calendar.txt` and
`calendar_dates.txt` (a trip of the day before past midnight counts too), and
for each route its short name, mode (`route_type`), headsigns and trips. A stop
is listed whether or not the median trip uses it: this is what is near the
school, not how the median trip gets there. Code:
[`src/team/school_stops.py`](../src/team/school_stops.py); `team schools stops`
routes the walks.

A stop no trip in the feed stops at, on any day, is listed with `served`
false. Near Mt Albert Grammar School 32 stops are within a 15-minute walk of
its point. The nearest, the stop named Mount Albert Grammar School (1427), is a
minute's walk (95 m), but no trip in Auckland Transport's open timetable stops
there on any day; it may be for the school's dedicated buses, which that
timetable leaves out. The Marist College stop (1429, 5 minutes) is the same.
The nearest stops with trips between 7 and 9am are Owairaka/Mount Albert on
Owairaka Avenue (8816 and 8823, route 66, 7 and 8 minutes, 8 trips each) and
Ferndale House on New North Road (8226 and 8229, routes 22N, 22R, OUT and
209, 7 and 8 minutes, 17 and 36 trips).

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
  again and now matches. In round 2 the two hexagons (89dab36a87bffff and
  89dab36d627ffff) were routed again five times in fresh processes and once
  in their batch: every time the same minutes as now, and R5 linked each to
  the same point. The first routing ran just after two shards had failed while
  clearing r5py's shared cache, which is the likely cause; it could not be
  repeated.
- Every reroute is checked twice: 300 sampled hexagons routed again to every
  school in a fresh process (`team schools verify`, kept in the run's
  manifest), and every untouched school compared with its copy from before
  (`check_school_runs.py --before`).
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
| `ptr[service]` | cells.json | `{cell index: R5 minutes or null}`, usual window, every service: R5's own public transport time where it is slower than walking or missing within 60 minutes, and walking gets there within 60. Where `t[service].pt` equals `t[service].walk` the time shown is a walk. |
| `cost[purpose].z0` | cells_more.json | minutes to the nearest on foot within the fare time cap: no fare (`costw` likewise for other windows) |

Modes are walk, bike_low_stress, bike, pt and car. `summary.json`
`meta.formats` gives each changed file's format (`cells` 2, `school_reach` 2,
`school_stops` 1, and the zone files), and `meta.pt_or_walk` the rule, what
it covers and what it does not.

### `destinations.json`

A school's entry adds `moe`, `kind`, `medium`, `language`, `sex`
(`{service: co-ed | girls | boys | null}`), `years` ([from, to]), `roll`,
`roll_date`, `scheme`, `zone_from` (null until zones are in), `routed_to`
("point" or the number of checked entrances), `point` (directory or
corrected), `point_note` (for a corrected point, "Moved 263 m to its grounds:
the Ministry's point was outside them"; else null) and `language_source`.
Schools are keyed `moe:<School_Id>` in every build file, so the
MoE number is the link to a school across rebuilds (`sch=one:69`).

### `schools/<service>_<mode>.json`

Every school within 60 minutes of each hexagon, for one service and mode
(walk, bike_low_stress, bike, pt, pt_slow, car), loaded only when a school
choice is made.

```text
{format: 2, service, mode, window, max_minutes, order, complete,
 pt_or_walk: true,     pt and pt_slow files only
 o: [n + 1 offsets],   cell i's schools are positions o[i] to o[i+1] - 1
 d: [destination index], m: [minutes],
 lo: [...], hi: [...], pt only: 10th and 90th percentiles; hi is null past 60 minutes
 r5: {k: [positions], m: [R5 minutes | null]}}   pt and pt_slow only
```

Each cell's list is in the order above (minutes, metres, MoE number), so the
first school that a choice counts is its nearest. In the public transport
files `m` is the quicker of R5's trip and walking, and the lists hold schools
reached only on foot; `r5` gives R5's own minutes at the positions where they
are slower than `m` or missing (null), so the card can say "By bus or train:
26 min" or that none gets there within 60. Format 1 had R5's minutes only.

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

### `schools/stops.json`

Loaded only under One school.

```text
{format: 1, date: "2026-09-15", window: ["07:00", "08:59"], max_walk_minutes: 15, gtfs: "<file>",
 stops: [{id, code, name, station, lat, lon}],          one table for the place; station: platforms grouped
 schools: {"<destination index>": [{s: stop position, walk: minutes, metres: straight line,
                                     routes: [{route, mode, headsigns: [...], trips}], trips}]}}
```

A school with no stop within a 15-minute walk has no entry;
`meta.schools.stops` gives the file, date, window, feed and how many schools
have none.

### Downloads

`team_<place>_schools.csv`: every school counted, with the fields above and
its map point (`point_source`, `point_moved_m`, `dir_lon`, `dir_lat`).
`team_<place>_school_stops.csv`: `moe, school, stop_id, stop_code, stop_name,
station, mode, walk_minutes, straight_m, routes, trips_7_9`, one row per
school and stop. The hexagon CSV and GeoPackage keep R5's own public
transport times as columns ending `_r5`.

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
- **None by public transport, but a walk.** From 0.12.0 the public transport
  lists take walking where it is quicker (above), so a girl in central
  Blenheim is 22 minutes from Marlborough Girls' College by public transport,
  on foot; R5 alone gave over 60. The list's `r5` says so, for the card.

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

- The walk inside the median public transport trip to one school (from home
  to the first stop, and from the last stop to the gate). The stops near each
  school and their walks are listed (Stops near a school); which of them the
  median trip uses is not.
- Checked entrances. Mt Albert Grammar School's candidates are listed and
  unused; trips end at the Alberton Avenue side, as Google Maps routes them.
- Moving a map point by hand: the points rule D5-1 does not move are listed
  for a person to check.
- Car times to one school, and two schools side by side.
- Arriving by the school bell, rather than leaving at any minute from 7 to 9.
- Rolls for Years 9 to 13 only, as weights.
- Routing chosen schools beyond 60 minutes.
- Early childhood services across a regional boundary.
