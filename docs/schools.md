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
Levin schools north of Wellington's (Horowhenua College 1.4 km), and 10
schools in 7 places that round 1 had counted: Kawhia and Kio Kio (Hamilton),
Coley Street (Palmerston North), Kawerau Putauaki (Rotorua), TKKM o Rotoiti
(Tauranga), Mangakino (Tokoroa), Te Wharekura o Ruatoki, Tāwera Bilingual and
Waimana (Whakatāne) and Mangamahu Primary (Whanganui). None of the 10 had a
time on foot, by bike or by public transport from any hexagon; 4 had car
times, to the edge of the street file. No other figure changes for them.

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
| Secondary | Secondary (Year 7-15), Secondary (Year 9-15), Secondary (Year 11-15), Composite, and for Years 9–10, Composite (Year 1-10), Restricted Composite (Year 7-10), Secondary (Year 7-10) |
| None | Specialist School, Teen Parent Unit, Activity Centre, Correspondence School (enrolment by referral, or no site) |

Before 0.12.0 every config spelt the Restricted Composite type "(Yr 7-10)",
which matches nothing, and left out Secondary (Year 7-10). Since the 0.12.0
review the three types that stop at Year 10 count for secondary school too,
for Years 9 and 10 (below, "Secondary school in two stages"): Albany Junior
High, Ormiston Junior College, Mission Heights Junior College, South
Auckland Middle School and Middle School West Auckland in Auckland, Rototuna
Junior High, Berkley Normal Middle, Cambridge Middle and St Andrews Middle in
Hamilton, and the Year 1–10 composite schools.

### Secondary school in two stages

Three schools start at Year 11 (Albany Senior High, Ormiston Senior College,
Rototuna Senior High; Vanguard Military School by its attributes row), and
the schools above stop at Year 10. A Year 9 or 10 student cannot enrol at
the first, nor a Year 11 to 13 student at the second. So where a place has
either kind (`schools.STAGES`, `stage_split`), State and In zone count a
hexagon only when a student in Years 9–10 and one in Years 11–13 can each
reach a school that teaches them, and take the slower time, as for girls and
boys: with both, four students (a girl and a boy at each stage). Best takes
each student's own fastest way. A school teaching Years 9 to 13 serves both,
so nothing changes where every school does. All counts any school that
teaches any of Years 9 to 13, stage aside, as it counts single-sex schools
for everyone. Each school's zone is its zone for the first year it takes at
secondary (Z2), for both stages. The page (`chooseSchools`) and the build
(`choice_groups`, `choice_times`, the car short lists) do the same.

One school counts the children of the ages its own years cover:
13–14 (Years 9–10) for a school that stops at Year 10, 15–17 (13–17 less
13–14) for one that starts at Year 11.

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
| `character` | a checked `Designated_Character` row in `configs/schools/attributes.csv` | `designated` for a designated character school; the directory has no field for it (below) |
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
directory would write it, once a person has checked it. Since the 0.12.0
review it has 17 rows, each with its source, checked on 13 November 2026 and
for Tim Welch to confirm:

- **Designated character schools** (field `Designated_Character`, not a
  directory column): 15 state schools in the twenty places taught in English
  or bilingually, found from NZ Gazette notices (gazette.govt.nz, searched
  for "designated character school"; Māori-medium kura are already out of
  State and In zone) and checked notice by notice: Hagley College (336) and
  Ao Tawhiti Unlimited Discovery (683), Christchurch; Kia Aroha Campus (631),
  Vanguard Military School (854), Pacific Advance Secondary School (874),
  South Auckland Middle School (876), Middle School West Auckland (877) and
  Rise UP Academy (879), Auckland; Tai Wānanga (632), Hamilton; Te
  Rangihakahaka Centre for Science and Technology (871) and Whangamarino
  School (2083), Rotorua; Te Aratika Academy (873), Napier and Hastings; Te
  Kura o Te Paroa (1888), Whakatāne; Manutuke School (2602), Gisborne; Te
  Kāpehu Whetū (3619), Whangārei. South Auckland Middle School says it has
  applied to become an ordinary state school; until the directory or the
  Gazette says so it stays on the list. The list may not be complete: the
  Gazette search returns 782 notices, and the ones read were those whose
  titles name a designation.
