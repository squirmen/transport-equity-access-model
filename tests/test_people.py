"""Assigning hexagon centres to areas such as local boards."""

import geopandas as gpd
import pandas as pd
import pytest
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



def test_villages_split_a_hexagon_by_block(tmp_path):
    import json

    import h3
    from shapely.geometry import Polygon, box

    from team.config import Settings
    from team.people import villages

    cell = h3.latlng_to_cell(-36.85, 174.76, 9)
    far = h3.latlng_to_cell(-36.95, 174.90, 9)
    ordinary = h3.latlng_to_cell(-37.00, 175.00, 9)
    hexagon = gpd.GeoSeries([Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(cell)])], crs="EPSG:4326").to_crs("EPSG:2193")[0]
    x0, y0, x1, y1 = hexagon.bounds
    middle = (x0 + x1) / 2

    def around(c):
        shape = Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)])
        return gpd.GeoSeries([shape], crs="EPSG:4326").to_crs("EPSG:2193")[0]

    blocks = gpd.GeoDataFrame(
        {"SA12023_code": ["1", "2", "3", "4"]},
        geometry=[
            hexagon.intersection(box(x0, y0, middle, y1)),  # west half: a retirement village, 70% aged 65+
            hexagon.intersection(box(middle, y0, x1, y1)),  # east half: ordinary homes, 10%
            around(far),                                     # a rest home block, 35%
            around(ordinary),                                # 35% with no rest home: ordinary
        ],
        crs="EPSG:2193",
    )
    blocks.to_file(tmp_path / "sa1.gpkg", driver="GPKG")
    records = [
        {"SA12023_V1_00": "1", "VAR_1_3": 100, "VAR_1_83": 70},
        {"SA12023_V1_00": "2", "VAR_1_3": 100, "VAR_1_83": 10},
        {"SA12023_V1_00": "3", "VAR_1_3": 100, "VAR_1_83": 35},
        {"SA12023_V1_00": "4", "VAR_1_3": 100, "VAR_1_83": 35},
    ]
    (tmp_path / "census.json").write_text(json.dumps({"records": records}))
    point = gpd.GeoSeries([around(far).centroid], crs="EPSG:2193").to_crs("EPSG:4326")[0]
    pd.DataFrame({
        "Fac Type": ["agedcare", "hospital"],
        "NZGD2K X": [point.x, 175.0],
        "NZGD2K Y": [point.y, -37.0],
    }).to_excel(tmp_path / "facilities.xlsx", index=False)
    settings = Settings(
        raw={"data": {"census_sa1": "sa1.gpkg", "census_equity": "census.json", "health_facilities": "facilities.xlsx"}},
        config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path,
    )
    cells = pd.DataFrame({"population": [200.0, 100.0, 100.0]}, index=[cell, far, ordinary])
    out = villages(settings, cells)
    assert out.loc[cell, "village_pop"] == pytest.approx(100, rel=0.02)
    assert out.loc[cell, "village_older"] == pytest.approx(70, rel=0.02)
    assert out.loc[cell, "home_older"] == pytest.approx(10, rel=0.02)
    assert out.loc[far, "village_older"] == pytest.approx(35, rel=0.02)  # held a registered facility
    assert ordinary not in out.index  # 35% alone is not a village


def test_named_areas_take_the_area_a_point_falls_in(tmp_path):
    from shapely.geometry import Point, box

    from team.config import Settings
    from team.people import named_areas

    wards = gpd.GeoDataFrame(
        {"Ward_name": ["Takapū/Northern General Ward", "Central Ward"]},
        geometry=[box(0, 0, 1000, 1000), box(1000, 0, 2000, 1000)],
        crs="EPSG:2193",
    )
    wards.to_file(tmp_path / "wards.gpkg", driver="GPKG")
    points = gpd.GeoDataFrame({"id": ["a", "b", "c"]}, geometry=[Point(500, 500), Point(1500, 500), Point(9000, 9000)], crs="EPSG:2193")
    settings = Settings(raw={"data": {"wards": "wards.gpkg"}}, config_path=tmp_path / "c.yml",
                        data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)
    names = named_areas(settings, points, "wards", "Ward_name")
    assert names["a"] == "Takapū/Northern Ward"  # "General" dropped
    assert names["b"] == "Central Ward"
    assert pd.isna(names["c"])
    none = Settings(raw={"data": {}}, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)
    assert named_areas(none, points, "wards", "Ward_name").isna().all()


def test_a_ward_belongs_to_its_own_council(tmp_path):
    from shapely.geometry import Point, box

    from team.config import Settings
    from team.people import councils_and_wards

    gpd.GeoDataFrame({"TA_code": ["045", "046"], "TA_name": ["Upper Hutt City", "Lower Hutt City"]},
                     geometry=[box(0, 0, 1000, 1000), box(1000, 0, 2000, 1000)], crs="EPSG:2193").to_file(tmp_path / "c.gpkg", driver="GPKG")
    # Upper Hutt has no wards; Lower Hutt's Northern Ward runs up to the boundary.
    gpd.GeoDataFrame({"Ward_code": ["04601"], "Ward_name": ["Northern General Ward"]},
                     geometry=[box(1000, 0, 2000, 1000)], crs="EPSG:2193").to_file(tmp_path / "w.gpkg", driver="GPKG")
    points = gpd.GeoDataFrame({"id": ["upper", "lower"]}, geometry=[Point(900, 500), Point(1500, 500)], crs="EPSG:2193")
    settings = Settings(raw={"data": {"councils": "c.gpkg", "wards": "w.gpkg"}}, config_path=tmp_path / "x.yml",
                        data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)
    out = councils_and_wards(settings, points)
    assert out.loc["upper", "council"] == "Upper Hutt City"
    assert pd.isna(out.loc["upper", "ward"])  # 100 m from Lower Hutt's ward, but not in it
    assert out.loc["lower", "ward"] == "Northern Ward"
