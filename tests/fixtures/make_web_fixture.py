"""Write a small synthetic dataset for testing the web app without a full build.

The values are made up. They have a plausible shape (times grow with distance,
deprivation varies across the area, a few places have indirect walks or no
low-stress route) so every view and control can be exercised. Never publish them.

    python tests/fixtures/make_web_fixture.py
    open http://localhost:8812/web/?data=../tests/fixtures/web/
"""

from __future__ import annotations

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
BBOX = (174.66, -36.97, 174.88, -36.80)
CBD = (174.765, -36.848)


def km(a, b) -> float:
    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


def cap(value: float) -> int | None:
    return int(round(value)) if value <= 60 else None


def main() -> None:
    random.seed(7)
    lon0, lat0, lon1, lat1 = BBOX
    ring = [[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]
    cells = sorted(h3.geo_to_cells({"type": "Polygon", "coordinates": [ring]}, 9))
    centres = [(lng, lat) for lat, lng in (h3.cell_to_latlng(c) for c in cells)]

    destinations, dest_points = [], {}
    for service, (label, _, _, n) in SERVICES.items():
        dest_points[service] = []
        for k in range(n):
            point = (random.uniform(lon0, lon1), random.uniform(lat0, lat1))
            dest_points[service].append((len(destinations), point))
            destinations.append({"name": f"Test {label.lower()} {k + 1}", "services": [service], "lon": round(point[0], 5), "lat": round(point[1], 5)})

    parents = sorted({h3.cell_to_parent(c, 7) for c in cells})
    places = []
    parent_index = {}
    for k, parent in enumerate(parents):
        members = [i for i, c in enumerate(cells) if h3.cell_to_parent(c, 7) == parent]
        lons = [centres[i][0] for i in members]
        lats = [centres[i][1] for i in members]
        parent_index[parent] = k
        places.append({
            "name": f"Test area {k + 1:02d}",
            "board": "Board A" if sum(lons) / len(lons) < CBD[0] else "Board B",
            "lon": round(sum(lons) / len(lons), 5),
            "lat": round(sum(lats) / len(lats), 5),
            "bbox": [round(min(lons), 4), round(min(lats), 4), round(max(lons), 4), round(max(lats), 4)],
            "population": 0,
        })

    fields = {name: [] for name in ["pop", "place", "nzdep", "nocar", "kids", "older", "drive", "m_stop", "m_rail", "m_bike"]}
    freq = {"am_peak": [], "interpeak": []}
    t = {s: {m: [] for m in MODES} for s in SERVICES}
    km_out = {s: [] for s in SERVICES}
    nearest = {s: [] for s in SERVICES}
    jobs = {m: {"30": [], "45": []} for m in MODES}
    fair = {"pt": {"30": [], "45": []}, "bike_low_stress": {"30": [], "45": []}}

    for i, (cell, centre) in enumerate(zip(cells, centres)):
        east = (centre[0] - CBD[0]) / (lon1 - lon0)
        south = (CBD[1] - centre[1]) / (lat1 - lat0)
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
        base = 42 * math.exp(-to_cbd / 5.5)
        for mode, scale in {"walk": 0.12, "bike_low_stress": 0.45, "bike": 0.8, "pt": 1.0, "car": 2.1}.items():
            share45 = max(0.1, min(95.0, base * scale * random.uniform(0.8, 1.2)))
            jobs[mode]["45"].append(round(share45, 2))
            jobs[mode]["30"].append(round(share45 * 0.55, 2))
        for mode in fair:
            level = max(0.1, math.exp(-to_cbd / 7) * 2.4 * random.uniform(0.7, 1.3))
            fair[mode]["45"].append(round(level, 2))
            fair[mode]["30"].append(round(level * 0.9, 2))

    for place in places:
        place["population"] = round(place["population"])

    meta = {
        "version": "0.1.0-fixture",
        "built": "2026-09-11",
        "region": "Synthetic test data",
        "routing_date": "2026-09-15",
        "windows": {"am_peak": {"start": "07:00", "minutes": 120}, "interpeak": {"start": "10:00", "minutes": 120}},
        "modes": {m: m for m in MODES},
        "standard_modes": ["walk", "bike_low_stress", "pt"],
        "services": {s: {"label": v[0], "standard_minutes": v[2], "window": v[1]} for s, v in SERVICES.items()},
        "jobs": {"thresholds": [30, 45], "window": "am_peak", "total": 850000},
        "totals": {"cells": len(cells), "population": round(sum(fields["pop"]))},
        "destinations": {s: v[3] for s, v in SERVICES.items()},
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

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"h3": cells, **fields, "freq": freq, "t": t, "km": km_out, "nearest": nearest, "jobs": jobs, "fair": fair}
    files = {
        "cells.json": payload,
        "summary.json": {"meta": meta, "services": [], "jobs": [], "areas": {}},
        "places.json": places,
        "destinations.json": destinations,
        "overlays.json": overlays,
    }
    for name, content in files.items():
        (OUT / name).write_text(json.dumps(content, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(cells)} synthetic cells to {OUT}")


if __name__ == "__main__":
    main()
