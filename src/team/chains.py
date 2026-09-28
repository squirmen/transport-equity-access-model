"""Errand rounds: one trip from home to several services and back, without a car.

Someone who can walk to a GP may still drive, because the same outing has to
take in the pharmacy and the supermarket. A round is home, then each stop in
turn, then home, and its length is the travel time only, not the time spent
inside. The pharmacy comes after the GP, where the prescription is written;
the supermarket can come at any point.

The legs from home are the service runs already routed from every hexagon.
The legs between stops are the `links` runs, routed from every stop to every
other. Each home tries the nearest few stops of each kind (`candidates`,
five by default), in every allowed order, and keeps the quickest round. The
nearest GP and then the pharmacy nearest to it is a greedy answer that can
miss a better round, such as a GP a little further off with a pharmacy next
door, so the search looks wider than that.

A round is also kept for each limit on its longest leg, because someone can
often manage several short walks and not one long one.

Rounds are worked out for each way of travelling:

    walk             walking, every leg
    walk_slow        walking at the slower pace, from the walking times
    pt               the faster of walking and public transport, leg by leg
    pt_slow          the same at the slower pace
    bike_low_stress  low-stress cycling, every leg

The way home from the last stop is routed for walking and cycling (the
`returns` runs), because hills make it longer or shorter than the way out. By
public transport, or at the slower pace, the way home by the faster of walking
and public transport takes the walk home at that pace against the public
transport trip out; a timetable home is not routed.

Columns added to the cell table, for each set of stops S (named by its stops
joined with '+'), way of travelling m and leg limit L (a number of minutes or
'any'):

    round_<S>_<m>_<L>    minutes of travel for the quickest round, or NaN
"""

from __future__ import annotations

import itertools
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

log = logging.getLogger("team.chains")

INF = np.float32(np.inf)
CHUNK = 4000


def spec(settings: Settings) -> dict | None:
    return settings.raw.get("chains")


def stop_sets(stops: list[str], most: int | None = None) -> list[tuple[str, ...]]:
    """Every set of two up to `most` stops, in the configured order."""
    most = len(stops) if most is None else min(most, len(stops))
    return [combo for size in range(most, 1, -1) for combo in itertools.combinations(stops, size)]


def orders(stop_set: tuple[str, ...], after: dict[str, str]) -> list[tuple[str, ...]]:
    """The orders a set of stops can be visited in.

    `after` maps a stop to one that must come before it when both are in the
    set, as the pharmacy comes after the GP.
    """
    allowed = []
    for order in itertools.permutations(stop_set):
        position = {stop: i for i, stop in enumerate(order)}
        if all(position[later] > position[earlier] for later, earlier in after.items()
               if later in position and earlier in position):
            allowed.append(order)
    return allowed


def set_name(stop_set: tuple[str, ...]) -> str:
    return "+".join(stop_set)


def set_file(stop_set: tuple[str, ...] | str) -> str:
    """The file a set of stops is written to, safe in any address."""
    names = stop_set.split("+") if isinstance(stop_set, str) else stop_set
    return "-".join(names)


def _pairs(settings: Settings, tag: str, stops: list[str]) -> pd.DataFrame:
    """Every routed leg from a hexagon to a stop, for one service run."""
    folder = settings.cache_dir / "pairs" / tag
    files = sorted(folder.glob("origins_*[0-9].parquet"))
    if not files:
        raise SystemExit(f"No routed pairs for {tag} in {folder}. Run `team route --all` first.")
    pairs = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    pairs = pairs[pairs["service"].isin(stops)]
    return pairs.astype({"origin": str, "destination": str, "minutes": "float32"})


def _links(settings: Settings, tag: str) -> pd.DataFrame:
    path = settings.output_dir / "routing" / f"{tag}.parquet"
    if not path.exists():
        raise SystemExit(f"No routed links for {tag}. Run `team route --all` first.")
    return pd.read_parquet(path).astype({"origin": str, "destination": str, "minutes": "float32"})


