"""Web data files, the downloadable dataset, and the upload-ready site.

The web app reads five JSON files from data/:

    cells.json         one entry per hexagon, stored column by column
    summary.json       regional figures, breakdowns by NZDep and group, area tables
    places.json        SA2 names with centres and extents, for search and zooming
    destinations.json  the services used as destinations
    overlays.json      rail, ferry, bus and cycle network lines
"""

from __future__ import annotations

import datetime as dt
import hashlib
import gzip
import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from .config import Settings
from .diagnosis import REASONS
from .equity import GROUPS, QUINTILE_LABELS

WEB_MODES = ["walk", "bike_low_stress", "bike", "pt", "car"]
REPO_WEB = Path(__file__).resolve().parents[2] / "web"


def _ints(values, scale: float = 1.0) -> list:
    array = pd.to_numeric(pd.Series(values), errors="coerce").to_numpy(dtype="float64") * scale
    return [int(round(v)) if np.isfinite(v) else None for v in array]


def _floats(values, digits: int, scale: float = 1.0) -> list:
    array = pd.to_numeric(pd.Series(values), errors="coerce").to_numpy(dtype="float64") * scale
    return [round(float(v), digits) if np.isfinite(v) else None for v in array]


def _clean(value):
    """JSON has no NaN; replace non-finite numbers with null, all the way down."""
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return round(float(value), 4) if np.isfinite(value) else None
    return value


