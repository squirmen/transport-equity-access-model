"""Enrolment zones (docs/schools.md, "Enrolment zones (In zone)"): the file,
the rules Z1 to Z4, residents placed by address points, the majority set,
and the built files for the named hexagons.

Tests that need the Ministry's file or the directory read them from the data
root (TEAM_DATA_ROOT, default the folder above the repository) and are
skipped without it. Built-data tests read TEAM_SITE=<site>/data.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from team import schools, zones
from team.config import Settings

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "tests" / "fixtures" / "zones"
DATA_ROOT = Path(os.environ.get("TEAM_DATA_ROOT", REPO.parent))
ZONE_FILE = DATA_ROOT / "raw" / "nz" / "education" / "moe_enrolment_zones_2026-11-12" / "Enrolmentschememaster.zip"
DIRECTORY = DATA_ROOT / "raw" / "nz" / "education" / "moe_schools_directory_2026-11-12.csv"
SITE = Path(os.environ["TEAM_SITE"]) if os.environ.get("TEAM_SITE") else None
FIRST = {"primary_school": 1, "intermediate_school": 7, "secondary_school": 9}

needs_file = pytest.mark.skipif(not ZONE_FILE.exists(), reason="the Ministry's zone file is not in the data root")
needs_site = pytest.mark.skipif(SITE is None, reason="set TEAM_SITE=<site>/data to check the built files")


def box_zone(x0, y0, x1, y1):
    from shapely.geometry import box

    return box(x0, y0, x1, y1)


def zone_frame(rows):
    """Zones as zones.read returns them, from (moe, polygon_id, name, date, geometry)."""
    import geopandas as gpd

    frame = gpd.GeoDataFrame([{"moe": m, "polygon_id": p, "name": n, "approved": d, "effective": d, "date": d,
                               "date_source": "effective" if d else None} for m, p, n, d, _ in rows],
                             geometry=[g for *_, g in rows], crs="EPSG:2193")
    years = frame["name"].apply(zones.parse_years)
    frame["years_from"] = pd.array([y[0] if y else None for y in years], dtype="Int64")
    frame["years_to"] = pd.array([y[1] if y else None for y in years], dtype="Int64")
    return frame


def listed_row(moe, services, years_from, scheme=True, kind="state", medium="english", sex="co-ed"):
    row = {"school": f"moe:{moe}", "moe": moe, "name": f"School {moe}", "kind": kind, "medium": medium,
           "scheme": scheme, "services": ",".join(services), "years_from": years_from}
    for s in FIRST:
        row[f"sex_{s}"] = sex if s in services else None
    return row


# ---------------------------------------------------------------------------
# The file


def test_the_zone_file_is_nztm_and_a_file_without_a_projection_is_refused(tmp_path):
    import geopandas as gpd
    import pyproj

    wkt = (FIXTURES / "esmaster_crs.wkt").read_text().strip()
    crs = pyproj.CRS.from_wkt(wkt)
    # The Ministry's projection has the NZTM parameters under another name.
    assert crs.to_epsg(min_confidence=20) == 2193 and not crs.equals(pyproj.CRS(2193))
    zone = box_zone(1756000, 5918000, 1758000, 5920000)
    frame = gpd.GeoDataFrame({"SchoolID": [69], "PolyID": [69], "PolyName": ["Mt Albert Grammar School"],
                              "ApprovalDate": ["2010-03-24"], "EffectiveDate": ["2018-06-06"]}, geometry=[zone], crs=crs)
    path = tmp_path / "zones.tab"
    frame.to_file(path, driver="MapInfo File")
    read = zones.read(path)
    assert read.crs.to_epsg() == 2193
    assert read.geometry.iloc[0].bounds == pytest.approx(zone.bounds, abs=0.05)  # MapInfo keeps centimetres
    assert read["effective"].iloc[0] == dt.date(2018, 6, 6) and read["date_source"].iloc[0] == "effective"
    # The old New Zealand Map Grid is transformed, not taken as NZTM.
    nzmg = frame.to_crs(27200)
    nzmg.to_file(tmp_path / "nzmg.gpkg", driver="GPKG")
    back = zones.read(tmp_path / "nzmg.gpkg")
    assert back.crs.to_epsg() == 2193 and back.geometry.iloc[0].bounds == pytest.approx(zone.bounds, abs=1.0)
    # A shapefile with no .prj has no projection: refused.
    frame.set_crs(None, allow_override=True).to_file(tmp_path / "bare.shp")
    with pytest.raises(SystemExit, match="no projection"):
        zones.read(tmp_path / "bare.shp")
    # Any other projection is refused rather than guessed.
    frame.to_crs(3857).to_file(tmp_path / "web.gpkg", driver="GPKG")
    with pytest.raises(SystemExit, match="neither NZTM2000 nor NZMG"):
        zones.read(tmp_path / "web.gpkg")


@needs_file
def test_the_ministry_file_reads_as_checked():
    read = zones.read(ZONE_FILE)
    assert len(read) == 1327 and read["moe"].nunique() == 1291
    assert read.crs.to_epsg() == 2193
    west, south, east, north = read.total_bounds
    assert 1_060_000 < west < east < 2_090_000 and 4_700_000 < south < north < 6_160_000
    assert read.geometry.is_valid.all()
    mags = read[read["moe"] == 69]
    assert len(mags) == 1 and mags["effective"].iloc[0] == dt.date(2018, 6, 6)
    assert mags.geometry.iloc[0].area / 1e6 == pytest.approx(16.28, abs=0.01)
    record = zones.file_record(Settings(raw={"data": {"zones": str(ZONE_FILE)}}, config_path=REPO, data_root=DATA_ROOT,
                                        output_dir=REPO, cache_dir=REPO))
    assert record["file"] == "ESmaster v02102026" and record["version"] == "2026-10-02"
    assert record["sha256"].startswith("91b6afde")


def test_year_levels_parse_from_every_multi_zone_name():
    names = pd.read_csv(FIXTURES / "multi_zone_names.csv", keep_default_na=False)
    assert len(names) == 68  # 67 rows of schools with several polygons, and Rototuna Senior High's one
    for row in names.itertuples():
        expected = (int(row.years_from), int(row.years_to)) if row.years_from != "" else None
        assert zones.parse_years(row.name) == expected, row.name
    unparsed = names[names["years_from"] == ""]
    assert sorted(unparsed["moe"].unique()) == [212, 1572]  # Tolaga Bay Area School and Whenuapai School
    assert zones.parse_years("Rototuna Senior High School (Y11-13)") == (11, 13)
    assert zones.parse_years("Tolaga Bay Area School (Primary Zone)") is None
    assert zones.parse_years("Bayview School") is None and zones.parse_years("St Mary's School (Yaldhurst)") is None


@needs_file
def test_only_the_named_polygons_have_years_in_the_ministry_file():
    read = zones.read(ZONE_FILE)
    names = pd.read_csv(FIXTURES / "multi_zone_names.csv", keep_default_na=False)
    assert set(read.loc[read["years_from"].notna(), "polygon_id"]) == set(names.loc[names["years_from"] != "", "polygon_id"])


def test_a_year_zone_applies_from_the_schools_entry_year():
    square = box_zone(0, 0, 1000, 1000)
    rows = [
        (1219, 1219001, "Balmoral School (Auckland) Zone B (yrs 7-8)", dt.date(2008, 10, 1), square),
        (1219, 1219002, "Balmoral School (Auckland) Zone A (yrs 1-6)", dt.date(2008, 10, 1), square),
        (335, 335001, "Middleton Grange School (Year 1-8)", dt.date(2026, 1, 1), square),
        (335, 335002, "Middleton Grange School (Year 9-10)", dt.date(2026, 1, 1), square),
        (335, 335003, "Middleton Grange School (Year 11-13)", dt.date(2026, 1, 1), square),
        (615, 615, "Rototuna Senior High School (Y11-13)", dt.date(2017, 1, 1), square),
        (1572, 1572, "Whenuapai School", dt.date(2021, 2, 1), square),
        (1572, 1572002, "Whenuapai School (Temp Extension)", dt.date(2023, 7, 17), box_zone(1000, 0, 2000, 1000)),
    ]
    listed = pd.DataFrame([
        listed_row(1219, ["primary_school", "intermediate_school"], 1),           # Full Primary
        listed_row(335, ["primary_school", "intermediate_school", "secondary_school"], 1),  # Composite
        listed_row(615, ["secondary_school"], 11),                                # Secondary (Year 11-15)
        listed_row(1572, ["primary_school", "intermediate_school"], 1),
    ])
    status = zones.statuses(listed, zone_frame(rows), FIRST, years={}).set_index("moe")
    assert status.loc[1219, "polygons"] == {"primary_school": [1219002], "intermediate_school": [1219001]}
    assert status.loc[335, "polygons"]["secondary_school"] == [335002]   # Year 9-10, not 11-13
    assert status.loc[335, "polygons"]["intermediate_school"] == [335001]
    assert status.loc[615, "polygons"] == {"secondary_school": [615]}     # it starts at Year 11
    # Z3: polygons with no years apply to every service and are joined.
    assert status.loc[1572, "polygons"]["primary_school"] == [1572, 1572002]
    geoms = zones.zone_geometries(zone_frame(rows), status.reset_index(), "primary_school")
    assert geoms["moe:1572"].area == pytest.approx(2_000_000)


def test_a_school_with_some_unnamed_years_is_unclear_unless_checked():
    square = box_zone(0, 0, 1000, 1000)
    rows = [(212, 212001, "Tolaga Bay Area School (Primary Zone)", dt.date(2007, 3, 26), square),
            (212, 212002, "Tolaga Bay Area School (Year 9-15)", dt.date(2007, 3, 26), square)]
    listed = pd.DataFrame([listed_row(212, ["primary_school", "secondary_school"], 1)])
    unclear = zones.statuses(listed, zone_frame(rows), FIRST, years={}).iloc[0]
    assert unclear["status"] == "unclear_years" and unclear["status"] in zones.EVERYONE
    checked = zones.statuses(listed, zone_frame(rows), FIRST, years={212001: (1, 8)}).iloc[0]
    assert checked["status"] == "in_force"
    assert checked["polygons"] == {"primary_school": [212001], "secondary_school": [212002]}
    # A year-level map with no zone for the service's entry year: counted for everyone too.
    only = [(9, 9001, "School (Year 1-6)", dt.date(2020, 1, 1), square)]
    gap = zones.statuses(pd.DataFrame([listed_row(9, ["primary_school", "intermediate_school"], 1)]),
                         zone_frame(only), FIRST, years={}).iloc[0]
    assert gap["status"] == "unclear_years"


def test_zone_years_csv_holds_no_unchecked_rows():
    text = (REPO / "configs" / "schools" / "zone_years.csv").read_text().splitlines()
    assert text[0] == "polygon_id,years_from,years_to,source,checked_by,checked_on"
    assert zones.checked_years() == {}


def test_statuses_on_synthetic_dates():
    square = box_zone(0, 0, 10, 10)
    later = dt.date(2027, 1, 1)
    rows = [(1, 1, "In force", dt.date(2018, 6, 6), square), (1, 2, "Amended", later, square),
            (2, 2, "Only later", later, square), (4, 4, "Map, no scheme", dt.date(2016, 10, 10), square),
            (5, 5, "No scheme, later", later, square), (6, 6, "No date", None, square)]
    listed = pd.DataFrame([listed_row(1, ["secondary_school"], 9), listed_row(2, ["secondary_school"], 9),
                           listed_row(3, ["secondary_school"], 9), listed_row(4, ["primary_school"], 1, scheme=False),
                           listed_row(5, ["secondary_school"], 7, scheme=False), listed_row(6, ["secondary_school"], 9),
                           listed_row(7, ["secondary_school"], 9, scheme=False)])
    s = zones.statuses(listed, zone_frame(rows), FIRST, years={}).set_index("moe")
    assert (s.loc[1, "status"], s.loc[1, "from"], s.loc[1, "next_from"]) == ("in_force", "2018-06-06", "2027-01-01")
    assert s.loc[1, "polygons"] == {"secondary_school": [1]}          # the later one is listed, not applied
    assert (s.loc[2, "status"], s.loc[2, "from"]) == ("upcoming_used", "2027-01-01")
    assert s.loc[3, "status"] == "no_map"
    assert (s.loc[4, "status"], s.loc[4, "map_from"], s.loc[4, "polygons"]) == ("not_applied", "2016-10-10", {})
    assert (s.loc[5, "status"], s.loc[5, "next_from"]) == ("none", "2027-01-01")
    assert (s.loc[6, "status"], s.loc[6, "from"], bool(s.loc[6, "date_unknown"])) == ("in_force", None, True)
    assert s.loc[7, "status"] == "none"


@pytest.mark.skipif(not (ZONE_FILE.exists() and DIRECTORY.exists()), reason="needs the zone file and the directory")
def test_zone_status_on_the_reference_date(tmp_path):
    raw = yaml.safe_load((REPO / "configs" / "auckland.yml").read_text())
    raw["data"] = {"schools": str(DIRECTORY)}
    raw["schools"] = {}  # every region
    raw["services"] = {k: v for k, v in raw["services"].items() if v.get("school_types")}
    settings = Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)
    listed = schools.school_table(settings, folder=tmp_path / "none")
    status = zones.statuses(listed, zones.read(ZONE_FILE), zones.service_first_years(settings)).set_index("moe")
    assert zones.REFERENCE_DATE == dt.date(2026, 11, 12)
    assert (status.loc[69, "status"], status.loc[69, "from"]) == ("in_force", "2018-06-06")      # MAGS
    assert (status.loc[709, "status"], status.loc[709, "from"]) == ("upcoming_used", "2027-01-01")  # Ormiston Junior College
    assert (status.loc[58, "status"], status.loc[58, "from"]) == ("upcoming_used", "2027-01-01")    # Tangaroa College
    assert (status.loc[201, "status"], status.loc[201, "next_from"]) == ("none", "2027-01-01")      # Queen Elizabeth College
    assert (status.loc[2265, "status"], status.loc[2265, "map_from"]) == ("not_applied", "2016-10-10")  # West End
    assert status.loc[2844, "status"] == "no_map"                                                # Fraser Crescent
    assert (status.loc[1028, "status"], status.loc[1028, "from"]) == ("in_force", "2012-09-12")  # Totara Grove: approval date
    assert status.loc[113, "status"] == "in_force" and bool(status.loc[113, "date_unknown"])     # Paeroa College
    assert status.loc[113, "from"] is None
    # Balmoral's two zones split by service.
    assert status.loc[1219, "polygons"] == {"primary_school": [1219002], "intermediate_school": [1219001]}


# ---------------------------------------------------------------------------
# Residents inside a hexagon


def one_hexagon():
    import h3

    cell = h3.latlng_to_cell(-36.8847, 174.7253, 9)
    hexes = zones.hexagons([cell])
    return cell, hexes, zones.centres([cell])


def test_resident_shares_follow_address_points():
    import geopandas as gpd

    cell, hexes, centre = one_hexagon()
    x0, y0, x1, y1 = hexes.iloc[0].bounds
    # The zone holds most of the hexagon's area but only 7 of its 10 equal points.
    zone = box_zone(x0 - 10, y0 - 10, x0 + 0.8 * (x1 - x0), y1 + 10)
    xs = np.r_[np.linspace(x0 + 0.3 * (x1 - x0), x0 + 0.7 * (x1 - x0), 7), np.full(3, x0 + 0.9 * (x1 - x0))]
    ys = np.full(10, (y0 + y1) / 2)
    points = pd.DataFrame({"cell": 0, "x": xs, "y": ys, "w": 1.0, "source": "address"})
    cover = zones.area_cover(hexes, {"moe:1": zone})
    assert 0.7 < cover["share"].iloc[0] < 1
    shares, sets, split = zones.resident_shares(cover, points, {"moe:1": zone}, centre, 1)
    assert shares.set_index("school").loc["moe:1", "w"] == pytest.approx(0.7)
    assert sets[0] == ("moe:1",) and split == {0}
    # Weights count, not the number of points: three heavy points outside win.
    heavy = points.assign(w=np.r_[np.ones(7), np.full(3, 10.0)])
    shares, sets, _ = zones.resident_shares(cover, heavy, {"moe:1": zone}, centre, 1)
    assert shares["w"].iloc[0] == pytest.approx(7 / 37) and sets[0] == ()
    # No address point: the hexagon's land pieces spread their people by area.
    pieces = gpd.GeoDataFrame({"h3": [cell], "sa1": ["1"], "people": [100.0]}, geometry=[hexes.iloc[0]], crs="EPSG:2193")
    empty = pd.DataFrame(columns=["x", "y", "sa1", "w"])
    sampled = zones.resident_points(empty, pieces, [cell], {0}, hexes)
    assert (sampled["source"] == "area").all() and sampled["w"].sum() == pytest.approx(100.0)
    shares, _, _ = zones.resident_shares(cover, sampled, {"moe:1": zone}, centre, 1)
    assert shares["w"].iloc[0] == pytest.approx(cover["share"].iloc[0], abs=0.01)
    # A block with residents and no address point is spread by area alongside the points.
    blocks = pd.DataFrame({"x": xs, "y": ys, "sa1": "2", "w": 1.0})
    mixed = zones.resident_points(blocks, pieces, [cell], {0}, hexes)
    assert mixed.groupby("source")["w"].sum().to_dict() == pytest.approx({"address": 10.0, "area": 100.0})


def test_address_points_share_their_blocks_residents():
    import geopandas as gpd

    blocks = gpd.GeoDataFrame({"sa1": ["a", "b"], "population": [30.0, 0.0]},
                              geometry=[box_zone(0, 0, 10, 10), box_zone(10, 0, 20, 10)], crs="EPSG:2193")
    points = pd.DataFrame({"x": [1, 2, 3, 15, 50], "y": [1, 1, 1, 1, 1]})
    weighted = zones.address_weights(points, blocks)
    assert weighted["w"].tolist() == [10.0, 10.0, 10.0, 0.0, 0.0]


def test_the_majority_set_wins_and_ties_go_to_the_centre():
    cell, hexes, centre = one_hexagon()
    x0, y0, x1, y1 = hexes.iloc[0].bounds
    cx, cy = centre[0]
    west = box_zone(x0 - 10, y0 - 10, cx - 1, y1 + 10)
    east = box_zone(cx + 1, y0 - 10, x1 + 10, y1 + 10)
    whole = box_zone(x0 - 50, y0 - 50, x1 + 50, y1 + 50)
    geoms = {"moe:10": west, "moe:20": east, "moe:30": whole}
    cover = zones.area_cover(hexes, geoms)
    assert cover.set_index("school").loc["moe:30", "share"] >= zones.FULL
    pts = pd.DataFrame({"cell": 0, "x": [cx - 100, cx - 90, cx + 100], "y": cy, "w": [1.0, 1.0, 1.5], "source": "address"})
    in_set: dict = {}
    shares, sets, split = zones.resident_shares(cover, pts, geoms, centre, 1, held_by_set=in_set)
    assert sets[0] == ("moe:10", "moe:30") and split == {0}      # 2.0 against 1.5
    assert in_set == {0: pytest.approx(2 / 3.5)}                 # 1.5 of 3.5 live outside the set counted
    by = shares.set_index("school")["w"]
    assert by["moe:10"] == pytest.approx(2 / 3.5) and by["moe:20"] == pytest.approx(1.5 / 3.5) and by["moe:30"] == 1.0
    # Equal weights: the set holding the hexagon's centre.
    middle = box_zone(cx - 30, y0 - 10, cx + 30, y1 + 10)
    geoms = {"moe:10": west, "moe:40": middle}
    cover = zones.area_cover(hexes, geoms)
    pts = pd.DataFrame({"cell": 0, "x": [cx - 100, cx + 10], "y": cy, "w": [1.0, 1.0], "source": "address"})
    _, sets, _ = zones.resident_shares(cover, pts, geoms, centre, 1)
    assert sets[0] == ("moe:40",)
    # Equal weights, centre in neither: the smaller set, then the lower list.
    geoms = {"moe:10": west, "moe:20": east}
    cover = zones.area_cover(hexes, geoms)
    pts = pd.DataFrame({"cell": 0, "x": [cx - 100, cx + 100, cx + 101], "y": [cy, cy, cy], "w": [2.0, 1.0, 1.0], "source": "address"})
    _, sets, _ = zones.resident_shares(cover, pts, geoms, centre, 1)
    assert sets[0] == ("moe:10",)


def test_only_the_zones_in_zone_counts_decide_the_set():
    """An integrated school's zone has its share kept for One school, but it
    does not split the residents when the hexagon's set is chosen."""
    cell, hexes, centre = one_hexagon()
    x0, y0, x1, y1 = hexes.iloc[0].bounds
    cx, cy = centre[0]
    state = box_zone(x0 - 10, y0 - 10, cx, y1 + 10)          # west half
    integrated = box_zone(x0 - 10, y0 - 10, cx - 50, y1 + 10)
    geoms = {"moe:1": state, "moe:2": integrated}
    cover = zones.area_cover(hexes, geoms)
    pts = pd.DataFrame({"cell": 0, "x": [cx - 100, cx - 20, cx + 100], "y": cy, "w": [3.0, 2.5, 4.0], "source": "address"})
    # Over every zone the largest set is "neither" (4.0); over the state school's zone alone it is {moe:1} (5.5).
    _, every, _ = zones.resident_shares(cover, pts, geoms, centre, 1)
    shares, counted, split = zones.resident_shares(cover, pts, geoms, centre, 1, {"moe:1"})
    assert every[0] == () and counted[0] == ("moe:1",) and split == {0}
    by = shares.set_index("school")["w"]
    assert by["moe:1"] == pytest.approx(5.5 / 9.5) and by["moe:2"] == pytest.approx(3 / 9.5)


