"""End-to-end check of the steps after routing, on made-up routing outputs.

Writes routing files the way `team route` does, then runs measures, diagnosis,
equity summaries and the web export, checking the hand-offs between them.
"""

import json
from pathlib import Path

import h3
import numpy as np
import pandas as pd
import pytest

from team import diagnosis, equity, export, measures
from team.config import Settings

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
        "region": "Test",
        "routing": {
            "date": "2026-09-15",
            "modes": MODES,
            "speed_walking_kmh": 4.8,
            "windows": {"am_peak": {"start": "07:00", "minutes": 120}, "interpeak": {"start": "10:00", "minutes": 120}},
        },
        "standard_modes": ["walk", "bike_low_stress", "pt"],
        "services": {"gp": {"label": "GP", "window": "interpeak", "standard_minutes": 20}},
        "jobs": {"thresholds": [30, 45], "modes": ["walk", "pt"], "window": "am_peak"},
    }
    (tmp_path / "cache").mkdir()
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path / "cache")


def write(path: Path, frame: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, index=False)


def service_rows(reached: dict[str, tuple[float, str]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"origin": o, "service": "gp", "minutes": m, "nearest_id": nid,
             "n10": int(m <= 10), "n15": int(m <= 15), "n20": int(m <= 20), "n30": int(m <= 30)}
            for o, (m, nid) in reached.items()
        ]
    )


def test_steps_after_routing(settings: Settings, tmp_path: Path):
    cells = sorted(h3.grid_disk(h3.latlng_to_cell(-36.85, 174.76, 9), 1))[:3]
    a, b, c = cells
    origins = pd.Index(cells, name="h3")
    routing = tmp_path / "routing"
    write(routing / "services_walk.parquet", service_rows({a: (12, "0"), b: (40, "1")}))
    write(routing / "services_bike_low_stress.parquet", service_rows({a: (8, "0")}))
    write(routing / "services_bike.parquet", service_rows({a: (6, "0"), b: (15, "1")}))
    write(routing / "services_car.parquet", service_rows({a: (3, "0"), b: (6, "1"), c: (9, "1")}))
    write(routing / "services_interpeak_pt.parquet", service_rows({a: (15, "0"), b: (28, "1")}))

    table = measures.service_table(settings, origins)
    assert table.loc[a, "t_gp_walk"] == 12
    assert np.isnan(table.loc[c, "t_gp_walk"])
    table = measures.add_standards(table, settings)
    assert table["meets_gp"].tolist() == [True, False, False]
    assert table.loc[a, "via_gp"] == "bike_low_stress"
    assert table.loc[b, "via_gp"] == "pt"

    jobs = pd.DataFrame({"id": ["x", "y"], "jobs": [100.0, 300.0]})
    write(tmp_path / "destinations" / "jobs.parquet", jobs)
    write(routing / "jobs_walk.parquet", pd.DataFrame({"origin": cells, "jobs_30": [100.0, 0.0, 0.0], "jobs_45": [100.0, 300.0, 0.0]}))
    write(routing / "jobs_am_peak_pt.parquet", pd.DataFrame({"origin": cells, "jobs_30": [400.0, 300.0, 0.0], "jobs_45": [400.0, 300.0, 300.0]}))
    write(
        tmp_path / "cache" / "pairs" / "jobs_am_peak_pt" / "origins_000000.parquet",
        pd.DataFrame({"origin": [a, a, b, c], "destination": ["x", "y", "y", "y"], "minutes": np.array([10, 25, 20, 40], dtype="uint8")}),
    )
    demand = pd.Series({a: 100.0, b: 300.0, c: 50.0})
    job_columns = measures.job_table(settings, origins, demand)
    assert job_columns.loc[a, "jobshare45_pt"] == pytest.approx(1.0)
    assert "jobsfair30_pt" in job_columns and "jobsfair30_walk" not in job_columns
    # Within 30 min: x is shared by 100 people, y by 400. c reaches nothing in time.
    regional = 400.0 / 450.0
    assert job_columns.loc[a, "jobsfair30_pt"] == pytest.approx(1.75 / regional)
    assert job_columns.loc[c, "jobsfair30_pt"] == 0

    table["km_gp"] = [0.5, 3.0, 9.0]
    table["pt_per_hour_interpeak"] = [6.0, 2.0, 0.0]
    table["pt_per_hour_am_peak"] = [8.0, 3.0, 0.0]
    table = diagnosis.diagnose(table, settings)
    assert table["why_gp"].tolist() == [0, 2, 5]

    table["population"] = [100.0, 300.0, 50.0]
    table["nzdep"] = [2, 9, 10]
    table["no_vehicle_share"] = [0.0, 0.2, 0.5]
    table["children_share"] = [0.2, 0.2, 0.1]
    table["older_share"] = [0.1, 0.1, 0.3]
    table["sa2"] = ["North", "South", "South"]
    table["local_board"] = ["Board 1", "Board 2", "Board 2"]
    table["m_frequent_stop"] = [200.0, 900.0, 4000.0]
    table["m_rail_ferry"] = [1500.0, 2500.0, 9000.0]
    table["m_low_stress_route"] = [100.0, 1200.0, 5000.0]
    table = table.join(job_columns)

    summary = equity.service_summary(table, settings)[0]
    assert summary["share_meeting"]["everyone"] == pytest.approx(100 / 450)
    assert summary["people_below"]["everyone"] == pytest.approx(350)
    assert summary["people_below"]["no_car"] == pytest.approx(300 * 0.2 + 50 * 0.5)
    assert summary["reasons"]["safe_bike"] == pytest.approx(300)
    assert summary["reasons"]["distance"] == pytest.approx(50)
    assert summary["gap_points"] == pytest.approx(100.0)

    areas = equity.area_summary(table, settings, "sa2").set_index("sa2")
    assert areas.loc["South", "below_gp"] == pytest.approx(350)
    assert areas.loc["South", "why_gp"] == 2
    assert {e["mode"] for e in equity.jobs_summary(table, settings)} == {"walk", "pt"}

    destinations = pd.DataFrame(
        {"id": ["0", "1"], "service": ["gp", "gp"], "name": ["Clinic A", "Clinic B"], "source": "OpenStreetMap",
         "source_id": ["osm:node/1", "osm:node/2"], "weight": 1.0, "lon": [174.76, 174.77], "lat": [-36.85, -36.86]}
    )
    places, place_index = export.place_list(table)
    dests, dest_index = export.destination_list(destinations)
    payload = export.cell_payload(settings, table, place_index, dest_index)
    assert [p["name"] for p in places] == ["North", "South"]
    assert payload["t"]["gp"]["walk"] == [12, 40, None]
    assert payload["nearest"]["gp"] == [0, 1, None]
    assert payload["jobs"]["pt"]["45"][0] == pytest.approx(100.0)
    assert payload["place"] == [0, 1, 1]
    json.dumps(export._clean(payload))
