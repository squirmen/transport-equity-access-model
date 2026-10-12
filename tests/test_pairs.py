"""Cell to cell pairs: which path is kept, the tile layout, and run bookkeeping."""

import json
from pathlib import Path

import pandas as pd
import pytest

from team import pairs
from team.config import Settings


def row(routes="", boards="", alights="", rides="", waits="", access="None", egress="None",
        transfer="0.0", total="10.0", iters="1"):
    return {"routes": routes, "boardStops": boards, "alightStops": alights, "feedIds": "", "rideTimes": rides,
            "accessTime": access, "egressTime": egress, "transferTime": transfer, "waitTimes": waits,
            "totalTime": total, "nIterations": iters, "group": ""}


def test_most_used_keeps_the_path_used_in_most_departure_minutes():
    rows = [
        row("70-205", "S1", "S2", "28.9", "2.8", "10.6", "0.6", total="42.9", iters="58"),
        row("711-221|70-205", "S3|S4", "S4|S2", "6.0|25.1", "1.4|4.2", "2.7", "0.6", total="39.9", iters="4"),
    ]
    kept = pairs.most_used(rows)
    assert kept["routes"] == "70-205" and kept["legs"] == 1
    assert (kept["board"], kept["alight"]) == ("S1", "S2")
    assert (kept["access"], kept["egress"], kept["wait"], kept["ride"]) == (10.6, 0.6, 2.8, 28.9)
    assert (kept["iters"], kept["reached"], kept["paths"]) == (58, 62, 2)


def test_most_used_with_transfers_gives_first_board_and_last_alight():
    kept = pairs.most_used([row("711-221|70-205", "S3|S4", "S4|S2", "6.0|25.1", "1.4|4.2", "2.7", "0.6",
                                transfer="1.5", total="41.4", iters="9")])
    assert kept["legs"] == 2
    assert (kept["board"], kept["alight"]) == ("S3", "S2")
    assert kept["boards"] == "S3|S4" and kept["alights"] == "S4|S2"
    assert kept["wait"] == 5.6 and kept["ride"] == 31.1 and kept["transfer"] == 1.5


def test_most_used_breaks_ties_by_the_quicker_path():
    rows = [row("A", "S1", "S2", "20", "5", "5", "5", total="35", iters="10"),
            row("B", "S3", "S4", "15", "5", "5", "5", total="30", iters="10")]
    assert pairs.most_used(rows)["routes"] == "B"


def test_walking_all_the_way_has_no_stops():
    kept = pairs.most_used([row(total="12.1", iters="120")])
    assert kept["legs"] == 0 and kept["board"] is None and kept["access"] is None
    assert kept["total"] == 12.1 and kept["iters"] == 120
    # No rows: R5 searched no public transport, so nothing is known but the time.
    none = pairs.most_used([])
    assert none["paths"] == 0 and none["iters"] is None and none["total"] is None


def test_tile_block_lines_rows_up_with_origins():
    rows = pd.DataFrame({
        "o": [7, 3, 3], "d": [1, 9, 2], "minutes": [5, 12, 30],
        "legs": [0, 1, 2], "routes": ["", "70-205", "711-221|70-205"],
        "board": [None, "S1", "S3"], "alight": [None, "S2", "S2"],
        "access": [None, 10.6, 2.7], "egress": [None, 0.6, 0.6], "transfer": [None, 0.0, 1.5],
        "wait": [None, 2.8, 5.6], "ride": [None, 28.9, 31.1], "total": [5.2, 42.9, 41.4],
        "iters": pd.array([120, 60, None], dtype="Int16"),
    })
    # Times alone, as in the tile for every mode.
    assert pairs.tile_block(rows, [3, 5, 7]) == {"n": [2, 0, 1], "d": [2, 9, 1], "m": [30, 12, 5]}
    stops, routes = {"S9": 0}, {}
    block = pairs.tile_block(rows, [3, 5, 7], 120.0, stops, routes)
    assert block["n"] == [2, 0, 1]
    assert block["d"] == [2, 9, 1] and block["m"] == [30, 12, 5]
    # Boarding stops are added first, then alighting stops.
    assert stops == {"S9": 0, "S3": 1, "S1": 2, "S2": 3}
    assert block["b"] == [1, 2, None] and block["a"] == [3, 3, None]
    assert routes == {"711-221|70-205": 0, "70-205": 1}
    assert block["r"] == [0, 1, None]
    assert block["use"] == [None, 50, 100]
    assert block["acc"] == [2.7, 10.6, None] and block["xfer"] == [1.5, 0.0, None]
    assert "legs" not in block and "tot" not in block


def test_tile_block_for_walking_has_times_only():
    rows = pd.DataFrame({"o": [1, 1], "d": [4, 2], "minutes": [9, 3]})
    assert pairs.tile_block(rows, [1], None, {}, {}) == {"n": [2], "d": [2, 4], "m": [3, 9]}


