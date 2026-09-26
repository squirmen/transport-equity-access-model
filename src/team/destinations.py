"""Destination sets for routing.

Supermarkets come from OpenStreetMap, which carries about 98% of New Zealand's
full-service supermarket banners. GPs and pharmacies come from Health New
Zealand's facility register instead, because OpenStreetMap is measurably
incomplete for them: in Auckland it holds 276 pharmacies against the
register's 440. It also cannot tell an enrolling GP practice from a
specialist's rooms, which is a different thing to measure access to.

Schools come from the Ministry of Education school directory. Jobs come from Stats NZ
business demography employee counts, already spread over the hexagon grid,
and are summed to coarser hexagons so public transport routing stays
tractable.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

OTHER_TAG_RE = re.compile(r'"([^"]+)"=>"([^"]*)"')
DUPLICATE_METRES = 40.0


def _row_tags(row: pd.Series, columns: list[str]) -> dict[str, str]:
    tags = dict(OTHER_TAG_RE.findall(row.get("other_tags") or "")) if isinstance(row.get("other_tags"), str) else {}
    for column in columns:
        value = row.get(column)
        if isinstance(value, str) and value:
            tags[column] = value
    return tags


def _match_service(tags: dict[str, str], rules: dict[str, dict[str, list[str]]]) -> str | None:
    for service, tag_rules in rules.items():
        for key, values in tag_rules.items():
            if tags.get(key) in values:
                # A clinic tagged with a non-GP specialty (physio, dental) is not a GP.
                if service == "gp" and key == "amenity" and tags.get(key) == "clinic":
                    specialty = tags.get("healthcare")
                    if specialty and specialty not in tag_rules.get("healthcare", []):
                        continue
                return service
    return None


def _drop_near_duplicates(points: pd.DataFrame, metres: float = DUPLICATE_METRES) -> pd.DataFrame:
    """Keep one point where the same service is mapped twice (node and building)."""
    from scipy.spatial import cKDTree

    keep = []
    for _, group in points.groupby("service"):
        group = group.sort_values("name", na_position="last")
        xy = np.column_stack([group["x"].to_numpy(), group["y"].to_numpy()])
        parent = list(range(len(group)))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for i, j in cKDTree(xy).query_pairs(metres):
            parent[find(j)] = find(i)
        roots = {find(i) for i in range(len(group))}
        keep.append(group.iloc[sorted(roots)])
    return pd.concat(keep, ignore_index=True) if keep else points.iloc[0:0]


def osm_services(settings: Settings) -> pd.DataFrame:
    import geopandas as gpd

    rules = {sid: s["osm"] for sid, s in settings.services.items() if s.get("osm")}
    if not rules:
        return pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])
    filters = sorted({f"nwr/{key}={','.join(values)}" for tags in rules.values() for key, values in tags.items()})
    subset = settings.cache_dir / "osm_services.osm.pbf"
    subprocess.run(
        ["osmium", "tags-filter", "--overwrite", "-o", str(subset), str(settings.data("osm")), *filters],
        check=True,
        capture_output=True,
    )
    frames = []
    for layer in ("points", "multipolygons"):
        gdf = gpd.read_file(subset, layer=layer)
        if gdf.empty:
            continue
        columns = [c for c in ("amenity", "shop", "healthcare") if c in gdf.columns]
        gdf["service"] = [_match_service(_row_tags(row, columns), rules) for _, row in gdf.iterrows()]
        gdf = gdf[gdf["service"].notna() & gdf.geometry.notna()].copy()
        if layer == "multipolygons":
            gdf["geometry"] = gdf.geometry.representative_point()
            osm_ids = gdf["osm_way_id"].fillna(gdf.get("osm_id")) if "osm_way_id" in gdf.columns else gdf["osm_id"]
            gdf["source_id"] = "osm:" + osm_ids.astype(str)
        else:
            gdf["source_id"] = "osm:node/" + gdf["osm_id"].astype(str)
        frames.append(gdf[["source_id", "service", "name", "geometry"]])
    if not frames:
        raise SystemExit("No OpenStreetMap services matched the configured tags.")
    points = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs="EPSG:4326")
    projected = points.to_crs("EPSG:2193")
    points["x"], points["y"] = projected.geometry.x, projected.geometry.y
    points = _drop_near_duplicates(pd.DataFrame(points))
    points["lon"] = [g.x for g in points["geometry"]]
    points["lat"] = [g.y for g in points["geometry"]]
    points["source"] = "OpenStreetMap"
    points["weight"] = 1.0
    return points[["source_id", "service", "name", "source", "weight", "lon", "lat"]]


# Which row of Health New Zealand's register counts as which service.
FACILITY_TYPES = {
    "gp": "Enrolling GP Practice",
    "pharmacy": "Community Pharmacy",
}


def city_bounds(settings: Settings, margin: float = 0.08) -> tuple[float, float, float, float]:
    """The city's extent, with a margin, so a national file can be cut to it."""
    import geopandas as gpd

    blocks = gpd.read_file(settings.data("census_sa1"), columns=["geometry"])
    west, south, east, north = blocks.total_bounds
    return west - margin, south - margin, east + margin, north + margin


