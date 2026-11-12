"""Schools: the directory, the choices, the councillors' MAGS case, and the
routing behind them. Fixtures in tests/fixtures/schools come from the real
Auckland build (tests/fixtures/make_school_fixtures.py)."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import random
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from team import config, export, measures, routing, schools
from team.config import Settings

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "tests" / "fixtures" / "schools"
DATA_ROOT = Path(os.environ.get("TEAM_DATA_ROOT", REPO.parent))
SNAPSHOT = DATA_ROOT / "raw" / "nz" / "education" / "moe_schools_directory_2026-11-12.csv"
SLIDE = "89bb50021a3ffff"
MAGS, MARIST, TKKM = "moe:69", "moe:70", "moe:4207"


def school_settings(tmp_path: Path, directory: Path, intermediate_types: list[str] | None = None) -> Settings:
    """Auckland's school services, reading `directory`."""
    raw = yaml.safe_load((REPO / "configs" / "auckland.yml").read_text())
    raw["data"] = {"schools": str(directory)}
    raw["schools"] = {"regions": ["Auckland Region"]}
    raw["services"] = {k: v for k, v in raw["services"].items() if v.get("school_types")}
    if intermediate_types is not None:
        raw["services"]["intermediate_school"]["school_types"] = intermediate_types
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path / "out", cache_dir=tmp_path / "cache")


# ---------------------------------------------------------------------------
# The directory


def sample_table(tmp_path: Path) -> pd.DataFrame:
    settings = school_settings(tmp_path, FIXTURES / "directory_sample.csv")
    return schools.school_table(settings, folder=tmp_path / "none").set_index("moe")


def test_school_attributes_come_from_the_directory(tmp_path):
    table = sample_table(tmp_path)
    marist, mags, tkkm, kings = table.loc[70], table.loc[69], table.loc[4207], table.loc[89]
    assert (marist["kind"], marist["sex_secondary_school"], marist["sex_intermediate_school"], marist["scheme"]) == (
        "integrated", "girls", "girls", False)
    assert (mags["kind"], mags["medium"], mags["sex_secondary_school"], mags["scheme"]) == ("state", "english", "co-ed", True)
    assert mags["roll"] == 3635 and mags["roll_date"] == "2026-10-01" and (mags["years_from"], mags["years_to"]) == (9, 15)
    assert (tkkm["kind"], tkkm["medium"], tkkm["language"]) == ("state", "other", "maori")
    # King's College takes girls only from Year 12: a boys' school for a student starting secondary.
    assert (kings["kind"], kings["sex_secondary_school"]) == ("private", "boys")
    # A full primary that takes boys only to Year 6 is a girls' school for Years 7 and 8.
    christ_the_king = table.loc[1245]
    assert (christ_the_king["sex_primary_school"], christ_the_king["sex_intermediate_school"]) == ("co-ed", "girls")
    assert christ_the_king["services"] == "primary_school,intermediate_school"


def test_teaching_language_and_sex_not_given_are_left_unknown(tmp_path):
    table = sample_table(tmp_path)
    # Opened in October 2026 with no teaching language listed yet.
    assert pd.isna(table.loc[4575, "medium"])
    # Newly registered, no co-ed status listed.
    assert table.loc[4592, "sex_secondary_school"] is None
    assert not schools.eligible(table.reset_index(), "primary_school", "state").to_numpy()[list(table.index).index(4575)]


def test_proposed_schools_are_not_counted(tmp_path):
    table = sample_table(tmp_path)
    assert 723 not in table.index  # Te Pae School, proposed for 2027


def test_year_7_to_10_schools_count_for_intermediate_only(tmp_path):
    table = sample_table(tmp_path)
    assert table.loc[876, "services"] == "intermediate_school"  # Restricted Composite (Year 7-10)
    assert table.loc[553, "services"] == "intermediate_school"  # Secondary (Year 7-10)


