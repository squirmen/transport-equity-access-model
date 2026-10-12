"""Write tests/fixtures/trip/transit_lines.json: the lines and line shapes from the site's transit.json that the
fixture's one-ride public transport trips use (tests/fixtures/trip/pt_expected.json), for trip.js rideShape.

    python tests/fixtures/make_trip_lines.py
    python tests/fixtures/make_trip_lines.py --site DIR

Keeps each line whose routes a fixture trip rides, and of its shapes only those passing within 200 m of that
trip's first and last stop. Reads the built site (team-site/data/auckland); writes only the one file.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "trip" / "transit_lines.json"
SITE = HERE.parents[2] / "team-site" / "data" / "auckland"


def metres(a, b):
    x = (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2)) * 111320
    y = (b[1] - a[1]) * 111320
    return math.hypot(x, y)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", type=Path, default=SITE)
    args = ap.parse_args()
    transit = json.loads((args.site / "transit.json").read_text(encoding="utf-8"))
    expected = json.loads((HERE / "trip" / "pt_expected.json").read_text(encoding="utf-8"))
    where = {f["properties"]["id"]: f["geometry"]["coordinates"] for f in transit["stops"]["features"]}
    lines, drawn = {}, []
    for pair in expected["pairs"]:
        trip = pair["pt"].get("interpeak")
        if not trip or trip["kind"] != "ride" or len(trip["routes"]) != 1:
            continue
        a, b = where.get(trip["board"]), where.get(trip["alight"])
        if not a or not b:
            continue
        short = trip["routes"][0]
        for line in transit["lines"]:
            if line["name"] != short and not any(r.split("-")[0] == short for r in line["routes"]):
                continue
            lines[line["id"]] = line
            for f in transit["drawn"]["features"]:
                if line["id"] not in f["properties"]["lines"]:
                    continue
                coords = f["geometry"]["coordinates"]
                if min(metres(a, c) for c in coords) <= 200 and min(metres(b, c) for c in coords) <= 200 and f not in drawn:
                    drawn.append(f)
    out = {"lines": list(lines.values()), "drawn": {"type": "FeatureCollection", "features": drawn}}
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT}: {len(lines)} lines, {len(drawn)} shapes, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
