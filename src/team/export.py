"""Web data files, the downloadable dataset, and the upload-ready site.

The web app reads five JSON files from data/:

    cells.json         one entry per hexagon, stored column by column
    summary.json       regional figures, breakdowns by NZDep and group, area tables
    places.json        SA2 names with centres and extents, for search and zooming
    destinations.json  the services used as destinations
    overlays.json      rail, ferry, bus and cycle network lines, and stops, for the map
    transit.json       the stops, stations and lines by name (not loaded by the app yet)
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
from . import ages, equity, gravity, routing, zones
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
    "freq", "t", "tw", "nearest", "nearest_mode", "ties", "urban", "zone", "vil", "areas", "ages", "ptr",
)

# Versions of the data files whose shape changed in 0.12.0, in summary.json
# meta.formats. The page refuses a file whose `format` differs.
FORMATS = {"cells": 2, "school_reach": 2, "zones": 2, "zone_outlines": 1, "school_stops": 1}


def _chains_meta(settings: Settings) -> dict | None:
    from . import chains

    return chains.meta(settings)


def _areas(table: pd.DataFrame) -> dict | None:
    out = {}
    for level, column in (("council", "council"), ("ward", "ward"), ("board", "local_board")):
        if column not in table:
            continue
        values = table[column]
        names = sorted({v for v in values.dropna() if isinstance(v, str) and v})
        if not names:
            continue
        index = {name: i for i, name in enumerate(names)}
        out[level] = {"names": names, "cell": [index.get(v) if isinstance(v, str) else None for v in values]}
    return out or None


def _villages(table: pd.DataFrame) -> dict | None:
    if "village_pop" not in table:
        return None
    held = np.flatnonzero(table["village_pop"].fillna(0).to_numpy() > 0)
    if not len(held):
        return None
    rows = table.iloc[held]
    return {
        "i": [int(i) for i in held],
        "pop": [round(float(v), 1) for v in rows["village_pop"]],
        "older": [round(float(v), 1) for v in rows["village_older"]],
        "home": [round(float(v), 1) for v in rows["home_older"]],
    }


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


def destination_list(destinations: pd.DataFrame, schools: pd.DataFrame | None = None) -> tuple[list[dict], dict[str, int]]:
    """Destinations for the site, one entry per place, in id order.

    A school's entry also says what it is (see docs/schools.md): moe, kind,
    medium, language, sex by service, years, roll, roll_date, scheme, zone
    (status and dates), zone_from and routed_to.
    """
    grouped = destinations.groupby("id", sort=True)
    about = schools.set_index("school") if schools is not None and not schools.empty else None
    rows = []
    for dest_id, group in grouped:
        first = group.iloc[0]
        row = {
            "name": first["name"] if isinstance(first["name"], str) else None,
            "services": sorted(group["service"].unique().tolist()),
            "lon": round(float(first["lon"]), 5),
            "lat": round(float(first["lat"]), 5),
        }
        if about is not None and dest_id in about.index:
            row.update(school_entry(about.loc[dest_id], row["services"]))
        rows.append(row)
    return rows, {str(dest_id): i for i, dest_id in enumerate(grouped.groups)}


def school_entry(record: pd.Series, services: list[str]) -> dict:
    def clean(value):
        return None if value is None or (isinstance(value, float) and not np.isfinite(value)) else value

    status = record.get("zone_status")
    zone = None
    if isinstance(status, str):
        nxt = clean(record.get("zone_next_from"))
        zone = {"status": status, "from": clean(record.get("zone_from")), "next": {"from": nxt} if isinstance(nxt, str) else None}
    return {
        "moe": int(record["moe"]),
        "kind": clean(record["kind"]),
        "medium": clean(record["medium"]),
        "language": clean(record["language"]),
        "sex": {s: clean(record.get(f"sex_{s}")) for s in services},
        "years": [clean(record["years_from"]), clean(record["years_to"])],
        "roll": int(record["roll"]) if pd.notna(record["roll"]) else None,
        "roll_date": clean(record["roll_date"]),
        "scheme": bool(record["scheme"]),
        "zone": zone,
        # Kept for older pages: the date of the zone In zone uses.
        "zone_from": zone["from"] if zone else None,
        "routed_to": int(record["entrances"]) if int(record["entrances"]) > 0 else "point",
        "point": record["point"],
        "point_note": point_note(record),
        "language_source": clean(record.get("language_source")),
    }


def point_note(record) -> str | None:
    """What the card says about a corrected map point."""
    if record.get("point") != "corrected":
        return None
    metres = float(record.get("point_moved_m") or 0.0)
    distance = f"{metres / 1000:.1f} km" if metres >= 1000 else f"{metres:.0f} m"
    return f"Moved {distance} to its grounds: the Ministry's point was outside them"


def nearest_by_mode(settings: Settings, table: pd.DataFrame, dest_index: dict) -> dict:
    """The destination reached in the time shown, for each service and mode,
    as an index into destinations.json. The card names this one, so the name
    always belongs to the time beside it."""
    out: dict = {}
    for service in settings.services:
        for mode in WEB_MODES:
            column = f"id_{service}_{mode}"
            if column in table:
                out.setdefault(service, {})[mode] = [dest_index.get(str(v)) if isinstance(v, str) else None for v in table[column]]
    return out


def ties_payload(school_state: dict | None, dest_index: dict) -> dict:
    """Other schools reached in the same whole minute as the one named, per
    service and mode: {cell index: [destination indices]}, in the site's order
    (straight-line distance, then MoE number)."""
    out: dict = {}
    for (service, key), ties in (school_state or {}).get("ties", {}).items():
        if key not in WEB_MODES:
            continue
        out.setdefault(service, {})[key] = {str(cell): [dest_index[d] for d in tied] for cell, tied in ties.items()}
    return out


def cell_payload(settings: Settings, table: pd.DataFrame, place_index: dict, dest_index: dict,
                 school_state: dict | None = None) -> dict:
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
        # Rest homes and retirement villages, for the hexagons that hold part
        # of one: residents there, 65+ there, and 65+ in the rest of the hexagon.
        "vil": _villages(table),
        # Council, ward and (in Auckland) local board of each hexagon, as an
        # index into a list of names, for figures by area.
        "areas": _areas(table),
        "tw": by_window,
        "km": {s: _floats(table[f"km_{s}"], 2) for s in services},
        # Nearest by the fastest counting mode. Kept for older pages; the card
        # reads nearest_mode, which names the one for the mode on screen.
        "nearest": nearest,
        "nearest_mode": nearest_by_mode(settings, table, dest_index),
        "ties": ties_payload(school_state, dest_index),
        "jobs": jobs,
        "fair": fair,
        "jobsw": jobs_by_window,
        "fairw": fair_by_window,
        "access": access_payload(settings, table),
        "accessw": access_payload(settings, table, by_window=True),
        "cost": cost_payload(settings, table),
        "costw": cost_payload(settings, table, by_window=True),
        "zone": [str(v) if isinstance(v, str) else None for v in table["costzone"]] if "costzone" in table else None,
        # Children by school age group (docs/schools.md, "Who is counted"), the
        # weights for school and early childhood figures.
        "ages": ages.payload(table),
        # R5's public transport minutes where they are slower than walking or
        # missing, usual window: the time shown by public transport is the walk.
        "ptr": ptr_payload(settings, table),
    }


def ptr_payload(settings: Settings, table: pd.DataFrame) -> dict:
    """{service: {"<cell index>": R5 minutes or null}}, only for cells where
    walking is quicker than R5's public transport or R5 has none within the
    limit, and walking gets there within it."""
    out: dict = {}
    for service in settings.services:
        r5, walk = f"t_{service}_pt_r5", f"t_{service}_walk"
        if r5 not in table or walk not in table:
            continue
        a = table[r5].to_numpy(dtype="float64")
        w = table[walk].to_numpy(dtype="float64")
        cells = np.flatnonzero(np.isfinite(w) & ~(a <= w))
        out[service] = {str(int(i)): (None if not np.isfinite(a[i]) else int(a[i])) for i in cells}
    return out


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
        # z0 is walking alone (pt_or_walk.py): no fare.
        for limit in range(0, steps + 1):
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


def reach_payload(reach: pd.DataFrame, n: int, dest_index: dict, spread: bool) -> dict:
    """One service and mode's reach lists: every school within the routing
    limit from each cell, nearest first. Cell i's schools are d[o[i]:o[i+1]].

    A public transport list is merged with walking (pt_or_walk.py): `m` is the
    quicker, and `r5` gives R5's own minutes at the positions `k` where they
    are slower than walking or missing (null)."""
    counts = np.bincount(reach["cell"].to_numpy(dtype="int64"), minlength=n) if len(reach) else np.zeros(n, dtype="int64")
    offsets = np.concatenate([[0], np.cumsum(counts)]).astype("int64")
    body = {
        "o": offsets.tolist(),
        "d": [dest_index[d] for d in reach["destination"]],
        "m": reach["minutes"].astype("int64").tolist(),
    }
    if spread and "lo" in reach:
        body["lo"] = reach["lo"].astype("int64").tolist()
        body["hi"] = [None if v == 255 else int(v) for v in reach["hi"]]
    if "r5" in reach:
        r5 = reach["r5"].to_numpy(dtype="float64")
        minutes = reach["minutes"].to_numpy(dtype="float64")
        positions = np.flatnonzero(~(r5 <= minutes))
        body["r5"] = {"k": positions.tolist(), "m": [None if not np.isfinite(r5[k]) else int(r5[k]) for k in positions]}
    return body


def write_schools(settings: Settings, folder: Path, school_state: dict, dest_index: dict, n: int,
                  listed: pd.DataFrame | None = None, zone_state: dict | None = None) -> dict:
    """data/schools/<service>_<mode>.json, read only when a school choice is
    made. Returns the file sizes, for the build log."""
    from .routing import service_windows
    from .schools import SHORT_LIST_MODES, short_list

    out = folder / "schools"
    if out.exists():
        shutil.rmtree(out)
    sizes = {}
    for (service, key), reach in sorted(school_state.get("reach", {}).items()):
        mode = max((m for m in settings.modes if key == m or key.startswith(f"{m}_")), key=len)
        transit = settings.modes[mode]["kind"] == "transit"
        window = (key[len(mode) + 1:] or service_windows(settings.services[service])[0]) if transit else None
        short = mode in SHORT_LIST_MODES and listed is not None
        if short:
            reach = short_list(reach, listed, service, zone_state)
        body = {
            "format": FORMATS["school_reach"], "service": service, "mode": mode, "window": window,
            "max_minutes": int(settings.routing.get("max_minutes", 60)),
            "order": "minutes, then straight-line metres from the hexagon centre, then MoE number",
            # A short list holds only the nearest school under All, State,
            # State girls and State boys, and those tied with it; with zones,
            # under In zone girls and In zone boys too.
            "complete": not short,
            **({"holds": ["all", "state"] + (["zone"] if zone_state is not None else [])} if short else {}),
            **({"pt_or_walk": True} if transit else {}),
            **reach_payload(reach, n, dest_index, spread=(key == "pt")),
        }
        path = out / f"{service}_{key}.json"
        _dump(path, body)
        sizes[path.name] = {
            "pairs": int(len(reach)),
            "json": path.stat().st_size,
            "gz": path.with_suffix(".json.gz").stat().st_size,
            "br": path.with_suffix(".json.br").stat().st_size if path.with_suffix(".json.br").exists() else None,
        }
    return sizes


def write_web(settings: Settings, table: pd.DataFrame, destinations: pd.DataFrame, summary: dict, areas: dict,
              school_state: dict | None = None) -> Path:
    from . import schools as school_data

    data = settings.output_dir / "site" / "data"
    places, place_index = place_list(table)
    listed = school_data.load_list(settings) if school_state and school_state.get("reach") else None
    zone_state = zones.build(settings, table, listed)  # enrolment zones: statuses, shares, majority sets
    if listed is not None:
        listed = zones.annotate(listed, zone_state)
    dests, dest_index = destination_list(destinations, listed)
    core, more = split_cells(cell_payload(settings, table, place_index, dest_index, school_state))
    # The card's nearest-by-mode for schools is sent first, about a tenth of
    # the first file in Auckland; every service's follows in cells_more. The
    # page merges the two files key by key, so the fuller copy replaces it.
    school_ids = set(school_data.school_service_ids(settings))
    more["nearest_mode"] = core["nearest_mode"]
    core["nearest_mode"] = {s: v for s, v in core["nearest_mode"].items() if s in school_ids}
    _dump(data / "cells.json", core)
    _dump(data / "cells_more.json", more)
    _dump(data / "places.json", places)
    _dump(data / "destinations.json", dests)
    # Errand rounds are only read when that view is opened, so they travel
    # in a file of their own.
    from . import chains

    rounds = chains.payload(settings, table, _ints)
    if rounds is not None:
        index, files = rounds
        _dump(data / "chains.json", index)
        folder = data / "chains"
        if folder.exists():
            shutil.rmtree(folder)
        for name, body in files.items():
            _dump(folder / f"{name}.json", body)

    from . import context

    layers, named = context.network_layers(settings)
    _dump(data / "overlays.json", layers)
    _dump(data / "transit.json", named)
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
    meta["ages"] = ages.meta(settings, table)  # children by school age group
    meta["formats"] = dict(FORMATS)
    from . import pt_or_walk

    meta["pt_or_walk"] = {
        "rule": pt_or_walk.RULE,
        "slow_factor": round(pt_or_walk.walk_factor(settings, "pt_slow"), 4) if "pt_slow" in settings.modes else None,
        "covers": pt_or_walk.COVERS,
        "not_covered": pt_or_walk.NOT_COVERED,
        "r5_columns": "_r5",
    }
    if listed is not None:
        from . import school_stops

        meta["schools"] = school_data.meta_block(settings, listed)
        meta["schools"]["files"] = write_schools(settings, data, school_state, dest_index, len(table), listed, zone_state)
        meta["schools"]["zones"] = zones.write(settings, data, zone_state, dest_index, len(table), table)  # zones.json, outlines
        meta["schools"]["stops"] = school_stops.write(settings, data, dest_index)
    _dump(
        data / "summary.json",
        {"meta": meta, **summary, "areas": {key: _area_records(frame) for key, frame in areas.items()}},
    )
    return data


FIELD_NOTES = {
    "h3": "H3 resolution 9 cell id (about 0.1 km²).",
    "population": "Usual residents, 2023 Census, spread from SA1 blocks by area.",
    "age_": "Children of these ages, 2023 Census five-year bands by SA1 split into single years by the 2018 Census "
            "shape of the surrounding SA2, spread onto hexagons as population is.",
    "zone_": "Enrolment zone status from the Ministry's zone file, as in force on 12 November 2026 (docs/schools.md).",
    "t_": "Minutes to the nearest destination of this type by this mode, whole minutes rounded down (blank: none within 60 minutes). "
          "Public transport is public transport, or walking where that is quicker, in the service's usual window; "
          "a column ending in a window name (am_peak, interpeak, saturday) is the same trip in that window.",
    "_r5": "The same by public transport as R5 routes it, before taking walking where that is quicker.",
    "n_": "Number of destinations of this type within the service's standard time by this mode, or within 30 minutes "
          "where the standard is longer (counts are kept at 10, 15, 20 and 30 minutes).",
    "id_": "Internal id of the nearest destination.",
    "moe": "Ministry of Education school number (School_Id).",
    "best_": "Fastest time using walking, low-stress cycling or public transport.",
    "via_": "The mode that gave the fastest time.",
    "meets_": "True when the fastest time is within the standard.",
    "options_": "How many of walking, low-stress cycling and public transport are within the standard; public transport "
                "counts only where a bus or train is quicker than walking.",
    "km_": "Straight-line distance to the nearest destination of this type.",
    "why_": "Main reason the standard is missed (codes in docs/indicators.md).",
    "jobs": "Jobs reachable within the stated minutes by the stated mode; public transport is public transport, or "
            "walking where that is quicker, job cell by job cell.",
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
    "costaccess_": "Opportunities of this type within the time cap and this many fare zones by public transport, or on foot "
                   "(z0: on foot alone, no fare).",
    "costmin_": "Minutes to the nearest one within this many fare zones by public transport, or on foot (z0: on foot alone).",
    "costshare_": "The same, as a share of all of them in the region.",
    "pt_per_hour_": "Departures per hour at the busiest stop within 800 m, in the named window.",
    "m_": "Straight-line metres to the nearest feature named.",
    "council": "Council (territorial authority) the cell's centre falls in, Stats NZ 2026 boundaries.",
    "ward": "Council ward the cell's centre falls in (general wards), Stats NZ 2026 boundaries.",
    "local_board": "Auckland local board the cell's centre falls in.",
    "village_pop": "Residents of census blocks taken to be rest homes or retirement villages (at least 60% aged 65+, "
                   "or 30% with a registered aged care facility), spread by area; blank where none.",
    "village_older": "Residents aged 65+ of those blocks.",
    "home_older": "Residents aged 65+ of the rest of the cell, where it holds part of a rest home or village block.",
}


def _note(column: str) -> str:
    if column.endswith("_r5"):
        return FIELD_NOTES["_r5"]
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
    from . import schools as school_data

    listed = school_data.load_list(settings)
    extra = []
    if listed is not None and not listed.empty:
        path = folder / f"team_{slug}_schools.csv"
        listed.drop(columns=["entrances"]).rename(columns={"school": "id"}).to_csv(path, index=False)
        extra.append(path)
        extra += zones.write_downloads(folder, settings)  # zone columns, and the hexagon zone shares
        from . import school_stops

        stops = school_stops.write_csv(settings, folder)
        if stops is not None:
            extra.append(stops)
    sums = []
    for path in sorted(folder.glob(f"team_{slug}_h3.*")) + extra + [folder / "fields.csv"]:
        sums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")
    (folder / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n")
    write_downloads_page(folder, settings)
    return folder


DOWNLOAD_NOTES = {
    "{slug}_h3.gpkg": "Every field for every populated hexagon, with the hexagon shapes (GeoPackage, for GIS).",
    "{slug}_h3.csv": "The same fields without shapes.",
    "{slug}_schools.csv": "Every school counted, with its kind, teaching language, who it takes, years, roll and map point.",
    "{slug}_school_zones.csv": "Each hexagon's share of residents in each school's zone, and the zones In zone counts it in.",
    "{slug}_school_stops.csv": "Stops and stations within a 15-minute walk of each school, with the routes and trips stopping there from 7am to 9am.",
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
