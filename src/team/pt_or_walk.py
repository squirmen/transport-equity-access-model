"""Public transport, or walking where that is quicker.

R5 lets a public transport trip walk up to `max_walk_minutes` (15) to and
from stops, and drops a walk all the way once it passes that limit. On its
own it can therefore make public transport look slower than walking: next to
Mt Albert Grammar School a 15-minute walk comes out as 26 minutes by public
transport, and in central Blenheim a 22-minute walk as no public transport
time at all.

From 0.12.0 every public transport time is the quicker of R5's public
transport time and walking all the way, origin by destination:

    minutes = min(R5's public transport minutes, walking minutes)

For `pt` the walk is the `walk` run (4.8 km/h). For a mode that walks at a
slower pace (`pt_slow`, 3.6 km/h) it is the walk at that pace, worked out
from the walk run as floor(walking minutes x usual pace / slower pace), the
factor the errand rounds already use. Walking does not depend on the clock,
so the same walk serves every window. A pair where walking is at least as
quick is a walk (`walk_quicker`): no fare, no bus or train. Whole minutes
rounded down, as before; the 60-minute limit still applies.

The spread of a school trip (10th and 90th percentiles over the departure
minutes) follows exactly: R5's percentile is an order statistic, and taking
min(x, walk) minute by minute does not reorder the minutes, so the new 10th
and 90th percentiles are min(R5's, walk). A pair with no R5 time within the
limit is the walk at every departure minute.

Everything that counts public transport is built from these merged pairs:
nearest times, counts within 10 to 30 minutes, school reach lists, jobs
within 30 and 45 minutes, the competition-adjusted job measure, gravity
scores and fares. The cell-to-cell trips behind `?mate=1` (team pairs) are
R5's paths with their stops and are not changed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Settings

COVERS = [
    "nearest times by public transport (t_, id_), every window",
    "counts within 10, 15, 20 and 30 minutes and the standard (n_, n10_ to n30_, choice)",
    "school reach lists, by public transport and at the slower walking pace, with their spread",
    "jobs within 30 and 45 minutes (jobs, jobshare) and the competition-adjusted measure (jobsfair)",
    "gravity scores (access_, accessidx_, accessdec_)",
    "fares: a pair where walking is quicker is priced at 0 zones (costaccess_, costmin_, costshare_, z0)",
    "how many ways meet the standard (options_): public transport counts only where a bus or train is quicker than walking",
]
NOT_COVERED = ["cell-to-cell trips and MATE (?mate=1)"]

RULE = ("Public transport is the quicker of R5's public transport trip and walking all the way, pair by pair. "
        "A pair where walking is at least as quick is a walk: no fare, no bus or train.")


def is_transit(settings: Settings, mode_id: str) -> bool:
    return settings.modes[mode_id]["kind"] == "transit"


def walk_factor(settings: Settings, mode_id: str) -> float:
    """How much longer a walk takes at this mode's walking pace than at the usual pace."""
    usual = float(settings.routing.get("speed_walking_kmh", 4.8))
    pace = float(settings.modes[mode_id].get("speed_walking_kmh", usual))
    return usual / pace


def walk_minutes(minutes, factor: float) -> np.ndarray:
    """Walking minutes at another pace, whole minutes rounded down."""
    values = np.asarray(minutes, dtype="float64")
    if factor == 1.0:
        return values
    # The small nudge keeps 3 x 4/3 at 4 rather than 3.9999...
    return np.floor(values * factor + 1e-9)


