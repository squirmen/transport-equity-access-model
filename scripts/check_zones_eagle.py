"""Check the Ministry's enrolment zones against Eagle Technology's copy.

Eagle Technology publishes a copy of the school zones on ArcGIS Online:

    https://services.arcgis.com/XTtANUDT8Va4DLwI/ArcGIS/rest/services/NZ_School_Zone_boundaries/FeatureServer/0

Its terms are not open, so it is used only to check the Ministry's file, and
nothing from it is published or kept in the data root: this script writes only
to the scratch folder given with --scratch, and is never part of a build.

For each school, the zones in each file are joined and compared as
1 - (intersection / union) of their areas. Schools in one file only are listed.
Writes eagle_compare.csv and eagle_check.md to the scratch folder, and the
downloaded pages there (reused if present).

    python scripts/check_zones_eagle.py --zones DATA/raw/nz/education/moe_enrolment_zones_<date>/Enrolmentschememaster.zip \\
        --scratch /path/to/scratch/eagle [--readme .../extracted/Readme.txt]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from team import zones  # noqa: E402

EAGLE = "https://services.arcgis.com/XTtANUDT8Va4DLwI/ArcGIS/rest/services/NZ_School_Zone_boundaries/FeatureServer/0"
AGENT = {"User-Agent": "research-data-check"}
PAGE = 200


def _get(url: str, params: dict | None = None) -> bytes:
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url + query, headers=AGENT), timeout=300) as response:
                return response.read()
        except Exception:  # network hiccups: wait and try again
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch(folder: Path) -> dict:
    """Eagle's layer description and every feature, in pages of 200, in NZTM."""
    folder.mkdir(parents=True, exist_ok=True)
    layer_path = folder / "layer.json"
    if not layer_path.exists():
        layer_path.write_bytes(_get(EAGLE, {"f": "json"}))
    layer = json.loads(layer_path.read_text())
    count = int(json.loads(_get(f"{EAGLE}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"}))["count"])
    offset = 0
    while offset < count:
        page = folder / f"page_{offset}.geojson"
        if not page.exists():
            page.write_bytes(_get(f"{EAGLE}/query", {
                "where": "1=1", "outFields": "*", "outSR": 2193, "orderByFields": "OBJECTID",
                "resultOffset": offset, "resultRecordCount": PAGE, "f": "geojson"}))
            time.sleep(0.3)
        offset += PAGE
    edited = (layer.get("editingInfo") or {}).get("dataLastEditDate")
    return {"count": count, "data_last_edited_utc": dt.datetime.fromtimestamp(edited / 1000, dt.timezone.utc).isoformat()
            if edited else None}


def read_eagle(folder: Path):
    import geopandas as gpd

    frames = [gpd.read_file(p) for p in sorted(folder.glob("page_*.geojson"))]
    eagle = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry")
    eagle = eagle.drop_duplicates("OBJECTID")
    # Served in NZTM (outSR 2193); GeoJSON readers may label it WGS84 regardless.
    eagle = eagle.set_crs(2193, allow_override=True)
    eagle["geometry"] = [zones._polygonal(g) for g in eagle.geometry]
    eagle["moe"] = pd.to_numeric(eagle["School_ID"], errors="coerce").astype("Int64")
    return eagle[eagle.geometry.notna() & eagle["moe"].notna()]


def compare(moe, eagle) -> pd.DataFrame:
    a = moe.dissolve(by="moe")
    b = eagle.dissolve(by="moe")
    rows = []
    for school in sorted(set(a.index) & set(b.index)):
        ga, gb = a.geometry.loc[school], b.geometry.loc[school]
        union = ga.union(gb).area
        rows.append({"moe": int(school), "ministry_km2": round(ga.area / 1e6, 3), "eagle_km2": round(gb.area / 1e6, 3),
                     "mismatch": round(1 - ga.intersection(gb).area / union, 5) if union else 0.0})
    out = pd.DataFrame(rows)
    names = moe.drop_duplicates("moe").set_index("moe")["name"]
    out["name"] = out["moe"].map(names)
    latest = moe.groupby("moe")["date"].max()
    out["ministry_date"] = out["moe"].map(latest)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zones", required=True, type=Path, help="the Ministry's zip or .TAB")
    parser.add_argument("--scratch", required=True, type=Path, help="scratch folder for Eagle's pages and the outputs")
    parser.add_argument("--readme", type=Path, help="the Ministry's Readme.txt, to match changed schools to its notes")
    args = parser.parse_args()
    if "raw" in args.scratch.parts and "nz" in args.scratch.parts:
        raise SystemExit("Write Eagle's copy to a scratch folder, not the data root.")
    info = fetch(args.scratch / "pages")
    moe = zones.read(args.zones)
    eagle = read_eagle(args.scratch / "pages")
    table = compare(moe, eagle)
    only_moe = sorted(set(moe["moe"]) - set(eagle["moe"].astype(int)))
    only_eagle = sorted(set(eagle["moe"].astype(int)) - set(moe["moe"]))
    readme = args.readme.read_text(encoding="utf-8", errors="replace") if args.readme and args.readme.exists() else ""
    # The Readme lists schools one to a line, MoE number first.
    mentioned = {int(m) for m in re.findall(r"(?m)^\s*(\d{1,4})\s", readme)}
    table["in_readme"] = table["moe"].isin(mentioned)
    table.sort_values("mismatch", ascending=False).to_csv(args.scratch / "eagle_compare.csv", index=False)
    big = table[table["mismatch"] > 0.01].sort_values("mismatch", ascending=False)
    q = table["mismatch"].quantile([0.5, 0.9, 0.99]).round(5)
    lines = [
        "# Ministry zones against Eagle Technology's copy",
        "",
        f"Checked {dt.date.today().isoformat()}. Eagle's copy is used only for this check; nothing from it is published.",
        "",
        f"- Ministry file: {len(moe):,} polygons for {moe['moe'].nunique():,} schools.",
        f"- Eagle: {len(eagle):,} polygons for {eagle['moe'].nunique():,} schools; service count {info['count']:,}; "
        f"data last edited {str(info['data_last_edited_utc'])[:10]}.",
        f"- Schools in both: {len(table):,}. Mismatch is 1 - intersection / union of each school's joined zones.",
        f"- Median mismatch {100 * q.loc[0.5]:.2f}%, 90th percentile {100 * q.loc[0.9]:.2f}%, 99th {100 * q.loc[0.99]:.2f}%.",
        f"- Schools over 1%: {len(big)}, of which {int(big['in_readme'].sum())} have their number in the Ministry's Readme "
        "(the list of new, amended and abandoned schemes).",
        f"- In the Ministry's file only: {', '.join(map(str, only_moe)) or 'none'}.",
        f"- In Eagle's only: {', '.join(map(str, only_eagle)) or 'none'}.",
        "",
        "| MoE | School | Ministry km² | Eagle km² | Mismatch | In Readme |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in big.itertuples():
        lines.append(f"| {r.moe} | {r.name} | {r.ministry_km2} | {r.eagle_km2} | {100 * r.mismatch:.1f}% | {'yes' if r.in_readme else 'no'} |")
    (args.scratch / "eagle_check.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:12]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