def test_write_site_splits_times_and_paths(tmp_path: Path, monkeypatch):
    settings = Settings(
        raw={"routing": {"date": "2026-09-15", "windows": {"interpeak": {"start": "10:00", "minutes": 120}},
                         "modes": {"walk": {"kind": "walk"}, "pt": {"kind": "transit"}}},
             "pairs": {"minutes": {"walk": 20, "pt": 45}}},
        config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path,
    )
    a, b, c = "89bb5000003ffff", "89bb5000007ffff", "89bb500000bffff"
    cells = pd.DataFrame({"id": [a, b, c], "urban": [True, True, False]})
    monkeypatch.setattr(pairs, "team_cells", lambda s: cells)
    monkeypatch.setattr(pairs, "route_table", lambda s: {"R1": {"name": "1", "type": 3}})
    monkeypatch.setattr(pairs, "stops_outside_overlays", lambda s, used: {})
    folder = pairs.cache_dir(settings)
    folder.mkdir(parents=True)
    order = pairs.order_digest(cells["id"])
    walk = pd.DataFrame({"origin": [a, c], "destination": [b, a], "minutes": [4, 9]})
    walk.to_parquet(folder / "walk.parquet")
    (folder / "walk.json").write_text(json.dumps({"destinations": order, "window_minutes": 10}))
    record = pairs.most_used([row("R1", "S1", "S2", "10.0", "3.0", "4.0", "2.0", total="19.0", iters="90")])
    pt = pairs.typed(pd.concat([pd.DataFrame({"origin": [a], "destination": [c], "minutes": [20]}),
                                pd.DataFrame([record])], axis=1))
    pt.to_parquet(folder / "pt_interpeak.parquet")
    (folder / "pt_interpeak.json").write_text(json.dumps({"destinations": order, "window_minutes": 120}))

    out = pairs.write_site(settings, tmp_path / "site")
    tile = "87bb50000ffffff"
    times = json.loads((out / f"{tile}.json").read_text())
    assert times["cells"] == [0, 2]
    assert times["walk"] == {"n": [1, 1], "d": [1, 0], "m": [4, 9]}
    assert times["pt"]["interpeak"] == {"n": [1, 0], "d": [2], "m": [20]}
    paths = json.loads((out / "interpeak" / f"{tile}.json").read_text())
    assert paths["window"] == "interpeak" and paths["cells"] == [0, 2]
    assert paths["stops"] == ["S1", "S2"] and paths["routes"] == ["R1"]
    assert (paths["b"], paths["a"], paths["r"], paths["use"]) == ([0], [1], [0], [75])
    assert (out / f"{tile}.json.gz").exists()
    index = json.loads((out / "index.json").read_text())
    assert index["tiles"] == [tile] and index["path_tiles"] == {"interpeak": [tile]}
    assert index["order"] == order


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    raw = {
        "routing": {
            "windows": {"am_peak": {"start": "07:00", "minutes": 120}, "saturday": {"start": "10:00", "minutes": 120}},
            "modes": {"walk": {"kind": "walk"}, "bike": {"kind": "cycle"}, "pt": {"kind": "transit"}},
        },
        "pairs": {"minutes": {"walk": 20, "bike_low_stress": 20, "bike": 20, "pt": 45}, "pt_origins": "urban"},
    }
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)


def test_runs_skip_modes_the_place_does_not_have(settings: Settings):
    # No low-stress cycling mode here.
    assert pairs.runs(settings) == [
        ("walk", "walk", None), ("bike", "bike", None),
        ("pt_am_peak", "pt", "am_peak"), ("pt_saturday", "pt", "saturday"),
    ]


def test_public_transport_routes_from_urban_cells_only(settings: Settings):
    cells = pd.DataFrame({"id": ["a", "b", "c"], "urban": [True, False, True]})
    assert list(pairs.origins_for(settings, cells, "pt")["id"]) == ["a", "c"]
    assert list(pairs.origins_for(settings, cells, "walk")["id"]) == ["a", "b", "c"]


def test_a_changed_run_clears_its_batches(tmp_path: Path):
    (tmp_path / "origins_000000.parquet").write_text("x")
    pairs._check_scope(tmp_path, {"tag": "walk", "minutes": 20})
    assert (tmp_path / "origins_000000.parquet").exists()
    pairs._check_scope(tmp_path, {"tag": "walk", "minutes": 20})
    assert (tmp_path / "origins_000000.parquet").exists()
    pairs._check_scope(tmp_path, {"tag": "walk", "minutes": 25})
    assert not (tmp_path / "origins_000000.parquet").exists()
    assert json.loads((tmp_path / "scope.json").read_text())["minutes"] == 25


def test_typed_keeps_missing_paths_missing():
    table = pd.DataFrame({"origin": ["a"], "destination": ["b"], "minutes": [7]})
    record = pairs.most_used([])
    out = pairs.typed(pd.concat([table, pd.DataFrame([record])], axis=1))
    assert str(out["minutes"].dtype) == "uint8" and str(out["iters"].dtype) == "Int16"
    assert out["iters"].isna().all() and out["board"].isna().all()
