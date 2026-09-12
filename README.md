# TEAM: Transport Equity and Access Model

Who in Auckland can reach everyday services and jobs without a car, who
cannot, and what would change that.

[Open TEAM](https://team.tfwelch.com) · [Method](docs/methodology.md) ·
[Indicators](docs/indicators.md) · [Download the data](https://team.tfwelch.com/downloads/)

TEAM is built by the [Better Places Lab](https://betterplaces.blogs.auckland.ac.nz)
at Waipapa Taumata Rau | University of Auckland.

## What it shows

- **Access.** Minutes from every populated hexagon in Auckland to the nearest
  supermarket, GP, pharmacy and school, by walking, low-stress cycling and
  public transport, with car times for reference. Jobs reachable within 30
  and 45 minutes, with and without allowing for other workers competing for
  them.
- **Standards.** Whether each place is within a stated time of each service
  without a car, and in how many ways. The standards are settings: the web app
  lets you change them.
- **Who misses out.** The people beyond each standard, and how that differs by
  neighbourhood deprivation, for households without a car, for children and
  for people aged 65 and over.
- **What would help.** The main reason each place misses a standard: an
  indirect walk, no low-stress bike route, infrequent or slow public transport,
  or nothing within reach. Each points to a different kind of fix.

## First results

From the first full build (timetable of 1 September 2026, routed for a
school-term Tuesday, 2023 Census):

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

These figures depend on the standards, which are settings. The app recalculates
them for any other standard.

## How it works

Travel times come from the R5 routing engine, using OpenStreetMap streets and
paths and the Auckland Transport timetable for a school-term Tuesday. The
region is divided into H3 hexagons of about 0.1 km², with residents and their
characteristics from the 2023 Census. Destinations come from OpenStreetMap, the
Ministry of Education school directory and Stats NZ business demography.

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
full in [`docs/methodology.md`](docs/methodology.md#9-what-team-does-not-do).

## Running a build

You need Python 3.10 or later, Java 21 for R5, and
[osmium](https://osmcode.org/osmium-tool/). Node 20 or later is used only for
the web checks.

```sh
pip install -e ".[routing,test]"
team --data-root /path/to/data destinations
team --data-root /path/to/data route --all     # several hours; resumes if stopped
team --data-root /path/to/data build
```

The build writes an upload-ready folder to `<data root>/team/site/`. Copy its
contents to any static web host. [`docs/running.md`](docs/running.md) describes
the input files, the data root layout and each step.

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
| `configs/` | settings for each region |
| `docs/` | method, indicators, data sources and the TAI-PT comparison |
| `tests/` | tests, and a small synthetic dataset for the web app |

## Licence and citation

The code is released under the [MIT licence](LICENSE). Input and output data
remain under their providers' terms; see
[`docs/data-sources.md`](docs/data-sources.md). To cite TEAM, use
[`CITATION.cff`](CITATION.cff).

Questions, corrections and data offers: t.welch@auckland.ac.nz
