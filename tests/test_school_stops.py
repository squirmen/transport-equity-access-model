"""Stops near a school (D6, src/team/school_stops.py): which trips count, on
a made-up feed, then the built files when TEAM_SITE (the site's data folder)
is set."""

from __future__ import annotations

import datetime as dt
import json
import os
import zipfile
from pathlib import Path

import pytest

from team import school_stops

REPO = Path(__file__).resolve().parents[1]
SITE = Path(os.environ["TEAM_SITE"]) if os.environ.get("TEAM_SITE") else None
PLACES = sorted(p.stem for p in (REPO / "configs").glob("*.yml"))
DAY = dt.date(2026, 9, 15)  # a Tuesday


def feed(tmp_path: Path) -> Path:
    files = {
        "stops.txt": "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                     "S,,Baldwin Ave Train Station,-36.8806,174.7149,1,\n"
                     "P1,9301,Baldwin Ave Train Station 1,-36.8805,174.7148,0,S\n"
                     "P2,9302,Baldwin Ave Train Station 2,-36.8807,174.7150,0,S\n"
                     "B,1427,Mount Albert Grammar School,-36.88468,174.72428,0,\n",
        "routes.txt": "route_id,route_short_name,route_long_name,route_type\nR22N,22N,,3\nWEST,WEST,Western Line,2\n"
                      "OTA01-1A,1,,3\nOTA01-1B,1,,3\nS402,402,,712\n",
        "trips.txt": "route_id,service_id,trip_id,trip_headsign\n"
                     "R22N,WEEKDAY,t1,City\n"      # 07:10 at B: counted
                     "R22N,WEEKDAY,t2,City\n"      # 09:00 at B: just after the window
                     "R22N,SCHOOLHOL,t3,City\n"    # does not run on 15 September
                     "R22N,EXTRA,t4,New Lynn\n"    # added for the day in calendar_dates
                     "R22N,WEEKDAY_OFF,t5,City\n"  # weekday service removed for the day
                     "R22N,MONDAY,t6,City\n"       # Monday's late trip, at 31:30 = 7:30 on Tuesday
                     "WEST,WEEKDAY,t7,Swanson\n"   # at both platforms of the station
                     "WEST,WEEKDAY,t8,Britomart\n"
                     "OTA01-1A,WEEKDAY,t9,Mosgiel\n"   # route 1 one way ...
                     "OTA01-1B,WEEKDAY,t10,City\n"     # ... and the other, under another route_id
                     "S402,WEEKDAY,t11,School Bus\n"   # a school bus that ends at the school's stop
                     "R22N,WEEKDAY,t12,City\n",        # picks up only at B (drop_off_type 1)
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
                          "t1,07:10:00,07:10:00,B,1,,\nt2,09:00:00,09:00:00,B,1,,\nt3,07:20:00,07:20:00,B,1,,\n"
                          "t4,08:59:59,08:59:59,B,1,,\nt5,07:40:00,07:40:00,B,1,,\nt6,31:30:00,31:30:00,B,1,,\n"
                          "t7,07:05:00,07:05:00,P1,1,,\nt7,07:06:00,07:06:00,P2,2,,\nt8,08:15:00,08:15:00,P2,1,,\n"
                          "t9,07:30:00,07:30:00,B,3,0,0\nt10,07:45:00,07:45:00,B,5,0,0\n"
                          "t11,08:23:00,08:23:00,B,9,1,0\nt12,08:30:00,08:30:00,B,1,0,1\n",
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                        "WEEKDAY,1,1,1,1,1,0,0,20260801,20261231\nSCHOOLHOL,1,1,1,1,1,0,0,20260926,20261012\n"
                        "WEEKDAY_OFF,1,1,1,1,1,0,0,20260801,20261231\nMONDAY,1,0,0,0,0,0,0,20260801,20261231\n",
        "calendar_dates.txt": "service_id,date,exception_type\nEXTRA,20260915,1\nWEEKDAY_OFF,20260915,2\n",
    }
    path = tmp_path / "feed.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    return path


