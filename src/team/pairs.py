"""Cell to cell travel times, and the public transport path behind each one.

TEAM's routing runs keep a summary for each cell. These runs keep the pairs,
for trips between two cells and for MATE's walks to and from stops:

* walking, cycling on low-stress routes and cycling on any bikeable street:
  every cell reached within 20 minutes, from every cell;
* public transport in each window: every cell reached within 45 minutes, from
  cells in urban areas, with the path R5 used most often in the window.

The limits and which cells public transport is routed from are set under
`pairs:` in the configuration. Destinations are all of TEAM's cells. A time
is the median over the window, as in TEAM's other runs, so a pair is kept when
more than half the departure minutes reach it within the limit.

Batches are written to the cache as they finish, so a stopped run resumes, and
`shard` splits a run across processes as `routing.run` does. A run without
`shard` combines the batches into one parquet per run, which `write_site`
tiles for the web app by the resolution 7 parent of the origin cell. The
format is described in docs/pairs.md.

Path results
------------
For each departure minute in the window, R5 can record which routes and stops
the quickest trip to each destination used. r5py does not expose this, so
`PathHook` sets the flag on R5's task and reads the result through jpype. It
is the only place TEAM does this. It relies on internals of both r5py and R5,
so the versions are pinned: r5py 1.1.3 (the `pairs` extra in pyproject.toml)
with R5 v7.5-r5py (r5-v7.5-r5py-all.jar, sha256 70c89e57...e4d5), and
`check_versions` stops a run on anything else. R5 gives path results for at
most 5,000 destinations an origin, so destinations go in groups of 5,000.

Of the paths R5 records for a pair, the one used in the most departure
minutes is kept, with its typical trip: the departure minute whose total wait
is nearest the mean wait for that path (R5's MEAN summary). The parts of that
trip add up to its own total, which can differ by a few minutes from the
median time for the pair.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import routing
from .config import Settings

log = logging.getLogger("team.pairs")

R5PY_VERSION = "1.1.3"
R5_VERSION = "v7.5-r5py"
R5_JAR_SHA256 = "70c89e57f9f98dd96c9d2be5fdc00d53a133893b2620e0d8d05e3e602f34e4d5"
PATH_DESTINATIONS = 5000  # R5's PathResult.MAX_PATH_DESTINATIONS
BATCH_SIZE = 500
TILE_RESOLUTION = 7
FORMAT = 1
STREET_MODES = ("walk", "bike_low_stress", "bike")

# One row per pair. Times alone for walking and cycling; public transport adds
# the path. Minute parts are floats; iterations are departure minutes.
TIME_COLUMNS = ["origin", "destination", "minutes"]
PATH_COLUMNS = [
    "legs", "routes", "board", "alight", "boards", "alights", "rides", "waits",
    "access", "egress", "transfer", "wait", "ride", "total", "iters", "reached", "paths",
]


def spec(settings: Settings) -> dict | None:
    """The `pairs:` block of the configuration, or None where there is none."""
    return settings.raw.get("pairs")


def limits(settings: Settings) -> dict[str, int]:
    return {str(k): int(v) for k, v in (spec(settings) or {}).get("minutes", {}).items()}


def runs(settings: Settings) -> list[tuple[str, str, str | None]]:
    """Every pairs run as (tag, mode, window), cheapest first."""
    minutes = limits(settings)
    out = [(m, m, None) for m in STREET_MODES if m in minutes and m in settings.modes]
    if "pt" in minutes and "pt" in settings.modes:
        out += [(f"pt_{w}", "pt", w) for w in settings.routing["windows"]]
    return out


def cache_dir(settings: Settings) -> Path:
    return settings.cache_dir / "cell_pairs"


def order_digest(ids) -> str:
    """A fingerprint of TEAM's cell order, which the tiles' cell indices follow."""
    return hashlib.sha256("\n".join(map(str, ids)).encode("utf-8")).hexdigest()[:16]


def team_cells(settings: Settings):
    """TEAM's cells in TEAM's order (the order of cells.json), with the urban flag."""
    cells = routing.load_origins(settings)
    built = settings.output_dir / "team_cells.parquet"
    if not built.exists():
        raise SystemExit(f"{built} is missing. Run `team build` first: pairs use its cells and urban flag.")
    table = pd.read_parquet(built, columns=["urban"])
    if list(table.index.astype(str)) != list(cells["id"]):
        raise SystemExit("team_cells.parquet lists other cells than routing would. Run `team build` again.")
    cells["urban"] = table["urban"].fillna(False).to_numpy(dtype=bool)
    return cells


def origins_for(settings: Settings, cells, mode_id: str):
    """The cells a run routes from: every cell, or only urban ones for public
    transport when the configuration says so."""
    if mode_id == "pt" and str((spec(settings) or {}).get("pt_origins", "all")) == "urban":
        return cells[cells["urban"]].reset_index(drop=True)
    return cells.reset_index(drop=True)


def check_versions(r5py) -> dict:
    """Stop unless r5py and R5 are the versions the path hook was written for."""
    import jpype

    from r5py.util.classpath import R5_CLASSPATH

    r5 = str(jpype.JClass("com.conveyal.r5.SoftwareVersion").instance.version)
    jar = Path(str(R5_CLASSPATH))
    digest = hashlib.sha256(jar.read_bytes()).hexdigest() if jar.is_file() else None
    found = {"r5py": str(r5py.__version__), "r5": r5, "r5_jar": jar.name, "r5_jar_sha256": digest}
    if found["r5py"] != R5PY_VERSION or r5 != R5_VERSION or digest != R5_JAR_SHA256:
        raise SystemExit(
            f"Path results are read through parts of r5py and R5 that are not public, and were written for "
            f"r5py {R5PY_VERSION} with R5 {R5_VERSION} ({R5_JAR_SHA256[:12]}...). Found {found}."
        )
    return found


class PathHook:
    """R5's regional path results, read through r5py's RegionalTask.

    The one place TEAM uses parts of r5py and R5 that are not public: it sets
    `includePathResults` on the Java task r5py builds, runs R5's
    TravelTimeComputer itself, and reads `PathResult.summarizeIterations`.
    """

    def __init__(self, r5py, network, departure, window_length, minutes: int, kwargs: dict):
        import jpype

        self.r5py = r5py
        self.network = network
        self.task_args = dict(
            departure=departure, departure_time_window=window_length, percentiles=[50],
            max_time=dt.timedelta(minutes=minutes), **kwargs,
        )
        self.PathResult = jpype.JClass("com.conveyal.r5.analyst.cluster.PathResult")
        self.CsvResultOptions = jpype.JClass("com.conveyal.analysis.models.CsvResultOptions")
        self.TravelTimeComputer = jpype.JClass("com.conveyal.r5.analyst.TravelTimeComputer")
        self.columns = [str(c) for c in self.PathResult.DATA_COLUMNS]

    def rows(self, origin, destinations) -> dict[str, list[dict]]:
        """Every path recorded from `origin` (a point on the network) to each
        destination (id and point), as R5 summarises them."""
        out: dict[str, list[dict]] = {}
        for start in range(0, len(destinations), PATH_DESTINATIONS):
            group = destinations.iloc[start:start + PATH_DESTINATIONS]
            task = self.r5py.RegionalTask(self.network, origin=origin, destinations=group, **self.task_args)
            task._regional_task.includePathResults = True
            task._regional_task.csvResultOptions = self.CsvResultOptions()
            result = self.TravelTimeComputer(task, self.network).computeTravelTimes()
            summary = None if result.paths is None else result.paths.summarizeIterations(self.PathResult.Stat.MEAN)
            for i, destination in enumerate(group["id"]):
                found = [] if summary is None else summary[i]
                out[str(destination)] = [dict(zip(self.columns, (str(v) for v in row))) for row in found]
        return out


def _minutes(value: str | None) -> float | None:
    if value is None or value in ("", "None", "null"):
        return None
    return round(float(value), 1)


def _parts(value: str | None) -> list[float]:
    return [float(v) for v in str(value or "").split("|") if v not in ("", "None")]


def most_used(rows: list[dict]) -> dict:
    """The path used in the most departure minutes, ties going to the quicker.

    A path with no routes is walking all the way, which in some departure
    minutes beats waiting. With no rows at all, R5 found the destination on
    foot without searching public transport (no stop near the origin).
    """
    empty = {
        "legs": 0, "routes": "", "board": None, "alight": None, "boards": "", "alights": "", "rides": "",
        "waits": "", "access": None, "egress": None, "transfer": None, "wait": None, "ride": None,
        "total": None, "iters": None, "reached": None, "paths": 0,
    }
    if not rows:
        return empty
    iters = [int(float(r.get("nIterations") or 0)) for r in rows]
    totals = [float(r.get("totalTime") or "inf") for r in rows]
    best = min(range(len(rows)), key=lambda k: (-iters[k], totals[k]))
    row = rows[best]
    out = {**empty, "total": _minutes(row.get("totalTime")), "iters": iters[best], "reached": sum(iters),
           "paths": len(rows)}
    routes = str(row.get("routes") or "")
    if not routes:
        return out
    boards = str(row.get("boardStops") or "").split("|")
    alights = str(row.get("alightStops") or "").split("|")
    rides, waits = _parts(row.get("rideTimes")), _parts(row.get("waitTimes"))
    out.update(
        legs=len(routes.split("|")), routes=routes, board=boards[0], alight=alights[-1],
        boards="|".join(boards), alights="|".join(alights),
        rides=str(row.get("rideTimes") or ""), waits=str(row.get("waitTimes") or ""),
        access=_minutes(row.get("accessTime")), egress=_minutes(row.get("egressTime")),
        transfer=_minutes(row.get("transferTime")), wait=round(sum(waits), 1), ride=round(sum(rides), 1),
    )
    return out


def _matrix(r5py, network, chunk, destinations, departure, window_length, minutes: int, kwargs: dict) -> pd.DataFrame:
    """Pairs reached within `minutes`, by r5py's public travel time matrix."""
    try:
        matrix = pd.DataFrame(
            r5py.TravelTimeMatrix(
                network,
                origins=chunk[["id", "geometry"]],
                destinations=destinations[["id", "geometry"]],
                departure=departure,
                departure_time_window=window_length,
                percentiles=[50],
                max_time=dt.timedelta(minutes=minutes),
                snap_to_network=True,
                **kwargs,
            )
        )
    except ValueError as exc:
        if "no valid" not in str(exc):
            raise
        return pd.DataFrame({c: pd.Series(dtype=t) for c, t in zip(TIME_COLUMNS, (str, str, "uint8"))})
    reached = matrix.dropna(subset=["travel_time"])
    reached = reached[reached["travel_time"] <= minutes]
    out = pd.DataFrame({
        "origin": reached["from_id"].astype(str).to_numpy(),
        "destination": reached["to_id"].astype(str).to_numpy(),
        "minutes": reached["travel_time"].astype("uint8").to_numpy(),
    })
    return out.sort_values(["origin", "destination"], kind="stable").reset_index(drop=True)


