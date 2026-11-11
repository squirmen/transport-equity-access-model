"""Write the small school fixtures the tests read, from a real Auckland build.

    PYTHONPATH=src python tests/fixtures/make_school_fixtures.py \\
        --data-root DATA --snapshot DATA/raw/nz/education/moe_schools_directory_2026-11-12.csv \\
        --out OUT_AUCKLAND --perminute AUDIT/r_o30_pt_perminute.parquet

Writes into tests/fixtures/schools/:

* directory_sample.csv: real directory rows for the schools the tests name,
  without the contact fields (Ministry of Education, CC BY 4.0);
* mags_case.json: the ten hexagons nearest Mt Albert Grammar School's map
  point, every secondary school each reaches within 60 minutes by each mode
  (from the school runs), and those schools' attributes;
* hand_trips.json: the five public transport trips checked by hand in the
  accuracy audit, with R5's time for each of the 120 departure minutes
  from 7:00 to 8:59.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from team import schools  # noqa: E402

HERE = Path(__file__).resolve().parent / "schools"
SAMPLE = [69, 70, 4207, 89, 130, 1245, 386, 1585, 4575, 4592, 876, 553, 3630, 1190, 54, 723]
CONTACT = ["Telephone", "Fax", "Email", "Contact1_Name", "URL", "Add2_Line1", "Add2_Suburb", "Add2_City", "Add2_Postal_Code"]
SLIDE = "89bb50021a3ffff"
MODES = ["walk", "bike_low_stress", "bike", "pt", "pt_slow", "car"]
TAGS = {"walk": "schools_walk", "bike_low_stress": "schools_bike_low_stress", "bike": "schools_bike",
        "pt": "schools_am_peak_pt", "pt_slow": "schools_am_peak_pt_slow", "car": "schools_car"}
HAND = [("O04", "89bb501522bffff", "moe:69"), ("O05", "89bb5002503ffff", "moe:69"), ("O09", "89bb501515bffff", "moe:69"),
        ("O03", "89bb5002c07ffff", "moe:69"), ("O12", "89bb50023d7ffff", "moe:54")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, help="Auckland build folder (destinations/, routing/)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache" / "team" / "auckland")
    parser.add_argument("--perminute", type=Path)
    args = parser.parse_args()
    HERE.mkdir(parents=True, exist_ok=True)

    directory = schools.read_directory(args.snapshot)
    sample = directory[directory["School_Id"].astype(int).isin(SAMPLE)].drop(columns=[c for c in CONTACT if c in directory])
    sample.sort_values("School_Id", key=lambda s: s.astype(int)).to_csv(HERE / "directory_sample.csv", index=False)

    import geopandas as gpd
    import h3

    listed = pd.read_parquet(args.out / "destinations" / "school_list.parquet")
    mags = listed.set_index("moe").loc[69]
    grid = [c for c in h3.grid_disk(h3.latlng_to_cell(mags["lat"], mags["lon"], 9), 3)]
    cells = pd.DataFrame({"h3": grid})
    ll = np.array([h3.cell_to_latlng(c) for c in grid])
    pts = gpd.GeoSeries(gpd.points_from_xy(ll[:, 1], ll[:, 0]), crs=4326).to_crs(2193)
    mpt = gpd.GeoSeries(gpd.points_from_xy([mags["lon"]], [mags["lat"]]), crs=4326).to_crs(2193).iloc[0]
    cells["metres"] = [p.distance(mpt) for p in pts]
    origins = pd.read_parquet(args.out / "routing" / "schools_walk.parquet", columns=["origin"])["origin"].unique()
    cells = cells[cells["h3"].isin(origins)].sort_values("metres")
    chosen = list(dict.fromkeys([SLIDE, *cells["h3"].head(10)]))[:10]
    pairs = {}
    names = {}
    used = set()
    for mode, tag in TAGS.items():
        folder = args.cache / "pairs" / tag
        files = sorted(folder.glob("origins_*[0-9].parquet"))
        if not files:
            continue
        frame = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
        frame = frame[frame["origin"].isin(chosen) & (frame["service"] == "secondary_school")]
        columns = ["origin", "destination", "minutes", *[c for c in ("lo", "hi") if c in frame]]
        pairs[mode] = frame[columns].sort_values(["origin", "destination"]).values.tolist()
        names[mode] = columns
        used |= set(frame["destination"])
    keep = listed[listed["school"].isin(used)]
    attrs = keep[["school", "moe", "name", "kind", "medium", "language", "sex_secondary_school", "scheme", "lon", "lat", "services"]]
    origins_tab = load_origins_for(args, chosen)
    case = {
        "about": "Secondary school pairs from the Auckland school runs (TEAM 0.12.0), for the ten hexagons "
                 "nearest Mt Albert Grammar School's map point. The councillors' slide is 89bb50021a3ffff.",
        "cells": chosen,
        "centres": origins_tab,
        "schools": json.loads(attrs.to_json(orient="records")),
        "pairs": pairs,
        "columns": names,
    }
    (HERE / "mags_case.json").write_text(json.dumps(case, ensure_ascii=False) + "\n", encoding="utf-8")

    if args.perminute and args.perminute.exists():
        pm = pd.read_parquet(args.perminute)
        trips = []
        for oid, cell, school in HAND:
            g = pm[(pm["from_id"] == cell) & (pm["to_id"] == f"moe|{school}")].sort_values("dep_min")
            trips.append({"case": oid, "h3": cell, "school": school,
                          "departures": [int(m) for m in g["dep_min"]],
                          "minutes": [None if pd.isna(v) else int(v) for v in g["travel_time"]]})
        (HERE / "hand_trips.json").write_text(json.dumps({
            "about": "R5 (r5py 1.1.3) public transport times for each departure minute, 7:00 to 8:59 on Tuesday "
                     "15 September 2026, one-minute windows, from the hexagon centre to the school's map point. "
                     "Routed for the accuracy audit; the medians were checked against the timetable by hand.",
            "trips": trips}, indent=1) + "\n", encoding="utf-8")
    print("wrote", sorted(p.name for p in HERE.iterdir()))
    return 0


def load_origins_for(args, chosen: list[str]) -> dict:
    """The origin points the build routes from (grid centroids), in NZTM."""
    import geopandas as gpd

    from team import config, routing

    settings = config.load(Path(__file__).resolve().parents[2] / "configs" / "auckland.yml", args.data_root, args.out, args.cache)
    origins = routing.load_origins(settings)
    origins = origins[origins["id"].isin(chosen)]
    xy = gpd.GeoSeries(origins.geometry, crs=4326).to_crs(2193)
    return {i: [round(float(p.x), 2), round(float(p.y), 2)] for i, p in zip(origins["id"], xy)}


if __name__ == "__main__":
    raise SystemExit(main())
