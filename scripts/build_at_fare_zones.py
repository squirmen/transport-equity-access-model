"""Build Auckland Transport's fare zones as spatial data.

Auckland Transport charges by the number of fare zones a journey passes
through, capped at four. It publishes the zones only as a PDF map, so this
script recovers them from that map.

The map is drawn as vector artwork over a geographic base, and it carries a
text layer of suburb labels. Both are usable:

1. Suburb labels are matched to 2023 Census SA2 names, giving several hundred
   candidate control points with known coordinates.
2. An affine transform from PDF points to New Zealand Transverse Mercator is
   fitted to those points with RANSAC, which rejects the Warkworth inset (drawn
   at a different scale) and the large zone-name labels.
3. Each zone's filled path is read off by its fill colour and put through the
   transform.

Every zone is drawn twice in the artwork: once in place, and once as a smaller
copy offset to the south east. The copy shares its exterior vertex count with
the original, so the larger of each matching pair is the one to keep.

Outputs, under the data root:

    raw/auckland/fares/at_fare_zones.geojson           the nine zones
    raw/auckland/fares/at_fare_zone_overlaps.geojson   the overlap bands
    raw/auckland/fares/at_fare_zones.metadata.json     provenance and checks
    processed/auckland/fares/sa2_fare_zone.csv         SA2 to zone lookup

Warkworth is drawn only in an inset at another scale, so it is not recovered
here and is assigned by SA2 name instead. It has no rapid transit and few
residents, and no journey from it is under the four-zone cap anyway.

Run:  python scripts/build_at_fare_zones.py --data-root <root>
"""

from __future__ import annotations

import argparse
import collections
import json
import logging
import re
from pathlib import Path

import numpy as np

log = logging.getLogger("fare_zones")

MAP_PDF = "raw/auckland/fares/bus-and-train-fare-zone-map-2025-pdf.pdf"
SA1 = "raw/auckland/census/statsnz_census_sa1_2023_auckland.geojson"

# Fill colours used for each zone in the 2025 map artwork.
ZONE_FILLS = {
    (0.986, 0.715, 0.435): "Isthmus",
    (0.957, 0.604, 0.759): "Northern Manukau",
    (0.932, 0.477, 0.42): "Southern Manukau",
    (0.704, 0.842, 0.502): "Waitakere",
    (0.203, 0.746, 0.937): "Lower North Shore",
    (0.182, 0.568, 0.812): "East Coast/South Rodney",
    (1.0, 0.894, 0.368): "City",
    (0.287, 0.752, 0.695): "Waiheke",
}
OVERLAP_FILL = (0.58, 0.624, 0.652)

# Zones reachable from each other without passing through a third. A fare is
# the number of zones a journey passes through, so this graph decides what a
# trip costs and is set out here rather than inferred. Two zones are joined
# when a service runs between them without entering a third: the Harbour
# Bridge lands in the City zone, so the Isthmus and the Lower North Shore are
# not joined, while the Upper Harbour Bridge does join Waitakere to the shore.
ADJACENCY = {
    "City": ["Isthmus", "Lower North Shore", "Waiheke"],
    "Isthmus": ["City", "Waitakere", "Northern Manukau"],
    "Waitakere": ["Isthmus", "East Coast/South Rodney", "Lower North Shore"],
    "Lower North Shore": ["City", "East Coast/South Rodney", "Waitakere"],
    "East Coast/South Rodney": ["Lower North Shore", "Waitakere", "Warkworth"],
    "Warkworth": ["East Coast/South Rodney"],
    "Northern Manukau": ["Isthmus", "Southern Manukau"],
    "Southern Manukau": ["Northern Manukau"],
    "Waiheke": ["City"],
}

# Warkworth is drawn only in the inset, so its SA2s are named rather than
# recovered from the artwork.
WARKWORTH_SA2 = [
    "Warkworth",
    "Warkworth East",
    "Warkworth West",
    "Snells Beach",
    "Sandspit",
    "Algies Bay",
    "Matakana",
]

# Checks run against the finished lookup. AT's own worked example is that
# Henderson to Britomart passes through Waitakere, Isthmus and City, and that
# Onehunga to Epsom stays inside Isthmus.
SPOT_CHECKS = {
    "Henderson North": "Waitakere",
    "Henderson Central": "Waitakere",
    "Auckland-University": "City",
    "Queen Street": "City",
    "Wynyard-Viaduct": "City",
    "Onehunga North": "Isthmus",
    "Epsom North": "Isthmus",
    "Takapuna Central": "Lower North Shore",
    "Devonport": "Lower North Shore",
    "Albany Central": "East Coast/South Rodney",
    "Browns Bay Central": "East Coast/South Rodney",
    "Papakura East": "Southern Manukau",
    "Pukekohe North West": "Southern Manukau",
    "New Lynn North": "Waitakere",
    "Waiheke East": "Waiheke",
}


