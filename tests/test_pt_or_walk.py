"""Public transport, or walking where that is quicker (src/team/pt_or_walk.py).

The rule on made-up pairs first, then on the built data when TEAM_BUILDS
(each place's build output, <root>/<place>), TEAM_CACHES (each place's route
cache, <root>/<place>) or TEAM_SITE (the site's data folder) are set.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from team import config, export, fares, measures, pt_or_walk, routing, schools
from team.config import Settings

REPO = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("TEAM_DATA_ROOT", REPO.parent))
BUILDS = Path(os.environ["TEAM_BUILDS"]) if os.environ.get("TEAM_BUILDS") else None
CACHES = Path(os.environ["TEAM_CACHES"]) if os.environ.get("TEAM_CACHES") else None
SITE = Path(os.environ["TEAM_SITE"]) if os.environ.get("TEAM_SITE") else None
PLACES = sorted(p.stem for p in (REPO / "configs").glob("*.yml"))
KEYS = ["origin", "destination", "service"]


def pairs(rows, spread=False):
    columns = [*KEYS, "minutes", *(["lo", "hi"] if spread else [])]
    frame = pd.DataFrame(rows, columns=columns)
    return frame.astype({c: "uint8" for c in columns[3:]})


def one(merged, origin, destination="d"):
    return merged[(merged["origin"] == origin) & (merged["destination"] == destination)].iloc[0]


def test_pt_or_walk_pairs():
    pt = pairs([
        ("a", "d", "s", 26, 23, 30),    # R5 26, usually 23-30; the walk is 15
        ("c", "d", "s", 9, 9, 9),       # the same either way
        ("e", "d", "s", 12, 10, 14),    # a bus, quicker than the 20-minute walk
        ("f", "d", "s", 30, 23, 255),   # R5's 90th percentile is past 60; the walk is 25
        ("g", "d", "s", 50, 45, 255),   # the walk is 40
    ], spread=True)
    walk = pairs([("a", "d", "s", 15), ("b", "d", "s", 22), ("c", "d", "s", 9), ("e", "d", "s", 20), ("f", "d", "s", 25),
                  ("g", "d", "s", 40)])
    merged = pt_or_walk.merge(pt, walk, KEYS, 60, spread=True)
    a = one(merged, "a")
    assert (a["minutes"], a["r5"], a["walk_quicker"], a["lo"], a["hi"]) == (15, 26, True, 15, 15)
    b = one(merged, "b")  # no public transport within 60 minutes: the walk at every minute
    assert (b["minutes"], math.isnan(b["r5"]), b["walk_quicker"], b["lo"], b["hi"]) == (22, True, True, 22, 22)
    c = one(merged, "c")  # equal: a walk, and R5 gave the same
    assert (c["minutes"], c["r5"], c["walk_quicker"]) == (9, 9, True)
    e = one(merged, "e")
    assert (e["minutes"], e["walk_quicker"], e["lo"], e["hi"]) == (12, False, 10, 14)
    f = one(merged, "f")  # min(R5 p10, walk), min(R5 p90, walk)
    assert (f["minutes"], f["lo"], f["hi"]) == (25, 23, 25)
    g = one(merged, "g")  # hi past 60 with a walk within 60 becomes the walk
    assert (g["minutes"], g["lo"], g["hi"]) == (40, 40, 40)


def test_the_slower_pace_walks_four_thirds_as_long():
    pt = pairs([("a", "d", "s", 30)])
    walk = pairs([("a", "d", "s", 15), ("b", "d", "s", 45), ("c", "d", "s", 46)])
    merged = pt_or_walk.merge(pt, walk, KEYS, 60, factor=4.8 / 3.6)
    assert one(merged, "a")["minutes"] == 20  # floor(15 x 4.8 / 3.6)
    assert one(merged, "b")["minutes"] == 60
    assert "c" not in set(merged["origin"])  # 61 minutes at the slower pace: past the limit
    assert pt_or_walk.walk_minutes(np.array([3.0]), 4.8 / 3.6)[0] == 4


def r5_percentile(minutes, p):
    """R5's percentile: the value at position ceil(p x n / 100) of the sorted
    departure-minute times, unreachable minutes counted as infinite."""
    ordered = sorted(minutes)
    return ordered[max(1, math.ceil(p * len(ordered) / 100)) - 1]


def test_percentiles_commute_with_the_walk():
    rng = np.random.default_rng(1)
    for _ in range(500):
        n = int(rng.integers(1, 121))
        times = [float("inf") if rng.random() < 0.1 else float(rng.integers(5, 70)) for _ in range(n)]
        walk = float(rng.integers(5, 61))
        for p in (10, 50, 90):
            assert r5_percentile([min(t, walk) for t in times], p) == min(r5_percentile(times, p), walk)


def test_nearest_names_walking_only_where_it_is_strictly_quicker():
    r5 = pd.Series([26.0, np.nan, 9.0, 12.0])
    walk = pd.Series([15.0, 22.0, 9.0, 20.0])
    minutes, named = pt_or_walk.merge_nearest(r5, pd.Series(["bus", None, "bus", "bus"]), walk,
                                              pd.Series(["foot", "foot", "foot", "foot"]), 60)
    assert minutes.tolist() == [15, 22, 9, 12]
    assert named.tolist() == ["foot", "foot", "bus", "bus"]


def test_options_count_a_bus_only_when_it_is_quicker(tmp_path):
    raw = {"routing": {"modes": {"walk": {"kind": "walk"}, "bike_low_stress": {"kind": "cycle"}, "pt": {"kind": "transit"}}},
           "standard_modes": ["walk", "bike_low_stress", "pt"], "services": {"gp": {"standard_minutes": 20}}}
    settings = Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)
    table = pd.DataFrame({"t_gp_walk": [15.0, 15.0, np.nan, 25.0], "t_gp_bike_low_stress": [np.nan] * 4,
                          "t_gp_pt": [15.0, 12.0, 18.0, 19.0]}, index=list("abcd"))
    out = measures.add_standards(table, settings)
    # A walk counts once, not twice; a bus counts where it is quicker or the only way.
    assert out["options_gp"].tolist() == [1, 2, 1, 1]
    # Ties go to walking, as before.
    assert out["via_gp"].tolist() == ["walk", "pt", "pt", "pt"]


def test_a_walk_has_no_fare():
    merged = pt_or_walk.merge(
        pairs([("a", "x", "s", 18), ("a", "y", "s", 10), ("b", "y", "s", 30)]),
        pairs([("a", "x", "s", 12), ("a", "y", "s", 25), ("b", "z", "s", 35)]), KEYS, 60)
    index = pd.Index(["a", "b"])
    zones = fares.pair_zone_counts(merged, pd.Series({"a": "A", "b": "B"}), pd.Series({"x": "A", "y": "B", "z": "B"}),
                                   {("A", "A"): 1, ("A", "B"): 2, ("B", "B"): 1})
    by_pair = dict(zip(zip(merged["origin"], merged["destination"]), zones))
    assert by_pair[("a", "x")] == 0      # the walk (12) is quicker than the bus (18): no fare
    assert by_pair[("a", "y")] == 2      # a bus, two zones
    assert by_pair[("b", "z")] == 0      # reached on foot only
    soonest = fares.nearest_within(merged, zones, 45, index, cap=2)
    # z0 is walking alone: a's nearest on foot is 12 minutes; b's is 35.
    assert soonest.loc["a", "z0"] == 12 and soonest.loc["b", "z0"] == 35
    # One zone does not pay for the bus to y, but a can still walk there in 25.
    reached = fares.reachable_within(merged, pd.Series({"x": 1.0, "y": 1.0, "z": 1.0}), zones, 45, index, cap=2)
    assert reached.loc["a"].tolist() == [2.0, 2.0, 2.0]
    assert soonest.loc["a"].tolist() == [12.0, 12.0, 10.0]
    # The columns only rise with the budget.
    assert (reached.diff(axis=1).fillna(0) >= 0).all().all()


def test_reach_lists_say_where_r5_is_slower():
    reach = pd.DataFrame({"cell": [0, 0, 1], "destination": ["moe:1", "moe:2", "moe:1"], "minutes": [15, 20, 9],
                          "r5": [26.0, 20.0, np.nan], "lo": [15, 18, 9], "hi": [15, 22, 9]})
    body = export.reach_payload(reach, 2, {"moe:1": 0, "moe:2": 1}, spread=True)
    assert body["o"] == [0, 2, 3] and body["m"] == [15, 20, 9]
    assert body["r5"] == {"k": [0, 2], "m": [26, None]}


# ---------------------------------------------------------------------------
# On the built data


def place_settings(place: str) -> Settings:
    cache = CACHES / place if CACHES else None
    return config.load(REPO / "configs" / f"{place}.yml", DATA_ROOT, BUILDS / place, cache)


needs_builds = pytest.mark.skipif(BUILDS is None or CACHES is None, reason="set TEAM_BUILDS and TEAM_CACHES to built places and their caches")


@needs_builds
@pytest.mark.parametrize("place", PLACES)
def test_cached_pairs_reproduce_the_runs(place):
    """Before the rule: every run's own summary must come out of its cached pairs."""
    settings = place_settings(place)
    school_ids = set(schools.school_service_ids(settings))
    for dataset, mode_id, window in routing.plan(settings):
        if dataset not in ("services", "jobs", "schools"):
            continue
        tag = routing.run_tag(dataset, mode_id, window, window is not None)
        path = settings.output_dir / "routing" / f"{tag}.parquet"
        run = pd.read_parquet(path)
        cached = schools.load_reach(settings, tag) if dataset == "schools" else measures.load_pairs(settings, tag)
        assert cached is not None, tag
        if dataset == "jobs":
            jobs = pd.read_parquet(settings.output_dir / "destinations" / "jobs.parquet").set_index("id")["jobs"]
            size = cached["destination"].map(jobs).fillna(0.0)
            for limit in settings.jobs["thresholds"]:
                within = cached["minutes"] <= limit
                measures.check_jobs(run.set_index("origin")[f"jobs_{limit}"], size[within].groupby(cached.loc[within, "origin"]).sum(), tag, limit)
            continue
        if dataset == "services":
            run = run[~run["service"].isin(school_ids)]
            cached = cached[~cached["service"].isin(school_ids)]
        measures.check_counts(run, measures._service_counts(cached), tag)
        nearest = cached.groupby(["origin", "service"])["minutes"].min()
        shown = run[run["minutes"] <= 60].set_index(["origin", "service"])["minutes"]
        assert (nearest.reindex(shown.index).to_numpy() == shown.to_numpy()).all(), tag


