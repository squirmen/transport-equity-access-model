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
from . import equity, gravity, routing
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


# What the map and the first views need, sent first. The rest (job access,
# scores, fares, choice counts and the measures behind the screening reasons)
# follows in cells_more.json once the map is drawn. Auckland's core is about a
# third of the whole, which matters on a host that sends a few hundred kilobytes
# a second.
CORE_CELL_KEYS = (
    "h3", "place", "pop", "nzdep", "nocar", "kids", "older", "groups", "drive", "inc",
    "freq", "t", "tw", "nearest", "urban", "zone",
)


def _chains_meta(settings: Settings) -> dict | None:
    from . import chains

    return chains.meta(settings)


def split_cells(payload: dict) -> tuple[dict, dict]:
    """The cell payload as the part sent first and the part that follows."""
    core = {k: v for k, v in payload.items() if k in CORE_CELL_KEYS}
    more = {k: v for k, v in payload.items() if k not in CORE_CELL_KEYS}
    return core, more


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
    windows = routing.all_windows(settings)
    jobs, fair, jobs_by_window, fair_by_window = {}, {}, {}, {}
    for column in table.columns:
        for prefix, usual, other, digits, scale in (
            ("jobshare", jobs, jobs_by_window, 2, 100),
            ("jobsfair", fair, fair_by_window, 2, 1),
        ):
            if not column.startswith(prefix):
                continue
            limit, mode = column.removeprefix(prefix).split("_", 1)
            values = _floats(table[column], digits, scale=scale)
            window = next((w for w in windows if mode == f"pt_{w}"), None)
            if window:
                other.setdefault(window, {})[limit] = values
            else:
                usual.setdefault(mode, {})[limit] = values
    # Public transport in the windows after a service's usual one. The usual
    # window is already in `t`, so nothing is sent twice.
    by_window = {}
    for s in services:
        for w in routing.service_windows(settings.services[s])[1:]:
            column = f"t_{s}_pt_{w}"
            if column in table:
                by_window.setdefault(s, {})[w] = _ints(table[column])
    return {
        "h3": [str(c) for c in table.index],
        "pop": _floats(table["population"], 1),
        "place": [place_index.get(v) if isinstance(v, str) else None for v in table["sa2"]],
        "nzdep": _ints(table["nzdep"]),
        "nocar": _ints(table["no_vehicle_share"], 100),
        "kids": _ints(table["children_share"], 100),
        "older": _ints(table["older_share"], 100),
        "groups": {
            key: _ints(table[column], 100)
            for key, column in (
                ("low_income", "low_income_share"),
                ("maori", "maori_share"),
                ("pacific", "pacific_share"),
                ("asian", "asian_share"),
                ("disabled", "disabled_share"),
            )
            if column in table
        },
        "drive": _ints(table["commute_car_share"], 100) if "commute_car_share" in table else None,
        # Equivalised household income in the fare year's dollars, to the
        # nearest hundred, for the fare burden.
        "inc": _ints(table["income_equivalised"], 0.01) if "income_equivalised" in table else None,
        "freq": {w: _floats(table[f"pt_per_hour_{w}"], 1) for w in settings.routing["windows"]},
        "m_stop": _ints(table["m_frequent_stop"]),
        "m_rail": _ints(table["m_rail_ferry"]),
        "m_bike": _ints(table["m_low_stress_route"]),
        "t": {s: {m: _ints(table[f"t_{s}_{m}"]) for m in WEB_MODES if f"t_{s}_{m}" in table} for s in services},
        # Public transport at the slower walking pace, usual time only; read by
        # the errand round's single-trip comparison, so it follows the map.
        "ts": {s: _ints(table[f"t_{s}_pt_slow"]) for s in services if f"t_{s}_pt_slow" in table},
        "choice": choice_payload(settings, table),
        # Whether each hexagon is in an urban area, sent only where some are not.
        "urban": [int(v) for v in table["urban"]] if "urban" in table and not table["urban"].all() else None,
        "tw": by_window,
        "km": {s: _floats(table[f"km_{s}"], 2) for s in services},
        "nearest": nearest,
        "jobs": jobs,
        "fair": fair,
        "jobsw": jobs_by_window,
        "fairw": fair_by_window,
        "access": access_payload(settings, table),
        "accessw": access_payload(settings, table, by_window=True),
        "cost": cost_payload(settings, table),
        "costw": cost_payload(settings, table, by_window=True),
        "zone": [str(v) if isinstance(v, str) else None for v in table["costzone"]] if "costzone" in table else None,
    }


