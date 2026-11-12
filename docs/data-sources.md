# Data sources

Every input TEAM uses, where it comes from, and the terms it is published
under. Paths are relative to the data root (see [`running.md`](running.md)).
Check each provider's current terms before redistributing their data.

| Dataset | Provider | Used for | Terms | Path |
| --- | --- | --- | --- | --- |
| OpenStreetMap extract for the Auckland area | OpenStreetMap contributors, via Geofabrik | street and path network; supermarkets, GPs and pharmacies | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) | `processed/auckland/osm/auckland_bbox.osm.pbf` |
| GTFS timetable, feed of 1 September 2026 | Auckland Transport | public transport routing and stop frequencies | Auckland Transport open data terms | `raw/auckland/gtfs/at_gtfs_2026-09-01.zip` |
| Cycling network | Auckland Transport | distance to low-stress cycle facilities; map overlay | Auckland Transport open data terms | `raw/auckland/cycling/at_cycling_network.geojson` |
| Directory of schools, all of New Zealand, fetched 12 November 2026 (rolls at 1 October 2026) | Ministry of Education (Education Counts), data.govt.nz resource `4b292323-9fcc-41f8-814b-3c7b19cf14b3` | school destinations, what each school is, and rolls; every place reads this one file | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/nz/education/moe_schools_directory_2026-11-12.csv` |
| School enrolment zones, enrolment scheme master file version of 2 October 2026, downloaded 12 November 2026 | Ministry of Education, [Education Counts](https://www.educationcounts.govt.nz/__data/assets/file/0003/108606/Enrolmentschememaster.zip) (MapInfo TAB, NZTM2000) | the In zone choice and One school's zone (docs/schools.md) | [CC BY 3.0 NZ](https://creativecommons.org/licenses/by/3.0/nz/) | `raw/nz/education/moe_enrolment_zones_2026-11-12/Enrolmentschememaster.zip` |
| School enrolment zones, Eagle Technology's copy (check only) | [Eagle Technology on ArcGIS Online](https://services.arcgis.com/XTtANUDT8Va4DLwI/ArcGIS/rest/services/NZ_School_Zone_boundaries/FeatureServer/0) | checking the Ministry's file (`scripts/check_zones_eagle.py`); nothing from it is kept or published | not open | scratch only |
| NZ Addresses, current address points, fetched 12 November 2026 | LINZ, [layer 105689](https://data.linz.govt.nz/layer/105689-nz-addresses/), from the [public ArcGIS copy](https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Addresses/FeatureServer/0) (data last edited 2 November 2026) | where residents live inside a hexagon a zone line crosses (`scripts/fetch_address_points.py`) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/nz/addresses/linz_nz_addresses_2026-11-12/<place>.parquet` |
| NZ Facilities, school polygons, fetched 12 November 2026 (data last edited 19 March 2026) | LINZ, [layer 105588](https://data.linz.govt.nz/layer/105588-nz-facilities/), from the [public ArcGIS copy](https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Facilities/FeatureServer/0) (`scripts/fetch_school_grounds.py`) | checking every school map point against its grounds (`scripts/school_points_audit.py`); with OpenStreetMap's grounds, the rule that moved three points into their grounds (docs/schools.md, "Checking every map point") | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/nz/education/linz_nz_facilities_2026-11-12.gpkg` |
| School grounds in OpenStreetMap (`amenity=school` areas) | OpenStreetMap contributors, in each place's street file | the second record of a school's grounds in the map point check: a point is moved only where these grounds and LINZ's agree | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) | the place's OpenStreetMap extract |
| Designated character schools | NZ Gazette notices and the schools' own pages, each cited in `configs/schools/attributes.csv` | leaving designated character schools out of In zone (the directory has no field for them) | Crown copyright; facts only | `configs/schools/attributes.csv` |
| 2023 Census: SA1 boundaries and population | Stats NZ | population grid; census geography | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/auckland/census/statsnz_census_sa1_2023_auckland.geojson` |
| 2023 Census: age by SA1 | Stats NZ | children and people aged 65 and over | CC BY 4.0 | `raw/auckland/census/statsnz_census_individual_part1_age_sa1_2023.json` |
| 2023 Census: five-year age bands by SA1 and by SA2, all of New Zealand, fetched 12 November 2026 | Stats NZ, 2023 Census totals by topic for individuals ([SA1](https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/2023_Census_totals_by_topic_for_individuals_by_SA1/FeatureServer/1), [SA2](https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/2023_Census_totals_by_topic_for_individuals_by_SA2/FeatureServer/1)) | children by school age, the weights for school and early childhood figures (SA2: filling suppressed SA1 bands, and checking totals) | CC BY 4.0 | `raw/nz/census/statsnz_census2023_age_2026-11-12/` |
| 2018 Census: age by single year and sex by SA2 (Data8277) | Stats NZ, [large CSV](https://www3.stats.govt.nz/2018census/Age-sex-by-ethnic-group-grouped-total-responses-census-usually-resident-population-counts-2006-2013-2018-Censuses-RC-TA-SA2-DHB.zip) | the shape of single years inside the 10–14 and 15–19 bands; the share of girls of each school age in a place, for a girls' or a boys' school | CC BY 4.0 | `raw/nz/census/statsnz_census2018_age_sex_ethnic_sa2_2026-11-12/` |
| Statistical Area 2, 2018 boundaries | Stats NZ, [2018 Census SA2 layer](https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/2018_Census_usually_resident_population_and_age_groups_by_Statistical_Area_2/FeatureServer/0) | placing each 2023 SA1 in a 2018 SA2 for that shape | CC BY 4.0 | `raw/nz/census/statsnz_sa2_2018_2026-11-12.gpkg` |
| 2023 Census: households by SA1 | Stats NZ | households without a car; household income | CC BY 4.0 | `raw/auckland/census/statsnz_census_households_income_vehicle_sa1_2023.json` |
| 2023 Census: main means of travel to work by SA2 | Stats NZ | share of workers who drove to work | CC BY 4.0 | `processed/auckland/census/sa2_commute_car_share.csv` |
| Business demography, employee counts by SA2, 2024 | Stats NZ | jobs | CC BY 4.0 | `processed/auckland/grid/auckland_h3_r9_v2_opportunities.parquet` (column `dest_jobs`) |
| NZDep2023 | University of Otago, Wellington | neighbourhood deprivation | free to use with citation | carried in the SA1 boundary file |
| Local board boundaries, 2025 elections | Auckland Council | local board of each hexagon, for summaries | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `raw/auckland/geography/auckland_council_local_boards.geojson` |

## Prepared inputs

Three inputs are prepared from the sources above before TEAM runs:

- **Population grid** (`processed/auckland/grid/auckland_h3_r9_population.parquet`):
  H3 resolution 9 cells covering the council area, with 2023 Census usual
  residents spread from SA1 blocks by area, and each cell's centre.
- **Jobs grid** (`processed/auckland/grid/auckland_h3_r9_v2_opportunities.parquet`):
  the same cells with business demography employee counts spread from SA2s by
  area.
- **Single-year age shape** (`processed/nz/census/age_shape_sa2_2018.parquet`,
  `scripts/fetch_census_ages.py`): for every 2023 SA1 in the twenty places,
  the share of its 10–14 band at each age 10 to 14 and of its 15–19 band at
  ages 15, 16 and 17, from the 2018 single years of the 2018 SA2 its
  representative point falls in (the national shape where that band holds
  fewer than 30 people or a year is confidential).
- **Females by single year of age** (`processed/nz/census/sex_by_age_sa2_2018.parquet`,
  `scripts/fetch_census_ages.py --sex`, written 13 November 2026): females and
  all people at each age 0 to 19 by 2018 SA2, from Data8277 (Sex 2 and 9,
  Total ethnicity). A place's share of girls of each school age is summed over
  the 2018 SA2s its SA1s fall in (`ages.sex_shares`).

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
| Schools | Ministry of Education school directory | Authoritative, has rolls, updated nightly. Frozen as one dated national copy so all twenty places agree; before 0.12.0 each place had its own regional copy, and Auckland's had 10 of the fields. |
| Jobs | Stats NZ business demography, SA2 | SA2 is a confidentiality floor rather than a publishing choice, so nothing finer exists outside the Data Lab. |
| Tertiary and trades training | A hand-kept list of teaching sites (`raw/nz/education/tertiary_sites_<date>.csv`), from NZQA delivery sites and the providers' campus pages, placed on LINZ NZ Addresses points (`scripts/build_tertiary.py`) | No register lists where post-school study happens. The Ministry of Education's provider directory gives head offices, and OpenStreetMap misses main campuses (the University of Canterbury's Ilam campus lost its tag in March 2026). |

The health register is national and is cut to each city as it is built.

Attribution: Facility data from Health New Zealand | Te Whatu Ora, Facility
Code Table, CC BY 4.0. Tertiary teaching sites from NZQA (CC BY 4.0) and the
providers' own pages; address points from LINZ NZ Addresses, CC BY 4.0.

**Which tertiary sites count.** A site is in if scheduled teaching happens
there on premises the provider runs and students travel to it. Universities,
institutes of technology and polytechnics, and wānanga are covered, and private
training establishments at sites that teach trades. A site teaches trades if
it teaches any of building and construction (including carpentry and
joinery), automotive, engineering, welding or fabrication, electrical,
plumbing, cookery or baking, or hairdressing; land-based, business, health and
hospitality service teaching on their own do not count. Left out: head and
liaison offices, distance and work-based providers (the Open Polytechnic and the
former industry training organisations), apprenticeships and on-the-job
training, trades academies inside secondary schools, marae and other venues
used only for block courses, workplaces and clinical placements, halls of
residence and research stations, and English language schools. Trades
training is the subset of sites that teach trades, polytechnic campuses
included. A place with no such site, such as Whanganui, has no trades training
measure. The list dates quickly: polytechnics are being
reorganised through 2027, so each row carries its source and date.

### Known weaknesses

Jobs are the weakest layer. An SA2's employee count is spread over its
hexagons by area, and jobs cluster inside an area far more tightly than
residents do, so the job figures rank places rather than counting jobs in any
one hexagon.

Four Square stores are not counted as supermarkets. OpenStreetMap holds
fewer than half of them, so including them would bias the measure in exactly
the places TEAM exists to look at, and a small-format store is not a
substitute for a weekly shop either way.