def _dump(path: Path, payload) -> None:
    """Write the file, and a gzipped copy beside it.

    The data files are large and compress about six to one. Compressing them
    here rather than on every request takes seconds off the first load, and the
    web server hands over the .gz when the browser says it accepts gzip.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(_clean(payload), separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    raw = text.encode("utf-8")
    with gzip.GzipFile(path.with_suffix(path.suffix + ".gz"), "wb", compresslevel=6, mtime=0) as out:
        out.write(raw)
    try:
        import brotli  # optional; the .gz alone is enough to serve every browser
    except ImportError:
        return
    path.with_suffix(path.suffix + ".br").write_bytes(brotli.compress(raw, quality=5))


def place_list(table: pd.DataFrame) -> tuple[list[dict], dict[str, int]]:
    import h3

    rows = []
    for name, cells in table.groupby("sa2"):
        if not isinstance(name, str) or not name:
            continue
        latlng = np.array([h3.cell_to_latlng(c) for c in cells.index])
        board = cells["local_board"].dropna() if "local_board" in cells else pd.Series(dtype=str)
        rows.append(
            {
                "name": name,
                "board": board.iloc[0] if len(board) else None,
                "lon": round(float(latlng[:, 1].mean()), 5),
                "lat": round(float(latlng[:, 0].mean()), 5),
                "bbox": [round(float(v), 4) for v in (latlng[:, 1].min(), latlng[:, 0].min(), latlng[:, 1].max(), latlng[:, 0].max())],
                "population": round(float(cells["population"].sum())),
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows, {row["name"]: i for i, row in enumerate(rows)}


def destination_list(destinations: pd.DataFrame) -> tuple[list[dict], dict[str, int]]:
    grouped = destinations.groupby("id", sort=True)
    rows = []
    for dest_id, group in grouped:
        first = group.iloc[0]
        rows.append(
            {
                "name": first["name"] if isinstance(first["name"], str) else None,
                "services": sorted(group["service"].unique().tolist()),
                "lon": round(float(first["lon"]), 5),
                "lat": round(float(first["lat"]), 5),
            }
        )
    return rows, {str(dest_id): i for i, dest_id in enumerate(grouped.groups)}


def cell_payload(settings: Settings, table: pd.DataFrame, place_index: dict, dest_index: dict) -> dict:
    services = list(settings.services)
    nearest = {}
    for service in services:
        ids = pd.Series(pd.NA, index=table.index, dtype="object")
        for mode in settings.standard_modes:
            column = f"id_{service}_{mode}"
            if column in table:
                chosen = table[f"via_{service}"] == mode
                ids[chosen] = table.loc[chosen, column]
        nearest[service] = [dest_index.get(str(v)) if isinstance(v, str) else None for v in ids]
    jobs, fair = {}, {}
    for column in table.columns:
        if column.startswith("jobshare"):
            limit, mode = column.removeprefix("jobshare").split("_", 1)
            jobs.setdefault(mode, {})[limit] = _floats(table[column], 2, scale=100)
        elif column.startswith("jobsfair"):
            limit, mode = column.removeprefix("jobsfair").split("_", 1)
            fair.setdefault(mode, {})[limit] = _floats(table[column], 2)
    return {
        "h3": [str(c) for c in table.index],
        "pop": _floats(table["population"], 1),
        "place": [place_index.get(v) if isinstance(v, str) else None for v in table["sa2"]],
        "nzdep": _ints(table["nzdep"]),
        "nocar": _ints(table["no_vehicle_share"], 100),
        "kids": _ints(table["children_share"], 100),
        "older": _ints(table["older_share"], 100),
        "drive": _ints(table["commute_car_share"], 100) if "commute_car_share" in table else None,
        "freq": {w: _floats(table[f"pt_per_hour_{w}"], 1) for w in settings.routing["windows"]},
        "m_stop": _ints(table["m_frequent_stop"]),
        "m_rail": _ints(table["m_rail_ferry"]),
        "m_bike": _ints(table["m_low_stress_route"]),
        "t": {s: {m: _ints(table[f"t_{s}_{m}"]) for m in WEB_MODES if f"t_{s}_{m}" in table} for s in services},
        "km": {s: _floats(table[f"km_{s}"], 2) for s in services},
        "nearest": nearest,
        "jobs": jobs,
        "fair": fair,
        "access": access_payload(settings, table),
        "cost": cost_payload(settings, table),
        "zone": [str(v) if isinstance(v, str) else None for v in table["costzone"]] if "costzone" in table else None,
    }


ACCESS_WEB_KEYS = ("jobs", "everyday", "education", "all")


def cost_payload(settings: Settings, table: pd.DataFrame) -> dict:
    """What each zone budget reaches, per cell.

    Services are counts, because the question is whether a shop is within
    reach and how many there are. Jobs are a share of all the region's jobs,
    which is how the rest of the site reports them.
    """
    out: dict[str, dict] = {}
    for purpose in settings.fares.get("purposes", []):
        block: dict[str, list] = {}
        for limit in range(1, 5):
            if purpose == "jobs":
                column = f"costshare_{purpose}_z{limit}"
                if column in table:
                    block[f"z{limit}"] = _floats(table[column], 2, scale=100)
            else:
                column = f"costmin_{purpose}_z{limit}"
                if column in table:
                    block[f"z{limit}"] = _ints(table[column])
        if block:
            out[purpose] = block
    return out


def access_payload(settings: Settings, table: pd.DataFrame) -> dict:
    """Gravity indices for the web app: the headline keys only, as integers.

    The per-purpose scores stay in the download; the app needs the index, and
    works out deciles in the browser from whatever is on screen.
    """
    out: dict[str, dict] = {}
    for mode_id in settings.gravity.get("modes", []):
        block = {
            key: _ints(table[f"accessidx_{key}_{mode_id}"])
            for key in ACCESS_WEB_KEYS
            if f"accessidx_{key}_{mode_id}" in table
        }
        if block:
            out[mode_id] = block
    return out


def fare_meta(settings: Settings, summary: dict) -> dict:
    """Everything the browser needs to turn a budget into a number of zones.

    The fare table is small and the rule is simple, so the conversion happens
    in the browser. That way a budget slider redraws the map without asking
    the server for anything.
    """
    spec = settings.fares
    if not spec:
        return {}
    record = summary.get("fares", {})
    table_path = settings.data("fare_table") if "fare_table" in settings.raw["data"] else None
    table = json.loads(table_path.read_text(encoding="utf-8")) if table_path and table_path.exists() else {}
    return {
        "mode": spec.get("mode", "pt"),
        "max_minutes": spec.get("max_minutes"),
        "purposes": list(spec.get("purposes", [])),
        "budget": spec.get("budget", {}),
        "profiles": spec.get("profiles", []),
        "zone_cap": record.get("zone_cap", 4),
        "zones": record.get("zones", []),
        "adjacency": record.get("adjacency", {}),
        "fares": table.get("fares", {}),
        "free": table.get("free", {}),
        "caps": (table.get("rules", {}) or {}).get("caps", {}),
        "source_url": table.get("source_url"),
        "read_on": table.get("read_on"),
        "zone_source_url": record.get("zone_source"),
        "cells_with_zone": record.get("cells_with_zone"),
    }


def _area_records(frame: pd.DataFrame) -> list[dict]:
    records = frame.round(4).to_dict(orient="records")
    return [_clean(r) for r in records]


def write_web(settings: Settings, table: pd.DataFrame, destinations: pd.DataFrame, summary: dict, areas: dict) -> Path:
    data = settings.output_dir / "site" / "data"
    places, place_index = place_list(table)
    dests, dest_index = destination_list(destinations)
    _dump(data / "cells.json", cell_payload(settings, table, place_index, dest_index))
    _dump(data / "places.json", places)
    _dump(data / "destinations.json", dests)

    from . import context

    _dump(data / "overlays.json", context.overlays(settings))
    jobs_total = float(pd.read_parquet(settings.output_dir / "destinations" / "jobs.parquet")["jobs"].sum())
    meta = {
        "version": __version__,
        "built": dt.date.today().isoformat(),
        "region": settings.raw.get("region"),
        "routing_date": str(settings.routing["date"]),
        "windows": settings.routing["windows"],
        "modes": {k: v.get("label", k) for k, v in settings.modes.items()},
        "standard_modes": settings.standard_modes,
        "services": {
            k: {"label": v["label"], "standard_minutes": v["standard_minutes"], "window": v["window"]}
            for k, v in settings.services.items()
        },
        "jobs": {"thresholds": settings.jobs["thresholds"], "window": settings.jobs["window"], "total": round(jobs_total)},
        "groups": {k: v[0] for k, v in GROUPS.items()},
        "access": {
            "modes": list(settings.gravity.get("modes", [])),
            "beta_modes": list(settings.gravity.get("beta_modes", [])),
            "max_minutes": settings.gravity.get("max_minutes"),
            "keys": {
                "jobs": "Jobs",
                "everyday": "Everyday services",
                "education": "Schools",
                "all": "All opportunities",
            },
            "functions": summary.get("gravity", {}).get("functions", {}),
            "purposes": {k: v.get("label", k) for k, v in settings.gravity.get("purposes", {}).items()},
        },
        "fares": fare_meta(settings, summary),
        "quintiles": QUINTILE_LABELS,
        "reasons": {str(code): {"key": key, "label": label, "fix": fix} for code, (key, label, fix) in REASONS.items()},
        "totals": {"cells": int(len(table)), "population": round(float(table["population"].sum()))},
        "destinations": destinations.groupby("service").size().to_dict(),
    }
    _dump(
        data / "summary.json",
        {"meta": meta, **summary, "areas": {key: _area_records(frame) for key, frame in areas.items()}},
    )
    return data


FIELD_NOTES = {
    "h3": "H3 resolution 9 cell id (about 0.1 km²).",
    "population": "Usual residents, 2023 Census, spread from SA1 blocks by area.",
    "t_": "Minutes to the nearest destination of this type by this mode (blank: none within 60 minutes).",
    "n_": "Number of destinations of this type within the service's standard time by this mode.",
    "id_": "Internal id of the nearest destination.",
    "best_": "Fastest time using walking, low-stress cycling or public transport.",
    "via_": "The mode that gave the fastest time.",
    "meets_": "True when the fastest time is within the standard.",
    "options_": "How many of walking, low-stress cycling and public transport are within the standard.",
    "km_": "Straight-line distance to the nearest destination of this type.",
    "why_": "Main reason the standard is missed (codes in docs/indicators.md).",
    "jobs": "Jobs reachable within the stated minutes by the stated mode.",
    "jobshare": "Share of the region's jobs reachable.",
    "jobsfair": "Job access allowing for other workers who can reach the same jobs; 1 is the regional average.",
    "access_": "Gravity score: opportunities of this type, each discounted by how long it takes to reach (see docs/methodology.md).",
    "accessidx_": "The gravity score as an index where the population-weighted regional mean is 100.",
    "accessdec_": "Population-weighted decile of the gravity score, 1 lowest access to 10 highest.",
    "costzone": "Auckland Transport fare zone the cell sits in.",
    "costaccess_": "Opportunities of this type within the time cap and this many fare zones by public transport.",
    "costmin_": "Minutes to the nearest one within this many fare zones by public transport.",
    "costshare_": "The same, as a share of all of them in the region.",
    "pt_per_hour_": "Departures per hour at the busiest stop within 800 m, in the named window.",
    "m_": "Straight-line metres to the nearest feature named.",
}


def _note(column: str) -> str:
    for prefix, note in sorted(FIELD_NOTES.items(), key=lambda kv: -len(kv[0])):
        if column == prefix or column.startswith(prefix):
            return note
    return ""


def write_downloads(settings: Settings, table: pd.DataFrame) -> Path:
    import geopandas as gpd
    import h3
    from shapely.geometry import Polygon

    folder = settings.output_dir / "site" / "downloads"
    folder.mkdir(parents=True, exist_ok=True)
    flat = table.drop(columns=[c for c in table.columns if c.startswith("id_")]).reset_index()
    for column in flat.columns:
        if flat[column].dtype == "object":
            flat[column] = flat[column].astype("string")
    flat.to_csv(folder / "team_auckland_h3.csv", index=False)
    geometry = [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in flat["h3"]]
    gpd.GeoDataFrame(flat, geometry=geometry, crs="EPSG:4326").to_file(folder / "team_auckland_h3.gpkg", driver="GPKG")
    pd.DataFrame({"field": flat.columns, "description": [_note(c) for c in flat.columns]}).to_csv(
        folder / "fields.csv", index=False
    )
    sums = []
    for path in sorted(folder.glob("team_auckland_h3.*")) + [folder / "fields.csv"]:
        sums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
    (folder / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n")
    write_downloads_page(folder)
    return folder


DOWNLOAD_NOTES = {
    "team_auckland_h3.gpkg": "Every field for every populated hexagon, with the hexagon shapes (GeoPackage, for GIS).",
    "team_auckland_h3.csv": "The same fields without shapes.",
    "fields.csv": "What each field means.",
    "SHA256SUMS.txt": "Checksums, to confirm a download is complete.",
}

DOWNLOADS_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TEAM data</title>
<link rel="icon" href="../assets/team-mark.svg" type="image/svg+xml">
<style>
body { max-width: 760px; margin: 40px auto; padding: 0 20px; color: #15252e; font: 15px/1.55 Inter, ui-sans-serif, system-ui, sans-serif; }
h1 { margin: 12px 0 8px; color: #0c0c48; font-size: 26px; }
h2 { margin: 28px 0 6px; font-size: 17px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 8px; border-bottom: 1px solid #e1e4e6; text-align: left; vertical-align: top; }
th { color: #55646c; font-weight: 600; font-size: 13px; }
td:last-child { white-space: nowrap; color: #55646c; }
a { color: #1f6178; }
</style>
</head>
<body>
<p><a href="../">Back to TEAM</a></p>
<h1>TEAM data</h1>
<p>Travel times, standards, reasons, job access and census characteristics for every populated hexagon in Auckland. Version __VERSION__, built __BUILT__.</p>
<table>
<thead><tr><th>File</th><th>Contents</th><th>Size</th></tr></thead>
<tbody>
__ROWS__
</tbody>
</table>
<h2>Terms</h2>
<p>The data is derived from OpenStreetMap (Open Database Licence), Stats NZ and the Ministry of Education (CC BY 4.0), and Auckland Transport open data. Parts derived from OpenStreetMap are shared under the Open Database Licence.</p>
<h2>Citation</h2>
<p>Welch, T. F. (2026). TEAM: Transport Equity and Access Model, Auckland. Version __VERSION__. Better Places Lab, University of Auckland.</p>
</body>
</html>
"""


def _size(path: Path) -> str:
    size = path.stat().st_size
    return f"{size / 1e6:.1f} MB" if size >= 1e6 else f"{max(1, round(size / 1e3))} KB"


def write_downloads_page(folder: Path) -> None:
    rows = []
    for name, note in DOWNLOAD_NOTES.items():
        path = folder / name
        if path.exists():
            rows.append(f'<tr><td><a href="{name}">{name}</a></td><td>{note}</td><td>{_size(path)}</td></tr>')
    page = (
        DOWNLOADS_PAGE.replace("__ROWS__", "\n".join(rows))
        .replace("__VERSION__", __version__)
        .replace("__BUILT__", dt.date.today().isoformat())
    )
    (folder / "index.html").write_text(page, encoding="utf-8")


def assemble_site(settings: Settings) -> Path:
    """Copy the static app next to its data, ready to upload as one folder."""
    site = settings.output_dir / "site"
    for item in REPO_WEB.iterdir():
        if item.name == "data":
            continue
        target = site / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
    return site