def merge(pt: pd.DataFrame, walk: pd.DataFrame, keys: list[str], limit: float, factor: float = 1.0,
          spread: bool = False) -> pd.DataFrame:
    """Public transport pairs merged with walking pairs, pair by pair.

    `pt` and `walk` hold `keys` and `minutes` (`pt` also `lo` and `hi` when
    `spread`, with 255 for a 90th percentile past the limit). Returns one row
    per pair either reaches within `limit`, with `keys`, `minutes` (the
    quicker), `r5` (R5's public transport minutes, NaN where none within the
    limit), `walk` (walking minutes at this pace, NaN where none) and
    `walk_quicker` (walking at least as quick as R5, or R5 has none), and with
    `spread`, `lo` and `hi` of the quicker trip at each departure minute.
    """
    left = pt[[*keys, "minutes", *(["lo", "hi"] if spread else [])]].rename(columns={"minutes": "r5"})
    right = walk[[*keys, "minutes"]].rename(columns={"minutes": "walk"})
    right = right.assign(walk=walk_minutes(right["walk"].to_numpy(), factor))
    right = right[right["walk"] <= limit]
    both = left.merge(right, on=keys, how="outer", sort=False)
    r5 = both["r5"].to_numpy(dtype="float64")
    on_foot = both["walk"].to_numpy(dtype="float64")
    quicker = np.fmin(r5, on_foot)
    out = both[keys].copy()
    out["minutes"] = quicker.astype("uint8")
    out["r5"] = r5.astype("float32")
    out["walk"] = on_foot.astype("float32")
    out["walk_quicker"] = np.isfinite(on_foot) & ~(r5 < on_foot)
    if spread:
        lo = both["lo"].to_numpy(dtype="float64")
        hi = both["hi"].to_numpy(dtype="float64")
        # No R5 time within the limit: the walk at every departure minute.
        lo = np.where(np.isnan(r5), on_foot, np.fmin(lo, on_foot))
        hi = np.where(np.isnan(r5), on_foot, np.fmin(hi, on_foot))
        out["lo"] = lo.astype("uint8")
        out["hi"] = hi.astype("uint8")
    return out.reset_index(drop=True)


def merge_nearest(r5_minutes: pd.Series, r5_id: pd.Series, walk_minutes_: pd.Series, walk_id: pd.Series,
                  limit: float, factor: float = 1.0) -> tuple[pd.Series, pd.Series]:
    """Nearest-destination time and name per cell: the quicker of R5's nearest
    by public transport and walking's nearest. Walking's destination is named
    where walking is strictly quicker or R5 has none; equal times keep R5's."""
    on_foot = pd.Series(walk_minutes(walk_minutes_.to_numpy(), factor), index=walk_minutes_.index)
    on_foot = on_foot.where(on_foot <= limit)
    take_walk = on_foot.notna() & ~(r5_minutes <= on_foot)
    minutes = r5_minutes.where(~take_walk, on_foot).astype("float32")
    named = r5_id.where(~take_walk, walk_id)
    return minutes, named.where(minutes.notna())


def counts(pairs: pd.DataFrame, keys: list[str], limits) -> pd.DataFrame:
    """How many destinations each origin (and service) reaches within each limit."""
    out = None
    for limit in limits:
        got = pairs[pairs["minutes"] <= limit].groupby(keys).size().rename(f"n{limit}")
        out = got.to_frame() if out is None else out.join(got, how="outer")
    return out.fillna(0).astype("int32") if out is not None else pd.DataFrame()


def _load(settings: Settings, dataset: str, mode_id: str, window: str | None) -> pd.DataFrame | None:
    from .measures import load_pairs
    from .routing import run_tag

    transit = is_transit(settings, mode_id)
    tag = run_tag(dataset, mode_id, window if transit else None, transit)
    if dataset == "schools":
        from .schools import load_reach

        return load_reach(settings, tag)
    return load_pairs(settings, tag)


def load_merged(settings: Settings, dataset: str, mode_id: str, window: str | None = None,
                services: list[str] | None = None) -> pd.DataFrame | None:
    """A run's cached pairs, with public transport merged with walking.

    `dataset` is services, schools or jobs. For a public transport mode the
    pairs carry `r5`, `walk` and `walk_quicker` (see `merge`); other modes
    are returned as cached. `services` keeps only those services' pairs.
    """
    pairs = _load(settings, dataset, mode_id, window)
    if pairs is None:
        return None
    if services is not None and "service" in pairs:
        pairs = pairs[pairs["service"].isin(services)]
    if not is_transit(settings, mode_id) or "walk" not in settings.modes:
        return pairs
    walk = _load(settings, dataset, "walk", None)
    if walk is None:
        raise SystemExit(f"{dataset} by public transport cannot be merged with walking: the walk run's pairs are missing.")
    if services is not None and "service" in walk:
        walk = walk[walk["service"].isin(services)]
    keys = ["origin", "destination", "service"] if "service" in pairs else ["origin", "destination"]
    limit = float(settings.routing.get("max_minutes", 60))
    return merge(pairs, walk, keys, limit, walk_factor(settings, mode_id), spread={"lo", "hi"} <= set(pairs.columns))