def typed(table: pd.DataFrame) -> pd.DataFrame:
    """Compact column types for the parquet files."""
    table = table.copy()
    table["minutes"] = table["minutes"].astype("uint8")
    if "legs" in table:
        table["legs"] = table["legs"].astype("uint8")
        table["paths"] = table["paths"].astype("uint8")
        for column in ("iters", "reached"):
            table[column] = pd.to_numeric(table[column], errors="coerce").astype("Int16")
        for column in ("access", "egress", "transfer", "wait", "ride", "total"):
            table[column] = pd.to_numeric(table[column], errors="coerce").astype("float32")
        for column in ("routes", "boards", "alights", "rides", "waits"):
            table[column] = table[column].fillna("").astype(str)
        for column in ("board", "alight"):
            table[column] = table[column].astype("string")
    return table


def _paths(hook: PathHook, times: pd.DataFrame, snapped: dict) -> pd.DataFrame:
    """The most used path for every pair in `times`."""
    import geopandas as gpd

    records, index = [], []
    for origin, group in times.groupby("origin", sort=False):
        point = snapped.get(origin)
        wanted = [d for d in group["destination"] if d != origin and d in snapped]
        rows: dict[str, list[dict]] = {}
        if point is not None and wanted:
            targets = gpd.GeoDataFrame({"id": wanted}, geometry=[snapped[d] for d in wanted], crs="EPSG:4326")
            rows = hook.rows(point, targets)
        for i, destination in zip(group.index, group["destination"]):
            record = most_used(rows.get(destination, []))
            if destination == origin:
                record["total"] = 0.0
            records.append(record)
            index.append(i)
    table = pd.DataFrame.from_records(records, columns=PATH_COLUMNS, index=index).reindex(times.index)
    return typed(pd.concat([times, table], axis=1))