def _link_matrix(links: pd.DataFrame, index: dict[str, int]) -> np.ndarray:
    matrix = np.full((len(index), len(index)), INF, dtype="float32")
    np.fill_diagonal(matrix, 0.0)
    a = links["origin"].map(index)
    b = links["destination"].map(index)
    keep = a.notna() & b.notna()
    matrix[a[keep].astype(int).to_numpy(), b[keep].astype(int).to_numpy()] = links.loc[keep, "minutes"].to_numpy()
    return matrix


def _nearest(pairs: pd.DataFrame, cells: pd.Index, stop: str, index: dict[str, int], k: int) -> tuple[np.ndarray, np.ndarray]:
    """The k nearest stops of one kind from every hexagon: minutes and stop index."""
    rows = pairs[pairs["service"] == stop].sort_values(["origin", "minutes"], kind="stable")
    rows = rows.groupby("origin", sort=False).head(k)
    rank = rows.groupby("origin", sort=False).cumcount().to_numpy()
    where = cells.get_indexer(rows["origin"])
    keep = where >= 0
    times = np.full((len(cells), k), INF, dtype="float32")
    ids = np.zeros((len(cells), k), dtype="int32")
    times[where[keep], rank[keep]] = rows["minutes"].to_numpy()[keep]
    ids[where[keep], rank[keep]] = rows["destination"].map(index).fillna(0).astype(int).to_numpy()[keep]
    return times, ids


def best_rounds(
    home: dict[str, tuple[np.ndarray, np.ndarray]],
    links: np.ndarray,
    stop_orders: list[tuple[str, ...]],
    limits: list[float],
    back: dict[str, np.ndarray] | None = None,
) -> np.ndarray:
    """The quickest round for every hexagon under each limit on the longest leg.

    `home[stop]` holds the minutes and stop indexes of each hexagon's nearest
    stops of that kind; `back[stop]`, if given, the minutes from each of those
    stops home again, which otherwise are taken as the way out. Returns an
    array of shape (hexagons, limits).
    """
    n = next(iter(home.values()))[0].shape[0]
    best = np.full((n, len(limits)), INF, dtype="float32")
    for start in range(0, n, CHUNK):
        stop = min(start + CHUNK, n)
        for order in stop_orders:
            # Legs of the round, broadcast so each stop's candidates sit on
            # their own axis: home -> first, first -> second, ..., last -> home.
            k = len(order)
            total = None
            longest = None
            previous_ids = None
            for position, kind in enumerate(order):
                times, ids = home[kind]
                shape = [stop - start] + [1] * k
                shape[position + 1] = times.shape[1]
                these_ids = ids[start:stop].reshape(shape)
                reached = times[start:stop].reshape(shape)
                if position == 0:
                    leg = reached
                else:
                    # A home with fewer stops of a kind in reach than there are
                    # candidates has empty slots; they cannot be stopped at.
                    leg = np.where(np.isfinite(reached), links[previous_ids, these_ids], INF)
                total = leg if total is None else total + leg
                longest = leg if longest is None else np.maximum(longest, leg)
                previous_ids = these_ids
            last = back[order[-1]] if back is not None else home[order[-1]][0]
            back_leg = last[start:stop].reshape(shape)
            total = total + back_leg
            longest = np.maximum(longest, back_leg)
            flat_total = total.reshape(stop - start, -1)
            flat_longest = longest.reshape(stop - start, -1)
            for j, limit in enumerate(limits):
                masked = np.where(flat_longest <= limit, flat_total, INF)
                best[start:stop, j] = np.minimum(best[start:stop, j], masked.min(axis=1))
    return best


