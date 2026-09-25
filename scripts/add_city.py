"""Prepare the inputs TEAM needs for a city it has not run on before.

Auckland's inputs were assembled by hand over time. Everything they were made
from is national, so this collects the same set for any New Zealand city:

    sa1      census blocks with population, deprivation and area names
    grid     the H3 resolution 9 grid, with population spread onto it
    jobs     employee counts by small area, spread onto the same grid
    osm      the street and path network, clipped out of the national extract
    schools  the schools directory for the region

Each step writes into the data root beside Auckland's, under the city's own
name, and writes a metadata file next to what it produced.

    python scripts/add_city.py --data-root <root> --city wellington \\
        --tas "Wellington City" "Lower Hutt City" "Upper Hutt City" "Porirua City" \\
        --region "Wellington Region"

Steps are separate so a slow one can be rerun on its own:

    python scripts/add_city.py --data-root <root> --city wellington --only grid

How population reaches the grid: each census block is cut against the
hexagons it touches and its people are split between them by the share of the
block's area in each. That assumes people are spread evenly inside a block,
which is the same assumption Auckland's grid was built on.

Jobs are spread the same way from the employee count of the statistical area
around them. That is a weaker assumption than it is for population, because
jobs cluster far more tightly inside an area than residents do, and nothing
here knows where the industrial land is. It is good enough to rank places and
not good enough to count the jobs in one hexagon.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("add_city")

SA1_LAYER = "https://services.arcgis.com/XTtANUDT8Va4DLwI/ArcGIS/rest/services/2023_Census_by_SA1/FeatureServer/19"
SA1_FIELDS = (
    "OBJECTID,SA12023_code,LANDWATER,LANDWATER_NAME,SA22023_code,SA22023_name,SA32023_code,"
    "SA32023_name,UR2023_code,UR2023_name,REGC2023_code,REGC2023_name,TA2023_code,TA2023_name,"
    "NZDep2023,NZDep2023_Score,C23_URPopTot"
)
SCHOOLS_RESOURCE = "4b292323-9fcc-41f8-814b-3c7b19cf14b3"
SCHOOLS_API = "https://catalogue.data.govt.nz/api/3/action/datastore_search"
NATIONAL_OSM = "raw/supporting/new-zealand-latest.osm.pbf"
JOBS_SOURCE = "raw/auckland/jobs/statsnz_business_demography_sa2_2024.json"
RESOLUTION = 9
PAGE = 1000
STEPS = ("sa1", "grid", "jobs", "osm", "schools")


def _get(url: str, timeout: int = 180) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "TEAM/0.1 (Better Places Lab)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _write_metadata(path: Path, payload: dict) -> None:
    payload = {"downloaded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(), **payload}
    path.with_suffix(path.suffix + ".metadata.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def where_clause(tas: list[str]) -> str:
    quoted = ", ".join("'" + ta.replace("'", "''") + "'" for ta in tas)
    return f"TA2023_name IN ({quoted})"


def fetch_sa1(root: Path, city: str, tas: list[str]) -> Path:
    """Census blocks for these territorial authorities, with their geometry."""
    where = where_clause(tas)
    count = _get(f"{SA1_LAYER}/query?" + urllib.parse.urlencode({"where": where, "returnCountOnly": "true", "f": "json"}))
    total = int(count.get("count", 0))
    if not total:
        raise SystemExit(f"No census blocks matched {where}. Check the territorial authority names.")
    log.info("sa1: %d blocks for %s", total, ", ".join(tas))

    features: list[dict] = []
    offset = 0
    while offset < total:
        query = urllib.parse.urlencode(
            {
                "where": where,
                "outFields": SA1_FIELDS,
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "f": "geojson",
            }
        )
        page = _get(f"{SA1_LAYER}/query?{query}")
        got = page.get("features", [])
        if not got:
            break
        features.extend(got)
        offset += len(got)
        log.info("  %d/%d", len(features), total)
        time.sleep(0.2)

    out = root / "raw" / city / "census" / f"statsnz_census_sa1_2023_{city}.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    _write_metadata(
        out,
        {
            "attribution": "Stats NZ",
            "dataset_id": f"statsnz_census_sa1_2023_{city}",
            "license": "CC-BY-4.0",
            "source_url": SA1_LAYER,
            "where": where,
            "feature_count": len(features),
            "notes": "SA1 geometry with the 2023 usually resident population field C23_URPopTot and NZDep2023.",
        },
    )
    log.info("sa1: wrote %s (%d features)", out.name, len(features))
    return out


def build_grid(root: Path, city: str) -> Path:
    """The H3 grid for the city, with census population spread onto it."""
    import geopandas as gpd
    import h3
    import numpy as np
    import pandas as pd
    from shapely.geometry import Polygon

    blocks = gpd.read_file(root / "raw" / city / "census" / f"statsnz_census_sa1_2023_{city}.geojson")
    blocks = blocks[blocks.geometry.notna() & ~blocks.geometry.is_empty]
    if "LANDWATER_NAME" in blocks:
        blocks = blocks[~blocks["LANDWATER_NAME"].str.contains("water", case=False, na=False)]
    blocks["population"] = pd.to_numeric(blocks["C23_URPopTot"], errors="coerce").fillna(0.0)
    log.info("grid: %d land blocks, %d residents", len(blocks), round(blocks["population"].sum()))

    cells: set[str] = set()
    for geom in blocks.geometry:
        shape = geom.__geo_interface__
        try:
            cells.update(h3.geo_to_cells(shape, RESOLUTION))
        except Exception:  # a ring too small for the grid still needs its centre
            point = geom.representative_point()
            cells.add(h3.latlng_to_cell(point.y, point.x, RESOLUTION))
    cells = sorted(cells)
    log.info("grid: %d hexagons cover them", len(cells))

    hexes = gpd.GeoDataFrame(
        {"h3": list(cells)},
        geometry=[Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells],
        crs="EPSG:4326",
    )

    # Cut each block against the hexagons it touches, then give each piece the
    # share of the block's people that matches its share of the block's area.
    metric = "EPSG:2193"
    blocks = blocks.reset_index(names="block")
    pieces = gpd.overlay(
        blocks[["block", "population", "geometry"]].to_crs(metric),
        hexes.to_crs(metric),
        how="intersection",
    )
    pieces["piece_area"] = pieces.area
    block_area = pieces.groupby("block")["piece_area"].transform("sum")
    pieces["people"] = pieces["population"] * (pieces["piece_area"] / block_area.where(block_area > 0, 1.0))
    people = pieces.groupby("h3")["people"].sum()

    centres = np.array([h3.cell_to_latlng(c) for c in cells])
    grid = gpd.GeoDataFrame(
        {
            "h3": cells,
            "population": people.reindex(cells).fillna(0.0).to_numpy(),
            "centroid_lon": centres[:, 1],
            "centroid_lat": centres[:, 0],
        },
        geometry=hexes.geometry.to_numpy(),
        crs="EPSG:4326",
    )
    kept = float(grid["population"].sum())
    log.info("grid: %d residents placed of %d (%.2f%%)", round(kept), round(blocks["population"].sum()),
             100 * kept / max(blocks["population"].sum(), 1))

    out = root / "processed" / city / "grid" / f"{city}_h3_r{RESOLUTION}_population.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    grid.to_parquet(out)
    _write_metadata(out, {
        "dataset_id": f"{city}_h3_r{RESOLUTION}_population",
        "method": "Census block population split between hexagons by share of block area.",
        "cells": len(grid),
        "population": round(kept),
        "source": f"raw/{city}/census/statsnz_census_sa1_2023_{city}.geojson",
    })
    log.info("grid: wrote %s", out.name)
    return out


def build_jobs(root: Path, city: str) -> Path:
    """Employee counts by statistical area, spread onto the same grid."""
    import geopandas as gpd
    import pandas as pd

    grid = gpd.read_parquet(root / "processed" / city / "grid" / f"{city}_h3_r{RESOLUTION}_population.parquet")
    blocks = gpd.read_file(root / "raw" / city / "census" / f"statsnz_census_sa1_2023_{city}.geojson")
    raw = json.loads((root / JOBS_SOURCE).read_text(encoding="utf-8"))
    records = raw.get("records") or [f["attributes"] for f in raw.get("features", [])]
    jobs = pd.DataFrame(records)
    jobs["sa2"] = jobs["SA22023_V1_00"].astype(str)
    jobs["employees"] = pd.to_numeric(jobs["ec2024"], errors="coerce").fillna(0.0)

    areas = blocks.dissolve(by="SA22023_code")[["geometry"]].reset_index()
    areas["sa2"] = areas["SA22023_code"].astype(str)
    areas = areas.merge(jobs[["sa2", "employees"]], on="sa2", how="left")
    areas["employees"] = areas["employees"].fillna(0.0)
    log.info("jobs: %d statistical areas, %d employees", len(areas), round(areas["employees"].sum()))

    metric = "EPSG:2193"
    pieces = gpd.overlay(areas[["sa2", "employees", "geometry"]].to_crs(metric),
                         grid[["h3", "geometry"]].to_crs(metric), how="intersection")
    pieces["piece_area"] = pieces.area
    total = pieces.groupby("sa2")["piece_area"].transform("sum")
    pieces["jobs"] = pieces["employees"] * (pieces["piece_area"] / total.where(total > 0, 1.0))
    per_cell = pieces.groupby("h3")["jobs"].sum()

    out_grid = grid.copy()
    out_grid["dest_jobs"] = per_cell.reindex(out_grid["h3"]).fillna(0.0).to_numpy()
    out = root / "processed" / city / "grid" / f"{city}_h3_r{RESOLUTION}_v2_opportunities.parquet"
    out_grid.to_parquet(out)
    _write_metadata(out, {
        "dataset_id": f"{city}_h3_r{RESOLUTION}_v2_opportunities",
        "attribution": "Stats NZ business demography 2024",
        "method": "SA2 employee count split between hexagons by share of area. Jobs cluster inside an "
                  "area far more than residents do, so this ranks places rather than counting jobs in one hexagon.",
        "employees": round(float(out_grid["dest_jobs"].sum())),
        "source": JOBS_SOURCE,
    })
    log.info("jobs: wrote %s (%d employees placed)", out.name, round(float(out_grid["dest_jobs"].sum())))
    return out


def clip_osm(root: Path, city: str, margin: float = 0.05) -> Path:
    """The national street network cut down to the city, with a margin."""
    import geopandas as gpd

    source = root / NATIONAL_OSM
    if not source.exists():
        raise SystemExit(f"No national extract at {source}.")
    blocks = gpd.read_file(root / "raw" / city / "census" / f"statsnz_census_sa1_2023_{city}.geojson")
    west, south, east, north = blocks.total_bounds
    box = f"{west - margin},{south - margin},{east + margin},{north + margin}"
    out = root / "raw" / city / "osm" / f"{city}_bbox.osm.pbf"
    out.parent.mkdir(parents=True, exist_ok=True)
    log.info("osm: clipping %s to %s", source.name, box)
    subprocess.run(
        ["osmium", "extract", "--bbox", box, "--overwrite", "--set-bounds", "-o", str(out), str(source)],
        check=True,
    )
    _write_metadata(out, {
        "attribution": "OpenStreetMap contributors, Open Database Licence",
        "dataset_id": f"{city}_bbox_osm",
        "source": str(source),
        "bbox": box,
        "margin_degrees": margin,
        "tool": "osmium extract",
    })
    log.info("osm: wrote %s (%.0f MB)", out.name, out.stat().st_size / 1e6)
    return out


def fetch_schools(root: Path, city: str, region: str) -> Path:
    """The schools directory for the region, with rolls and coordinates."""
    rows: list[dict] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode({
            "resource_id": SCHOOLS_RESOURCE,
            "filters": json.dumps({"Regional_Council": region}),
            "limit": PAGE,
            "offset": offset,
        })
        page = _get(f"{SCHOOLS_API}?{query}")
        got = page.get("result", {}).get("records", [])
        if not got:
            break
        rows.extend(got)
        offset += len(got)
        if len(got) < PAGE:
            break
    if not rows:
        raise SystemExit(f"No schools found for Regional_Council = {region!r}.")
    out = root / "raw" / city / "education" / f"educationcounts_schools_{city}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"records": rows}), encoding="utf-8")
    _write_metadata(out, {
        "attribution": "Ministry of Education / Education Counts",
        "dataset_id": f"educationcounts_schools_{city}",
        "license": "CC-BY-4.0",
        "resource_id": SCHOOLS_RESOURCE,
        "where": f'"Regional_Council" = {region!r}',
        "record_count": len(rows),
    })
    log.info("schools: wrote %s (%d schools)", out.name, len(rows))
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--city", required=True, help="short name, used in paths")
    parser.add_argument("--tas", nargs="+", help="territorial authority names, as Stats NZ spells them")
    parser.add_argument("--region", help="regional council name, for the schools directory")
    parser.add_argument("--only", choices=STEPS, help="run one step")
    args = parser.parse_args()
    root = args.data_root.expanduser().resolve()
    steps = [args.only] if args.only else list(STEPS)

    if "sa1" in steps:
        if not args.tas:
            raise SystemExit("--tas is needed to fetch census blocks.")
        fetch_sa1(root, args.city, args.tas)
    if "grid" in steps:
        build_grid(root, args.city)
    if "jobs" in steps:
        build_jobs(root, args.city)
    if "osm" in steps:
        clip_osm(root, args.city)
    if "schools" in steps:
        if not args.region:
            raise SystemExit("--region is needed to fetch the schools directory.")
        fetch_schools(root, args.city, args.region)


if __name__ == "__main__":
    main()
