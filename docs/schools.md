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
then those within about 8 km of the place, as before. Schools marked
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
filled. In 0.12.0 both files are empty: every school is routed to its
directory point, as before.

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
  walk up to 15 minutes to or from stops. A trip whose time equals the walking
  time is a walk: no bus or train gets there sooner. A public transport time
  can be slower than walking when the walk is over 15 minutes.

### Checks

- Before any point changed, the school runs gave exactly the minutes the
  services runs gave, for every pair and mode:
  [`scripts/check_school_runs.py`](../scripts/check_school_runs.py). Auckland:
  2.29 million pairs by walking, both kinds of cycling and public transport at
  both paces, none different. The only schools left out of the comparison are
  the ones the new directory added or moved.
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
| State | state schools taught in English: not integrated, private, charter, or a school where all students are taught in te reo Māori or a Pacific language. A school whose teaching language is not given is left out and counted as such. |
| In zone | not yet: needs the Ministry's zone file (below) |
| One school | that school alone |

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
first school that a choice counts is its nearest. The largest Auckland file is
under 0.6 MB brotli.

### `summary.json`

`meta.schools` gives the directory file and its dates, the counts behind the
"Counting ..." line for each service (`services`), how many schools are routed
to a point or to entrances, whether the place's timetable has school buses,
and each file's size.

### Downloads

`team_<place>_schools.csv`: every school counted, with the fields above and
its map point.

## Figures for testing the site

`scripts/school_golden.py` works every choice out from a place's published
files and writes `tests/fixtures/schools/golden_<place>.json`: the share of
people within the standard for each choice, service and mode, every figure
for the hexagons named, and checks that the files agree (the school named is
the first in the reach list, its minutes are the time shown, tied schools
have the same minutes, no time is over 60).

## School buses

Wellington's Metlink timetable has 123 school bus routes, Dunedin's has 8
routes named for schools and Palmerston North's has 10. Auckland Transport's
open timetable has none, so an Auckland school trip by public transport is by
the public network only. Each place's config says which (`schools.buses`).

## Not in this release

- In zone, until the Ministry's zone file is in.
- Checked entrances and corrected points: the review sheets are ready.
- Arriving by the school bell, rather than leaving at any minute from 7 to 9.
- Rolls for Years 9 to 13 only, as weights.
- Routing chosen schools beyond 60 minutes.
