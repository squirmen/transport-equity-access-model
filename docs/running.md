# Running a build

## Requirements

- Python 3.10 or later with the packages in `pyproject.toml`
  (`pip install -e ".[routing,test]"`).
- Java 21 for R5. Set `routing.java_home` in the configuration, or `JAVA_HOME`.
- [osmium](https://osmcode.org/osmium-tool/) for filtering OpenStreetMap.
- Node 20 or later, only for the web tests.

Auckland, the largest place, routes about 30,000 origins to around 3,500
service locations and 7,000 job cells by five modes. In a single process the
walking and cycling runs take minutes each, and the car and public transport
runs take hours. A small town takes minutes in all. Every run
is split into batches written as they finish, so a stopped run resumes where
it left off.

## Data root

Inputs live outside the repository, in a folder you pass with `--data-root`
(or the `TEAM_DATA_ROOT` environment variable). Each place has a
configuration in [`configs/`](../configs/); the paths it expects are listed
under `data:` and described in [`data-sources.md`](data-sources.md). Auckland's
configuration is the default; name another with `--config`.

Outputs go to `<data root>/team/` unless you pass `--out`; give each place its
own, such as `<data root>/team-wellington/`. Large intermediate
files (the filtered OpenStreetMap services and the job travel-time pairs) go
to `~/.cache/team/`, or `--cache`.

## Adding a place

Everything a place needs is national, and `scripts/` collects it:

```sh
# census blocks, the hexagon grid, jobs, streets and schools
python scripts/add_city.py --data-root DATA --city wellington \
    --fua Wellington "Kapiti Coast" Ōtaki Masterton --region "Wellington Region"
# heights for walking and cycling on slopes, from LINZ (no key needed)
python scripts/build_dem.py --data-root DATA --city wellington
# fare zones: Metlink's own zone map, or elsewhere a feed's zone ids
python scripts/build_metlink_fare_zones.py --help
python scripts/build_gtfs_fare_zones.py --help
```

Then copy a configuration of a similar place, point its `data:` paths at the
new files and give it the network's timetable feed and fares. Where a council
publishes no feed, `build_rideguide_gtfs.py` and `build_blenheim_gtfs.py` show
two ways of making one. `span_lts.py` writes SPAN's traffic stress ratings onto
Auckland's streets for cycling.

## Steps

```sh
team --config CONFIG --data-root DATA --out OUT destinations    # service and job destination sets
team --config CONFIG --data-root DATA --out OUT plan            # list routing runs and which are done
team --config CONFIG --data-root DATA --out OUT route --all     # every routing run, cheapest first
team --config CONFIG --data-root DATA --out OUT build           # measures, summaries, web data, downloads
```

A routing run records the street network and elevation model it was made
with, and is routed again if either changes.

### Schools

Schools come from one dated copy of the Ministry's directory and are routed
in runs of their own (`schools_<mode>`), so a new directory re-routes schools
only. [`schools.md`](schools.md) has the rules.

```sh
python scripts/fetch_school_directory.py --data-root DATA     # a new dated copy; point data.schools at it
team --config CONFIG --data-root DATA --out OUT schools check  # what each school service counts
team --config CONFIG --data-root DATA --out OUT destinations --only schools
team --config CONFIG --data-root DATA --out OUT route --all    # routes the schools_* runs that are out of date
python scripts/check_school_runs.py --config CONFIG --data-root DATA --out OUT
```

A build from before 0.12.0 routed schools inside the services runs. `team
schools split` moves it over without routing anything else again: it takes
the schools out of `services.parquet` (keeping the old file as
`services_with_schools.parquet`) and marks each services run that was routed
against the old file as still current. `check_school_runs.py` then confirms
the school runs give the same minutes as the services runs did, school by
school, for every school whose point did not move.

For Auckland the school runs took about 15 minutes for walking, cycling and
public transport and about an hour for the car, in three processes. Shards of
one place must not start together on a network r5py has not cached yet: they
write the same cache file and fail. Route one shard first, or one process a
place.

Review sheets for school map points and entrances, for a person to check:

```sh
python scripts/school_points_review.py --config CONFIG --data-root DATA --out OUT \
    --facilities nz_facilities.gpkg --gates gates.parquet --to REVIEW_DIR
```

To time a run before committing to it, route the first few origins:

```sh
team --data-root DATA route services pt --window interpeak --limit 500
```

### Enrolment zones and school-age children

In zone needs the Ministry's zone file (`data.zones`) and LINZ address points
for the place (`data.addresses`); school-age weights need the 2023 census age
bands and the 2018 single-year shape (`data.census_ages`,
`data.census_ages_sa2`, `data.census_age_shape`). A build without them still
runs: it leaves In zone out and counts all residents. Neither needs routing
again. [`schools.md`](schools.md) has the rules.

```sh
python scripts/fetch_address_points.py --data-root DATA [--city auckland ...]  # LINZ address points, no key
python scripts/fetch_census_ages.py --data-root DATA      # 2018 SA2 polygons and the single-year shape
team --config CONFIG --data-root DATA --out OUT zones check   # zone statuses and the schools to look at
team --config CONFIG --data-root DATA --out OUT ages check    # children by group against Stats NZ's totals
python scripts/check_zones_eagle.py --zones ZONE_ZIP --scratch SCRATCH_DIR   # a check only; writes to scratch
```

`fetch_census_ages.py --ade FILE` makes the shape from the 2023 single years
by SA2 instead, from a table downloaded by hand from Aotearoa Data Explorer
(`CEN23_POP_001`); point `census_age_shape` at the file it writes.

The school and early childhood figures on the page count children of the
service's ages from `cells.json`'s `ages`. `summary.json`'s `services` and
`areas` tables are still worked out over all residents; the page does not
read them for school services.

### Splitting a run across processes

r5py routes one origin at a time within a process, so long runs go faster
split across several processes. `--shard I/N` makes a process take every Nth
batch. Sharded processes only write batches; a final run without `--shard`
combines them.

```sh
export TEAM_MAX_MEMORY=6G    # each process loads its own copy of the network
team --data-root DATA route --all --shard 1/3 &
team --data-root DATA route --all --shard 2/3 &
team --data-root DATA route --all --shard 3/3 &
wait
team --data-root DATA route --all
```

`TEAM_MAX_MEMORY` overrides `routing.max_memory` in the configuration. Each
process needed about 3 GB for Auckland.

### Cell to cell pairs

A place with a `pairs:` block (only Auckland so far) can also keep every pair
of cells within reach, with the stops and routes behind each public transport
time. MATE uses them for walks to and from stops, and for trips between two
cells. Run them after `team build`, since they use its cell list and urban
flag. [`pairs.md`](pairs.md) describes the files.

```sh
pip install -e ".[pairs]"       # exactly r5py 1.1.3, which loads R5 v7.5-r5py
export TEAM_MAX_MEMORY=5G
team --data-root DATA pairs route --shard 1/3 &
team --data-root DATA pairs route --shard 2/3 &
team --data-root DATA pairs route --shard 3/3 &
wait
team --data-root DATA pairs route                            # combine the batches
team --data-root DATA pairs write --site SITE/data/auckland  # tiles for the web app
team --data-root DATA pairs check                            # 10 paths against r5py and the timetable
```

For Auckland this took about an hour in three processes. `team overlays --to
SITE/data/auckland` writes only the map overlays and the stop and line names
(`transit.json`), without rebuilding the rest of the site.

## What a build writes

```text
<data root>/team/
  destinations/          services.parquet, jobs.parquet, services_summary.json,
                         schools.parquet (routing points), school_list.parquet,
                         schools_summary.json
  routing/               one parquet per run, with a JSON manifest
  routing/batches/       the per-batch files behind each run
  ages/ages_summary.json children by group: totals and the checks against Stats NZ
  zones/                 hexagon_zones.parquet, school_zones.parquet (read by the downloads)
  team_cells.parquet     every measure for every hexagon
  site/                  upload-ready web app
    index.html, css/, js/, assets/
    data/                cells.json, cells_more.json, summary.json, places.json,
                         destinations.json, overlays.json, transit.json,
                         chains.json, chains/, schools/ (with zones.json and
                         zone_outlines_<service>.json)
    downloads/           team_auckland_h3.gpkg, .csv, team_auckland_schools.csv,
                         team_auckland_school_zones.csv, fields.csv, SHA256SUMS.txt
```

## Publishing

Gather the places into one site, each in its own folder, with the index the
opening view reads:

```sh
python scripts/build_national_site.py --out SITE --city DATA/team DATA/team-wellington ...
```

Copy the contents of `SITE` to a static web host, together with
[`web/.htaccess`](../web/.htaccess) on Apache hosts.

Some files in Auckland's folder are for the MATE preview and for trips, both
behind `?mate=1`. Before an upload:

- `data/auckland/pairs/` (about 370 MB, 2,574 files) holds the trips between
  two hexagons. Only a trip planned with `?mate=1` loads it: `index.json`,
  then the tiles it lists, one at a time as they are needed. Upload
  `index.json` and the tiles it lists, each with its `.br` and `.gz`.
- `data/auckland/transit.json` names a trip's stops and draws its ride along
  the line; it too is loaded only for a trip.
- `data/auckland/mate/` is MATE's, built by MATE's `scripts/team_export.py`.
  Only `?mate=1` loads it: `cells_mate`, `times`, `reach/`, `stops/` and
  `graph/`, with a link to `profiles.html`. TEAM's page does not load
  `stops.json`. Upload it only together with MATE's own map rebuilt from the
  same build (MATE's `docs/team_export.md`), so the two agree on the same
  footpaths.
- Leave out the backups beside the files: `mate_before_*`,
  `mate_before_pt_*` and anything ending in `.before-*`.

The app needs no server code. It loads MapLibre GL and h3-js from unpkg and
basemap tiles from Esri and OpenStreetMap.

## Checking the web app without a build

`tests/fixtures/make_web_fixture.py` writes a small synthetic dataset. Serve
the repository and open the app against it:

```sh
python tests/fixtures/make_web_fixture.py
python -m http.server 8812
# http://localhost:8812/web/?data=../tests/fixtures/web/
python tests/web/snapshots.py --url "http://localhost:8812/web/?data=../tests/fixtures/web/"
```

The synthetic values are for testing only.