def _scope(settings: Settings, tag: str, mode: dict, window: str | None, minutes: int, origins, cells) -> dict:
    departure, window_length = routing._departure(settings, window)
    return {
        "tag": tag,
        "minutes": minutes,
        "mode": mode,
        "departure": departure.isoformat(),
        "window_minutes": window_length.total_seconds() / 60,
        "network": routing.network_inputs(settings, mode),
        "gtfs": str(settings.data("gtfs")) if mode["kind"] == "transit" else None,
        "origins": order_digest(origins["id"]),
        "destinations": order_digest(cells["id"]),
        "format": FORMAT,
    }


def _check_scope(folder: Path, scope: dict) -> None:
    """Start afresh when what a run routes has changed since its batches were written."""
    record = folder / "scope.json"
    if record.exists() and json.loads(record.read_text()) != scope:
        stale = list(folder.glob("origins_*.parquet"))
        log.info("%s: run changed, clearing %d finished batches", scope["tag"], len(stale))
        for path in stale:
            path.unlink()
    record.write_text(json.dumps(scope, indent=2, default=str))


def run(settings: Settings, tag: str, mode_id: str, window: str | None, limit: int | None = None,
        force: bool = False, shard: tuple[int, int] | None = None) -> Path | None:
    """Route one pairs run, or with `shard` only that share of its batches."""
    routing.prepare_java(settings)
    import r5py

    mode = settings.modes[mode_id]
    transit = mode["kind"] == "transit"
    versions = check_versions(r5py) if transit else {"r5py": str(r5py.__version__)}
    minutes = limits(settings)["pt" if transit else mode_id]
    cells = team_cells(settings)
    origins = origins_for(settings, cells, mode_id)
    if limit:
        origins = origins.head(limit)
        tag = f"{tag}_first{limit}"
    folder = cache_dir(settings) / tag
    folder.mkdir(parents=True, exist_ok=True)
    scope = _scope(settings, tag, mode, window, minutes, origins, cells)
    if force and shard is None:
        for path in folder.glob("origins_*.parquet"):
            path.unlink()
    _check_scope(folder, scope)
    starts = routing.batch_starts(len(origins), BATCH_SIZE, shard)
    todo = [s for s in starts if force or not (folder / f"origins_{s:06d}.parquet").exists()]
    departure, window_length = routing._departure(settings, window)
    log.info("%s: %d origins, %d destinations, %d minutes, departure %s + %s",
             tag, len(origins), len(cells), minutes, departure, window_length)
    if shard is not None:
        log.info("%s: shard %d/%d, %d of %d batches to route", tag, shard[0] + 1, shard[1], len(todo), len(starts))
    started = time.monotonic()
    if todo:
        gtfs, _ = routing.prepare_gtfs(settings)
        network = routing._network(r5py, settings, mode, gtfs)
        kwargs = routing._mode_kwargs(r5py, mode, settings.routing)
        hook, snapped = None, {}
        if transit:
            hook = PathHook(r5py, network, departure, window_length, minutes, kwargs)
            import shapely

            points = network.snap_to_network(cells.geometry)
            snapped = {i: p for i, p in zip(cells["id"], points) if isinstance(p, shapely.Point) and not p.is_empty}
            log.info("%s: %d of %d cells placed on the network", tag, len(snapped), len(cells))
        for start in todo:
            path = folder / f"origins_{start:06d}.parquet"
            if path.exists() and not force:
                continue  # another process finished it meanwhile
            chunk = origins.iloc[start:start + BATCH_SIZE]
            t0 = time.monotonic()
            table = _matrix(r5py, network, chunk, cells, departure, window_length, minutes, kwargs)
            table = _paths(hook, table, snapped) if transit else typed(table)
            tmp = path.with_name(f"{path.stem}.{os.getpid()}.tmp.parquet")
            table.to_parquet(tmp, index=False)
            tmp.replace(path)
            log.info("%s: %d/%d origins, %d pairs, batch %.0fs", tag, min(start + BATCH_SIZE, len(origins)),
                     len(origins), len(table), time.monotonic() - t0)
    if shard is not None:
        log.info("%s: shard %d/%d done; run again without --shard to combine", tag, shard[0] + 1, shard[1])
        return None
    batches = sorted(folder.glob("origins_*[0-9].parquet"))
    if len(batches) != len(starts):
        raise SystemExit(f"{tag}: {len(batches)} of {len(starts)} batches are done. Route the rest first.")
    result = pd.concat([pd.read_parquet(p) for p in batches], ignore_index=True)
    output = cache_dir(settings) / f"{tag}.parquet"
    result.to_parquet(output, index=False)
    manifest = {
        **scope,
        "rows": int(len(result)),
        "origins_count": int(len(origins)),
        "origins_reaching_any": int(result["origin"].nunique()),
        "destinations_count": int(len(cells)),
        "versions": versions,
        "elapsed_seconds_this_session": round(time.monotonic() - started, 1),
        "written": dt.datetime.now().isoformat(timespec="seconds"),
    }
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2, default=str))
    log.info("%s: wrote %s (%d pairs)", tag, output, len(result))
    return output


