"""Write a small synthetic dataset for testing the web app without a full build.

The values are made up. They have a plausible shape (times grow with distance,
deprivation varies across the area, a few places have indirect walks or no
low-stress route) so every view and control can be exercised. Never publish them.

The schools follow the 0.12.0 round-2 export (docs/schools.md): attributes in
destinations.json, a reach list per service and mode in schools/ (format 2,
public transport as the quicker of the trip and the walk, R5's own minutes in
`r5`), children by age in cells.json `ages`, R5's minutes in `ptr`, walks
needing no fare as cost `z0`, zones.json format 2 (each state school with a
scheme zones the hexagons nearest it; hexagons near a zone line are split
60:40), zone outlines, and stops near each school.

    python tests/fixtures/make_web_fixture.py
    open "http://localhost:8812/web/?city=web&data=../tests/fixtures/"

A larger area, for checking speed at the size of a real build:

    python tests/fixtures/make_web_fixture.py --out build/fixture-large --bbox 174.45 -37.25 175.05 -36.60
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import h3

OUT = Path(__file__).parent / "web"
SERVICES = {
    "supermarket": ("Supermarket", "interpeak", 20, 10),
    "gp": ("GP or medical centre", "interpeak", 20, 16),
    "pharmacy": ("Pharmacy", "interpeak", 20, 14),
    "primary_school": ("Primary school", "am_peak", 15, 22),
    "intermediate_school": ("Intermediate school", "am_peak", 20, 7),
    "secondary_school": ("Secondary school", "am_peak", 30, 8),
}
MODES = ["walk", "bike_low_stress", "bike", "pt", "car"]

# A stand-in for Auckland's fare zones: a chain out from the centre, plus one
# to the side, so zone counts of one to four all occur. The fares are the real
# published ones, because the browser's arithmetic is what is being tested.
ZONES = ["City", "Isthmus", "Northern Manukau", "Southern Manukau", "Waitakere"]
ZONE_ADJACENCY = {
    "City": ["Isthmus"],
    "Isthmus": ["City", "Northern Manukau", "Waitakere"],
    "Northern Manukau": ["Isthmus", "Southern Manukau"],
    "Southern Manukau": ["Northern Manukau"],
    "Waitakere": ["Isthmus"],
}
FARE_TABLE = {
    "adult": {"hop": {"1": 3.0, "2": 4.9, "3": 6.5, "4": 7.9}, "cash": {"1": 4.0, "2": 6.0, "3": 8.0, "4": 10.0}},
    "child_5_15": {"hop": {"1": 1.55, "2": 2.9, "3": 3.9, "4": 4.75}, "cash": {"1": 2.0, "2": 3.5, "3": 4.5, "4": 5.5}},
    "secondary_student": {"hop": {"1": 1.55, "2": 2.9, "3": 3.9, "4": 4.75}, "cash": {"1": 2.0, "2": 3.5, "3": 4.5, "4": 5.5}},
    "tertiary_student": {"hop": {"1": 1.55, "2": 2.9, "3": 3.9, "4": 4.75}, "cash": {"1": 4.0, "2": 6.0, "3": 8.0, "4": 10.0}},
    "accessible": {"hop": {"1": 1.55, "2": 2.9, "3": 3.9, "4": 4.75}, "cash": {"1": 2.0, "2": 3.5, "3": 4.5, "4": 5.5}},
    "community_connect": {"hop": {"1": 1.5, "2": 2.45, "3": 3.25, "4": 3.95}, "cash": {"1": 4.0, "2": 6.0, "3": 8.0, "4": 10.0}},
}
PROFILES = [
    {"key": "adult", "label": "Adult", "ages": "19 to 64"},
    {"key": "child_5_15", "label": "Child", "ages": "5 to 15"},
    {"key": "secondary_student", "label": "Secondary student", "ages": "13 to 18"},
    {"key": "tertiary_student", "label": "Tertiary student", "ages": "18 and over"},
    {"key": "community_connect", "label": "Community Services Card", "ages": "any"},
    {"key": "accessible", "label": "Accessible concession", "ages": "any"},
    {"key": "supergold", "label": "SuperGold", "ages": "65 and over"},
]
ACCESS_KEYS = {"jobs": "Jobs", "everyday": "Everyday services", "education": "Schools", "all": "All opportunities"}


def zone_distance(adjacency, cap=4):
    """Zones travelled through, counted as nodes on the shortest path."""
    from collections import deque

    out = {}
    for start in adjacency:
        seen = {start: 1}
        queue = deque([start])
        while queue:
            here = queue.popleft()
            for nxt in adjacency[here]:
                if nxt not in seen:
                    seen[nxt] = seen[here] + 1
                    queue.append(nxt)
        for zone, n in seen.items():
            out[(start, zone)] = min(n, cap)
    return out
BBOX = (174.66, -36.97, 174.88, -36.80)
CBD = (174.765, -36.848)


def km(a, b) -> float:
    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


def cap(value: float) -> int | None:
    return int(round(value)) if value <= 60 else None


SCHOOL_YEARS = {"primary_school": [1, 6], "intermediate_school": [7, 8], "secondary_school": [9, 13]}
AGE_OF = {"early_childhood": "0_4", "primary_school": "5_10", "intermediate_school": "11_12", "secondary_school": "13_17"}
AGE_SHARE = {"0_4": 5 / 15, "5_10": 6 / 15, "11_12": 2 / 15, "13_17": 5 / 15}


def csr(rows, weights=False):
    """Offsets and flat lists, as the reach lists and zones.json hold them."""
    o, d, w = [0], [], []
    for row in rows:
        for key, value in row:
            d.append(key)
            w.append(value)
        o.append(len(d))
    return {"o": o, "d": d, "w": w} if weights else {"o": o, "d": d}


def school_files(cells, centres, destinations, dest_points, t, nearest, fields, cost, slow, severed, meta):
    """The schools part of the round-2 export, worked out from made-up pair
    times, which also replace the school services' times in `t`."""
    rng = random.Random(11)
    files = {}
    n = len(cells)
    ptr = {}
    nearest_mode = {}
    ties = {}
    zones = {"format": 2, "source": {"file": "made up", "version": "2026-10-02", "downloaded": "2026-11-12", "licence": "none: made up"},
             "reference_date": "2026-11-12", "rule": "made up for the fixture", "schools": {}, "in": {}, "share": {}, "split": {}}
    outlines = {}
    stops = {"format": 1, "date": "2026-09-15", "window": ["07:00", "08:59"], "max_walk_minutes": 15, "gtfs": "made_up_gtfs.zip",
             "stops": [], "schools": {}}
    counts = {}
    moe = 9000
    for service, years in SCHOOL_YEARS.items():
        schools = dest_points[service]
        for k, (d, point) in enumerate(schools):
            moe += 1
            state = k % 4 != 3
            girls = service == "secondary_school" and k == 1
            dest = destinations[d]
            dest.update({
                "name": f"Testville {('State' if state else 'Integrated')} {service.split('_')[0].title()} {k + 1}",
                "moe": moe, "kind": "state" if state else "integrated", "medium": "english", "language": "english",
                "sex": {service: "girls" if girls else "co-ed"}, "years": years, "roll": 300 + 37 * k, "roll_date": "2026-10-01",
                "scheme": state and k % 2 == 0, "routed_to": "point", "point": "directory",
            })
            status = ("in_force" if k != 4 else "upcoming_used") if dest["scheme"] else "none"
            dest["zone"] = {"status": status, "from": "2027-01-01" if status == "upcoming_used" else ("2018-06-06" if status == "in_force" else None), "next": None}
            dest["zone_from"] = dest["zone"]["from"]
            zones["schools"][str(d)] = {"moe": moe, "status": status, "from": dest["zone"]["from"], "next": None,
                                        "polygons": {service: [moe]} if status != "none" else {}}
            # Two stops near each school, made up.
            rows = []
            for j in range(2):
                stops["stops"].append({"id": f"{moe}-{j}", "code": str(moe * 10 + j), "name": f"{dest['name']} stop {j + 1}", "station": None,
                                       "lat": round(point[1] + 0.002 * (j + 1), 5), "lon": round(point[0] + 0.001 * (j - 0.5), 5)})
                trips = rng.randint(0, 12)
                rows.append({"s": len(stops["stops"]) - 1, "walk": 2 + 5 * j, "metres": 150 + 400 * j,
                             "routes": [{"route": f"{10 + j}", "mode": "bus", "headsigns": ["Testville centre"], "trips": trips}] if trips else [], "trips": trips})
            stops["schools"][str(d)] = rows
        # Pair times, made up from the straight line; R5's public transport
        # walks all the way only up to 15 minutes.
        pairs = {m: [[] for _ in range(n)] for m in ["walk", "bike_low_stress", "bike", "pt_r5", "car"]}
        for i, centre in enumerate(centres):
            for d, point in schools:
                dist = km(centre, point)
                walk = dist / 4.8 * 60 * rng.uniform(1.15, 1.45) * (2.6 if severed[i] else 1)
                bus = 5 + rng.uniform(3, 10) + dist / 18 * 60 * 1.3 + (12 if slow[i] else 0)
                r5 = min(bus, walk) if walk <= 15 else bus
                for mode, value in (("walk", walk), ("bike_low_stress", dist / 15 * 60 * rng.uniform(1.3, 1.9) + 1), ("bike", dist / 15 * 60 * 1.2 + 1),
                                    ("pt_r5", r5), ("car", 2 + dist / 30 * 60 * 1.3)):
                    minutes = math.floor(value)
                    if minutes <= 60:
                        pairs[mode][i].append((d, minutes, round(dist * 1000)))
        def ordered(row):
            return sorted(row, key=lambda e: (e[1], e[2], destinations[e[0]]["moe"]))
        lists = {}
        for mode in ["walk", "bike_low_stress", "bike", "car"]:
            rows = [ordered(r) for r in pairs[mode]]
            lists[mode] = {"format": 2, "service": service, "mode": mode, "complete": True, **csr([[(d, m) for d, m, _ in r] for r in rows])}
            lists[mode]["m"] = lists[mode].pop("w", None) or [m for r in rows for _, m, _ in r]
        merged_rows, rk, rm, lo, hi = [], [], [], [], []
        for i in range(n):
            walk = {d: m for d, m, _ in pairs["walk"][i]}
            r5 = {d: (m, metres) for d, m, metres in pairs["pt_r5"][i]}
            metres = {d: x for d, _, x in pairs["walk"][i] + pairs["pt_r5"][i]}
            row = []
            for d in set(walk) | set(r5):
                own = r5.get(d, (None,))[0]
                m = min(x for x in (own, walk.get(d)) if x is not None)
                row.append((d, m, metres[d], own, d in walk and (own is None or own > walk[d])))
            merged_rows.append(ordered(row))
        flat = 0
        for row in merged_rows:
            for d, m, _, own, listed in row:
                if listed:
                    rk.append(flat)
                    rm.append(own)
                spread = rng.randint(0, 4)
                lo.append(m if listed else max(0, m - spread))
                hi.append(m if listed else min(60, m + spread) if m + spread <= 60 else None)
                flat += 1
        lists["pt"] = {"format": 2, "service": service, "mode": "pt", "window": "am_peak", "complete": True, "pt_or_walk": True,
                       **csr([[(d, m) for d, m, *_ in r] for r in merged_rows]), "lo": lo, "hi": hi, "r5": {"k": rk, "m": rm}}
        lists["pt"]["m"] = [m for r in merged_rows for _, m, *_ in r]
        for mode in ["walk", "bike_low_stress", "bike", "car"]:
            lists[mode]["m"] = [m for r in (ordered(x) for x in pairs[mode]) for _, m, _ in r]
        # The comparison ways (any bike route, car) are left out to keep the
        # fixture small: the page then shows Best for them, as it does for a
        # build without them.
        for mode in ("walk", "bike_low_stress", "pt"):
            files[f"schools/{service}_{mode}.json"] = lists[mode]
        # The times shown under All are the lists' nearest.
        nearest_mode[service] = {}
        ties[service] = {}
        for mode, body in lists.items():
            times, near, tied = [], [], {}
            for i in range(n):
                a, b = body["o"][i], body["o"][i + 1]
                if a == b:
                    times.append(None)
                    near.append(None)
                    continue
                times.append(body["m"][a])
                near.append(body["d"][a])
                same = [body["d"][k] for k in range(a + 1, b) if body["m"][k] == body["m"][a]]
                if same:
                    tied[str(i)] = same
            t[service][mode] = times
            nearest_mode[service][mode] = near
            ties[service][mode] = tied
        nearest[service] = nearest_mode[service]["walk"]
        r5_nearest = []
        for i in range(n):
            own = [m for _, m, _ in pairs["pt_r5"][i]]
            r5_nearest.append(min(own) if own else None)
        ptr[service] = {str(i): r5_nearest[i] for i in range(n)
                        if t[service]["pt"][i] is not None and (r5_nearest[i] is None or r5_nearest[i] > t[service]["pt"][i])}
        for z in range(1, 5):
            cost[service][f"z{z}"] = list(t[service]["pt"])
        # Zones: each zoned school zones the hexagons nearer it than any other
        # zoned school; hexagons almost as near another are split 60:40.
        zoned = [(d, point) for d, point in schools if zones["schools"][str(d)]["status"] in ("in_force", "upcoming_used")]
        in_rows, share_rows, split = [], [], []
        members = {d: [] for d, _ in zoned}
        for i, centre in enumerate(centres):
            ranked = sorted(zoned, key=lambda e: km(centre, e[1]))
            if not ranked:
                in_rows.append([])
                share_rows.append([])
                continue
            first = ranked[0]
            members[first[0]].append(centre)
            second = ranked[1] if len(ranked) > 1 else None
            if second and km(centre, second[1]) < km(centre, first[1]) * 1.08:
                in_rows.append([(first[0], None)])
                share_rows.append(sorted([(first[0], 0.6), (second[0], 0.4)]))
                split.append(i)
            else:
                in_rows.append([(first[0], None)])
                share_rows.append([(first[0], 1.0)])
        zones["in"][service] = csr(in_rows)
        zones["share"][service] = csr(share_rows, weights=True)
        zones["split"][service] = split
        outlines[service] = {"format": 1, "service": service, "simplified_m": 5, "schools": {}}
        for d, pts in members.items():
            if not pts:
                continue
            w, e = min(p[0] for p in pts) - 0.002, max(p[0] for p in pts) + 0.002
            so, no = min(p[1] for p in pts) - 0.002, max(p[1] for p in pts) + 0.002
            outlines[service]["schools"][str(d)] = {"type": "Polygon", "coordinates": [[[round(w, 5), round(so, 5)], [round(e, 5), round(so, 5)],
                                                                                        [round(e, 5), round(no, 5)], [round(w, 5), round(no, 5)], [round(w, 5), round(so, 5)]]]}
        st = [d for d, _ in schools if destinations[d]["kind"] == "state"]
        counts[service] = {"all": len(schools), "state": len(st), "kind": {"state": len(st), "integrated": len(schools) - len(st), "private": 0, "charter": 0},
                           "state_maori": 0, "state_pacific": 0, "state_language_unknown": 0,
                           "state_sex": {"co-ed": sum(1 for d in st if destinations[d]["sex"][service] == "co-ed"),
                                         "girls": sum(1 for d in st if destinations[d]["sex"][service] == "girls"), "boys": 0}}
    for k, body in outlines.items():
        files[f"schools/zone_outlines_{k}.json"] = body
    files["schools/zones.json"] = zones
    files["schools/stops.json"] = stops
    # Every other service: R5 walks all the way only up to 15 minutes, so
    # where walking is quicker past that, R5's own time is kept in ptr.
    meta["schools"] = {
        "directory": {"file": "made up", "retrieved": "2026-11-12T10:00:00+13:00", "roll_dates": {"2026-10-01": sum(len(dest_points[s]) for s in SCHOOL_YEARS)}},
        "dates": {"directory": "2026-11-12", "timetable_written": "2026-08-29", "osm_downloaded": "2026-05-04", "routing_date": "2026-09-15"},
        "services": counts, "choices": ["all", "state", "zone", "one"],
        "zones": {"source": zones["source"], "reference_date": "2026-11-12", "counts": {}, "upcoming": [], "split_people": {}, "children_in_split": {}},
        "buses": "none_found", "bus_note": "Testville's timetable has no school buses.",
        "stops": {"file": "schools/stops.json", "date": "2026-09-15", "window": ["07:00", "08:59"], "gtfs": "made_up_gtfs.zip", "schools_with_none": 0},
        "points": {"audited": sum(len(dest_points[s]) for s in SCHOOL_YEARS), "moved": [], "to_check": 0, "rule": "D5-1"},
        "files": {name.split("/", 1)[1]: {} for name in files if name.startswith("schools/") and "_" in name.split("/", 1)[1] and not name.endswith(("zones.json", "stops.json")) and "zone_outlines" not in name},
    }
    return files, ptr, nearest_mode, ties


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a synthetic TEAM web dataset.")
    parser.add_argument("--out", default=str(OUT), help="folder to write the JSON files to")
    parser.add_argument("--bbox", nargs=4, type=float, default=BBOX, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    args = parser.parse_args()
    out = Path(args.out)
    random.seed(7)
    lon0, lat0, lon1, lat1 = args.bbox
    # Keep the density of destinations the same when the area changes.
    scale = max(1.0, ((lon1 - lon0) * (lat1 - lat0)) / ((BBOX[2] - BBOX[0]) * (BBOX[3] - BBOX[1])))
    ring = [[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]
    cells = sorted(h3.geo_to_cells({"type": "Polygon", "coordinates": [ring]}, 9))
    centres = [(lng, lat) for lat, lng in (h3.cell_to_latlng(c) for c in cells)]

    destinations, dest_points = [], {}
    for service, (label, _, _, n) in SERVICES.items():
        dest_points[service] = []
        for k in range(max(1, round(n * scale))):
            point = (random.uniform(lon0, lon1), random.uniform(lat0, lat1))
            dest_points[service].append((len(destinations), point))
            destinations.append({"name": f"Test {label.lower()} {k + 1}", "services": [service], "lon": round(point[0], 5), "lat": round(point[1], 5)})

    members_by_parent: dict[str, list[int]] = {}
    for i, cell in enumerate(cells):
        members_by_parent.setdefault(h3.cell_to_parent(cell, 7), []).append(i)
    places = []
    parent_index = {}
    for k, (parent, members) in enumerate(sorted(members_by_parent.items())):
        lons = [centres[i][0] for i in members]
        lats = [centres[i][1] for i in members]
        parent_index[parent] = k
        places.append({
            "name": f"Test area {k + 1:03d}",
            "board": "Board A" if sum(lons) / len(lons) < CBD[0] else "Board B",
            "lon": round(sum(lons) / len(lons), 5),
            "lat": round(sum(lats) / len(lats), 5),
            "bbox": [round(min(lons), 4), round(min(lats), 4), round(max(lons), 4), round(max(lats), 4)],
            "population": 0,
        })

    fields = {name: [] for name in ["pop", "place", "nzdep", "nocar", "kids", "older", "drive", "m_stop", "m_rail", "m_bike"]}
    groups = {name: [] for name in ["low_income", "maori", "pacific"]}
    freq = {"am_peak": [], "interpeak": []}
    t = {s: {m: [] for m in MODES} for s in SERVICES}
    km_out = {s: [] for s in SERVICES}
    nearest = {s: [] for s in SERVICES}
    jobs = {m: {"30": [], "45": []} for m in MODES}
    fair = {"pt": {"30": [], "45": []}, "bike_low_stress": {"30": [], "45": []}}
    zone_of = []
    cost = {s: {f"z{z}": [] for z in range(1, 5)} for s in list(SERVICES) + ["jobs"]}
    access = {m: {k: [] for k in ACCESS_KEYS} for m in ["walk", "pt", "bike_low_stress"]}
    distance_between = zone_distance(ZONE_ADJACENCY)

    severed_at, slow_at, walk_at, bus_at = [], [], {s: [] for s in SERVICES}, {s: [] for s in SERVICES}
    for cell, centre in zip(cells, centres):
        east = (centre[0] - CBD[0]) / (BBOX[2] - BBOX[0])
        south = (CBD[1] - centre[1]) / (BBOX[3] - BBOX[1])
        nzdep = max(1, min(10, round(5 + 6 * east + 5 * south + random.gauss(0, 1.5))))
        pop = round(random.uniform(20, 380), 1)
        severed = random.random() < 0.08
        no_low_stress = east > 0.15 and random.random() < 0.6
        slow_bus = south > 0.3
        severed_at.append(severed)
        slow_at.append(slow_bus)
        frequency = max(0.0, round(random.gauss(10 - 12 * max(east, south), 4), 1))
        fields["pop"].append(pop)
        fields["place"].append(parent_index[h3.cell_to_parent(cell, 7)])
        fields["nzdep"].append(nzdep)
        fields["nocar"].append(max(1, min(40, round(3 + nzdep * 2.2 + random.gauss(0, 3)))))
        fields["kids"].append(max(5, min(35, round(14 + nzdep + random.gauss(0, 3)))))
        fields["older"].append(max(3, min(30, round(20 - nzdep + random.gauss(0, 3)))))
        fields["drive"].append(max(20, min(90, round(55 + 20 * east + random.gauss(0, 5)))))
        fields["m_stop"].append(round(abs(random.gauss(400 + 1500 * max(east, 0), 300))))
        fields["m_rail"].append(round(abs(random.gauss(1800, 900))))
        fields["m_bike"].append(round(abs(random.gauss(300 + 2000 * max(east, 0), 400))))
        groups["low_income"].append(max(4, min(70, round(8 + nzdep * 4 + random.gauss(0, 4)))))
        groups["maori"].append(max(2, min(45, round(4 + nzdep * 1.4 + random.gauss(0, 3)))))
        groups["pacific"].append(max(1, min(60, round(1 + nzdep * 2.0 + random.gauss(0, 3)))))
        freq["am_peak"].append(frequency)
        freq["interpeak"].append(round(frequency * 0.7, 1))
        places[fields["place"][-1]]["population"] += pop

        for service in SERVICES:
            best = min(dest_points[service], key=lambda d: km(centre, d[1]))
            distance = km(centre, best[1])
            km_out[service].append(round(distance, 2))
            nearest[service].append(best[0])
            walk = distance / 4.8 * 60 * random.uniform(1.15, 1.45) * (2.6 if severed else 1)
            bike_any = distance / 15 * 60 * 1.2 + 1
            bike_low = None if no_low_stress else cap(distance / 15 * 60 * random.uniform(1.3, 1.9) + 1)
            bus = 5 + random.uniform(3, 10) + distance / 18 * 60 * 1.3 + (12 if slow_bus else 0)
            car = 2 + distance / 30 * 60 * 1.3
            t[service]["walk"].append(cap(walk))
            t[service]["bike_low_stress"].append(bike_low)
            t[service]["bike"].append(cap(bike_any))
            t[service]["pt"].append(cap(min(bus, walk)))
            t[service]["car"].append(cap(car))
            walk_at[service].append(cap(walk))
            bus_at[service].append(cap(bus) if walk > 15 else cap(min(bus, walk)))

        to_cbd = km(centre, CBD)
        # Zone by ring out from the centre, with the west put in its own zone.
        if to_cbd < 2.5:
            zone = "City"
        elif centre[0] < CBD[0] - 0.06:
            zone = "Waitakere"
        elif to_cbd < 6:
            zone = "Isthmus"
        elif to_cbd < 10:
            zone = "Northern Manukau"
        else:
            zone = "Southern Manukau"
        zone_of.append(zone)
        for service in SERVICES:
            # The nearest destination sits in the zone of the cell it is near;
            # a trip of n zones only counts once the budget covers n.
            need = distance_between[(zone, "City")] if service in ("supermarket", "gp") else 1
            need = max(1, min(4, need))
            pt_time = t[service]["pt"][-1]
            for z in range(1, 5):
                cost[service][f"z{z}"].append(pt_time if z >= need else None)
        base = 42 * math.exp(-to_cbd / 5.5)
        for mode, factor in {"walk": 0.12, "bike_low_stress": 0.45, "bike": 0.8, "pt": 1.0, "car": 2.1}.items():
            share45 = max(0.1, min(95.0, base * factor * random.uniform(0.8, 1.2)))
            jobs[mode]["45"].append(round(share45, 2))
            jobs[mode]["30"].append(round(share45 * 0.55, 2))
        for mode in fair:
            level = max(0.1, math.exp(-to_cbd / 7) * 2.4 * random.uniform(0.7, 1.3))
            fair[mode]["45"].append(round(level, 2))
            fair[mode]["30"].append(round(level * 0.9, 2))
        need_jobs = max(1, min(4, distance_between[(zone, "City")]))
        for z in range(1, 5):
            reach = jobs["pt"]["45"][-1] * (0.35 if z < need_jobs else 1.0)
            cost["jobs"][f"z{z}"].append(round(reach, 2))
        for mode, factor in {"walk": 0.3, "pt": 1.0, "bike_low_stress": 0.6}.items():
            index = max(2.0, 100 * factor * math.exp(-to_cbd / 6) * random.uniform(0.8, 1.2) * 2.2)
            for key in ACCESS_KEYS:
                access[mode][key].append(round(index * random.uniform(0.85, 1.15)))

    for place in places:
        place["population"] = round(place["population"])

    meta = {
        "version": "0.1.0-fixture",
        "built": "2026-09-11",
        "region": "Synthetic test data",
        "naming": {
            "place": "Testville",
            "residents": "Testvillians",
            "possessive": "Testville's",
            "slug": "testville",
            "agency": "Test Transit",
        },
        "routing_date": "2026-09-15",
        "windows": {"am_peak": {"start": "07:00", "minutes": 120}, "interpeak": {"start": "10:00", "minutes": 120}},
        "modes": {m: m for m in MODES},
        "standard_modes": ["walk", "bike_low_stress", "pt"],
        "services": {s: {"label": v[0], "standard_minutes": v[2], "window": v[1]} for s, v in SERVICES.items()},
        "jobs": {"thresholds": [30, 45], "window": "am_peak", "total": 850000},
        "access": {
            "modes": ["walk", "pt", "bike_low_stress"],
            "beta_modes": ["bike_low_stress"],
            "max_minutes": 45,
            "keys": ACCESS_KEYS,
            "functions": {},
            "purposes": {s: v[0] for s, v in SERVICES.items()},
        },
        "fares": {
            "mode": "pt",
            "max_minutes": 45,
            "purposes": list(SERVICES) + ["jobs"],
            "budget": {"min": 0, "max": 20, "step": 0.5, "default": None, "return_trip": True},
            "profiles": PROFILES,
            "zone_cap": 4,
            "zones": ZONES,
            "adjacency": ZONE_ADJACENCY,
            "fares": FARE_TABLE,
            "free": {"supergold": {"free_from": "09:00"}, "child_0_4": "Under 5 travel free."},
            "caps": {"hop_7_day": 50.0, "contactless_daily": 20.0},
            "source_url": "https://at.govt.nz/bus-train-ferry/fares-and-discounts/bus-and-train-fares",
            "read_on": "2026-09-25",
        },
        "groups": {
            "everyone": "Everyone",
            "no_car": "People in households without a car",
            "children": "Children under 15",
            "older": "People aged 65 and over",
            "low_income": "People in households under $70,000",
            "maori": "Maori",
            "pacific": "Pacific peoples",
        },
        "totals": {"cells": len(cells), "population": round(sum(fields["pop"]))},
        "destinations": {s: len(v) for s, v in dest_points.items()},
    }

    def line(points):
        return {"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": points}}

    overlays = {
        "rail": {"type": "FeatureCollection", "features": [line([[174.70, -36.95], [174.765, -36.848], [174.86, -36.90]])]},
        "ferry": {"type": "FeatureCollection", "features": [line([[174.765, -36.842], [174.80, -36.82]])]},
        "frequent_bus": {"type": "FeatureCollection", "features": [line([[174.68, -36.88], [174.765, -36.85], [174.84, -36.86]])]},
        "bus": {"type": "FeatureCollection", "features": []},
        "cycling": {"type": "FeatureCollection", "features": [
            {**line([[174.72, -36.87], [174.765, -36.85]]), "properties": {"class": "low_stress", "facility": "Off-road shared path"}},
        ]},
    }

    school, ptr, nearest_mode, ties = school_files(cells, centres, destinations, dest_points, t, nearest, fields, cost, slow_at, severed_at, meta)
    for service in SERVICES:
        if service in SCHOOL_YEARS:
            continue
        ptr[service] = {str(i): bus_at[service][i] for i in range(len(cells))
                        if t[service]["pt"][i] is not None and (bus_at[service][i] is None or bus_at[service][i] > t[service]["pt"][i])}
    # Walks need no fare: z0 is the walk within the fare cap.
    for service in SERVICES:
        cost[service]["z0"] = [w if w is not None and w <= 45 else None for w in t[service]["walk"]]
    cost["jobs"]["z0"] = list(jobs["walk"]["45"])
    ages = {g: [round(p * k / 100 * f, 1) for p, k in zip(fields["pop"], fields["kids"])] for g, f in AGE_SHARE.items()}
    meta["formats"] = {"cells": 2, "school_reach": 2, "zones": 2, "zone_outlines": 1, "school_stops": 1}
    meta["pt_or_walk"] = {"rule": "public transport or walking, whichever is quicker", "slow_factor": 1.3333,
                          "covers": ["services", "schools", "fares"], "not_covered": ["cell-to-cell trips and MATE (?mate=1)"], "r5_columns": "_r5"}
    meta["ages"] = {"groups": {g: {"label": f"children aged {g.replace('_', '–')}", "ages": [int(x) for x in g.split("_")],
                                   "years": {"5_10": "Years 1–6", "11_12": "Years 7–8", "13_17": "Years 9–13"}.get(g, "early childhood")} for g in AGE_SHARE},
                    "services": {s: g for s, g in AGE_OF.items() if s in SERVICES}, "shape": "made up"}

    out.mkdir(parents=True, exist_ok=True)
    payload = {"h3": cells, **fields, "freq": freq, "t": t, "km": km_out, "nearest": nearest, "nearest_mode": nearest_mode, "ties": ties,
               "jobs": jobs, "fair": fair, "access": access, "cost": cost, "zone": zone_of, "groups": groups, "ages": ages, "ptr": ptr}
    files = {
        "cells.json": payload,
        "summary.json": {"meta": meta, "services": [], "jobs": [], "areas": {}},
        "places.json": places,
        "destinations.json": destinations,
        "overlays.json": overlays,
        **school,
    }
    (out / "schools").mkdir(exist_ok=True)
    for name, content in files.items():
        (out / name).write_text(json.dumps(content, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(cells)} synthetic cells to {out}")


if __name__ == "__main__":
    main()