def test_every_school_type_is_counted_or_excluded_on_purpose(tmp_path):
    directory = schools.read_directory(FIXTURES / "directory_sample.csv")
    old = ["Intermediate", "Full Primary", "Secondary (Year 7-15)", "Composite", "Composite (Year 1-10)", "Restricted Composite (Yr 7-10)"]
    assert schools.unknown_types(school_settings(tmp_path, FIXTURES / "directory_sample.csv", old), directory) == [
        "Restricted Composite (Year 7-10)", "Secondary (Year 7-10)"]
    assert schools.unknown_types(school_settings(tmp_path, FIXTURES / "directory_sample.csv"), directory) == []


@pytest.mark.skipif(not SNAPSHOT.exists(), reason="needs the directory snapshot in the data root")
@pytest.mark.parametrize("place", sorted(p.stem for p in (REPO / "configs").glob("*.yml")))
def test_every_place_counts_or_excludes_every_type_in_its_directory(place):
    settings = config.load(REPO / "configs" / f"{place}.yml", DATA_ROOT, Path(os.environ.get("TMPDIR", "/tmp")) / "team-test-out")
    assert "Yr 7-10" not in json.dumps(settings.services)
    assert schools.unknown_types(settings, schools.place_directory(settings)) == []


@pytest.mark.skipif(not SNAPSHOT.exists(), reason="needs the directory snapshot in the data root")
def test_the_snapshot_metadata_matches_the_file():
    meta = schools.snapshot_meta(SNAPSHOT)
    table = schools.read_directory(SNAPSHOT)
    assert meta["record_count"] == len(table) == 2578
    assert meta["sha256"] == hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()
    assert meta["retrieved"].startswith("2026-11-12")
    assert meta["roll_dates"] == table["Roll_Date"].str[:10].replace("", "none").value_counts().to_dict()
    assert meta["field_count"] == len(table.columns)


# ---------------------------------------------------------------------------
# The councillors' case: St Lukes, next to Mt Albert Grammar School


def mags_case(shuffle: int | None = None):
    import geopandas as gpd

    case = json.loads((FIXTURES / "mags_case.json").read_text())
    listed = pd.DataFrame(case["schools"])
    xy = gpd.GeoSeries(gpd.points_from_xy(listed["lon"], listed["lat"]), crs=4326).to_crs(2193)
    listed["x"], listed["y"] = xy.x.to_numpy(), xy.y.to_numpy()
    origins = pd.Index(case["cells"])
    origin_xy = np.array([case["centres"][c] for c in origins])
    reach = {}
    for mode, rows in case["pairs"].items():
        frame = pd.DataFrame(rows, columns=case["columns"][mode])
        frame["service"] = "secondary_school"
        if shuffle is not None:
            frame = frame.sample(frac=1.0, random_state=shuffle).reset_index(drop=True)
        reach[mode] = schools.ordered_reach(frame, origins, origin_xy, listed)
    return case, listed, origins, reach


def nearest(reach, origins, keep=None):
    frame = reach if keep is None else reach[reach["destination"].isin(keep)]
    minutes, names, ties = schools.nearest_schools(frame, len(origins))
    i = list(origins).index(SLIDE)
    return int(minutes[i]), names[i], ties.get(i, [])


def test_the_slide_figure_is_a_walk_to_the_kura_and_the_name_came_from_cycling():
    case, listed, origins, reach = mags_case()
    assert nearest(reach["pt"], origins)[:2] == (9, TKKM)
    assert nearest(reach["walk"], origins)[:2] == (9, TKKM)  # the same minutes on foot: no bus is quicker
    # "Marist College" on the slide was the nearest by low-stress cycling.
    assert nearest(reach["bike_low_stress"], origins)[:2] == (6, MARIST)


def test_marist_and_mags_from_the_slide_hexagon():
    case, listed, origins, reach = mags_case()
    assert nearest(reach["pt"], origins, {MARIST})[0] == 12
    assert nearest(reach["walk"], origins, {MARIST})[0] == 12
    one = {m: nearest(reach[m], origins, {MAGS})[0] for m in ("walk", "bike_low_stress", "pt")}
    assert one == {"walk": 15, "bike_low_stress": 10, "pt": 15}


