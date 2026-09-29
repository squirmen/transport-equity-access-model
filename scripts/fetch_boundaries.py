"""Council and ward boundaries for the whole country, from Stats NZ.

The side panel's figures can be for a council, a ward, an Auckland local board
or a suburb, as well as the whole place. Suburbs and local boards come with a
place's census and Auckland's inputs; councils and wards are national, so they
are fetched once here and each place's build picks out its own.

    python scripts/fetch_boundaries.py --data-root <root>

Writes raw/nz/boundaries/nz_wards.gpkg and nz_councils.gpkg (NZTM), from Stats
NZ's current general wards and territorial authorities. Māori wards overlap the
general wards and are left out; so is water outside any ward.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("fetch_boundaries")

SERVICE = "https://services.arcgis.com/XTtANUDT8Va4DLwI/arcgis/rest/services"
LAYERS = {
    "nz_wards": ("nz_wards", "Ward_code,Ward_name,dataset_year", "Ward_name <> 'Area Outside Ward'"),
    "nz_councils": ("nz_territorial_authorities", "TA_code,TA_name,dataset_year", "TA_name <> 'Area Outside Territorial Authority'"),
}
PAGE = 50


def _post(url: str, params: dict, timeout: int = 300) -> dict:
    body = urllib.parse.urlencode(params).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"User-Agent": "TEAM (Better Places Lab)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch(root: Path, name: str) -> Path:
    import geopandas as gpd

    service, fields, where = LAYERS[name]
    url = f"{SERVICE}/{service}/FeatureServer/0/query"
    features: list[dict] = []
    offset = 0
    while True:
        page = _post(url, {
            "where": where, "outFields": fields, "returnGeometry": "true", "outSR": "2193",
            # Simplified to 5 m: plenty for assigning hexagon centres.
            "maxAllowableOffset": "5", "orderByFields": "OBJECTID",
            "resultOffset": offset, "resultRecordCount": PAGE, "f": "geojson",
        })
        got = page.get("features", [])
        features.extend(got)
        offset += len(got)
        if len(got) < PAGE:
            break
        time.sleep(0.2)
    frame = gpd.GeoDataFrame.from_features(features, crs="EPSG:2193")
    out = root / "raw" / "nz" / "boundaries" / f"{name}.gpkg"
    out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_file(out, driver="GPKG")
    out.with_suffix(".gpkg.metadata.json").write_text(json.dumps({
        "downloaded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "attribution": "Stats NZ",
        "license": "CC-BY-4.0",
        "source": f"{SERVICE}/{service}/FeatureServer/0",
        "where": where,
        "dataset_year": sorted({int(f["properties"].get("dataset_year") or 0) for f in features}),
        "features": len(frame),
        "note": "Simplified to 5 m.",
    }, indent=2))
    log.info("%s: %d features", name, len(frame))
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    args = parser.parse_args()
    root = args.data_root.expanduser().resolve()
    for name in LAYERS:
        fetch(root, name)


if __name__ == "__main__":
    main()
