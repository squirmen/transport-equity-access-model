"""School grounds from LINZ NZ Facilities, for checking school map points.

Reads the public ArcGIS copy of LINZ's NZ Facilities layer (no key):
https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Facilities/FeatureServer/0
(the same data as https://data.linz.govt.nz/layer/105588-nz-facilities/, CC BY 4.0).

Keeps school grounds: polygons whose `use_` is "School", and polygons with
no `use_` whose `use_type` is a school type rather than a hospital (the blank
`use_` rows hold both). `source_facility_id` is the Ministry of Education
school number. Writes them in NZTM with a metadata file (query, counts, the
service's data edit date, sha256).

    python scripts/fetch_school_grounds.py --to DATA/raw/nz/education/linz_nz_facilities_2026-11-12.gpkg
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path

SERVICE = "https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Facilities/FeatureServer/0"
WHERE = "use_ = 'School' OR use_ IS NULL"
FIELDS = "facility_id,source_facility_id,name,source_name,use_,use_type,use_subtype,last_modified"
# Blank-use rows that are not schools.
NOT_SCHOOLS = ("Hospital", "Hospice", "Aged", "Health", "Maternity")


def _get(url: str, params: dict) -> dict:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": "TEAM data build"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    import geopandas as gpd
    import pandas as pd

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--to", required=True, type=Path)
    args = parser.parse_args()
    layer = _get(SERVICE, {"f": "json"})
    total = _get(f"{SERVICE}/query", {"where": WHERE, "returnCountOnly": "true", "f": "json"})["count"]
    frames = []
    for offset in range(0, total, 1000):
        page = _get(f"{SERVICE}/query", {"where": WHERE, "outFields": FIELDS, "outSR": 2193, "orderByFields": "OBJECTID",
                                          "resultOffset": offset, "resultRecordCount": 1000, "f": "geojson"})
        frames.append(gpd.GeoDataFrame.from_features(page["features"], crs=2193))
    fetched = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=2193)
    if len(fetched) != total:
        raise SystemExit(f"expected {total} polygons, got {len(fetched)}")
    use_type = fetched["use_type"].fillna("").astype(str)
    blank = fetched["use_"].isna() | (fetched["use_"].astype(str).str.strip() == "")
    hospital = blank & use_type.str.contains("|".join(NOT_SCHOOLS), case=False)
    grounds = fetched[~hospital].copy()
    grounds["last_modified"] = pd.to_datetime(grounds["last_modified"], unit="ms").dt.date.astype(str)
    grounds["moe"] = pd.to_numeric(grounds["source_facility_id"], errors="coerce").astype("Int64")
    args.to.parent.mkdir(parents=True, exist_ok=True)
    grounds.to_file(args.to, driver="GPKG", layer="school_grounds")
    edited = layer.get("editingInfo", {}).get("dataLastEditDate")
    meta = {
        "source": SERVICE,
        "licence": "CC BY 4.0, as LINZ Data Service layer 105588 (https://data.linz.govt.nz/layer/105588-nz-facilities/)",
        "where": WHERE,
        "left_out": f"{int(hospital.sum())} blank-use polygons whose use_type names a hospital or health facility",
        "fields": FIELDS.split(","),
        "fetched": int(len(fetched)),
        "count": int(len(grounds)),
        "with_moe": int(grounds["moe"].notna().sum()),
        "by_use": grounds["use_"].fillna("blank").value_counts().to_dict(),
        "service_data_last_edited": dt.datetime.fromtimestamp(edited / 1000, dt.timezone.utc).isoformat() if edited else None,
        "latest_feature_last_modified": str(grounds["last_modified"].max()),
        "retrieved": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "crs": "EPSG:2193",
        "sha256": hashlib.sha256(args.to.read_bytes()).hexdigest(),
    }
    Path(str(args.to) + ".metadata.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