- **Vanguard Military School's years** (field `Org_Type`, Secondary (Year
  11-15)): the directory gives Years 9–15; its enrolment page says it caters
  for Years 11, 12 and 13.

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
  is the walking time × 4.8 / 3.6, rounded down. Worked out from whole
  minutes, it is often a minute quicker than a walk R5 routes at 3.6 km/h:
  on 289 Auckland pairs routed both ways in the 0.12.0 review, a minute
  quicker in 124, the same in 148 and a minute slower in 17
  (`meta.pt_or_walk.slow_note`). A pair where walking is at least as quick is
  a walk: no fare, no bus or train.
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
boundary rule added and the 3 points rule D5-1 moved, and dropped the 10
schools that round 1 had counted and the street rule leaves out, in 7
places, for every school mode including car. Each reroute ended with 300 sampled hexagons
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
platform, with the station's stop number. For each stop: the routes and
trips that set down there (`drop_off_type` not 1) arriving from 07:00:00 to
08:59:59 on Tuesday 15 September 2026, the day and window school trips are
routed in, counting the services that run that day by `calendar.txt` and
`calendar_dates.txt` (a trip of the day before past midnight counts too), and
for each route its short name, mode (`route_type`), headsigns and trips. At
the school end students get off, so a school bus that ends at the school's
own stop counts (Metlink's route 402 at Tawa College's stop 3959, 08:23), and
a train counts as it arrives. Before the 0.12.0 review the list counted
boardings (departures with `pickup_type` not 1), which left out every trip
that ends at the stop; the boardings are kept as `board` in stops.json and
`trips_boarding_7_9` in the CSV. A route is one short name and mode, however
many `route_id`s the feed gives it (Otago's route 1 has one for each
direction). A stop is listed whether or not the median trip uses it: this is
what is near the school, not how the median trip gets there. Code:
[`src/team/school_stops.py`](../src/team/school_stops.py); `team schools stops`
routes the walks, and `team schools stops --recount` counts the trips again
from the feed without routing them.

A stop no trip in the feed stops at, on any day, is listed with `served`
false. Near Mt Albert Grammar School 32 stops are within a 15-minute walk of
its point. The nearest, the stop named Mount Albert Grammar School (1427), is a
minute's walk (95 m), but no trip in Auckland Transport's open timetable stops
there on any day; it may be for the school's dedicated buses, which that
timetable leaves out. The Marist College stop (1429, 5 minutes) is the same.
The nearest stops with trips arriving between 7 and 9am are
Owairaka/Mount Albert on Owairaka Avenue (8816 and 8823, route 66, 7 and 8
minutes) and Ferndale House on New North Road (8226 and 8229, routes 22N,
22R, OUT and 209, 7 and 8 minutes). Three bus interchange bays further out
are each called St Lukes in Auckland Transport's feed (stops 11838, 11512
and 11287, 12 to 14 minutes); the list gives each its number.

### Train and ferry stations further out

The 15-minute list left out both train stations Mt Albert Grammar School's
students use, so each school's nearest train or ferry stations are listed
too. A station is a stop group (a parent station and its platforms, or a stop
with no parent) that any train or ferry in the feed stops at, on any day
(`route_type` 1, 2 or 4, or their extended codes). Every station platform within
2,600 m of a school in a straight line is routed on foot to it as above, up
to 30 minutes (r5py `max_time` 31). The school's nearest stations within a
30-minute walk are kept, up to 3, nearest first: at least the nearest, and
any others within 30 minutes. Those over 15 minutes are added after the
other stops, marked `far`, with their routes and trips arriving 7–9am
counted as for any stop; a station within 15 minutes is in the list already
and stays as it was. The 15-minute list itself does not change: rebuilt with
the rule, every place's stops within 15 minutes are the same, row for row.

Mt Albert Grammar School gains Baldwin Ave Train Station (stop 119, 16
minutes, 891 m in a straight line), Mt Albert Train Station (stop 120, 17
minutes, 999 m) and Morningside Train Station (stop 104, 21 minutes), each
with 23 trains arriving between 7 and 9am. In the 20 places, 315 schools gain
a station: Auckland 199, Wellington 105, Hamilton 8 (Te Huia's stations, with
no train arriving between 7 and 9am) and Queenstown 3 (ferry stops). 182 of
them had no train or ferry station within 15 minutes; the other 133 have one
and gain the next nearest. A station no train or ferry reaches between 7 and
9am is still listed, with no trips.

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
| In zone | state schools taught in English that must take a child living in the hexagon: those whose home zone holds the home, and those with no zone, which must take any student who applies (below). Designated character schools are left out. |
| One school | that school alone; see below |

Under State and In zone, a second row picks who is counted:

- **Girls** counts co-ed and girls' schools; **Boys** counts co-ed and boys'
  schools.
- **Girls and boys** (the default) counts a hexagon only if both a girl and a
  boy living there can reach a school in time. A mode's time is the slower of
  the girls' and the boys' times by that mode. The fastest-way time is the
  slower of the girls' fastest and the boys' fastest: each takes their own
  quickest way. This is not the quickest of the per-mode times, which would
  make both use one way.

