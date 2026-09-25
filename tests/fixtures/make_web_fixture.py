"""Write a small synthetic dataset for testing the web app without a full build.

The values are made up. They have a plausible shape (times grow with distance,
deprivation varies across the area, a few places have indirect walks or no
low-stress route) so every view and control can be exercised. Never publish them.

    python tests/fixtures/make_web_fixture.py
    open http://localhost:8812/web/?data=../tests/fixtures/web/

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

    for cell, centre in zip(cells, centres):
        east = (centre[0] - CBD[0]) / (BBOX[2] - BBOX[0])
        south = (CBD[1] - centre[1]) / (BBOX[3] - BBOX[1])
        nzdep = max(1, min(10, round(5 + 6 * east + 5 * south + random.gauss(0, 1.5))))
        pop = round(random.uniform(20, 380), 1)
        severed = random.random() < 0.08
        no_low_stress = east > 0.15 and random.random() < 0.6
        slow_bus = south > 0.3
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

    out.mkdir(parents=True, exist_ok=True)
    payload = {"h3": cells, **fields, "freq": freq, "t": t, "km": km_out, "nearest": nearest, "jobs": jobs,
               "fair": fair, "access": access, "cost": cost, "zone": zone_of, "groups": groups}
    files = {
        "cells.json": payload,
        "summary.json": {"meta": meta, "services": [], "jobs": [], "areas": {}},
        "places.json": places,
        "destinations.json": destinations,
        "overlays.json": overlays,
    }
    for name, content in files.items():
        (out / name).write_text(json.dumps(content, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(cells)} synthetic cells to {out}")


if __name__ == "__main__":
    main()
