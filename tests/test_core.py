"""Known-answer tests for the standards, diagnosis, competition and equity maths."""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from team.config import Settings
from team.diagnosis import diagnose
from team.equity import nzdep_quintile, palma_ratio, weighted_quantile, weighted_share
from team.measures import add_standards, competition_adjusted, count_column
from team.routing import summarise_jobs, summarise_services

MODES = {
    "walk": {"kind": "walk"},
    "bike_low_stress": {"kind": "cycle", "max_traffic_stress": 2},
    "bike": {"kind": "cycle", "max_traffic_stress": 3},
    "pt": {"kind": "transit"},
    "car": {"kind": "car"},
}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    raw = {
        "routing": {"modes": MODES, "speed_walking_kmh": 4.8},
        "standard_modes": ["walk", "bike_low_stress", "pt"],
        "services": {"gp": {"label": "GP", "window": "interpeak", "standard_minutes": 20}},
        "jobs": {"thresholds": [30, 45], "modes": ["pt"], "window": "am_peak"},
    }
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)


def times(rows: dict[str, list[float]]) -> pd.DataFrame:
    return pd.DataFrame({f"t_gp_{mode}": values for mode, values in rows.items()}, index=list("ABCD")[: len(next(iter(rows.values())))])


def test_standards_best_mode_and_options(settings):
    nan = np.nan
    table = times(
        {
            "walk": [12, 35, nan, 20],
            "bike_low_stress": [8, nan, nan, 25],
            "bike": [6, 18, nan, 10],
            "pt": [15, 25, nan, nan],
            "car": [4, 6, nan, 5],
        }
    )
    out = add_standards(table, settings)
    assert out["best_gp"].tolist()[:2] == [8, 25]
    assert np.isnan(out.loc["C", "best_gp"])
    assert out["via_gp"].tolist() == ["bike_low_stress", "pt", "", "walk"]
    # 20 minutes exactly meets a 20-minute standard.
    assert out["meets_gp"].tolist() == [True, False, False, True]
    assert out["options_gp"].tolist() == [3, 0, 0, 1]
    # Car and any-street cycling never count towards the standard.
    assert out.loc["B", "meets_gp"] == False  # noqa: E712


def test_count_column_matches_standard():
    assert count_column(20) == "n20"
    assert count_column(15) == "n15"
    assert count_column(25) == "n20"
    assert count_column(45) == "n30"


def test_diagnosis_rules_in_order(settings):
    nan = np.nan
    table = pd.DataFrame(
        {
            "km_gp": [0.5, 1.0, 3.0, 3.0, 3.0, 8.0, 2.0],
            "t_gp_walk": [10, 32, 45, 45, 45, nan, nan],
            "t_gp_bike_low_stress": [8, 25, 30, 30, 30, 40, nan],
            "t_gp_bike": [6, 24, 14, 25, 25, 35, nan],
            "t_gp_pt": [12, 28, 35, 33, 33, 45, nan],
            "t_gp_car": [3, 5, 8, 8, 8, 12, nan],
            "pt_per_hour_interpeak": [6, 6, 6, 2, 8, 10, 0],
        },
        index=["meets", "walk_link", "safe_bike", "pt_frequency", "pt_trip", "distance", "no_data"],
    )
    table = add_standards(table, settings)
    table = diagnose(table, settings)
    assert table["why_gp"].tolist() == [0, 1, 2, 3, 4, 5, 9]


def test_competition_adjusted_known_answer():
    pairs = pd.DataFrame(
        {"origin": ["o1", "o1", "o2"], "destination": ["d1", "d2", "d2"], "minutes": [10, 25, 20]}
    )
    jobs = pd.Series({"d1": 100.0, "d2": 300.0})
    demand = pd.Series({"o1": 100.0, "o2": 300.0})
    fair = competition_adjusted(pairs, jobs, demand, limit=30)
    # d1 is shared by 100 residents, d2 by 400: ratios 1.0 and 0.75.
    assert fair["o1"] == pytest.approx(1.75)
    assert fair["o2"] == pytest.approx(0.75)
    # The population-weighted mean is the regional average.
    assert np.average(fair[["o1", "o2"]], weights=demand[["o1", "o2"]]) == pytest.approx(1.0)


