"""Single years of age inside the 2023 Census five-year bands, for school ages.

The finest open 2023 Census age data are five-year bands by SA1 (Stats NZ's
"2023 Census totals by topic for individuals by SA1"). School years need
single years: secondary is 13 to 17, which cuts the 10-14 and 15-19 bands.
An even split of a band (each year a fifth) is badly wrong where students
fill the 15-19 band: in 2018, Campus North in Dunedin had 132 people aged
13-17 against 873 by an even split. So each band is split by the shape of
single years in the 2018 Census for the surrounding area.

Single years by 2023 SA2 exist only in Aotearoa Data Explorer (CEN23_POP_001),
whose data API needs a subscription key. The 2018 Census table has single
years by 2018 SA2, open:

    https://www3.stats.govt.nz/2018census/Age-sex-by-ethnic-group-grouped-total-responses-census-usually-resident-population-counts-2006-2013-2018-Censuses-RC-TA-SA2-DHB.zip

2023 and 2018 SA2s differ (only 68% of 2023 residents live in an SA2 whose
code exists in 2018), so each 2023 SA1 takes the 2018 SA2 its representative
point falls in, from Stats NZ's 2018 SA2 polygons (CC BY 4.0):

    https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/2018_Census_usually_resident_population_and_age_groups_by_Statistical_Area_2/FeatureServer/0

For each SA1: f10 to f14, the share of the 10-14 band at each age, and f15 to
f17, the share of the 15-19 band aged 15, 16 and 17. The 2018 counts are Total
ethnicity (9999), Total sex (9). Where that SA2's band holds fewer than 30
people or any year is confidential ('..C'), the band takes the national 2018
shape. Counts are randomly rounded to base 3, so the shares come from the
single years themselves.

Writes:
    raw/nz/census/statsnz_sa2_2018_<date>.gpkg            2018 SA2 polygons (if missing)
    processed/nz/census/age_shape_sa2_2018.parquet       sa1, sa2_2018, f10..f17, sources
    (each with a .metadata.json)

With --ade FILE (the 2023 single-year table by 2023 SA2, downloaded from
Aotearoa Data Explorer by hand), the same shape is made from 2023 instead and
written to processed/nz/census/age_shape_sa2_2023.parquet; point the configs'
census_age_shape at it.

Run:  python scripts/fetch_census_ages.py --data-root DATA
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import logging
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

log = logging.getLogger("fetch_census_ages")

SA2_2018 = ("https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/"
            "2018_Census_usually_resident_population_and_age_groups_by_Statistical_Area_2/FeatureServer/0")
TABLE_2018 = ("https://www3.stats.govt.nz/2018census/Age-sex-by-ethnic-group-grouped-total-responses-census-"
              "usually-resident-population-counts-2006-2013-2018-Censuses-RC-TA-SA2-DHB.zip")
TABLE_2018_FILE = Path("raw/nz/census/statsnz_census2018_age_sex_ethnic_sa2_2026-11-12/"
                       "Age-sex-by-ethnic-group-2006-2013-2018-RC-TA-SA2-DHB.zip")
SHAPE_FILE = Path("processed/nz/census/age_shape_sa2_2018.parquet")
SHAPE_FILE_2023 = Path("processed/nz/census/age_shape_sa2_2023.parquet")
MIN_BAND = 30
AGENT = {"User-Agent": "research-data-fetch"}
BANDS = {"10_14": range(10, 15), "15_19": range(15, 20)}


def _get(url: str, params: dict) -> dict:
    request = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers=AGENT)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if "error" in payload:
                raise RuntimeError(payload["error"])
            return payload
        except Exception as error:
            if attempt == 4:
                raise
            log.warning("retrying after %s", error)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch_sa2_2018(path: Path) -> None:
    """The 2018 SA2 polygons, NZTM, generalised to 5 m (they only place SA1 points)."""
    import geopandas as gpd

    count = int(_get(f"{SA2_2018}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"})["count"])
    frames, offset = [], 0
    while offset < count:
        page = _get(f"{SA2_2018}/query", {
            "where": "1=1", "outFields": "SA22018_V1_00,SA22018_V1_NAME", "outSR": 2193,
            "maxAllowableOffset": 5, "orderByFields": "OBJECTID", "resultOffset": offset,
            "resultRecordCount": 200, "f": "geojson",
        })
        frame = gpd.GeoDataFrame.from_features(page["features"], crs="EPSG:2193")
        if frame.empty:
            break
        frames.append(frame)
        offset += len(frame)
        log.info("  2018 SA2 polygons: %d of %d", offset, count)
        time.sleep(0.2)
    polygons = pd.concat(frames, ignore_index=True)
    polygons = gpd.GeoDataFrame(polygons, geometry="geometry", crs="EPSG:2193")
    polygons["geometry"] = polygons.geometry.make_valid()
    path.parent.mkdir(parents=True, exist_ok=True)
    polygons.to_file(path, driver="GPKG")
    meta = {
        "dataset": "Statistical Area 2 2018 (Stats NZ), from the 2018 Census usually resident population layer",
        "source_url": SA2_2018,
        "licence": "CC BY 4.0, Stats NZ",
        "query": {"out_fields": "SA22018_V1_00,SA22018_V1_NAME", "out_sr": 2193, "max_allowable_offset_m": 5},
        "count_expected": count,
        "count": int(len(polygons)),
        "downloaded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "use": "Places each 2023 SA1's representative point in a 2018 SA2, for the single-year age shape.",
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    Path(str(path) + ".metadata.json").write_text(json.dumps(meta, indent=2))


def single_years_2018(zip_path: Path) -> pd.DataFrame:
    """Counts at each age 0 to 19 by 2018 SA2 code (and '9999', New Zealand),
    NaN where confidential. Columns are ages."""
    wanted = {f"{a:03d}" for a in range(0, 20)}
    parts = []
    with zipfile.ZipFile(zip_path) as archive, archive.open("Data8277.csv") as handle:
        for chunk in pd.read_csv(handle, dtype=str, chunksize=2_000_000):
            keep = (chunk["Year"] == "2018") & (chunk["Ethnic"] == "9999") & (chunk["Sex"] == "9") & chunk["Age"].isin(wanted)
            area = chunk["Area"]
            keep &= ((area.str.len() == 6) & (area != "999999")) | (area == "9999")
            parts.append(chunk.loc[keep, ["Age", "Area", "count"]])
    rows = pd.concat(parts, ignore_index=True)
    rows["value"] = pd.to_numeric(rows["count"], errors="coerce")   # '..C' is confidential
    table = rows.pivot_table(index="Area", columns="Age", values="value", aggfunc="first", dropna=False)
    table.columns = [int(c) for c in table.columns]
    return table.reindex(columns=range(0, 20))


def single_years_2023(path: Path) -> pd.DataFrame:
    """The same shape from an Aotearoa Data Explorer CSV of CEN23_POP_001 (total
    ethnicity, total gender, 2023, by SA2): one row per area and age. Columns
    are found by name: an area code, an age, and OBS_VALUE (or value)."""
    raw = pd.read_csv(path, dtype=str)
    lower = {c.lower(): c for c in raw.columns}
    area = next(lower[c] for c in lower if "sa2" in c or c in ("area", "geo", "ref_area"))
    age = next(lower[c] for c in lower if c.startswith("age"))
    value = next(lower[c] for c in lower if c in ("obs_value", "value", "count"))
    frame = pd.DataFrame({
        "Area": raw[area].str.extract(r"(\d{6})")[0],
        "Age": pd.to_numeric(raw[age].str.extract(r"(\d+)")[0], errors="coerce"),
        "value": pd.to_numeric(raw[value], errors="coerce"),
    }).dropna(subset=["Area", "Age"])
    frame = frame[frame["Age"].between(0, 19)]
    table = frame.pivot_table(index="Area", columns="Age", values="value", aggfunc="first")
    table.columns = [int(c) for c in table.columns]
    table = table.reindex(columns=range(0, 20))
    table.loc["9999"] = table.sum(axis=0, min_count=1)
    return table


def fractions(table: pd.DataFrame, minimum: int = MIN_BAND) -> tuple[pd.DataFrame, dict]:
    """Single-year shares inside the 10-14 and 15-19 bands, per area, with the
    national shape where an area's band is small or has a confidential year."""
    national = table.loc["9999"]
    out = pd.DataFrame(index=table.index.drop("9999"))
    nat = {}
    for band, ages in BANDS.items():
        cells = table.loc[out.index, list(ages)]
        total = cells.sum(axis=1, min_count=len(ages))
        usable = cells.notna().all(axis=1) & (total >= minimum)
        national_share = (national[list(ages)] / national[list(ages)].sum()).to_numpy()
        nat[band] = {str(a): round(float(s), 6) for a, s in zip(ages, national_share)}
        shares = cells.div(total.where(usable), axis=0)
        for a, share in zip(ages, national_share):
            out[f"f{a}"] = shares[a].where(usable, share)
        out[f"source_{band}"] = np.where(usable, "sa2", "national")
    keep = [f"f{a}" for a in range(10, 18)] + [f"source_{b}" for b in BANDS]
    return out[keep], nat


