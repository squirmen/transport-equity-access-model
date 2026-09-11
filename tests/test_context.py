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
