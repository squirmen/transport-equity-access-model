"""What a public transport journey costs, and what a traveller can reach for it.

Auckland Transport charges by the number of fare zones a journey passes
through, capped at four. Every transfer inside 30 minutes is part of the same
journey, so the fare depends on where a journey starts and ends and not on how
many vehicles it takes. That makes a fare a property of a pair of zones, which
is what lets this run from the routing already done: the origin-destination
pairs kept for the gravity scores carry everything needed.

The fare table and the zone boundaries are inputs, not constants. Fares come
from `raw/auckland/fares/at_fares_*.json`, read off Auckland Transport's fares
page. Zones come from `scripts/build_at_fare_zones.py`, which recovers them
from AT's published map.

A budget is turned into a number of zones rather than the other way round:
for a given traveller and a given budget, work out the most zones they can
afford, then count what is within that many zones. Zone counts run 1 to 4, so
a budget slider has four steps that matter, and the whole calculation can be
redone in the browser as the slider moves.

Columns added to the cell table, for each purpose and zone limit z:

    costzone                        the fare zone this cell sits in
    costaccess_<purpose>_z<z>       opportunities within the time cap and z zones
    costshare_<purpose>_z<z>        the same as a share of all of them in the region
"""

from __future__ import annotations

import collections
import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("team.fares")

ZONE_CAP = 4

# How a region prices a journey. Auckland counts the zones a journey passes
# through; Christchurch and most smaller networks charge one fare however far
# you go. A flat fare is the same calculation with a single zone, which keeps
# one code path rather than two.
KINDS = ("zones", "flat")
PROFILES = ("adult", "child_5_15", "secondary_student", "tertiary_student", "accessible", "community_connect")
PAYMENTS = ("hop", "cash")

# Some networks charge less outside the peak. Wellington discounts every
# Snapper fare by a fifth off-peak; Auckland does not vary by time at all. A
# fare table says which of its payment keys belong to which period, so the
# right column is picked from the hour a journey is routed at rather than
# being asked of the person using the site.
PERIODS = ("peak", "offpeak")


