"""Review sheets for where school trips end. Nothing here changes a figure.

1. Map points. Each school's directory point is compared with its grounds in
   LINZ NZ Facilities (https://data.linz.govt.nz/layer/105588-nz-facilities/,
   CC BY 4.0), matched on source_facility_id, which is the MoE number. Points
   more than 50 m outside their own grounds, and schools with no grounds in
   the file, are marked for a person to check.
2. Entrances. OpenStreetMap gates and footway crossings on the grounds' edge
   (from --gates) are listed as candidates. Many are private or locked, so
   none is used until a person checks it and copies the row into
   configs/schools/entrances.csv with checked_by and checked_on.

    PYTHONPATH=src python scripts/school_points_review.py --config configs/auckland.yml \\
        --data-root DATA --out OUT --facilities nz_facilities.gpkg [--gates gates.parquet] --to DIR
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from team import config, schools  # noqa: E402

OUTSIDE_METRES = 50.0


def main() -> int:
    import geopandas as gpd

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--facilities", required=True, type=Path, help="LINZ NZ Facilities, any format GDAL reads")
    parser.add_argument("--gates", type=Path, help="OSM entrance candidates: parquet with source_id, lon, lat, kind, osm_id, osm_tags, restricted")
    parser.add_argument("--to", required=True, type=Path)
    args = parser.parse_args()
    settings = config.load(args.config, args.data_root, args.out)
    listed = schools.load_list(settings)
    if listed is None:
        listed = schools.school_table(settings)
    grounds = gpd.read_file(args.facilities)
    if grounds.crs is None:
        raise SystemExit(f"{args.facilities} has no projection")
    grounds = grounds.to_crs(2193)
    grounds["moe"] = pd.to_numeric(grounds["source_facility_id"], errors="coerce")
    grounds = grounds.dropna(subset=["moe"]).dissolve(by="moe").reset_index()
    points = gpd.GeoDataFrame(listed, geometry=gpd.points_from_xy(listed["lon"], listed["lat"]), crs=4326).to_crs(2193)
    merged = points.merge(grounds[["moe", "geometry"]].rename(columns={"geometry": "grounds"}), on="moe", how="left")
    rows = []
    for record in merged.itertuples():
        has = record.grounds is not None and not (isinstance(record.grounds, float))
        metres = float(record.geometry.distance(record.grounds)) if has else None
        inside = gpd.GeoSeries([record.grounds.representative_point()], crs=2193).to_crs(4326).iloc[0] if has else None
        rows.append({
            "moe": record.moe, "name": record.name, "kind": record.kind, "lon": record.lon, "lat": record.lat,
            "grounds_in_linz": has, "metres_outside_grounds": None if metres is None else round(metres, 1),
            "point_inside_grounds_lon": None if inside is None else round(inside.x, 6),
            "point_inside_grounds_lat": None if inside is None else round(inside.y, 6),
            "check": (not has) or (metres is not None and metres > OUTSIDE_METRES),
        })
    sheet = pd.DataFrame(rows).sort_values(["check", "metres_outside_grounds"], ascending=[False, False])
    args.to.mkdir(parents=True, exist_ok=True)
    name = settings.raw["name"]
    sheet.to_csv(args.to / f"{name}_school_points_review.csv", index=False)
    flagged = sheet[sheet["check"]]
    print(f"{name}: {len(sheet)} schools, {int(sheet['grounds_in_linz'].sum())} with grounds in LINZ, "
          f"{int((sheet['metres_outside_grounds'] > OUTSIDE_METRES).sum())} points more than {OUTSIDE_METRES:.0f} m outside them, "
          f"{int((~sheet['grounds_in_linz']).sum())} with no grounds")
    print(flagged.head(15)[["moe", "name", "kind", "metres_outside_grounds"]].to_string(index=False))
    if args.gates and args.gates.exists():
        gates = pd.read_parquet(args.gates)
        gates["moe"] = gates["source_id"].str.split(":").str[1].astype(int)
        gates = gates.merge(listed[["moe", "name"]], on="moe", how="inner")
        keep = ["moe", "name", "kind", "lon", "lat", "osm_id", "osm_tags", "restricted"]
        out = gates[keep].assign(hours="", source="OpenStreetMap", checked_by="", checked_on="", notes="")
        out.to_csv(args.to / f"{name}_entrance_candidates.csv", index=False)
        print(f"{len(out)} entrance candidates for {out['moe'].nunique()} schools, {int(out['restricted'].sum())} marked private or locked in OSM")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
