"""Children by school age (docs/schools.md, "Who is counted: school-age
children"): the band splits, filling suppressed bands, spreading onto
hexagons as residents are, the totals against Stats NZ's, and the student
areas an even split gets wrong.

Tests that need census files read them from the data root (TEAM_DATA_ROOT,
default the folder above the repository) and are skipped without it.
Built-data tests read TEAM_SITE=<site>/data.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from team import ages, config, routing

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "tests" / "fixtures" / "ages"
DATA_ROOT = Path(os.environ.get("TEAM_DATA_ROOT", REPO.parent))
SITE = Path(os.environ["TEAM_SITE"]) if os.environ.get("TEAM_SITE") else None
PLACES = sorted(p.stem for p in (REPO / "configs").glob("*.yml"))


def place_settings(place: str, tmp_path: Path):
    return config.load(REPO / "configs" / f"{place}.yml", DATA_ROOT, tmp_path / "out", tmp_path / "cache")


def has_inputs(place: str) -> bool:
    import yaml

    raw = yaml.safe_load((REPO / "configs" / f"{place}.yml").read_text())
    keys = ("census_ages", "census_ages_sa2", "census_age_shape", "census_sa1", "grid")
    return all((DATA_ROOT / raw["data"][k]).exists() for k in keys)


needs_data = pytest.mark.skipif(not has_inputs("blenheim"), reason="census age files are not in the data root")
needs_site = pytest.mark.skipif(SITE is None, reason="set TEAM_SITE=<site>/data to check the built files")


def test_band_splits():
    bands = pd.DataFrame({"b0_4": [30.0], "b5_9": [40.0], "b10_14": [50.0], "b15_19": [60.0],
                          "f10": [0.25], "f11": [0.2], "f12": [0.2], "f13": [0.2], "f14": [0.15],
                          "f15": [0.3], "f16": [0.3], "f17": [0.2]})
    got = ages.groups(bands).iloc[0].to_dict()
    assert got == pytest.approx({"0_4": 30.0, "5_10": 52.5, "11_12": 20.0, "13_17": 65.5})
    even = ages.even_groups(bands).iloc[0].to_dict()
    assert even == pytest.approx({"0_4": 30.0, "5_10": 50.0, "11_12": 20.0, "13_17": 56.0})
    # The groups never take more than the bands hold: ages 5 to 17 from 5-9, 10-14 and 60% of 15-19 at most.
    assert got["5_10"] + got["11_12"] + got["13_17"] <= 40 + 50 + 60


def test_suppressed_bands_take_the_sa2_share():
    sa1 = pd.DataFrame({"sa1": ["a", "b", "c"], "sa2": ["X", "Y", "X"], "residents": [30.0, 12.0, 9.0],
                        "b0_4": [np.nan, np.nan, 3.0], "b5_9": [3.0, 0.0, 0.0], "b10_14": [3.0, 0.0, 0.0], "b15_19": [0.0, 0.0, 0.0]})
    sa2 = pd.DataFrame({"sa2": ["X", "Y", "Z"], "residents": [300.0, 100.0, 600.0],
                        "b0_4": [60.0, np.nan, 30.0], "b5_9": [30.0, 10.0, 30.0], "b10_14": [30.0, 10.0, 30.0], "b15_19": [30.0, 10.0, 30.0]})
    filled, record = ages.fill_bands(sa1, sa2)
    assert filled.loc[0, "b0_4"] == pytest.approx(30 * 60 / 300)          # the SA2's share
    assert filled.loc[1, "b0_4"] == pytest.approx(12 * 90 / 900)          # the SA2's band suppressed too: national
    assert filled.loc[2, "b0_4"] == 3.0                                   # published values are kept
    assert record["sa2"]["cells"] == 1 and record["national"]["cells"] == 1


def test_children_take_the_grids_population():
    children = pd.DataFrame({"13_17": [10.0, 0.0, 5.0]}, index=["a", "b", "c"])
    spread = pd.Series([100.0, 0.0, 50.0], index=["a", "b", "c"])
    grid = pd.Series([100.0, 20.0, 60.0, 0.0], index=["a", "b", "c", "d"])
    out, orphans = ages.to_grid(children, spread, grid)
    assert out["13_17"].tolist() == pytest.approx([10.0, 20.0 * 15 / 150, 6.0, 0.0])
    assert orphans == 1


_COMPUTED: dict[str, tuple] = {}


def computed(place: str, tmp_path: Path):
    if place not in _COMPUTED:
        settings = place_settings(place, tmp_path)
        origins = routing.load_origins(settings)
        table, summary = ages.compute(settings, origins)
        _COMPUTED[place] = (settings, origins, table, summary)
    return _COMPUTED[place]


@needs_data
@pytest.mark.parametrize("place", PLACES)
def test_children_are_spread_as_people_are(place, tmp_path):
    """Rule 4: residents spread by block area give the grid's population in
    every hexagon, except the 46 Auckland hexagons whose grid values were
    kept from an earlier build (the grid's metadata says so); children are
    each hexagon's spread age shares applied to its grid population."""
    settings, origins, table, summary = computed(place, tmp_path)
    check = summary["grid_check"]
    if place == "auckland":
        assert check["cells_over_0_01"] == 46 and check["origins_over_0_01"] == 20
    else:
        assert check["cells_over_0_01"] == 0
    assert check["cells_given_place_shares"] == 0
    pop = origins.set_index("id")["population"].reindex(table.index).to_numpy()
    kids = table[ages.COLUMNS].to_numpy(dtype="float64")
    assert (kids >= 0).all() and (kids.sum(axis=1) <= pop + 1e-3).all()
    assert table.index.equals(pd.Index(origins["id"], name="h3"))


@needs_data
@pytest.mark.parametrize("place", PLACES)
def test_place_totals_match_stats_nz_within_rounding(place, tmp_path):
    """For the SA2s wholly in the place, the groups summed from SA1s are within
    1% of the same groups from the 2023 SA2 table, or within three standard
    deviations of Stats NZ's random rounding to base 3 in the cells summed."""
    _, _, _, summary = computed(place, tmp_path)
    check = summary["sa2_check"]
    # The SA2s compared hold most of the place's residents (88% in Whakatane, the least).
    assert check["residents_in_whole_sa2s"] >= 0.85 * summary["residents"]
    for group in ages.GROUPS:
        assert check["within"][group], (group, check["from_sa1"][group], check["from_sa2"][group], check["allowance"][group])
    # Spread onto every hexagon, the place keeps its SA1 totals (Auckland: less the grid's kept hexagons).
    for group in ages.GROUPS:
        assert summary["totals_all_hexagons"][group] == pytest.approx(summary["sa1_totals"][group], rel=0.002)


@needs_data
def test_student_areas_are_not_counted_as_secondary_age(tmp_path):
    """Campus North, Dunedin (2023 SA2): most of its 15-19 band are students
    aged 18 and 19, so an even split of the band counts several times too
    many 13-17-year-olds. Hexagon 89da8435953ffff, mostly in Campus North."""
    settings = place_settings("dunedin", tmp_path)
    pieces, blocks = ages.block_pieces(settings)
    table, _ = ages.sa1_table(settings, blocks)
    shaped = ages.spread(pieces, ages.groups(table)).loc["89da8435953ffff"]
    even = ages.spread(pieces, ages.even_groups(table)).loc["89da8435953ffff"]
    names = blocks.drop_duplicates("sa2").set_index("sa2")["SA22023_name"]
    here = pieces[pieces["h3"] == "89da8435953ffff"]
    assert names[here.loc[here["people"].idxmax(), "sa2"]] == "Campus North"
    assert shaped["13_17"] <= 0.3 * even["13_17"]
    assert shaped["13_17"] == pytest.approx(45.0, abs=1.0) and even["13_17"] == pytest.approx(338.9, abs=1.0)


NAMED = json.loads((FIXTURES / "named_hexagons.json").read_text()) if (FIXTURES / "named_hexagons.json").exists() else {}


@needs_site
def test_named_hexagons_have_children():
    for place, cell in (("auckland", "89bb50021a3ffff"), ("wellington", "89bb2955a3bffff"), ("wellington", "89bb295594fffff"),
                        ("blenheim", "89bb29ba32fffff"), ("blenheim", "89bb29ba323ffff")):
        cells = json.loads((SITE / place / "cells.json").read_text())
        i = cells["h3"].index(cell)
        pop = cells["pop"][i]
        for group in ages.GROUPS:
            assert 0 < cells["ages"][group][i] < pop, (place, cell, group)
        if f"{place}/{cell}" in NAMED:
            assert {g: cells["ages"][g][i] for g in ages.GROUPS} == pytest.approx(NAMED[f"{place}/{cell}"], abs=0.11)


@needs_site
@pytest.mark.parametrize("place", PLACES)
def test_built_ages_match_the_summary(place):
    path = SITE / place / "summary.json"
    if not path.exists():
        pytest.skip(place)
    meta = json.loads(path.read_text())["meta"]
    cells = json.loads((SITE / place / "cells.json").read_text())
    assert meta["ages"]["services"]["secondary_school"] == "13_17"
    assert meta["ages"]["shape"] == "census2018_sa2"
    for group in ages.GROUPS:
        values = np.array([v or 0 for v in cells["ages"][group]], dtype=float)
        assert len(values) == len(cells["h3"])
        assert values.sum() == pytest.approx(meta["ages"]["totals"][group], abs=0.051)
        # Published to two decimals, the sums stay within 0.25% of the unrounded ones (Taupō 0-4: 0.17%, 3 children).
        assert values.sum() == pytest.approx(meta["ages"]["totals_unrounded"][group], rel=2.5e-3)