def run_all(settings: Settings, only: list[str] | None = None, limit: int | None = None, force: bool = False,
            shard: tuple[int, int] | None = None) -> None:
    if spec(settings) is None:
        raise SystemExit("This place has no `pairs:` block in its configuration.")
    for tag, mode_id, window in runs(settings):
        if only and tag not in only:
            continue
        run(settings, tag, mode_id, window, limit=limit, force=force, shard=shard)


# --- Tiles for the web app -------------------------------------------------

TILE_COLUMNS = ["origin", "destination", "minutes", "legs", "routes", "board", "alight",
                "access", "egress", "transfer", "wait", "ride", "iters"]


def _round1(values) -> list:
    array = pd.to_numeric(pd.Series(values), errors="coerce").to_numpy(dtype="float64")
    return [round(float(v), 1) if np.isfinite(v) else None for v in array]


def _ints(values) -> list:
    array = pd.to_numeric(pd.Series(values), errors="coerce").to_numpy(dtype="float64")
    return [int(v) if np.isfinite(v) else None for v in array]


def _lookup(values, table: dict[str, int]) -> list:
    """Each value's place in `table`, adding new values at the end; None for blanks."""
    out = []
    for value in values:
        out.append(table.setdefault(value, len(table)) if isinstance(value, str) and value else None)
    return out


