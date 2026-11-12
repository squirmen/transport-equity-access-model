"""School map points (D5, src/team/school_points.py): rule D5-1 on made-up
grounds, then the rows it wrote and the audit of the built places
(TEAM_BUILDS, each place's build output, <root>/<place>)."""

from __future__ import annotations

import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point, box

from team import school_points, schools

REPO = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("TEAM_DATA_ROOT", REPO.parent))
GROUNDS = DATA_ROOT / "raw" / "nz" / "education" / "linz_nz_facilities_2026-11-12.gpkg"
BUILDS = Path(os.environ["TEAM_BUILDS"]) if os.environ.get("TEAM_BUILDS") else None
PLACES = sorted(p.stem for p in (REPO / "configs").glob("*.yml"))

# A grid of made-up grounds in NZTM, 200 m squares, 1 km apart.
X0, Y0 = 1_757_000.0, 5_920_000.0


def square(i: int, shift: float = 0.0):
    return box(X0 + 1000 * i + shift, Y0, X0 + 1000 * i + 200 + shift, Y0 + 200)


def wgs84(x: float, y: float) -> tuple[float, float]:
    point = gpd.GeoSeries([Point(x, y)], crs=2193).to_crs(4326).iloc[0]
    return point.x, point.y


def made_up():
    linz = gpd.GeoDataFrame({"moe": [1, 2, 3, 4, 5], "facility_id": ["f1", "f2", "f3", "f4", "f5"],
                             "name": ["A", "B", "C", "D", "E"]},
                            geometry=[square(0), square(1), square(2), square(3), square(4)], crs=2193)
    osm = gpd.GeoDataFrame({"osm": ["way/1", "way/3", "way/4", "way/5", "way/9"], "name": ["A", "C", "D", "E", "Other school"],
                            "moe": pd.array([1, 3, 4, 5, 9], dtype="Int64")},
                           # D's OpenStreetMap grounds are somewhere else (no overlap); a ninth school's grounds hold E's point.
                           geometry=[square(0, 5.0), square(2), square(3, 400.0), square(4), box(X0 + 4000 + 400, Y0, X0 + 4000 + 600, Y0 + 200)],
                           crs=2193)
    rows = []
    # A: 300 m east of its grounds; both sources agree: moved.
    # B: 300 m east; LINZ only: not moved.
    # C: 80 m east; both agree, but under 100 m: listed, not moved.
    # D: 300 m east; the sources disagree: not moved.
    # E: 350 m east, inside another school's OpenStreetMap grounds: not moved.
    for moe, (dx, i) in zip([1, 2, 3, 4, 5], [(500, 0), (500, 1), (280, 2), (500, 3), (550, 4)]):
        lon, lat = wgs84(X0 + 1000 * i + dx, Y0 + 100)
        rows.append({"moe": moe, "name": "ABCDE"[moe - 1], "kind": "state", "lon": lon, "lat": lat, "dir_lon": lon, "dir_lat": lat})
    return pd.DataFrame(rows), linz, osm


def test_rule_d5_1_moves_only_points_two_sources_place_elsewhere():
    listed, linz, osm = made_up()
    audited = school_points.audit(listed, linz, osm).set_index("moe")
    assert audited["move"].to_dict() == {1: True, 2: False, 3: False, 4: False, 5: False}
    assert audited.loc[3, "flags"].startswith("80 m outside")
    assert "inside another school's grounds" in audited.loc[5, "flags"]
    new = gpd.GeoSeries([Point(audited.loc[1, "new_lon"], audited.loc[1, "new_lat"])], crs=4326).to_crs(2193).iloc[0]
    grounds = linz.set_index("moe").geometry[1]
    # 10 m in from the edge nearest the old point (the east edge); the
    # written point is rounded to 6 decimal places, about 0.1 m.
    assert grounds.contains(new) and new.distance(grounds.exterior) == pytest.approx(10.0, abs=0.15)
    assert new.x == pytest.approx(X0 + 190, abs=0.15)
    rows = school_points.point_rows(audited.reset_index(), "2026-11-12")
    assert rows["moe"].tolist() == [1] and rows["rule"].tolist() == ["D5-1"] and rows["checked_by"].tolist() == ["rule D5-1"]


def test_a_point_moved_by_rule_counts_as_checked(tmp_path):
    folder = tmp_path / "configs"
    folder.mkdir()
    (folder / "points.csv").write_text("moe,name,lon,lat,source,reason,rule,checked_by,checked_on\n"
                                       "1,A,174.5,-36.5,LINZ,outside,D5-1,rule D5-1,2026-11-12\n"
                                       "2,B,174.6,-36.6,LINZ,outside,,,\n")
    assert set(schools.corrected_points(folder)) == {1}
    assert schools.point_rules(folder)[1]["rule"] == "D5-1"


def checked_rows() -> pd.DataFrame:
    table = schools._checked(REPO / "configs" / "schools" / "points.csv")
    return table if len(table) else pd.DataFrame(columns=["moe", "lon", "lat", "rule"])


