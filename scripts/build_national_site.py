"""Gather the cities TEAM has built into one site.

Each city is built on its own, into its own output folder. This collects them
under one site, each city's data in its own folder, and writes the index the
site opens on:

    site/index.html          the app, once
    site/data/cities.json    every city, with the figures the opening view needs
    site/data/<city>/...     that city's data files

The index is small on purpose. A visitor arrives, sees every city and what
each one is like, and only then downloads the megabyte and a half that one
city costs.

    python scripts/build_national_site.py --out <site> --city <build dir> ...
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import shutil
from pathlib import Path

from team import __version__

log = logging.getLogger("national")

REPO_WEB = Path(__file__).resolve().parents[1] / "web"
DATA_FILES = ("cells.json", "summary.json", "places.json", "destinations.json", "overlays.json")


def weighted_median(values, weights) -> float | None:
    import numpy as np

    values = np.asarray(values, dtype="float64")
    weights = np.asarray(weights, dtype="float64")
    keep = np.isfinite(values) & (weights > 0)
    if not keep.any():
        return None
    order = np.argsort(values[keep])
    running = np.cumsum(weights[keep][order])
    return float(values[keep][order][np.searchsorted(running, running[-1] / 2)])


def headline(summary: dict, cells_path: Path) -> dict:
    """The few figures the opening view shows for a city.

    Each is one a visitor can find again inside the city: the share who reach
    all three everyday services in time, and the jobs a typical resident
    reaches by public transport. Jobs are a count, not a share of the city's
    own jobs, because a share makes a small city look well served just for
    having few jobs to divide by.
    """
    import pandas as pd

    meta = summary["meta"]
    cells = pd.read_parquet(cells_path)
    people = cells["population"].fillna(0.0)
    everyday = [s for s in ("supermarket", "gp", "pharmacy") if f"meets_{s}" in cells]
    all_three = None
    if everyday:
        meets = cells[[f"meets_{s}" for s in everyday]].fillna(False).all(axis=1)
        all_three = float((people * meets).sum() / people.sum())
    jobs = weighted_median(cells["jobs45_pt"], people) if "jobs45_pt" in cells else None
    share = weighted_median(cells["jobshare45_pt"], people) if "jobshare45_pt" in cells else None
    return {
        "slug": meta["naming"]["slug"],
        "place": meta["naming"]["place"],
        "residents": meta["naming"]["residents"],
        "agency": meta["naming"].get("agency"),
        "population": meta["totals"]["population"],
        "cells": meta["totals"]["cells"],
        "everyday_all_share": round(all_three, 4) if all_three is not None else None,
        "jobs_pt_45_typical": round(jobs, -2) if jobs is not None else None,
        "jobs_pt_45_share": round(share, 4) if share is not None else None,
        "fare_kind": (meta.get("fares") or {}).get("kind"),
        "fare_zones": len((meta.get("fares") or {}).get("zones") or []),
        "routing_date": meta.get("routing_date"),
    }


THUMB_WIDTH, THUMB_HEIGHT = 640, 400
MET, MISSED, UNROUTED = "#2a78d6", "#eb6834", "#c9cdd0"


def thumbnail(cells_path: Path, out: Path) -> None:
    """A small map of the city for the opening view: every populated hexagon,
    blue where a supermarket, GP and pharmacy are all within their standards
    without a car, orange where not. Drawn from the city's own data, so the
    picture is the finding rather than decoration. It is framed on the urban
    area, so a region's farmland does not shrink the city to a speck."""
    import h3
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    from matplotlib.collections import PolyCollection

    cells = pd.read_parquet(cells_path)
    everyday = [c for c in ("meets_supermarket", "meets_gp", "meets_pharmacy") if c in cells]
    met = cells[everyday].fillna(False).all(axis=1).to_numpy() if everyday else np.zeros(len(cells), bool)
    routed = cells[[c for c in cells.columns if c.startswith("best_")]].notna().any(axis=1).to_numpy()
    centres = np.array([h3.cell_to_latlng(c) for c in cells.index])
    lat0 = float(np.median(centres[:, 0]))
    scale = np.cos(np.radians(lat0))

    # Frame the middle 98% of urban residents, or of everyone if all are urban.
    focus = cells["urban"].to_numpy(bool) if "urban" in cells else np.ones(len(cells), bool)
    people = cells["population"].fillna(0).to_numpy() * focus

    def trimmed(values):
        order = np.argsort(values)
        share = np.cumsum(people[order]) / people.sum()
        return values[order][np.searchsorted(share, 0.01)], values[order][np.searchsorted(share, 0.99)]

    x_all = centres[:, 1] * scale
    y_all = centres[:, 0]
    (x0, x1), (y0, y1) = trimmed(x_all), trimmed(y_all)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    span = max((x1 - x0) / THUMB_WIDTH, (y1 - y0) / THUMB_HEIGHT) * 1.22
    half_w, half_h = span * THUMB_WIDTH / 2, span * THUMB_HEIGHT / 2
    inside = (np.abs(x_all - cx) < half_w * 1.1) & (np.abs(y_all - cy) < half_h * 1.1)

    polygons = [
        [(lng * scale, lat) for lat, lng in h3.cell_to_boundary(cell)]
        for cell in cells.index[inside]
    ]
    colours = np.where(met, MET, np.where(routed, MISSED, UNROUTED))[inside]
    fig = plt.figure(figsize=(THUMB_WIDTH / 100, THUMB_HEIGHT / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.add_collection(PolyCollection(polygons, facecolors=colours, edgecolors=colours, linewidths=0.2))
    ax.set_xlim(cx - half_w, cx + half_w)
    ax.set_ylim(cy - half_h, cy + half_h)
    ax.set_axis_off()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, transparent=True)
    plt.close(fig)
    # Three colours and a background need no more than a small palette, which
    # takes the file from over 100 KB to a few tens.
    from PIL import Image

    image = Image.open(out).convert("RGBA")
    image.quantize(colors=16, method=Image.Quantize.FASTOCTREE).save(out, optimize=True)


def extent(places: list[dict]) -> list[float] | None:
    """Where the people are, as a bounding box, trimmed at both ends."""
    lons = sorted(p["lon"] for p in places if p.get("lon") is not None)
    lats = sorted(p["lat"] for p in places if p.get("lat") is not None)
    if not lons or not lats:
        return None
    cut = max(1, len(lons) // 100)
    return [lons[cut], lats[cut], lons[-cut - 1], lats[-cut - 1]]


def build(out: Path, builds: list[Path]) -> dict:
    site = out
    data = site / "data"
    data.mkdir(parents=True, exist_ok=True)

    cities = []
    for build_dir in builds:
        source = build_dir / "site" / "data"
        if not (source / "summary.json").exists():
            log.warning("skipping %s: no summary.json, has it been built?", build_dir)
            continue
        summary = json.loads((source / "summary.json").read_text(encoding="utf-8"))
        card = headline(summary, build_dir / "team_cells.parquet")
        slug = card["slug"]
        target = data / slug
        target.mkdir(parents=True, exist_ok=True)
        for name in DATA_FILES:
            for suffix in ("", ".gz", ".br"):
                path = source / f"{name}{suffix}"
                if path.exists():
                    shutil.copy2(path, target / path.name)
        places = json.loads((source / "places.json").read_text(encoding="utf-8"))
        card["bbox"] = extent(places)
        card["places"] = len(places)
        thumbnail(build_dir / "team_cells.parquet", target / "thumb.png")
        card["thumb"] = f"{slug}/thumb.png"
        cities.append(card)
        log.info("%s: %s residents, %s places", card["place"], f"{card['population']:,}", len(places))

        downloads = build_dir / "site" / "downloads"
        if downloads.exists():
            shutil.copytree(downloads, site / "downloads" / slug, dirs_exist_ok=True)

    cities.sort(key=lambda c: -c["population"])
    index = {
        "version": __version__,
        "built": dt.date.today().isoformat(),
        "cities": cities,
        "totals": {
            "population": sum(c["population"] for c in cities),
            "cities": len(cities),
        },
    }
    text = json.dumps(index, separators=(",", ":"), ensure_ascii=False)
    (data / "cities.json").write_text(text, encoding="utf-8")

    for item in REPO_WEB.iterdir():
        if item.name == "data":
            continue
        target = site / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
    log.info("site: %d cities, %s residents", len(cities), f"{index['totals']['population']:,}")
    return index


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="folder to assemble the site in")
    parser.add_argument("--city", required=True, nargs="+", type=Path, help="one build directory per city")
    args = parser.parse_args()
    index = build(args.out.expanduser().resolve(), [p.expanduser().resolve() for p in args.city])
    print(json.dumps([{k: c[k] for k in ("place", "population", "everyday_all_share", "jobs_pt_45_typical")} for c in index["cities"]], indent=2))


if __name__ == "__main__":
    main()
