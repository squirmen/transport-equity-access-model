# Changelog

## 0.12.1 (not yet released)

Map symbols that say what they are, picking a school, and the 20 school
map points that were in doubt. Looking at One school for Mt Albert Grammar
School, the stops near it were numbered boxes the key did not explain, and
the other schools and the stops whose numbers were hidden were the same
small white circle. [`docs/design.md`](docs/design.md) has the symbols,
under Map symbols, and [`docs/schools.md`](docs/schools.md) the points,
under Points checked by hand.

### What changes on the page

- **Every point on the map says what it is.** Places you are getting to are
  discs with a glyph (a mortarboard for schools, a cart for supermarkets and
  so on); public transport is a rounded square with a bus, train or ferry;
  the school picked is a navy map pin with its name beside it. Filled means
  counted, or a stop with trips; white with a grey ring means not counted;
  a dashed ring means no trips arriving 7–9am. Glyphs are Material Icons
  (Apache License 2.0), kept in `web/assets/icons/`.
- **Stops near the school carry a walking badge.** A walking person and the
  minutes to the school, on the side of the stop away from the school,
  replace the numbered boxes and dots. Every stop is drawn; when badges
  would overlap, the stations' and the quickest walks' are kept and the rest
  show as the map is zoomed in. Two stops of the same name either side of a
  road are one symbol below zoom 16.5 (35 stops near Mt Albert Grammar School
  are 23 symbols).
- **The key lists what is on screen, with the same images.** It changes as
  the map moves, keeps room for its "On the map" rows on a laptop (in 0.12.0
  it shrank to its title under One school), and folded shows the symbols as
  small icons. The stop row's blank swatch (two stylesheet rules for one
  name) is gone.
- **Hover, tap or keyboard for a name.** Every symbol gives its name and what
  it is: a stop its number, walk and trips; a school what kind it is and
  whether the choice counts it. A tap takes the nearest symbol within 22 px.
  With the map focused, Enter opens what is under the ring in its middle,
  and the name is read out as the map moves.
- **Finding a school.** "Find a school" is under the Schools choices for
  every choice, by name, initials or Ministry number. School pins show under
  All too. A pin's popup says "Show only this school" ("Show this school
  instead" under One school); each school a hexagon's card names is a link
  that does the same, keeping the card open. Once picked, the school has Zoom
  to its zone and Clear (back to the choice before) in place of Change, and
  the map fits its zone clear of the card. One school with none picked shows
  no figure, rather than All's, and its link says `sch=one`.
- **Colours.** Learning pins are `#b35c00` (were `#e8890c`), so a white glyph
  reads on them. Train is navy, ferry ocean blue `#0277bd` (was navy, dashed)
  and frequent bus slate `#455a64`, on stops and lines; rail and bus lines
  have a white casing.
- **Words.** "Ferry terminal" for "ferry stop", to match the key.
- **Stop names in the Stops layer.** Hovering or tapping a stop in Layers >
  Stops and stations names it, from the place's `transit.json`, loaded the
  first time the layer is turned on. Train and ferry stations are told apart
  by the lines they are on.

### School map points checked by hand

- **20 points checked, 14 moved.** Each school whose Ministry map point is
  more than 50 m outside its LINZ grounds, and that rule D5-1 left alone,
  was checked against its street address (LINZ address points), its LINZ
  and OpenStreetMap grounds, its own website and aerial imagery
  ([`docs/schools.md`](docs/schools.md), Points checked by hand). 14 points
  move into the school's grounds and 6 stay. The furthest moves: OneSchool
  Global, 2.7 km from its head office in Onehunga to its Auckland campus in
  Māngere Bridge; Hare Krishna School, 814 m from a paddock to its
  classrooms; TIPENE, 613 m from the gate on Great South Road to the school.
  Twin Oaks Classical School and Te Kura o Manunui keep their points: LINZ's
  grounds are the postal address and the old site.
- **A point kept is recorded.** A checked row in `configs/schools/points.csv`
  with no lon and lat keeps the Ministry's point. The audit marks the
  schools a person checked (`checked`) and no longer lists them to check;
  `meta.schools.points` says which moves were by rule and which by hand
  (`by`) and lists the points kept.