ACCESS_WEB_KEYS = ("jobs", "everyday", "education", "all")


def choice_payload(settings: Settings, table: pd.DataFrame) -> dict:
    """How many of each service are within 10, 15, 20 and 30 minutes, by the
    counting mode that reaches most of them. Public transport is at its usual
    time and with no fare limit."""
    from .measures import COUNT_MINUTES

    out: dict[str, dict] = {}
    for service in settings.services:
        block = {}
        for limit in COUNT_MINUTES:
            parts = [f"n{limit}_{service}_{m}" for m in settings.standard_modes if f"n{limit}_{service}_{m}" in table]
            if parts:
                block[str(limit)] = _ints(table[parts].max(axis=1))
        if block:
            out[service] = block
    return out


def cost_payload(settings: Settings, table: pd.DataFrame, by_window: bool = False) -> dict:
    """What each zone budget reaches, per cell.

    Services are counts, because the question is whether a shop is within
    reach and how many there are. Jobs are a share of all the region's jobs,
    which is how the rest of the site reports them.

    With `by_window`, the same for each window after a purpose's usual one,
    keyed purpose, then window.
    """
    from .gravity import purpose_windows

    steps = max(
        (int(c.rsplit("_z", 1)[1]) for c in table.columns if c.startswith("costmin_") or c.startswith("costshare_")),
        default=4,
    )

    def block(name: str, jobs: bool) -> dict[str, list]:
        out: dict[str, list] = {}
        for limit in range(1, steps + 1):
            column = f"{'costshare' if jobs else 'costmin'}_{name}_z{limit}"
            if column in table:
                out[f"z{limit}"] = _floats(table[column], 2, scale=100) if jobs else _ints(table[column])
        return out

    out: dict[str, dict] = {}
    for purpose in settings.fares.get("purposes", []):
        if not by_window:
            found = block(purpose, purpose == "jobs")
            if found:
                out[purpose] = found
            continue
        for window in purpose_windows(settings, purpose)[1:]:
            found = block(f"{purpose}_{window}", purpose == "jobs")
            if found:
                out.setdefault(purpose, {})[window] = found
    return out


def access_payload(settings: Settings, table: pd.DataFrame, by_window: bool = False) -> dict:
    """Gravity indices for the web app: the headline keys only, as integers.

    The per-purpose scores stay in the download; the app needs the index, and
    works out deciles in the browser from whatever is on screen.

    With `by_window`, public transport in each window after the usual one,
    keyed window, then score.
    """
    out: dict[str, dict] = {}
    if by_window:
        for window in routing.all_windows(settings):
            block = {
                key: _ints(table[f"accessidx_{key}_pt_{window}"])
                for key in ACCESS_WEB_KEYS
                if f"accessidx_{key}_pt_{window}" in table
            }
            if block:
                out[window] = block
        return out
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
        "payment_labels": spec.get("payment_labels", {}),
        "zone_cap": record.get("zone_cap", 4),
        "kind": record.get("kind", "zones"),
        "offpeak_hours": (table.get("rules", {}) or {}).get("offpeak_hours", []),
        "periods": (table.get("rules", {}) or {}).get("periods", {}),
        "zones": record.get("zones", []),
        "adjacency": record.get("adjacency", {}),
        "fares": table.get("fares", {}),
        "free": table.get("free", {}),
        # Daily and weekly caps in one shape: {payments, daily, weekly}, each
        # cap by traveller, and by zones travelled where the network varies it.
        "caps": table.get("caps_normalised", {}),
        "source_url": table.get("source_url"),
        "read_on": table.get("read_on"),
        "zone_source_url": record.get("zone_source"),
        "cells_with_zone": record.get("cells_with_zone"),
    }