The page's default choice is set in one place, `DEFAULT_SCHOOL_CHOICE` in
`web/js/schools.js`, to In zone: the nearest state school a child can enrol
at is the closest to the Ministry's own test. A link with `sch=all` keeps
the 0.11 meaning.

Every school figure counts children of the service's ages, not all residents
(below, "Who is counted: school-age children"); early childhood counts
children aged 0–4.

### One school

- **A school with a zone** (in force, or the only one in the Ministry's
  file): the headline is the share of the children living in its zone who
  are within the standard of it by the way shown. A hexagon a zone line
  crosses counts the share of its children living in the zone. Who misses
  out and What would help are for those children. For a state-integrated
  school the headline, card and CSV add that living in its zone does not by
  itself give a right to enrol: it takes children whose families accept its
  special character first.
- **A zone partly outside the place.** A school over a regional boundary can
  have most of its zone outside the place's hexagons (Tuakau College for
  Auckland). zones.json gives each zone's share of the homes inside the place
  (`inside`, by current address points, scaled by the share of the zone's
  area inside the address file's extent) where it is under 99.5%. Under 90%,
  the headline says "living in the part of its zone inside Auckland". A zone
  holding none of the place's homes (Putāruru College for Tauranga) is said
  as such: "Its zone lies outside Tauranga and Western Bay, where TEAM has no
  homes", and everyone is counted, as for a school with no zone.
- **Who is counted.** The children of the ages the school's own years cover:
  13–17 for a Years 9–15 school, 15–17 for one that starts at Year 11, 13–14
  for one that stops at Year 10. A girls' or a boys' school counts girls (or
  boys) only: the 2023 Census gives children by age for each block, not by
  sex, so they are the place's share of girls (or boys) of those ages in the
  2018 Census (`meta.ages.sex`, from the 2018 SA2s the place's SA1s fall in;
  49% of 13–17-year-olds in Auckland are girls), taken to live where the
  others of their age do. The share of them within the standard is then the
  same as for all children; the number is not. The headline and the CSV
  header say so.
- **A school without a zone** (no enrolment scheme, or a scheme with no
  usable map): there is no catchment to give a share of, so the headline is
  the number of children within the standard of it, and Who misses out and
  What would help are off. For a local board, ward or suburb the share of its
  children follows under the count, and the area stays when the school
  changes.

## Enrolment zones (In zone)

Code: [`src/team/zones.py`](../src/team/zones.py).

### The file

The Ministry's enrolment scheme master file,
https://www.educationcounts.govt.nz/__data/assets/file/0003/108606/Enrolmentschememaster.zip
(CC BY 3.0 NZ), downloaded 12 November 2026 to
`raw/nz/education/moe_enrolment_zones_2026-11-12/`. It is a MapInfo TAB,
`ESmaster v02102026`, which its Readme dates "Version as at 02/10/2026":
1,327 polygons for 1,291 schools, with each polygon's school number, name,
approval date and effective date.

- **Projection.** The TAB names an unnamed Transverse Mercator on NZGD2000
  with the NZTM2000 parameters (central meridian 173°, scale 0.9996, false
  easting 1,600,000, false northing 10,000,000), not the old NZ Map Grid.
  pyproj's `equals` does not match it to EPSG:2193 (the names differ), so the
  code accepts a file only when `to_epsg()` finds 2193, transforms a file on
  NZMG, and refuses any other projection and a file with none.
- **Geometry.** 151 polygons are invalid as stored (self-intersections, or
  too few points); each is repaired with `make_valid` and keeps its polygonal
  parts.
- **Checked against Eagle Technology's copy**
  (https://services.arcgis.com/XTtANUDT8Va4DLwI/ArcGIS/rest/services/NZ_School_Zone_boundaries/FeatureServer/0,
  last edited 16 September 2026) with
  [`scripts/check_zones_eagle.py`](../scripts/check_zones_eagle.py), school by
  school, as 1 − intersection/union of each school's zones: median 0.11%, 90th
  percentile 0.41%. 23 schools differ by more than 1%, and 21 of them are in
  the Readme's list of new, amended or redrawn zones (Howick College's zone,
  amended from 29 September 2026, is 279 km² in the Ministry's file and 68 km²
  in Eagle's). Five schools are only in the Ministry's file, all new; four are
  only in Eagle's, all schemes the Readme says were abandoned. So the
  Ministry's file is the newer and agrees with Eagle's elsewhere. Eagle's
  terms are not open: nothing from it is kept in the data root or published.

### Who must take a child (the legal basis)

From the Education and Training Act 2020, version as at 1 October 2026
(https://www.legislation.govt.nz/act/public/2020/38/en/latest/, read on
12 November 2026):

- section 33(1): every domestic student aged 5 to 19 is entitled to free
  enrolment at any State school, except as Part 3 provides;
- sections 72 and 73: the Secretary must set up an enrolment scheme for a
  State school that is or may become overcrowded, and the scheme must define
  a home zone;
- section 74(1): a person living in the home zone of a State school with a
  scheme is entitled to enrol there; section 74(2): a person living outside
  it may enrol only if offered a place by the scheme's procedure (a ballot,
  with priorities set by Schedule 20, clause 2) or directed there by the
  Secretary;
