"""Tertiary and trades training teaching sites, placed on LINZ addresses.

No one register lists where post-school study happens. The Ministry of
Education's provider directory gives head offices, and OpenStreetMap misses
some main campuses. So the list is kept by hand, from NZQA's delivery sites and
the providers' own campus pages, one row per teaching site, with the page it
came from (raw/nz/education/tertiary_sites_src_<date>.csv).

This places each site on the LINZ NZ Addresses point for its street address
(layer 123113, CC BY 4.0), unless the row already gives a point, as it does
for the main entrance of a large campus, and writes the file TEAM reads.

    LINZ_API_KEY=... python scripts/build_tertiary.py --data-root <root> \\
        --source raw/nz/education/tertiary_sites_src_2026-09-30.csv

The key is read from the environment or from --key-file and never written out.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

log = logging.getLogger("build_tertiary")

WFS = "https://data.linz.govt.nz/services;key={key}/wfs"
LAYER = "layer-123113"
NUMBER = re.compile(r"^\s*(?:[A-Za-z0-9]+/)?(\d+)[A-Za-z]?(?:\s*[-–]\s*(\d+)[A-Za-z]?)?\s+(.+)$")
ROAD = re.compile(r"^\s*([A-Za-zĀ-ž' ]+?\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Place|Pl|Lane|Terrace|Tce|Crescent|Cres|Way|Quay|Parade|Highway|Grove|Rise|Close|Boulevard|Esplanade|Square|Mall))\b", re.I)


def _key(path: str | None) -> str:
    if os.environ.get("LINZ_API_KEY"):
        return os.environ["LINZ_API_KEY"].strip()
    if path:
        for line in Path(path).read_text().splitlines():
            if line.startswith("LINZ_API_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    raise SystemExit("Set LINZ_API_KEY or pass --key-file.")


def _query(key: str, cql: str) -> list[dict]:
    url = WFS.format(key=key) + "?" + urllib.parse.urlencode({
        "service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": LAYER,
        "outputFormat": "application/json", "count": "50", "srsName": "EPSG:4326", "cql_filter": cql,
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TEAM (Better Places Lab)"}), timeout=60) as r:
                return json.loads(r.read()).get("features", [])
        except Exception as error:  # a dropped connection is worth another go; the key never reaches the log
            if attempt == 2:
                log.warning("LINZ query failed: %s", type(error).__name__)
                return []
            time.sleep(2 * (attempt + 1))
    return []


def _ascii(text: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def split_address(address: str) -> tuple[str | None, str | None]:
    """The street number and street name: the first part of the address that
    starts with a number, after any level, unit or building name; the first
    number of a range. With no number, the first part that names a road."""
    parts = [part.strip() for part in str(address).split(",")]
    for part in parts:
        match = NUMBER.match(part)
        if match and not re.match(r"^(level|floor|floors|unit|suite|room)\b", part, re.I):
            return match.group(1), match.group(3).strip()
    for part in parts:
        match = ROAD.match(part)
        if match:
            return None, match.group(1).strip()
    return None, None


ABBREVIATIONS = {"st": "Street", "rd": "Road", "ave": "Avenue", "dr": "Drive", "pl": "Place", "tce": "Terrace",
                 "cres": "Crescent", "hwy": "Highway", "ln": "Lane"}


def _full_road(road: str) -> str:
    """A road name with its type spelt out, as LINZ has it: "Tay St" -> "Tay Street"."""
    words = road.split()
    for k, word in enumerate(words):
        full = ABBREVIATIONS.get(word.lower().rstrip("."))
        if full:
            words[k] = full
    return " ".join(words)


def _suburb(address: str) -> str:
    """The part after the street, when it names a suburb rather than a town or postcode."""
    parts = [part.strip() for part in str(address).split(",")]
    for k, part in enumerate(parts):
        if NUMBER.match(part) or ROAD.match(part):
            rest = parts[k + 1:]
            if len(rest) >= 2:
                return re.sub(r"\s*\d{4}$", "", rest[0])
            return ""
    return ""


def _range(address: str) -> list[int]:
    """Both ends of a number range, as in 314-390 Khyber Pass Road."""
    for part in str(address).split(","):
        match = NUMBER.match(part.strip())
        if match:
            return [int(n) for n in match.groups()[:2] if n]
    return []


def geocode(key: str, address: str, town: str, place: str = "") -> dict | None:
    number, road = split_address(address)
    if not road:
        return None
    road = _ascii(_full_road(road)).replace("'", "''")
    town_ascii = _ascii(town).replace("'", "''")
    suburb = _ascii(_suburb(address)).replace("'", "''")
    want = _ascii(f"{address}, {town}").lower()

    def score(feature):
        p = feature["properties"]
        return difflib.SequenceMatcher(None, want, _ascii(str(p.get("full_address", ""))).lower()).ratio()

    # The town, and the wider place ("Greater Wellington" -> "wellington"), as
    # LINZ might name the locality: Papakura's Walters Road is in Takanini, Auckland.
    hints = [_ascii(town).lower()] + [
        _ascii(part).lower().replace("greater ", "").strip()
        for part in re.split(r"\s+and\s+|-", place or "") if part.strip()
    ]

    def in_town(feature):
        p = feature["properties"]
        places = " ".join(_ascii(str(p.get(k) or "")) for k in ("town_city", "suburb_locality", "territorial_authority")).lower()
        return any(h and h in places for h in hints) or bool(suburb and suburb.lower() in places)

    found = []
    if number:
        found = _query(key, f"address_number = {int(number)} AND full_road_name_ascii ILIKE '{road}'")
        # The same number and street can be in another town or suburb: keep
        # the one in this suburb if there is one, else this town's.
        found = [f for f in found if score(f) >= 0.5]
        same = [f for f in found if suburb and _ascii(str(f["properties"].get("suburb_locality") or "")).lower().startswith(suburb.lower())]
        # With a suburb given, only a match in it will do (Auckland has two 22
        # Princes Streets); otherwise one in the town or wider place.
        found = same if suburb else [f for f in found if in_town(f)]
    method = "linz_address"
    if not found:
        # No such number, or none given: the nearest number on the same road
        # in the same town, or the middle of the road's addresses.
        area = [f"town_city_ascii ILIKE '{town_ascii}%'", f"suburb_locality_ascii ILIKE '{town_ascii}%'"]
        if suburb:
            area = [f"suburb_locality_ascii ILIKE '{suburb}%'"]
        road_hits = _query(key, f"full_road_name_ascii ILIKE '{road}' AND ({' OR '.join(area)})")
        if not road_hits and suburb:
            # The suburb given can differ from LINZ's (Petone for Korokoro).
            road_hits = _query(key, f"full_road_name_ascii ILIKE '{road}' AND (town_city_ascii ILIKE '{town_ascii}%' "
                                    f"OR territorial_authority_ascii ILIKE '{town_ascii}%')")
        if not road_hits:
            return None
        wanted = _range(address) or ([int(number)] if number else [])
        if wanted:
            best = min(road_hits, key=lambda f: min(abs((f["properties"].get("address_number") or 0) - w) for w in wanted))
            found = [best]
            method = "linz_nearest_number"
        else:
            lons = sorted(f["geometry"]["coordinates"][0] for f in road_hits)
            lats = sorted(f["geometry"]["coordinates"][1] for f in road_hits)
            mid = min(road_hits, key=lambda f: abs(f["geometry"]["coordinates"][0] - lons[len(lons) // 2])
                      + abs(f["geometry"]["coordinates"][1] - lats[len(lats) // 2]))
            found = [mid]
            method = "linz_road_middle"
    best = max(found, key=score)
    lon, lat = best["geometry"]["coordinates"][:2]
    p = best["properties"]
    return {"lon": float(lon), "lat": float(lat), "linz_address_id": p.get("address_id"), "linz_address": p.get("full_address"),
            "match": round(score(best), 2), "method": method}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--source", required=True, help="the hand-kept list, relative to the data root")
    parser.add_argument("--key-file", help="a .env file with LINZ_API_KEY=")
    args = parser.parse_args()
    root = args.data_root.expanduser().resolve()
    key = _key(args.key_file)
    table = pd.read_csv(root / args.source, dtype=str).fillna("")
    rows = []
    for row in table.to_dict("records"):
        out = dict(row)
        if row.get("lat") and row.get("lon"):
            out["point_method"] = "given"
        else:
            hit = geocode(key, row["street_address"], row.get("town", ""), row.get("place", ""))
            if hit:
                out.update({"lat": hit["lat"], "lon": hit["lon"], "linz_address_id": hit["linz_address_id"],
                            "linz_address": hit["linz_address"], "point_method": f"{hit['method']} ({hit['match']})"})
            else:
                out["point_method"] = "not found"
                log.warning("no LINZ address for %s: %s, %s", row.get("site_id"), row.get("street_address"), row.get("town"))
        rows.append(out)
        time.sleep(0.1)
    result = pd.DataFrame(rows)
    stamp = re.search(r"(\d{4}-\d{2}-\d{2})", args.source)
    out_path = root / "raw" / "nz" / "education" / f"tertiary_sites_{stamp.group(1) if stamp else dt.date.today().isoformat()}.csv"
    result.to_csv(out_path, index=False)
    placed = int((result["point_method"] != "not found").sum())
    out_path.with_suffix(".csv.metadata.json").write_text(json.dumps({
        "written_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": args.source,
        "sites": int(len(result)),
        "placed": placed,
        "attribution": "Sites from NZQA (CC BY 4.0) and providers' campus pages; points from LINZ NZ Addresses (CC BY 4.0)",
        "method": "One row per teaching site, kept by hand. Points are the LINZ address point for the street address, "
                  "or a given point at the main entrance of a large campus.",
    }, indent=2))
    log.info("wrote %s: %d sites, %d placed", out_path.name, len(result), placed)


if __name__ == "__main__":
    main()