def test_only_trips_running_on_the_day_and_in_the_window_count(tmp_path):
    with zipfile.ZipFile(feed(tmp_path)) as archive:
        stops = school_stops._read(archive, "stops.txt")
        routes = school_stops._read(archive, "routes.txt")
        boarding, group = school_stops.stop_table(stops)
        times = school_stops.departures(archive, set(boarding["stop_id"]), DAY, 7 * 3600, 9 * 3600)
    at_b = times[times["stop_id"] == "B"]
    # At the school end students get off: trips that set down there arriving
    # in the window, a school bus that ends there among them, and not one
    # that only picks up.
    assert sorted(set(at_b.loc[at_b["alight"], "trip_id"])) == ["t1", "t10", "t11", "t4", "t6", "t9"]
    assert sorted(set(at_b.loc[at_b["board"], "trip_id"])) == ["t1", "t10", "t12", "t4", "t6", "t9"]
    assert times.attrs["served"] == {"B", "P1", "P2"}
    # Platforms go under their station; the station itself is not a place to board.
    assert set(boarding["stop_id"]) == {"P1", "P2", "B"}
    assert group.to_dict() == {"P1": "S", "P2": "S", "B": "B"}
    listed = school_stops._routes_by_group(times, routes, group)
    routes_b, trips_b, boarding_b = listed["B"]
    assert trips_b == 6 and boarding_b == 6
    by_route = {r["route"]: r for r in routes_b}
    assert by_route["22N"] == {"route": "22N", "mode": "bus", "headsigns": ["City", "New Lynn"], "trips": 3}
    # Route 1 has a route_id for each direction: one route, its trips added up.
    assert by_route["1"] == {"route": "1", "mode": "bus", "headsigns": ["City", "Mosgiel"], "trips": 2}
    assert by_route["402"]["trips"] == 1 and by_route["402"]["headsigns"] == ["School Bus"]
    assert [r["route"] for r in routes_b].count("1") == 1
    routes_s, trips_s, _ = listed["S"]
    # A train stopping at both platforms is one trip at the station.
    assert trips_s == 2 and routes_s[0]["mode"] == "train" and routes_s[0]["headsigns"] == ["Britomart", "Swanson"]


def test_stations_are_stop_groups_a_train_or_ferry_stops_at(tmp_path):
    """A parent station with a train at its platforms, a wharf with no
    station, and bus stops: only the first two are stations."""
    path = tmp_path / "stations.zip"
    files = {
        "stops.txt": "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                     "S,119,Baldwin Ave Train Station,-36.8806,174.7149,1,\n"
                     "P1,9301,Baldwin Ave Train Station 1,-36.8805,174.7148,0,S\n"
                     "P2,9302,Baldwin Ave Train Station 2,-36.8807,174.7150,0,S\n"
                     "W,9600,Devonport Ferry Terminal,-36.8333,174.7958,0,\n"
                     "B,1427,Mount Albert Grammar School,-36.88468,174.72428,0,\n",
        "routes.txt": "route_id,route_short_name,route_long_name,route_type\nWEST,WEST,Western Line,2\nDEV,DEV,,4\nR22N,22N,,3\n",
        "trips.txt": "route_id,service_id,trip_id,trip_headsign\nWEST,SUNDAY,t1,Swanson\nDEV,WEEKDAY,t2,Devonport\nR22N,WEEKDAY,t3,City\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                          "t1,10:00:00,10:00:00,P2,1\nt2,07:30:00,07:30:00,W,2\nt3,07:10:00,07:10:00,B,1\n",
    }
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    with zipfile.ZipFile(path) as archive:
        stops = school_stops._read(archive, "stops.txt")
        routes = school_stops._read(archive, "routes.txt")
        _, group = school_stops.stop_table(stops)
        # A train on any day makes a station, here only on Sundays.
        assert school_stops.station_groups(archive, routes, group) == {"S": "train", "W": "ferry"}


def walks(rows):
    import pandas as pd

    return pd.DataFrame(rows, columns=["school", "group", "travel_time", "metres"])