def _modes(settings: Settings, chains: dict) -> dict[str, dict]:
    """How each way of travelling builds its legs from the routed runs.

    Each run is (way out from home, legs between stops, way home or None for
    the way out turned round, factor for the slower pace).
    """
    window = str(chains["window"])
    usual = float(settings.routing.get("speed_walking_kmh", 4.8))
    slow_mode = settings.modes.get("pt_slow", {})
    slow = float(slow_mode.get("speed_walking_kmh", 3.6))
    factor = usual / slow
    wanted = list(chains.get("modes", ["walk"]))
    walk = ("services_walk", "links_walk", "returns_walk")
    out = {"walk": {"runs": [(*walk, 1.0)]}}
    if slow_mode:
        out["walk_slow"] = {"runs": [(*walk, factor)]}
    if "pt" in wanted:
        out["pt"] = {"runs": [(*walk, 1.0), (f"services_{window}_pt", f"links_{window}_pt", None, 1.0)]}
        if slow_mode:
            out["pt_slow"] = {"runs": [(*walk, factor), (f"services_{window}_pt_slow", f"links_{window}_pt_slow", None, 1.0)]}
    if "bike_low_stress" in wanted:
        out["bike_low_stress"] = {"runs": [("services_bike_low_stress", "links_bike_low_stress", "returns_bike_low_stress", 1.0)]}
    return out


def _back_times(back_pairs: pd.Series, ids: np.ndarray, times: np.ndarray, n: int) -> np.ndarray:
    """Minutes home from each candidate stop, looked up by (stop, hexagon).

    An empty candidate slot, or a stop the way home does not reach within the
    routing limit, cannot end a round.
    """
    k = ids.shape[1]
    keys = pd.MultiIndex.from_arrays([ids.ravel(), np.repeat(np.arange(n), k)])
    values = back_pairs.reindex(keys).to_numpy(dtype="float64").reshape(n, k).astype("float32")
    values[~np.isfinite(values)] = INF
    values[~np.isfinite(times)] = INF
    return values


def build(settings: Settings, cells: pd.Index) -> pd.DataFrame:
    chains = spec(settings)
    if not chains:
        return pd.DataFrame(index=cells)
    stops = [str(s) for s in chains["stops"]]
    most = int(chains.get("max_stops", len(stops)))
    after = {str(k): str(v) for k, v in (chains.get("after") or {}).items()}
    k = int(chains.get("candidates", 5))
    limits = [float(v) for v in chains.get("leg_limits", [])] + [float("inf")]
    limit_names = [str(int(v)) for v in chains.get("leg_limits", [])] + ["any"]

    from .routing import chain_stops

    stop_table = chain_stops(settings)
    ids = sorted(stop_table["id"].astype(str).unique())
    index = {sid: i for i, sid in enumerate(ids)}
    columns: dict[str, np.ndarray] = {}
    for mode, how in _modes(settings, chains).items():
        # Each leg is the fastest of the runs this way of travelling can use.
        link = None
        home_pairs = []
        back_pairs = []
        for service_tag, link_tag, return_tag, factor in how["runs"]:
            matrix = _link_matrix(_links(settings, link_tag), index) * np.float32(factor)
            link = matrix if link is None else np.minimum(link, matrix)
            pairs = _pairs(settings, service_tag, stops)
            pairs["minutes"] = pairs["minutes"] * np.float32(factor)
            home_pairs.append(pairs)
            # The way home: routed where it was, else the way out turned round.
            if return_tag:
                home_legs = _links(settings, return_tag).rename(columns={"origin": "stop", "destination": "cell"})
            else:
                home_legs = pairs.rename(columns={"destination": "stop", "origin": "cell"})[["stop", "cell", "minutes"]]
            home_legs = home_legs.assign(minutes=home_legs["minutes"] * np.float32(factor if return_tag else 1.0))
            back_pairs.append(home_legs[["stop", "cell", "minutes"]])
        pairs = pd.concat(home_pairs, ignore_index=True)
        pairs = pairs.groupby(["origin", "destination", "service"], as_index=False)["minutes"].min()
        home = {stop: _nearest(pairs, cells, stop, index, k) for stop in stops}
        legs_home = pd.concat(back_pairs, ignore_index=True)
        legs_home["stop"] = legs_home["stop"].astype(str).map(index)
        legs_home["cell"] = cells.get_indexer(legs_home["cell"].astype(str))
        legs_home = legs_home[legs_home["stop"].notna() & (legs_home["cell"] >= 0)]
        legs_home = legs_home.groupby([legs_home["stop"].astype(int), "cell"])["minutes"].min()
        back = {stop: _back_times(legs_home, home[stop][1], home[stop][0], len(cells)) for stop in stops}
        for stop_set in stop_sets(stops, most):
            best = best_rounds({s: home[s] for s in stop_set}, link, orders(stop_set, after), limits,
                               back={s: back[s] for s in stop_set})
            for j, name in enumerate(limit_names):
                values = np.where(np.isfinite(best[:, j]), np.round(best[:, j]), np.nan).astype("float32")
                columns[f"round_{set_name(stop_set)}_{mode}_{name}"] = values
        log.info("rounds by %s: %d sets of stops", mode, len(stop_sets(stops, most)))
    return pd.DataFrame(columns, index=cells)


