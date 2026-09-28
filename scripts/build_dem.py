"""Elevation for a place, from LINZ's national elevation models.

Given an elevation model, R5 slows walking and cycling on slopes: Tobler's
hiking function by default, or Minetti's energy cost. Without one, every
street is flat, which flatters hilly places such as Wellington and Dunedin,
and older people most of all.

LINZ publishes two national elevation models as open, cloud-optimised
GeoTIFFs on AWS, with STAC metadata and no key needed:

    dem_1m   LiDAR, 1 m, surveyed 2008 to 2026, most of the populated country
    dem_8m   from 20 m contours, 8 m, the whole country

For one place this reads only the tiles that cover its street network, at
about the resolution wanted rather than the full 1 m, lays the 8 m model down
first and the LiDAR over it wherever the LiDAR has a value, and writes one
single-band GeoTIFF in WGS84, which r5py passes to R5. The sea and anything
else neither model covers is set to 0 m.

A LiDAR elevation model is bare earth, so a bridge takes the height of the
ground under it. How much that matters depends on how R5 samples an edge; see
the note written beside the output.

    python scripts/build_dem.py --data-root <root> --city wellington
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import logging
import math
import urllib.request
from pathlib import Path

log = logging.getLogger("build_dem")

BUCKET = "https://nz-elevation.s3.ap-southeast-2.amazonaws.com"
MODELS = {
    # Laid down in this order, so the finer model wins where it has a value.
    "dem_8m": f"{BUCKET}/new-zealand/new-zealand-contour/dem_8m/2193/collection.json",
    "dem_1m": f"{BUCKET}/new-zealand/new-zealand/dem_1m/2193/collection.json",
}
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tiff,.tif",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "VSI_CACHE": "TRUE",
}


def _get_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "TEAM/0.7 (Better Places Lab)"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def tile_index(root: Path, name: str, url: str) -> list[dict]:
    """Every tile of a model with its WGS84 bounds, cached beside the data."""
    cache = root / "raw" / "nz" / "elevation" / f"{name}_index.json"
    if cache.exists():
        return json.loads(cache.read_text())
    collection = _get_json(url)
    base = url.rsplit("/", 1)[0]
    items = [link["href"] for link in collection.get("links", []) if link.get("rel") == "item"]

    def one(href: str) -> dict | None:
        item_url = f"{base}/{href.lstrip('./')}"
        item = _get_json(item_url)
        asset = next((a for a in item.get("assets", {}).values() if str(a.get("href", "")).endswith((".tiff", ".tif"))), None)
        if not asset or not item.get("bbox"):
            return None
        tiff = asset["href"] if asset["href"].startswith("http") else f"{base}/{asset['href'].lstrip('./')}"
        return {"id": item.get("id"), "bbox": item["bbox"], "href": tiff}

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        tiles = [t for t in pool.map(one, items) if t]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(tiles))
    log.info("%s: indexed %d tiles", name, len(tiles))
    return tiles


def place_bbox(root: Path, city: str) -> tuple[float, float, float, float]:
    """The bounds the street network was clipped to, so every edge has a height.

    Places set up with add_city.py record the clip box beside the network.
    """
    meta_path = root / "raw" / city / "osm" / f"{city}_bbox.osm.pbf.metadata.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        west, south, east, north = (float(v) for v in str(meta["bbox"]).split(","))
        return west, south, east, north
    import geopandas as gpd
    import yaml

    # Auckland's network predates that record, and its ways run far out of the
    # region, so its box is the census area with a margin wider than a
    # sixty-minute walk. Beyond it, the few edges a route could reach count as flat.
    config = yaml.safe_load((Path(__file__).resolve().parents[1] / "configs" / f"{city}.yml").read_text())
    west, south, east, north = gpd.read_file(root / config["data"]["census_sa1"]).total_bounds
    margin = 0.08
    return west - margin, south - margin, east + margin, north + margin


def build(root: Path, city: str, metres: float = 20.0) -> Path:
    import numpy as np
    import rasterio
    from affine import Affine
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, transform_bounds
    from rasterio.windows import from_bounds

    west, south, east, north = place_bbox(root, city)
    mid = math.radians((south + north) / 2)
    dy = metres / 111_320
    dx = metres / (111_320 * math.cos(mid))
    width = math.ceil((east - west) / dx)
    height = math.ceil((north - south) / dy)
    transform = from_origin(west, north, dx, dy)
    out = np.full((height, width), np.nan, dtype="float32")
    log.info("%s: %d x %d grid at about %.0f m", city, width, height, metres)

    used: dict[str, list[str]] = {}
    with rasterio.Env(**GDAL_ENV):
        for name, url in MODELS.items():
            tiles = [t for t in tile_index(root, name, url)
                     if t["bbox"][0] < east and t["bbox"][2] > west and t["bbox"][1] < north and t["bbox"][3] > south]
            used[name] = [t["id"] for t in tiles]
            for tile in tiles:
                with rasterio.open(f"/vsicurl/{tile['href']}") as src:
                    left, bottom, right, top = transform_bounds("EPSG:4326", src.crs, west, south, east, north)
                    left, bottom = max(left, src.bounds.left), max(bottom, src.bounds.bottom)
                    right, top = min(right, src.bounds.right), min(top, src.bounds.top)
                    if left >= right or bottom >= top:
                        continue
                    window = from_bounds(left, bottom, right, top, src.transform).round_offsets().round_lengths()
                    # Read at half the output spacing: the file's overviews do the
                    # averaging, so a 1 m tile costs a fraction of its size.
                    step = metres / 2
                    shape = (max(1, round((top - bottom) / step)), max(1, round((right - left) / step)))
                    band = src.read(1, window=window, out_shape=shape, resampling=Resampling.average, masked=True)
                    data = band.filled(np.nan).astype("float32")
                    scaled = src.window_transform(window) * Affine.scale(window.width / shape[1], window.height / shape[0])
                    reproject(
                        data, out,
                        src_transform=scaled, src_crs=src.crs, src_nodata=np.nan,
                        dst_transform=transform, dst_crs="EPSG:4326", dst_nodata=np.nan,
                        resampling=Resampling.bilinear, init_dest_nodata=False,
                    )
            log.info("%s: %s, %d tiles", city, name, len(tiles))

    covered = float(np.isfinite(out).mean())
    out = np.where(np.isfinite(out), out, 0.0).astype("float32")
    path = root / "raw" / city / "elevation" / f"{city}_dem_{int(metres)}m.tif"
    path.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver": "GTiff", "height": height, "width": width, "count": 1, "dtype": "float32",
        "crs": "EPSG:4326", "transform": transform, "compress": "LZW", "predictor": 2,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(out, 1)
    path.with_suffix(".tif.metadata.json").write_text(json.dumps({
        "dataset_id": path.stem,
        "written_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "attribution": "LINZ, New Zealand LiDAR 1m DEM and New Zealand 8m DEM (from contours)",
        "license": "CC-BY-4.0",
        "source": {name: url for name, url in MODELS.items()},
        "tiles": used,
        "spacing_metres": metres,
        "crs": "EPSG:4326",
        "share_with_a_value": round(covered, 4),
        "method": "The 8 m model laid down first, the 1 m LiDAR over it where it has a value, "
                  "each read through its overviews and averaged to the grid. The sea and gaps are 0 m.",
        "caveat": "LiDAR elevation is bare earth, so a bridge takes the height of the ground beneath it.",
    }, indent=2))
    log.info("%s: wrote %s (%.0f%% had a value before gaps were set to 0 m)", city, path.name, 100 * covered)
    return path


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--city", required=True, nargs="+")
    parser.add_argument("--metres", type=float, default=20.0, help="grid spacing (default 20 m)")
    args = parser.parse_args()
    root = args.data_root.expanduser().resolve()
    for city in args.city:
        build(root, city, args.metres)


if __name__ == "__main__":
    main()
