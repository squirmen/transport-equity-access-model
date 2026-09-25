"""Fetch the 2023 Census fields TEAM needs to describe who lives somewhere.

TEAM already reads age, household income and vehicle access at SA1. This adds
the fields behind the group filters: ethnicity, disability, study, and the
finer age brackets that decide which public transport fare a person pays.

Three Stats NZ layers, all keyed on SA12023_V1_00 and all 33,164 rows:

    individuals part 1   age, ethnicity, Maori descent, disability
    individuals part 2   study participation, personal income
    households           vehicles, household income, tenure

Layer ids 1 and 3 are used rather than 0 and 2, which are clipped to the
coastline and drop rows.

Two things about these counts that change how they must be used:

Every cell is randomly rounded to base 3 on its own, including the totals, so
the parts genuinely do not add up to the total. Summing the six bands for 65
and over reproduces the published "65 years and over" cell in only about two
SA1s in five. Where Stats NZ publishes the bracket you want as its own cell,
take it. Where it does not, divide by the published "total stated" rather
than by a sum of parts.

A negative value is a suppressed cell, not a zero. A suppressed cell holds
between one and five people, so treating it as zero biases every share down.
It is left missing here and handled in people.py.

Run:  python scripts/fetch_census_equity.py --data-root <root>
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

log = logging.getLogger("fetch_census")

BASE = "https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services"
INDIVIDUALS_1 = f"{BASE}/2023_Census_totals_by_topic_for_individuals_by_SA1/FeatureServer/1"
INDIVIDUALS_2 = f"{BASE}/2023_Census_totals_by_topic_for_individuals_by_SA1/FeatureServer/3"
PAGE = 2000

KEY = "SA12023_V1_00"

# Stats NZ publishes these brackets as their own cells, so they are taken
# rather than added up.
AGE_FIELDS = [
    "VAR_1_3",    # usual resident population, never suppressed
    "VAR_1_49",   # 0 to 4
    "VAR_1_52",   # 15 to 19, the band every fare bracket edge falls inside
    "VAR_1_53",   # 20 to 24
    "VAR_1_68",   # total, five-year table
    "VAR_1_80",   # under 15
    "VAR_1_81",   # 15 to 29
    "VAR_1_82",   # 30 to 64
    "VAR_1_83",   # 65 and over
    "VAR_1_84",   # total, lifecycle table
]
ETHNICITY_FIELDS = [f"VAR_1_{n}" for n in range(158, 169)]   # 158 European to 168 total stated
DISABILITY_FIELDS = [f"VAR_1_{n}" for n in range(434, 439)]  # 435 disabled, 438 total stated
STUDY_FIELDS = [f"VAR_2_{n}" for n in range(150, 156)]       # 150 full time to 155 total stated
INCOME_FIELDS = [f"VAR_2_{n}" for n in range(405, 415)] + ["VAR_2_404"]  # bands and the median

TARGETS = {
    "statsnz_census_individual_equity_sa1_2023": {
        "url": INDIVIDUALS_1,
        "fields": AGE_FIELDS + ETHNICITY_FIELDS + DISABILITY_FIELDS,
        "notes": "2023 Census age brackets, ethnicity, and disability by SA1, for TEAM's group filters.",
    },
    "statsnz_census_individual_part2_sa1_2023": {
        "url": INDIVIDUALS_2,
        "fields": STUDY_FIELDS + INCOME_FIELDS,
        "notes": "2023 Census study participation and personal income by SA1.",
    },
}


def fetch_layer(url: str, fields: list[str], pause: float = 0.2) -> list[dict]:
    """Every row of a layer, paged at the server's maximum record count."""
    out: list[dict] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode(
            {
                "where": "1=1",
                "outFields": ",".join([KEY, *fields]),
                "returnGeometry": "false",
                "resultOffset": offset,
                "resultRecordCount": PAGE,
                "f": "json",
            }
        )
        with urllib.request.urlopen(f"{url}/query?{query}", timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if "error" in payload:
            raise SystemExit(f"ArcGIS error: {payload['error']}")
        rows = [feature["attributes"] for feature in payload.get("features", [])]
        out.extend(rows)
        log.info("  %d rows", len(out))
        if len(rows) < PAGE or not payload.get("exceededTransferLimit", len(rows) == PAGE):
            break
        offset += PAGE
        time.sleep(pause)
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--only", help="fetch one dataset by name")
    args = parser.parse_args()
    folder = args.data_root.expanduser().resolve() / "raw" / "auckland" / "census"
    folder.mkdir(parents=True, exist_ok=True)

    for name, spec in TARGETS.items():
        if args.only and args.only != name:
            continue
        log.info("%s", name)
        rows = fetch_layer(spec["url"], spec["fields"])
        path = folder / f"{name}.json"
        path.write_text(
            json.dumps({"dataset_id": name, "source_url": spec["url"], "records": rows}, separators=(",", ":")),
            encoding="utf-8",
        )
        path.with_suffix(".json.metadata.json").write_text(
            json.dumps(
                {
                    "attribution": "Stats NZ",
                    "dataset_id": name,
                    "downloaded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "fetch_method": "arcgis_table",
                    "license": "CC-BY-4.0",
                    "notes": spec["notes"],
                    "out_fields": ",".join([KEY, *spec["fields"]]),
                    "record_count": len(rows),
                    "source_url": spec["url"],
                    "where": "1=1",
                    "confidentiality": (
                        "Counts are randomly rounded to base 3 independently, so parts do not sum to totals. "
                        "Negative values mark suppressed cells and must be treated as missing, not zero."
                    ),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log.info("  wrote %s (%d rows)", path.name, len(rows))


if __name__ == "__main__":
    main()