MODE_LABELS = {
    "walk": "Walking",
    "walk_slow": "Walking at a slower pace",
    "pt": "Walking and public transport",
    "pt_slow": "Walking and public transport at a slower pace",
    "bike_low_stress": "Low-stress cycling",
}


def payload(settings: Settings, table: pd.DataFrame, ints) -> tuple[dict, dict[str, dict]] | None:
    """The rounds for the web page: an index, and one payload per set of
    stops, which the page fetches only when that set is picked."""
    chains = spec(settings)
    if not chains:
        return None
    stops = [str(s) for s in chains["stops"]]
    most = int(chains.get("max_stops", len(stops)))
    limit_names = [str(int(v)) for v in chains.get("leg_limits", [])] + ["any"]
    modes = [m for m in MODE_LABELS if any(c.startswith("round_") and c.endswith(f"_{m}_any") for c in table.columns)]
    files = {}
    for stop_set in stop_sets(stops, most):
        name = set_name(stop_set)
        files[set_file(stop_set)] = {
            "set": name,
            "modes": {
                mode: {limit: ints(table[f"round_{name}_{mode}_{limit}"]) for limit in limit_names
                       if f"round_{name}_{mode}_{limit}" in table}
                for mode in modes
            },
        }
    index = {
        "stops": stops,
        "max_stops": most,
        "after": {str(k): str(v) for k, v in (chains.get("after") or {}).items()},
        "leg_limits": [int(v) for v in chains.get("leg_limits", [])],
        "standard_minutes": int(chains.get("standard_minutes", 30)),
        "window": str(chains["window"]),
        "candidates": int(chains.get("candidates", 5)),
        "modes": {m: MODE_LABELS[m] for m in modes},
        "sets": {files[f]["set"]: f for f in files},
    }
    return index, files

def meta(settings: Settings) -> dict | None:
    """What the page needs to offer errand rounds before it loads them."""
    chains = spec(settings)
    if not chains:
        return None
    wanted = list(chains.get("modes", ["walk"]))
    return {
        "stops": [str(s) for s in chains["stops"]],
        "max_stops": int(chains.get("max_stops", len(chains["stops"]))),
        "after": {str(k): str(v) for k, v in (chains.get("after") or {}).items()},
        "leg_limits": [int(v) for v in chains.get("leg_limits", [])],
        "standard_minutes": int(chains.get("standard_minutes", 30)),
        "window": str(chains["window"]),
        "modes": [m for m in ("walk", "pt", "bike_low_stress") if m == "walk" or m in wanted],
        "slower_pace_kmh": float(settings.modes.get("pt_slow", {}).get("speed_walking_kmh", 0)) or None,
        "usual_pace_kmh": float(settings.routing.get("speed_walking_kmh", 4.8)),
    }
