"""Public transport timed in more than one window: peak, off-peak and Saturday."""

from pathlib import Path

import numpy as np
import pandas as pd

from team import gravity, measures, routing
from team.config import Settings

MODES = {
    "walk": {"kind": "walk"},
    "pt": {"kind": "transit"},
}
WINDOWS = {
    "am_peak": {"start": "07:00", "minutes": 120},
    "interpeak": {"start": "10:00", "minutes": 120},
    "saturday": {"start": "10:00", "minutes": 120, "date": "2026-09-19"},
}


def make_settings(tmp_path: Path) -> Settings:
    raw = {
        "routing": {"date": "2026-09-15", "windows": WINDOWS, "modes": MODES},
        "standard_modes": ["walk", "pt"],
        "services": {
            "gp": {"label": "GP", "window": "interpeak", "windows": ["am_peak", "saturday"], "standard_minutes": 20},
            "primary_school": {"label": "School", "window": "am_peak", "standard_minutes": 15},
        },
        "jobs": {"window": "am_peak", "windows": ["interpeak", "saturday"], "thresholds": [30, 45], "modes": ["walk", "pt"]},
    }
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path / "cache")


def test_the_usual_window_comes_first_and_only_once():
    assert routing.service_windows({"window": "interpeak", "windows": ["am_peak", "interpeak", "saturday"]}) == [
        "interpeak", "am_peak", "saturday"]
    assert routing.service_windows({"window": "am_peak"}) == ["am_peak"]


def test_the_plan_routes_each_window_something_asks_for(tmp_path: Path):
    tags = [routing.run_tag(d, m, w, w is not None) for d, m, w in routing.plan(make_settings(tmp_path))]
    assert "services_am_peak_pt" in tags and "services_interpeak_pt" in tags and "services_saturday_pt" in tags
    assert [t for t in tags if t.startswith("jobs_") and t.endswith("_pt")] == [
        "jobs_am_peak_pt", "jobs_interpeak_pt", "jobs_saturday_pt"]
    # Walking does not depend on the clock, so it is routed once.
    assert tags.count("services_walk") == 1


def test_a_service_carries_one_public_transport_time_per_window(tmp_path: Path):
    settings = make_settings(tmp_path)
    folder = tmp_path / "routing"
    folder.mkdir()
    row = lambda origin, service, minutes: {  # noqa: E731
        "origin": origin, "service": service, "minutes": minutes, "nearest_id": "d1",
        "n10": 0, "n15": 1, "n20": 1, "n30": 1,
    }
    pd.DataFrame([row("a", "gp", 12.0), row("a", "primary_school", 9.0)]).to_parquet(folder / "services_am_peak_pt.parquet")
    pd.DataFrame([row("a", "gp", 15.0)]).to_parquet(folder / "services_interpeak_pt.parquet")
    pd.DataFrame([row("a", "gp", 31.0)]).to_parquet(folder / "services_saturday_pt.parquet")
    pd.DataFrame([row("a", "gp", 25.0), row("a", "primary_school", 11.0)]).to_parquet(folder / "services_walk.parquet")
    table = measures.service_table(settings, pd.Index(["a"]))
    # The plain name is the usual window, so everything reading one time goes on working.
    assert table.loc["a", "t_gp_pt"] == 15.0
    assert table.loc["a", "t_gp_pt_am_peak"] == 12.0
    assert table.loc["a", "t_gp_pt_saturday"] == 31.0
    assert table.loc["a", "t_primary_school_pt"] == 9.0
    assert "t_primary_school_pt_saturday" not in table
    assert table.loc["a", "t_gp_walk"] == 25.0


def test_a_thinner_window_scores_below_the_usual_mean(tmp_path: Path, monkeypatch):
    """Every window is indexed against the usual one, so Saturday is not
    rescaled back up to 100."""
    settings = make_settings(tmp_path)
    settings.raw["gravity"] = {
        "modes": ["pt"],
        "max_minutes": 60,
        "purposes": {"gp": {"group": "everyday", "pt": {"function": "negative_exponential", "beta": 0.05}}},
    }
    index = pd.Index(["a", "b"])
    population = pd.Series([100.0, 100.0], index=index)
    usual = pd.DataFrame({"origin": ["a", "b"], "destination": ["d1", "d1"], "minutes": [10, 20]})
    slower = usual.assign(minutes=usual["minutes"] + 15)

    def fake_pairs(settings, purpose, mode_id, cap, window=None):
        return slower if window == "saturday" else usual

    monkeypatch.setattr(gravity, "_pairs", fake_pairs)
    monkeypatch.setattr(gravity, "_weights", lambda settings: {"gp": pd.Series({"d1": 1.0})})
    table, _ = gravity.build(settings, index, population)
    usual_mean = np.average(table["accessidx_gp_pt"], weights=population)
    saturday_mean = np.average(table["accessidx_gp_pt_saturday"], weights=population)
    assert abs(usual_mean - 100.0) < 1e-3
    assert saturday_mean < 60.0
    assert "accessidx_everyday_pt_saturday" in table


def test_equivalised_income_divides_by_the_root_of_household_size():
    from team import affordability

    income = affordability.equivalised(pd.Series([100_000.0, 100_000.0, -99.0]), pd.Series([1.0, 4.0, 2.0]), uplift=1.0)
    assert income.iloc[0] == 100_000.0
    assert income.iloc[1] == 50_000.0
    assert np.isnan(income.iloc[2])
    # A $7.30 return against $36,500 a year is 7.3% of a day's income.
    assert abs(float(affordability.burden(7.30, 36_500.0)) - 0.073) < 1e-9
    assert abs(affordability.INCOME_UPLIFT - 44.62 / 38.93) < 1e-12


def test_competition_counts_everyone_who_could_get_to_the_job():
    from team.measures import competition_adjusted

    jobs = pd.Series({"d": 100.0})
    demand = pd.Series({"a": 10.0, "b": 90.0})
    bus = pd.DataFrame({"origin": ["a"], "destination": ["d"], "minutes": [20]})
    car = pd.DataFrame({"origin": ["a", "b"], "destination": ["d", "d"], "minutes": [10, 15]})
    bus = pd.concat([bus, pd.DataFrame({"origin": ["c"], "destination": ["e"], "minutes": [20]})], ignore_index=True)
    jobs = pd.Series({"d": 100.0, "e": 100.0})
    demand = pd.Series({"a": 10.0, "b": 90.0, "c": 100.0})
    car = pd.concat([car, pd.DataFrame({"origin": ["c"], "destination": ["e"], "minutes": [5]})], ignore_index=True)
    alone = competition_adjusted(bus, jobs, demand, 30)
    shared = competition_adjusted(bus, jobs, demand, 30, car)
    # By bus alone, a has job cell d to itself: 10 jobs a head against c's 1,
    # so a looks far better off. Counting b, who can drive to d, a and c each
    # share 1 job a head, and are equal.
    assert alone["a"] > 5 * alone["c"]
    assert abs(shared["a"] - shared["c"]) < 1e-9


def test_urban_means_an_urban_area_of_a_thousand_people():
    from team.people import urban_flag

    table = pd.DataFrame({
        "urban_rural": ["Auckland", "Auckland", "Other rural Auckland", "Stillwater", None],
        "population": [800.0, 700.0, 900.0, 466.0, 10.0],
    })
    assert urban_flag(table).tolist() == [True, True, False, False, False]