- Schedule 20, clause 1(1): a home zone is defined by geographic boundaries
  described so that a given address is either within or outside it.

So a state school with no scheme must take any student who applies, and one
with a scheme must take students living in its zone. Out-of-zone ballot
places are not counted: a ballot place is not a place a family can count
on. State integrated schools prefer children whose parents have a connection
with the school's special character (Schedule 6, clause 26), and the boards
of a Kura Kaupapa Māori and of a designated character school may refuse to
enrol a student whose parents do not accept the school's character
(sections 201(9) and 204(5)), so they are not in In zone. The directory
does not flag designated character schools, so they are listed by hand, each
checked against its Gazette notice (`attributes.csv`, above); 15 are in the
twenty places. Kura are already out of In zone as Māori-medium.

### Rules

**Z1 Which zones apply on 12 November 2026** (`zones.REFERENCE_DATE`, the
directory snapshot's date). A polygon's date is its effective date, or its
approval date where it has none (Totara Grove School, Whangārei, and four
schools outside the twenty places), or none (Paeroa College, outside the
places). A polygon is in force when its date is on or before the reference
date, or has no date (flagged `date_unknown`); a later one is upcoming. The
directory, which the Ministry updates nightly, says whether a school has a
scheme:

| Directory | Polygons | Status | In zone counts the school for |
| --- | --- | --- | --- |
| scheme | some in force | `in_force` | children living in its zone |
| scheme | only upcoming | `upcoming_used` | children living in the upcoming zone, labelled with its start date |
| scheme | none | `no_map` | every child: the file holds no map of its zone |
| no scheme | none, or only upcoming | `none` | every child (it must take any student) |
| no scheme | some in force | `not_applied` | every child; the polygon is listed, not applied |

An upcoming polygon of an `in_force` school is listed (`next.from`), not
applied. The Ministry's file holds only the current or next version of a
zone, so for a school whose amended zone starts in 2027 the zone in force
today is not in the file; the upcoming one is used and the page says so.

**Z2 Year levels.** A polygon's years are read from its name ("Zone B (yrs
7-8)", "(Year 9-15)", "Y11-13"). The file has 64 polygons whose names give
years; the pattern reads every one and finds years in no other name. A polygon applies to a service
when it covers the school's entry year for that service: the later of the
service's first year (primary 1, intermediate 7, secondary 9) and the first
year the school teaches. So Balmoral School's Zone A (Years 1–6) is its
primary zone and Zone B (Years 7–8) its intermediate zone; Middleton Grange
School's secondary zone is its Years 9–10 zone, not its Years 11–13 one; and
Rototuna Senior High School, which starts at Year 11, uses its Years 11–13
zone. A polygon whose name gives no years applies to every service. A school
whose polygons are partly by year and partly not, or none of whose year
zones covers a service's entry year, is `unclear_years` and counted for
every child unless `configs/schools/zone_years.csv` has a checked row for it.
No school in the twenty places needs one.

**Z3** A school's polygons for one service are joined (Whenuapai School's
zone and its temporary extension).

**Z4 In zone** counts, for a service and a student (girls, boys, or both as
under State), the state schools taught in English that teach the service's
years and take the student, and that are either counted for every child
under Z1 or have a zone holding the home. Girls and boys together works as
under State: a hexagon counts only if both a girl and a boy living there can
reach such a school in time.

### Where the residents live

A hexagon has one travel time, from its centre, and its people are spread
from census blocks by area. Where a zone line crosses a hexagon (its zone
covers part of the hexagon's area), its residents are placed by LINZ address
points (NZ Addresses, layer 105689, the public ArcGIS copy, fetched
12 November 2026 by [`scripts/fetch_address_points.py`](../scripts/fetch_address_points.py)):

- each current address point takes the census block it falls in, and carries
  that block's residents divided by its number of points (a block of flats
  has a point for each unit, so its flats carry most of its people);
- a block with residents and no address point is spread evenly over its land
  in the hexagon (points on a 10 m grid);
- a hexagon whose points carry no residents is spread by area over its land
  pieces, as the grid spreads people.

A zone's share of a hexagon's residents is the weight of those points inside
the zone over the weight of all of them; a zone covering the whole hexagon
holds them all. The share is applied to the hexagon's own population and
children, so totals stay the grid's. This assumes children live where
residents do inside a hexagon, and gives non-residential addresses in a block
a share of its residents (a shopping centre's many addresses each take a
little).

