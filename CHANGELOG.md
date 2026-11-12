# Changelog

## 0.12.0 (not yet released)

Schools, after Auckland Council used TEAM for work on Mt Albert Grammar
School (MAGS). [`docs/schools.md`](docs/schools.md) has the rules.

- **The card names the right school.** It named the nearest school by the
  quickest way, beside the time for the way on screen. On the councillors'
  slide (St Lukes, hexagon 89bb50021a3ffff) "9 min by public transport,
  nearest Marist College" was a 9-minute walk to TKKM o Nga Maungarongo, with
  Marist the nearest by low-stress cycling (6 min). The data now names the
  school for each way (`nearest_mode`), and every school tied in the same
  minute (`ties`). From that hexagon MAGS is 15 min on foot or by public
  transport and 10 by low-stress bike; Marist is 12 on foot.
- **Every school within reach, and what it is.** School runs keep every school
  within 60 minutes of each hexagon, in files the page loads when asked
  (`schools/<service>_<mode>.json`), and each school carries its kind, teaching
  language, who it takes, years, roll and enrolment scheme. That is what the
  page needs to count state schools only, or one school, without routing
  again. Public transport school times also keep the 10th and 90th
  percentiles over the departure minutes.
- **One directory for every place.** Schools come from one copy of the
  Ministry's national directory, fetched 12 November 2026 (rolls at 1 October
  2026). Auckland's old copy had 10 of the 50 fields.
- **Intermediate schools.** Every config spelt "Restricted Composite (Yr
  7-10)", which matched no school, and Secondary (Year 7-10) schools were not
  counted. Both now count for intermediate only: 5 schools in Auckland (3,887
  students) and 4 around Hamilton (2,865).
- **Times past the limit.** R5 returned times a minute or more past the
  60-minute limit for some walks and rides to the point; these were published
  (up to 80 min) although every count stopped at 60. They now show as over
  60, for every service.
- **School runs of their own.** Schools are routed apart from the other
  services, so a change to the directory re-routes schools only. Before any
  point changed, the school runs gave the same minutes as the services runs
  for every pair. `team schools split` moves a build over.
- **The Schools row.** Under Getting to, for the three school services: All
  (as before, and what a link without a choice shows), State (state schools
  taught in English, for girls and boys together, girls or boys) and One
  school, picked by name or by its pin, with a link of its own
  (`sch=one:69`). In zone follows once the Ministry's zone file is in. A line
  under the headline says which schools are counted and how many are not,
  from the build's own list. The card tags a school that is not a state,
  English-medium co-ed school and gives the nearest state school beside it,
  says when a public transport time is a walk, and lists tied schools. The
  hexagons shown can be downloaded as a CSV with the choice and data dates
  in its first lines.
- **For checking points and entrances.** Corrected map points and checked
  entrances can be added by hand (`configs/schools/`); none yet.
  `scripts/school_points_review.py` writes the sheets to check them against
  LINZ NZ Facilities and OpenStreetMap.

After a review of the MAGS case (12 November 2026), before release:

- **The map's tooltip says what the card says**, for every service. At St
  Lukes it said "9 min by public transport" for the walk to TKKM o Nga
  Maungarongo; it now gives the card's first sentence ("9 min on foot. No
  bus or train is quicker."), names the way under Best ("6 min by low-stress
  cycling") and adds "Walking is quicker" where it is.
- **One school without its zone.** The headline was a share of everyone in
  Auckland (MAGS by public transport: 3%), mostly people who would never go
  there, and picking a school reset the area to all of Auckland, so MAGS for
  Albert-Eden (50%) could sit beside Western Springs College for Auckland
  (3%). The headline is now the number of people within the standard (MAGS
  by public transport: 57,000), with a share only for a local board, ward or
  suburb, and the area stays when the school changes (Albert-Eden: MAGS 50%,
  Western Springs College 20%). Who misses out and What would help are off
  for one school until zones are in.