def test_state_schools_for_girls_and_boys_from_the_slide_hexagon():
    case, listed, origins, reach = mags_case()
    for student in ("girls", "boys"):
        keep = set(listed.loc[schools.eligible(listed.assign(**{"sex_secondary_school": listed["sex_secondary_school"]}),
                                               "secondary_school", "state", student), "school"])
        assert nearest(reach["pt"], origins, keep)[:2] == (15, MAGS)
        assert nearest(reach["walk"], origins, keep)[:2] == (15, MAGS)
        assert nearest(reach["bike_low_stress"], origins, keep)[:2] == (10, MAGS)


def test_ties_are_broken_the_same_way_whatever_order_r5_returns_rows():
    _, _, origins, first = mags_case()
    for seed in (1, 2, 3):
        _, _, _, again = mags_case(shuffle=seed)
        for mode in first:
            a = first[mode][["cell", "destination", "minutes"]].reset_index(drop=True)
            b = again[mode][["cell", "destination", "minutes"]].reset_index(drop=True)
            pd.testing.assert_frame_equal(a, b)
    # By bike on any street, the kura and Marist are both 5 minutes; the nearer in a straight line is named.
    minutes, name, tied = nearest(first["bike"], origins)
    assert (minutes, name, tied) == (5, TKKM, [MARIST])


def test_reach_lists_hold_every_school_within_the_limit_with_its_spread():
    case, listed, origins, reach = mags_case()
    pt = reach["pt"]
    assert pt["minutes"].max() <= 60
    assert ((pt["lo"] <= pt["minutes"]) & ((pt["hi"] >= pt["minutes"]) | (pt["hi"] == 255))).all()
    row = pt[(pt["cell"] == list(origins).index(SLIDE)) & (pt["destination"] == MAGS)].iloc[0]
    assert (row["minutes"], row["lo"], row["hi"]) == (15, 15, 15)  # on foot at every departure


# ---------------------------------------------------------------------------
# The five trips checked by hand against the timetable


def hand_trips():
    return json.loads((FIXTURES / "hand_trips.json").read_text())["trips"]


def r5_percentile(minutes: list[int | None], p: int) -> int:
    """R5's percentile of a trip over its departure minutes: the value at
    position ceil(p% of n) in the sorted times, counting from one."""
    values = np.sort(np.array([np.inf if m is None else m for m in minutes], dtype=float))
    return int(values[int(np.ceil(len(values) * p / 100)) - 1])


def test_hand_checked_trips_give_the_medians_in_the_audit():
    trips = hand_trips()
    assert [len(t["minutes"]) for t in trips] == [120] * 5
    assert [r5_percentile(t["minutes"], 50) for t in trips] == [16, 32, 41, 24, 24]


AUCKLAND_CACHE = Path.home() / ".cache" / "team" / "auckland" / "pairs" / "schools_am_peak_pt"


@pytest.mark.skipif(not AUCKLAND_CACHE.exists(), reason="needs Auckland's school run in the cache")
def test_the_school_run_gives_the_hand_checked_trips():
    trips = hand_trips()
    wanted = {(t["h3"], t["school"]) for t in trips}
    frames = [pd.read_parquet(f) for f in sorted(AUCKLAND_CACHE.glob("origins_*[0-9].parquet"))]
    pairs = pd.concat(frames, ignore_index=True)
    pairs = pairs[pairs["service"] == "secondary_school"]
    pairs = pairs[[(o, d) in wanted for o, d in zip(pairs["origin"], pairs["destination"])]].set_index(["origin", "destination"])
    for trip in trips:
        row = pairs.loc[(trip["h3"], trip["school"])]
        assert int(row["minutes"]) == r5_percentile(trip["minutes"], 50)
        assert int(row["lo"]) == r5_percentile(trip["minutes"], 10)
        assert int(row["hi"]) == r5_percentile(trip["minutes"], 90)


