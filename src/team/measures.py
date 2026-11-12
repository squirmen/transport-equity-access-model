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


class PairsMismatch(SystemExit):
    """The cached pairs do not reproduce a run's own summary."""


def _service_counts(pairs: pd.DataFrame | None) -> pd.DataFrame:
    """Counts within 10, 15, 20 and 30 minutes per origin and service, from pairs."""
    from .pt_or_walk import counts

    if pairs is None or pairs.empty:
        return pd.DataFrame(columns=[f"n{m}" for m in COUNT_MINUTES])
    return counts(pairs, ["origin", "service"], COUNT_MINUTES)


def check_counts(summary: pd.DataFrame, from_pairs: pd.DataFrame, tag: str) -> None:
    """Stop when a run's cached pairs do not give its own counts: the merge
    with walking is worked out from the pairs, so they must agree first."""
    run = summary.set_index(["origin", "service"])[[f"n{m}" for m in COUNT_MINUTES]].astype("int64")
    got = from_pairs.reindex(run.index).fillna(0).astype("int64")
    bad = int((run != got).any(axis=1).sum())
    if bad:
        raise PairsMismatch(f"{tag}: the cached pairs give other counts than the run in {bad} rows; route the run again.")


def service_table(settings: Settings, origins: pd.Index) -> pd.DataFrame:
    """Minutes, counts and the nearest destination of each service by each mode.

    With school runs of their own, school services are left to
    `school_columns`. A time past the routing limit is dropped: R5 can return
    a minute or more over it, and every count and pair stops at the limit.

    Public transport is the quicker of R5's trip and walking, pair by pair
    (pt_or_walk.py): times, the destination named and every count. R5's own
    times are kept as t_<service>_<mode>[_<window>]_r5.
    """
    from . import pt_or_walk
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
    # Counts from the pairs, for public transport merged with walking.
    transit_runs = any(pt_or_walk.is_transit(settings, m) and path.exists() for m, _, path in _service_runs(settings))
    walked = transit_runs and "walk" in settings.modes and (settings.output_dir / "routing" / "services_walk.parquet").exists()
    walk_pairs = load_pairs(settings, run_tag("services", "walk", None, False)) if walked else None
    if walked and walk_pairs is None:
        raise SystemExit("services_walk: no cached pairs; public transport cannot be merged with walking without them.")
    if walk_pairs is not None:
        walk_pairs = walk_pairs[~walk_pairs["service"].isin(skip)]
    merged_counts: dict[tuple[str, str], pd.DataFrame] = {}
    for mode_id, window, path in _service_runs(settings):
        if not pt_or_walk.is_transit(settings, mode_id) or not path.exists() or walk_pairs is None:
            continue
        tag = run_tag("services", mode_id, window, True)
        pairs = load_pairs(settings, tag)
        if pairs is None:
            raise SystemExit(f"{tag}: no cached pairs; public transport cannot be merged with walking without them.")
        pairs = pairs[~pairs["service"].isin(skip)]
        summary = long[(long["mode"] == mode_id) & (long["window"] == window) & ~long["service"].isin(skip)]
        check_counts(summary, _service_counts(pairs), tag)
        both = pt_or_walk.merge(pairs, walk_pairs, ["origin", "destination", "service"], limit_minutes,
                                pt_or_walk.walk_factor(settings, mode_id))
        merged_counts[(mode_id, window)] = _service_counts(both)
    columns: dict[str, pd.Series] = {}
    for service, spec in settings.services.items():
        if service in skip:
            continue
        counted = count_column(float(spec["standard_minutes"]))
        rows = long[long["service"] == service]
        windows = service_windows(spec)
        walk = rows[(rows["mode"] == "walk") & (rows["window"] == "")].set_index("origin")
        walk_t = walk["minutes"].reindex(origins).astype("float32") if len(walk) else pd.Series(np.nan, index=origins)
        walk_t = walk_t.where(walk_t <= limit_minutes)
        walk_id = walk["nearest_id"].reindex(origins) if len(walk) else pd.Series(None, index=origins, dtype="object")
        for mode_id, mode in settings.modes.items():
            transit = mode["kind"] == "transit"
            for window in windows if transit else [""]:
                by_origin = rows[(rows["mode"] == mode_id) & (rows["window"] == window)].set_index("origin")
                # The usual window keeps the plain name, so everything that
                # reads one time per mode goes on reading the usual one.
                suffix = f"_{window}" if transit and window != windows[0] else ""
                name = f"{service}_{mode_id}{suffix}"
                minutes = by_origin["minutes"].reindex(origins).astype("float32")
                minutes = minutes.where(minutes <= limit_minutes)
                nearest = by_origin["nearest_id"].reindex(origins).where(minutes.notna())
                steps = by_origin[[f"n{m}" for m in COUNT_MINUTES]].reindex(origins).fillna(0)
                if transit and (mode_id, window) in merged_counts:
                    columns[f"t_{name}_r5"] = minutes
                    minutes, nearest = pt_or_walk.merge_nearest(minutes, nearest, walk_t, walk_id, limit_minutes,
                                                                 pt_or_walk.walk_factor(settings, mode_id))
                    got = merged_counts[(mode_id, window)]
                    if service in got.index.get_level_values("service"):
                        steps = got.xs(service, level="service").reindex(origins).fillna(0)
                    else:
                        steps = steps * 0
                columns[f"t_{name}"] = minutes
                columns[f"n_{name}"] = steps[counted].astype("int32")
                columns[f"id_{name}"] = nearest
                # Counts at every step, for how much choice a place has at
                # whatever standard is chosen; the usual time only.
                if not suffix and mode_id in settings.standard_modes:
                    for limit in COUNT_MINUTES:
                        columns[f"n{limit}_{name}"] = steps[f"n{limit}"].astype("int16")
    return pd.DataFrame(columns, index=origins)