- **Words that were not quite right.** On the card "state school" is "state
  school taught in English", as State counts. Under State, the line under
  the headline says home zones are not applied. Every school headline says
  it counts all residents, not only school-age children. The One school
  spread is public transport's own ("By public transport, usually 23–30
  min") and names the routing day, Tuesday 15 September 2026, rather than
  "weekdays". The key says what nearest means, and no longer says a walk of
  up to 15 minutes counts without saying that a walk shown as 15 minutes may
  not (151 of the 303 Auckland secondary school pairs with a 15-minute walk
  have a slower public transport time; none with a shorter walk do). Auckland
  Transport's open timetable has no dedicated school buses but does have a
  few school-time trips on public routes (747, 989, 997), which are counted.
- **Where the times end.** The One school card and the CSV say a time goes to
  the Ministry's map point (the pin), not the nearest gate, with the pin's
  straight-line distance. MAGS's point is inside its 19.5 ha grounds, and
  every walk to it takes within a minute of the walk to the Alberton Avenue
  drive on the west side. Three candidate entrances are
  listed in `configs/schools/entrances.csv`, not checked and not used. A
  check run to them (r5py 1.1.3, TEAM's settings, 3,884 hexagons within 15
  km; it gives exactly the published minutes to the point for every one of
  them, by every way) shows what is at stake. If students could use all three, the
  people within 30 minutes of MAGS by public transport would be 74,558
  rather than 57,003 (74,014 without the south-east gate), 63.5% of
  Albert-Eden rather than 50.3%; on foot 42,991 rather than 33,295. Single
  hexagons east of the school would be up to 25 minutes nearer by public
  transport. These are not published figures: which gates students may use
  needs checking with the school.
- **Links and search.** A link pasted into an open page, differing only after
  the `#`, now reloads it, so the figures match the link. School search finds
  "Mount" for "Mt", "Saint" for "St", and initials (MAGS).
- **Docs.** Why public transport can be slower than a 15-minute walk, and
  that schools over a regional boundary are not counted.

Zones and school-age children (12 November 2026):

- **In zone.** A new school choice: the state schools taught in English that
  must take a child living in the hexagon, under the Education and Training
  Act 2020 (sections 33 and 74): those whose home zone holds the home, and
  those with no zone. Zones come from the Ministry's enrolment scheme file of
  2 October 2026 (`raw/nz/education/moe_enrolment_zones_2026-11-12/`), as in
  force on 12 November 2026. A year-level zone applies from the school's
  entry year for the service (Balmoral School's Zone B is its intermediate
  zone). Where the file holds only a zone that starts later (Tangaroa
  College, Ormiston Junior College, Western Heights School, six Christchurch
  primaries, Shotover, Arrowtown and Remarkables), that zone is used and
  labelled. Checked against Eagle Technology's copy, which is not published.