def tile_block(rows: pd.DataFrame, origin_order: list[int], window_minutes: float | None = None,
               stops: dict[str, int] | None = None, routes: dict[str, int] | None = None) -> dict:
    """One run's pairs for the origins of a tile, as column arrays.

    `rows` has TEAM cell indices in `o` and `d`. `n[k]` counts the rows of the
    k-th origin in `origin_order`; rows follow in that order, by destination.
    With `stops` and `routes`, the path columns are added too, giving stops
    and route sequences as places in those lists, which this adds to.
    """
    rows = rows.sort_values(["o", "d"], kind="stable")
    counts = rows.groupby("o").size()
    block = {
        "n": [int(counts.get(o, 0)) for o in origin_order],
        "d": [int(v) for v in rows["d"]],
        "m": [int(v) for v in rows["minutes"]],
    }
    if stops is None or routes is None or "legs" not in rows:
        return block
    use = pd.to_numeric(rows["iters"], errors="coerce").astype("float64") * 100.0 / float(window_minutes or 1)
    block.update({
        "b": _lookup(rows["board"].astype(object), stops),
        "a": _lookup(rows["alight"].astype(object), stops),
        "r": _lookup(rows["routes"].astype(object), routes),
        "acc": _round1(rows["access"]),
        "egr": _round1(rows["egress"]),
        "xfer": _round1(rows["transfer"]),
        "wait": _round1(rows["wait"]),
        "ride": _round1(rows["ride"]),
        "use": _ints(use.round()),
    })
    return block


def _dump(path: Path, payload) -> None:
    """Write compact JSON with .gz and .br copies, as export._dump does. The
    payload is already clean (no NaN), so it is not walked again."""
    import gzip

    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    path.write_bytes(raw)
    with gzip.GzipFile(path.with_suffix(path.suffix + ".gz"), "wb", compresslevel=6, mtime=0) as out:
        out.write(raw)
    try:
        import brotli
    except ImportError:
        return
    path.with_suffix(path.suffix + ".br").write_bytes(brotli.compress(raw, quality=5))


def _read_combined(path: Path) -> pd.DataFrame:
    import pyarrow.parquet as pq

    names = pq.ParquetFile(path).schema_arrow.names
    columns = [c for c in TILE_COLUMNS if c in names]
    strings = [c for c in ("origin", "destination", "routes", "board", "alight") if c in columns]
    return pq.read_table(path, columns=columns, read_dictionary=strings).to_pandas()