def facility_services(settings: Settings) -> pd.DataFrame:
    """GPs and pharmacies from Health New Zealand's facility register.

    One row per facility, with a longitude and latitude already on it. Rows
    with no coordinates are dropped: about 1% of the file, and there is
    nothing to route to without them.

    The register covers the whole country, so it is cut to the city being
    built, with a margin wide enough to keep a practice just over the boundary
    that people near the edge would really use.
    """
    wanted = {sid: FACILITY_TYPES[sid] for sid in settings.services if sid in FACILITY_TYPES}
    if not wanted or "health_facilities" not in settings.raw["data"]:
        return pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])
    path = settings.data("health_facilities")
    if not path.exists():
        return pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])

    table = pd.read_excel(path)
    west, south, east, north = city_bounds(settings)
    rows = []
    for service, kind in wanted.items():
        block = table[table["Facility Type Name"] == kind].copy()
        block["lon"] = pd.to_numeric(block["NZGD2K X"], errors="coerce")
        block["lat"] = pd.to_numeric(block["NZGD2K Y"], errors="coerce")
        block = block.dropna(subset=["lon", "lat"])
        block = block[block["lon"].between(west, east) & block["lat"].between(south, north)]
        for _, record in block.iterrows():
            rows.append(
                {
                    "source_id": f"hpi:{record['HPI Facility Id']}",
                    "service": service,
                    "name": record.get("Name"),
                    "source": "Health New Zealand facility register",
                    "weight": 1.0,
                    "lon": float(record["lon"]),
                    "lat": float(record["lat"]),
                }
            )
    return pd.DataFrame(rows)


def school_services(settings: Settings) -> pd.DataFrame:
    payload = json.loads(settings.data("schools").read_text(encoding="utf-8"))
    records = payload["records"] if isinstance(payload, dict) else payload
    type_to_services: dict[str, list[str]] = {}
    for sid, service in settings.services.items():
        for school_type in service.get("school_types", []):
            type_to_services.setdefault(school_type, []).append(sid)
    rows = []
    for record in records:
        status = str(record.get("Status") or "").strip().lower()
        if status and "open" not in status:
            continue
        try:
            lon, lat = float(record["Longitude"]), float(record["Latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        roll = pd.to_numeric(record.get("Total"), errors="coerce")
        for service in type_to_services.get(str(record.get("Org_Type") or "").strip(), []):
            rows.append(
                {
                    "source_id": f"moe:{record.get('School_Id')}",
                    "service": service,
                    "name": record.get("Org_Name"),
                    "source": "Ministry of Education school directory",
                    "weight": float(roll) if pd.notna(roll) and roll > 0 else 1.0,
                    "lon": lon,
                    "lat": lat,
                }
            )
    return pd.DataFrame(rows)


def ece_services(settings: Settings) -> pd.DataFrame:
    """Early childhood services, from the Ministry of Education directory.

    Home-based networks are left out. Their address is the coordinator's
    office rather than anywhere a child is dropped off, so routing to it would
    measure the wrong journey.
    """
    wanted = {sid: set(spec["ece_types"]) for sid, spec in settings.services.items() if spec.get("ece_types")}
    if not wanted or "ece" not in settings.raw["data"]:
        return pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])
    path = settings.data("ece")
    if not path.exists():
        return pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])

    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload["records"] if isinstance(payload, dict) else payload
    rows = []
    for record in records:
        kind = str(record.get("Org_Type") or "").strip()
        try:
            lon, lat = float(record["Longitude"]), float(record["Latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        roll = pd.to_numeric(record.get("Total"), errors="coerce")
        for service, kinds in wanted.items():
            if kind not in kinds:
                continue
            rows.append(
                {
                    "source_id": f"moe-ece:{record.get('ECE_Id')}",
                    "service": service,
                    "name": record.get("Org_Name"),
                    "source": "Ministry of Education early childhood directory",
                    "weight": float(roll) if pd.notna(roll) and roll > 0 else 1.0,
                    "lon": lon,
                    "lat": lat,
                }
            )
    return pd.DataFrame(rows)


def build_services(settings: Settings) -> pd.DataFrame:
    """One row per (destination, service). A school can serve two year ranges."""
    facilities = facility_services(settings)
    # Whatever the register covers, OpenStreetMap is not asked for.
    covered = set(facilities["service"].unique()) if not facilities.empty else set()
    osm = osm_services(settings)
    if covered:
        osm = osm[~osm["service"].isin(covered)]
    table = pd.concat([osm, facilities, school_services(settings), ece_services(settings)], ignore_index=True)
    # Routing needs one id per physical point; the same point can serve several services.
    table["id"] = pd.factorize(table["source_id"])[0].astype(str)
    table = table.sort_values(["service", "source_id"]).reset_index(drop=True)
    path = settings.out("destinations", "services.parquet")
    table.to_parquet(path, index=False)
    counts = table.groupby("service").size().to_dict()
    settings.out("destinations", "services_summary.json").write_text(json.dumps(counts, indent=2))
    return table


def build_jobs(settings: Settings) -> pd.DataFrame:
    import geopandas as gpd
    import h3

    grid = gpd.read_parquet(settings.data("jobs_grid"))
    column = "dest_jobs"
    if column not in grid.columns:
        raise SystemExit(f"{settings.data('jobs_grid')} has no {column} column.")
    resolution = int(settings.jobs.get("resolution", 8))
    jobs = grid.loc[grid[column] > 0, ["h3", column]].copy()
    jobs["cell"] = [h3.cell_to_parent(cell, resolution) for cell in jobs["h3"]]
    table = jobs.groupby("cell", as_index=False)[column].sum().rename(columns={column: "jobs"})
    latlng = [h3.cell_to_latlng(cell) for cell in table["cell"]]
    table["lat"] = [p[0] for p in latlng]
    table["lon"] = [p[1] for p in latlng]
    table["id"] = table["cell"]
    table.to_parquet(settings.out("destinations", "jobs.parquet"), index=False)
    return table


def load_set(settings: Settings, dataset: str, services: list[str] | None = None) -> pd.DataFrame:
    path = settings.out("destinations", f"{dataset}.parquet")
    if not Path(path).exists():
        raise SystemExit(f"Missing {path}. Run `team destinations` first.")
    table = pd.read_parquet(path)
    if dataset == "services" and services:
        table = table[table["service"].isin(services)]
    return table
