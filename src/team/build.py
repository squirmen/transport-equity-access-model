"""Assemble TEAM outputs from the routing summaries, census and network data."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from . import ages, chains, context, diagnosis, equity, export, fares, gravity, measures, people, routing
from .config import Settings

log = logging.getLogger("team.build")


def _nztm(lon, lat) -> np.ndarray:
    import geopandas as gpd

    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs="EPSG:4326").to_crs("EPSG:2193")
    return np.column_stack([points.x.to_numpy(), points.y.to_numpy()])


def cell_table(settings: Settings) -> tuple[pd.DataFrame, pd.DataFrame, dict, dict, dict]:
    from .destinations import all_destinations

    origins = routing.load_origins(settings)
    index = pd.Index(origins["id"], name="h3")
    origin_xy = _nztm(origins.geometry.x, origins.geometry.y)

    log.info("measures")
    table = measures.service_table(settings, index)
    school_columns, school_state = measures.school_columns(settings, index, origin_xy)
    table = table.join(school_columns)
    table = measures.add_standards(table, settings)
    destinations = all_destinations(settings)
    xy = _nztm(destinations["lon"], destinations["lat"])
    destinations["x"], destinations["y"] = xy[:, 0], xy[:, 1]
    table = measures.add_straight_distances(table, origin_xy, destinations)
    table["population"] = origins.set_index("id")["population"].reindex(index).astype("float32")

    log.info("people")
    table = table.join(people.build(settings, origins))
    table["urban"] = people.urban_flag(table)
    table = table.join(people.villages(settings, table))
    table = table.join(ages.build(settings, origins))  # children by school age group
    log.info("network context")
    table = table.join(context.build(settings, origins))

    log.info("jobs")
    demand = table["population"] * table["working_age_share"].fillna(1.0)
    table = table.join(measures.job_table(settings, index, demand))

    log.info("gravity")
    scores, functions = gravity.build(settings, index, table["population"])
    table = table.join(scores)

    log.info("fares")
    cost, fare_record = fares.build(settings, index, origins)
    table = table.join(cost)

    if chains.spec(settings):
        log.info("errand rounds")
        table = table.join(chains.build(settings, index))

    log.info("diagnosis")
    table = diagnosis.diagnose(table, settings)
    return table, destinations, functions, fare_record, school_state


def drop_empty_services(settings: Settings) -> list[str]:
    """Leave out a service this place has no destination of, such as trades
    training in a town with no trades campus, rather than report that nobody
    can reach it."""
    from .destinations import all_destinations

    path = settings.output_dir / "destinations" / "services.parquet"
    if not path.exists():
        return []
    present = set(all_destinations(settings)["service"])
    empty = [s for s in list(settings.services) if s not in present]
    for service in empty:
        del settings.raw["services"][service]
    fares_spec = settings.raw.get("fares")
    if empty and fares_spec:
        fares_spec["purposes"] = [p for p in fares_spec.get("purposes", []) if p not in empty]
    if empty:
        log.info("no destinations here for %s; left out", ", ".join(empty))
    return empty


def run(settings: Settings) -> None:
    drop_empty_services(settings)
    table, destinations, functions, fare_record, school_state = cell_table(settings)
    table.to_parquet(settings.out("team_cells.parquet"))

    log.info("summaries")
    summary = {
        "services": equity.service_summary(table, settings),
        "jobs": equity.jobs_summary(table, settings),
        "checks": {"commute": equity.commute_check(table)},
        "gravity": {"functions": functions, **equity.gravity_summary(table, settings)},
        "fares": {**fare_record, **equity.fare_summary(table, settings)} if fare_record else {},
    }
    areas = {}
    for key in ("sa2", "local_board"):
        if key in table.columns and table[key].notna().any():
            areas[key] = equity.area_summary(table, settings, key)

    log.info("web data and downloads")
    export.write_web(settings, table, destinations, summary, areas, school_state)
    export.write_downloads(settings, table)
    export.assemble_site(settings)
    log.info("done: %s", settings.output_dir)
