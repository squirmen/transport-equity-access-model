"""Timetable handling: which services run on the routing date, and stop frequencies."""

import datetime as dt
import zipfile
from pathlib import Path

import pytest

from team.config import Settings
from team.context import active_services, timetable

FEED = {
    "calendar.txt": (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "weekday,1,1,1,1,1,0,0,20260901,20261031\n"
        "weekday2,1,1,1,1,1,0,0,20260901,20261031\n"
        "weekend,0,0,0,0,0,1,1,20260901,20261031\n"
        "expired,1,1,1,1,1,0,0,20260101,20260831\n"
    ),
    "calendar_dates.txt": (
        "service_id,date,exception_type\n"
        "special,20260915,1\n"
        "weekday2,20260915,2\n"
    ),
    "routes.txt": "route_id,route_type\nbus,3\nrail,2\n",
    "trips.txt": (
        "route_id,service_id,trip_id,shape_id\n"
        "bus,weekday,t1,s1\n"
        "bus,weekday,t2,s1\n"
        "rail,special,t3,s2\n"
        "bus,weekend,t4,s1\n"
        "bus,weekday2,t5,s1\n"
        "bus,expired,t6,s1\n"
    ),
    "stop_times.txt": (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "t1,07:10:00,07:10:00,A,1\n"
        "t1,07:20:00,07:20:00,B,2\n"
        "t2,08:10:00,08:10:00,A,1\n"
        "t3,10:30:00,10:30:00,C,1\n"
        "t4,07:30:00,07:30:00,A,1\n"
        "t5,07:40:00,07:40:00,A,1\n"
        "t6,07:50:00,07:50:00,A,1\n"
    ),
    "stops.txt": (
        "stop_id,stop_name,stop_lat,stop_lon\n"
        "A,Stop A,-36.85,174.76\n"
        "B,Stop B,-36.86,174.77\n"
        "C,Station C,-36.87,174.78\n"
    ),
}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    with zipfile.ZipFile(tmp_path / "gtfs.zip", "w") as zf:
        for name, text in FEED.items():
            zf.writestr(name, text)
    raw = {
        "data": {"gtfs": "gtfs.zip"},
        "routing": {
            "date": "2026-09-15",
            "windows": {"am_peak": {"start": "07:00", "minutes": 120}, "interpeak": {"start": "10:00", "minutes": 120}},
        },
    }
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)


def test_active_services_uses_calendar_and_exceptions(settings: Settings):
    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        running = active_services(zf, dt.date(2026, 9, 15))
    # Added by exception; removed by exception; weekend and expired services excluded.
    assert running == {"weekday", "special"}


def test_departures_per_hour_by_window(settings: Settings):
    stops, _, _ = timetable(settings)
    stops = stops.set_index("stop_id")
    # Stop A: 07:10 and 08:10 in the two-hour morning window.
    assert stops.loc["A", "per_hour_am_peak"] == pytest.approx(1.0)
    assert stops.loc["B", "per_hour_am_peak"] == pytest.approx(0.5)
    assert stops.loc["C", "per_hour_interpeak"] == pytest.approx(0.5)
    assert stops.loc["A", "per_hour_interpeak"] == 0
    assert bool(stops.loc["C", "rail_or_ferry"]) is True
    assert bool(stops.loc["A", "rail_or_ferry"]) is False


LINES_FEED = {
    "calendar.txt": (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "weekday,1,1,1,1,1,0,0,20260901,20261031\n"
    ),
    "routes.txt": (
        "route_id,route_short_name,route_long_name,route_type\n"
        "R1-1,STH,STH,2\nNX1-1,NX1,NX1,3\n22-1,22,22,3\n"
    ),
    "trips.txt": (
        "route_id,service_id,trip_id,shape_id\n"
        "R1-1,weekday,t1,s1\nR1-1,weekday,t2,s1\n"
        "NX1-1,weekday,t3,s2\nNX1-1,weekday,t4,s2\nNX1-1,weekday,t5,s3\n"
        "22-1,weekday,t6,s4\n"
    ),
    "stop_times.txt": (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "t1,07:10:00,07:10:00,P1,1\nt1,07:20:00,07:20:00,A,2\n"
        "t2,08:10:00,08:10:00,P1,1\nt2,08:20:00,08:20:00,A,2\n"
        # Two stops at the same minute: the order comes from stop_sequence.
        "t3,07:30:00,07:30:00,A,1\nt3,07:30:00,07:30:00,B,2\nt3,07:40:00,07:40:00,C,3\n"
        "t4,08:30:00,08:30:00,A,1\nt4,08:30:00,08:30:00,B,2\nt4,08:40:00,08:40:00,C,3\n"
        "t5,08:50:00,08:50:00,C,1\nt5,08:55:00,08:55:00,D,2\n"
        "t6,07:15:00,07:15:00,B,1\nt6,07:25:00,07:25:00,C,2\n"
    ),
    "stops.txt": (
        "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
        "P,,Central Station,-36.850,174.760,1,\n"
        "P1,101,Central Station 1,-36.850,174.761,0,P\n"
        "A,102,Stop A,-36.855,174.765,0,\n"
        "B,103,Stop B,-36.860,174.770,0,\n"
        "C,104,Stop C,-36.865,174.775,0,\n"
        "D,105,Stop D,-36.870,174.780,0,\n"
    ),
    "shapes.txt": (
        "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
        "s1,-36.850,174.761,1\ns1,-36.855,174.765,2\n"
        "s2,-36.855,174.765,1\ns2,-36.860,174.770,2\ns2,-36.865,174.775,3\n"
        "s3,-36.865,174.775,1\ns3,-36.870,174.780,2\n"
        "s4,-36.860,174.770,1\ns4,-36.865,174.775,2\n"
    ),
}