@pytest.mark.skipif(os.environ.get("TEAM_SLOW") != "1", reason="routes with r5py; set TEAM_SLOW=1")
def test_r5_routes_the_hand_checked_trips_again_minute_by_minute():
    import geopandas as gpd

    settings = config.load(REPO / "configs" / "auckland.yml", DATA_ROOT, Path(os.environ.get("TEAM_SLOW_OUT", "/tmp/team-slow")))
    routing.prepare_java(settings)
    import r5py

    trips = hand_trips()
    origins = routing.load_origins(settings).set_index("id")
    directory = schools.read_directory(SNAPSHOT).set_index("School_Id")
    ids = [f"{t['h3']}>{t['school']}" for t in trips]
    # r5py gives 0 minutes where an origin and a destination share an id, so they differ.
    orig = gpd.GeoDataFrame({"id": [f"o|{i}" for i in ids]}, geometry=[origins.loc[t["h3"], "geometry"] for t in trips], crs=4326)
    dest = gpd.GeoDataFrame({"id": [f"d|{i}" for i in ids]}, geometry=gpd.points_from_xy(
        [float(directory.loc[t["school"].split(":")[1], "Longitude"]) for t in trips],
        [float(directory.loc[t["school"].split(":")[1], "Latitude"]) for t in trips]), crs=4326)
    gtfs, _ = routing.prepare_gtfs(settings)
    network = routing._network(r5py, settings, settings.modes["pt"], gtfs)
    kwargs = routing._mode_kwargs(r5py, settings.modes["pt"], settings.routing)
    matched = 0
    for k in range(120):
        t0 = dt.datetime(2026, 9, 15, 7, 0) + dt.timedelta(minutes=k)
        m = pd.DataFrame(r5py.TravelTimeMatrix(network, origins=orig, destinations=dest, departure=t0,
                                               departure_time_window=dt.timedelta(minutes=1), percentiles=[50],
                                               max_time=dt.timedelta(minutes=60), snap_to_network=True, **kwargs))
        m = m[m["from_id"].str[2:] == m["to_id"].str[2:]]
        m = m.set_index(m["from_id"].str[2:])["travel_time"]
        for trip, key in zip(trips, ids):
            matched += int(m.get(key) == trip["minutes"][k])
    assert matched == 600


# ---------------------------------------------------------------------------
# Routing: entrances, the limit, and moving to separate school runs


def write_csv(folder: Path, name: str, text: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(text, encoding="utf-8")


def test_only_checked_entrances_are_used_and_the_fastest_counts(tmp_path):
    hand = tmp_path / "hand"
    write_csv(hand, "entrances.csv", "# note\nmoe,name,entrance,lon,lat,hours,source,checked_by,checked_on,notes\n"
              "69,MAGS,Alberton Ave,174.7250,-36.8840,7:30-9:00,school,T Welch,2026-11-12,\n"
              "69,MAGS,Willcott St,174.7240,-36.8850,7:30-9:00,school,T Welch,2026-11-12,\n"
              "69,MAGS,Back gate,174.7260,-36.8860,,osm,,,not checked\n")
    write_csv(hand, "points.csv", "moe,name,lon,lat,source,reason,checked_by,checked_on\n")
    table = pd.DataFrame([{"school": MAGS, "moe": 69, "name": "Mt Albert Grammar School", "roll": 3635.0, "lon": 174.725349,
                           "lat": -36.884707, "point": "directory", "services": "secondary_school"}])
    points = schools.routing_points(table, folder=hand)
    assert points["id"].tolist() == ["moe:69/e1", "moe:69/e2"]
    matrix = pd.DataFrame({
        "from_id": ["a", "a", "b", "b"], "to_id": ["moe:69/e1", "moe:69/e2", "moe:69/e1", "moe:69/e2"],
        "travel_time_p10": [9.0, 7.0, 20.0, 18.0], "travel_time_p50": [12.0, 10.0, 61.0, 62.0], "travel_time_p90": [15.0, 14.0, np.nan, np.nan]})
    out = schools.collapse(matrix, points, 60).set_index("origin")
    assert (out.loc["a", "minutes"], out.loc["a", "lo"], out.loc["a", "hi"]) == (10, 7, 14)
    assert "b" not in out.index  # past the 60-minute limit


def test_the_repo_entrance_candidates_for_mags_are_not_used_until_checked():
    # MAGS's map point sits inside a 19.5 ha site; the candidates on its east
    # side are listed for a person to confirm with the school, and change
    # nothing until checked_by and checked_on are filled.
    import csv
    path = schools.REPO_CONFIGS / "entrances.csv"
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(line for line in handle if not line.lstrip().startswith("#")))
    mags = [r for r in rows if r["moe"] == "69"]
    assert len(mags) == 3
    for row in rows:
        assert row["source"].strip(), row
        assert 166 < float(row["lon"]) < 179 and -48 < float(row["lat"]) < -34, row
        assert bool(row["checked_by"].strip()) == bool(row["checked_on"].strip()), "checked_by and checked_on go together"
    assert 69 not in schools.checked_entrances()
    table = pd.DataFrame([{"school": MAGS, "moe": 69, "name": "Mt Albert Grammar School", "roll": 3635.0, "lon": 174.725349,
                           "lat": -36.884707, "point": "directory", "services": "secondary_school"}])
    points = schools.routing_points(table)
    assert points[["id", "point"]].values.tolist() == [[MAGS, "directory"]]