- **Zones by where people live.** Where a zone line crosses a hexagon, its
  residents are placed by LINZ address points (each carries its census
  block's residents shared equally), and the hexagon is counted in the zones
  most of its residents live in. One school with a zone gets the share of
  the children living in its zone who can reach it, and Who misses out and
  What would help for them; MAGS's zone holds about 63,600 residents and
  3,780 children aged 13–17.
- **Children, not everyone.** School and early childhood figures count
  children of the service's ages (0–4, 5–10, 11–12, 13–17), from the 2023
  Census five-year bands by SA1 split into single years by the 2018 Census
  shape of the surrounding SA2. An even split would count several times too
  many secondary-age children in student areas (Campus North, Dunedin: 149
  rather than 979). Other services and the all-residents columns are as before.
- **Files.** `schools/zones.json` (format 2), `schools/zone_outlines_<service>.json`,
  `cells.json` `ages`, `summary.json` `meta.ages` and `meta.schools.zones`;
  downloads `team_<place>_school_zones.csv`, zone columns in
  `team_<place>_schools.csv` and age columns in `team_<place>_h3`. New
  commands `team zones check` and `team ages check`; new scripts
  `fetch_address_points.py`, `fetch_census_ages.py` and `check_zones_eagle.py`.

What changed in the published figures, from the 0.11.0 site to the 0.12.0
build: the share of people within each school standard (all hexagons), before
and after, and how many hexagons have a new time. One figure means no change
to a tenth of a percent.

- Intermediate rises in Auckland and Hamilton, from the type fix. Taupō and
  Tokoroa read the same Waikato directory, but its Year 7–10 schools are in
  and around Hamilton.
- Auckland primary: Te Wharekura o Tāmaki ki te Tonga opened in October and
  Kadimah School's point moved 230 m. Auckland secondary by public transport:
  Nova Innovation College, a new private school.
- Dunedin primary and intermediate fall: Taieri Beach School is no longer in
  the directory. Tauranga primary falls: the Ministry moved Te Kura o
  Manunui's point 186 m.
- Everything else in the table is the limit fix.
- The education access score, and so the all-opportunities score, moves in
  some hexagons in every place, because school rolls weight it and are now at
  1 October 2026. In Auckland 3,491 of 29,801 hexagons change by public
  transport, two in three by one point, more near schools added or moved.

| Place | School | Any way | Walk | Low-stress bike | PT | Hexagons changed (most for one way) | Over 60, now blank (most for one way) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auckland | Primary | 84.2% → 84.3% | 74.5% → 74.6% | 79.6% → 79.7% | 73.6% | 92 | 58 |
| Auckland | Intermediate | 80.1% → 80.3% | 67.4% → 68.1% | 75.0% → 75.2% | 62.0% → 63.1% | 274 | 49 |
| Auckland | Secondary | 89.0% → 89.1% | 74.3% | 84.7% | 79.8% | 32 | 26 |
| Blenheim | Primary | 90.0% | 64.7% | 89.6% | 64.1% | 4 | 4 |
| Blenheim | Intermediate | 89.3% | 65.0% | 89.2% | 49.8% | 6 | 6 |
| Blenheim | Secondary | 92.0% | 81.4% | 92.0% | 36.4% | 7 | 7 |
| Christchurch | Primary | 90.2% | 71.7% | 90.1% | 72.0% | 135 | 135 |
| Christchurch | Intermediate | 92.4% | 78.8% | 92.2% | 74.7% | 145 | 145 |
| Christchurch | Secondary | 85.0% | 66.7% | 83.9% | 71.5% | 15 | 15 |
| Dunedin | Primary | 87.0% → 86.9% | 70.2% → 70.1% | 86.2% → 86.0% | 71.0% → 70.8% | 33 | 3 |
| Dunedin | Intermediate | 82.5% → 82.3% | 63.6% → 63.4% | 80.2% → 80.0% | 57.6% → 57.5% | 32 | 2 |
| Dunedin | Secondary | 78.4% | 66.2% | 75.7% | 67.7% | 0 | 0 |
| Gisborne | Primary | 88.3% | 73.0% | 88.1% | 72.3% | 27 | 27 |
| Gisborne | Intermediate | 78.3% | 65.5% | 78.0% | 54.8% | 27 | 27 |
| Gisborne | Secondary | 84.7% | 62.3% | 84.3% | 39.6% | 40 | 40 |
| Hamilton | Primary | 83.7% | 61.4% | 83.2% | 59.6% | 121 | 121 |
| Hamilton | Intermediate | 81.6% → 82.0% | 56.9% → 60.0% | 81.4% → 81.7% | 48.2% → 51.2% | 491 | 145 |
| Hamilton | Secondary | 81.6% | 62.3% | 81.5% | 58.7% | 18 | 18 |
| Invercargill | Primary | 88.5% | 73.8% | 88.5% | 72.6% | 11 | 11 |
| Invercargill | Intermediate | 78.0% | 68.4% | 77.8% | 53.5% | 8 | 8 |
| Invercargill | Secondary | 81.8% | 69.1% | 81.7% | 53.8% | 2 | 2 |
| Napier–Hastings | Primary | 85.9% | 73.8% | 85.7% | 73.0% | 93 | 93 |
| Napier–Hastings | Intermediate | 85.1% | 70.6% | 84.9% | 56.0% | 79 | 79 |
| Napier–Hastings | Secondary | 88.2% | 84.3% | 88.0% | 64.7% | 26 | 26 |
| Nelson | Primary | 82.9% | 52.9% | 82.8% | 51.2% | 17 | 17 |
| Nelson | Intermediate | 79.4% | 46.0% | 79.2% | 30.2% | 10 | 10 |
| Nelson | Secondary | 77.2% | 59.4% | 76.9% | 38.1% | 0 | 0 |
| New Plymouth | Primary | 78.8% | 61.9% | 77.2% | 61.3% | 105 | 105 |
| New Plymouth | Intermediate | 74.3% | 59.7% | 73.7% | 38.7% | 110 | 110 |
| New Plymouth | Secondary | 68.4% | 57.4% | 67.4% | 36.8% | 41 | 41 |
| Palmerston North | Primary | 83.8% | 69.7% | 83.4% | 69.2% | 46 | 46 |
| Palmerston North | Intermediate | 82.5% | 63.3% | 82.1% | 58.9% | 46 | 46 |
| Palmerston North | Secondary | 83.2% | 67.1% | 81.3% | 70.6% | 35 | 35 |
| Queenstown | Primary | 68.2% | 40.1% | 67.3% | 40.9% | 0 | 0 |
| Queenstown | Intermediate | 75.3% | 51.0% | 75.1% | 44.4% | 0 | 0 |
| Queenstown | Secondary | 19.0% | 9.2% | 14.7% | 15.4% | 0 | 0 |
| Rotorua | Primary | 88.1% | 72.7% | 87.9% | 71.1% | 95 | 95 |
| Rotorua | Intermediate | 80.2% | 55.4% | 80.1% | 41.3% | 95 | 95 |
| Rotorua | Secondary | 83.1% | 69.3% | 82.6% | 66.8% | 12 | 12 |
| Taupō | Primary | 74.0% | 60.0% | 73.8% | 59.6% | 0 | 0 |
| Taupō | Intermediate | 66.5% | 55.1% | 66.5% | 45.2% | 1 | 1 |
| Taupō | Secondary | 74.4% | 59.2% | 74.4% | 21.6% | 0 | 0 |
| Tauranga | Primary | 75.4% → 74.5% | 52.7% → 52.4% | 74.5% → 73.6% | 51.8% → 51.4% | 41 | 7 |
| Tauranga | Intermediate | 58.3% | 27.4% | 56.8% | 23.3% | 11 | 11 |
| Tauranga | Secondary | 74.7% | 43.4% | 72.1% | 47.4% | 7 | 7 |
| Tokoroa | Primary | 88.7% | 85.9% | 88.7% | 85.8% | 0 | 0 |
| Tokoroa | Intermediate | 77.7% | 71.3% | 77.6% | 64.5% | 0 | 0 |
| Tokoroa | Secondary | 89.5% | 87.2% | 89.5% | 57.9% | 0 | 0 |
| Wellington | Primary | 87.5% | 70.9% | 86.5% | 70.2% | 55 | 55 |
| Wellington | Intermediate | 85.9% | 71.5% | 84.3% | 65.4% | 46 | 46 |
| Wellington | Secondary | 83.6% | 63.7% | 78.7% | 72.2% | 29 | 29 |
| Whakatāne | Primary | 70.0% | 61.1% | 69.3% | 60.6% | 22 | 22 |
| Whakatāne | Intermediate | 69.3% | 62.6% | 68.6% | 51.8% | 23 | 23 |
| Whakatāne | Secondary | 69.9% | 63.6% | 69.6% | 35.3% | 0 | 0 |
| Whanganui | Primary | 87.6% | 73.3% | 87.2% | 72.1% | 50 | 50 |
| Whanganui | Intermediate | 77.8% | 65.1% | 77.5% | 54.2% | 50 | 50 |
| Whanganui | Secondary | 84.4% | 75.1% | 83.8% | 66.6% | 5 | 5 |
| Whangārei | Primary | 60.5% | 46.2% | 59.4% | 45.7% | 126 | 126 |
| Whangārei | Intermediate | 63.0% | 47.2% | 62.5% | 34.0% | 70 | 70 |
| Whangārei | Secondary | 58.8% | 50.0% | 57.8% | 33.2% | 25 | 25 |

Other services, times over 60 now blank (hexagon and mode pairs): Auckland 341; Blenheim 14; Christchurch 276; Dunedin 58; Gisborne 86; Hamilton 403; Invercargill 115; Napier–Hastings 137; Nelson 18; New Plymouth 60; Palmerston North 146; Queenstown 4; Rotorua 29; Taupō 11; Tauranga 24; Tokoroa 8; Wellington 191; Whakatāne 16; Whanganui 20; Whangārei 184.

Other services' times are unchanged except where they were over 60 minutes.

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