def sa1_points(root: Path):
    """Representative points of every 2023 SA1 in any place's census blocks, NZTM."""
    import geopandas as gpd
    import yaml

    frames = []
    for config in sorted((REPO / "configs").glob("*.yml")):
        raw = yaml.safe_load(config.read_text(encoding="utf-8"))
        path = root / raw["data"]["census_sa1"]
        blocks = gpd.read_file(path, columns=["SA12023_code", "SA22023_code"]).to_crs("EPSG:2193")
        blocks["sa1"] = blocks["SA12023_code"].astype(str).str.replace(r"\.0$", "", regex=True)
        blocks["sa2_2023"] = blocks["SA22023_code"].astype(str).str.replace(r"\.0$", "", regex=True)
        blocks["geometry"] = blocks.geometry.representative_point()
        frames.append(blocks[["sa1", "sa2_2023", "geometry"]])
    points = pd.concat(frames, ignore_index=True).drop_duplicates("sa1")
    return gpd.GeoDataFrame(points, geometry="geometry", crs="EPSG:2193").reset_index(drop=True)


def main() -> int:
    import geopandas as gpd

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--date", default="2026-11-12", help="date in the 2018 SA2 polygon file's name")
    parser.add_argument("--ade", help="2023 single-year table by 2023 SA2 from Aotearoa Data Explorer (CSV)")
    args = parser.parse_args()
    root = Path(args.data_root)
    points = sa1_points(root)
    log.info("%d SA1s across the places", len(points))

    if args.ade:
        table = single_years_2023(Path(args.ade))
        shape, national = fractions(table)
        out = points[["sa1", "sa2_2023"]].merge(shape, left_on="sa2_2023", right_index=True, how="left")
        source, path, area_column = "census2023_sa2", root / SHAPE_FILE_2023, "sa2_2023"
        inputs = {"table": str(Path(args.ade).resolve())}
    else:
        polygons_path = root / "raw" / "nz" / "census" / f"statsnz_sa2_2018_{args.date}.gpkg"
        if not polygons_path.exists():
            fetch_sa2_2018(polygons_path)
        polygons = gpd.read_file(polygons_path)
        polygons["sa2_2018"] = polygons["SA22018_V1_00"].astype(str)
        joined = gpd.sjoin(points, polygons[["sa2_2018", "geometry"]], how="left", predicate="within").drop_duplicates("sa1")
        missing = joined["sa2_2018"].isna()
        if missing.any():
            near = gpd.sjoin_nearest(points[points["sa1"].isin(joined.loc[missing, "sa1"])], polygons[["sa2_2018", "geometry"]])
            joined = pd.concat([joined[~missing], near.drop_duplicates("sa1")], ignore_index=True)
            log.info("%d SA1 points outside every 2018 SA2 took the nearest", int(missing.sum()))
        table = single_years_2018(root / TABLE_2018_FILE)
        shape, national = fractions(table)
        out = joined[["sa1", "sa2_2018"]].merge(shape, left_on="sa2_2018", right_index=True, how="left")
        source, path, area_column = "census2018_sa2", root / SHAPE_FILE, "sa2_2018"
        inputs = {"table": TABLE_2018, "table_file": str(TABLE_2018_FILE), "polygons": SA2_2018,
                  "polygons_file": str(polygons_path.relative_to(root))}
    # An SA1 whose area is not in the table at all takes the national shape.
    for band, ages in BANDS.items():
        absent = out[f"source_{band}"].isna()
        for a in [a for a in ages if a < 18]:
            out.loc[absent, f"f{a}"] = national[band][str(a)]
        out.loc[absent, f"source_{band}"] = "national"
    out["shape_source"] = source
    out = out.sort_values("sa1").reset_index(drop=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(path, index=False)
    meta = {
        "dataset": "Single-year age shares inside the 10-14 and 15-19 bands, for each 2023 SA1",
        "shape_source": source,
        "rule": f"Each 2023 SA1 takes the {area_column} its representative point falls in "
                "(or by code, for 2023). f10..f14 are shares of the 10-14 band at each age; f15..f17 of the "
                f"15-19 band. A band with fewer than {MIN_BAND} people in that area, or any confidential year, "
                "takes the national shape.",
        "inputs": inputs,
        "national": national,
        "sa1s": int(len(out)),
        "national_shape_used": {b: int((out[f"source_{b}"] == "national").sum()) for b in BANDS},
        "licence": "CC BY 4.0, Stats NZ",
        "written_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    Path(str(path) + ".metadata.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({k: meta[k] for k in ("shape_source", "sa1s", "national_shape_used", "national")}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
