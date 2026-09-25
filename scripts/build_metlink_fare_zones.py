"""Turn Metlink's stop fare zones into the zone layer TEAM needs.

Auckland publishes no fare zone geometry, so `build_at_fare_zones.py` has to
recover it from a printed map. Wellington is easier: Metlink puts the fare
zone of every stop in its GTFS, so the zones can be built from the feed.

A hexagon takes the zone of the stop nearest to it, which is the zone a
traveller starting there would board in. Hexagons are then dissolved by zone
to give one polygon per zone, in the same shape as the Auckland layer, so the
rest of TEAM does not need to know the difference.

Stops on a boundary carry two zones, written `1/2` or `4/5`. Those take the
cheaper of the two, which is how a boundary is meant to work for the person
paying.

Zones that touch are worked out from the finished polygons, because Metlink
counts the zones a journey passes through and a journey between two zones
that do not touch has to cross whatever lies between.

    python scripts/build_metlink_fare_zones.py --data-root <root>
"""

from __future__ import annotations

import argparse
import collections
import json
import logging
import zipfile
from pathlib import Path

log = logging.getLogger("metlink_zones")

GTFS = "raw/wellington/gtfs/metlink_gtfs_2026-09-26.zip"
GRID = "processed/wellington/grid/wellington_h3_r9_population.parquet"
OUT_DIR = "processed/wellington/fares"
MAX_STOP_METRES = 3000.0


def read_stops(path: Path):
    """Stop positions and fare zones from the feed."""
    import csv
    import io

    import pandas as pd

    with zipfile.ZipFile(path) as feed:
        text = feed.read("stops.txt").decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    frame = pd.DataFrame(rows)
    frame["lat"] = pd.to_numeric(frame["stop_lat"], errors="coerce")
    frame["lon"] = pd.to_numeric(frame["stop_lon"], errors="coerce")
    frame = frame.dropna(subset=["lat", "lon"])
    frame["zone"] = frame["zone_id"].astype(str).str.strip()
    frame = frame[frame["zone"].ne("") & frame["zone"].ne("nan")]
    # A boundary stop is written as two zones; the cheaper one is the lower.
    frame["zone"] = frame["zone"].map(lambda z: min(z.split("/"), key=lambda part: int(part)) if "/" in z else z)
    frame["zone"] = frame["zone"].astype(int)
    return frame


def build(root: Path) -> dict:
    import geopandas as gpd
    from shapely.geometry import mapping

    stops = read_stops(root / GTFS)
    log.info("stops with a fare zone: %d across %d zones", len(stops), stops["zone"].nunique())

    grid = gpd.read_parquet(root / GRID)
    metric = "EPSG:2193"
    cells = gpd.GeoDataFrame(
        {"h3": grid["h3"].to_numpy()},
        geometry=gpd.points_from_xy(grid["centroid_lon"], grid["centroid_lat"]),
        crs="EPSG:4326",
    ).to_crs(metric)
    points = gpd.GeoDataFrame(
        {"zone": stops["zone"].to_numpy()},
        geometry=gpd.points_from_xy(stops["lon"], stops["lat"]),
        crs="EPSG:4326",
    ).to_crs(metric)

    near = gpd.sjoin_nearest(cells, points, how="left", max_distance=MAX_STOP_METRES, distance_col="metres")
    near = near.drop_duplicates("h3")
    zoned = near["zone"].notna().sum()
    log.info("hexagons within %.0f m of a stop: %d of %d", MAX_STOP_METRES, zoned, len(cells))

    shapes = gpd.GeoDataFrame(
        {"h3": grid["h3"].to_numpy(), "zone": near.set_index("h3")["zone"].reindex(grid["h3"]).to_numpy()},
        geometry=gpd.GeoSeries.from_wkb(grid["geometry"]) if grid["geometry"].dtype == object else grid.geometry,
        crs="EPSG:4326",
    )
    shapes = shapes[shapes["zone"].notna()]
    shapes["zone"] = shapes["zone"].astype(int).map(lambda z: f"Zone {z}")
    zones = shapes.dissolve(by="zone")[["geometry"]].reset_index()
    log.info("built %d zone polygons", len(zones))

    projected = zones.to_crs(metric)
    grown = projected.buffer(150)
    adjacency: dict[str, list[str]] = {}
    for i, name in enumerate(zones["zone"]):
        touching = [
            other
            for j, other in enumerate(zones["zone"])
            if i != j and grown.iloc[i].intersects(projected.geometry.iloc[j])
        ]
        adjacency[name] = sorted(touching)
    lonely = [z for z, v in adjacency.items() if not v]
    if lonely:
        log.warning("zones touching nothing: %s", ", ".join(lonely))

    out = root / OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    zones.to_file(out / "metlink_fare_zones.geojson", driver="GeoJSON")
    counts = collections.Counter(shapes["zone"])
    meta = {
        "source": "Metlink GTFS, stops.zone_id",
        "source_url": "https://static.opendata.metlink.org.nz/v1/gtfs/full.zip",
        "method": "Each hexagon takes the fare zone of its nearest stop, then hexagons are dissolved by zone.",
        "zones": sorted(zones["zone"]),
        "zone_count_cap": 14,
        "adjacency": adjacency,
        "hexagons_per_zone": {k: int(v) for k, v in sorted(counts.items())},
        "max_stop_metres": MAX_STOP_METRES,
        "caveats": [
            "A boundary stop carries two zones in the feed; the cheaper one is used.",
            "A hexagon further than 3 km from any stop has no zone, which is right where there is no service to pay for.",
            "Zones come from where stops are, so a zone edge follows the network rather than Metlink's own boundary line.",
        ],
    }
    (out / "metlink_fare_zones.metadata.json").write_text(json.dumps(meta, indent=2))
    log.info("wrote %s", out / "metlink_fare_zones.geojson")
    return meta


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    args = parser.parse_args()
    meta = build(args.data_root.expanduser().resolve())
    print(json.dumps({k: meta[k] for k in ("zones", "hexagons_per_zone")}, indent=2)[:900])


if __name__ == "__main__":
    main()
