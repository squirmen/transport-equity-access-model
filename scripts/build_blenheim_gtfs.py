"""A GTFS feed for Blenheim's buses, from the council's printed timetable.

Marlborough District Council publishes its timetable only as a PDF
(raw/blenheim/timetables/marlborough_bus_timetable_2026.pdf). Ride Guide,
which the council's web map uses, serves the stop positions and route stop
lists but not the times, so the times below are read off the PDF and the
positions come from Ride Guide (saved beside the feed). Their stop codes run
in route order, 1000 to 1021 on the North route, which makes the match exact.

The PDF prints "111.00" for the second Saturday North trip at Hutcheson St;
that stop is given the minute between its neighbours. Route 3 runs to Picton
on Tuesdays, Thursdays and Saturdays, so it is in both days TEAM routes.

    python scripts/build_blenheim_gtfs.py --data-root <root>
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from pathlib import Path

WEEKDAY, SATURDAY = "20260915", "20260919"

# Stop code, then the times: weekday trips, then Saturday trips.
NORTH = [
    (1000, "9.45 11.15 12.45 2.15", "9.40 11.05 12.25"),
    (1021, "9.50 11.20 12.50 2.20", "9.45 11.10 12.30"),
    (1001, "9.52 11.21 12.51 2.21", "9.46 11.11 12.31"),
    (1004, "9.56 11.25 12.55 2.25", "9.50 11.15 12.35"),
    (1005, "9.57 11.26 12.56 2.26", "9.51 11.16 12.36"),
    (1006, "10.00 11.29 12.59 2.29", "9.54 11.19 12.39"),
    (1007, "10.02 11.31 1.01 2.31", "9.56 11.21 12.41"),
    (1008, "10.03 11.32 1.02 2.32", "9.57 11.22 12.42"),
    (1009, "10.04 11.33 1.03 2.33", "9.58 11.23 12.43"),
    (1010, "10.05 11.34 1.04 2.34", "9.59 11.24 12.44"),
    (1011, "10.07 11.36 1.06 2.36", "10.01 11.26 12.46"),
    (1012, "10.09 11.38 1.08 2.38", "10.03 11.27 12.48"),  # PDF: 111.00
    (1013, "10.11 11.40 1.10 2.40", "10.05 11.28 12.50"),
    (1014, "10.13 11.41 1.11 2.41", "10.06 11.30 12.51"),
    (1015, "10.14 11.42 1.12 2.42", "10.07 11.31 12.52"),
    (1016, "10.17 11.46 1.16 2.46", "10.11 11.36 12.56"),
    (1017, "10.20 11.49 1.19 2.49", "10.14 11.39 12.59"),
    (1018, "10.21 11.50 1.20 2.50", "10.15 11.40 1.00"),
    (1019, "10.22 11.51 1.21 2.51", "10.16 11.41 1.01"),
    (1020, "10.24 11.53 1.23 2.53", "10.18 11.43 1.03"),
    (1000, "10.26 11.55 1.25 2.55", "10.20 11.45 1.05"),
]
SOUTH = [
    (1000, "9.00 10.30 12.00 1.30", "9.00 10.20 11.45"),
    (1021, "9.05 10.35 12.05 1.35", "9.05 10.25 11.50"),
    (1104, "9.11 10.41 12.11 1.41", "9.11 10.31 11.56"),
    (1105, "9.12 10.42 12.12 1.42", "9.12 10.32 11.57"),
    (1306, "9.13 10.43 12.13 1.43", "9.13 10.33 11.58"),  # PDF: 12.00, out of order
    (1107, "9.15 10.45 12.15 1.45", "9.15 10.35 12.00"),
    (1108, "9.16 10.46 12.16 1.46", "9.16 10.36 12.01"),
    (1109, "9.17 10.47 12.17 1.47", "9.17 10.37 12.02"),
    (1110, "9.18 10.48 12.18 1.48", "9.18 10.38 12.03"),
    (1111, "9.19 10.49 12.19 1.49", "9.19 10.39 12.04"),
    (1112, "9.20 10.50 12.20 1.50", "9.20 10.40 12.05"),
    (1113, "9.21 10.51 12.21 1.51", "9.21 10.41 12.06"),
    (1114, "9.22 10.52 12.22 1.52", "9.22 10.42 12.07"),
    (1115, "9.23 10.53 12.23 1.53", "9.23 10.43 12.08"),
    (1116, "9.24 10.54 12.24 1.54", "9.24 10.44 12.09"),
    (1117, "9.26 10.56 12.26 1.56", "9.26 10.46 12.11"),
    (1118, "9.28 10.58 12.28 1.58", "9.28 10.48 12.13"),
    (1119, "9.30 11.00 12.30 2.00", "9.30 10.50 12.15"),
    (1120, "9.32 11.02 12.32 2.02", "9.32 10.52 12.17"),
    (1121, "9.34 11.04 12.34 2.04", "9.34 10.54 12.19"),
    (1122, "9.35 11.05 12.35 2.05", "9.35 10.55 12.20"),
    (1000, "9.38 11.08 12.38 2.08", "9.38 10.58 12.23"),
]
# Tuesday, Thursday and Saturday only; the same two trips each way.
TO_PICTON = [(1000, "10.10 2.00"), (1519, "10.12 2.02"), (1016, "10.15 2.05"), (1505, "10.20 2.10"),
             (1514, "10.40 2.30"), (1550, "10.42 2.32"), (1513, "10.47 2.37"), (1512, "10.50 2.40"), (1510, "10.55 2.45")]
FROM_PICTON = [(1510, "9.00 1.00"), (1509, "9.05 1.05"), (1508, "9.08 1.08"), (1550, "9.13 1.13"), (1507, "9.15 1.15"),
               (1505, "9.35 1.35"), (1016, "9.40 1.40"), (1502, "9.43 1.43"), (1000, "9.45 1.45")]


def clock(text: str) -> str:
    """A printed time, where a small hour is in the afternoon."""
    hour, minute = (int(p) for p in text.split("."))
    if hour < 7:
        hour += 12
    return f"{hour:02d}:{minute:02d}:00"


def trips_from(rows, column: int, route: str, prefix: str, service: str, direction: int):
    times = [r[column].split() for r in rows]
    out_trips, out_times = [], []
    for k in range(len(times[0])):
        trip = f"{prefix}_{service}_{k + 1}"
        out_trips.append({"route_id": route, "service_id": service, "trip_id": trip, "direction_id": direction})
        for seq, row in enumerate(rows, start=1):
            out_times.append({"trip_id": trip, "arrival_time": clock(times[seq - 1][k]), "departure_time": clock(times[seq - 1][k]),
                              "stop_id": f"5100{row[0]}", "stop_sequence": seq})
    return out_trips, out_times


def _csv(rows, fields):
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def build(root: Path) -> Path:
    positions = json.loads((root / "raw/blenheim/gtfs/rideguide_marlborough_stops_2026-09-28.json").read_text())
    features = {f["properties"]["stopId"]: f for f in positions["stops"]["features"]}
    trips, times = [], []
    for service, col in ((f"D{WEEKDAY}", 1), (f"D{SATURDAY}", 2)):
        for rows, route, prefix in ((NORTH, "1", "N"), (SOUTH, "2", "S")):
            t, s = trips_from(rows, col, route, prefix, service, 0)
            trips += t
            times += s
        for rows, prefix, direction in ((TO_PICTON, "P", 0), (FROM_PICTON, "B", 1)):
            t, s = trips_from([(r[0], r[1], r[1]) for r in rows], 1, "3", prefix, service, direction)
            trips += t
            times += s
    used = sorted({t["stop_id"] for t in times})
    missing = [s for s in used if s not in features]
    if missing:
        raise SystemExit(f"stops with no position: {missing}")
    stops = [{
        "stop_id": s, "stop_code": features[s]["properties"]["code"], "stop_name": features[s]["properties"]["name"].replace(";", ","),
        "stop_lat": features[s]["geometry"]["coordinates"][1], "stop_lon": features[s]["geometry"]["coordinates"][0],
    } for s in used]
    routes = [{"route_id": "1", "agency_id": "MDC", "route_short_name": "1", "route_long_name": "North Route", "route_type": 3},
              {"route_id": "2", "agency_id": "MDC", "route_short_name": "2", "route_long_name": "South Route", "route_type": 3},
              {"route_id": "3", "agency_id": "MDC", "route_short_name": "3", "route_long_name": "Blenheim - Picton", "route_type": 3}]
    files = {
        "agency.txt": _csv([{"agency_id": "MDC", "agency_name": "Marlborough Bus Service", "agency_url": "https://www.marlborough.govt.nz",
                             "agency_timezone": "Pacific/Auckland"}], ["agency_id", "agency_name", "agency_url", "agency_timezone"]),
        "stops.txt": _csv(stops, ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"]),
        "routes.txt": _csv(routes, ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"]),
        "trips.txt": _csv(trips, ["route_id", "service_id", "trip_id", "direction_id"]),
        "stop_times.txt": _csv(times, ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]),
        "calendar_dates.txt": _csv([{"service_id": f"D{d}", "date": d, "exception_type": 1} for d in (WEEKDAY, SATURDAY)],
                                   ["service_id", "date", "exception_type"]),
        "feed_info.txt": _csv([{"feed_publisher_name": "TEAM, from Marlborough District Council's printed timetable",
                                "feed_publisher_url": "https://www.marlborough.govt.nz", "feed_lang": "en",
                                "feed_start_date": WEEKDAY, "feed_end_date": SATURDAY}],
                              ["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date"]),
    }
    out = root / "raw/blenheim/gtfs/marlboroughbus_gtfs_2026-09-28.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text)
    out.with_suffix(".zip.metadata.json").write_text(json.dumps({
        "source": "Times from raw/blenheim/timetables/marlborough_bus_timetable_2026.pdf; stop positions from Ride Guide (marlborough-nz)",
        "trips": len(trips), "stops": len(stops),
        "notes": "Written for 15 and 19 September 2026 only. Cash only; SuperGold and under 5 free.",
    }, indent=2))
    print(f"{len(trips)} trips, {len(stops)} stops -> {out}")
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    build(parser.parse_args().data_root.expanduser().resolve())
