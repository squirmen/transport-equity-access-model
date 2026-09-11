"""Per-cell access measures, built from the routing summaries.

Column names used through the build and in the web data:

    t_<service>_<mode>    minutes to the nearest <service> by <mode>
    n_<service>_<mode>    how many <service> are within its standard time by <mode>
    id_<service>_<mode>   which destination was nearest
    best_<service>        fastest of the modes that count towards the standard
    via_<service>         the mode that gave best_<service>
    meets_<service>       best_<service> is within the standard
    options_<service>     how many counting modes are within the standard (0 to 3)
    km_<service>          straight-line distance to the nearest <service>
    jobs<T>_<mode>        jobs reachable within T minutes by <mode>
    jobshare<T>_<mode>    the same, as a share of all jobs in the region
    jobsfair<T>_<mode>    job access allowing for other workers (1 = regional average)
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings
from .routing import run_tag

COUNT_MINUTES = (10, 15, 20, 30)


def count_column(standard_minutes: float) -> str:
    """The routing count column that matches a standard. Counts exist for 10, 15, 20 and 30."""
    eligible = [m for m in COUNT_MINUTES if m <= standard_minutes]
    return f"n{max(eligible) if eligible else COUNT_MINUTES[0]}"


def _service_runs(settings: Settings) -> list[tuple[str, Path]]:
    windows = sorted({spec["window"] for spec in settings.services.values()})
    runs = []
    for mode_id, mode in settings.modes.items():
        if mode["kind"] == "transit":
            runs += [(mode_id, settings.output_dir / "routing" / f"services_{w}_{mode_id}.parquet") for w in windows]
        else:
            runs.append((mode_id, settings.output_dir / "routing" / f"services_{mode_id}.parquet"))
    return runs


def service_table(settings: Settings, origins: pd.Index) -> pd.DataFrame:
    frames = []
    for mode_id, path in _service_runs(settings):
        if path.exists():
            frame = pd.read_parquet(path)
            frame["mode"] = mode_id
            frames.append(frame)
    if not frames:
        raise SystemExit("No routing outputs found. Run `team route --all` first.")
    long = pd.concat(frames, ignore_index=True)
    columns: dict[str, pd.Series] = {}
    for service, spec in settings.services.items():
        counted = count_column(float(spec["standard_minutes"]))
        rows = long[long["service"] == service]
        for mode_id in settings.modes:
            by_origin = rows[rows["mode"] == mode_id].set_index("origin")
            columns[f"t_{service}_{mode_id}"] = by_origin["minutes"].reindex(origins).astype("float32")
            columns[f"n_{service}_{mode_id}"] = by_origin[counted].reindex(origins).fillna(0).astype("int32")
            columns[f"id_{service}_{mode_id}"] = by_origin["nearest_id"].reindex(origins)
    return pd.DataFrame(columns, index=origins)


def add_standards(table: pd.DataFrame, settings: Settings) -> pd.DataFrame:
    """Best time without a car, whether it meets the standard, and how many ways do."""
    for service, spec in settings.services.items():
        limit = float(spec["standard_minutes"])
        counting = [m for m in settings.standard_modes if f"t_{service}_{m}" in table]
        times = table[[f"t_{service}_{m}" for m in counting]].to_numpy(dtype="float64")
        filled = np.where(np.isnan(times), np.inf, times)
        best = filled.min(axis=1)
        reachable = np.isfinite(best)
        table[f"best_{service}"] = np.where(reachable, best, np.nan).astype("float32")
        table[f"via_{service}"] = np.where(reachable, np.array(counting)[filled.argmin(axis=1)], "")
        table[f"meets_{service}"] = best <= limit
        table[f"options_{service}"] = (filled <= limit).sum(axis=1).astype("int8")
    table["standards_met"] = sum(table[f"meets_{s}"].astype("int8") for s in settings.services)
    return table


def add_straight_distances(table: pd.DataFrame, origin_xy: np.ndarray, destinations: pd.DataFrame) -> pd.DataFrame:
    """Straight-line km to the nearest destination of each service (NZTM coordinates)."""
    from scipy.spatial import cKDTree

    for service, points in destinations.groupby("service"):
        tree = cKDTree(points[["x", "y"]].to_numpy())
        distance, _ = tree.query(origin_xy, k=1)
        table[f"km_{service}"] = (distance / 1000.0).astype("float32")
    return table


def competition_adjusted(
    pairs: pd.DataFrame, jobs: pd.Series, demand: pd.Series, limit: int
) -> pd.Series:
    """Two-step floating catchment: jobs per competing resident within `limit` minutes.

    Step one divides the jobs at each destination by the working-age residents
    who can reach it. Step two sums those ratios over the destinations each
    origin can reach. The result is scaled so 1 is the regional average.
    """
    within = pairs[pairs["minutes"] <= limit]
    competing = within["origin"].map(demand).fillna(0.0).groupby(within["destination"]).sum()
    per_resident = (jobs.reindex(competing.index) / competing.replace(0.0, np.nan)).fillna(0.0)
    access = within["destination"].map(per_resident).fillna(0.0).groupby(within["origin"]).sum()
    regional = jobs.sum() / demand.sum() if demand.sum() > 0 else np.nan
    return access / regional


def load_pairs(settings: Settings, tag: str) -> pd.DataFrame | None:
    folder = settings.cache_dir / "pairs" / tag
    files = sorted(folder.glob("origins_*.parquet"))
    if not files:
        return None
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


def job_table(settings: Settings, origins: pd.Index, demand: pd.Series) -> pd.DataFrame:
    jobs = pd.read_parquet(settings.output_dir / "destinations" / "jobs.parquet").set_index("id")["jobs"]
    total = float(jobs.sum())
    columns: dict[str, pd.Series] = {}
    thresholds = [int(t) for t in settings.jobs["thresholds"]]
    for mode_id in settings.jobs["modes"]:
        transit = settings.modes[mode_id]["kind"] == "transit"
        tag = run_tag("jobs", mode_id, settings.jobs["window"] if transit else None, transit)
        path = settings.output_dir / "routing" / f"{tag}.parquet"
        if not path.exists():
            continue
        frame = pd.read_parquet(path).set_index("origin")
        for limit in thresholds:
            reached = frame[f"jobs_{limit}"].reindex(origins).fillna(0.0)
            columns[f"jobs{limit}_{mode_id}"] = reached.astype("float32")
            columns[f"jobshare{limit}_{mode_id}"] = (reached / total).astype("float32")
        if mode_id in ("pt", "bike_low_stress"):
            pairs = load_pairs(settings, tag)
            if pairs is not None:
                for limit in thresholds:
                    fair = competition_adjusted(pairs, jobs, demand, limit)
                    columns[f"jobsfair{limit}_{mode_id}"] = fair.reindex(origins).fillna(0.0).astype("float32")
    return pd.DataFrame(columns, index=origins)