def write_site(settings: Settings, data_dir: Path | None = None) -> Path:
    """Tiles of every combined run, by the resolution 7 parent of the origin,
    and an index, into `<data_dir>/pairs/`: times for every mode and window
    in `pairs/<r7>.json`, and the public transport paths for each window in
    `pairs/<window>/<r7>.json`."""
    import h3

    data_dir = Path(data_dir) if data_dir else settings.output_dir / "site" / "data"
    cells = team_cells(settings)
    ids = list(cells["id"])
    index_of = {h: i for i, h in enumerate(ids)}
    order = order_digest(ids)
    cells_json = data_dir / "cells.json"
    if cells_json.exists():
        site_ids = json.loads(cells_json.read_text())["h3"]
        if list(site_ids) != ids:
            raise SystemExit(f"{cells_json} lists other cells than this build. Rebuild the site first.")
    parent = {h: h3.cell_to_parent(h, TILE_RESOLUTION) for h in ids}

    tables, manifests = {}, {}
    for tag, mode_id, window in runs(settings):
        path = cache_dir(settings) / f"{tag}.parquet"
        if not path.exists():
            log.warning("%s: no combined pairs at %s, left out of the tiles", tag, path)
            continue
        manifests[tag] = json.loads(path.with_suffix(".json").read_text())
        if manifests[tag]["destinations"] != order:
            raise SystemExit(f"{tag} was routed to another cell list. Route it again.")
        table = _read_combined(path)
        table["o"] = table["origin"].astype(object).map(index_of).astype("int64")
        table["d"] = table["destination"].astype(object).map(index_of).astype("int64")
        table["tile"] = table["origin"].astype(object).map(parent)
        table = table.drop(columns=["origin", "destination"])
        tables[tag] = (window, {tile: rows for tile, rows in table.groupby("tile", sort=False)})
        log.info("%s: %d pairs read", tag, len(table))

    folder = data_dir / "pairs"
    folder.mkdir(parents=True, exist_ok=True)
    windows = [w for _, (w, _) in tables.items() if w is not None]
    for old in [*folder.glob("8*.json*"), *(f for w in windows for f in (folder / w).glob("8*.json*"))]:
        old.unlink()
    tiles = sorted({tile for _, groups in tables.values() for tile in groups})
    used_stops: set[str] = set()
    for tile in tiles:
        members = sorted({int(o) for _, groups in tables.values() if tile in groups for o in groups[tile]["o"]})
        head = {"format": FORMAT, "r7": tile, "order": order, "cells": members}
        body: dict = dict(head)
        for tag, (window, groups) in tables.items():
            if tile not in groups:
                continue
            rows = groups[tile]
            if window is None:
                body[tag] = tile_block(rows, members)
                continue
            body.setdefault("pt", {})[window] = tile_block(rows, members)
            # The paths for one window, in a file of their own, as most clicks need one window.
            stops: dict[str, int] = {}
            routes: dict[str, int] = {}
            paths = {**head, "window": window,
                     **tile_block(rows, members, manifests[tag].get("window_minutes"), stops, routes)}
            paths["stops"], paths["routes"] = list(stops), list(routes)
            used_stops |= set(stops)
            _dump(folder / window / f"{tile}.json", paths)
        _dump(folder / f"{tile}.json", body)

    index = {
        "format": FORMAT,
        "built": dt.date.today().isoformat(),
        "order": order,
        "cells": len(ids),
        "resolution": TILE_RESOLUTION,
        "minutes": limits(settings),
        "pt_origins": str((spec(settings) or {}).get("pt_origins", "all")),
        "routing_date": str(settings.routing["date"]),
        "windows": {
            w: {k: v for k, v in s.items() if k in ("label", "when", "phrase", "start", "minutes", "date")}
            for w, s in settings.routing["windows"].items()
        },
        "runs": {
            tag: {k: manifests[tag].get(k) for k in ("rows", "origins_count", "departure", "window_minutes", "versions", "written")}
            for tag in manifests
        },
        "tiles": tiles,
        "path_tiles": {w: sorted(groups) for _, (w, groups) in tables.items() if w is not None},
        "routes": route_table(settings),
        "stops_not_in_overlays": stops_outside_overlays(settings, used_stops),
    }
    _dump(folder / "index.json", index)
    log.info("pairs: wrote %d tiles and an index to %s", len(tiles), folder)
    return folder


def route_table(settings: Settings) -> dict[str, dict]:
    """Short name and GTFS route type of every route, by route_id."""
    import zipfile

    from .context import _read_some, _text

    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        routes = _read_some(zf, "routes.txt", ["route_id", "route_type"], ["route_short_name", "route_long_name"])
    return {
        str(r.route_id): {"name": _text(r.route_short_name) or _text(r.route_long_name) or str(r.route_id),
                          "type": int(r.route_type) if str(r.route_type).isdigit() else None}
        for r in routes.itertuples(index=False)
    }


def stops_outside_overlays(settings: Settings, used: set[str]) -> dict[str, dict]:
    """Names and places of stops a path uses that the overlays' stop layer
    leaves out (it lists stops with departures in a routing window)."""
    from . import context

    stops, _, _ = context.timetable(settings)
    rates = [c for c in stops if c.startswith("per_hour_")]
    listed = set(stops.loc[stops[rates].max(axis=1) > 0, "stop_id"]) if rates else set()
    extra = stops[stops["stop_id"].isin(used - listed)]
    return {
        str(r.stop_id): {"name": context._text(r.stop_name), "lon": round(float(r.stop_lon), 5), "lat": round(float(r.stop_lat), 5)}
        for r in extra.itertuples(index=False)
    }


# --- Checking a sample of paths --------------------------------------------


