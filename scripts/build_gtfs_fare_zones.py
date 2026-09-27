"""Fare zones from the zone ids in a timetable feed, for ring-zone networks.

Most regional networks outside the big three charge by concentric rings:
Napier is one zone and Hastings the next, or Nelson-Richmond one, the Waimea
towns the next and Motueka the third. Their feeds put the ring on each stop in
`stops.zone_id`, so the zones can be built the way Wellington's are: each
hexagon takes the zone of its nearest stop, and hexagons are dissolved into one
polygon per zone.

Rings touch only their neighbours, so zone N is next to N-1 and N+1 and to
nothing else. That is set from the numbers rather than from the polygons,
because the towns in neighbouring rings rarely share a populated edge.

A stop on a boundary is written with two zones, such as `00_1/2A`, and counts
as the cheaper one, which is how a boundary works for the person paying.

    python scripts/build_gtfs_fare_zones.py --data-root <root> --city napier_hastings \\
        --gtfs raw/napier_hastings/gtfs/gobay_gtfs_2026-09-26.zip --name gobay
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import re
import zipfile
from pathlib import Path

log = logging.getLogger("gtfs_zones")

MAX_STOP_METRES = 3000.0


def ring(zone_id: str) -> int | None:
    """The ring number in a zone id: the last run of digits, cheapest part first."""
    numbers = []
    for part in str(zone_id).split("/"):
        runs = re.findall(r"\d+", part)
        if runs:
            numbers.append(int(runs[-1]))
    return min(numbers) if numbers else None


def read_stops(path: Path):
    import pandas as pd

    with zipfile.ZipFile(path) as feed:
        text = feed.read("stops.txt").decode("utf-8-sig")
    frame = pd.DataFrame(list(csv.DictReader(io.StringIO(text))))
    frame["lat"] = pd.to_numeric(frame["stop_lat"], errors="coerce")
    frame["lon"] = pd.to_numeric(frame["stop_lon"], errors="coerce")
    frame["zone"] = frame.get("zone_id", "").map(ring)
    return frame.dropna(subset=["lat", "lon", "zone"])


def build(root: Path, city: str, gtfs: str, name: str) -> dict:
    import geopandas as gpd

    stops = read_stops(root / gtfs)
    log.info("stops with a fare zone: %d across rings %s", len(stops), sorted(stops["zone"].astype(int).unique()))
    grid = gpd.read_parquet(root / "processed" / city / "grid" / f"{city}_h3_r9_population.parquet")
    metric = "EPSG:2193"
    cells = gpd.GeoDataFrame(
        {"h3": grid["h3"].to_numpy()},
        geometry=gpd.points_from_xy(grid["centroid_lon"], grid["centroid_lat"]),
        crs="EPSG:4326",
    ).to_crs(metric)
    points = gpd.GeoDataFrame(
        {"zone": stops["zone"].astype(int).to_numpy()},
        geometry=gpd.points_from_xy(stops["lon"], stops["lat"]),
        crs="EPSG:4326",
    ).to_crs(metric)
    near = gpd.sjoin_nearest(cells, points, how="left", max_distance=MAX_STOP_METRES).drop_duplicates("h3")
    zone_of = near.set_index("h3")["zone"].reindex(grid["h3"])
    shapes = gpd.GeoDataFrame({"zone": zone_of.to_numpy()}, geometry=grid.geometry.to_numpy(), crs="EPSG:4326")
    shapes = shapes[shapes["zone"].notna()]
    shapes["zone"] = shapes["zone"].astype(int).map(lambda z: f"Zone {z}")
    zones = shapes.dissolve(by="zone")[["geometry"]].reset_index()
    names = sorted(zones["zone"], key=lambda z: int(z.split()[-1]))
    number = {z: int(z.split()[-1]) for z in names}
    adjacency = {z: [o for o in names if abs(number[o] - number[z]) == 1] for z in names}
    log.info("zones %s, %d of %d hexagons within %.0f m of a stop", names, len(shapes), len(grid), MAX_STOP_METRES)

    out = root / "raw" / city / "fares"
    out.mkdir(parents=True, exist_ok=True)
    zones.to_file(out / f"{name}_fare_zones.geojson", driver="GeoJSON")
    counts = shapes["zone"].value_counts().to_dict()
    meta = {
        "source": f"{gtfs}, stops.zone_id",
        "method": "Each hexagon takes the ring of its nearest stop; hexagons are dissolved by ring. "
                  "Rings are next to the rings either side of them.",
        "zones": names,
        "adjacency": adjacency,
        "hexagons_per_zone": {k: int(v) for k, v in sorted(counts.items())},
        "max_stop_metres": MAX_STOP_METRES,
        "caveats": [
            "A boundary stop carries two zones in the feed; the cheaper one is used.",
            "A hexagon further than 3 km from any stop has no zone, which is right where there is no service to pay for.",
        ],
    }
    (out / f"{name}_fare_zones.metadata.json").write_text(json.dumps(meta, indent=2))
    return meta


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--city", required=True)
    parser.add_argument("--gtfs", required=True, help="feed path relative to the data root")
    parser.add_argument("--name", required=True, help="file name prefix, usually the network's name")
    args = parser.parse_args()
    meta = build(args.data_root.expanduser().resolve(), args.city, args.gtfs, args.name)
    print(json.dumps({k: meta[k] for k in ("zones", "adjacency", "hexagons_per_zone")}, indent=2))


if __name__ == "__main__":
    main()
