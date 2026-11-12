"""Freeze the Ministry of Education's schools directory as one dated snapshot.

Every place reads the same national file, so all twenty are built from the
directory as it stood on one day. The file keeps all 51 fields.

    # fetch from data.govt.nz (CKAN datastore, CC BY 4.0)
    python scripts/fetch_school_directory.py --data-root DATA

    # or freeze a copy already downloaded from the datastore dump
    python scripts/fetch_school_directory.py --data-root DATA --from-file schools.csv \\
        --retrieved 2026-11-12T10:50:00+13:00

Writes raw/nz/education/moe_schools_directory_<date>.csv and a
.metadata.json beside it with the record count, roll dates, the dataset's
modified time and a checksum. Point each config's `data.schools` at it.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

RESOURCE = "4b292323-9fcc-41f8-814b-3c7b19cf14b3"
PACKAGE = "c1923d33-e781-46c9-9ea1-d9b850082be4"
API = "https://catalogue.data.govt.nz/api/3/action"
DUMP = f"https://catalogue.data.govt.nz/datastore/dump/{RESOURCE}"
PAGE = 1000


def _get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "team-access/0.12 (research build)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch_rows() -> tuple[list[str], list[dict]]:
    rows: list[dict] = []
    fields: list[str] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode({"resource_id": RESOURCE, "limit": PAGE, "offset": offset})
        page = _get(f"{API}/datastore_search?{query}")["result"]
        fields = fields or [f["id"] for f in page["fields"]]
        got = page["records"]
        rows.extend(got)
        offset += len(got)
        if len(got) < PAGE:
            break
    return fields, rows


def package_dates() -> dict:
    try:
        package = _get(f"{API}/package_show?id={PACKAGE}")["result"]
    except Exception:
        return {}
    resource = next((r for r in package.get("resources", []) if r.get("id") == RESOURCE), {})
    return {
        "package_modified": package.get("metadata_modified"),
        "resource_last_modified": resource.get("last_modified"),
        "resource_url": resource.get("url"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--from-file", type=Path, help="a datastore dump already downloaded (CSV)")
    parser.add_argument("--retrieved", help="when --from-file was downloaded (ISO time)")
    parser.add_argument("--package-json", type=Path, help="package_show output saved with --from-file, for the dataset dates")
    parser.add_argument("--date", help="snapshot date for the file name (default: the retrieved date)")
    args = parser.parse_args()

    if args.from_file:
        text = args.from_file.read_text(encoding="utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        fields = list(reader.fieldnames or [])
        rows = list(reader)
        retrieved = args.retrieved or dt.datetime.fromtimestamp(args.from_file.stat().st_mtime).astimezone().isoformat(timespec="seconds")
        how = f"datastore dump {DUMP}, saved as {args.from_file.name}"
        dates = {}
        if args.package_json and args.package_json.exists():
            package = json.loads(args.package_json.read_text(encoding="utf-8"))["result"]
            resource = next((r for r in package.get("resources", []) if r.get("id") == RESOURCE), {})
            dates = {"package_modified": package.get("metadata_modified"),
                     "resource_last_modified": resource.get("last_modified"), "resource_url": resource.get("url")}
    else:
        fields, rows = fetch_rows()
        retrieved = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        how = f"{API}/datastore_search, resource {RESOURCE}, {PAGE} rows a page"
        dates = package_dates()

    fields = [f for f in fields if f != "_id"]
    day = args.date or retrieved[:10]
    out = args.data_root / "raw" / "nz" / "education" / f"moe_schools_directory_{day}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    rows.sort(key=lambda r: int(r["School_Id"]))
    with out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fields})
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    meta = {
        "title": "Ministry of Education schools directory, all of New Zealand",
        "attribution": "Ministry of Education / Education Counts",
        "license": "CC-BY-4.0",
        "dataset": f"https://catalogue.data.govt.nz/dataset/{PACKAGE}",
        "resource_id": RESOURCE,
        "fetched_with": how,
        "retrieved": retrieved,
        **dates,
        "record_count": len(rows),
        "field_count": len(fields),
        "status": dict(Counter(r.get("Status") or "" for r in rows)),
        "roll_dates": dict(Counter((r.get("Roll_Date") or "")[:10] or "none" for r in rows)),
        "sha256": digest,
    }
    Path(str(out) + ".metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(rows)} schools, {len(fields)} fields)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