def test_with_no_entrances_a_school_is_routed_to_its_map_point(tmp_path):
    table = pd.DataFrame([{"school": MAGS, "moe": 69, "name": "MAGS", "roll": 3635.0, "lon": 174.725349, "lat": -36.884707,
                           "point": "directory", "services": "secondary_school"}])
    points = schools.routing_points(table, folder=tmp_path / "empty")
    assert points[["id", "lon", "lat", "point"]].values.tolist() == [[MAGS, 174.725349, -36.884707, "directory"]]


def test_published_times_stop_at_the_routing_limit(tmp_path):
    raw = {"routing": {"date": "2026-09-15", "windows": {"am_peak": {"start": "07:00", "minutes": 120}},
                       "modes": {"walk": {"kind": "walk"}}, "max_minutes": 60},
           "standard_modes": ["walk"], "services": {"gp": {"label": "GP", "window": "am_peak", "standard_minutes": 20}}}
    settings = Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path / "cache")
    (tmp_path / "routing").mkdir()
    pd.DataFrame([{"origin": o, "service": "gp", "minutes": m, "nearest_id": "1", "n10": 0, "n15": 0, "n20": 0, "n30": 0}
                  for o, m in (("a", 60.0), ("b", 61.0), ("c", 74.0))]).to_parquet(tmp_path / "routing" / "services_walk.parquet")
    table = measures.service_table(settings, pd.Index(["a", "b", "c"]))
    assert table["t_gp_walk"].tolist()[0] == 60.0 and table["t_gp_walk"].isna().tolist() == [False, True, True]
    assert table["id_gp_walk"].isna().tolist() == [False, True, True]


def test_split_adopts_only_services_runs_routed_against_the_old_table(tmp_path):
    settings = school_settings(tmp_path, FIXTURES / "directory_sample.csv")
    settings.raw["services"]["gp"] = {"label": "GP", "window": "am_peak", "standard_minutes": 20}
    settings.raw["routing"]["modes"] = {"walk": {"kind": "walk"}}
    settings.raw["jobs"]["modes"] = ["walk"]
    settings.raw.pop("chains", None)
    folder = settings.out("destinations", "services.parquet").parent
    old = pd.DataFrame({"id": ["0", "1", "2"], "source_id": ["hpi:1", "moe:69", "hpi:2"], "service": ["gp", "secondary_school", "gp"],
                        "name": ["a", "b", "c"], "lon": [174.7, 174.72, 174.8], "lat": [-36.8, -36.88, -36.9], "weight": 1.0})
    old.to_parquet(folder / "services.parquet", index=False)
    manifest = settings.out("routing", "services_walk.json")
    manifest.write_text(json.dumps({"members": routing.members_digest(old)}))
    report = schools.split(settings)
    assert report["adopted"] == ["services_walk"]
    new = pd.read_parquet(folder / "services.parquet")
    assert new["id"].tolist() == ["0", "2"]
    assert json.loads(manifest.read_text())["members_without_schools"] == routing.members_digest(new)
    # A run routed against something else is not adopted.
    manifest.write_text(json.dumps({"members": "something else"}))
    assert schools.split(settings)["not_adopted"] == ["services_walk"]


