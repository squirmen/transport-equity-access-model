"""Gravity access scores: every opportunity counted, discounted by how long it
takes to reach.

The standards measures answer whether the nearest service is within a stated
time. A gravity score answers a different question: how much is within reach
from here, counting a second supermarket for less than the first and a job an
hour away for less than one ten minutes away.

Four impedance families are supported:

    negative exponential   f(t) = exp(-b t)
    gaussian               f(t) = exp(-b t^2)
    log-logistic           f(t) = 1 / (1 + (t / m)^b)
    pct                    the Propensity to Cycle Tool's distance decay,
                           for cycling, where no local curve exists

The defaults in `configs/*.yml` take the travel time distribution parameters
the NZ Transport Agency published for the New Zealand accessibility analysis
methodology (Abley and Halden, 2013, research report 512, tables 13.2 and
13.4), fitted to the New Zealand Household Travel Survey. Those are already
per-minute parameters on routed travel time, so they are used as published.

That method counts nothing past the point where 95% of trips of a kind are
done, so each curve carries its own horizon rather than sharing one number;
see `cutoff_minutes`. The log-logistic median `m` is not transferable, so it
is the routed median for that purpose and mode in this run. The functions are
settings, not constants.

Columns added to the cell table:

    access_<purpose>_<mode>     score: sum of opportunity weights times f(t)
    accessidx_<purpose>_<mode>  the same, as an index where the population-
                                weighted regional mean is 100
    accessdec_<purpose>_<mode>  population-weighted decile of the score,
                                1 lowest to 10 highest
"""

from __future__ import annotations

import numpy as np
import pandas as pd

FUNCTIONS = ("negative_exponential", "gaussian", "log_logistic", "pct")

# The share of trips left beyond the cut-off in the NZ accessibility method:
# solving 0.05 = exp(-beta t) gives the time by which 95% of trips are done.
CUTOFF_SHARE = 0.05


def cutoff_minutes(spec: dict, fallback: float) -> float:
    """How far out to count, in minutes.

    NZTA research report 512 fits its curves to the first 95% of surveyed
    travel times and sets accessibility to zero beyond that point, so a curve
    taken from it should carry its own horizon rather than a single number
    applied to every purpose. `cutoff: rr512` works that horizon out from the
    fitted parameter; a number sets it directly. Either way the run cannot
    count further than the journeys it actually routed.
    """
    rule = spec.get("cutoff")
    if rule is None:
        return float(fallback)
    if isinstance(rule, (int, float)):
        return min(float(rule), float(fallback))
    if str(rule) == "rr512":
        beta = float(spec.get("beta", 0.0))
        if beta <= 0:
            return float(fallback)
        return min(float(np.log(1.0 / CUTOFF_SHARE) / beta), float(fallback))
    raise ValueError(f"unknown cutoff rule: {rule}")


def impedance(minutes: np.ndarray, spec: dict) -> np.ndarray:
    """Weight for each travel time under one impedance function."""
    kind = str(spec.get("function", "negative_exponential"))
    beta = float(spec.get("beta", 0.0))
    time = np.asarray(minutes, dtype="float64")
    if kind == "negative_exponential":
        return np.exp(-beta * time)
    if kind == "gaussian":
        return np.exp(-beta * np.square(time))
    if kind == "log_logistic":
        median = float(spec.get("median", 0.0))
        if median <= 0:
            raise ValueError("log_logistic needs a positive median")
        return 1.0 / (1.0 + np.power(time / median, beta))
    if kind == "pct":
        return _pct_decay(time, spec)
    raise ValueError(f"unknown impedance function: {kind}; use one of {', '.join(FUNCTIONS)}")


def _pct_propensity(distance_km: np.ndarray, spec: dict) -> np.ndarray:
    """Propensity to cycle a trip of this length, from the PCT logit."""
    b0, b1, b2, b3 = (float(spec[f"b{i}"]) for i in range(4))
    root = np.sqrt(distance_km)
    return 1.0 / (1.0 + np.exp(-(b0 + b1 * distance_km + b2 * root + b3 * np.square(distance_km))))


