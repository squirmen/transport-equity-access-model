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
    out = summarise_services(matrix, services).set_index(["origin", "service"])
    assert out.loc[("A", "gp"), "minutes"] == 12
    assert out.loc[("A", "gp"), "nearest_id"] == "0"
    assert out.loc[("A", "gp"), ["n10", "n15", "n20", "n30"]].tolist() == [0, 1, 1, 2]
    assert out.loc[("A", "pharmacy"), "n10"] == 1
    assert "B" not in out.index.get_level_values("origin")


def test_summarise_jobs_thresholds():
    matrix = pd.DataFrame({"from_id": ["A", "A"], "to_id": ["x", "y"], "travel_time": [20, 40]})
    jobs = pd.DataFrame({"id": ["x", "y"], "jobs": [100.0, 50.0]})
    out, pairs = summarise_jobs(matrix, jobs, [30, 45])
    assert out.loc[0, "jobs_30"] == 100
    assert out.loc[0, "jobs_45"] == 150
    assert len(pairs) == 2