def test_each_school_keeps_its_nearest_stations_within_30_minutes_up_to_3():
    stations = {"BALDWIN": "train", "MTALBERT": "train", "MORNINGSIDE": "train", "KINGSLAND": "train", "AVONDALE": "train",
                "WHARF": "ferry"}
    near = walks([
        # MAGS: its stops within 15 minutes, no station among them.
        ("moe:69", "1427", 1, 95), ("moe:69", "8816", 7, 501),
        # A school with a station within the walk.
        ("moe:62", "GRAFTON", 5, 300),
    ])
    stations["GRAFTON"] = "train"
    further = walks([
        ("moe:69", "BALDWIN", 16, 891), ("moe:69", "MTALBERT", 17, 999), ("moe:69", "MORNINGSIDE", 21, 1392),
        ("moe:69", "KINGSLAND", 25, 1700), ("moe:69", "AVONDALE", 30, 2100),
        ("moe:62", "GRAFTON", 5, 300), ("moe:62", "MTALBERT", 18, 1300), ("moe:62", "BALDWIN", 31, 2400),
        # A school whose only station within 30 minutes is within 15.
        ("moe:101", "PAPAKURA", 10, 700),
        # Bus stops in the walks are not stations.
        ("moe:7", "BUS", 20, 900),
    ])
    stations["PAPAKURA"] = "train"
    nearest = school_stops.nearest_stations(further, stations)
    assert list(nearest.loc[nearest["school"] == "moe:69", "group"]) == ["BALDWIN", "MTALBERT", "MORNINGSIDE"]
    far = school_stops.far_stations(near, further, stations)
    by_school = far.groupby("school")["group"].apply(list).to_dict()
    # MAGS: Baldwin Ave and Mt Albert (16 and 17 minutes) and Morningside; Kingsland and Avondale are 4th and 5th.
    assert by_school["moe:69"] == ["BALDWIN", "MTALBERT", "MORNINGSIDE"]
    assert list(far.loc[far["school"] == "moe:69", "travel_time"]) == [16, 17, 21]
    # Grafton, within the walk, is not added again or marked far; Mt Albert
    # is; Baldwin Ave, over 30 minutes, is not.
    assert by_school["moe:62"] == ["MTALBERT"]
    # A school with its only station within the walk is unchanged.
    assert "moe:101" not in by_school
    assert "moe:7" not in by_school


def test_route_types_name_the_mode():
    assert [school_stops.route_mode(v) for v in (3, "2", 4, 700, 1000, 109, None)] == ["bus", "train", "ferry", "bus", "ferry", "train", "other"]


needs_site = pytest.mark.skipif(SITE is None, reason="set TEAM_SITE to a built site's data folder")


def stops_of(place: str):
    body = json.loads((SITE / place / "schools" / "stops.json").read_text())
    dests = json.loads((SITE / place / "destinations.json").read_text())
    return body, dests


@needs_site
def test_mags_stops():
    body, dests = stops_of("auckland")
    mags = next(i for i, d in enumerate(dests) if d.get("moe") == 69)
    listed = body["schools"][str(mags)]
    by_code = {body["stops"][r["s"]]["code"]: r for r in listed}
    assert by_code["1427"]["walk"] <= 3
    assert body["stops"][by_code["1427"]["s"]]["name"] == "Mount Albert Grammar School"
    # No trip in Auckland Transport's open timetable stops at the school's own
    # stop, on any day (its school buses are not in it).
    assert by_code["1427"]["trips"] == 0 and body["stops"][by_code["1427"]["s"]]["served"] is False
    # The nearest stops with morning trips: Owairaka/Mount Albert (route 66) and Ferndale House.
    served = [r for r in listed if r["trips"] > 0]
    assert served and served[0]["walk"] <= 8
    assert {"8816", "8229"} <= {body["stops"][r["s"]]["code"] for r in served}
    assert [r["walk"] for r in listed] == sorted(r["walk"] for r in listed)  # quickest walk first
    baldwin = [body["stops"][r["s"]] for r in listed if "Baldwin Ave" in body["stops"][r["s"]]["name"]]
    # Baldwin Ave's platforms come under the station, once.
    assert len(baldwin) <= 1 and all(s["station"] for s in baldwin)
    # 32 stops within a 15-minute walk, then the nearest train stations
    # beyond it: Baldwin Ave (stop 119) and Mt Albert (120), the two its
    # students use, by their walks on the street network.
    within = [r for r in listed if not r.get("far")]
    far = [r for r in listed if r.get("far")]
    assert len(within) == 32 and all(r["walk"] <= 15 for r in within)
    assert listed == within + far
    stations = {body["stops"][r["s"]]["code"]: r for r in far}
    assert list(stations)[:2] == ["119", "120"] and len(far) <= 3
    assert body["stops"][stations["119"]["s"]]["name"] == "Baldwin Ave Train Station"
    assert body["stops"][stations["120"]["s"]]["name"] == "Mt Albert Train Station"
    assert (stations["119"]["walk"], stations["120"]["walk"]) == (16, 17)
    assert 850 <= stations["119"]["metres"] <= 950 and 950 <= stations["120"]["metres"] <= 1050
    for code in ("119", "120"):
        stop = body["stops"][stations[code]["s"]]
        assert stop["station"] and stop["mode"] == "train" and stop["served"]
        assert stations[code]["trips"] > 0 and {r["mode"] for r in stations[code]["routes"]} == {"train"}