def test_destination_ids_stay_the_same_when_others_come_and_go(tmp_path):
    from team.destinations import stable_ids

    previous = tmp_path / "services.parquet"
    pd.DataFrame({"source_id": ["osm:1", "moe:5", "ece:9"], "id": ["0", "1", "2"]}).to_parquet(previous)
    table = pd.DataFrame({"source_id": ["osm:1", "ece:9", "ece:10"]})
    assert stable_ids(table, previous).tolist() == ["0", "2", "3"]


# ---------------------------------------------------------------------------
# Zones (synthetic, until the Ministry's file is in)


def zone_fixture(tmp_path: Path):
    import geopandas as gpd
    import h3
    from shapely.geometry import Polygon, box

    centre = h3.latlng_to_cell(-36.8847, 174.7253, 9)
    cells = pd.Index([centre, *[c for c in h3.grid_ring(centre, 1)]])
    hexes = gpd.GeoSeries([Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells], crs=4326).to_crs(2193)
    x0, y0, x1, y1 = hexes.iloc[0].bounds
    # Zone A covers the centre hexagon and the left half of the map; Zone B is for Years 7-8 only;
    # Zone C does not take effect until 2027.
    a = box(x0 - 2000, y0 - 2000, (x0 + x1) / 2 + 400, y1 + 2000)
    zones = gpd.GeoDataFrame({
        "School_ID": [69, 1300, 1301],
        "School_name": ["Mt Albert Grammar School", "Balmoral School (Year 7-8)", "Tangaroa College"],
        "Approval_date": ["2019-06-01", "2020-01-01", "2026-08-01"],
        "Effective_date": ["2020-01-01", "2021-01-01", "2027-01-01"],
    }, geometry=[a, box(x0 - 50, y0 - 50, x1 + 50, y1 + 50), box(x0 - 50, y0 - 50, x1 + 50, y1 + 50)], crs=2193)
    path = tmp_path / "zones.gpkg"
    zones.to_file(path, driver="GPKG")
    return path, cells


def test_zones_in_effect_on_the_snapshot_date_and_year_levels(tmp_path):
    path, cells = zone_fixture(tmp_path)
    current, later = schools.read_zones(path, dt.date(2026, 11, 12))
    assert sorted(current["moe"].tolist()) == [69, 1300] and later["moe"].tolist() == [1301]
    assert current.set_index("moe").loc[1300, ["years_from", "years_to"]].tolist() == [7, 8]
    assert pd.isna(current.set_index("moe").loc[69, "years_from"])


def test_a_hexagon_is_in_a_zone_when_the_zone_covers_half_of_it(tmp_path):
    path, cells = zone_fixture(tmp_path)
    current, _ = schools.read_zones(path, dt.date(2026, 11, 12))
    cover = schools.zone_cover(current, cells)
    mags = cover[cover["zone"] == current.index[current["moe"] == 69][0]].set_index("cell")
    assert mags.loc[0, "inside"] and mags.loc[0, "share"] > 0.5 and not mags.loc[0, "cut"]
    assert (mags["share"].between(0, 1)).all()
    listed = pd.DataFrame([
        {"school": "moe:69", "moe": 69, "kind": "state", "medium": "english", "scheme": True,
         "services": "secondary_school", "sex_secondary_school": "co-ed", "sex_intermediate_school": None},
        {"school": "moe:1300", "moe": 1300, "kind": "state", "medium": "english", "scheme": True,
         "services": "intermediate_school", "sex_secondary_school": None, "sex_intermediate_school": "co-ed"},
        {"school": "moe:50", "moe": 50, "kind": "state", "medium": "english", "scheme": False,
         "services": "secondary_school", "sex_secondary_school": "co-ed", "sex_intermediate_school": None},
        {"school": "moe:70", "moe": 70, "kind": "integrated", "medium": "english", "scheme": False,
         "services": "secondary_school", "sex_secondary_school": "girls", "sex_intermediate_school": None},
    ])
    sets, cut, missing = schools.in_zone_sets(listed, current, cover, "secondary_school", len(cells))
    # The centre hexagon is in MAGS's zone; a school with no scheme takes anyone; an integrated school is never "in zone".
    assert sets[0] == {"moe:69", "moe:50"}
    assert all("moe:70" not in s for s in sets)
    assert all("moe:1300" not in s for s in sets)  # a Years 7-8 zone is not a secondary zone
    assert cut.any() and missing == []
    inter, _, _ = schools.in_zone_sets(listed, current, cover, "intermediate_school", len(cells))
    assert "moe:1300" in inter[0]