def test_equity_helpers():
    assert weighted_share(pd.Series([True, False, True]), pd.Series([1.0, 2.0, 1.0])) == pytest.approx(0.5)
    values = pd.Series(np.arange(1, 11, dtype=float))
    assert palma_ratio(values, pd.Series(np.ones(10))) == pytest.approx(4.0)
    assert weighted_quantile(pd.Series([1.0, 2, 3, 4]), pd.Series([1.0, 1, 1, 1]), 0.5) == 2.0
    assert nzdep_quintile(pd.Series([1, 2, 3, 10])).tolist() == [1, 1, 2, 5]


def test_summarise_services_nearest_and_counts():
    matrix = pd.DataFrame(
        {
            "from_id": ["A", "A", "A", "B", "B", "B"],
            "to_id": ["0", "1", "2", "0", "1", "2"],
            "travel_time": [12, 25, 5, np.nan, np.nan, np.nan],
        }
    )
    services = pd.DataFrame({"id": ["0", "1", "2"], "service": ["gp", "gp", "pharmacy"]})
    out, pairs = summarise_services(matrix, services)
    out = out.set_index(["origin", "service"])
    assert out.loc[("A", "gp"), "minutes"] == 12
    assert out.loc[("A", "gp"), "nearest_id"] == "0"
    assert out.loc[("A", "gp"), ["n10", "n15", "n20", "n30"]].tolist() == [0, 1, 1, 2]
    assert out.loc[("A", "pharmacy"), "n10"] == 1
    assert "B" not in out.index.get_level_values("origin")


def test_summarise_services_keeps_pairs_for_the_gravity_scores():
    matrix = pd.DataFrame(
        {
            "from_id": ["a", "a", "a"],
            "to_id": ["0", "1", "2"],
            "travel_time": [5.0, 25.0, np.nan],
        }
    )
    services = pd.DataFrame({"id": ["0", "1", "2"], "service": ["gp", "gp", "pharmacy"]})
    _, pairs = summarise_services(matrix, services, pair_minutes=20)
    assert list(pairs.columns) == ["origin", "destination", "service", "minutes"]
    # the 25-minute pair is past the cap, the unreachable one is not a pair
    assert len(pairs) == 1
    assert pairs.iloc[0]["destination"] == "0"


def test_summarise_jobs_thresholds():
    matrix = pd.DataFrame({"from_id": ["A", "A"], "to_id": ["x", "y"], "travel_time": [20, 40]})
    jobs = pd.DataFrame({"id": ["x", "y"], "jobs": [100.0, 50.0]})
    out, pairs = summarise_jobs(matrix, jobs, [30, 45])
    assert out.loc[0, "jobs_30"] == 100
    assert out.loc[0, "jobs_45"] == 150
    assert len(pairs) == 2


def test_impedance_functions_known_values():
    import numpy as np

    from team import gravity

    minutes = np.array([0.0, 10.0, 20.0])
    exponential = gravity.impedance(minutes, {"function": "negative_exponential", "beta": 0.1})
    assert exponential[0] == pytest.approx(1.0)
    assert exponential[1] == pytest.approx(np.exp(-1.0))
    gauss = gravity.impedance(minutes, {"function": "gaussian", "beta": 0.01})
    assert gauss[2] == pytest.approx(np.exp(-4.0))
    logistic = gravity.impedance(minutes, {"function": "log_logistic", "beta": 2.0, "median": 10.0})
    assert logistic[1] == pytest.approx(0.5)
    with pytest.raises(ValueError):
        gravity.impedance(minutes, {"function": "sigmoid", "beta": 1.0})


