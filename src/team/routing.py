"""Door-to-door travel times with R5, via r5py.

Each run routes every origin cell to one destination set by one mode and keeps
per-origin summaries only:

* services: minutes to the nearest destination of each type, which one it
  was, and how many are reachable within 10, 15, 20 and 30 minutes;
* jobs: jobs reachable within each configured threshold. Origin-destination
  pairs inside the largest threshold are also kept, in the cache directory,
  for the competition-adjusted job measure.

Batches are written as they finish, so a stopped run resumes where it left off.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from . import destinations
from .config import Settings

log = logging.getLogger("team.routing")

SERVICE_COUNT_MINUTES = (10, 15, 20, 30)

# GTFS tables every feed must carry. Anything else is optional.
REQUIRED_GTFS = {"agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"}


def prepare_java(settings: Settings) -> None:
    """Point r5py at the configured JDK and heap size. Call before importing r5py."""
    java_home = settings.routing.get("java_home")
    if java_home and not os.environ.get("JAVA_HOME") and Path(java_home).exists():
        os.environ["JAVA_HOME"] = java_home
    memory = settings.routing.get("max_memory")
    if memory and "--max-memory" not in sys.argv:
        sys.argv.extend(["--max-memory", str(memory)])


def _has_rows(data: bytes) -> bool:
    return sum(1 for line in data.splitlines() if line.strip()) > 1


def prepare_gtfs(settings: Settings) -> tuple[Path, list[str]]:
    """The timetable feed as R5 will load it, and the tables left out of it.

    R5 refuses optional tables that have a header and no rows. Auckland
    Transport's feed ships its fare and frequency tables that way. The copy
    leaves out such tables and changes nothing else, so any other fault in the
    feed, including an empty required table, still stops the run. Copies are
    kept in the cache and named by the source file's hash.
    """
    source = settings.data("gtfs")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
    target = settings.cache_dir / "gtfs" / f"{source.stem}-{digest}.zip"
    record = target.with_suffix(".json")
    if target.exists() and record.exists():
        return target, json.loads(record.read_text())["left_out"]

    target.parent.mkdir(parents=True, exist_ok=True)
    left_out = []
    tmp = target.with_suffix(".tmp")
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info)
            name = Path(info.filename).name
            if name.endswith(".txt") and name not in REQUIRED_GTFS and not _has_rows(data):
                left_out.append(name)
                continue
            dst.writestr(info, data)
    tmp.replace(target)
    left_out.sort()
    record.write_text(json.dumps({"source": str(source), "sha256_prefix": digest, "left_out": left_out}, indent=2))
    log.info("timetable copy %s leaves out empty tables: %s", target.name, ", ".join(left_out) or "none")
    return target, left_out


def load_origins(settings: Settings):
    import geopandas as gpd

    grid = gpd.read_parquet(settings.data("grid"))
    grid = grid[grid["population"] >= float(settings.raw["origins"]["min_population"])]
    origins = gpd.GeoDataFrame(
        {"id": grid["h3"].astype(str).to_numpy(), "population": grid["population"].to_numpy()},
        geometry=gpd.points_from_xy(grid["centroid_lon"], grid["centroid_lat"]),
        crs="EPSG:4326",
    )
    # Sorting H3 ids keeps neighbouring cells in the same batch.
    return origins.sort_values("id").reset_index(drop=True)


def _mode_kwargs(r5py, mode: dict, routing: dict) -> dict:
    walk = float(routing.get("speed_walking_kmh", 4.8))
    cycle = float(routing.get("speed_cycling_kmh", 15))
    modes = r5py.TransportMode
    kind = mode["kind"]
    if kind == "walk":
        return {"transport_modes": [modes.WALK], "speed_walking": walk}
    if kind == "cycle":
        return {
            "transport_modes": [modes.BICYCLE],
            "speed_cycling": cycle,
            "max_bicycle_traffic_stress": int(mode.get("max_traffic_stress", 3)),
        }
    if kind == "transit":
        return {
            "transport_modes": [modes.TRANSIT],
            "access_modes": [modes.WALK],
            "egress_modes": [modes.WALK],
            "speed_walking": walk,
            "max_time_walking": dt.timedelta(minutes=int(mode.get("max_walk_minutes", 15))),
        }
    if kind == "car":
        return {"transport_modes": [modes.CAR]}
    raise SystemExit(f"Unknown mode kind: {kind}")


def _departure(settings: Settings, window: str | None) -> tuple[dt.datetime, dt.timedelta]:
    date = dt.date.fromisoformat(str(settings.routing["date"]))
    if window is None:
        # Walking, cycling and driving times do not depend on the clock in R5.
        return dt.datetime.combine(date, dt.time(10, 0)), dt.timedelta(minutes=10)
    spec = settings.routing["windows"][window]
    hour, minute = (int(part) for part in str(spec["start"]).split(":"))
    return dt.datetime.combine(date, dt.time(hour, minute)), dt.timedelta(minutes=int(spec["minutes"]))


def _points(table: pd.DataFrame):
    import geopandas as gpd

    unique = table.drop_duplicates("id")
    return gpd.GeoDataFrame(
        {"id": unique["id"].astype(str).to_numpy()},
        geometry=gpd.points_from_xy(unique["lon"], unique["lat"]),
        crs="EPSG:4326",
    )


def summarise_services(matrix: pd.DataFrame, services: pd.DataFrame) -> pd.DataFrame:
    """Nearest destination and counts within set times, per origin and service."""
    columns = ["origin", "service", "minutes", "nearest_id", *[f"n{t}" for t in SERVICE_COUNT_MINUTES]]
    reached = matrix.dropna(subset=["travel_time"])
    reached = reached.merge(services[["id", "service"]], left_on="to_id", right_on="id", how="inner")
    if reached.empty:
        return pd.DataFrame(columns=columns)
    reached = reached.sort_values(["from_id", "service", "travel_time"], kind="stable")
    out = reached.drop_duplicates(["from_id", "service"])[["from_id", "service", "travel_time", "to_id"]]
    out = out.rename(columns={"from_id": "origin", "travel_time": "minutes", "to_id": "nearest_id"})
    for limit in SERVICE_COUNT_MINUTES:
        counts = reached[reached["travel_time"] <= limit].groupby(["from_id", "service"]).size()
        counts = counts.rename(f"n{limit}").reset_index().rename(columns={"from_id": "origin"})
        out = out.merge(counts, on=["origin", "service"], how="left")
        out[f"n{limit}"] = out[f"n{limit}"].fillna(0).astype("int32")
    out["minutes"] = out["minutes"].astype("float32")
    return out[columns].reset_index(drop=True)


def summarise_jobs(matrix: pd.DataFrame, jobs: pd.DataFrame, thresholds: list[int]):
    """Jobs within each threshold per origin, plus the pairs inside the largest one."""
    reached = matrix.dropna(subset=["travel_time"]).copy()
    reached["jobs"] = reached["to_id"].map(jobs.set_index("id")["jobs"]).fillna(0.0)
    out = pd.DataFrame({"origin": pd.unique(matrix["from_id"])})
    for limit in thresholds:
        sums = reached[reached["travel_time"] <= limit].groupby("from_id")["jobs"].sum()
        out[f"jobs_{limit}"] = out["origin"].map(sums).fillna(0.0).astype("float32")
    pairs = reached.loc[reached["travel_time"] <= max(thresholds), ["from_id", "to_id", "travel_time"]]
    pairs = pairs.rename(columns={"from_id": "origin", "to_id": "destination", "travel_time": "minutes"})
    pairs["minutes"] = pairs["minutes"].astype("uint8")
    return out, pairs.reset_index(drop=True)


def run_tag(dataset: str, mode_id: str, window: str | None, transit: bool) -> str:
    return "_".join([dataset, *([window] if transit and window else []), mode_id])


def run(
    settings: Settings,
    dataset: str,
    mode_id: str,
    window: str | None = None,
    limit: int | None = None,
    force: bool = False,
) -> Path:
    prepare_java(settings)
    import r5py

    mode = settings.modes[mode_id]
    transit = mode["kind"] == "transit"
    if dataset == "jobs" and transit and window is None:
        window = settings.jobs["window"]
    if transit and window is None:
        raise SystemExit("Public transport runs need --window.")

    table = destinations.load_set(settings, dataset)
    if dataset == "services" and transit:
        # Each service is routed in the time window people would use it.
        wanted = [sid for sid, spec in settings.services.items() if spec.get("window") == window]
        table = table[table["service"].isin(wanted)]
    targets = _points(table)
    origins = load_origins(settings)
    tag = run_tag(dataset, mode_id, window, transit)
    if limit:
        origins = origins.head(limit)
        tag = f"{tag}_first{limit}"

    batch_dir = settings.output_dir / "routing" / "batches" / tag
    batch_dir.mkdir(parents=True, exist_ok=True)
    pairs_dir = settings.cache_dir / "pairs" / tag
    departure, window_length = _departure(settings, window if transit else None)
    kwargs = _mode_kwargs(r5py, mode, settings.routing)
    size = int(settings.routing.get("batch_size", 2000))
    max_minutes = int(settings.routing.get("max_minutes", 60))
    thresholds = [int(t) for t in settings.jobs["thresholds"]]

    log.info("%s: %d origins, %d destinations, departure %s + %s", tag, len(origins), len(targets), departure, window_length)
    gtfs, gtfs_left_out = prepare_gtfs(settings)
    network = r5py.TransportNetwork(settings.data("osm"), [gtfs])
    started = time.monotonic()
    for start in range(0, len(origins), size):
        path = batch_dir / f"origins_{start:06d}.parquet"
        if path.exists() and not force:
            continue
        chunk = origins.iloc[start : start + size]
        t0 = time.monotonic()
        try:
            matrix = pd.DataFrame(
                r5py.TravelTimeMatrix(
                    network,
                    origins=chunk[["id", "geometry"]],
                    destinations=targets,
                    departure=departure,
                    departure_time_window=window_length,
                    percentiles=[50],
                    max_time=dt.timedelta(minutes=max_minutes),
                    snap_to_network=True,
                    **kwargs,
                )
            )
        except ValueError as exc:
            if "no valid" not in str(exc):
                raise
            log.warning("%s batch %d: no origin could be placed on the network", tag, start)
            matrix = pd.DataFrame({"from_id": chunk["id"].to_numpy(), "to_id": None, "travel_time": np.nan})
        if dataset == "jobs":
            summary, pairs = summarise_jobs(matrix, table, thresholds)
            pairs_dir.mkdir(parents=True, exist_ok=True)
            pairs.to_parquet(pairs_dir / path.name, index=False)
        else:
            summary = summarise_services(matrix, table)
        tmp = path.with_name(path.stem + ".tmp.parquet")
        summary.to_parquet(tmp, index=False)
        tmp.replace(path)
        done = min(start + size, len(origins))
        log.info("%s: %d/%d origins, batch %.0fs", tag, done, len(origins), time.monotonic() - t0)

    batches = sorted(batch_dir.glob("origins_*[0-9].parquet"))
    result = pd.concat([pd.read_parquet(p) for p in batches], ignore_index=True)
    output = settings.out("routing", f"{tag}.parquet")
    result.to_parquet(output, index=False)
    manifest = {
        "tag": tag,
        "dataset": dataset,
        "mode": mode_id,
        "mode_settings": mode,
        "window": window,
        "departure": departure.isoformat(),
        "window_minutes": window_length.total_seconds() / 60,
        "max_minutes": max_minutes,
        "origins": int(len(origins)),
        "destinations": int(len(targets)),
        "rows": int(len(result)),
        "osm": str(settings.data("osm")),
        "gtfs": str(settings.data("gtfs")),
        "gtfs_copy": str(gtfs),
        "gtfs_left_out": gtfs_left_out,
        "r5py": getattr(r5py, "__version__", "unknown"),
        "elapsed_seconds_this_session": round(time.monotonic() - started, 1),
        "written": dt.datetime.now().isoformat(timespec="seconds"),
    }
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2, default=str))
    log.info("%s: wrote %s", tag, output)
    return output


def plan(settings: Settings) -> list[tuple[str, str, str | None]]:
    """Every routing run needed for a full build, cheapest first."""
    runs: list[tuple[str, str, str | None]] = []
    for mode_id in ("walk", "bike_low_stress", "bike", "car"):
        runs.append(("services", mode_id, None))
    for window in sorted({spec["window"] for spec in settings.services.values()}):
        runs.append(("services", "pt", window))
    for mode_id in settings.jobs["modes"]:
        window = settings.jobs["window"] if settings.modes[mode_id]["kind"] == "transit" else None
        runs.append(("jobs", mode_id, window))
    return runs


def run_plan(settings: Settings, force: bool = False, only: list[str] | None = None) -> None:
    for dataset, mode_id, window in plan(settings):
        tag = run_tag(dataset, mode_id, window, window is not None)
        if only and tag not in only:
            continue
        if settings.out("routing", f"{tag}.parquet").exists() and not force:
            log.info("%s: already done", tag)
            continue
        run(settings, dataset, mode_id, window, force=force)
