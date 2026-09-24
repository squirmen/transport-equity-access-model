"""Assemble TEAM outputs from the routing summaries, census and network data."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from . import context, diagnosis, equity, export, gravity, measures, people, routing
from .config import Settings

log = logging.getLogger("team.build")


def _nztm(lon, lat) -> np.ndarray:
    import geopandas as gpd

    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs="EPSG:4326").to_crs("EPSG:2193")
    return np.column_stack([points.x.to_numpy(), points.y.to_numpy()])


def cell_table(settings: Settings) -> tuple[pd.DataFrame, pd.DataFrame]:
    origins = routing.load_origins(settings)
    index = pd.Index(origins["id"], name="h3")

    log.info("measures")
    table = measures.service_table(settings, index)
    table = measures.add_standards(table, settings)
    destinations = pd.read_parquet(settings.output_dir / "destinations" / "services.parquet")
    xy = _nztm(destinations["lon"], destinations["lat"])
    destinations["x"], destinations["y"] = xy[:, 0], xy[:, 1]
    table = measures.add_straight_distances(table, _nztm(origins.geometry.x, origins.geometry.y), destinations)
    table["population"] = origins.set_index("id")["population"].reindex(index).astype("float32")

    log.info("people")
    table = table.join(people.build(settings, origins))
    log.info("network context")
    table = table.join(context.build(settings, origins))

    log.info("jobs")
    demand = table["population"] * table["working_age_share"].fillna(1.0)
    table = table.join(measures.job_table(settings, index, demand))

    log.info("gravity")
    scores, functions = gravity.build(settings, index, table["population"])
    table = table.join(scores)

    log.info("diagnosis")
    table = diagnosis.diagnose(table, settings)
    return table, destinations, functions


def run(settings: Settings) -> None:
    table, destinations, functions = cell_table(settings)
    table.to_parquet(settings.out("team_cells.parquet"))

    log.info("summaries")
    summary = {
        "services": equity.service_summary(table, settings),
        "jobs": equity.jobs_summary(table, settings),
        "checks": {"commute": equity.commute_check(table)},
        "gravity": {"functions": functions, **equity.gravity_summary(table, settings)},
    }
    areas = {}
    for key in ("sa2", "local_board"):
        if key in table.columns and table[key].notna().any():
            areas[key] = equity.area_summary(table, settings, key)

    log.info("web data and downloads")
    export.write_web(settings, table, destinations, summary, areas)
    export.write_downloads(settings, table)
    export.assemble_site(settings)
    log.info("done: %s", settings.output_dir)