def test_in_zone_counts_zoned_schools_by_cell_and_open_schools_everywhere():
    dests = [
        {"moe": 69, "services": ["secondary_school"], "kind": "state", "medium": "english", "sex": {"secondary_school": "co-ed"}},
        {"moe": 70, "services": ["secondary_school"], "kind": "integrated", "medium": "english", "sex": {"secondary_school": "girls"}},
        {"moe": 50, "services": ["secondary_school"], "kind": "state", "medium": "english", "sex": {"secondary_school": "co-ed"}},
        {"moe": 53, "services": ["secondary_school"], "kind": "state", "medium": "english", "sex": {"secondary_school": "girls"}},
    ]
    payload = {"schools": {"0": {"status": "in_force"}, "1": {"status": "none"}, "2": {"status": "none"},
                           "3": {"status": "in_force"}},
               "in": {"secondary_school": {"o": [0, 2, 2], "d": [0, 3]}}}
    # Cell 0 is in MAGS's and AGGS's zones; cell 1 in neither. The integrated school never counts.
    reach = {"o": [0, 3, 6], "d": [1, 3, 2, 0, 1, 2], "m": [2, 5, 20, 4, 6, 25]}
    girls = schools.choice_times({"pt": reach}, dests, "secondary_school", "zone", "girls", ["pt"], payload)
    boys = schools.choice_times({"pt": reach}, dests, "secondary_school", "zone", "boys", ["pt"], payload)
    both = schools.choice_times({"pt": reach}, dests, "secondary_school", "zone", "both", ["pt"], payload)
    assert girls["pt"].tolist() == [5, 25] and boys["pt"].tolist() == [20, 25] and both["pt"].tolist() == [20, 25]
    assert schools.choice_named({"pt": reach}, dests, "secondary_school", "zone", "girls", 0, payload)["pt"] == [53]
    assert schools.choice_named({"pt": reach}, dests, "secondary_school", "zone", "both", 1, payload)["pt"] == [50]
    with pytest.raises(ValueError):
        schools.published_counts(dests, "secondary_school", "zone", None)