def _normalise(name: str) -> str:
    table = str.maketrans("āōūīē", "aouie")
    return " ".join(name.lower().translate(table).split())


def read_labels(pdf: Path) -> list[dict]:
    """Place labels on the map, with their positions in PDF points."""
    import fitz

    page = fitz.open(pdf)[0]
    lines: dict[tuple, list] = collections.defaultdict(list)
    for x0, y0, x1, y1, word, block, line, no in page.get_text("words"):
        lines[(block, line)].append((no, x0, y0, x1, y1, word))
    labels = []
    for parts in lines.values():
        parts.sort()
        labels.append(
            {
                "text": " ".join(p[5] for p in parts),
                "x": sum((p[1] + p[3]) / 2 for p in parts) / len(parts),
                "y": sum((p[2] + p[4]) / 2 for p in parts) / len(parts),
            }
        )
    # A name set on two lines, such as Te Atatu / South, is one place.
    labels.sort(key=lambda label: (round(label["x"]), label["y"]))
    merged, used = [], [False] * len(labels)
    for i, first in enumerate(labels):
        if used[i]:
            continue
        group = [first]
        for j in range(i + 1, len(labels)):
            second = labels[j]
            if not used[j] and abs(second["x"] - first["x"]) < 12 and 0 < second["y"] - first["y"] < 7:
                group.append(second)
                used[j] = True
        merged.append(
            {
                "text": " ".join(part["text"] for part in group),
                "x": sum(part["x"] for part in group) / len(group),
                "y": sum(part["y"] for part in group) / len(group),
            }
        )
    return merged


def sa2_points(sa1_path: Path):
    """A representative point inside each SA2, in WGS84."""
    import geopandas as gpd

    blocks = gpd.read_file(sa1_path)
    areas = blocks.dissolve(by="SA22023_name")
    points = areas.geometry.representative_point().to_crs("EPSG:4326")
    return areas, {name: (point.x, point.y) for name, point in zip(areas.index, points)}


def control_points(labels: list[dict], centres: dict) -> list[tuple]:
    """Label positions paired with the coordinates of the place they name."""
    by_name = collections.defaultdict(list)
    for name, point in centres.items():
        by_name[_normalise(name)].append(point)
    pairs = []
    for label in labels:
        key = _normalise(label["text"])
        if key in by_name:
            points = by_name[key]
        else:
            # "Henderson" also matches "Henderson North" and "Henderson South".
            points = [p for k, v in by_name.items() if k.startswith(key + " ") for p in v]
            if not points or len(points) > 4:
                continue
        lon = sum(p[0] for p in points) / len(points)
        lat = sum(p[1] for p in points) / len(points)
        pairs.append((label["x"], label["y"], lon, lat, label["text"]))
    return pairs


def fit_transform(pairs: list[tuple], tolerance: float = 800.0, seed: int = 7):
    """An affine map from PDF points to NZTM metres, fitted with RANSAC.

    `tolerance` is how far a control point may sit from its predicted position
    and still count, in metres. Labels are placed near a suburb rather than on
    its centre, so a few hundred metres is expected; the inset is tens of
    kilometres out and is rejected.
    """
    import pyproj

    to_nztm = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    source = np.array([[p[0], p[1]] for p in pairs], dtype="float64")
    east, north = to_nztm.transform([p[2] for p in pairs], [p[3] for p in pairs])
    target = np.column_stack([east, north])

    def solve(rows):
        design = np.column_stack([source[rows, 0], source[rows, 1], np.ones(len(rows))])
        x, *_ = np.linalg.lstsq(design, target[rows, 0], rcond=None)
        y, *_ = np.linalg.lstsq(design, target[rows, 1], rcond=None)
        return x, y

    def residuals(x, y):
        design = np.column_stack([source[:, 0], source[:, 1], np.ones(len(source))])
        return np.linalg.norm(np.column_stack([design @ x, design @ y]) - target, axis=1)

    rng = np.random.default_rng(seed)
    best: tuple | None = None
    for _ in range(3000):
        rows = rng.choice(len(source), 4, replace=False)
        try:
            x, y = solve(rows)
        except np.linalg.LinAlgError:
            continue
        inliers = np.where(residuals(x, y) < tolerance)[0]
        if best is None or len(inliers) > len(best):
            best = inliers
    for _ in range(3):
        x, y = solve(best)
        best = np.where(residuals(x, y) < tolerance)[0]
    error = residuals(x, y)[best]
    report = {
        "control_points": len(source),
        "inliers": int(len(best)),
        "median_error_m": round(float(np.median(error)), 1),
        "p90_error_m": round(float(np.percentile(error, 90)), 1),
        "max_error_m": round(float(error.max()), 1),
    }
    return (x, y), report


