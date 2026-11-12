"""Fetch LINZ address points for each place, to place residents inside a hexagon.

TEAM spreads census blocks over hexagons by area. Where an enrolment zone line
crosses a hexagon, the zones are assigned by where the residents live, and the
address points say where that is (docs/schools.md, "Enrolment zones").

Source: LINZ NZ Addresses, the public ArcGIS copy of LINZ Data Service layer
105689 (CC BY 4.0), no key needed:

    https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Addresses/FeatureServer/0

Every point with address_lifecycle 'Current' inside the place's extent
(destinations.city_bounds: its census blocks plus 0.08 degrees), with
address_id, unit and the NZTM point. One point per address, so each unit in a
block of flats is its own point. Paged by OBJECTID, 2,000 at a time.

Writes raw/nz/addresses/linz_nz_addresses_<date>/<place>.parquet with a
.metadata.json beside it (query, count, the service's last edit date, sha256).

Run:  python scripts/fetch_address_points.py --data-root DATA [--city auckland ...] [--count-only]
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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

log = logging.getLogger("fetch_addresses")

SERVICE = "https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Addresses/FeatureServer/0"
WHERE = "address_lifecycle = 'Current'"
FIELDS = ["OBJECTID", "address_id", "unit"]
PAGE = 2000
AGENT = {"User-Agent": "research-data-fetch"}


def _get(url: str, params: dict, tries: int = 5) -> dict:
    query = urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            request = urllib.request.Request(f"{url}?{query}", headers=AGENT)
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if "error" in payload:
                raise RuntimeError(payload["error"])
            return payload
        except Exception as error:  # network hiccups: wait and try again
            if attempt == tries - 1:
                raise
            log.warning("retrying after %s", error)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def service_info() -> dict:
    info = _get(SERVICE, {"f": "json"})
    edited = (info.get("editingInfo") or {}).get("dataLastEditDate")
    return {
        "name": info.get("name"),
        "data_last_edited_utc": dt.datetime.fromtimestamp(edited / 1000, dt.timezone.utc).isoformat() if edited else None,
        "max_record_count": info.get("maxRecordCount"),
    }


def _envelope(bounds: tuple[float, float, float, float]) -> dict:
    west, south, east, north = bounds
    return {
        "geometry": f"{west},{south},{east},{north}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }


def count(bounds) -> int:
    return int(_get(f"{SERVICE}/query", {"where": WHERE, **_envelope(bounds), "returnCountOnly": "true", "f": "json"})["count"])


def fetch(bounds, pause: float = 0.1) -> list[tuple[int, int, str | None, float, float]]:
    """Every current point in the box: (objectid, address_id, unit, x, y) in NZTM."""
    rows: list[tuple] = []
    last = -1
    while True:
        payload = _get(f"{SERVICE}/query", {
            "where": f"{WHERE} AND OBJECTID > {last}",
            **_envelope(bounds),
            "outFields": ",".join(FIELDS),
            "outSR": 2193,
            "orderByFields": "OBJECTID",
            "resultRecordCount": PAGE,
            "returnGeometry": "true",
            "f": "json",
        })
        features = payload.get("features", [])
        if not features:
            break
        for f in features:
            a, g = f["attributes"], f.get("geometry") or {}
            if "x" not in g:
                continue
            rows.append((int(a["OBJECTID"]), int(a["address_id"]), a.get("unit") or None, float(g["x"]), float(g["y"])))
        last = int(features[-1]["attributes"]["OBJECTID"])
        if len(features) < PAGE and not payload.get("exceededTransferLimit"):
            break
        time.sleep(pause)
    return rows


def place_bounds(root: Path, city: str) -> tuple[float, float, float, float]:
    """destinations.city_bounds for a place, without making output folders."""
    import yaml

    from team.config import Settings
    from team.destinations import city_bounds

    path = REPO / "configs" / f"{city}.yml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return city_bounds(Settings(raw=raw, config_path=path, data_root=root, output_dir=root, cache_dir=root))


def write_place(root: Path, city: str, folder: Path, info: dict) -> dict:
    import pandas as pd

    bounds = place_bounds(root, city)
    expected = count(bounds)
    log.info("%s: %d current points in %s", city, expected, [round(b, 4) for b in bounds])
    rows = fetch(bounds)
    table = pd.DataFrame(rows, columns=["objectid", "address_id", "unit", "x", "y"]).drop_duplicates("objectid")
    table = table.sort_values("objectid").reset_index(drop=True)
    path = folder / f"{city}.parquet"
    table.to_parquet(path, index=False)
    meta = {
        "dataset": "LINZ NZ Addresses (current address points)",
        "source_url": SERVICE,
        "linz_layer": "https://data.linz.govt.nz/layer/105689-nz-addresses/",
        "licence": "CC BY 4.0, Land Information New Zealand",
        "query": {"where": WHERE, "bbox_wgs84": [round(b, 6) for b in bounds], "out_fields": FIELDS, "out_sr": 2193},
        "bounds_rule": "destinations.city_bounds: the place's census blocks plus 0.08 degrees",
        "count_expected": expected,
        "count": int(len(table)),
        "service": info,
        "downloaded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "crs": "EPSG:2193",
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    Path(str(path) + ".metadata.json").write_text(json.dumps(meta, indent=2))
    if len(table) != expected:
        log.warning("%s: fetched %d, the service counted %d", city, len(table), expected)
    return {"city": city, "count": len(table), "expected": expected}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--city", nargs="*", help="places to fetch (default: every config)")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="the folder's date (default: today)")
    parser.add_argument("--count-only", action="store_true")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    root = Path(args.data_root)
    cities = args.city or sorted(p.stem for p in (REPO / "configs").glob("*.yml"))
    folder = root / "raw" / "nz" / "addresses" / f"linz_nz_addresses_{args.date}"
    folder.mkdir(parents=True, exist_ok=True)
    info = service_info()
    log.info("service: %s", info)
    if args.count_only:
        for city in cities:
            print(city, count(place_bounds(root, city)))
        return 0
    with ThreadPoolExecutor(args.workers) as pool:
        results = list(pool.map(lambda c: write_place(root, c, folder, info), cities))
    for r in results:
        print(json.dumps(r))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
