"""Write the small schools fixture the web tests read (fixture.json here).

It follows the 0.12.0 export contract in docs/schools.md, as round 2 of
0.12.0 writes it: school attributes in destinations.json, nearest_mode,
ties, ages and ptr in cells.json, reach lists in schools/<service>_<mode>.json
(format 2: each hexagon's schools in order of minutes, then straight-line
metres, then Ministry number, as the build sorts them, and public transport
as the quicker of R5's trip and the walk, with R5's own minutes in `r5`),
zones in schools/zones.json (format 2: In zone sets, resident shares and
split hexagons), zone outlines, stops near Mt Albert Grammar School in
schools/stops.json, and meta as summary.json has it.

`legacy` holds the same hexagons as a round-1 build wrote them (format 1
lists, R5's public transport as it is, no zones, no ages), for the tests of
how the page reads older builds.

Hexagon 0 is the St Lukes hexagon on the councillors' slide, 89bb50021a3ffff,
with its real minutes to the six nearest secondary schools by walking,
low-stress cycling and public transport, read from the 0.11 Auckland pairs
cache (services_walk, services_bike_low_stress, services_am_peak_pt) on
12 Nov 2026. School names, numbers, kinds and points are from the Ministry's
directory as TEAM holds it. Its public transport percentiles are made up.

Hexagons 1 to 4 are made up to cover the other rules: a tie, nothing within
the hour, walking quicker than public transport, and girls and boys who each
travel a different way. Hexagon 5 is 89bb50021b7ffff, south-east of MAGS,
with the real case of round 2: a 15-minute walk to MAGS against R5's 26 by
public transport (usually 23 to 30). "Boys High" and "Open State College"
are made up. Zones, resident shares, ages and stops are made up, except
that MAGS's zone covers hexagons 0 and 5 and its stop 1427 is the real one.

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

H3 = ["89bb50021a3ffff", "89bb50021a7ffff", "89bb5002133ffff", "89bb50021b3ffff", "89bb5002107ffff", "89bb50021b7ffff"]
CENTRES = [
    [-36.88539088388131, 174.72991387682092],
    [-36.883543985399534, 174.72665350209644],
    [-36.88066041254632, 174.7337623646013],
    [-36.8886795397538, 174.7296196752743],
    [-36.88250710342242, 174.73702259145824],
    [-36.88683267890702, 174.72635916136244],
]
POP = [217.4, 150.0, 80.0, 120.0, 200.0, 122.8]
# Children aged 13 to 17 (made up).
AGES = {"13_17": [25.1, 12.0, 6.0, 9.5, 20.0, 8.0], "11_12": [9.0, 4.0, 2.0, 3.0, 7.0, 3.0],
        "5_10": [20.0, 10.0, 5.0, 8.0, 15.0, 7.0], "0_4": [14.0, 8.0, 4.0, 6.0, 10.0, 5.0]}

# Minutes by hexagon and way of travelling: {destination: minutes}.
REACH = {
    "walk": [
        {0: 9, 1: 12, 2: 15, 5: 44, 4: 46},
        {},
        {},
        {2: 26},
        {3: 10, 2: 30, 8: 31},
        {2: 15},
    ],
    "bike_low_stress": [
        {1: 6, 0: 7, 2: 10, 4: 27, 5: 29},
        {2: 18},
        {},
        {2: 9},
        {},
        {2: 6},
    ],
    "pt": [
        {0: 9, 1: 12, 2: 15, 5: 29, 4: 32},
        {4: 20, 2: 20},
        {},
        {1: 27, 2: 28},
        {8: 15, 3: 20, 2: 22},
        {2: 26},
    ],
}
# Made-up 10th and 90th percentiles across departures, public transport only
# (hexagon 5 to MAGS: the real 23 to 30).
SPREAD = {(0, 2): (15, 15), (0, 4): (27, 38), (1, 2): (17, 24), (1, 4): (18, 23), (3, 2): (25, 33), (5, 2): (23, 30)}

# Zones, format 2. Each school's status on 12 Nov 2026, and the share of each
# hexagon's residents in each zone (made up, but MAGS's covers hexagons 0
# and 5 as the real one does). Hexagon 1 is split 60:40 between Western
# Springs and MAGS, so its In zone set is Western Springs alone; hexagon 3
# has 70% of its residents in MAGS's zone and the rest in none.
ZONE_STATUS = {0: ("none", None), 1: None, 2: ("in_force", "2018-06-06"), 3: ("in_force", "2009-01-01"),
               4: ("in_force", "2010-01-01"), 8: ("none", None), 9: ("upcoming_used", "2027-01-01")}
ZONE_SHARE = [{2: 1.0}, {4: 0.6, 2: 0.4}, {}, {2: 0.7}, {3: 1.0}, {2: 1.0}]
ZONE_SET = [[2], [4], [], [2], [3], [2]]
SPLIT = [1, 3]
OUTLINE = {"type": "Polygon", "coordinates": [[[174.72, -36.89], [174.74, -36.89], [174.74, -36.875], [174.72, -36.875], [174.72, -36.89]]]}
# Stops near MAGS: stop 1427 is real (95 m, no trips 7-9am in AT's open
# timetable); the rest are made up.
STOPS = [
    {"id": "1427-e66ab0d8", "code": "1427", "name": "Mount Albert Grammar School", "station": None, "lat": -36.8853, "lon": 174.7247},
    {"id": "8861-6db54877", "code": "8861", "name": "Stop A St Lukes", "station": "St Lukes", "lat": -36.88165, "lon": 174.7327},
    {"id": "9300-aaaa", "code": "9300", "name": "Baldwin Ave Train Station 1", "station": "Baldwin Ave Train Station", "lat": -36.8805, "lon": 174.7138},
]
MAGS_STOPS = [
    {"s": 0, "walk": 1, "metres": 95, "routes": [], "trips": 0},
    {"s": 1, "walk": 7, "metres": 453, "routes": [{"route": "OUT", "mode": "bus", "headsigns": ["St Lukes To Newmarket"], "trips": 10},
                                                   {"route": "22N", "mode": "bus", "headsigns": ["City Centre To New Lynn"], "trips": 4}], "trips": 14},
    {"s": 2, "walk": 12, "metres": 895, "routes": [{"route": "WEST", "mode": "train", "headsigns": ["Swanson", "Britomart"], "trips": 12}], "trips": 12},
]


def km(a, b):
    lat1, lon1 = a
    p1, p2 = math.radians(lat1), math.radians(b["lat"])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b["lon"] - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(h)))


def order(i, dest, minutes):
    """The build's order: minutes, then whole metres in a straight line, then
    Ministry number (schools.py ordered_reach)."""
    return (minutes, round(km(CENTRES[i], DESTINATIONS[dest]) * 1000), DESTINATIONS[dest]["moe"])


def reach_list(mode, reach=REACH, fmt=1):
    o, d, m, lo, hi = [0], [], [], [], []
    for i, row in enumerate(reach[mode]):
        for dest, minutes in sorted(row.items(), key=lambda kv: order(i, kv[0], kv[1])):
            d.append(dest)
            m.append(minutes)
            a, b = SPREAD.get((i, dest), (minutes, minutes))
            lo.append(a)
            hi.append(b)
        o.append(len(d))
    out = {"format": fmt, "o": o, "d": d, "m": m}
    if mode == "pt":
        out["lo"], out["hi"] = lo, hi
    return out


def merged_pt():
    """Public transport, or walking where that is quicker, pair by pair, as
    round 2 writes it: m the lower of R5 and the walk, lo and hi likewise,
    and r5 the entries where R5 is slower or missing."""
    o, d, m, lo, hi, rk, rm = [0], [], [], [], [], [], []
    for i in range(len(H3)):
        r5, walk = REACH["pt"][i], REACH["walk"][i]
        rows = []
        for dest in set(r5) | set(walk):
            t = min(x for x in (r5.get(dest), walk.get(dest)) if x is not None)
            a, b = SPREAD.get((i, dest), (r5.get(dest), r5.get(dest))) if dest in r5 else (None, None)
            w = walk.get(dest)
            lo_, hi_ = (min(x for x in (a, w) if x is not None), min(x for x in (b, w) if x is not None)) if (a is not None or w is not None) else (None, None)
            rows.append((order(i, dest, t), dest, t, lo_, hi_, w is not None and (dest not in r5 or r5[dest] > w), r5.get(dest)))
        for key, dest, t, lo_, hi_, listed, own in sorted(rows):
            if listed:
                rk.append(len(d))
                rm.append(own)
            d.append(dest)
            m.append(t)
            lo.append(lo_)
            hi.append(hi_)
        o.append(len(d))
    return {"format": 2, "service": S, "mode": "pt", "pt_or_walk": True, "o": o, "d": d, "m": m, "lo": lo, "hi": hi, "r5": {"k": rk, "m": rm}}


def from_list(lst):
    """Nearest minutes, school and ties per hexagon, from a list in order."""
    t, near, ties = [], [], {}
    for i in range(len(H3)):
        a, b = lst["o"][i], lst["o"][i + 1]
        if a == b:
            t.append(None)
            near.append(None)
            continue
        t.append(lst["m"][a])
        near.append(lst["d"][a])
        tied = [lst["d"][k] for k in range(a + 1, b) if lst["m"][k] == lst["m"][a]]
        if tied:
            ties[str(i)] = tied
    return t, near, ties


def csr_rows(rows, weights=False):
    o, d, w = [0], [], []
    for row in rows:
        items = sorted(row.items()) if weights else [(k, None) for k in sorted(row)]
        for dest, share in items:
            d.append(dest)
            w.append(share)
        o.append(len(d))
    return {"o": o, "d": d, "w": w} if weights else {"o": o, "d": d}


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


def main():
    # Round 1, as a build before round 2 wrote it.
    old_near, old_ties, old_t = {S: {}}, {S: {}}, {S: {}}
    for mode in REACH:
        old_near[S][mode], old_ties[S][mode], old_t[S][mode] = nearest(mode)
    old_meta = {"standard_modes": ["walk", "bike_low_stress", "pt"], "routing_max_minutes": 60,
                "schools": {"directory": {"file": "moe_schools_directory_2026-11-12.csv", "retrieved": "2026-11-12T10:50:20+13:00",
                                          "roll_dates": {"2026-10-01": 9}},
                            "dates": {"directory": "2026-11-12", "timetable_written": "2026-08-29", "osm_downloaded": "2026-05-04",
                                      "routing_date": "2026-09-15"},
                            "zones": None, "buses": "none_found",
                            "bus_note": "Auckland Transport's open timetable has no school bus services.",
                            "files": {f"{S}_{mode}.json": {} for mode in REACH}}}
    old_dest = [{k: v for k, v in d.items() if k != "zone"} for d in DESTINATIONS]
    # Round 2.
    lists = {f"{S}_{mode}": reach_list(mode, fmt=2) for mode in ("walk", "bike_low_stress")}
    lists[f"{S}_pt"] = merged_pt()
    nearest_mode, ties, t = {S: {}}, {S: {}}, {S: {}}
    for mode in REACH:
        t[S][mode], nearest_mode[S][mode], ties[S][mode] = from_list(lists[f"{S}_{mode}"])
    # R5's own public transport time where it is slower than the walk, or missing.
    ptr = {S: {str(i): old_t[S]["pt"][i] for i in range(len(H3))
               if t[S]["pt"][i] is not None and (old_t[S]["pt"][i] is None or old_t[S]["pt"][i] > t[S]["pt"][i])}}
    destinations = []
    for k, d in enumerate(DESTINATIONS):
        d = dict(d)
        status = ZONE_STATUS.get(k)
        if status:
            d["zone"] = {"status": status[0], "from": status[1], "next": None}
            d["zone_from"] = status[1]
        if k == 9:
            d["scheme"] = True
        if d.get("moe") is not None:
            d["point"] = "directory"
        destinations.append(d)
    zone_schools = {str(k): {"moe": DESTINATIONS[k]["moe"], "status": v[0], "from": v[1], "next": None,
                             "polygons": {S: [1000 + k]} if v[0] in ("in_force", "upcoming_used") else {}}
                    for k, v in ZONE_STATUS.items() if v}
    # MAGS's file also lists a later zone, which is not applied.
    zone_schools["2"]["next"] = {"from": "2027-01-01"}
    meta = {**old_meta,
            "version": "0.12.0",
            "formats": {"cells": 2, "school_reach": 2, "zones": 2, "zone_outlines": 1, "school_stops": 1},
            "pt_or_walk": {"rule": "public transport or walking, whichever is quicker", "slow_factor": 1.3333,
                           "covers": ["services", "schools", "jobs", "access", "fares"], "not_covered": ["cell-to-cell trips and MATE (?mate=1)"],
                           "r5_columns": "_r5"},
            "ages": {"groups": {"0_4": {"label": "children aged 0–4", "years": "early childhood", "ages": [0, 4]},
                                "5_10": {"label": "children aged 5–10", "years": "Years 1–6", "ages": [5, 10]},
                                "11_12": {"label": "children aged 11–12", "years": "Years 7–8", "ages": [11, 12]},
                                "13_17": {"label": "children aged 13–17", "years": "Years 9–13", "ages": [13, 17]}},
                     "services": {"early_childhood": "0_4", "primary_school": "5_10", "intermediate_school": "11_12", S: "13_17"},
                     "shape": "census2018_sa2"},
            "schools": {**old_meta["schools"],
                        "choices": ["all", "state", "zone", "one"],
                        "zones": {"source": {"file": "ESmaster v02102026", "version": "2026-10-02", "downloaded": "2026-11-12",
                                             "licence": "CC BY 3.0 NZ"},
                                  "reference_date": "2026-11-12",
                                  "counts": {S: {"state_english": 5, "zoned": 4, "in_force": 3, "upcoming_used": 1, "no_map": 0,
                                                 "not_applied": 0, "unclear_years": 0, "open": 1}},
                                  "upcoming": [{"moe": 99001, "name": "Open State College", "from": "2027-01-01", "applied": True},
                                               {"moe": 69, "name": "Mt Albert Grammar School", "from": "2027-01-01", "applied": False}],
                                  "split_people": {S: 270.0}, "children_in_split": {S: 21.5}},
                        "stops": {"file": "schools/stops.json", "date": "2026-09-15", "window": ["07:00", "08:59"], "gtfs": "at_gtfs_2026-09-01.zip",
                                  "schools_with_none": 0},
                        "points": {"audited": 9, "moved": [], "to_check": 0, "rule": "D5-1"}}}
    fixture = {
        "note": ("Hexagons 0 and 5 are real (St Lukes, and south-east of MAGS); hexagons 1-4, Boys High and Open State College, "
                 "the zones' shares, the ages and all stops but 1427 are made up."),
        "h3": H3,
        "centres": CENTRES,
        "pop": POP,
        "destinations": destinations,
        "cells": {"t": t, "nearest_mode": nearest_mode, "ties": ties, "ages": AGES, "ptr": ptr,
                  # A build before 0.12: one nearest, by the fastest way.
                  "nearest": {S: [1, 2, None, 2, 3, 2]}},
        "schools": lists,
        "zones": {"format": 2, "source": meta["schools"]["zones"]["source"], "reference_date": "2026-11-12",
                  "rule": "made up for the tests",
                  "schools": zone_schools,
                  "in": {S: csr_rows([{d: None for d in row} for row in ZONE_SET])},
                  "share": {S: csr_rows(ZONE_SHARE, weights=True)},
                  "split": {S: SPLIT}},
        "outlines": {"format": 1, "service": S, "simplified_m": 5, "schools": {"2": OUTLINE, "3": OUTLINE, "4": OUTLINE}},
        "stops": {"format": 1, "date": "2026-09-15", "window": ["07:00", "08:59"], "max_walk_minutes": 15, "gtfs": "at_gtfs_2026-09-01.zip",
                  "stops": STOPS, "schools": {"2": MAGS_STOPS, "3": []}},
        "meta": meta,
        "legacy": {"destinations": old_dest, "meta": old_meta,
                   "cells": {"t": old_t, "nearest_mode": old_near, "ties": old_ties, "nearest": {S: [1, 2, None, 2, 3, 2]}},
                   "schools": {f"{S}_{mode}": reach_list(mode) for mode in REACH}},
    }
    OUT.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