- **Routed again.** The 14 schools in Auckland (10), Christchurch (2),
  Wellington (1) and Rotorua (1). Every other school's minutes and stops are
  as published, and each run's 300-origin check matched.
- **Figures.** On the default view (In zone) only Christchurch primary
  school changes: 62.7% to 62.9% of children within 15 minutes on foot, and
  64.2% to 64.4% by public transport or on foot. Under All, Auckland falls
  by 0.05 to 0.28 points; Wellington primary and Rotorua secondary move by
  under 0.1.

### Checks

- `tests/web/symbols.test.mjs`: every symbol has a key row and an image,
  `glyphs.js` matches the icon files, and Mt Albert Grammar School's 35 stops
  are 23 symbols with the stations' badges placed first and five stops with
  no trips arriving 7–9am drawn hollow.
- `tests/web/palette.test.mjs`: the three modes pass the colour-blind check;
  a white glyph is 4.5:1 or more on every pin and stop colour; a symbol's
  halo or edge is 3:1 or more on each basemap and hexagon colour.
- `tests/web/schools_browser.py`: in every scene every symbol drawn is in the
  key; the stops' badges at zoom 13 and 15; a stop's tooltip and Show
  button; the card's link to Mt Albert Grammar School; Clear; `sch=one`; a
  pin's popup; a pick on a phone. Chromium and WebKit, desktop and 390 px,
  with the stylesheet held back 1.5 s.

## 0.12.0 (13 November 2026)

Schools, after Auckland Council used TEAM for work on Mt Albert Grammar
School (MAGS), and public transport that takes the walk where it is quicker.
[`docs/schools.md`](docs/schools.md) has the school rules and
[`docs/methodology.md`](docs/methodology.md) the rest.

### What changes on the page

- **The Schools row.** Under Getting to, for primary, intermediate and
  secondary school: All, State, In zone and One school. All is every school
  that teaches the years, as before. State is state schools taught in
  English. In zone is the state schools taught in English that must take a
  child living there: those whose home zone covers the home and those with
  no zone (Education and Training Act 2020, sections 33 and 74), leaving out
  designated character schools, whose boards may decline a student. One
  school is one school, found by name or its pin, with its zone drawn and the
  stops near it listed. Under State and In zone a home counts only when both
  a girl and a boy can reach a school that takes them.
- **A link without a school choice now opens In zone, counting children.**
  This is set in one place (`DEFAULT_SCHOOL_CHOICE` in `web/js/schools.js`)
  and is an open decision. A link with `sch=all` gives every school, as
  0.11.0 did, but counting children. Every link the page writes says which.
  The two emailed short links (`/go/albert-eden-cycling`,
  `/go/north-shore-cycling`) now carry `sch=all`, so they show every school
  as when they were sent; their figures still change, because they count
  children aged 13–17 and take the walk where it is quicker. A school link
  for a fare, a fare burden or a fare budget made before this release has no
  `sch` and opens All, where fares are worked out.
- **Children, not everyone.** School and early childhood figures count
  children of the service's ages: 0–4, 5–10 (Years 1–6), 11–12 (Years 7–8)
  and 13–17 (Years 9–13). One school counts the ages its own years cover
  (15–17 for a school that starts at Year 11), and at a girls' or a boys'
  school only girls or boys: the place's share of them in the 2018 Census.
- **Public transport, or walking where that is quicker.** Every public
  transport time is the quicker of the bus or train trip and walking all the
  way, for every service, jobs and fares. R5 on its own drops a walk once it
  passes 15 minutes, so public transport could show slower than walking (26
  minutes next to MAGS for a 15-minute walk). The card still says when a time
  is a walk, with the bus or train time beside it. Labels say "by public
  transport or on foot", jobs included: in a small town the jobs figure is
  mostly jobs on foot (Blenheim's typical resident reaches 10,400 jobs within
  45 minutes this way, against 900 by bus in 0.11.0).
