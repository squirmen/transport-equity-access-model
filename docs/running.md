# Running a build

## Requirements

- Python 3.10 or later with the packages in `pyproject.toml`
  (`pip install -e ".[routing,test]"`).
- Java 21 for R5. Set `routing.java_home` in the configuration, or `JAVA_HOME`.
- [osmium](https://osmcode.org/osmium-tool/) for filtering OpenStreetMap.
- Node 20 or later, only for the web tests.

A full build routes about 30,000 origins to around 3,000 service locations and
3,000 job cells by five modes. The walking, cycling and car runs take minutes
each; the public transport runs take hours. Every run is split into batches
written as they finish, so a stopped run resumes where it left off.

## Data root

Inputs live outside the repository, in a folder you pass with `--data-root`
(or the `TEAM_DATA_ROOT` environment variable). The paths TEAM expects are
listed under `data:` in [`configs/auckland.yml`](../configs/auckland.yml) and
described in [`data-sources.md`](data-sources.md).

Outputs go to `<data root>/team/` unless you pass `--out`. Large intermediate
files (the filtered OpenStreetMap services and the job travel-time pairs) go
to `~/.cache/team/`, or `--cache`.

## Steps

```sh
team --data-root DATA destinations    # service and job destination sets
team --data-root DATA plan            # list routing runs and which are done
team --data-root DATA route --all     # every routing run, cheapest first
team --data-root DATA build           # measures, summaries, web data, downloads
```

To time a run before committing to it, route the first few origins:

```sh
team --data-root DATA route services pt --window interpeak --limit 500
```

## What a build writes

```text
<data root>/team/
  destinations/          services.parquet, jobs.parquet, services_summary.json
  routing/               one parquet per run, with a JSON manifest
  routing/batches/       the per-batch files behind each run
  team_cells.parquet     every measure for every hexagon
  site/                  upload-ready web app
    index.html, css/, js/, assets/
    data/                cells.json, summary.json, places.json, destinations.json, overlays.json
    downloads/           team_auckland_h3.gpkg, .csv, fields.csv, SHA256SUMS.txt
```

## Publishing

Copy the contents of `site/` to a static web host, together with
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
