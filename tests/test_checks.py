"""The plausibility check against 2023 Census journey to work."""

import pandas as pd
import pytest

from team import equity


def test_commute_check_ranks_areas_by_access_and_not_driving():
    table = pd.DataFrame(
        {
            "sa2": ["A", "A", "B", "C", "D"],
            "population": [100.0, 100.0, 200.0, 200.0, 0.0],
            "jobshare45_pt": [0.30, 0.10, 0.05, 0.40, 0.99],
            "commute_car_share": [0.80, 0.80, 0.95, 0.60, 0.10],
        }
    )
    check = equity.commute_check(table)
    # A: access (30 + 10) / 200 = 0.2, not driving 0.2; B: 0.05, 0.05; C: 0.4, 0.4.
    # D has no residents and is left out.
    assert check["areas"] == 3
    assert check["measure"] == "jobshare45_pt"
    assert check["spearman"] == pytest.approx(1.0)


def test_commute_check_needs_the_census_field():
    assert equity.commute_check(pd.DataFrame({"sa2": ["A"], "population": [1.0]})) is None