**The hexagon's In zone set.** Every point lies in some set of zones (the
zones of zoned state schools taught in English for the service). The hexagon
takes the set holding the most residents; on a tie, the set holding the
hexagon's centre, then the smaller set, then the lower list of school
numbers. Its times, the map, the card, areas and equity figures all use that
set, as all residents of a hexagon share its centre's time. A hexagon whose
residents live in more than one set is listed as split, and the line under
the headline gives how many people live in split hexagons.

**One school's zone.** The children living in a school's zone are the sum,
over hexagons, of each hexagon's children times the share of its residents
in that zone. This is exact under the shares, since the time to one school
does not depend on which set the hexagon takes. `share` in zones.json covers
every school with a zone in force or used, of any kind, so One school works
for a zoned integrated school too; In zone itself counts state schools
taught in English only.

### What the rules give

In the twenty places, with the 12 November 2026 directory (state schools
taught in English only; before schools across a regional boundary are added):

| Service | State, English | Zone in force | Only a later zone, used | Scheme, no map | No scheme | Map, no scheme |
| --- | --- | --- | --- | --- | --- | --- |
| Primary | 1,105 | 811 | 10 | 3 | 280 | 1 |
| Intermediate | 664 | 447 | 8 | 0 | 209 | 0 |
| Secondary | 203 | 143 | 1 | 0 | 59 | 0 |

- **Only a later zone in the file** (used, and labelled with its start
  date): Tangaroa College (secondary), Ormiston Junior College (intermediate)
  and Western Heights School in Auckland, from 1 January 2027; Broadfield,
  Te Kura o te Tauawa Halswell, Oaklands Te Kura o Ōwaka, Prebbleton, Wigram
  and Te Manu Tukutuku South Hornby schools in Christchurch, from 1 January
  2027; Shotover Primary, Arrowtown and Remarkables Primary schools in
  Queenstown, from 28 January 2027. Two Christchurch integrated schools are
  in the same position.
- **Scheme, no map**: Fraser Crescent School, Te Kura o Hau Karetu and Oxford
  Crescent School in Upper Hutt, counted for every child. Integrated schools
  with a scheme and no map (Carmel College, Sacred Heart College and four
  more in Auckland, and others) are not in In zone anyway.
- **Map, no scheme**: West End Te Kura O Morere, New Plymouth, has a zone in
  force since 10 October 2016 but no scheme in the directory; it is counted
  for every child and the zone is listed. Queen Elizabeth College, Palmerston
  North, has no scheme today and new zones from 1 January 2027, listed.
- No school in the places has an unclear year level, and none needs a
  `zone_years.csv` row.
- **Address points**: 2,102,052 current points in the places' extents, of
  which 1,918,732 fall in a census block with residents. In Auckland 9,802
  hexagons are crossed by some zone line.