def test_score_counts_every_opportunity_with_decay():
    import pandas as pd

    from team import gravity

    pairs = pd.DataFrame(
        {
            "origin": ["a", "a", "b"],
            "destination": ["j1", "j2", "j1"],
            "minutes": [0, 10, 10],
        }
    )
    weights = pd.Series({"j1": 100.0, "j2": 50.0})
    scores = gravity.score(pairs, weights, {"function": "negative_exponential", "beta": 0.1})
    # a: 100 at no cost plus 50 discounted; b: only the first, discounted
    assert scores["a"] == pytest.approx(100.0 + 50.0 * np.exp(-1.0))
    assert scores["b"] == pytest.approx(100.0 * np.exp(-1.0))


def test_index_and_deciles_are_population_weighted():
    import numpy as np
    import pandas as pd

    from team import gravity

    values = pd.Series({"a": 50.0, "b": 100.0, "c": 150.0})
    population = pd.Series({"a": 100.0, "b": 100.0, "c": 100.0})
    index = gravity.index_to_mean(values, population)
    assert index["b"] == pytest.approx(100.0)
    assert index["c"] == pytest.approx(150.0)

    # One cell holds nine tenths of the people, so it spans nine deciles and
    # the cut points follow residents rather than hexagons.
    values = pd.Series({"low": 1.0, "big": 2.0, "high": 3.0})
    population = pd.Series({"low": 50.0, "big": 900.0, "high": 50.0})
    bands = gravity.deciles(values, population)
    assert bands["low"] == 1
    assert bands["big"] == 10
    assert bands["high"] == 10


def test_pct_cycling_decay_never_penalises_a_close_destination():
    import numpy as np

    from team import gravity

    spec = {
        "function": "pct",
        "b0": -1.468,
        "b1": -0.71726,
        "b2": 1.988,
        "b3": 0.008775,
        "speed_kmh": 15,
    }
    minutes = np.array([0.0, 5.0, 10.0, 20.0, 30.0, 45.0])
    weights = gravity.impedance(minutes, spec)
    # the raw PCT curve peaks around two kilometres; held flat below the peak,
    # a destination at the door is worth as much as one a short ride away
    assert weights[0] == pytest.approx(1.0)
    assert weights[1] == pytest.approx(1.0, abs=1e-6)
    # and falls away with distance after that
    assert all(weights[i] > weights[i + 1] for i in range(2, len(weights) - 1))
    assert weights[-1] < 0.4


# --------------------------------------------------------------------- fares

FARE_TABLE = {
    "fares": {
        "adult": {"hop": {"1": 3.0, "2": 4.9, "3": 6.5, "4": 7.9}, "cash": {"1": 4.0, "2": 6.0, "3": 8.0, "4": 10.0}},
        "community_connect": {"hop": {"1": 1.5, "2": 2.45, "3": 3.25, "4": 3.95}},
    },
    "free": {"supergold": {"free_from": "09:00"}},
}

ADJACENCY = {
    "City": ["Isthmus", "Lower North Shore"],
    "Isthmus": ["City", "Waitakere", "Northern Manukau"],
    "Waitakere": ["Isthmus"],
    "Lower North Shore": ["City"],
    "Northern Manukau": ["Isthmus", "Southern Manukau"],
    "Southern Manukau": ["Northern Manukau"],
}


def test_zone_distance_counts_zones_not_boundaries():
    from team import fares

    d = fares.zone_distance(ADJACENCY)
    # AT's own example: Henderson to Britomart passes through three zones.
    assert d[("Waitakere", "City")] == 3
    # And a trip that stays put is a one-zone fare.
    assert d[("Isthmus", "Isthmus")] == 1
    # The Harbour Bridge lands in the City zone, so the shore is not next to the isthmus.
    assert d[("Lower North Shore", "Isthmus")] == 3


def test_zone_distance_applies_the_cap():
    from team import fares

    d = fares.zone_distance(ADJACENCY)
    assert d[("Southern Manukau", "City")] == 4
    assert d[("Southern Manukau", "Lower North Shore")] == 4


def test_fare_caps_at_four_zones():
    from team import fares

    assert fares.fare(FARE_TABLE, 1) == 3.0
    assert fares.fare(FARE_TABLE, 4) == 7.9
    assert fares.fare(FARE_TABLE, 9) == 7.9
    assert fares.fare(FARE_TABLE, 2, payment="cash") == 6.0


