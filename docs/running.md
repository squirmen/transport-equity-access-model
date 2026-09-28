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

To time a run before committing to it, route the first few origins:

```sh
team --data-root DATA route services pt --window interpeak --limit 500
```

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

## What a build writes

```text
<data root>/team/
  destinations/          services.parquet, jobs.parquet, services_summary.json
  routing/               one parquet per run, with a JSON manifest
  routing/batches/       the per-batch files behind each run
  team_cells.parquet     every measure for every hexagon
  site/                  upload-ready web app
    index.html, css/, js/, assets/
    data/                cells.json, cells_more.json, summary.json, places.json,
                         destinations.json, overlays.json, chains.json, chains/
    downloads/           team_auckland_h3.gpkg, .csv, fields.csv, SHA256SUMS.txt
```

## Publishing

Gather the places into one site, each in its own folder, with the index the
opening view reads:

```sh
python scripts/build_national_site.py --out SITE --city DATA/team DATA/team-wellington ...
```

Copy the contents of `SITE` to a static web host, together with
[`web/.htaccess`](../web/.htaccess) on Apache hosts. The app needs no server
code. It loads MapLibre GL and h3-js from unpkg and basemap tiles from Esri and
OpenStreetMap.

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