def _gtfs_rides(settings: Settings, window: str, legs: list[tuple[str, str, str]]) -> dict:
    """For each (route, board stop, alight stop), the timetable's ride minutes
    on the routing day's trips that leave the board stop in the window or up to
    `pairs` minutes after it, and how often they leave in the window."""
    import zipfile

    from . import context

    departure, window_length = routing._departure(settings, window)
    start = departure.hour * 3600 + departure.minute * 60
    end = start + int(window_length.total_seconds())
    late = end + 60 * limits(settings)["pt"]
    routes = {r for r, _, _ in legs}
    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        running = context.active_services(zf, departure.date())
        trips = context._read(zf, "trips.txt", usecols=["trip_id", "route_id", "service_id"])
        trips = trips[trips["route_id"].isin(routes) & trips["service_id"].isin(running)]
        wanted = set(trips["trip_id"])
        parts = []
        with zf.open("stop_times.txt") as handle:
            import io

            reader = pd.read_csv(io.TextIOWrapper(handle, encoding="utf-8-sig"), dtype=str, chunksize=500_000,
                                 usecols=["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"])
            for chunk in reader:
                parts.append(chunk[chunk["trip_id"].isin(wanted)])
    times = pd.concat(parts, ignore_index=True).merge(trips[["trip_id", "route_id"]], on="trip_id")
    times["dep"] = context._seconds(times["departure_time"])
    times["arr"] = context._seconds(times["arrival_time"])
    times["seq"] = pd.to_numeric(times["stop_sequence"])
    out = {}
    for route, board, alight in legs:
        on = times[times["route_id"] == route]
        b = on[on["stop_id"] == board][["trip_id", "dep", "seq"]]
        a = on[on["stop_id"] == alight][["trip_id", "arr", "seq"]]
        both = b.merge(a, on="trip_id", suffixes=("_b", "_a"))
        both = both[both["seq_a"] > both["seq_b"]]
        in_window = both[(both["dep"] >= start) & (both["dep"] < end)]
        reachable = both[(both["dep"] >= start) & (both["dep"] < late)]
        rides = (reachable["arr"] - reachable["dep"]) / 60.0
        out[(route, board, alight)] = {
            "trips_in_window": int(len(in_window)),
            "headway_minutes": round(window_length.total_seconds() / 60 / len(in_window), 1) if len(in_window) else None,
            "ride_minutes_median": round(float(rides.median()), 1) if len(rides) else None,
            "ride_minutes_range": [round(float(rides.min()), 1), round(float(rides.max()), 1)] if len(rides) else None,
        }
    return out