@pytest.fixture
def lines_settings(tmp_path: Path) -> Settings:
    with zipfile.ZipFile(tmp_path / "gtfs.zip", "w") as zf:
        for name, text in LINES_FEED.items():
            zf.writestr(name, text)
    raw = {
        "data": {"gtfs": "gtfs.zip"},
        "routing": {"date": "2026-09-15", "windows": {"am_peak": {"start": "07:00", "minutes": 120}}},
        "jobs": {"window": "am_peak"},
        "busways": {"NX1": "Northern Busway"},
    }
    return Settings(raw=raw, config_path=tmp_path / "c.yml", data_root=tmp_path, output_dir=tmp_path, cache_dir=tmp_path)


def test_overlays_name_stops_and_stations(lines_settings: Settings):
    from team.context import network_layers

    layers, named = network_layers(lines_settings)
    stops = {f["properties"]["id"]: f["properties"] for f in named["stops"]["features"]}
    assert stops["P1"] == {"kind": "rail_ferry", "per_hour": 1.0, "id": "P1", "name": "Central Station 1",
                           "code": "101", "station": "P"}
    assert "station" not in stops["B"]
    # A parent station is not a stop anyone boards at, but is listed as a station.
    assert "P" not in stops
    stations = named["stations"]["features"]
    assert [f["properties"] for f in stations] == [{"id": "P", "name": "Central Station", "kind": "rail_ferry"}]


def test_the_maps_overlays_carry_only_what_it_draws(lines_settings: Settings):
    """Every visitor loads overlays.json, so names and lines go in transit.json instead."""
    from team.context import network_layers, overlays

    layers, named = network_layers(lines_settings)
    assert set(layers) == {"rail", "ferry", "frequent_bus", "bus", "stops"}
    assert all(set(f["properties"]) == {"kind", "per_hour"} for f in layers["stops"]["features"])
    for name in ("rail", "ferry", "frequent_bus", "bus"):
        assert all(f["properties"] == {} for f in layers[name]["features"])
    assert set(named) == {"stops", "stations", "lines", "drawn"}
    # The map's stops are the named ones, in the same order and places.
    assert [f["geometry"] for f in layers["stops"]["features"]] == [f["geometry"] for f in named["stops"]["features"]]
    assert overlays(lines_settings) == layers


def test_overlays_list_lines_with_their_stops(lines_settings: Settings):
    from team.context import network_layers

    layers, named = network_layers(lines_settings)
    lines = {entry["id"]: entry for entry in named["lines"]}
    # The infrequent route 22 is not a line to pick.
    assert [entry["id"] for entry in named["lines"]] == ["STH", "NX1"]
    assert lines["STH"]["kind"] == "rail"
    assert lines["STH"]["stops"] == ["P1", "A"]
    assert (lines["STH"]["from"], lines["STH"]["to"]) == ("Central Station", "Stop A")
    assert lines["STH"]["per_hour"] == 1.0
    nx1 = lines["NX1"]
    assert nx1["kind"] == "busway" and nx1["corridor"] == "Northern Busway"
    # The most common pattern first, in stop order, then stops only other patterns use.
    assert nx1["stops"] == ["A", "B", "C", "D"]
    assert nx1["routes"] == ["NX1-1"]
    # The shapes the lines are drawn with name them, on whichever layer they are drawn in; route 22 is not a line.
    drawn = named["drawn"]["features"]
    rail = [f for f in drawn if f["properties"]["layer"] == "rail"]
    assert rail and all(f["properties"]["lines"] == ["STH"] for f in rail)
    assert sorted(tuple(f["properties"]["lines"]) for f in drawn if f["properties"]["layer"] == "bus") == [("NX1",), ("NX1",)]
    assert len(layers["bus"]["features"]) == 3