def _flatten(item, samples: int = 8):
    """A drawing item as a list of points, curves sampled along their length."""
    kind = item[0]
    if kind == "l":
        return [(item[1].x, item[1].y), (item[2].x, item[2].y)]
    if kind == "c":
        p0, p1, p2, p3 = (np.array([p.x, p.y]) for p in item[1:5])
        t = np.linspace(0, 1, samples)[:, None]
        curve = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3
        return [tuple(point) for point in curve]
    if kind == "re":
        r = item[1]
        return [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
    if kind == "qu":
        q = item[1]
        return [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
    return []


def shapes_by_fill(pdf: Path, transform, wanted: dict | set):
    """Filled paths in the artwork, by fill colour, in WGS84."""
    import fitz
    import pyproj
    from shapely.geometry import Polygon

    (x, y) = transform
    to_wgs = pyproj.Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    page = fitz.open(pdf)[0]
    out = collections.defaultdict(list)
    for item in page.get_drawings():
        fill = item.get("fill")
        if not fill:
            continue
        colour = tuple(round(v, 3) for v in fill)
        if colour not in wanted:
            continue
        points = []
        for part in item["items"]:
            points += _flatten(part)
        if len(points) < 4:
            continue
        array = np.array(points)
        east = x[0] * array[:, 0] + x[1] * array[:, 1] + x[2]
        north = y[0] * array[:, 0] + y[1] * array[:, 1] + y[2]
        lon, lat = to_wgs.transform(east, north)
        polygon = Polygon(np.column_stack([lon, lat]))
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.is_empty or polygon.area <= 0:
            continue
        out[colour].append(polygon)
    return out


def drop_duplicate_copies(polygons: list):
    """Keep the placed artwork and drop the smaller copy of each shape.

    Every shape appears twice, the second a scaled copy offset to the south
    east. A copy has the same number of exterior vertices as its original, so
    shapes are grouped by that count and the larger of each group kept.
    """
    from shapely.geometry import MultiPolygon

    grouped = collections.defaultdict(list)
    for polygon in polygons:
        for part in getattr(polygon, "geoms", [polygon]):
            grouped[len(part.exterior.coords)].append(part)
    kept = [max(group, key=lambda p: p.area) for group in grouped.values()]
    kept = [p for p in kept if p.area > 1e-7]
    return MultiPolygon(kept)


def touching(zones, metres: float = 400.0) -> dict[str, list[str]]:
    """Which recovered zones lie within `metres` of each other.

    A cross-check on ADJACENCY, not a replacement for it: a buffer this wide
    steps over the Waitemata Harbour narrows and joins zones that no service
    connects directly.
    """
    projected = zones.to_crs(2193)
    grown = projected.buffer(metres)
    links: dict[str, set] = {name: set() for name in zones["zone"]}
    for i, name in enumerate(zones["zone"]):
        for j, other in enumerate(zones["zone"]):
            if i != j and grown.iloc[i].intersects(projected.geometry.iloc[j]):
                links[name].add(other)
    return {k: sorted(v) for k, v in links.items()}


def build(data_root: Path) -> dict:
    import geopandas as gpd
    from shapely.geometry import mapping

    pdf = data_root / MAP_PDF
    labels = read_labels(pdf)
    areas, centres = sa2_points(data_root / SA1)
    pairs = control_points(labels, centres)
    transform, report = fit_transform(pairs)
    log.info(
        "georeference: %d of %d control points, median error %.0f m",
        report["inliers"], report["control_points"], report["median_error_m"],
    )

    wanted = set(ZONE_FILLS) | {OVERLAP_FILL}
    found = shapes_by_fill(pdf, transform, wanted)

    zone_rows = []
    for colour, name in ZONE_FILLS.items():
        if colour not in found:
            log.warning("no artwork found for %s", name)
            continue
        zone_rows.append({"zone": name, "geometry": drop_duplicate_copies(found[colour])})
    zones = gpd.GeoDataFrame(zone_rows, crs="EPSG:4326")

    overlaps = gpd.GeoDataFrame(
        {"kind": ["overlap"]},
        geometry=[drop_duplicate_copies(found.get(OVERLAP_FILL, []))],
        crs="EPSG:4326",
    )

    # Which zones each overlap band joins.
    bands = []
    projected_zones = zones.to_crs(2193)
    for band in overlaps.geometry.iloc[0].geoms:
        near = gpd.GeoSeries([band], crs="EPSG:4326").to_crs(2193).buffer(300).iloc[0]
        joins = sorted(projected_zones.loc[projected_zones.intersects(near), "zone"])
        bands.append({"zones": joins, "geometry": band})
    overlap_bands = gpd.GeoDataFrame(
        {"zones": [", ".join(b["zones"]) for b in bands]},
        geometry=[b["geometry"] for b in bands],
        crs="EPSG:4326",
    )

    sa2 = areas[["geometry"]].to_crs(2193).reset_index()
    overlay = gpd.overlay(sa2, zones.to_crs(2193), how="intersection")
    overlay["covered"] = overlay.area
    winner = overlay.sort_values("covered").drop_duplicates("SA22023_name", keep="last")
    lookup = dict(zip(winner["SA22023_name"], winner["zone"]))
    for name in WARKWORTH_SA2:
        if name in set(sa2["SA22023_name"]):
            lookup[name] = "Warkworth"

    # An SA2 that meets an overlap band can be charged as either zone.
    in_overlap = gpd.overlay(sa2, overlap_bands.to_crs(2193), how="intersection")
    also = collections.defaultdict(set)
    for _, row in in_overlap.iterrows():
        for zone in row["zones"].split(", "):
            also[row["SA22023_name"]].add(zone)

    checks = {}
    for name, expected in SPOT_CHECKS.items():
        got = lookup.get(name)
        checks[name] = {"expected": expected, "got": got, "pass": got == expected}
    passed = sum(1 for c in checks.values() if c["pass"])
    log.info("spot checks: %d of %d pass", passed, len(checks))

    out_raw = data_root / "raw" / "auckland" / "fares"
    out_processed = data_root / "processed" / "auckland" / "fares"
    out_raw.mkdir(parents=True, exist_ok=True)
    out_processed.mkdir(parents=True, exist_ok=True)

    zones.to_file(out_raw / "at_fare_zones.geojson", driver="GeoJSON")
    overlap_bands.to_file(out_raw / "at_fare_zone_overlaps.geojson", driver="GeoJSON")

    import pandas as pd

    table = pd.DataFrame(
        {
            "sa2": sorted(lookup),
            "fare_zone": [lookup[name] for name in sorted(lookup)],
            "also_zones": ["; ".join(sorted(also.get(name, set()) - {lookup[name]})) for name in sorted(lookup)],
        }
    )
    table.to_csv(out_processed / "sa2_fare_zone.csv", index=False)

    nearby = touching(zones)
    only_nearby = sorted(
        f"{a}-{b}" for a, others in nearby.items() for b in others if b not in ADJACENCY.get(a, [])
    )
    metadata = {
        "source": "Auckland Transport, Bus & train fare zones map (2025)",
        "source_url": "https://at.govt.nz/media/3vqf3crs/bus-and-train-fare-zone-map-2025-pdf.pdf",
        "method": "Zone artwork read from the PDF and georeferenced against 2023 Census SA2 names.",
        "georeference": report,
        "zones": sorted(zones["zone"]),
        "zone_count_cap": 4,
        "adjacency": ADJACENCY,
        "adjacency_note": "Set from AT's map and its services, not inferred from the shapes.",
        "touching_but_not_joined": only_nearby,
        "overlap_bands": [b["zones"] for b in bands],
        "sa2_assigned": len(lookup),
        "sa2_total": int(len(sa2)),
        "spot_checks": checks,
        "caveats": [
            "Warkworth is drawn only in an inset at a different scale and is assigned by SA2 name.",
            "Boundaries are recovered from a printed map, so they are close to but not identical with AT's own.",
            "Overlap bands are recorded, and a journey should be charged the cheaper of the zones an overlap joins.",
        ],
    }
    (out_raw / "at_fare_zones.metadata.json").write_text(json.dumps(metadata, indent=2))
    return metadata


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    args = parser.parse_args()
    report = build(args.data_root.expanduser().resolve())
    print(json.dumps(report, indent=2)[:2000])


if __name__ == "__main__":
    main()