def test_fare_falls_back_to_the_adult_cash_price():
    from team import fares

    # Community Connect exists only on an AT HOP card.
    assert fares.fare(FARE_TABLE, 1, "community_connect") == 1.5
    assert fares.fare(FARE_TABLE, 1, "community_connect", "cash") == 1.5


def test_affordable_zones_counts_a_return_trip_as_two_fares():
    from team import fares

    # A single one-zone fare is $3, so $5 buys a one-way trip and no return.
    assert fares.affordable_zones(FARE_TABLE, 5.0, return_trip=False) == 2
    assert fares.affordable_zones(FARE_TABLE, 5.0) == 0
    assert fares.affordable_zones(FARE_TABLE, 6.0) == 1
    assert fares.affordable_zones(FARE_TABLE, 20.0) == 4


def test_supergold_travels_free_only_after_nine():
    from team import fares

    assert fares.affordable_zones(FARE_TABLE, 0.0, "supergold", hour=8) == 0
    assert fares.affordable_zones(FARE_TABLE, 0.0, "supergold", hour=10) == 4
    assert fares.affordable_zones(FARE_TABLE, 0.0, "supergold", hour=8, weekday=False) == 4


def test_reachable_within_rises_with_the_budget():
    import numpy as np
    import pandas as pd

    from team import fares

    pairs = pd.DataFrame(
        {
            "origin": ["a", "a", "a", "b"],
            "destination": ["d1", "d2", "d3", "d1"],
            "minutes": [10, 20, 30, 90],
        }
    )
    weights = pd.Series({"d1": 1.0, "d2": 1.0, "d3": 1.0})
    counts = np.array([1.0, 2.0, 4.0, 1.0])
    index = pd.Index(["a", "b"], name="h3")
    got = fares.reachable_within(pairs, weights, counts, 45, index)
    assert list(got.loc["a"]) == [1.0, 2.0, 2.0, 3.0]
    # b's only pair is beyond the time cap, so no budget reaches it.
    assert list(got.loc["b"]) == [0.0, 0.0, 0.0, 0.0]


def test_budget_steps_price_a_return_trip():
    from team import fares

    steps = fares.budget_steps(FARE_TABLE)
    assert [s["zones"] for s in steps] == [1, 2, 3, 4]
    assert steps[0]["cost"] == 6.0
    assert fares.budget_steps(FARE_TABLE, return_trip=False)[0]["cost"] == 3.0


# ------------------------------------------------------- decay curve horizons

def test_cutoff_follows_the_published_rule():
    """The NZ method counts nothing past the point where 95% of trips are done."""
    import math

    from team.gravity import cutoff_minutes

    # ln(20) / beta, so walking to a supermarket at 0.100 stops at 30 minutes.
    assert round(cutoff_minutes({"cutoff": "rr512", "beta": 0.100}, 60), 1) == 30.0
    assert round(cutoff_minutes({"cutoff": "rr512", "beta": 0.065}, 60), 1) == 46.1
    assert math.isclose(cutoff_minutes({"cutoff": "rr512", "beta": 0.092}, 60), math.log(20) / 0.092, rel_tol=1e-9)


def test_cutoff_never_exceeds_what_was_routed():
    from team.gravity import cutoff_minutes

    # Bus horizons run past 80 minutes, but only 60 minutes were routed.
    assert cutoff_minutes({"cutoff": "rr512", "beta": 0.036}, 60) == 60.0
    assert cutoff_minutes({"cutoff": 90}, 45) == 45.0


def test_cutoff_defaults_to_the_run_limit():
    from team.gravity import cutoff_minutes

    assert cutoff_minutes({}, 45) == 45.0
    assert cutoff_minutes({"function": "pct"}, 45) == 45.0


def test_unknown_cutoff_rule_is_refused():
    import pytest

    from team.gravity import cutoff_minutes

    with pytest.raises(ValueError):
        cutoff_minutes({"cutoff": "whatever"}, 45)
