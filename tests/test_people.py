"""Assigning hexagon centres to areas such as local boards."""

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, box

from team.people import assign_areas


def test_points_take_the_area_they_fall_in_or_the_nearest_on_the_coast():
    areas = gpd.GeoDataFrame(
        {"name": ["West", "East"]},
        geometry=[box(0, 0, 1000, 1000), box(1000, 0, 2000, 1000)],
        crs="EPSG:2193",
    )
    points = gpd.GeoDataFrame(
        {"id": ["a", "b", "c", "d"]},
        geometry=[Point(500, 500), Point(1500, 500), Point(2300, 500), Point(5000, 5000)],
        crs="EPSG:2193",
    )
    result = assign_areas(points, areas, "name")
    assert list(result.index) == ["a", "b", "c", "d"]
    assert result["a"] == "West"
    assert result["b"] == "East"
    assert result["c"] == "East"  # 300 m offshore, within the 500 m allowance
    assert pd.isna(result["d"])  # too far from any area