# ---------------------------------------------------------------------------
# What the site reads


def test_reach_lists_are_offsets_into_flat_lists():
    reach = pd.DataFrame({"cell": [0, 0, 2], "destination": [MAGS, MARIST, MAGS], "minutes": [9, 12, 30],
                          "lo": [9, 10, 25], "hi": [9, 14, 255]})
    body = export.reach_payload(reach, 3, {MAGS: 4, MARIST: 7}, spread=True)
    assert body == {"o": [0, 2, 2, 3], "d": [4, 7, 4], "m": [9, 12, 30], "lo": [9, 10, 25], "hi": [9, 14, None]}


def test_the_engine_counts_girls_and_boys_by_their_own_quickest_way():
    dests = [
        {"name": "Girls' school", "services": ["secondary_school"], "moe": 1, "kind": "state", "medium": "english", "sex": {"secondary_school": "girls"}},
        {"name": "Boys' school", "services": ["secondary_school"], "moe": 2, "kind": "state", "medium": "english", "sex": {"secondary_school": "boys"}},
        {"name": "Kura", "services": ["secondary_school"], "moe": 3, "kind": "state", "medium": "other", "sex": {"secondary_school": "co-ed"}},
    ]
    walk = {"o": [0, 3], "d": [2, 0, 1], "m": [5, 10, 25]}
    pt = {"o": [0, 3], "d": [2, 1, 0], "m": [5, 10, 25]}
    times = schools.choice_times({"walk": walk, "pt": pt}, dests, "secondary_school", "state", "both", ["walk", "pt"])
    # The girl walks (10), the boy takes the bus (10): both are there in 10 minutes,
    # although no single way gets both there in under 25.
    assert times["walk"][0] == 25 and times["pt"][0] == 25 and times["best"][0] == 10
    all_times = schools.choice_times({"walk": walk, "pt": pt}, dests, "secondary_school", "all", None, ["walk", "pt"])
    assert all_times["best"][0] == 5


GOLDEN = FIXTURES / "golden_auckland.json"


@pytest.mark.skipif(not GOLDEN.exists(), reason="written by scripts/school_golden.py from a build")
def test_golden_figures_for_the_slide_hexagon():
    golden = json.loads(GOLDEN.read_text())
    slide = golden["cells"][SLIDE]
    assert slide["all"]["secondary_school"]["pt"] == 9
    assert slide["all"]["secondary_school"]["bike_low_stress"] == 6
    assert slide["state:both"]["secondary_school"]["pt"] == 15
    assert slide["one:69"]["secondary_school"] == {**slide["one:69"]["secondary_school"], "walk": 15, "bike_low_stress": 10, "pt": 15}
    assert slide["one:70"]["secondary_school"]["pt"] == 12
    assert golden["checks"]["ok"]
    assert golden["figures"]["all"]["secondary_school"]["best"]["share"] >= golden["figures"]["state:both"]["secondary_school"]["best"]["share"]


@pytest.mark.skipif(not GOLDEN.exists(), reason="written by scripts/school_golden.py from a build")
def test_golden_names_the_school_for_the_way_shown():
    named = json.loads(GOLDEN.read_text())["named"]
    slide = named[SLIDE]
    # The slide's 9 minutes by public transport go to TKKM o Ngā Maungārongo; Marist is the cycling result.
    assert slide["all"]["secondary_school"]["pt"] == [4207]
    assert slide["all"]["secondary_school"]["bike_low_stress"] == [70]
    assert slide["state:both"]["secondary_school"]["pt"] == [69]
    # The hexagon holding both MAGS's and Marist's map points: Marist is nearer its middle.
    mags = named["89bb50021a7ffff"]
    assert mags["all"]["secondary_school"]["walk"] == [70]
    assert mags["state:both"]["secondary_school"]["walk"] == [69]