def _pct_decay(minutes: np.ndarray, spec: dict) -> np.ndarray:
    """Cycling weight from the Propensity to Cycle Tool's distance decay.

    The PCT logit describes how likely a commuter is to cycle a trip of a given
    length. It rises to a peak around two kilometres, because people walk the
    shortest trips rather than ride them. That is about which trips get cycled,
    not about how much a nearby destination is worth, so the curve is held flat
    below its peak: everything inside the easiest riding distance counts in
    full, and beyond it the weight falls the way the PCT says cycling does.

    Gradient terms are evaluated at the PCT's reference gradient, so this is a
    flat-terrain curve. Auckland is not flat, and the routed times already
    carry the hills; the decay does not.
    """
    speed = float(spec.get("speed_kmh", 15.0))
    if speed <= 0:
        raise ValueError("pct decay needs a positive speed_kmh")
    distance = np.asarray(minutes, dtype="float64") * speed / 60.0
    grid = np.linspace(0.0, 30.0, 3001)
    curve = _pct_propensity(grid, spec)
    peak = float(grid[int(np.argmax(curve))])
    values = _pct_propensity(np.maximum(distance, peak), spec)
    return values / float(curve.max())


def routed_median(pairs: pd.DataFrame) -> float:
    """Median routed journey time in a pair set, used for log-logistic fits."""
    if pairs.empty:
        return 0.0
    return float(np.median(pairs["minutes"].to_numpy(dtype="float64")))


def score(pairs: pd.DataFrame, weights: pd.Series, spec: dict) -> pd.Series:
    """Sum of opportunity weight times impedance, per origin.

    `pairs` holds origin, destination and minutes; `weights` is the size of
    each destination, indexed by destination id.
    """
    if pairs.empty:
        return pd.Series(dtype="float64")
    size = pairs["destination"].map(weights).fillna(0.0).to_numpy(dtype="float64")
    value = size * impedance(pairs["minutes"].to_numpy(), spec)
    return pd.Series(value, index=pairs["origin"].to_numpy()).groupby(level=0).sum()


def index_to_mean(values: pd.Series, population: pd.Series) -> pd.Series:
    """The score as an index where the population-weighted regional mean is 100."""
    people = population.reindex(values.index).fillna(0.0)
    total = float(people.sum())
    if total <= 0:
        return pd.Series(np.nan, index=values.index, dtype="float32")
    mean = float((values.fillna(0.0) * people).sum() / total)
    if mean <= 0:
        return pd.Series(np.nan, index=values.index, dtype="float32")
    return (values / mean * 100.0).astype("float32")


def deciles(values: pd.Series, population: pd.Series) -> pd.Series:
    """Population-weighted deciles, 1 lowest access to 10 highest.

    Cut points fall where each tenth of residents sits, so a decile names the
    people at that level of access rather than a tenth of the map.
    """
    people = population.reindex(values.index).fillna(0.0)
    frame = pd.DataFrame({"value": values, "people": people}).dropna(subset=["value"])
    frame = frame[frame["people"] > 0].sort_values("value", kind="stable")
    if frame.empty:
        return pd.Series(np.nan, index=values.index, dtype="float32")
    share = frame["people"].cumsum() / frame["people"].sum()
    band = np.clip(np.ceil(share * 10.0), 1, 10)
    return pd.Series(band, index=frame.index).reindex(values.index).astype("float32")


def _weights(settings) -> dict[str, pd.Series]:
    """Opportunity size for each destination, by purpose."""
    folder = settings.output_dir / "destinations"
    out: dict[str, pd.Series] = {}
    jobs = pd.read_parquet(folder / "jobs.parquet")
    out["jobs"] = jobs.set_index("id")["jobs"].astype("float64")
    services = pd.read_parquet(folder / "services.parquet")
    for service, rows in services.groupby("service"):
        out[str(service)] = rows.set_index("id")["weight"].astype("float64")
    return out


