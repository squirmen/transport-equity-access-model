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
| In zone | state schools taught in English that must take a child living in the hexagon: those whose home zone holds the home, and those with no zone, which must take any student who applies (below) |
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
  out and What would help are for those children.
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
(sections 201(9) and 204(5)), so they are not in In zone.

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
  one-set rule makes, which One school's shares do not.
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
years: some 13-year-olds are in Year 8 and some 17-year-olds have left
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

Modes are walk, bike_low_stress, bike, pt and car.

### `destinations.json`

A school's entry adds `moe`, `kind`, `medium`, `language`, `sex`
(`{service: co-ed | girls | boys | null}`), `years` ([from, to]), `roll`,
`roll_date`, `scheme`, `zone` (`{status, from, next: {from} | null}`, as in
zones.json), `zone_from` (the same `from`, kept for older pages), `routed_to`
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
                      date_unknown (when true), map_from (not_applied only)}},
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
[...]}`, children per hexagon to one decimal.

### Downloads

`team_<place>_schools.csv`: every school counted, with the fields above, its
map point and its zone (`zone_status`, `zone_from`, `zone_next_from`).
`team_<place>_school_zones.csv`: for each hexagon, service and zone holding
any of its residents, the share of its residents in the zone
(`residents_share`) and whether the zone is in the hexagon's In zone set
(`in_zone_set`). `team_<place>_h3.csv` and `.gpkg` add `age_0_4`,
`age_5_10`, `age_11_12` and `age_13_17` beside `population`.

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
