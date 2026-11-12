"""Write the small schools fixture the web tests read (fixture.json here).

It follows the 0.12 export contract in docs/schools.md: school attributes
in destinations.json, nearest_mode and ties in cells.json, reach lists in
schools/<service>_<mode>.json (each hexagon's schools in order of minutes,
then straight-line metres, then Ministry number, as the build sorts them),
meta.schools as summary.json has it, and zones in schools/zones.json (the
format the page reads; the build does not write zones yet).

Hexagon 0 is the St Lukes hexagon on the councillors' slide, 89bb50021a3ffff,
with its real minutes to the six nearest secondary schools by walking,
low-stress cycling and public transport, read from the 0.11 Auckland pairs
cache (services_walk, services_bike_low_stress, services_am_peak_pt) on
12 Nov 2026. School names, numbers, kinds and points are from the Ministry's
directory as TEAM holds it. Its public transport percentiles are made up.

Hexagons 1 to 4 are made up to cover the other rules: a tie, nothing within
the hour, walking quicker than public transport, and girls and boys who each
travel a different way. "Boys High" and "Open State College" are made up.

    python tests/web/fixtures/schools/make_fixture.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

OUT = Path(__file__).with_name("fixture.json")
S = "secondary_school"

DESTINATIONS = [
    # 0
    {"name": "TKKM o Nga Maungarongo", "services": ["primary_school", "intermediate_school", S], "lon": 174.7268, "lat": -36.8884,
     "moe": 4207, "kind": "state", "medium": "other", "language": "maori", "sex": {"primary_school": "co-ed", "intermediate_school": "co-ed", S: "co-ed"},
     "years": [1, 15], "roll": 71, "roll_date": "2026-10-01", "scheme": False, "zone_from": None, "routed_to": "point"},
    # 1
    {"name": "Marist College", "services": ["intermediate_school", S], "lon": 174.7261, "lat": -36.8819,
     "moe": 70, "kind": "integrated", "medium": "english", "language": "english", "sex": {"intermediate_school": "girls", S: "girls"},
     "years": [7, 15], "roll": 765, "roll_date": "2026-10-01", "scheme": False, "zone_from": None, "routed_to": "point"},
    # 2
    {"name": "Mt Albert Grammar School", "services": [S], "lon": 174.7253, "lat": -36.8847,
     "moe": 69, "kind": "state", "medium": "english", "language": "english", "sex": {S: "co-ed"},
     "years": [9, 15], "roll": 3635, "roll_date": "2026-10-01", "scheme": True, "zone_from": "2018-06-06", "routed_to": "point"},
    # 3
    {"name": "Auckland Girls' Grammar School", "services": [S], "lon": 174.7537, "lat": -36.8569,
     "moe": 53, "kind": "state", "medium": "english", "language": "english", "sex": {S: "girls"},
     "years": [9, 15], "roll": 1300, "roll_date": "2026-10-01", "scheme": True, "zone_from": "2009-01-01", "routed_to": "point"},
    # 4
    {"name": "Western Springs College-Ngā Puna o Waiōrea", "services": [S], "lon": 174.7175, "lat": -36.862,
     "moe": 48, "kind": "state", "medium": "english", "language": "english", "sex": {S: "co-ed"},
     "years": [9, 15], "roll": 1500, "roll_date": "2026-10-01", "scheme": True, "zone_from": "2010-01-01", "routed_to": "point"},
    # 5
    {"name": "Elim Christian College Mt Albert", "services": ["primary_school", "intermediate_school", S], "lon": 174.7092, "lat": -36.8891,
     "moe": 3630, "kind": "integrated", "medium": "english", "language": "english", "sex": {"primary_school": "co-ed", "intermediate_school": "co-ed", S: "co-ed"},
     "years": [1, 15], "roll": 449, "roll_date": "2026-10-01", "scheme": False, "zone_from": None, "routed_to": "point"},
    # 6
    {"name": "King's College", "services": [S], "lon": 174.8373, "lat": -36.9598,
     "moe": 89, "kind": "private", "medium": "english", "language": "english", "sex": {S: "boys"},
     "years": [9, 15], "roll": 1230, "roll_date": "2026-10-01", "scheme": False, "zone_from": None, "routed_to": "point"},
    # 7: not a school
    {"name": "Hill Medical", "services": ["gp"], "lon": 174.73, "lat": -36.88},
    # 8: made up
    {"name": "Boys High", "services": [S], "lon": 174.735, "lat": -36.87,
     "moe": 99002, "kind": "state", "medium": "english", "language": "english", "sex": {S: "boys"},
     "years": [9, 15], "roll": 900, "roll_date": "2026-10-01", "scheme": False, "zone_from": None, "routed_to": 2},
    # 9: made up, reached by nobody
    {"name": "Open State College", "services": [S], "lon": 174.9, "lat": -37.0,
     "moe": 99001, "kind": "state", "medium": "english", "language": "english", "sex": {S: "co-ed"},
     "years": [9, 13], "roll": 400, "roll_date": "2026-10-01", "scheme": False, "zone_from": None, "routed_to": "point"},
]

H3 = ["89bb50021a3ffff", "89bb50021a7ffff", "89bb5002133ffff", "89bb50021b3ffff", "89bb5002107ffff"]
CENTRES = [
    [-36.88539088388131, 174.72991387682092],
    [-36.883543985399534, 174.72665350209644],
    [-36.88066041254632, 174.7337623646013],
    [-36.8886795397538, 174.7296196752743],
    [-36.88250710342242, 174.73702259145824],
]
POP = [217.4, 150.0, 80.0, 120.0, 200.0]

# Minutes by hexagon and way of travelling: {destination: minutes}.
REACH = {
    "walk": [
        {0: 9, 1: 12, 2: 15, 5: 44, 4: 46},
        {},
        {},
        {2: 26},
        {3: 10, 2: 30, 8: 31},
    ],
    "bike_low_stress": [
        {1: 6, 0: 7, 2: 10, 4: 27, 5: 29},
        {2: 18},
        {},
        {2: 9},
        {},
    ],
    "pt": [
        {0: 9, 1: 12, 2: 15, 5: 29, 4: 32},
        {4: 20, 2: 20},
        {},
        {1: 27, 2: 28},
        {8: 15, 3: 20, 2: 22},
    ],
}
# Made-up 10th and 90th percentiles across departures, public transport only.
SPREAD = {(0, 2): (15, 15), (0, 4): (27, 38), (1, 2): (17, 24), (1, 4): (18, 23), (3, 2): (25, 33)}

# Zones: hexagons at least half inside each school's zone, and those its line crosses.
ZONE_IN = {2: [0, 3], 3: [4], 4: [1]}
ZONE_CUT = {2: [3]}
OUTLINE = {"type": "Polygon", "coordinates": [[[174.72, -36.89], [174.74, -36.89], [174.74, -36.875], [174.72, -36.875], [174.72, -36.89]]]}


def km(a, b):
    lat1, lon1 = a
    p1, p2 = math.radians(lat1), math.radians(b["lat"])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b["lon"] - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(h)))


def order(i, dest, minutes):
    """The build's order: minutes, then whole metres in a straight line, then
    Ministry number (schools.py ordered_reach)."""
    return (minutes, round(km(CENTRES[i], DESTINATIONS[dest]) * 1000), DESTINATIONS[dest]["moe"])


def reach_list(mode):
    o, d, m, lo, hi = [0], [], [], [], []
    for i, row in enumerate(REACH[mode]):
        for dest, minutes in sorted(row.items(), key=lambda kv: order(i, kv[0], kv[1])):
            d.append(dest)
            m.append(minutes)
            a, b = SPREAD.get((i, dest), (minutes, minutes))
            lo.append(a)
            hi.append(b)
        o.append(len(d))
    out = {"format": 1, "o": o, "d": d, "m": m}
    if mode == "pt":
        out["lo"], out["hi"] = lo, hi
    return out


def nearest(mode):
    near, ties, t = [], {}, []
    for i, row in enumerate(REACH[mode]):
        if not row:
            near.append(None)
            t.append(None)
            continue
        best = min(row.values())
        tied = sorted([k for k, v in row.items() if v == best], key=lambda k: order(i, k, best))
        near.append(tied[0])
        if len(tied) > 1:
            ties[str(i)] = tied[1:]
        t.append(best)
    return near, ties, t


def csr(by_school):
    lists = [[] for _ in H3]
    for d, cells in by_school.items():
        for i in cells:
            lists[i].append(d)
    o, flat = [0], []
    for item in lists:
        flat.extend(sorted(item))
        o.append(len(flat))
    return {"o": o, "d": flat}


def main():
    nearest_mode, ties, t = {S: {}}, {S: {}}, {S: {}}
    for mode in REACH:
        nearest_mode[S][mode], ties[S][mode], t[S][mode] = nearest(mode)
    fixture = {
        "note": "Hexagon 0 is real (St Lukes, 0.11 pairs cache); hexagons 1-4, Boys High and Open State College are made up.",
        "h3": H3,
        "centres": CENTRES,
        "pop": POP,
        "destinations": DESTINATIONS,
        "cells": {"t": t, "nearest_mode": nearest_mode, "ties": ties,
                  # A build before 0.12: one nearest, by the fastest way.
                  "nearest": {S: [1, 2, None, 2, 3]}},
        "schools": {f"{S}_{mode}": reach_list(mode) for mode in REACH},
        "zones": {"format": 1, "date": "2026-07-14",
                  "schools": {str(d): {"moe": DESTINATIONS[d]["moe"], "from": DESTINATIONS[d]["zone_from"], "outline": OUTLINE} for d in ZONE_IN},
                  "in": {S: csr(ZONE_IN)}, "cut": {S: csr(ZONE_CUT)}},
        "meta": {"standard_modes": ["walk", "bike_low_stress", "pt"], "routing_max_minutes": 60,
                 # As summary.json has it (schools.py meta_block), with a zone date
                 # standing in for the zone file the build does not have yet.
                 "schools": {"directory": {"file": "moe_schools_directory_2026-11-12.csv", "retrieved": "2026-11-12T10:50:20+13:00",
                                           "roll_dates": {"2026-10-01": 9}},
                             "dates": {"directory": "2026-11-12", "timetable_written": "2026-08-29", "osm_downloaded": "2026-05-04",
                                       "routing_date": "2026-09-15"},
                             "zones": "2026-07-14", "buses": "none_found",
                             "bus_note": "Auckland Transport's open timetable has no school bus services.",
                             "files": {f"{S}_{mode}.json": {} for mode in REACH}}},
    }
    OUT.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
