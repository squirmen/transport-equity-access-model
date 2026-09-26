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


def headline(summary: dict) -> dict:
    """The few figures the opening view shows for a city."""
    meta = summary["meta"]
    services = {row["service"]: row for row in summary.get("services", [])}
    jobs = [row for row in summary.get("jobs", []) if row.get("mode") == "pt" and row.get("minutes") == 45]
    everyday = [s for s in ("supermarket", "gp", "pharmacy") if s in services]
    share = (
        sum(services[s]["share_meeting"]["everyone"] for s in everyday) / len(everyday) if everyday else None
    )
    return {
        "slug": meta["naming"]["slug"],
        "place": meta["naming"]["place"],
        "residents": meta["naming"]["residents"],
        "agency": meta["naming"].get("agency"),
        "population": meta["totals"]["population"],
        "cells": meta["totals"]["cells"],
        "everyday_share": round(share, 4) if share is not None else None,
        "jobs_pt_45": round(jobs[0]["mean_share"], 4) if jobs and jobs[0].get("mean_share") is not None else None,
        "fare_kind": (meta.get("fares") or {}).get("kind"),
        "fare_zones": len((meta.get("fares") or {}).get("zones") or []),
        "routing_date": meta.get("routing_date"),
    }


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
        card = headline(summary)
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
    print(json.dumps([{k: c[k] for k in ("place", "population", "everyday_share", "jobs_pt_45")} for c in index["cities"]], indent=2))


if __name__ == "__main__":
    main()
