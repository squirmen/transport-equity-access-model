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


def school_tag(settings: Settings, mode_id: str, window: str | None) -> str:
    transit = settings.modes[mode_id]["kind"] == "transit"
    return run_tag("schools", mode_id, window if transit else None, transit)


def has_school_runs(settings: Settings) -> bool:
    """Whether this build has its schools routed on their own (dataset "schools")."""
    from .schools import school_service_ids

    ids = school_service_ids(settings)
    if not ids:
        return False
    window = settings.services[ids[0]]["window"]
    return any(school_run_done(settings, school_tag(settings, m, window)) for m in settings.modes)


def school_run_done(settings: Settings, tag: str) -> bool:
    """A school run counts once its batches are combined and its manifest
    written, so a build never reads a run still being routed."""
    output = settings.output_dir / "routing" / f"{tag}.parquet"
    return output.exists() and output.with_suffix(".json").exists()


def service_table(settings: Settings, origins: pd.Index) -> pd.DataFrame:
    """Minutes, counts and the nearest destination of each service by each mode.

    With school runs of their own, school services are left to
    `school_columns`. A time past the routing limit is dropped: R5 can return
    a minute or more over it, and every count and pair stops at the limit.
    """
    from .schools import school_service_ids

    skip = set(school_service_ids(settings)) if has_school_runs(settings) else set()
    limit_minutes = float(settings.routing.get("max_minutes", 60))
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
        if service in skip:
            continue
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
                minutes = by_origin["minutes"].reindex(origins).astype("float32")
                columns[f"t_{name}"] = minutes.where(minutes <= limit_minutes)
                columns[f"n_{name}"] = by_origin[counted].reindex(origins).fillna(0).astype("int32")
                columns[f"id_{name}"] = by_origin["nearest_id"].reindex(origins).where(minutes <= limit_minutes)
                # Counts at every step, for how much choice a place has at
                # whatever standard is chosen; the usual time only.
                if not suffix and mode_id in settings.standard_modes:
                    for limit in COUNT_MINUTES:
                        columns[f"n{limit}_{name}"] = by_origin[f"n{limit}"].reindex(origins).fillna(0).astype("int16")
    return pd.DataFrame(columns, index=origins)


def school_columns(settings: Settings, origins: pd.Index, origin_xy: np.ndarray) -> tuple[pd.DataFrame, dict]:
    """The same columns as `service_table` for school services, from the
    school runs' reach lists, with ties broken the same way every time:
    minutes, then straight-line distance, then MoE number.

    Returns the columns and, for the export, each reach list in that order
    and the schools tied for nearest, keyed (service, mode key) where the
    mode key is the column suffix (pt, or pt_<window> for another window).
    """
    from . import schools

    listed = schools.load_list(settings)
    state: dict = {"reach": {}, "ties": {}}
    if listed is None or not has_school_runs(settings):
        return pd.DataFrame(index=origins), state
    xy = _nztm_points(listed["lon"].to_numpy(), listed["lat"].to_numpy())
    listed = listed.assign(x=xy[:, 0], y=xy[:, 1])
    n = len(origins)
    columns: dict[str, pd.Series] = {}
    for mode_id, mode in settings.modes.items():
        transit = mode["kind"] == "transit"
        for window in sorted({w for s in schools.school_service_ids(settings) for w in service_windows(settings.services[s])}) if transit else [None]:
            pairs = schools.load_reach(settings, school_tag(settings, mode_id, window))
            if pairs is None:
                continue
            ordered = schools.ordered_reach(pairs, origins, origin_xy, listed)
            for service in schools.school_service_ids(settings):
                spec = settings.services[service]
                windows = service_windows(spec)
                if transit and window not in windows:
                    continue
                suffix = f"_{window}" if transit and window != windows[0] else ""
                name = f"{service}_{mode_id}{suffix}"
                reach = ordered[ordered["service"] == service]
                minutes, nearest, ties = schools.nearest_schools(reach, n)
                columns[f"t_{name}"] = pd.Series(minutes, index=origins, dtype="float32")
                limit = int(count_column(float(spec["standard_minutes"]))[1:])
                columns[f"n_{name}"] = pd.Series(schools.counts_within(reach, n, limit), index=origins, dtype="int32")
                columns[f"id_{name}"] = pd.Series(nearest, index=origins, dtype="object")
                if not suffix and mode_id in settings.standard_modes:
                    for step in COUNT_MINUTES:
                        columns[f"n{step}_{name}"] = pd.Series(schools.counts_within(reach, n, step), index=origins, dtype="int16")
                key = f"{mode_id}{suffix}"
                state["reach"][(service, key)] = reach
                state["ties"][(service, key)] = ties
    return pd.DataFrame(columns, index=origins), state


def _nztm_points(lon, lat) -> np.ndarray:
    import geopandas as gpd

    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs="EPSG:4326").to_crs("EPSG:2193")
    return np.column_stack([points.x.to_numpy(), points.y.to_numpy()])


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