- **Split hexagons.** Zones are small next to a hexagon for primary schools:
  in Auckland 721,011 people (57,442 children aged 5–10) live in hexagons
  whose residents are in more than one primary zone set, 442,498 (12,162 aged
  11–12) for intermediate and 294,662 (18,664 aged 13–17) for secondary.
  Of those children, 14,247 aged 5–10 (11% of Auckland's), 2,797 aged 11–12
  (6%) and 3,993 aged 13–17 (4%) live outside the zone set their hexagon is
  counted in (`meta.schools.zones`, `children_outside_set`): the error the
  one-set rule makes, which One school's shares do not. The counting line
  under In zone gives the number. D1 asked for a hexagon a zone line cuts to
  be split by its residents' shares; In zone does not do that yet, because a
  hexagon has one time on the map, the card, the areas and Who misses out.
  Its effect on the headline figures, every place and service, is measured
  by `scripts/zone_split_effect.py` from `zones/split_sets.json` (each split
  hexagon's sets and their shares of its residents) and is an open decision
  for Tim (below, "Open decisions").
- **St Lukes** (hexagon 89bb50021a3ffff, on the councillors' slide): wholly
  in Mt Albert Grammar School's zone. For intermediate it is in Kowhai
  Intermediate's zone and 18% of its area is in Balmoral School's Zone B,
  but 69% of its residents live there: 111 of its 258 address points are in
  a census block of 3 residents, and most of the points carrying residents
  are in Zone B. It is counted in both zones.
- **Mt Albert Grammar School's zone** (in force since 6 June 2018, 16.28
  km²) holds 63,561 residents and 3,780 children aged 13–17, over 174
  hexagons, 53 of them crossed by its line.

## Who is counted: school-age children

Code: [`src/team/ages.py`](../src/team/ages.py). Each school and early
childhood figure counts the children of the service's ages; every other
service, and the all-residents columns in the downloads, count everyone.

| Service | Children counted | School years |
| --- | --- | --- |
| Early childhood | aged 0–4 | before school |
| Primary | aged 5–10 | Years 1–6 |
| Intermediate | aged 11–12 | Years 7–8 |
| Secondary | aged 13–17 | Years 9–13 |

**Sources.** The finest open 2023 Census age data are five-year bands by SA1
(Stats NZ, 2023 Census totals by topic for individuals by SA1, and the same
by SA2; CC BY 4.0; fetched 12 November 2026). Single years of age for 2023
are in Aotearoa Data Explorer (`CEN23_POP_001`, by SA2), but its data API
needs a subscription key, which needs registering, so it is not used; the
2018 Census has single years by 2018 SA2 in an open file (Data8277).

**Rule.**

1. Each 2023 SA1 gives its usual residents and its 0–4, 5–9, 10–14 and 15–19
   bands. A suppressed band is the SA1's residents times its SA2's share in
   that band, or the national share where the SA2's band is suppressed too.
2. Each SA1 takes the 2018 SA2 its representative point falls in (2023 and
   2018 SA2s differ), and from that SA2's 2018 single years the share of the
   10–14 band at each age 10 to 14 and of the 15–19 band at ages 15, 16 and
   17. A band with fewer than 30 people in that SA2, or a confidential year,
   takes the national 2018 shape
   ([`scripts/fetch_census_ages.py`](../scripts/fetch_census_ages.py)).
3. Groups: 0–4 = the 0–4 band; 5–10 = the 5–9 band and the age-10 share of
   10–14; 11–12 = the age-11 and 12 shares of 10–14; 13–17 = the age-13 and
   14 shares of 10–14 and the age-15 to 17 shares of 15–19.
4. Each SA1's children are spread over hexagons as its residents are (water
   blocks dropped, each land block split by its area in each hexagon), and a
   hexagon's age shares are applied to its population on the grid. These are
   the same numbers everywhere except 46 Auckland hexagons (20 of them
   counted) whose grid values were kept from an earlier build.

**Why single years.** An even split of the bands would be badly wrong where
students fill the 15–19 band. Campus North, Dunedin, had 1,623 people aged
15–19 in 2023; its 2018 shape puts 9% of them at 15 to 17, so it counts 149
aged 13–17, where an even split would count 979.

**Assumptions.** Ages are on census day, 7 March 2023, and stand for school
years. Census day is early in the school year, so about a third of Year 7 and
of Year 9 students are counted with the age group below (a Year 9 student
born from March to June was still 12), and some 17-year-olds have left
school. Inside a hexagon children live where residents do. Group shares
(Māori, Pacific, low income and so on) are for all ages in the census block.

**Checks.** Every place, built from the round-1 routing:

- Residents spread by area equal the grid's population in every hexagon
  except the 46 Auckland ones above.
- Suppressed bands filled from the SA2 share: 426 SA1 band cells in
  Auckland (438 people), 175 in Christchurch (148), 137 in Wellington (122),
  and fewer elsewhere; from the national share: 35 in Auckland, 8 each in
  Christchurch and Wellington, and a handful elsewhere.
- For the SA2s wholly inside each place (88% of Whakatāne's residents, 94% to
  100% elsewhere), the groups summed from SA1s match the same groups from
  the 2023 SA2 table within 1%, or within three standard deviations of Stats
  NZ's random rounding to base 3 in the cells summed, for every group in
  every place (`tests/test_ages.py`).
- Across the twenty places TEAM counts 238,236 children aged 0–4, 315,781
  aged 5–10, 110,551 aged 11–12 and 267,120 aged 13–17 in the hexagons it
  routes from. An even split of the bands would give 273,509 aged 13–17:
  more in the university cities (Dunedin 2,739, Auckland 2,324,
  Christchurch 1,564, Wellington 1,510, Hamilton 478, Palmerston North 317),
  fewer in most other places (Tauranga 635 fewer).
- `cells.json` gives children to two decimals. Many hexagons hold a small
  fraction of a child, and to one decimal they round to nothing: that drops
  about 0.2% of a place's children, mostly far from schools, and would put
  Wellington's intermediate figure (all schools, any way) at 85.4% rather
  than 84.5%.

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
`roll_date`, `scheme`, `zone` (`{status, from, next: {from} | null}`, as in
zones.json), `zone_from` (the same `from`, kept for older pages), `routed_to`
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
State, State girls and State boys and, where zones are in, In zone girls and
In zone boys (each cell by its In zone set), and the schools tied with each.
`holds` lists the choices a short list answers (`["all", "state", "zone"]`).
They answer those choices exactly; One school is not shown by car. The full car lists
would be 9 MB brotli for Auckland; the short ones are 0.06 MB each.

Auckland's eighteen files come to 4.5 MB brotli; the largest is primary
school by public transport, 0.85 MB.

### `summary.json`

`meta.schools` gives the directory file and its dates, the counts behind the
"Counting ..." line for each service (`services`), how many schools are routed
to a point or to entrances, whether the place's timetable has school buses,
and each file's size. `meta.schools.choices` lists the choices on offer
(`zone` only when zones are built) and `meta.schools.zones` gives the zone
file, the reference date, the counts by status for each service, the
upcoming zones, and the people and children in split hexagons. `meta.ages`
gives the age groups, which group each service counts, the rule, the sources
and the totals and checks below. The page reads it through `readSchoolsMeta` in
`web/js/schools.js`: the directory date is `dates.directory`, the roll date is
the date most schools' rolls are at, the reach lists on offer are the names in
`files`, and `buses` is `in_timetable` or `none_found`.

### `schools/zones.json` and `schools/zone_outlines_<service>.json`

Read when In zone or One school is chosen. Cell `i`'s entries are positions
`o[i]` to `o[i+1] - 1`; destinations are indices into destinations.json.

```text
{format: 2,
 source: {file, version, downloaded, sha256, licence, url},
 reference_date: "2026-11-12", rule,
 schools: {"<dest>": {moe, status, from, next: {from} | null, polygons: {service: [PolyID]},
                      date_unknown (when true), map_from (not_applied only),
                      inside: {service: share of the zone's homes inside the place} (under 0.995 only)}},
 in:    {service: {o, d}},        the hexagon's In zone set: zoned state schools taught in English
 share: {service: {o, d, w}},     every zoned school (any kind) holding residents of the cell, w to 3 dp
 split: {service: [cell]}}        residents in more than one set
```

Every school in the place is in `schools`. Schools counted for every child
(statuses `none`, `no_map`, `not_applied`, `unclear_years`) are not in `in` or
`share`; the page counts them from their status.

`zone_outlines_<service>.json`, format 1: `{format: 1, service, simplified_m:
5, schools: {"<dest>": GeoJSON geometry}}`, each zoned school's zone for the
service, simplified by 5 m in NZTM keeping its shape's topology, in WGS84 to
5 decimals. Loaded for One school.

`cells.json` `ages`: `{"0_4": [...], "5_10": [...], "11_12": [...], "13_17":
[...], "13_14": [...]}`, children per hexagon to two decimals; 13_14 is for
a secondary school that stops at Year 10, and 15–17 is 13_17 less 13_14.
`meta.ages.sex.girls` gives the place's share of girls in each group.

### `schools/stops.json`

Loaded only under One school.

```text
{format: 1, date: "2026-09-15", window: ["07:00", "08:59"], max_walk_minutes: 15,
 far_walk_minutes: 30, far_most: 3, gtfs: "<file>",
 counts: "arrivals",                                   trips set down there, arriving in the window
 stops: [{id, code, name, station, lat, lon, served, mode}],  one table for the place; station: platforms grouped;
                                                       mode: "train" or "ferry" for a station, else left out
 schools: {"<destination index>": [{s: stop position, walk: minutes, metres: straight line,
                                     routes: [{route, mode, headsigns: [...], trips}], trips, board, far}]}}
```

Every school has an entry; a school with no stop within a 15-minute walk has
an empty list, or its far stations only. A school's rows are its stops within
the walk, quickest first, then its far stations (`far: true`, left out
otherwise), nearest first. `served` is false for a stop no trip in the feed
stops at, on any day (Mount Albert Grammar School's stop 1427, perhaps kept
for school buses the open timetable leaves out). `meta.schools.stops` gives
the file, date, window, feed, how many schools have no stop within the walk
(`schools_with_none`) and how many have a far station (`schools_with_far`),
with `far_walk_minutes` and `far_most`. Files from before the far stations
have none of these fields; the page reads them as before. The format stays 1:
the fields are added, and no 0.12.0 page has been published without them.

### Downloads

`team_<place>_schools.csv`: every school counted, with the fields above, its
map point (`point_source`, `point_moved_m`, `dir_lon`, `dir_lat`) and its zone
(`zone_status`, `zone_from`, `zone_next_from`).
`team_<place>_school_zones.csv`: for each hexagon, service and zone holding
any of its residents, the share of its residents in the zone
(`residents_share`) and whether the zone is in the hexagon's In zone set
(`in_zone_set`). `team_<place>_school_stops.csv`: `moe, school, stop_id,
stop_code, stop_name, station, mode, walk_minutes, straight_m, routes,
trips_arriving_7_9, trips_boarding_7_9, served_any_day, far_station`, one row
per school and stop; `far_station` is true for a train or ferry station
beyond a 15-minute walk, one of the school's nearest within 30.
`team_<place>_h3.csv` and `.gpkg` add `age_0_4`, `age_5_10`,
`age_11_12`, `age_13_17` and `age_13_14`, R5's own public transport times
(columns ending `_r5`) and the jobs and fares on foot (`_z0`), all at the end
of the file so the 0.11 columns stay together. Read columns by name: the
school columns moved after tertiary in 0.12.0, and `t_*_pt`, `jobs*_pt` and
`costaccess_*` now hold public transport or walking.

## The page

The Schools row sits under Getting to for the three school services: All,
State, In zone and One school, with Girls and boys, Girls or Boys under State
and In zone, and under them "Find a school", a search by name, initials
(MAGS) or Ministry number that is there for every choice. Picking a school
from it, from a school's pin on the map ("Show only this school") or from a
school named on a hexagon's card shows only that school, with Zoom to its
zone and Clear, which goes back to the choice used before. One school with
none picked yet shows no figure ("Pick a school to see who can reach it.")
and its link says `sch=one`, which opens with the cursor in the search. A
link without `sch` opens the default choice (above), and `sch=all` opens
All. `web/js/schools.js` works every choice out from the
reach lists (and, for In zone, zones.json) and puts its times in place of
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
- **Car.** A short car list answers All, State and In zone (for each student
  group, stages included). Under One school the page has no car times and
  shows Best instead; the card's "Not counted" line is left out by car.
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
- **Stops near the school.** Under One school, the section lists the stops
  within a 15-minute walk, then the far stations under "Nearest train
  stations, beyond a 15-minute walk" ("ferry terminals" from 0.12.1, as the
  map's key names them), each with its symbol, its walk and trips arriving
  7–9am, and a Show button that moves the map to it and opens what it says.
  Its folded summary reads "32 within 15 min · 3 train stations within 30
  min". On the map each stop is a symbol for its mode (a bus, train or ferry
  in a rounded square, hollow and dashed where no trip arrives 7–9am) with a
  walking badge giving its minutes, on the side away from the school. Every
  stop is drawn; badges are placed stations first, then the quickest walks,
  and one that would overlap another symbol waits until the map is zoomed in.
  Two stops of the same name within 80 m are one symbol below zoom 16.5
  (`nearStopFeatures` in `web/js/symbols.js`; docs/design.md, Map symbols).
  Hovering or tapping one gives its name, stop number, walk and trips.