@needs_builds
@pytest.mark.parametrize("place", PLACES)
def test_jobs_by_pair(place):
    settings = place_settings(place)
    table = pd.read_parquet(settings.output_dir / "team_cells.parquet")
    jobs = pd.read_parquet(settings.output_dir / "destinations" / "jobs.parquet").set_index("id")["jobs"]
    windows = routing.job_windows(settings)
    for window in windows:
        key = "pt" if window == windows[0] else f"pt_{window}"
        merged = pt_or_walk.load_merged(settings, "jobs", "pt", window)
        size = merged["destination"].map(jobs).fillna(0.0)
        for limit in settings.jobs["thresholds"]:
            after = table[f"jobs{limit}_{key}"].astype("float64")
            r5 = table[f"jobs{limit}_{key}_r5"].astype("float64")
            walk = table[f"jobs{limit}_walk"].astype("float64")
            slack = 0.01 + 1e-5 * np.abs(after)
            assert (np.fmax(r5, walk) <= after + slack).all()
            assert (after <= r5 + walk + slack).all()
            within = merged["minutes"] <= limit
            summed = size[within].groupby(merged.loc[within, "origin"]).sum().reindex(table.index).fillna(0.0)
            assert (np.abs(summed - after) <= slack).all()


def load_site(place: str):
    folder = SITE / place
    return (json.loads((folder / "cells.json").read_text()), json.loads((folder / "destinations.json").read_text()),
            json.loads((folder / "summary.json").read_text())["meta"])


