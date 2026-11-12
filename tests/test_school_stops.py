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
        "routes.txt": "route_id,route_short_name,route_long_name,route_type\nR22N,22N,,3\nWEST,WEST,Western Line,2\n",
        "trips.txt": "route_id,service_id,trip_id,trip_headsign\n"
                     "R22N,WEEKDAY,t1,City\n"      # 07:10 at B: counted
                     "R22N,WEEKDAY,t2,City\n"      # 09:00 at B: just after the window
                     "R22N,SCHOOLHOL,t3,City\n"    # does not run on 15 September
                     "R22N,EXTRA,t4,New Lynn\n"    # added for the day in calendar_dates
                     "R22N,WEEKDAY_OFF,t5,City\n"  # weekday service removed for the day
                     "R22N,MONDAY,t6,City\n"       # Monday's late trip, at 31:30 = 7:30 on Tuesday
                     "WEST,WEEKDAY,t7,Swanson\n"   # at both platforms of the station
                     "WEST,WEEKDAY,t8,Britomart\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                          "t1,07:10:00,07:10:00,B,1\nt2,09:00:00,09:00:00,B,1\nt3,07:20:00,07:20:00,B,1\n"
                          "t4,08:59:59,08:59:59,B,1\nt5,07:40:00,07:40:00,B,1\nt6,31:30:00,31:30:00,B,1\n"
                          "t7,07:05:00,07:05:00,P1,1\nt7,07:06:00,07:06:00,P2,2\nt8,08:15:00,08:15:00,P2,1\n",
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
    assert sorted(set(times.loc[times["stop_id"] == "B", "trip_id"])) == ["t1", "t4", "t6"]
    assert times.attrs["served"] == {"B", "P1", "P2"}
    # Platforms go under their station; the station itself is not a place to board.
    assert set(boarding["stop_id"]) == {"P1", "P2", "B"}
    assert group.to_dict() == {"P1": "S", "P2": "S", "B": "B"}
    listed = school_stops._routes_by_group(times, routes, group)
    routes_b, trips_b = listed["B"]
    assert trips_b == 3 and routes_b == [{"route": "22N", "mode": "bus", "headsigns": ["City", "New Lynn"], "trips": 3}]
    routes_s, trips_s = listed["S"]
    # A train stopping at both platforms is one trip at the station.
    assert trips_s == 2 and routes_s[0]["mode"] == "train" and routes_s[0]["headsigns"] == ["Britomart", "Swanson"]


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
    assert sum(1 for rows in body["schools"].values() if not rows) == meta["schools"]["stops"]["schools_with_none"]
    for rows in body["schools"].values():
        assert all(r["walk"] <= body["max_walk_minutes"] == 15 for r in rows)
        # A trip runs on one route, so the routes' trips add up to the stop's.
        assert all(r["trips"] == sum(x["trips"] for x in r["routes"]) for r in rows)
