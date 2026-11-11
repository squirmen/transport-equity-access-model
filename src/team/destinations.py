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
import logging
import re
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

log = logging.getLogger("team.destinations")

OTHER_TAG_RE = re.compile(r'"([^"]+)"=>"([^"]*)"')
DUPLICATE_METRES = 40.0


def _row_tags(row: pd.Series, columns: list[str]) -> dict[str, str]:
    tags = dict(OTHER_TAG_RE.findall(row.get("other_tags") or "")) if isinstance(row.get("other_tags"), str) else {}
    for column in columns:
        value = row.get(column)
        if isinstance(value, str) and value:
            tags[column] = value
    return tags


def _match_service(
    tags: dict[str, str],
    rules: dict[str, dict[str, list[str]]],
    excludes: dict[str, dict[str, list[str]]] | None = None,
) -> str | None:
    for service, tag_rules in rules.items():
        # A library inside a school or a university is for its own students,
        # so a service can leave out features carrying certain tags.
        if any(tags.get(key) in values for key, values in (excludes or {}).get(service, {}).items()):
            continue
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
    excludes = {sid: s["osm_exclude"] for sid, s in settings.services.items() if s.get("osm_exclude")}
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
        gdf["service"] = [_match_service(_row_tags(row, columns), rules, excludes) for _, row in gdf.iterrows()]
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
    """Schools as routing points, one row per point and service (see schools.py)."""
    from . import schools

    table = schools.school_table(settings)
    if table.empty:
        return pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])
    return schools.routing_points(table)


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


def tertiary_services(settings: Settings) -> pd.DataFrame:
    """Tertiary and trades training teaching sites, from the hand-kept list
    that scripts/build_tertiary.py places on LINZ addresses.

    A service takes every site (`tertiary_sites: all`) or only those whose
    teaching is mainly trades (`tertiary_sites: trades`). Sites are not
    weighted: nothing reliable gives the size of each one.
    """
    empty = pd.DataFrame(columns=["source_id", "service", "name", "source", "weight", "lon", "lat"])
    wanted = {sid: spec["tertiary_sites"] for sid, spec in settings.services.items() if spec.get("tertiary_sites")}
    if not wanted or "tertiary" not in settings.raw["data"]:
        return empty
    path = settings.data("tertiary")
    if not path.exists():
        log.warning("no tertiary site list at %s", path)
        return empty
    sites = pd.read_csv(path, dtype=str).fillna("")
    sites["lon"] = pd.to_numeric(sites["lon"], errors="coerce")
    sites["lat"] = pd.to_numeric(sites["lat"], errors="coerce")
    sites = sites.dropna(subset=["lon", "lat"])
    trades = sites["trades"].str.lower().isin(["true", "1", "yes"])
    rows = []
    for service, which in wanted.items():
        chosen = sites[trades] if which == "trades" else sites
        for site in chosen.to_dict("records"):
            rows.append({
                "source_id": f"tertiary:{site['site_id']}",
                "service": service,
                "name": f"{site['provider_name']}, {site['site_name']}" if site.get("site_name") and site["site_name"] != site["provider_name"] else site["provider_name"],
                "source": "Tertiary teaching sites (NZQA and providers), placed on LINZ addresses",
                "weight": 1.0,
                "lon": float(site["lon"]),
                "lat": float(site["lat"]),
            })
    return pd.DataFrame(rows) if rows else empty


def stable_ids(table: pd.DataFrame, previous: Path) -> pd.Series:
    """Routing ids that stay the same from one build to the next.

    A destination keeps the id it had in the last services.parquet, so runs
    already routed stay valid when other destinations come or go. New ones
    are numbered after the highest id used before.
    """
    if not previous.exists():
        return pd.Series(pd.factorize(table["source_id"])[0].astype(str), index=table.index)
    before = pd.read_parquet(previous, columns=["source_id", "id"]).drop_duplicates("source_id")
    known = dict(zip(before["source_id"], before["id"].astype(str)))
    numbers = pd.to_numeric(before["id"], errors="coerce")
    next_id = int(numbers.max()) + 1 if numbers.notna().any() else 0
    ids = {}
    for source_id in pd.unique(table["source_id"]):
        if source_id in known:
            ids[source_id] = known[source_id]
        else:
            ids[source_id] = str(next_id)
            next_id += 1
    return table["source_id"].map(ids)


def build_services(settings: Settings) -> pd.DataFrame:
    """One row per (destination, service), schools apart.

    Schools are written to schools.parquet by schools.build and routed in
    runs of their own, so a change to the school directory does not throw
    away the other services' routing.
    """
    from . import schools

    facilities = facility_services(settings)
    # Whatever the register covers, OpenStreetMap is not asked for.
    covered = set(facilities["service"].unique()) if not facilities.empty else set()
    osm = osm_services(settings)
    if covered:
        osm = osm[~osm["service"].isin(covered)]
    table = pd.concat([osm, facilities, ece_services(settings), tertiary_services(settings)], ignore_index=True)
    # Early childhood directories come by region, and a region can
    # hold several towns. Keep what lies around this one: anything further
    # is beyond the routing limit anyway, and would only crowd the map.
    if "census_sa1" in settings.raw["data"] and settings.data("census_sa1").exists():
        west, south, east, north = city_bounds(settings)
        inside = table["lon"].between(west, east) & table["lat"].between(south, north)
        if (~inside).any():
            log.info("left out %d destination rows outside the city", int((~inside).sum()))
        table = table[inside]
    # A register can list the same facility twice at slightly different
    # addresses: Health New Zealand has Peninsula Medical Centre at two points
    # two hundred metres apart. One id is one place, so keep the first.
    before = len(table)
    table = table.drop_duplicates(["source_id", "service"], keep="first")
    if len(table) < before:
        log.info("dropped %d destination rows repeating an id", before - len(table))
    # Routing needs one id per physical point; the same point can serve several services.
    path = settings.out("destinations", "services.parquet")
    table["id"] = stable_ids(table, path)
    table = table.sort_values(["service", "source_id"]).reset_index(drop=True)
    table.to_parquet(path, index=False)
    points, _ = schools.build(settings)
    counts = {**table.groupby("service").size().to_dict(), **points.drop_duplicates(["school", "service"]).groupby("service").size().to_dict()}
    settings.out("destinations", "services_summary.json").write_text(json.dumps(counts, indent=2))
    return table


def all_destinations(settings: Settings) -> pd.DataFrame:
    """Every destination as the site lists it: one row per destination and
    service, with schools at their map point (not their entrances), keyed by
    school. Columns: id, service, name, lon, lat, source_id."""
    folder = settings.output_dir / "destinations"
    services = pd.read_parquet(folder / "services.parquet")
    from . import schools

    school_ids = schools.school_service_ids(settings)
    listed = schools.load_list(settings)
    if listed is None or not school_ids:
        return services
    from .measures import has_school_runs

    if not has_school_runs(settings):
        raise SystemExit("The schools have their own destination set but no routing yet. "
                         "Run `team route --all` (or the schools_* runs) before `team build`.")
    # Before the split, services.parquet still holds the schools.
    services = services[~services["service"].isin(school_ids)]
    rows = []
    for record in listed.to_dict("records"):
        for service in str(record["services"]).split(","):
            rows.append({"id": record["school"], "source_id": record["school"], "service": service,
                         "name": record["name"], "lon": record["lon"], "lat": record["lat"],
                         "weight": float(record["roll"]) if record.get("roll") and record["roll"] > 0 else 1.0,
                         "source": "Ministry of Education school directory"})
    return pd.concat([services, pd.DataFrame(rows)], ignore_index=True)


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