def test_names_under_girls_and_boys_come_from_the_slower_student():
    dests = [
        {"name": "Girls", "services": ["secondary_school"], "moe": 1, "kind": "state", "medium": "english", "sex": {"secondary_school": "girls"}},
        {"name": "Boys", "services": ["secondary_school"], "moe": 2, "kind": "state", "medium": "english", "sex": {"secondary_school": "boys"}},
        {"name": "Co-ed", "services": ["secondary_school"], "moe": 3, "kind": "state", "medium": "english", "sex": {"secondary_school": "co-ed"}},
    ]
    # Cell 0: girls 10 min, boys 15 (named: Boys). Cell 1: both 20, to different schools (named: both, list order).
    pt = {"format": 1, "o": [0, 2, 4], "d": [0, 1, 1, 0], "m": [10, 15, 20, 20]}
    assert schools.choice_named({"pt": pt}, dests, "secondary_school", "state", "both", 0) == {"pt": [2]}
    assert schools.choice_named({"pt": pt}, dests, "secondary_school", "state", "both", 1) == {"pt": [2, 1]}
    assert schools.choice_named({"pt": pt}, dests, "secondary_school", "all", None, 1) == {"pt": [2, 1]}
    assert schools.choice_named({"pt": pt}, dests, "secondary_school", "state", "girls", 0) == {"pt": [1]}


SITE = Path(os.environ["TEAM_SITE"]) if os.environ.get("TEAM_SITE") else None


@pytest.mark.skipif(SITE is None, reason="set TEAM_SITE to a built site's data folder (holding <place>/cells.json)")
@pytest.mark.parametrize("place", sorted(p.stem for p in (REPO / "configs").glob("*.yml")))
def test_the_named_school_is_reached_in_the_time_shown(place):
    """For every hexagon, school service and mode: the school cells.json names is the first in the
    reach list, its minutes are the time shown, tied schools share the minute, nothing is over 60."""
    import subprocess
    import sys

    folder = SITE / place
    if not (folder / "schools").exists():
        pytest.skip(f"{place} has no school reach lists in this site")
    result = subprocess.run([sys.executable, str(REPO / "scripts" / "school_golden.py"), "--site", str(folder)],
                            capture_output=True, text=True, env={**os.environ, "PYTHONPATH": str(REPO / "src")})
    assert result.returncode == 0, result.stdout[-2000:] + result.stderr[-2000:]


def test_a_car_short_list_keeps_the_nearest_school_under_each_choice():
    listed = pd.DataFrame([
        {"school": "moe:1", "kind": "private", "medium": "english", "sex_secondary_school": "co-ed"},
        {"school": "moe:2", "kind": "state", "medium": "english", "sex_secondary_school": "girls"},
        {"school": "moe:3", "kind": "state", "medium": "english", "sex_secondary_school": "co-ed"},
        {"school": "moe:4", "kind": "state", "medium": "english", "sex_secondary_school": "co-ed"},
        {"school": "moe:5", "kind": "state", "medium": "other", "sex_secondary_school": "co-ed"},
    ])
    reach = pd.DataFrame({"cell": [0, 0, 0, 0, 0, 0], "destination": ["moe:5", "moe:1", "moe:2", "moe:3", "moe:4", "moe:1"],
                          "minutes": [3, 3, 4, 6, 6, 9]}).iloc[:5]
    kept = schools.short_list(reach, listed, "secondary_school")
    # All: the kura and the private school tie at 3; State and State girls: the girls' school at 4;
    # State boys: the two co-ed state schools tie at 6.
    assert kept["destination"].tolist() == ["moe:5", "moe:1", "moe:2", "moe:3", "moe:4"]
    assert schools.short_list(reach.iloc[[0, 1, 3]], listed, "secondary_school")["destination"].tolist() == ["moe:5", "moe:1", "moe:3"]