def school_columns(settings: Settings, origins: pd.Index, origin_xy: np.ndarray) -> tuple[pd.DataFrame, dict]:
    """The same columns as `service_table` for school services, from the
    school runs' reach lists, with ties broken the same way every time:
    minutes, then straight-line distance, then MoE number.

    Returns the columns and, for the export, each reach list in that order
    and the schools tied for nearest, keyed (service, mode key) where the
    mode key is the column suffix (pt, or pt_<window> for another window).

    Public transport lists are merged with walking, school by school
    (pt_or_walk.py), so they also hold schools reached only on foot; R5's
    own nearest time is kept as t_<service>_<mode>_r5.
    """
    from . import pt_or_walk, schools

    listed = schools.load_list(settings)
    state: dict = {"reach": {}, "ties": {}}
    if listed is None or not has_school_runs(settings):
        return pd.DataFrame(index=origins), state
    # Half a set of school runs would quietly drop a mode's school times.
    from .routing import plan

    missing = [run_tag(d, m, w, w is not None) for d, m, w in plan(settings)
               if d == "schools" and not school_run_done(settings, run_tag(d, m, w, w is not None))]
    if missing:
        raise SystemExit(f"School runs not finished: {', '.join(missing)}. Route them before building.")
    xy = _nztm_points(listed["lon"].to_numpy(), listed["lat"].to_numpy())
    listed = listed.assign(x=xy[:, 0], y=xy[:, 1])
    n = len(origins)
    columns: dict[str, pd.Series] = {}
    for mode_id, mode in settings.modes.items():
        transit = mode["kind"] == "transit"
        for window in sorted({w for s in schools.school_service_ids(settings) for w in service_windows(settings.services[s])}) if transit else [None]:
            pairs = pt_or_walk.load_merged(settings, "schools", mode_id, window)
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
                if "r5" in reach:
                    r5 = reach.groupby("cell")["r5"].min()
                    values = np.full(n, np.nan, dtype="float32")
                    values[r5.index.to_numpy()] = r5.to_numpy(dtype="float32")
                    columns[f"t_{name}_r5"] = pd.Series(values, index=origins, dtype="float32")
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
    """Best time without a car, whether it meets the standard, and how many ways do.

    Ties go to the mode listed first in standard_modes (walking). Public
    transport is the quicker of a bus or train and walking, so it counts as a
    way of its own in options_ only where a bus or train is quicker than
    walking; otherwise the same walk would count twice.
    """
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
        ways = filled <= limit
        walk = table[f"t_{service}_walk"].to_numpy(dtype="float64") if f"t_{service}_walk" in table else None
        if walk is not None:
            for j, mode_id in enumerate(counting):
                if settings.modes[mode_id]["kind"] == "transit":
                    ways[:, j] &= ~(filled[:, j] >= walk)
        table[f"options_{service}"] = ways.sum(axis=1).astype("int8")
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


def check_jobs(run: pd.DataFrame, from_pairs: pd.Series, tag: str, limit: int) -> None:
    """Stop when a run's cached job pairs do not give its own job counts
    (floating-point sums aside)."""
    expected = run.to_numpy(dtype="float64")
    got = from_pairs.reindex(run.index).fillna(0.0).to_numpy(dtype="float64")
    bad = int((np.abs(expected - got) > 0.01 + 1e-5 * np.abs(expected)).sum())
    if bad:
        raise PairsMismatch(f"{tag}: the cached pairs give other jobs within {limit} minutes than the run for {bad} origins.")


def job_table(settings: Settings, origins: pd.Index, demand: pd.Series) -> pd.DataFrame:
    """Jobs within each threshold by each mode, as counts, shares and the
    competition-adjusted measure.

    Public transport is the quicker of R5's trip and walking, job cell by job
    cell (pt_or_walk.py); R5's own counts are kept as jobs<T>_<mode>[_<window>]_r5.
    """
    from . import pt_or_walk

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
            pairs = None
            if transit or mode_id == "bike_low_stress":
                pairs = pt_or_walk.load_merged(settings, "jobs", mode_id, window) if transit else load_pairs(settings, tag)
            if transit and pairs is None:
                raise SystemExit(f"{tag}: no cached pairs; public transport cannot be merged with walking without them.")
            if transit and "r5" in pairs:
                size = pairs["destination"].map(jobs).fillna(0.0)
            for limit in thresholds:
                reached = frame[f"jobs_{limit}"].reindex(origins).fillna(0.0)
                if transit and "r5" in pairs:
                    r5 = pairs["r5"] <= limit
                    check_jobs(frame[f"jobs_{limit}"], size[r5].groupby(pairs.loc[r5, "origin"]).sum(), tag, limit)
                    columns[f"jobs{limit}_{key}_r5"] = reached.astype("float32")
                    within = pairs["minutes"] <= limit
                    reached = size[within].groupby(pairs.loc[within, "origin"]).sum().reindex(origins).fillna(0.0)
                columns[f"jobs{limit}_{key}"] = reached.astype("float32")
                columns[f"jobshare{limit}_{key}"] = (reached / total).astype("float32")
            if mode_id in ("pt", "bike_low_stress") and pairs is not None:
                if car_pairs is None and "car" in settings.modes:
                    car_pairs = load_pairs(settings, run_tag("jobs", "car", None, False))
                pairs = pairs[["origin", "destination", "minutes"]]
                pool = _catchment(pairs, car_pairs)
                for limit in thresholds:
                    fair = competition_adjusted(pairs, jobs, demand, limit, pool)
                    columns[f"jobsfair{limit}_{key}"] = fair.reindex(origins).fillna(0.0).astype("float32")
    return pd.DataFrame(columns, index=origins)