def reach(place: str, service: str, mode: str = "pt"):
    return json.loads((SITE / place / "schools" / f"{service}_{mode}.json").read_text())


def entry(place: str, service: str, h3: str, moe: int, mode: str = "pt"):
    cells, dests, _ = load_site(place)
    body = reach(place, service, mode)
    i = cells["h3"].index(h3)
    r5 = dict(zip(body["r5"]["k"], body["r5"]["m"]))
    for k in range(body["o"][i], body["o"][i + 1]):
        if dests[body["d"][k]].get("moe") == moe:
            return {"m": body["m"][k], "r5": r5.get(k, body["m"][k]), "lo": body.get("lo", [None] * (k + 1))[k],
                    "hi": body.get("hi", [None] * (k + 1))[k]}
    return None


needs_site = pytest.mark.skipif(SITE is None, reason="set TEAM_SITE to a built site's data folder")


@needs_site
def test_mags_from_the_hexagon_south_east_of_it_is_a_walk():
    got = entry("auckland", "secondary_school", "89bb50021b7ffff", 69)
    # 15 on foot; R5 gives 26 by public transport; on foot at every departure minute, so no spread.
    assert (got["m"], got["r5"], got["lo"], got["hi"]) == (15, 26, 15, 15)


@needs_site
def test_blenheim_state_secondary_by_public_transport_is_the_walk():
    cells, dests, _ = load_site("blenheim")
    i = cells["h3"].index("89bb29ba32fffff")
    girls = schools.published_counts(dests, "secondary_school", "state", "girls")
    minutes, named = schools.published_times(reach("blenheim", "secondary_school"), girls)
    assert minutes[i] == 22 and dests[named[i]]["name"] == "Marlborough Girls' College"
    both = schools.choice_times({"pt": reach("blenheim", "secondary_school")}, dests, "secondary_school", "state", "both", ["pt"])
    assert both["pt"][i] == 22  # was none by public transport: now within 30
    middle = schools.choice_times({"pt": reach("blenheim", "intermediate_school")}, dests, "intermediate_school", "state", "both", ["pt"])
    assert middle["pt"][i] == 26
    assert entry("blenheim", "secondary_school", "89bb29ba32fffff", 289)["r5"] is None  # Marlborough Girls' College


