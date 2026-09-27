"""Per-cell access measures, built from the routing summaries.

Column names used through the build and in the web data:

    t_<service>_<mode>    minutes to the nearest <service> by <mode>; public
                          transport in the service's usual window
    t_<service>_pt_<w>    the same by public transport in another window <w>
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

Job columns by public transport also come as jobs<T>_pt_<w> and so on for each
window after the usual one.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings
from .routing import job_windows, run_tag, service_windows

COUNT_MINUTES = (10, 15, 20, 30)


def count_column(standard_minutes: float) -> str:
    """The routing count column that matches a standard. Counts exist for 10, 15, 20 and 30."""
    eligible = [m for m in COUNT_MINUTES if m <= standard_minutes]
    return f"n{max(eligible) if eligible else COUNT_MINUTES[0]}"


def _service_runs(settings: Settings) -> list[tuple[str, str | None, Path]]:
    windows = sorted({w for spec in settings.services.values() for w in service_windows(spec)})
    runs = []
    for mode_id, mode in settings.modes.items():
        if mode["kind"] == "transit":
            runs += [(mode_id, w, settings.output_dir / "routing" / f"services_{w}_{mode_id}.parquet") for w in windows]
        else:
            runs.append((mode_id, None, settings.output_dir / "routing" / f"services_{mode_id}.parquet"))
    return runs


def service_table(settings: Settings, origins: pd.Index) -> pd.DataFrame:
    frames = []
    for mode_id, window, path in _service_runs(settings):
        if path.exists():
            frame = pd.read_parquet(path)
            frame["mode"] = mode_id
            frame["window"] = window or ""
            frames.append(frame)
    if not frames:
        raise SystemExit("No routing outputs found. Run `team route --all` first.")
    long = pd.concat(frames, ignore_index=True)
    columns: dict[str, pd.Series] = {}
    for service, spec in settings.services.items():
        counted = count_column(float(spec["standard_minutes"]))
        rows = long[long["service"] == service]
        windows = service_windows(spec)
        for mode_id, mode in settings.modes.items():
            transit = mode["kind"] == "transit"
            for window in windows if transit else [""]:
                by_origin = rows[(rows["mode"] == mode_id) & (rows["window"] == window)].set_index("origin")
                # The usual window keeps the plain name, so everything that
                # reads one time per mode goes on reading the usual one.
                suffix = f"_{window}" if transit and window != windows[0] else ""
                name = f"{service}_{mode_id}{suffix}"
                columns[f"t_{name}"] = by_origin["minutes"].reindex(origins).astype("float32")
                columns[f"n_{name}"] = by_origin[counted].reindex(origins).fillna(0).astype("int32")
                columns[f"id_{name}"] = by_origin["nearest_id"].reindex(origins)
                # Counts at every step, for how much choice a place has at
                # whatever standard is chosen; the usual time only.
                if not suffix and mode_id in settings.standard_modes:
                    for limit in COUNT_MINUTES:
                        columns[f"n{limit}_{name}"] = by_origin[f"n{limit}"].reindex(origins).fillna(0).astype("int16")
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
    pairs: pd.DataFrame, jobs: pd.Series, demand: pd.Series, limit: int, catchment: pd.DataFrame | None = None
) -> pd.Series:
    """Two-step floating catchment: jobs per competing resident within `limit` minutes.

    Step one divides the jobs at each destination by the working-age residents
    who could reach it in time. Step two sums those ratios over the
    destinations each origin can reach by the mode being measured. The result
    is scaled so 1 is the average working-age resident's figure for this mode.

    Competition is counted over `catchment` when given: everyone who could get
    there in time by car or by this mode. Counting only people who can reach a
    job by the same mode leaves jobs that public transport barely serves with
    a handful of competitors, and gives the few who can reach them ratios in
    the hundreds. Anyone who can get to a job competes for it, however they
    travel (Shen, 1998).
    """
    within = pairs[pairs["minutes"] <= limit]
    pool = within if catchment is None else catchment[catchment["minutes"] <= limit]
    competing = pool["origin"].map(demand).fillna(0.0).groupby(pool["destination"]).sum()
    per_resident = (jobs.reindex(competing.index) / competing.replace(0.0, np.nan)).fillna(0.0)
    access = within["destination"].map(per_resident).fillna(0.0).groupby(within["origin"]).sum()
    weights = demand.reindex(access.index).fillna(0.0)
    # Averaged over everyone, including those who reach no jobs this way.
    average = float((access * weights).sum() / demand.sum()) if demand.sum() > 0 else np.nan
    return access / average if average and average > 0 else access * np.nan


def _catchment(pairs: pd.DataFrame, car: pd.DataFrame | None) -> pd.DataFrame:
    """Every origin-destination pair reachable by this mode or by car, at the faster time."""
    if car is None:
        return pairs
    both = pd.concat([pairs[["origin", "destination", "minutes"]], car[["origin", "destination", "minutes"]]], ignore_index=True)
    return both.groupby(["origin", "destination"], as_index=False)["minutes"].min()


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
    windows = job_windows(settings)
    car_pairs = None
    for mode_id in settings.jobs["modes"]:
        transit = settings.modes[mode_id]["kind"] == "transit"
        for window in windows if transit else [None]:
            tag = run_tag("jobs", mode_id, window, transit)
            path = settings.output_dir / "routing" / f"{tag}.parquet"
            if not path.exists():
                continue
            key = f"{mode_id}_{window}" if transit and window != windows[0] else mode_id
            frame = pd.read_parquet(path).set_index("origin")
            for limit in thresholds:
                reached = frame[f"jobs_{limit}"].reindex(origins).fillna(0.0)
                columns[f"jobs{limit}_{key}"] = reached.astype("float32")
                columns[f"jobshare{limit}_{key}"] = (reached / total).astype("float32")
            if mode_id in ("pt", "bike_low_stress"):
                pairs = load_pairs(settings, tag)
                if pairs is not None:
                    if car_pairs is None and "car" in settings.modes:
                        car_pairs = load_pairs(settings, run_tag("jobs", "car", None, False))
                    pool = _catchment(pairs, car_pairs)
                    for limit in thresholds:
                        fair = competition_adjusted(pairs, jobs, demand, limit, pool)
                        columns[f"jobsfair{limit}_{key}"] = fair.reindex(origins).fillna(0.0).astype("float32")
    return pd.DataFrame(columns, index=origins)
