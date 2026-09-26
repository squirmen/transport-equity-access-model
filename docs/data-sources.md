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

## Wellington, for the second city

| What | Where | Note |
| --- | --- | --- |
| Timetable | `https://static.opendata.metlink.org.nz/v1/gtfs/full.zip` | Static GTFS, no API key. The developer API needs one; this does not. |
| Fare zones | `stops.zone_id` in that feed | Fourteen numbered zones, with boundary stops given two as `1/2` or `4/5`. Nothing to digitise, unlike Auckland. |
| Fare table | Metlink, Tickets and fares | Read on 26 September 2026 into `raw/wellington/fares/`. Peak and off-peak Snapper fares for all fourteen zones, plus cash, and the concessions. |
| Fare zone lines | `https://mapping.gw.govt.nz/arcgis/rest/services/GW/Public_Transport_P/MapServer/4` | Boundary lines rather than polygons. Only needed if cells have to be zoned away from stops. |

Christchurch was the first choice for a second city, because a flat fare is
the simplest cost model there is. Its GTFS needs a free API key from
`apidevelopers.metroinfo.co.nz`, which someone has to register for, so
Wellington goes first: its feed is open and it is the one region that already
publishes the fare zone of every stop.

## Where each destination comes from, and why

| Destination | Source | Why this one |
| --- | --- | --- |
| GPs | Health New Zealand facility register, `Enrolling GP Practice` | OpenStreetMap cannot tell an enrolling GP practice from a specialist's rooms. In Auckland it returns 396 "doctors" where the register has 430 practices you can actually enrol with, and they are not the same 396. |
| Pharmacies | Health New Zealand facility register, `Community Pharmacy` | A measured gap, not a suspected one: OpenStreetMap had 276 in Auckland against the register's 442. |
| Supermarkets | OpenStreetMap, `shop=supermarket` | Counter-intuitive but well evidenced: OpenStreetMap carries about 98% of New Zealand's full-service supermarket banners against the Commerce Commission's audited counts. |
| Schools | Ministry of Education school directory | Authoritative, has rolls, updated nightly. |
| Jobs | Stats NZ business demography, SA2 | SA2 is a confidentiality floor rather than a publishing choice, so nothing finer exists outside the Data Lab. |

The health register is national and is cut to each city as it is built.

Attribution: Facility data from Health New Zealand | Te Whatu Ora, Facility
Code Table, CC BY 4.0.

### Known weaknesses

Jobs are the weakest layer. An SA2's employee count is spread over its
hexagons by area, and jobs cluster inside an area far more tightly than
residents do, so the job figures rank places rather than counting jobs in any
one hexagon.

Four Square stores are not counted as supermarkets. OpenStreetMap holds
fewer than half of them, so including them would bias the measure in exactly
the places TEAM exists to look at, and a small-format store is not a
substitute for a weekly shop either way.