@needs_site
def test_school_buses_that_set_down_at_the_school_count():
    body, dests = stops_of("wellington")
    assert body.get("counts") == "arrivals"
    tawa = next(i for i, d in enumerate(dests) if d.get("moe") == 257)
    rows = {body["stops"][r["s"]]["code"]: r for r in body["schools"][str(tawa)]}
    # Route 402 sets down at Tawa College's own stop at 08:23 (pickup_type 1).
    assert rows["3959"]["trips"] == 1 and [r["route"] for r in rows["3959"]["routes"]] == ["402"]
    kapiti = next(i for i, d in enumerate(dests) if d.get("moe") == 247)
    rows = {body["stops"][r["s"]]["code"]: r for r in body["schools"][str(kapiti)]}
    assert rows["1490"]["trips"] == 5


@needs_site
def test_a_route_is_listed_once_whatever_its_route_ids():
    body, dests = stops_of("queenstown")
    for rows in body["schools"].values():
        for row in rows:
            names = [(r["route"], r["mode"]) for r in row["routes"]]
            assert len(names) == len(set(names)), row


@needs_site
@pytest.mark.parametrize("place", PLACES)
def test_every_school_has_a_stop_list(place):
    body, dests = stops_of(place)
    meta = json.loads((SITE / place / "summary.json").read_text())["meta"]
    assert body["format"] == meta["formats"]["school_stops"] == 1
    assert body["date"] == "2026-09-15" and body["window"] == ["07:00", "08:59"]
    school_index = {i for i, d in enumerate(dests) if "moe" in d}
    listed = {int(k) for k in body["schools"]}
    # Every school has a list; an empty one means no stop within the walk.
    assert listed == school_index
    # None within the walk: an empty list, or far stations only.
    assert sum(1 for rows in body["schools"].values() if not [r for r in rows if not r.get("far")]) == meta["schools"]["stops"]["schools_with_none"]
    assert sum(1 for rows in body["schools"].values() if any(r.get("far") for r in rows)) == meta["schools"]["stops"]["schools_with_far"]
    assert body["max_walk_minutes"] == 15 and body["far_walk_minutes"] == 30 and body["far_most"] == 3
    for rows in body["schools"].values():
        within = [r for r in rows if not r.get("far")]
        far = [r for r in rows if r.get("far")]
        assert all(r["walk"] <= 15 for r in within)
        # The far ones: train or ferry stations, over 15 minutes and up to 30,
        # after the rest, and with the stations within the walk no more than 3.
        assert all(15 < r["walk"] <= 30 and body["stops"][r["s"]].get("mode") in ("train", "ferry") for r in far)
        assert rows == within + far and [r["walk"] for r in far] == sorted(r["walk"] for r in far)
        if far:
            assert sum(1 for r in within if body["stops"][r["s"]].get("mode")) + len(far) <= 3
        # A trip runs on one route, so the routes' trips add up to the stop's.
        assert all(r["trips"] == sum(x["trips"] for x in r["routes"]) for r in rows)


@needs_site
def test_a_school_with_its_only_station_within_the_walk_is_unchanged():
    body, dests = stops_of("auckland")
    # Papakura High School: Papakura Train Station is a 10-minute walk, and
    # no other station is within 30 minutes.
    school = next(i for i, d in enumerate(dests) if d.get("moe") == 101)
    rows = body["schools"][str(school)]
    stations = [r for r in rows if body["stops"][r["s"]].get("mode")]
    assert [(body["stops"][r["s"]]["name"], r["walk"], r.get("far", False)) for r in stations] == [("Papakura Train Station", 10, False)]
    assert not any(r.get("far") for r in rows)