# ---------------------------------------------------------------------------
# The built files


def load(place: str, name: str):
    return json.loads((SITE / place / name).read_text(encoding="utf-8"))


def hexagon_zones(place: str, h3: str, service: str) -> tuple[set[int], dict[int, float], bool]:
    """The In zone set (MoE numbers), the zone shares and whether the hexagon is split."""
    cells, dests, z = load(place, "cells.json"), load(place, "destinations.json"), load(place, "schools/zones.json")
    i = cells["h3"].index(h3)
    block, share = z["in"][service], z["share"][service]
    members = {dests[d]["moe"] for d in block["d"][block["o"][i]:block["o"][i + 1]]}
    shares = {dests[d]["moe"]: w for d, w in zip(share["d"][share["o"][i]:share["o"][i + 1]], share["w"][share["o"][i]:share["o"][i + 1]])}
    return members, shares, i in set(z["split"][service])


NAMED = json.loads((FIXTURES / "named_hexagons.json").read_text()) if (FIXTURES / "named_hexagons.json").exists() else {}


@needs_site
def test_named_hexagons():
    s_set, s_share, _ = hexagon_zones("auckland", "89bb50021a3ffff", "secondary_school")
    assert 69 in s_set and s_share[69] == 1.0
    i_set, i_share, _ = hexagon_zones("auckland", "89bb50021a3ffff", "intermediate_school")
    p_set, p_share, _ = hexagon_zones("auckland", "89bb50021a3ffff", "primary_school")
    assert 1337 in i_set and 0 < i_share[1219] < 1 and 1219 not in p_share
    i_set, _, _ = hexagon_zones("auckland", "89bb5002183ffff", "intermediate_school")
    p_set, p_share, _ = hexagon_zones("auckland", "89bb5002183ffff", "primary_school")
    assert 1219 in i_set and 1219 not in p_set and 1219 not in p_share
    w_set, w_share, _ = hexagon_zones("wellington", "89bb2955a3bffff", "secondary_school")
    assert {273, 275} <= w_set and 0 < w_share[272] < 1 and 0 < w_share[274] < 1
    w_set, _, _ = hexagon_zones("wellington", "89bb295594fffff", "secondary_school")
    assert {272, 273, 275} <= w_set
    _, b_share, b_split = hexagon_zones("blenheim", "89bb29ba323ffff", "primary_school")
    assert b_share[2811] > 0 and b_share[3071] > 0 and b_share[2811] + b_share[3071] == pytest.approx(1, abs=0.01)
    assert b_split
    # The values recorded when the files were built (tests/fixtures/zones/named_hexagons.json).
    for key, expected in NAMED.get("hexagons", {}).items():
        place, h3, service = key.split("/")
        got_set, got_share, got_split = hexagon_zones(place, h3, service)
        assert sorted(got_set) == expected["set"], key
        assert {str(k): v for k, v in got_share.items()} == pytest.approx(expected["share"], abs=0.0015), key
        assert got_split == expected["split"], key