def load_table(path: Path) -> dict:
    """The fare table as published, with its provenance."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def flat_distance(zones: list[str]) -> dict[tuple[str, str], int]:
    """Every journey is one fare, whichever pair of areas it joins."""
    return {(a, b): 1 for a in zones for b in zones}


def zone_distance(adjacency: dict[str, list[str]], cap: int = ZONE_CAP) -> dict[tuple[str, str], int]:
    """Zones travelled through, for every pair of zones.

    A journey inside one zone is a one-zone fare, so the count is the number of
    zones on the path and not the number of boundaries crossed. Anything longer
    than the cap is charged at the cap.
    """
    out: dict[tuple[str, str], int] = {}
    for start in adjacency:
        seen = {start: 1}
        queue = collections.deque([start])
        while queue:
            here = queue.popleft()
            for nxt in adjacency.get(here, []):
                if nxt not in seen:
                    seen[nxt] = seen[here] + 1
                    queue.append(nxt)
        for zone, count in seen.items():
            out[(start, zone)] = min(int(count), cap)
    return out


def zone_cap(table: dict) -> int:
    """How many zone steps this fare table has. A flat fare has one.

    A table that states its own cap is believed. Otherwise the cap is however
    many numbered steps the adult fare actually has, so a table can never be
    asked for a step it does not carry.
    """
    if str(table.get("kind", "zones")) == "flat":
        return 1
    stated = (table.get("rules", {}) or {}).get("zone_cap")
    if stated:
        return int(stated)
    prices = (table.get("fares", {}) or {}).get("adult", {})
    steps = [
        int(key)
        for scale in prices.values()
        if isinstance(scale, dict)
        for key in scale
        if str(key).isdigit()
    ]
    return max(steps) if steps else ZONE_CAP


def payment_key(table: dict, payment: str, hour: float | None, weekday: bool = True) -> str:
    """The column of the fare table to read, given when the journey is made.

    A table that has no peak and off-peak split returns the payment method
    unchanged, which is Auckland. Where there is a split, an off-peak hour
    picks the cheaper column and anything else picks the dearer one.
    """
    periods = (table.get("rules", {}) or {}).get("periods")
    if not periods or payment == "cash":
        return payment
    offpeak = is_offpeak(table, hour, weekday)
    suffix = "offpeak" if offpeak else "peak"
    candidate = f"{payment}_{suffix}"
    prices = (table.get("fares", {}) or {}).get("adult", {})
    return candidate if candidate in prices else payment


def is_offpeak(table: dict, hour: float | None, weekday: bool = True) -> bool:
    """Whether this hour is charged at the off-peak rate."""
    windows = (table.get("rules", {}) or {}).get("offpeak_hours")
    if not windows:
        return False
    if not weekday:
        return True
    if hour is None:
        return False
    return any(float(start) <= float(hour) < float(end) for start, end in windows)


def fare(table: dict, zones: int, profile: str = "adult", payment: str = "hop") -> float:
    """The fare in dollars for a journey of `zones` zones.

    Journeys longer than the cap pay the cap. A profile that has no cash fare
    of its own pays the adult cash fare, which is how AT prices a concession
    that only exists on an AT HOP card. Under a flat fare there is one step,
    so every journey costs the same.
    """
    zones = max(1, min(int(zones), zone_cap(table)))
    prices = table["fares"].get(profile) or table["fares"]["adult"]
    scale = prices.get(payment) or prices["hop"]
    return float(scale[str(zones)])


def free_travel(table: dict, profile: str, hour: float | None, weekday: bool = True) -> bool:
    """Whether this traveller pays nothing at this time of day.

    SuperGold holders travel free after 9am on a weekday and all day at
    weekends. Before 9am on a weekday they pay an adult fare, which is why the
    time of day a journey is made changes what it costs.
    """
    if profile == "child_0_4":
        return True
    if profile != "supergold":
        return False
    if not weekday:
        return True
    if hour is None:
        return False
    return float(hour) >= float(str(table["free"]["supergold"]["free_from"]).split(":")[0])


def affordable_zones(
    table: dict,
    budget: float,
    profile: str = "adult",
    payment: str = "hop",
    return_trip: bool = True,
    hour: float | None = None,
    weekday: bool = True,
) -> int:
    """The most zones this traveller can pay for out of `budget`.

    A return trip is two journeys, because a transfer window joins the legs of
    one journey and not a trip out and back. Zero means they cannot afford to
    board at all, which leaves walking and cycling.
    """
    cap = zone_cap(table)
    if free_travel(table, profile, hour, weekday):
        return cap
    column = payment_key(table, payment, hour, weekday)
    trips = 2 if return_trip else 1
    best = 0
    for zones in range(1, cap + 1):
        if fare(table, zones, profile, column) * trips <= budget + 1e-9:
            best = zones
    return best


def budget_steps(table: dict, profile: str = "adult", payment: str = "hop", return_trip: bool = True) -> list[dict]:
    """What each zone limit costs, so a slider can be labelled honestly."""
    trips = 2 if return_trip else 1
    return [
        {"zones": z, "cost": round(fare(table, z, profile, payment) * trips, 2)}
        for z in range(1, zone_cap(table) + 1)
    ]


def assign_zones(
    points: pd.DataFrame,
    zones_path: Path,
    lon: str = "lon",
    lat: str = "lat",
    nearest_metres: float = 2000.0,
) -> pd.Series:
    """The fare zone each point falls in.

    The zones are recovered from a printed map, so their edges sit a few
    hundred metres from AT's own. A point just outside them takes the nearest
    zone within `nearest_metres`; past that it has no zone, which is right for
    the rural cells the fare zones were never drawn over.
    """
    import geopandas as gpd

    zones = gpd.read_file(zones_path)[["zone", "geometry"]].to_crs("EPSG:2193")
    frame = gpd.GeoDataFrame(
        {"_row": np.arange(len(points))},
        geometry=gpd.points_from_xy(points[lon], points[lat]),
        crs="EPSG:4326",
    ).to_crs("EPSG:2193")
    joined = gpd.sjoin(frame, zones, how="left", predicate="within").drop_duplicates("_row").sort_values("_row")
    found = pd.Series(joined["zone"].to_numpy(), index=points.index, dtype="object")
    missing = found.isna().to_numpy()
    if missing.any() and nearest_metres > 0:
        near = gpd.sjoin_nearest(frame[missing], zones, max_distance=nearest_metres).drop_duplicates("_row")
        found.iloc[near["_row"].to_numpy()] = near["zone"].to_numpy()
    return found


def pair_zone_counts(
    pairs: pd.DataFrame,
    origin_zone: pd.Series,
    destination_zone: pd.Series,
    distance: dict[tuple[str, str], int],
) -> np.ndarray:
    """How many zones each origin-destination pair passes through."""
    start = pairs["origin"].map(origin_zone)
    end = pairs["destination"].map(destination_zone)
    counts = np.full(len(pairs), np.nan)
    for i, (a, b) in enumerate(zip(start.to_numpy(), end.to_numpy())):
        if isinstance(a, str) and isinstance(b, str):
            value = distance.get((a, b))
            if value is not None:
                counts[i] = value
    return counts


def reachable_within(
    pairs: pd.DataFrame,
    weights: pd.Series,
    zone_counts: np.ndarray,
    minutes_cap: float,
    index: pd.Index,
) -> pd.DataFrame:
    """Opportunities reachable per origin, at each zone limit.

    Returns one column per zone limit, each counting what is inside both the
    time cap and that many zones. The columns rise with the limit, because a
    bigger budget can only add destinations.
    """
    keep = (pairs["minutes"].to_numpy() <= minutes_cap) & np.isfinite(zone_counts)
    rows = pairs.loc[keep]
    counts = zone_counts[keep]
    size = rows["destination"].map(weights).fillna(0.0).to_numpy(dtype="float64")
    out = {}
    for limit in range(1, ZONE_CAP + 1):
        inside = counts <= limit
        totals = pd.Series(size[inside], index=rows["origin"].to_numpy()[inside]).groupby(level=0).sum()
        out[f"z{limit}"] = totals.reindex(index).fillna(0.0).astype("float32")
    return pd.DataFrame(out, index=index)


def _destination_weights(settings, purpose: str) -> tuple[pd.Series, pd.DataFrame]:
    """The size of each destination for this purpose, and where they are."""
    folder = settings.output_dir / "destinations"
    if purpose == "jobs":
        table = pd.read_parquet(folder / "jobs.parquet").drop_duplicates("id")
        return table.set_index("id")["jobs"].astype("float64"), table
    table = pd.read_parquet(folder / "services.parquet")
    table = table[table["service"] == purpose].drop_duplicates("id")
    return table.set_index("id")["weight"].astype("float64"), table


def nearest_within(
    pairs: pd.DataFrame,
    zone_counts: np.ndarray,
    minutes_cap: float,
    index: pd.Index,
) -> pd.DataFrame:
    """Minutes to the nearest destination per origin, at each zone limit.

    The standards measure asks whether the nearest one is close enough. Under a
    budget it asks whether the nearest one a traveller can afford is close
    enough, which is this. Times fall as the limit rises, because a bigger
    budget can only bring nearer destinations into reach.
    """
    keep = (pairs["minutes"].to_numpy() <= minutes_cap) & np.isfinite(zone_counts)
    rows = pairs.loc[keep]
    counts = zone_counts[keep]
    minutes = rows["minutes"].to_numpy(dtype="float64")
    origins = rows["origin"].to_numpy()
    out = {}
    for limit in range(1, ZONE_CAP + 1):
        inside = counts <= limit
        best = pd.Series(minutes[inside], index=origins[inside]).groupby(level=0).min()
        out[f"z{limit}"] = best.reindex(index).astype("float32")
    return pd.DataFrame(out, index=index)


def build(settings, index: pd.Index, origins) -> tuple[pd.DataFrame, dict]:
    """Cost-constrained access columns, and a record of how they were made.

    Needs no new routing: the origin-destination pairs kept for the gravity
    scores already say who can reach what in the time cap, and a fare is a
    property of the zones at each end of a journey.
    """
    spec = settings.raw.get("fares")
    if not spec:
        return pd.DataFrame(index=index), {}
    data = settings.raw["data"]
    for key in ("fare_table", "fare_zones", "fare_zone_meta"):
        if key not in data or not settings.data(key).exists():
            log.warning("no %s configured; skipping the cost measures", key)
            return pd.DataFrame(index=index), {}

    table = load_table(settings.data("fare_table"))
    meta = json.loads(settings.data("fare_zone_meta").read_text(encoding="utf-8"))
    distance = zone_distance(meta["adjacency"])
    mode_id = str(spec.get("mode", "pt"))
    cap = float(spec.get("max_minutes", 45))

    places = pd.DataFrame(
        {"id": origins["id"].to_numpy(), "lon": origins.geometry.x.to_numpy(), "lat": origins.geometry.y.to_numpy()}
    )
    origin_zone = assign_zones(places, settings.data("fare_zones"))
    origin_zone.index = places["id"]
    log.info("fare zones: %d of %d cells", int(origin_zone.notna().sum()), len(origin_zone))

    from .gravity import _pairs

    columns: dict[str, pd.Series] = {}
    used: dict[str, dict] = {}
    for purpose in spec.get("purposes", []):
        weights, destinations = _destination_weights(settings, purpose)
        if destinations.empty:
            continue
        destination_zone = assign_zones(destinations, settings.data("fare_zones"))
        destination_zone.index = destinations["id"]
        pairs = _pairs(settings, purpose, mode_id, int(cap))
        if pairs is None or pairs.empty:
            log.warning("no %s pairs for %s; skipping", mode_id, purpose)
            continue
        counts = pair_zone_counts(pairs, origin_zone, destination_zone, distance)
        reached = reachable_within(pairs, weights, counts, cap, index)
        soonest = nearest_within(pairs, counts, cap, index)
        total = float(weights.sum())
        for limit in reached.columns:
            columns[f"costaccess_{purpose}_{limit}"] = reached[limit]
            columns[f"costmin_{purpose}_{limit}"] = soonest[limit]
            if total > 0:
                columns[f"costshare_{purpose}_{limit}"] = (reached[limit] / total).astype("float32")
        used[purpose] = {
            "pairs": int(len(pairs)),
            "priced": int(np.isfinite(counts).sum()),
            "destinations": int(len(destinations)),
            "total_weight": round(total, 1),
        }

    frame = pd.DataFrame(columns, index=index)
    frame["costzone"] = origin_zone.reindex(index).astype("object")
    record = {
        "mode": mode_id,
        "max_minutes": cap,
        "zone_cap": ZONE_CAP,
        "zones": meta.get("zones", []),
        "adjacency": meta.get("adjacency", {}),
        "fare_source": table.get("source_url"),
        "fare_read_on": table.get("read_on"),
        "zone_source": meta.get("source_url"),
        "cells_with_zone": int(origin_zone.notna().sum()),
        "purposes": used,
    }
    return frame, record
