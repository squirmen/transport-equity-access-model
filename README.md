# TEAM: Transport Equity and Access Model

Who in twenty New Zealand cities and towns can reach everyday services and
jobs without a car, who cannot, and what would change that.

[Open TEAM](https://team.tfwelch.com) · [Method](docs/methodology.md) ·
[Indicators](docs/indicators.md) · [Changes](CHANGELOG.md) ·
[Download the data](https://team.tfwelch.com/downloads/)

TEAM is built by the [Better Places Lab](https://betterplaces.blogs.auckland.ac.nz)
at Waipapa Taumata Rau | University of Auckland.

## Where it covers

Auckland, Greater Christchurch, Greater Wellington, Greater Hamilton, Tauranga
and Western Bay, Palmerston North and Feilding, Dunedin, Napier–Hastings,
Nelson, New Plymouth, Rotorua, Whangārei, Invercargill, Whanganui, Gisborne,
Blenheim, Queenstown, Taupō, Whakatāne and Tokoroa. Each is built from Stats
NZ's functional urban areas, so it takes in the satellite towns and rural land
that commute into it. Together they hold 4.12 million people, 83% of the
country at the 2023 Census.

## What it shows

- **Access.** Minutes from every populated hexagon to the nearest
  supermarket, GP, pharmacy, library, bank or post shop, early childhood
  service and school, by walking, walking at a slower pace, low-stress cycling
  and public transport, with car times for reference. Jobs reachable within 30
  and 45 minutes, with and without allowing for other workers competing for
  them.
- **Errand rounds.** Whether someone can get from home to two, three or four
  of the GP, pharmacy, supermarket, library and bank or post shop and home
  again within a set time, with a limit on the longest single stretch.
- **Standards.** Whether each place is within a stated time of each service
  without a car, and in how many ways. The standards are settings: the web app
  lets you change them.
- **Who misses out.** The people beyond each standard, and how that differs by
  neighbourhood deprivation, for households without a car, children, people
  aged 65 and over, lower-income households, Māori, Pacific peoples, Asian
  residents and disabled people.
- **Where they live.** Where each group lives and is concentrated, and whether
  those places meet the standard. For people aged 65 and over, rest homes and
  retirement villages are set apart and suburbs that are naturally occurring
  retirement communities are flagged.
- **Fares.** What a trip costs on each network's fares, as dollars and as a
  share of household income, with an optional fare budget.
- **What would help.** The main reason each place misses a standard: an
  indirect walk, no low-stress bike route, infrequent or slow public transport,
  or nothing within reach. Each points to a different kind of fix.
- **How much is within reach.** A gravity score that counts every opportunity
  and discounts each one by how long it takes to get to, on the impedance
  travel time parameters the NZ Transport Agency published for the New Zealand
  accessibility analysis methodology, with a beta curve for
  cycling from the Propensity to Cycle Tool. Shown as a score, as an index
  against the regional average, or as deciles, and switched on with the
  Measure toggle.

## First results, Auckland

From the first full build of Auckland (timetable of 1 September 2026, routed
for a school-term Tuesday, 2023 Census). Later versions add hills and more
destinations, so the app's current figures differ a little.

- 87% of Aucklanders can reach a GP within 20 minutes without a car. Two-thirds
  of the 203,000 who cannot live outside the main Auckland urban area, where
  fewer than half of residents meet the standard. Inside it, 95% do.
- People in the most deprived fifth of neighbourhoods are more likely to meet
  the GP standard (94%) than people in the least deprived fifth (78%). Part of
  the difference is location: 28% of the least deprived fifth live outside the
  main urban area, against 4% of the most deprived. Inside the urban area the
  figures are 96% and 91%.
- For a typical resident, about 5% of the region's jobs are within 45 minutes by
  public transport, against 96% by car in free-flowing traffic.
- Across 611 SA2s, job access by public transport rises with the share of
  workers who did not drive to work in the 2023 Census (Spearman's rho 0.61).
  The gravity score for jobs gives 0.60 on the same test, so the two measures
  track behaviour about equally well.
- On the gravity score, where 100 is the regional average, the typical resident
  scores 72 for all opportunities by public transport and 52 for jobs. The
  best-served tenth of residents score 15 times the least-served 40%.

These figures depend on the standards, which are settings. The app recalculates
them for any other standard.

## How it works

Travel times come from the R5 routing engine through r5py, using
OpenStreetMap streets and paths and each network's timetable for a
school-term Tuesday and a Saturday. Gisborne, Invercargill and Blenheim
publish no GTFS feed, so their timetables are converted from Ride Guide and the
council's printed timetable. Walking and cycling are slowed on slopes, from
LINZ's LiDAR and 8 m elevation models. Auckland's cycling uses the traffic
stress ratings from SPAN, the lab's cycling investment model.

Each place is divided into H3 hexagons of about 0.1 km², with residents and
their characteristics from the 2023 Census. Destinations come from
OpenStreetMap, the Ministry of Education's school and early learning
directories, Health New Zealand's facility register and Stats NZ business
demography.

The full method, with its assumptions and references, is in
[`docs/methodology.md`](docs/methodology.md). How TEAM relates to Transport for
NSW's proposed Transport Access Indicator and to PTAL is set out in
[`docs/tai-pt-comparison.md`](docs/tai-pt-comparison.md).

## Reading the results

TEAM is for comparing places and for early work on where and how to improve
access. It is not a project list, and the reasons it gives are screening rules
rather than designs. It uses the nearest service, so school zones, GP
enrolment and opening hours are not taken into account. Times come from
timetables and street data rather than observed trips. The limits are listed in
full in [`docs/methodology.md`](docs/methodology.md#12-what-team-does-not-do).

## Running a build

You need Python 3.10 or later, Java 21 for R5, and
[osmium](https://osmcode.org/osmium-tool/). Node 20 or later is used only for
the web checks.

Each place has a configuration in [`configs/`](configs/). Auckland's is the
default; name another with `--config`.

```sh
pip install -e ".[routing,test]"
team --config configs/wellington.yml --data-root DATA --out DATA/team-wellington destinations
team --config configs/wellington.yml --data-root DATA --out DATA/team-wellington route --all
team --config configs/wellington.yml --data-root DATA --out DATA/team-wellington build
python scripts/build_national_site.py --out site --city DATA/team DATA/team-wellington
```

Routing takes from minutes for a small town to most of a day for Auckland,
and resumes if stopped. The last step gathers the places into one site; copy
its contents to any static web host. [`docs/running.md`](docs/running.md)
describes the input files, adding a place, and each step.

To try the web app without a build, serve the repository and open the
synthetic test data:

```sh
python -m http.server 8812
# then open http://localhost:8812/web/?data=../tests/fixtures/web/
```

## Tests

```sh
pytest
npm test
```

## Repository layout

| Path | Contents |
| --- | --- |
| `src/team/` | the pipeline: destinations, routing, measures, equity, export |
| `web/` | the web app (plain HTML, CSS and JavaScript; no build step) |
| `configs/` | settings for each place |
| `scripts/` | preparing a new place, timetables, fare zones, elevation, SPAN stress, assembling the site |
| `docs/` | method, indicators, data sources and the TAI-PT comparison |
| `tests/` | tests, and a small synthetic dataset for the web app |

## Licence and citation

The code is released under the [MIT licence](LICENSE). Input and output data
remain under their providers' terms; see
[`docs/data-sources.md`](docs/data-sources.md). To cite TEAM, use
[`CITATION.cff`](CITATION.cff).

Questions, corrections and data offers: t.welch@auckland.ac.nz