- **The card.** It names the school reached the way the time on screen was
  made, and every school tied in that minute. A school row on a card for
  another service (the councillors' St Lukes hexagon under GP, say) says "all
  schools", tags the school's kind, says "on foot" for a walk, and names the
  fastest way's school with the fastest way.
- **Fares under a school choice.** The fare and fare burden maps and the fare
  budget count every school, so they are off under State, In zone and One
  school, and the page says so.
- **Commuting cost.** A home where half the jobs within 45 minutes are a walk
  away pays no fare and is left out of the commuting burden. Auckland: 1.9×
  (most against least deprived) for 1,531,000 people in 0.11.0, 1.8× for
  1,135,000 now; Wellington 1.9× for 486,000, now 1.7× for 295,000;
  Christchurch 2.0× for 498,000, now 2.1× for 321,000. In Blenheim and
  Tokoroa every home's typical commute is now a walk, so no fare is counted
  (0.11.0: 1.7× for 31,000 people, and 2.8% of a week's income).
- **Stops near a school.** Under One school: every stop and station within a
  15-minute walk of the school's point, with its stop number, walk, routes
  and the trips arriving from 7 to 9am on the routing day. School buses that
  end at the school's stop count (Wellington's 402 at Tawa College). After
  them, under "Nearest train stations, beyond a 15-minute walk", the
  school's nearest train or ferry stations up to a 30-minute walk, up to 3
  in all: Mt Albert Grammar School gains Baldwin Ave (16 min) and Mt Albert
  (17 min), the stations its students use, and Morningside (21 min). 315
  schools in the 20 places gain one (Auckland 199, Wellington 105, Hamilton 8,
  Queenstown 3). On the map, stations are filled navy and a stop whose
  minutes would overlap another's shows as a dot until zoomed in.

### Data and method

- **One school directory** for every place, fetched 12 November 2026 (rolls
  at 1 October 2026), with each school's kind, teaching language, sex by
  year, years, roll and enrolment scheme.
- **Schools across a regional boundary.** A place keeps every open school
  within about 8 km of it, from any region, that its street file reaches: 60
  schools come in (Auckland 43, Wellington 7, Rotorua 4, Nelson 3, Tauranga
  3). 10 schools in 7 places that the first 0.12.0 build counted are left
  out because the street file stops short of them; none had a time on foot,
  by bike or by public transport.
- **Enrolment zones** from the Ministry's enrolment scheme file of 2 October
  2026, as in force on 12 November 2026, by year level. Where a zone line
  crosses a hexagon, its residents are placed by LINZ address points; the
  hexagon is counted with the zones most of its residents live in, and the
  counting line says how many children live outside them. Where most of a
  school's zone lies outside the place (Tuakau College for Auckland), One
  school says it counts the part inside.
- **School types.** Every config spelt "Restricted Composite (Yr 7-10)",
  which matched no school. Years 7–10 and Years 1–10 schools now count for
  intermediate and, for Years 9–10, for secondary.
- **Secondary school in two stages.** Where a school stops at Year 10 or
  starts at Year 11 (Albany, Ormiston, Rototuna and others), State and In zone
  count a home only when a student in Years 9–10 and one in Years 11–13 can
  each reach a school that teaches them.
- **Designated character schools.** 15 in the twenty places, each checked
  against its Gazette notice (`configs/schools/attributes.csv`), are left out
  of In zone. Vanguard Military School takes Years 11–13 only.
- **School map points.** Every point checked against LINZ NZ Facilities and
  OpenStreetMap school grounds; three far outside their grounds moved inside
  them by rule and routed again (Te Aute College, Te Kura aa Iwi o Ngaati
  Kauwhata, Porirua Montessori). MAGS keeps the Ministry's point, by the
  Alberton Avenue drive Google Maps routes to.
- **Times past the limit.** R5 returned some times a minute or more past 60
  for the walk from the street to the point; they now show as over 60, for
  every service.
- **School runs of their own**, so a change to a school re-routes schools
  only (`team schools reroute`), and `team schools relabel` gives a school
  that gains a service the minutes it already had.

### Files

- New: `schools/<service>_<mode>.json` (every school within reach),
  `schools/zones.json`, `schools/zone_outlines_<service>.json`,
  `schools/stops.json`; `cells.json` `nearest_mode`, `ties`, `ptr` and
  `ages`; `summary.json` `meta.schools`, `meta.ages`, `meta.pt_or_walk`,
  `meta.formats`; downloads `team_<place>_schools.csv`,
  `team_<place>_school_zones.csv`, `team_<place>_school_stops.csv` (its last
  column, `far_station`, marks the far stations).
- `team_<place>_h3.csv`: the 0.11.0 columns keep their names, but school
  columns now come after tertiary, so read columns by name. `t_*_pt`,
  `jobs*_pt` and `costaccess_*` now hold public transport or walking. The
  new columns are at the end: R5's own public transport times (`_r5`), jobs
  and fares on foot (`_z0`) and children by age (`age_`).
- Phone downloads: opening Auckland loads 3.75 MB (brotli), 0.77 MB more
  than 0.11.0, mostly children by age, R5's own times and the no-fare layers;
  picking a school service under In zone then loads 0.78 MB (secondary) to
  1.67 MB (primary) of zones and school lists, which 0.11.0 did not load.

### Checks

- The page's figures equal the build's for every choice, school service and
  way in all 20 places, to a millionth of a share (`scripts/school_golden.py`,
  `tests/web/schools_parity.test.mjs`).
- Every reroute was checked by routing 300 hexagons again in a fresh process;
  every pair matched.
- Fresh r5py runs at the documented settings reproduce the published walking,
  R5 and public-transport-or-walking minutes, spreads and job counts for the
  pairs checked in the review.

### What changed in the published figures

Share of the place within each standard, as the page shows it by default: 0.11.0 counts all residents and every school; 0.12.0 counts children of the service's ages for schools and early childhood, schools under In zone (girls and boys together). One figure means no change to a tenth of a percent. 

**Auckland**

| Service | Walk | Low-stress bike | Public transport (0.12.0: or on foot) | Best without a car |
| --- | --- | --- | --- | --- |
| Supermarket | 61.2% | 72.8% | 58.8% → 67.2% | 77.6% |
| GP | 75.0% | 81.5% | 71.0% → 78.8% | 85.5% |
| Pharmacy | 76.3% | 81.8% | 72.3% → 80.0% | 85.7% |
| Library | 41.1% | 55.3% | 44.3% → 50.5% | 62.7% |
| Bank or post | 49.9% | 64.8% | 52.7% → 59.8% | 71.6% |
| Early childhood | 88.3% → 90.3% | 89.5% → 91.4% | 87.8% → 90.5% | 91.4% → 93.1% |
| Primary | 74.5% → 68.5% | 79.6% → 71.9% | 73.6% → 69.2% | 84.2% → 77.5% |
| Intermediate | 67.4% → 50.4% | 75.0% → 58.9% | 62.0% → 54.0% | 80.1% → 64.3% |
| Secondary | 74.3% → 56.4% | 84.7% → 68.2% | 79.8% → 71.1% | 89.0% → 78.4% |
| Tertiary | 40.5% | 62.1% | 70.6% → 70.9% | 74.8% |
| Trades training | 33.5% | 54.5% | 62.8% → 63.3% | 69.8% |

Auckland jobs within 45 minutes for a typical resident by public transport: 42,600 in 0.11.0; by public transport or on foot 43,200.

**Every place: schools and early childhood (best without a car, and public transport or on foot)**

| Place | Early childhood | Primary | Intermediate | Secondary | Jobs, typical resident, 45 min |
| --- | --- | --- | --- | --- | --- |
| Auckland | 91→93 / 88→90 | 84→78 / 74→69 | 80→64 / 62→54 | 89→78 / 80→71 | 42,600 → 43,200 |
| Wellington | 92→92 / 80→81 | 87→83 / 70→64 | 86→72 / 65→58 | 84→64 / 72→56 | 17,200 → 17,700 |
| Christchurch | 92→93 / 85→88 | 90→87 / 72→64 | 92→86 / 75→69 | 85→82 / 72→66 | 59,400 → 63,100 |
| Hamilton | 87→89 / 81→84 | 84→76 / 60→53 | 82→69 / 48→43 | 82→71 / 59→52 | 24,000 → 26,700 |
| Tauranga | 88→89 / 77→80 | 75→69 / 52→49 | 58→48 / 23→26 | 75→60 / 47→44 | 10,600 → 12,300 |
| Dunedin | 87→86 / 78→78 | 87→83 / 71→64 | 82→74 / 58→52 | 78→63 / 68→54 | 33,200 → 33,700 |
| Napier–Hastings | 89→92 / 79→86 | 86→86 / 73→73 | 85→76 / 56→51 | 88→81 / 65→57 | 9,800 → 15,100 |
| Palmerston North | 86→87 / 79→81 | 84→77 / 69→62 | 83→71 / 59→51 | 83→77 / 71→65 | 37,800 → 38,600 |
| Nelson | 85→87 / 67→73 | 83→83 / 51→54 | 79→73 / 30→39 | 77→74 / 38→51 | 7,500 → 9,800 |
| Whangārei | 70→75 / 61→67 | 60→59 / 46→42 | 63→55 / 34→40 | 59→45 / 33→37 | 1,100 → 3,000 |
| New Plymouth | 82→83 / 72→74 | 79→76 / 61→58 | 74→45 / 39→34 | 68→54 / 37→37 | 3,800 → 6,500 |
| Rotorua | 90→92 / 79→83 | 88→87 / 71→66 | 80→69 / 41→35 | 83→81 / 67→53 | 17,900 → 19,100 |
| Invercargill | 89→91 / 81→83 | 89→86 / 73→62 | 78→45 / 54→28 | 82→64 / 54→37 | 8,700 → 10,600 |
| Gisborne | 88→90 / 79→83 | 88→86 / 72→64 | 78→56 / 55→38 | 85→60 / 40→45 | 2,200 → 10,100 |
| Whanganui | 87→90 / 79→82 | 88→77 / 72→55 | 78→43 / 54→23 | 84→66 / 67→46 | 9,800 → 10,400 |
| Taupō | 78→83 / 63→70 | 74→64 / 60→48 | 66→44 / 45→38 | 74→71 / 22→56 | 1,000 → 7,000 |
| Queenstown | 66→73 / 54→64 | 68→69 / 41→39 | 75→78 / 44→53 | 19→9 / 15→7 | 3,600 → 3,800 |
| Whakatāne | 80→84 / 70→77 | 70→66 / 61→53 | 69→68 / 52→44 | 70→68 / 35→57 | 1,500 → 6,400 |
| Blenheim | 92→93 / 80→82 | 90→81 / 64→59 | 89→62 / 50→35 | 92→72 / 36→23 | 900 → 10,400 |
| Tokoroa | 90→91 / 87→88 | 89→89 / 86→84 | 78→75 / 64→65 | 90→91 / 58→88 | 400 → 2,600 |

In each cell, best without a car then public transport, %, 0.11.0 → 0.12.0. Most of the fall in the school figures is the default choice: In zone leaves out the schools a child cannot count on (integrated, private, charter, kura, out of zone, designated character), and the stage rule in Albany, Ormiston and Rototuna. Public transport rises everywhere for the other services (every place: supermarket by 3 to 22 points, GP 6 to 27) because the walk is taken where it is quicker; in small towns the jobs figure is mostly jobs on foot.

### Also in 0.12.0

- With `?mate=1` in the address, an Auckland hexagon's card has a section from
  MATE: each mobility profile's reach on foot and by public transport, what is
  in the way, kerbs and lighting by how much is recorded, an After dark switch,
  and the profile's catchment on the map. It is a preview until the Devonport
  field check. With it on, the address also keeps the selected hexagon.
- Stop, station and line names are in a file of their own, `transit.json`,
  which no page loads yet, so `overlays.json` stays as small as before.

## 0.11.0 (1 October 2026)

- Tertiary or trades training, and trades training on its own, are
  destinations under Education, with a 45-minute standard: the teaching sites of
  universities, polytechnics, wānanga and trades training providers, from a
  list kept by hand from NZQA and the providers and placed on LINZ addresses.
  Fares and the fare burden cover them too.
- Jobs have a commuting cost: five return trips a week by public transport to
  a typical job within reach, as a share of a week's income, by deprivation and
  group.

## 0.10.0 (30 September 2026)

- The panel's figures follow the map. Zoomed out they are for the whole place;
  zoomed in, for the council, ward, local board or suburb in the middle of the
  map, with the areas around it and the whole place on a line underneath. Each
  of those is a link to it. Links carry the area, so they open on the same
  figures on any screen.
- Councils and wards come from Stats NZ's 2026 boundaries, for all twenty
  places.
- A breakdown by NZDep fifth or by group resting on fewer than 100 people is
  left blank, for whole places too: small towns' Pacific and Asian bars, and
  some fare burden ratios, which now give the average instead.
- Fixes: bars in the access score's deprivation chart were all full width; a
  rural hexagon's card said "about 0 residents" when only urban areas were
  counted; local board lists placed each suburb by its first hexagon.

## 0.9.0 (29 September 2026)

- Where they live, for people aged 65 and over, sets rest homes and
  retirement villages apart and leaves them out of the figures unless put
  back, so the map shows where people have aged in their own homes. A census
  block counts as one when at least 60% of its residents are 65 or over, or
  when it holds an aged care facility on Health New Zealand's register and at
  least 30% are.
- Suburbs that are naturally occurring retirement communities (NORCs) are
  tagged in the suburb list, counted, and marked in the CSV download.
- Walking at the slower pace of 3.6 km/h is a way of travelling on the Access
  view and on each place's card, next to walking.

## 0.8.0 (29 September 2026)

- Libraries, and banks and post shops, are destinations of their own, under
  Community, and can be stops on an errand round.
- A round can take in two, three or four stops. Each set of stops loads only
  when it is picked.

## 0.7.0 (28 September 2026)

- Errand rounds, under Everyday: whether someone can get from home to the GP,
  the pharmacy and the supermarket and home again without a car, not just to
  each on its own. The pharmacy comes after the GP. Pick the stops, the way of
  travelling, the pace and the longest single stretch; Who misses out and Where
  they live work for rounds too.
- Hills. Walking and cycling, and the walks to and from public transport, are
  slowed on slopes (Tobler's hiking function), from LINZ's LiDAR and 8 m
  elevation models.
- A slower walking pace of 3.6 km/h, about the pace of people in their
  eighties, for rounds and for public transport.
- Auckland's cycling uses SPAN's traffic stress ratings, which know Auckland's
  speeds, traffic volumes and facilities, in place of a rule written for US
  streets.

## 0.6.0 (28 September 2026)

- Every place is now built from Stats NZ's functional urban areas (2023): the
  city or town with the satellite towns and rural land whose workers commute
  into it. Twenty places, up from seventeen, holding 4.12 million people (83%
  of the country).
- Greater Christchurch adds Rolleston, Lincoln, Prebbleton, Kaiapoi, Rangiora
  and Woodend. Greater Wellington adds Kāpiti, Ōtaki, Masterton, Carterton and
  the South Wairarapa towns, with Metlink's zones out to 14. Greater Hamilton
  adds Cambridge, Te Awamutu and Huntly on Busit's zone fares. Tauranga and
  Western Bay adds Te Puke and Katikati. Palmerston North and Feilding share
  Horizons' zones.
- Taupō, Whakatāne and Tokoroa are new.
- The other places take in their commuting land, New Plymouth with Te Pahi's
  zone fares out to Inglewood.
- Auckland's population now matches the 2023 Census: its grid had been built
  from an earlier count that was 2% short.
- Where they live, in Who misses out: where each group lives against its share
  across the place, how many live where they are at least one and a half times
  as common, and whether those places reach the service. For people aged 65
  and over this finds the retirement communities nobody planned, and which of
  them cannot reach a GP without a car.
- Destination pins are coloured by kind, grow under the pointer and say they
  can be clicked, instead of hiding under the hexagon's tooltip.
- Each place's data comes in two parts: what the map needs first, and the rest
  straight after. Auckland draws in about four seconds instead of six to nine.
- A layer ticked before the basemap has arrived now appears when it does.

## 0.5.0 (28 September 2026)

- Gisborne, Blenheim and Invercargill, from timetables their councils publish
  only on the web or in print, written out as GTFS. Seventeen urban areas.
- How robust is this? under each Access figure: whether it holds at every time
  of day, by more than one way of travelling, and as the standard moves.
- Choice: how many of a service are within the standard, not only the nearest.
- Urban areas only, to leave rural land out of the figures.
- Fare caps: the fare burden can count a week of daily trips after daily and
  weekly caps.

- An independent audit found real errors, now fixed. What it costs ignored
  low-stress cycling, so it overstated who could not reach a service at any
  price (229,000 against the right 167,000 for Auckland GPs). The fare burden
  charged a fare for "public transport" trips that were walks the whole way.
  The concentration index ordered tied NZDep deciles by map position. Places
  with no route could count as meeting a 60-minute standard. The city list
  used different statistics from the city pages. Job competition gave a few
  people ratios in the hundreds. All opportunities was half schools.
- What would help names the fare as a reason when a budget is what keeps
  someone off public transport.
- The panel leads with the answer: settings fold into one line saying what is
  set, and the Access score moves below.
- Who misses out has a table by suburb, and by local board in Auckland, for
  whatever is on screen, sortable and downloadable as CSV.
- Job access leads with a count of jobs, which compares across cities.
- A note says how a time or budget compares with the usual case, including
  when it changes nothing.
- Keyboard focus stays on a choice after the panel redraws, the panel no
  longer reads itself aloud on every change, and chip groups are labelled.
- A new opening page: the three largest places, each with a map and two
  figures, then every other place compared on the same figures. Use my
  location finds the nearest place.
- The place menu lists places only; Compare all places returns to the opening
  page.
- A data download that drops part way is tried again before giving up, and
  the message that follows offers to try again instead of blaming file access.

- Time of day. Public transport is timed at the weekday peak, weekday off-peak
  and on a Saturday, and a When control switches every public transport figure
  between them: times, fares, job access and scores. School trips stay on the
  weekday morning.
- Who misses out reports where the shortfall falls, as a concentration index
  of the shortfall itself, so it follows the standard, mode, time and fare on
  screen. Groups show how far short they are as well as how many miss out.
- Fares against income. A Share of income view maps what the cheapest way to
  each service costs as a share of a day's local income, and compares the most
  and least deprived areas. A fare budget can be set as a share of income, so
  each area gets its own budget and every access and equity figure follows.
- Eleven more urban areas: Hamilton, Tauranga, Dunedin, Napier-Hastings,
  Nelson, Palmerston North, New Plymouth, Rotorua, Whangārei, Whanganui and
  Queenstown.
- A return visit goes straight to the last place viewed.
- Fixed: fare budgets past four zones on Wellington's fourteen-zone network
  were read as four zones.
- Fixed: the all-opportunities score left out purposes with two-word names,
  which dropped schools and early childhood services from it.
- Fixed: Auckland's job pairs were kept only to 45 minutes, which cut the
  public transport and cycling job scores short of their horizon.

## 0.1.0

First release.

- Minutes to the nearest supermarket, GP, pharmacy and school by walking,
  low-stress cycling and public transport, with cycling on any street and car
  times for comparison.
- Access standards for each service, and a count of the ways each place meets
  them.
- Jobs within 30 and 45 minutes, with a version adjusted for competing workers.
- People below each standard by neighbourhood deprivation, households without
  a car, children and people aged 65 and over, for the region and by local
  board and SA2.
- Screening reasons for each place that misses a standard.
- A new web app with an adjustable standard, place details, search and
  downloadable data.
