"""Door-to-door travel times with R5, via r5py.

Each run routes every origin cell to one destination set by one mode and keeps
per-origin summaries only:

* services: minutes to the nearest destination of each type, which one it
  was, and how many are reachable within 10, 15, 20 and 30 minutes;
* jobs: jobs reachable within each configured threshold. Origin-destination
  pairs inside the largest threshold are also kept, in the cache directory,
  for the competition-adjusted job measure.

Batches are written as they finish, so a stopped run resumes where it left off.
r5py routes one origin at a time within a process, so long runs can be split
across processes with `shard`; a later unsharded run combines the batches.
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
    """Point r5py at the configured JDK and heap size. Call before importing r5py.

    TEAM_MAX_MEMORY overrides routing.max_memory, for running several
    processes at once.
    """
    java_home = settings.routing.get("java_home")
    if java_home and not os.environ.get("JAVA_HOME") and Path(java_home).exists():
        os.environ["JAVA_HOME"] = java_home
    memory = os.environ.get("TEAM_MAX_MEMORY") or settings.routing.get("max_memory")
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
    tmp = target.with_suffix(f".{os.getpid()}.tmp")
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


def batch_starts(total: int, size: int, shard: tuple[int, int] | None = None) -> list[int]:
    """First origin of each batch this process should route.

    With `shard=(i, n)`, only every n-th batch from the i-th (counting from 0)
    is kept, so n processes can share a run without routing the same origins.
    """
    starts = list(range(0, total, size))
    if shard is None:
        return starts
    i, n = shard
    return starts[i::n]


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
    # A mode can walk at its own pace, as public transport at a slower walking
    # pace does; otherwise every mode walks at the model's speed.
    walk = float(mode.get("speed_walking_kmh", routing.get("speed_walking_kmh", 4.8)))
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


def network_inputs(settings: Settings, mode: dict) -> dict:
    """The street network and elevation a mode is routed on.

    Hills change walking and cycling times, and so the walks to and from
    public transport, but not driving. A place can give cycling its own
    network file, as Auckland does to carry SPAN's traffic stress ratings,
    without re-routing the modes that do not read them.
    """
    data = settings.raw["data"]
    kind = mode["kind"]
    osm = "osm_cycling" if kind == "cycle" and data.get("osm_cycling") else "osm"
    elevation = data.get("elevation") if kind in ("walk", "cycle", "transit") else None
    return {"osm": str(settings.data(osm)), "elevation": str(settings.data("elevation")) if elevation else None}


def _network(r5py, settings: Settings, mode: dict, gtfs: Path):
    inputs = network_inputs(settings, mode)
    kwargs = {}
    if inputs["elevation"]:
        cost = str(settings.routing.get("elevation_cost", "tobler")).upper()
        # A path, not a string: r5py treats any iterable as a list of files.
        kwargs = {"elevation_model": Path(inputs["elevation"]), "elevation_cost_function": r5py.ElevationCostFunction(cost)}
    return r5py.TransportNetwork(inputs["osm"], [gtfs], **kwargs)


def _same_network(record: dict, current: dict) -> bool:
    """Whether a finished run was routed on the network it would be now.

    Runs from before networks were recorded were routed on the plain street
    file with no elevation.
    """
    previous = record.get("network") or {"osm": record.get("osm"), "elevation": None}
    return previous == current


def _departure(settings: Settings, window: str | None) -> tuple[dt.datetime, dt.timedelta]:
    date = dt.date.fromisoformat(str(settings.routing["date"]))
    if window is None:
        # Walking, cycling and driving times do not depend on the clock in R5.
        return dt.datetime.combine(date, dt.time(10, 0)), dt.timedelta(minutes=10)
    spec = settings.routing["windows"][window]
    # A weekend window cannot run on the weekday the rest of the model uses,
    # so a window may name its own date.
    if spec.get("date"):
        date = dt.date.fromisoformat(str(spec["date"]))
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


def summarise_services(matrix: pd.DataFrame, services: pd.DataFrame, pair_minutes: int | None = None):
    """Nearest destination and counts per origin and service, plus every pair
    inside `pair_minutes` for the gravity scores."""
    columns = ["origin", "service", "minutes", "nearest_id", *[f"n{t}" for t in SERVICE_COUNT_MINUTES]]
    pair_columns = ["origin", "destination", "service", "minutes"]
    reached = matrix.dropna(subset=["travel_time"])
    reached = reached.merge(services[["id", "service"]], left_on="to_id", right_on="id", how="inner")
    if reached.empty:
        return pd.DataFrame(columns=columns), pd.DataFrame(columns=pair_columns)
    reached = reached.sort_values(["from_id", "service", "travel_time"], kind="stable")
    out = reached.drop_duplicates(["from_id", "service"])[["from_id", "service", "travel_time", "to_id"]]
    out = out.rename(columns={"from_id": "origin", "travel_time": "minutes", "to_id": "nearest_id"})
    for limit in SERVICE_COUNT_MINUTES:
        counts = reached[reached["travel_time"] <= limit].groupby(["from_id", "service"]).size()
        counts = counts.rename(f"n{limit}").reset_index().rename(columns={"from_id": "origin"})
        out = out.merge(counts, on=["origin", "service"], how="left")
        out[f"n{limit}"] = out[f"n{limit}"].fillna(0).astype("int32")
    out["minutes"] = out["minutes"].astype("float32")
    limit = int(pair_minutes) if pair_minutes else int(reached["travel_time"].max())
    pairs = reached.loc[reached["travel_time"] <= limit, ["from_id", "to_id", "service", "travel_time"]]
    pairs = pairs.rename(columns={"from_id": "origin", "to_id": "destination", "travel_time": "minutes"})
    pairs["minutes"] = pairs["minutes"].astype("uint8")
    return out[columns].reset_index(drop=True), pairs[pair_columns].reset_index(drop=True)


def summarise_jobs(matrix: pd.DataFrame, jobs: pd.DataFrame, thresholds: list[int], pair_minutes: int | None = None):
    """Jobs within each threshold per origin, plus the pairs inside `pair_minutes`."""
    reached = matrix.dropna(subset=["travel_time"]).copy()
    reached["jobs"] = reached["to_id"].map(jobs.set_index("id")["jobs"]).fillna(0.0)
    out = pd.DataFrame({"origin": pd.unique(matrix["from_id"])})
    for limit in thresholds:
        sums = reached[reached["travel_time"] <= limit].groupby("from_id")["jobs"].sum()
        out[f"jobs_{limit}"] = out["origin"].map(sums).fillna(0.0).astype("float32")
    limit = int(pair_minutes) if pair_minutes else max(thresholds)
    pairs = reached.loc[reached["travel_time"] <= limit, ["from_id", "to_id", "travel_time"]]
    pairs = pairs.rename(columns={"from_id": "origin", "to_id": "destination", "travel_time": "minutes"})
    pairs["minutes"] = pairs["minutes"].astype("uint8")
    return out, pairs.reset_index(drop=True)


def service_windows(spec: dict) -> list[str]:
    """The windows a service is routed in by public transport, usual one first.

    `window` is when people would normally make the trip, and every measure
    that shows one time uses it. `windows` adds other times the same trip is
    worth checking, such as a Saturday for a supermarket. A school run has no
    Saturday, so a service lists only the times that make sense for it.
    """
    usual = str(spec["window"])
    extra = [str(w) for w in spec.get("windows", []) if str(w) != usual]
    return [usual, *extra]


def job_windows(settings: Settings) -> list[str]:
    """The windows job access is routed in by public transport, usual one first."""
    return service_windows(settings.jobs)


def all_windows(settings: Settings) -> list[str]:
    """Every window some public transport run uses, in config order."""
    used = {w for spec in settings.services.values() for w in service_windows(spec)} | set(job_windows(settings))
    return [w for w in settings.routing["windows"] if w in used]


def run_tag(dataset: str, mode_id: str, window: str | None, transit: bool) -> str:
    return "_".join([dataset, *([window] if transit and window else []), mode_id])


def _targets(settings: Settings, dataset: str, window: str | None):
    """The destinations one run routes to, as a table and as points."""
    if dataset in ("links", "returns"):
        table = chain_stops(settings)
        return table, _points(table)
    table = destinations.load_set(settings, dataset)
    if dataset == "services" and window is not None:
        # Each service is routed in the windows it lists.
        wanted = [sid for sid, spec in settings.services.items() if window in service_windows(spec)]
        table = table[table["service"].isin(wanted)]
    return table, _points(table)


def scope_digest(targets) -> str:
    """A short fingerprint of the destinations a run routes to."""
    return hashlib.sha256("\n".join(sorted(targets["id"])).encode("utf-8")).hexdigest()[:16]


def is_current(settings: Settings, dataset: str, mode_id: str, window: str | None) -> bool:
    """Whether a finished run still covers the destinations it should.

    Runs finished before fingerprints were recorded are judged on their
    destination count, which is enough to notice a service added to a window.
    """
    tag = run_tag(dataset, mode_id, window, window is not None)
    output = settings.out("routing", f"{tag}.parquet")
    manifest = output.with_suffix(".json")
    if not output.exists() or not manifest.exists():
        return False
    record = json.loads(manifest.read_text())
    if not _same_network(record, network_inputs(settings, settings.modes[mode_id])):
        return False
    _, targets = _targets(settings, dataset, window)
    if "scope" in record:
        return record["scope"] == scope_digest(targets)
    return int(record.get("destinations", -1)) == len(targets)


def _check_scope(batch_dir: Path, pairs_dir: Path, targets, tag: str, network: dict | None = None) -> None:
    """Start a run afresh when the destinations it routes to have changed.

    Finished batches are kept so a stopped run can resume, which is only safe
    while the run is routing to the same places. When a service is added to a
    window, the old batches are missing it, so they are cleared rather than
    quietly reused.
    """
    digest = scope_digest(targets)
    record = batch_dir / "scope.json"
    if record.exists():
        saved = json.loads(record.read_text())
        previous = saved.get("destinations")
        # Batches routed on another network, such as before elevation was
        # added, would mix two sets of times in one run. Records from before
        # networks were noted were routed on this street file with no
        # elevation, the same rule is_current applies.
        if network is not None and "network" not in saved:
            saved = {**saved, "network": {"osm": network["osm"], "elevation": None}}
        moved = network is not None and not _same_network(saved, network)
        if previous != digest or moved:
            stale = list(batch_dir.glob("origins_*.parquet")) + list(pairs_dir.glob("origins_*.parquet"))
            log.info("%s: %s changed, clearing %d finished batches", tag, "network" if moved else "destinations", len(stale))
            for path in stale:
                path.unlink()
    elif any(batch_dir.glob("origins_*.parquet")):
        # Batches from before scopes were recorded: nothing says what they
        # cover, so they are routed again.
        stale = list(batch_dir.glob("origins_*.parquet")) + list(pairs_dir.glob("origins_*.parquet"))
        log.info("%s: no record of what earlier batches covered, clearing %d", tag, len(stale))
        for path in stale:
            path.unlink()
    record.write_text(json.dumps({"destinations": digest, "count": int(len(targets)), "network": network}))


def run(
    settings: Settings,
    dataset: str,
    mode_id: str,
    window: str | None = None,
    limit: int | None = None,
    force: bool = False,
    shard: tuple[int, int] | None = None,
) -> Path | None:
    """Route one run. With `shard`, route only that share of the batches and
    leave combining to a later run without it."""
    prepare_java(settings)
    import r5py

    mode = settings.modes[mode_id]
    transit = mode["kind"] == "transit"
    if dataset == "links":
        return run_links(settings, mode_id, window, force=force)
    if dataset == "returns":
        return run_returns(settings, mode_id, force=force)
    if dataset == "jobs" and transit and window is None:
        window = settings.jobs["window"]
    if transit and window is None:
        raise SystemExit("Public transport runs need --window.")

    table, targets = _targets(settings, dataset, window if transit else None)
    origins = load_origins(settings)
    tag = run_tag(dataset, mode_id, window, transit)
    if limit:
        origins = origins.head(limit)
        tag = f"{tag}_first{limit}"

    batch_dir = settings.output_dir / "routing" / "batches" / tag
    batch_dir.mkdir(parents=True, exist_ok=True)
    pairs_dir = settings.cache_dir / "pairs" / tag
    network_used = network_inputs(settings, mode)
    _check_scope(batch_dir, pairs_dir, targets, tag, network_used)
    departure, window_length = _departure(settings, window if transit else None)
    kwargs = _mode_kwargs(r5py, mode, settings.routing)
    size = int(settings.routing.get("batch_size", 2000))
    max_minutes = int(settings.routing.get("max_minutes", 60))
    thresholds = [int(t) for t in settings.jobs["thresholds"]]
    starts = batch_starts(len(origins), size, shard)
    todo = [s for s in starts if force or not (batch_dir / f"origins_{s:06d}.parquet").exists()]

    log.info("%s: %d origins, %d destinations, departure %s + %s", tag, len(origins), len(targets), departure, window_length)
    if shard is not None:
        log.info("%s: shard %d/%d, %d of %d batches to route", tag, shard[0] + 1, shard[1], len(todo), len(starts))
    started = time.monotonic()
    gtfs, gtfs_left_out = prepare_gtfs(settings)
    if todo:
        network = _network(r5py, settings, mode, gtfs)
    for start in todo:
        path = batch_dir / f"origins_{start:06d}.parquet"
        if path.exists() and not force:
            continue  # another process finished it meanwhile
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
            summary, pairs = summarise_jobs(matrix, table, thresholds, max_minutes)
        else:
            summary, pairs = summarise_services(matrix, table, max_minutes)
        pairs_dir.mkdir(parents=True, exist_ok=True)
        pairs_tmp = pairs_dir / f"{path.stem}.{os.getpid()}.tmp.parquet"
        pairs.to_parquet(pairs_tmp, index=False)
        pairs_tmp.replace(pairs_dir / path.name)
        tmp = path.with_name(f"{path.stem}.{os.getpid()}.tmp.parquet")
        summary.to_parquet(tmp, index=False)
        tmp.replace(path)
        done = min(start + size, len(origins))
        log.info("%s: %d/%d origins, batch %.0fs", tag, done, len(origins), time.monotonic() - t0)

    if shard is not None:
        log.info("%s: shard %d/%d done; run again without --shard to combine", tag, shard[0] + 1, shard[1])
        return None

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
        "scope": scope_digest(targets),
        "rows": int(len(result)),
        "osm": network_used["osm"],
        "network": network_used,
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


def chain_link_modes(settings: Settings) -> list[str]:
    """Modes routed between the stops of an errand round.

    Walking is always needed, since a public transport round walks any leg
    walking does faster. Public transport at a slower pace is routed when the
    place has it.
    """
    chains = settings.raw.get("chains") or {}
    wanted = ["walk", *[m for m in chains.get("modes", []) if m != "walk"]]
    if "pt" in wanted and "pt_slow" in settings.modes:
        wanted.append("pt_slow")
    return [m for m in dict.fromkeys(wanted) if m in settings.modes]


def chain_return_modes(settings: Settings) -> list[str]:
    """Modes whose way home from the last stop is routed rather than assumed.

    With hills, a walk or ride home can take longer than the way out. Public
    transport's way home is taken as the way out.
    """
    return [m for m in chain_link_modes(settings) if settings.modes[m]["kind"] in ("walk", "cycle")]


def chain_stops(settings: Settings) -> pd.DataFrame:
    """The destinations an errand round can stop at."""
    stops = [str(s) for s in (settings.raw.get("chains") or {}).get("stops", [])]
    table = destinations.load_set(settings, "services")
    return table[table["service"].isin(stops)]


def run_links(settings: Settings, mode_id: str, window: str | None, force: bool = False) -> Path:
    """Travel times between every pair of stops an errand round can use.

    The legs from home come from the service runs already routed; these are
    the legs between one stop and the next. The stops are both the origins
    and the destinations, so this is a small run next to the ones from homes.
    """
    prepare_java(settings)
    import r5py

    mode = settings.modes[mode_id]
    transit = mode["kind"] == "transit"
    tag = run_tag("links", mode_id, window, transit)
    output = settings.out("routing", f"{tag}.parquet")
    stops = chain_stops(settings)
    points = _points(stops)
    network_used = network_inputs(settings, mode)
    departure, window_length = _departure(settings, window if transit else None)
    max_minutes = int(settings.routing.get("max_minutes", 60))
    gtfs, _ = prepare_gtfs(settings)
    log.info("%s: %d stops, departure %s + %s", tag, len(points), departure, window_length)
    started = time.monotonic()
    network = _network(r5py, settings, mode, gtfs)
    matrix = pd.DataFrame(
        r5py.TravelTimeMatrix(
            network,
            origins=points,
            destinations=points,
            departure=departure,
            departure_time_window=window_length,
            percentiles=[50],
            max_time=dt.timedelta(minutes=max_minutes),
            snap_to_network=True,
            **_mode_kwargs(r5py, mode, settings.routing),
        )
    )
    links = matrix.dropna(subset=["travel_time"]).rename(columns={"from_id": "origin", "to_id": "destination", "travel_time": "minutes"})
    links = links[["origin", "destination", "minutes"]].astype({"origin": str, "destination": str})
    links["minutes"] = links["minutes"].astype("uint8")
    links.to_parquet(output, index=False)
    manifest = {
        "tag": tag, "dataset": "links", "mode": mode_id, "mode_settings": mode, "window": window,
        "departure": departure.isoformat(), "window_minutes": window_length.total_seconds() / 60,
        "max_minutes": max_minutes, "origins": int(len(points)), "destinations": int(len(points)),
        "scope": scope_digest(points), "rows": int(len(links)), "osm": network_used["osm"], "network": network_used,
        "gtfs": str(settings.data("gtfs")), "r5py": getattr(r5py, "__version__", "unknown"),
        "elapsed_seconds_this_session": round(time.monotonic() - started, 1),
        "written": dt.datetime.now().isoformat(timespec="seconds"),
    }
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2, default=str))
    log.info("%s: wrote %s (%d legs)", tag, output, len(links))
    return output


def run_returns(settings: Settings, mode_id: str, force: bool = False) -> Path:
    """The way home from each errand stop to the homes that could use it.

    Routed from the stops to the hexagons, in batches of stops, and kept only
    for pairs the way out already reached, which are the only ones a round can
    use. Hills make the way home differ from the way out.
    """
    prepare_java(settings)
    import r5py

    mode = settings.modes[mode_id]
    tag = run_tag("returns", mode_id, None, False)
    output = settings.out("routing", f"{tag}.parquet")
    stops = chain_stops(settings)
    points = _points(stops)
    homes = load_origins(settings)[["id", "geometry"]]
    network_used = network_inputs(settings, mode)
    max_minutes = int(settings.routing.get("max_minutes", 60))
    departure, window_length = _departure(settings, None)

    # The pairs the way out reached, turned round.
    folder = settings.cache_dir / "pairs" / run_tag("services", mode_id, None, False)
    out_pairs = pd.concat([pd.read_parquet(f) for f in sorted(folder.glob("origins_*[0-9].parquet"))], ignore_index=True)
    wanted = set(stops["id"].astype(str))
    out_pairs = out_pairs[out_pairs["destination"].astype(str).isin(wanted)]
    reached = set(zip(out_pairs["destination"].astype(str), out_pairs["origin"].astype(str)))

    gtfs, _ = prepare_gtfs(settings)
    network = _network(r5py, settings, mode, gtfs)
    started = time.monotonic()
    kept = []
    size = 50
    for start in range(0, len(points), size):
        chunk = points.iloc[start : start + size]
        matrix = pd.DataFrame(
            r5py.TravelTimeMatrix(
                network,
                origins=chunk,
                destinations=homes,
                departure=departure,
                departure_time_window=window_length,
                percentiles=[50],
                max_time=dt.timedelta(minutes=max_minutes),
                snap_to_network=True,
                **_mode_kwargs(r5py, mode, settings.routing),
            )
        ).dropna(subset=["travel_time"])
        pairs = list(zip(matrix["from_id"].astype(str), matrix["to_id"].astype(str)))
        keep = np.fromiter((pair in reached for pair in pairs), dtype=bool, count=len(pairs))
        part = matrix.loc[keep, ["from_id", "to_id", "travel_time"]]
        kept.append(part.rename(columns={"from_id": "origin", "to_id": "destination", "travel_time": "minutes"}))
        log.info("%s: %d/%d stops", tag, min(start + size, len(points)), len(points))
    table = pd.concat(kept, ignore_index=True) if kept else pd.DataFrame(columns=["origin", "destination", "minutes"])
    table = table.astype({"origin": str, "destination": str})
    table["minutes"] = table["minutes"].astype("uint8")
    table.to_parquet(output, index=False)
    manifest = {
        "tag": tag, "dataset": "returns", "mode": mode_id, "mode_settings": mode, "window": None,
        "max_minutes": max_minutes, "origins": int(len(points)), "destinations": int(len(homes)),
        "scope": scope_digest(points), "rows": int(len(table)), "osm": network_used["osm"], "network": network_used,
        "r5py": getattr(r5py, "__version__", "unknown"),
        "elapsed_seconds_this_session": round(time.monotonic() - started, 1),
        "written": dt.datetime.now().isoformat(timespec="seconds"),
    }
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2, default=str))
    log.info("%s: wrote %s (%d legs home)", tag, output, len(table))
    return output


def plan(settings: Settings) -> list[tuple[str, str, str | None]]:
    """Every routing run needed for a full build, cheapest first."""
    runs: list[tuple[str, str, str | None]] = []
    for mode_id in ("walk", "bike_low_stress", "bike", "car"):
        runs.append(("services", mode_id, None))
    slow = "pt_slow" in settings.modes
    for window in all_windows(settings):
        if any(window in service_windows(spec) for spec in settings.services.values()):
            runs.append(("services", "pt", window))
            if slow:
                runs.append(("services", "pt_slow", window))
    for mode_id in settings.jobs["modes"]:
        if settings.modes[mode_id]["kind"] == "transit":
            runs += [("jobs", mode_id, window) for window in job_windows(settings)]
        else:
            runs.append(("jobs", mode_id, None))
    chains = settings.raw.get("chains")
    if chains:
        for mode_id in chain_link_modes(settings):
            transit = settings.modes[mode_id]["kind"] == "transit"
            runs.append(("links", mode_id, str(chains["window"]) if transit else None))
        for mode_id in chain_return_modes(settings):
            runs.append(("returns", mode_id, None))
    return runs


def run_plan(
    settings: Settings,
    force: bool = False,
    only: list[str] | None = None,
    shard: tuple[int, int] | None = None,
) -> None:
    for dataset, mode_id, window in plan(settings):
        tag = run_tag(dataset, mode_id, window, window is not None)
        if only and tag not in only:
            continue
        if not force and is_current(settings, dataset, mode_id, window):
            log.info("%s: already done", tag)
            continue
        run(settings, dataset, mode_id, window, force=force, shard=shard)