@needs_site
def test_mags_zone_people():
    cells, dests, z = load("auckland", "cells.json"), load("auckland", "destinations.json"), load("auckland", "schools/zones.json")
    d = next(i for i, x in enumerate(dests) if x.get("moe") == 69)
    assert z["schools"][str(d)]["status"] == "in_force" and z["schools"][str(d)]["from"] == "2018-06-06"
    w = schools.zone_share(z, "secondary_school", d, len(cells["h3"]))
    pop = np.array([p or 0 for p in cells["pop"]], dtype=float)
    kids = np.array([k or 0 for k in cells["ages"]["13_17"]], dtype=float)
    residents, children = float((pop * w).sum()), float((kids * w).sum())
    assert 59_000 <= residents <= 65_000 and 2_800 <= children <= 4_800
    if "mags" in NAMED:
        assert residents == pytest.approx(NAMED["mags"]["residents"], abs=50)
        assert children == pytest.approx(NAMED["mags"]["children_13_17"], abs=5)


@needs_site
@pytest.mark.parametrize("place", sorted(p.stem for p in (REPO / "configs").glob("*.yml")))
def test_zone_files_agree_with_each_other(place):
    """Offsets cover every cell; every In zone school is zoned, state and
    English-medium, with its zone holding residents of the cell; shares are
    in (0, 1]; meta counts match the statuses."""
    if not (SITE / place / "schools" / "zones.json").exists():
        pytest.skip(f"{place}: no zones.json")
    cells, dests, z = load(place, "cells.json"), load(place, "destinations.json"), load(place, "schools/zones.json")
    meta = load(place, "summary.json")["meta"]["schools"]
    n = len(cells["h3"])
    assert z["format"] == zones.FORMAT and z["reference_date"] == "2026-11-12"
    assert meta["choices"] == ["all", "state", "zone", "one"] and meta["zones"]["reference_date"] == "2026-11-12"
    for service, block in z["in"].items():
        share = z["share"][service]
        assert len(block["o"]) == n + 1 and len(share["o"]) == n + 1 and len(share["d"]) == len(share["w"])
        assert all(0 < w <= 1 for w in share["w"])
        for i in range(n):
            members = block["d"][block["o"][i]:block["o"][i + 1]]
            held = dict(zip(share["d"][share["o"][i]:share["o"][i + 1]], share["w"][share["o"][i]:share["o"][i + 1]]))
            for d in members:
                status = z["schools"][str(d)]["status"]
                assert status in zones.ZONED and dests[d]["kind"] == "state" and dests[d]["medium"] == "english"
                assert held.get(d, 0) > 0
                assert service in z["schools"][str(d)]["polygons"]
        counts = meta["zones"]["counts"][service]
        assert counts["zoned"] + counts["no_map"] + counts["none"] + counts["not_applied"] + counts["unclear_years"] == counts["state_english"]
    for d, entry in z["schools"].items():
        assert dests[int(d)]["moe"] == entry["moe"] and dests[int(d)]["zone"]["status"] == entry["status"]
