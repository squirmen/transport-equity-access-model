"""Why a place misses an access standard, and what kind of change would fix it.

These are screening rules. They say which kind of fix to look at first; they do
not replace a local study. Rules are checked in order and the first that
applies is recorded:

1. walk_link     The service is close in a straight line, but the walking
                 route is too long. Look for a missing path or crossing.
2. safe_bike     A confident rider could get there in time on busy roads, but
                 not on low-stress routes. Look for a safe cycling connection.
3. pt_frequency  The service is within bus range, the trip is too slow, and no
                 stop nearby has a frequent service. Look at frequency.
4. pt_trip       As above, but a frequent stop is nearby. Look at route
                 directness and transfers.
5. distance      None of the above: the nearest service is too far away.
                 Look at where services are, or could be, located.

Code 0 means the standard is met. Code 9 means the cell could not be routed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Settings

REASONS = {
    0: ("meets", "Meets the standard", ""),
    1: ("walk_link", "The walking route is indirect", "A new walking link or crossing"),
    2: ("safe_bike", "No low-stress bike route", "A safe cycling connection"),
    3: ("pt_frequency", "No frequent public transport nearby", "More frequent bus or train service"),
    4: ("pt_trip", "Public transport is slow for this trip", "A more direct route or better connections"),
    5: ("distance", "Nothing within reach", "A service closer to home"),
    9: ("no_data", "Could not be routed", ""),
}

DEFAULTS = {
    "circuity": 1.3,          # a normal walking route is about 30% longer than a straight line
    "pt_speed_kmh": 12.0,     # door-to-door bus speed, including the walk and the wait
    "frequent_per_hour": 4,   # every 15 minutes or better
}


def _within(series: pd.Series, limit: float) -> pd.Series:
    return series.le(limit).fillna(False)


def diagnose(table: pd.DataFrame, settings: Settings) -> pd.DataFrame:
    rules = {**DEFAULTS, **settings.raw.get("diagnosis", {})}
    walk_kmh = float(settings.routing.get("speed_walking_kmh", 4.8))
    for service, spec in settings.services.items():
        limit = float(spec["standard_minutes"])
        km = table[f"km_{service}"]
        walk = table.get(f"t_{service}_walk", pd.Series(np.nan, index=table.index))
        low_stress = table.get(f"t_{service}_bike_low_stress", pd.Series(np.nan, index=table.index))
        any_bike = table.get(f"t_{service}_bike", pd.Series(np.nan, index=table.index))
        transit = table.get(f"t_{service}_pt", pd.Series(np.nan, index=table.index))
        frequency = table.get(f"pt_per_hour_{spec['window']}", pd.Series(0.0, index=table.index)).fillna(0.0)

        straight_walk = km / walk_kmh * 60.0 * rules["circuity"]
        walk_link = _within(straight_walk, limit) & ~_within(walk, limit)
        safe_bike = _within(any_bike, limit) & ~_within(low_stress, limit)
        slow_transit = _within(km, rules["pt_speed_kmh"] * limit / 60.0) & ~_within(transit, limit)
        frequent = frequency >= rules["frequent_per_hour"]
        routed = table[[c for c in table.columns if c.startswith(f"t_{service}_")]].notna().any(axis=1)

        code = np.select(
            [
                ~routed,
                table[f"meets_{service}"].fillna(False),
                walk_link,
                safe_bike,
                slow_transit & ~frequent,
                slow_transit & frequent,
            ],
            [9, 0, 1, 2, 3, 4],
            default=5,
        )
        table[f"why_{service}"] = code.astype("int8")
    return table