def check(settings: Settings, window: str = "interpeak", sample: int = 10, seed: int = 7) -> dict:
    """Compare a sample of kept paths with r5py's DetailedItineraries and with
    the timetable, and write the comparison beside the pairs.

    For each pair: whether any itinerary r5py finds over the same window uses
    the same routes between the same stops, and how its walks compare; for
    each ride, the timetable's ride time between the two stops and how often
    the route leaves in the window; and the straight-line distance to the
    first stop beside the walk R5 timed.
    """
    import geopandas as gpd

    routing.prepare_java(settings)
    import r5py

    versions = check_versions(r5py)
    tag = f"pt_{window}"
    table = pd.read_parquet(cache_dir(settings) / f"{tag}.parquet")
    table = table[(table["legs"] > 0) & (table["origin"] != table["destination"])]
    multi = table[table["legs"] >= 2].sample(min(sample // 3, (table["legs"] >= 2).sum()), random_state=seed)
    single = table[table["legs"] == 1].sample(sample - len(multi), random_state=seed)
    picked = pd.concat([single, multi]).reset_index(drop=True)

    cells = team_cells(settings).set_index("id")
    origins = gpd.GeoDataFrame({"id": [f"o{i}" for i in range(len(picked))]},
                               geometry=cells.loc[picked["origin"], "geometry"].to_numpy(), crs="EPSG:4326")
    destinations = gpd.GeoDataFrame({"id": [f"d{i}" for i in range(len(picked))]},
                                    geometry=cells.loc[picked["destination"], "geometry"].to_numpy(), crs="EPSG:4326")
    mode = settings.modes["pt"]
    gtfs, _ = routing.prepare_gtfs(settings)
    network = routing._network(r5py, settings, mode, gtfs)
    departure, window_length = routing._departure(settings, window)
    started = time.monotonic()
    itineraries = pd.DataFrame(r5py.DetailedItineraries(
        network, origins=origins, destinations=destinations, departure=departure,
        departure_time_window=window_length, snap_to_network=True,
        **routing._mode_kwargs(r5py, mode, settings.routing),
    ))
    seconds = time.monotonic() - started
    itineraries["minutes"] = itineraries["travel_time"].dt.total_seconds() / 60
    itineraries["wait"] = itineraries["wait_time"].dt.total_seconds() / 60

    legs = sorted({(r, b, a) for row in picked.itertuples()
                   for r, b, a in zip(row.routes.split("|"), row.boards.split("|"), row.alights.split("|"))})
    timetable = _gtfs_rides(settings, window, legs)

    import zipfile

    from . import context

    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        stops = context._read(zf, "stops.txt", usecols=["stop_id", "stop_name", "stop_lat", "stop_lon"]).set_index("stop_id")
    report = []
    for i, row in picked.iterrows():
        options = itineraries[itineraries["from_id"] == f"o{i}"]
        summary = []
        for _, option in options.groupby("option"):
            option = option.sort_values("segment")
            transit = option[option["route_id"].notna() & (option["route_id"].astype(str) != "")]
            summary.append({
                "routes": "|".join(transit["route_id"].astype(str)),
                "board": str(transit["start_stop_id"].iloc[0]) if len(transit) else None,
                "alight": str(transit["end_stop_id"].iloc[-1]) if len(transit) else None,
                "access": round(float(option["minutes"].iloc[0]), 1) if len(transit) and option["route_id"].isna().iloc[0] else 0.0,
                "egress": round(float(option["minutes"].iloc[-1]), 1) if len(transit) and option["route_id"].isna().iloc[-1] else 0.0,
                "total": round(float(option["minutes"].sum() + option["wait"].fillna(0).sum()), 1),
            })
        same = [s for s in summary if s["routes"] == row.routes and s["board"] == row.board and s["alight"] == row.alight]
        same_routes = [s for s in summary if s["routes"] == row.routes]
        origin_point = cells.at[row.origin, "geometry"]
        board = stops.loc[row.board]
        distance = gpd.GeoSeries(
            gpd.points_from_xy([origin_point.x, float(board["stop_lon"])], [origin_point.y, float(board["stop_lat"])]),
            crs="EPSG:4326").to_crs("EPSG:2193")
        crow = float(distance.iloc[0].distance(distance.iloc[1]))
        rides = []
        for r, b, a, ride, wait in zip(row.routes.split("|"), row.boards.split("|"), row.alights.split("|"),
                                       row.rides.split("|"), row.waits.split("|")):
            rides.append({"route": r, "board": b, "board_name": stops.at[b, "stop_name"], "alight": a,
                          "alight_name": stops.at[a, "stop_name"], "r5_ride": float(ride), "r5_wait": float(wait),
                          **timetable.get((r, b, a), {})})
        report.append({
            "origin": row.origin, "destination": row.destination, "minutes": int(row.minutes),
            "path": {"routes": row.routes, "board": row.board, "alight": row.alight, "access": float(row.access),
                     "egress": float(row.egress), "wait": float(row.wait), "ride": float(row.ride),
                     "transfer": float(row.transfer), "total": float(row.total), "use": int(row.iters), "of": int(row.reached)},
            "itineraries": len(summary),
            "itineraries_same_path": len(same),
            "itineraries_same_routes": len(same_routes),
            "itinerary_walks_same_path": [[s["access"], s["egress"]] for s in same[:3]],
            # What the itineraries used instead, most common first.
            "itinerary_paths": [
                {"routes": k[0], "board": k[1], "board_name": stops["stop_name"].get(k[1]), "alight": k[2],
                 "alight_name": stops["stop_name"].get(k[2]), "itineraries": n}
                for k, n in pd.Series([(s["routes"], s["board"], s["alight"]) for s in summary]).value_counts().head(3).items()
            ],
            "board_name": stops.at[row.board, "stop_name"],
            "alight_name": stops.at[row.alight, "stop_name"],
            "itinerary_quickest": min((s["total"] for s in summary), default=None),
            "crow_metres_to_board": round(crow),
            "walk_metres_at_4_8_kmh": round(float(row.access) * 80),
            "rides": rides,
        })
    result = {
        "window": window, "sample": len(report), "seed": seed, "versions": versions,
        "detailed_itineraries_seconds": round(seconds, 1),
        "found_same_path": sum(1 for r in report if r["itineraries_same_path"]),
        "pairs": report,
    }
    out = cache_dir(settings) / f"check_{tag}.json"
    out.write_text(json.dumps(result, indent=2, default=str))
    for r in report:
        p = r["path"]
        print(f"{r['origin']} -> {r['destination']}  {r['minutes']} min  {p['routes']}  {p['board']} -> {p['alight']}  "
              f"walks {p['access']}/{p['egress']}  same path in {r['itineraries_same_path']} of {r['itineraries']} itineraries  "
              f"crow {r['crow_metres_to_board']} m, walk {r['walk_metres_at_4_8_kmh']} m")
        for leg in r["rides"]:
            print(f"    {leg['route']}: R5 ride {leg['r5_ride']} wait {leg['r5_wait']}; timetable ride "
                  f"{leg.get('ride_minutes_median')} {leg.get('ride_minutes_range')}, headway {leg.get('headway_minutes')}")
    print(f"wrote {out}")
    return result
