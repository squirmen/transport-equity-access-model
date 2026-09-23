# Data sources

Every input TEAM uses, where it comes from, and the terms it is published
under. Paths are relative to the data root (see [`running.md`](running.md)).
Check each provider's current terms before redistributing their data.

| Dataset | Provider | Used for | Terms | Path |
| --- | --- | --- | --- | --- |
| OpenStreetMap extract for the Auckland area | OpenStreetMap contributors, via Geofabrik | street and path network; supermarkets, GPs and pharmacies | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) | `processed/auckland/osm/auckland_bbox.osm.pbf` |
| GTFS timetable, feed of 1 September 2026 | Auckland Transport | public transport routing and stop frequencies | Auckland Transport open data terms | `raw/auckland/gtfs/at_gtfs_2026-09-01.zip` |
| Cycling network | Auckland Transport | distance to low-stress cycle facilities; map overlay | Auckland Transport open data terms | `raw/auckland/cycling/at_cycling_network.geojson` |
| Directory of schools | Ministry of Education (Education Counts) | school destinations and rolls | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/auckland/education/educationcounts_schools_auckland.json` |
| 2023 Census: SA1 boundaries and population | Stats NZ | population grid; census geography | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/auckland/census/statsnz_census_sa1_2023_auckland.geojson` |
| 2023 Census: age by SA1 | Stats NZ | children and people aged 65 and over | CC BY 4.0 | `raw/auckland/census/statsnz_census_individual_part1_age_sa1_2023.json` |
| 2023 Census: households by SA1 | Stats NZ | households without a car; household income | CC BY 4.0 | `raw/auckland/census/statsnz_census_households_income_vehicle_sa1_2023.json` |
| 2023 Census: main means of travel to work by SA2 | Stats NZ | share of workers who drove to work | CC BY 4.0 | `processed/auckland/census/sa2_commute_car_share.csv` |
| Business demography, employee counts by SA2, 2024 | Stats NZ | jobs | CC BY 4.0 | `processed/auckland/grid/auckland_h3_r9_v2_opportunities.parquet` (column `dest_jobs`) |
| NZDep2023 | University of Otago, Wellington | neighbourhood deprivation | free to use with citation | carried in the SA1 boundary file |
| Local board boundaries, 2025 elections | Auckland Council | local board of each hexagon, for summaries | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/auckland/geography/auckland_council_local_boards.geojson` |

## Prepared inputs

Two inputs are prepared from the sources above before TEAM runs:

- **Population grid** (`processed/auckland/grid/auckland_h3_r9_population.parquet`):
  H3 resolution 9 cells covering the council area, with 2023 Census usual
  residents spread from SA1 blocks by area, and each cell's centre.
- **Jobs grid** (`processed/auckland/grid/auckland_h3_r9_v2_opportunities.parquet`):
  the same cells with business demography employee counts spread from SA2s by
  area.

## Basemaps

The web app draws its background from Esri's World Light Gray Canvas and World
Imagery services and from OpenStreetMap's standard tiles. These are displayed,
not redistributed, and carry their providers' attribution on the map.

## Outputs

TEAM's own outputs (travel times, standards, summaries and the downloadable
dataset) are derived from the inputs above and carry their terms. The
OpenStreetMap-derived parts are subject to ODbL share-alike conditions.

The MIT licence in [`LICENSE`](../LICENSE) covers the source code only. Input
and output datasets remain under the terms set by their providers, listed above.