## Figures for testing the site

`scripts/school_golden.py` works every choice out from a place's published
files and writes `tests/fixtures/schools/golden_<place>.json`: the share of
people within the standard for each choice, service and mode, every figure
and the schools named for the hexagons given, and checks that the files agree
(the school named is the first in the reach list, its minutes are the time
shown, tied schools have the same minutes, no time is over 60). Auckland's
covers the slide hexagon and the hexagons around MAGS, with MAGS, Marist,
TKKM o Nga Maungarongo, Western Springs College, Auckland Grammar, Epsom
Girls Grammar, Auckland Girls' Grammar, Albany Junior and Senior High,
Tuakau College and King's College as one school each, and a Schnapper Rock
hexagon for the two stages; Hamilton's has Rototuna Senior and Junior High
and Tai Wānanga; Wellington's and Blenheim's cover two hexagons and three
and two schools. One school's weights follow the page (`one_school_weights`:
the school's own ages and, at a single-sex school, its sex), and the file
lists the key each school used (`one_weights`).

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

## Open decisions

For Tim Welch to settle before or after the release:

- **The default choice.** In zone (`DEFAULT_SCHOOL_CHOICE`); All is one
  line away.
- **Splitting a hexagon by where its children live (D1).** In zone gives a
  split hexagon the zones most of its residents live in. Counting each child
  in their own zones, by the sets and shares in `zones/split_sets.json`
  (`scripts/zone_split_effect.py`), moves the In zone headlines by at most a
  point: Auckland primary by public transport 69.2% to 68.5% (2,970 children
  change sides), intermediate 54.0% to 53.8%, secondary 71.1% to 70.9%;
  across the twenty places, from 0.9 points lower to 1.0 higher. Doing it on
  the page needs a hexagon to hold more than one time, for the map, the
  card, the areas and Who misses out.
- **Designated character schools.** The list was made from Gazette notices
  and may miss one; Hagley College, the largest, is in Christchurch's city
  centre.
- **Fares under a school choice** are off; In zone fares would need priced
  layers for each choice.
- **Download size on a phone.** Opening Auckland loads about 3.75 MB
  (brotli), 0.77 MB more than 0.11.0; In zone secondary school adds 0.78 MB
  and primary 1.67 MB, loaded when the service is picked.

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