def test_a_checked_row_with_no_point_keeps_the_directory_point(tmp_path):
    folder = tmp_path / "configs"
    folder.mkdir()
    (folder / "points.csv").write_text("moe,name,lon,lat,source,reason,rule,checked_by,checked_on\n"
                                       "1,A,174.5,-36.5,website,outside,,a person,2026-11-13\n"
                                       "2,B,,,website,kept: shared campus,,a person,2026-11-13\n"
                                       "3,C,,,website,kept,,,\n")
    assert set(schools.corrected_points(folder)) == {1}
    assert set(schools.kept_points(folder)) == {2}
    assert schools.checked_points(folder) == {1: "moved", 2: "kept"}


def test_a_school_a_person_checked_is_no_longer_listed():
    listed, linz, osm = made_up()
    audited = school_points.audit(listed, linz, osm, checked={2: "kept", 4: "moved"}).set_index("moe")
    assert audited["checked"].dropna().to_dict() == {2: "kept", 4: "moved"}
    # Flags still describe the directory's point.
    assert audited.loc[2, "flags"].startswith("300 m outside")
    assert school_points.to_check(audited.reset_index()).tolist() == [False, False, True, False, True]


# The 0.12.1 review checked every school more than 50 m outside its LINZ
# grounds in the 0.12.0 audit that rule D5-1 left alone: 14 moved, 6 kept.
CHECKED_MOVED = {52, 472, 481, 603, 1165, 2899, 3346, 3628, 3630, 3686, 3687, 3691, 4135, 4204}
CHECKED_KEPT = {324, 1491, 1699, 3102, 3698, 4121}


@pytest.mark.skipif(not GROUNDS.exists(), reason="needs LINZ school grounds in the data root (scripts/fetch_school_grounds.py)")
def test_moved_points_are_inside_their_grounds():
    linz = school_points.read_linz_grounds(GROUNDS).set_index("moe")
    rows = checked_rows()
    by_rule = rows[rows["rule"] == school_points.RULE]
    assert set(by_rule["moe"].astype(int)) == {232, 3618, 3641}  # Te Aute College, Te Kura aa Iwi o Ngaati Kauwhata, Porirua Montessori Primary School
    by_hand = rows[rows["rule"] != school_points.RULE]
    has_point = by_hand["lon"].astype(str).str.strip() != ""
    assert set(by_hand.loc[has_point, "moe"].astype(int)) == CHECKED_MOVED
    assert set(by_hand.loc[~has_point, "moe"].astype(int)) == CHECKED_KEPT
    assert by_hand["source"].str.len().min() > 40 and by_hand["reason"].str.len().min() > 10
    for row in rows[rows["lon"].astype(str).str.strip() != ""].to_dict("records"):
        point = gpd.GeoSeries([Point(float(row["lon"]), float(row["lat"]))], crs=4326).to_crs(2193).iloc[0]
        grounds = linz.geometry[int(row["moe"])]
        assert grounds.contains(point), row["name"]
        if row["rule"] == school_points.RULE:
            assert point.distance(grounds.boundary) >= school_points.INSET_M - 0.5, row["name"]


def test_mags_keeps_the_ministry_point():
    assert 69 not in set(checked_rows()["moe"].astype(int))


@pytest.mark.skipif(BUILDS is None, reason="set TEAM_BUILDS to the built places")
@pytest.mark.parametrize("place", PLACES)
def test_every_flagged_school_is_listed(place):
    path = BUILDS / place / "destinations" / "school_points_audit.csv"
    audited = pd.read_csv(path)
    outside = audited["linz_outside_m"].fillna(0) > school_points.OUTSIDE_FLAG_M
    none = audited["linz_outside_m"].isna()
    other = audited["inside_other"].notna() | audited["inside_other_osm"].notna()
    far = (audited["walkable_way_m"].fillna(0) > school_points.FAR_FROM_NETWORK_M) | (audited["r5_link_m"].fillna(0) > school_points.FAR_FROM_NETWORK_M)
    far |= audited["flags"].fillna("").str.contains("links it to no street")
    flagged = outside | none | other | far
    assert (audited["flags"].notna() == flagged).all()
    moved = audited[audited["move"]]
    assert set(moved["moe"]) <= set(checked_rows()["moe"].astype(int))
    # Every school more than 50 m outside its grounds was moved by rule or checked by a person.
    assert (audited.loc[outside, "move"].astype(bool) | audited.loc[outside, "checked"].notna()).all()
    expected = audited["moe"].map(lambda m: "moved" if m in CHECKED_MOVED else "kept" if m in CHECKED_KEPT else None)
    assert (audited["checked"].fillna("") == expected.fillna("")).all()
    if place == "auckland":
        mags = audited.set_index("moe").loc[69]
        assert mags["linz_outside_m"] == 0 and not mags["move"] and pd.isna(mags["flags"])