@needs_site
def test_the_slide_hexagon_is_unchanged_and_wellington_keeps_its_bus():
    cells, _, _ = load_site("auckland")
    i = cells["h3"].index("89bb50021a3ffff")
    assert cells["t"]["secondary_school"]["pt"][i] == 9
    assert str(i) not in cells["ptr"]["secondary_school"]  # R5 gave 9 too
    cells, _, _ = load_site("wellington")
    i = cells["h3"].index("89bb2955a3bffff")
    assert cells["t"]["secondary_school"]["pt"][i] == 15 and cells["t"]["secondary_school"]["walk"][i] == 20
    assert str(i) not in cells["ptr"]["secondary_school"]


@needs_site
def test_auckland_secondary_share_by_public_transport():
    cells, _, meta = load_site("auckland")
    pop = np.array([p or 0.0 for p in cells["pop"]])
    t = np.array([np.nan if v is None else v for v in cells["t"]["secondary_school"]["pt"]], dtype="float64")
    share = pop[t <= 30].sum() / pop.sum()
    # 79.82% as R5 routes it; 84.49% taking walking where it is quicker, as the
    # round-2 spec's preview from round 1's cells (schools over the regional
    # boundary change it by less than 0.01 points).
    assert share == pytest.approx(0.8449, abs=0.0001)
    assert meta["formats"]["school_reach"] == 2 and meta["pt_or_walk"]["r5_columns"] == "_r5"


@needs_site
@pytest.mark.parametrize("place", PLACES)
def test_public_transport_is_never_slower_than_walking(place):
    cells, _, meta = load_site(place)
    for service, times in cells["t"].items():
        if "pt" not in times or "walk" not in times:
            continue
        pt = np.array([np.nan if v is None else v for v in times["pt"]], dtype="float64")
        walk = np.array([np.nan if v is None else v for v in times["walk"]], dtype="float64")
        assert not (pt > walk).any(), service
        assert not (np.isnan(pt) & ~np.isnan(walk)).any(), service
    for path in (SITE / place / "schools").glob("*_pt*.json"):
        body = json.loads(path.read_text())
        assert body["format"] == meta["formats"]["school_reach"] and body["pt_or_walk"] is True
        assert all(m is None or m > body["m"][k] for k, m in zip(body["r5"]["k"], body["r5"]["m"]))


def test_downloads_say_which_columns_are_r5s_own():
    assert export._note("t_secondary_school_pt_r5") == export.FIELD_NOTES["_r5"]
    assert export._note("jobs45_pt_saturday_r5") == export.FIELD_NOTES["_r5"]
    assert "walking where that is quicker" in export._note("t_secondary_school_pt")
    assert export.FORMATS["school_reach"] == 2 and "ptr" in export.CORE_CELL_KEYS


def test_ptr_holds_only_cells_where_walking_is_quicker(tmp_path):
    settings = Settings(raw={"services": {"gp": {}}}, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path,
                        cache_dir=tmp_path)
    table = pd.DataFrame({"t_gp_pt_r5": [26.0, np.nan, 9.0, 12.0, np.nan], "t_gp_walk": [15.0, 22.0, 9.0, 20.0, np.nan]})
    assert export.ptr_payload(settings, table) == {"gp": {"0": 26, "1": None}}