def _pair_tags(settings, purpose: str, mode_id: str) -> list[str]:
    """The routing runs holding the pairs for one purpose and mode."""
    from .routing import run_tag

    transit = settings.modes[mode_id]["kind"] == "transit"
    if purpose == "jobs":
        window = settings.jobs["window"] if transit else None
        return [run_tag("jobs", mode_id, window, transit)]
    window = settings.services[purpose]["window"] if transit else None
    return [run_tag("services", mode_id, window, transit)]


def _pairs(settings, purpose: str, mode_id: str, cap: float) -> pd.DataFrame | None:
    from .measures import load_pairs

    frames = []
    for tag in _pair_tags(settings, purpose, mode_id):
        pairs = load_pairs(settings, tag)
        if pairs is None:
            continue
        if "service" in pairs.columns:
            pairs = pairs[pairs["service"] == purpose]
        frames.append(pairs[["origin", "destination", "minutes"]])
    if not frames:
        return None
    pairs = pd.concat(frames, ignore_index=True)
    return pairs[pairs["minutes"] <= cap]


def build(settings, index: pd.Index, population: pd.Series) -> tuple[pd.DataFrame, dict]:
    """Gravity scores for every configured purpose and mode.

    Returns the columns to join onto the cell table, and a record of the
    functions used, for the run manifest and the method page.
    """
    spec = settings.gravity
    if not spec:
        return pd.DataFrame(index=index), {}
    cap = int(spec.get("max_minutes", 45))
    weights = _weights(settings)
    columns: dict[str, pd.Series] = {}
    used: dict[str, dict] = {}
    groups: dict[str, list[str]] = {}
    for purpose, purpose_spec in spec["purposes"].items():
        groups.setdefault(str(purpose_spec.get("group", "all")), []).append(purpose)
        for mode_id in spec["modes"]:
            settings_for_mode = dict(purpose_spec.get(mode_id, {}))
            if not settings_for_mode:
                continue
            horizon = cutoff_minutes(settings_for_mode, cap)
            pairs = _pairs(settings, purpose, mode_id, horizon)
            if pairs is None or pairs.empty:
                continue
            if settings_for_mode.get("function") == "log_logistic" and not settings_for_mode.get("median"):
                settings_for_mode["median"] = routed_median(pairs)
            values = score(pairs, weights.get(purpose, pd.Series(dtype="float64")), settings_for_mode)
            values = values.reindex(index).fillna(0.0)
            columns[f"access_{purpose}_{mode_id}"] = values.astype("float32")
            columns[f"accessidx_{purpose}_{mode_id}"] = index_to_mean(values, population)
            columns[f"accessdec_{purpose}_{mode_id}"] = deciles(values, population)
            used[f"{purpose}_{mode_id}"] = {
                **settings_for_mode,
                "max_minutes": round(float(horizon), 1),
                "pairs": int(len(pairs)),
            }
    table = pd.DataFrame(columns, index=index)
    # Group and overall figures average the indices, which share a scale;
    # the raw scores count different things and cannot be added together.
    for mode_id in spec["modes"]:
        for group, members in groups.items():
            parts = [f"accessidx_{p}_{mode_id}" for p in members if f"accessidx_{p}_{mode_id}" in table]
            if parts:
                table[f"accessidx_{group}_{mode_id}"] = table[parts].mean(axis=1).astype("float32")
                table[f"accessdec_{group}_{mode_id}"] = deciles(table[f"accessidx_{group}_{mode_id}"], population)
        parts = [c for c in table.columns if c.startswith("accessidx_") and c.endswith(f"_{mode_id}")
                 and c.split("_")[1] in spec["purposes"]]
        if parts:
            table[f"accessidx_all_{mode_id}"] = table[parts].mean(axis=1).astype("float32")
            table[f"accessdec_all_{mode_id}"] = deciles(table[f"accessidx_all_{mode_id}"], population)
    return table, used