def affordability_meta(table: pd.DataFrame) -> dict:
    """How the income behind the fare burden was made, for the method note."""
    from . import affordability

    if "income_equivalised" not in table:
        return {}
    people = table["population"].where(table["income_equivalised"].notna(), 0.0)
    total = float(people.sum())
    median = None
    if total > 0:
        order = table["income_equivalised"].sort_values().index
        running = people.reindex(order).cumsum() / total
        median = float(table["income_equivalised"].reindex(order)[running >= 0.5].iloc[0])
    return {
        "income": "2023 Census median household income, divided by the square root of mean household size",
        "uplift": round(affordability.INCOME_UPLIFT, 4),
        "uplift_source": affordability.UPLIFT_SOURCE,
        "scale": 100,
        "median_income": round(median, -2) if median else None,
        "covered_share": round(float(people.sum() / table["population"].sum()), 4),
    }


def _area_records(frame: pd.DataFrame) -> list[dict]:
    records = frame.round(4).to_dict(orient="records")
    return [_clean(r) for r in records]


def write_web(settings: Settings, table: pd.DataFrame, destinations: pd.DataFrame, summary: dict, areas: dict) -> Path:
    data = settings.output_dir / "site" / "data"
    places, place_index = place_list(table)
    dests, dest_index = destination_list(destinations)
    core, more = split_cells(cell_payload(settings, table, place_index, dest_index))
    _dump(data / "cells.json", core)
    _dump(data / "cells_more.json", more)
    _dump(data / "places.json", places)
    _dump(data / "destinations.json", dests)
    # Errand rounds are only read when that view is opened, so they travel
    # in a file of their own.
    from . import chains

    rounds = chains.payload(settings, table, _ints)
    if rounds is not None:
        _dump(data / "chains.json", rounds)

    from . import context

    _dump(data / "overlays.json", context.overlays(settings))
    jobs_total = float(pd.read_parquet(settings.output_dir / "destinations" / "jobs.parquet")["jobs"].sum())
    meta = {
        "version": __version__,
        "built": dt.date.today().isoformat(),
        "region": settings.raw.get("region"),
        "naming": settings.naming,
        "routing_date": str(settings.routing["date"]),
        "routing_max_minutes": int(settings.routing.get("max_minutes", 60)),
        "windows": settings.routing["windows"],
        "modes": {k: v.get("label", k) for k, v in settings.modes.items()},
        "standard_modes": settings.standard_modes,
        "chains": _chains_meta(settings),
        # Where low-stress cycling's traffic stress comes from: SPAN's ratings
        # written into the street file, or R5's own.
        "cycling_stress": "span" if settings.raw["data"].get("osm_cycling") else "r5",
        "services": {
            k: {
                "label": v["label"],
                "standard_minutes": v["standard_minutes"],
                "window": v["window"],
                "windows": routing.service_windows(v),
            }
            for k, v in settings.services.items()
        },
        "jobs": {
            "thresholds": settings.jobs["thresholds"],
            "window": settings.jobs["window"],
            "windows": routing.job_windows(settings),
            "total": round(jobs_total),
        },
        "groups": {k: GROUPS[k][0] for k in equity.available_groups(table)},
        "group_note": "Shares describe the census block around a cell. Ethnicity is a multiple "
                      "response, so those groups overlap and do not add to the population. No car and lower "
                      "income are shares of households applied to residents; households without a car are "
                      "smaller than average, so those two overstate the number of people somewhat.",
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
            # Windows each headline score exists in, usual first; a usual of
            # null means its parts are usually timed differently.
            "windows": {key: gravity.score_windows(settings, key) for key in ACCESS_WEB_KEYS},
            "purposes": {k: v.get("label", k) for k, v in settings.gravity.get("purposes", {}).items()},
        },
        "fares": fare_meta(settings, summary),
        "affordability": affordability_meta(table),
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
    "t_": "Minutes to the nearest destination of this type by this mode (blank: none within 60 minutes). "
          "Public transport is in the service's usual window; a column ending in a window name "
          "(am_peak, interpeak, saturday) is the same trip in that window.",
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
    "costzone": "Public transport fare zone the cell sits in.",
    "urban": "True when the cell is in a Stats NZ urban area of 1,000 or more residents.",
    "n10_": "Destinations of this type within 10 minutes by this mode (n15, n20 and n30 likewise).",
    "n15_": "Destinations of this type within 15 minutes by this mode.",
    "n20_": "Destinations of this type within 20 minutes by this mode.",
    "n30_": "Destinations of this type within 30 minutes by this mode.",
    "household_size": "Mean usual residents per household in the SA1, 2023 Census.",
    "income_equivalised": "Median household income divided by the square root of household size, raised to 2026 by "
                          "the growth in average hourly earnings; used for the fare burden.",
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
    slug = settings.naming["slug"]
    flat.to_csv(folder / f"team_{slug}_h3.csv", index=False)
    geometry = [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in flat["h3"]]
    gpd.GeoDataFrame(flat, geometry=geometry, crs="EPSG:4326").to_file(folder / f"team_{slug}_h3.gpkg", driver="GPKG")
    pd.DataFrame({"field": flat.columns, "description": [_note(c) for c in flat.columns]}).to_csv(
        folder / "fields.csv", index=False
    )
    sums = []
    for path in sorted(folder.glob(f"team_{slug}_h3.*")) + [folder / "fields.csv"]:
        sums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
    (folder / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n")
    write_downloads_page(folder, settings)
    return folder


DOWNLOAD_NOTES = {
    "{slug}_h3.gpkg": "Every field for every populated hexagon, with the hexagon shapes (GeoPackage, for GIS).",
    "{slug}_h3.csv": "The same fields without shapes.",
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
<p>Travel times, standards, reasons, job access and census characteristics for every populated hexagon in __PLACE__. Version __VERSION__, built __BUILT__.</p>
<table>
<thead><tr><th>File</th><th>Contents</th><th>Size</th></tr></thead>
<tbody>
__ROWS__
</tbody>
</table>
<h2>Terms</h2>
<p>The data is derived from OpenStreetMap (Open Database Licence), Stats NZ and the Ministry of Education (CC BY 4.0), and __AGENCY__ open data. Parts derived from OpenStreetMap are shared under the Open Database Licence.</p>
<h2>Citation</h2>
<p>Welch, T. F. (2026). TEAM: Transport Equity and Access Model, __PLACE__. Version __VERSION__. Better Places Lab, University of Auckland.</p>
</body>
</html>
"""


def _size(path: Path) -> str:
    size = path.stat().st_size
    return f"{size / 1e6:.1f} MB" if size >= 1e6 else f"{max(1, round(size / 1e3))} KB"


def write_downloads_page(folder: Path, settings: Settings) -> None:
    slug = settings.naming["slug"]
    rows = []
    for template, note in DOWNLOAD_NOTES.items():
        name = template.format(slug=f"team_{slug}") if "{slug}" in template else template
        path = folder / name
        if path.exists():
            rows.append(f'<tr><td><a href="{name}">{name}</a></td><td>{note}</td><td>{_size(path)}</td></tr>')
    page = (
        DOWNLOADS_PAGE.replace("__ROWS__", "\n".join(rows))
        .replace("__VERSION__", __version__)
        .replace("__BUILT__", dt.date.today().isoformat())
        .replace("__PLACE__", settings.naming["place"])
        .replace("__AGENCY__", settings.naming.get("agency", "the local transport agency"))
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
