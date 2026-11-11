"""Check a place's school runs against the services runs they replace.

Before any map point changes, a school routed on its own must get exactly the
minutes it got inside the services run. This compares every pair, by school
and service, for every mode, and leaves out only schools that are new or
whose point moved (listed in the report).

    PYTHONPATH=src python scripts/check_school_runs.py --config configs/auckland.yml \\
        --data-root DATA --out OUT [--json report.json]

Needs OUT/destinations/services_with_schools.parquet (written by
`team schools split`) and the schools_* runs. Exits 1 if any pair differs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from team import config, measures, routing, schools  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    settings = config.load(args.config, args.data_root, args.out, args.cache)
    folder = settings.output_dir / "destinations"
    old = pd.read_parquet(folder / "services_with_schools.parquet")
    ids = schools.school_service_ids(settings)
    old = old[old["service"].isin(ids)]
    new = pd.read_parquet(folder / "schools.parquet")
    both = old.merge(new, on=["source_id", "service"], suffixes=("_old", "_new"))
    same_point = both[(both["lon_old"].round(6) == both["lon_new"].round(6)) & (both["lat_old"].round(6) == both["lat_new"].round(6))]
    unchanged = set(zip(same_point["source_id"], same_point["service"]))
    changed = sorted(set(zip(new["source_id"], new["service"])) - unchanged)
    to_source = old.drop_duplicates("id").set_index("id")["source_id"]
    report = {"place": settings.raw["name"], "left_out": [f"{s} {v}" for s, v in changed], "modes": {}}
    failed = False
    for mode_id, mode in settings.modes.items():
        transit = mode["kind"] == "transit"
        windows = sorted({w for s in ids for w in routing.service_windows(settings.services[s])}) if transit else [None]
        for window in windows:
            old_tag = routing.run_tag("services", mode_id, window, transit)
            new_tag = measures.school_tag(settings, mode_id, window)
            before = measures.load_pairs(settings, old_tag)
            after = schools.load_reach(settings, new_tag)
            if before is None or after is None:
                report["modes"][new_tag] = "not routed"
                continue
            before = before[before["service"].isin(ids)].copy()
            before["destination"] = before["destination"].astype(str).map(to_source)
            keep_before = pd.Series(list(zip(before["destination"], before["service"]))).isin(unchanged).to_numpy()
            keep_after = pd.Series(list(zip(after["destination"], after["service"]))).isin(unchanged).to_numpy()
            b = before[keep_before].set_index(["origin", "destination", "service"])["minutes"].astype(int)
            a = after[keep_after].set_index(["origin", "destination", "service"])["minutes"].astype(int)
            joined = pd.concat({"before": b, "after": a}, axis=1)
            differ = int(((joined["before"] != joined["after"]) & joined.notna().all(axis=1)).sum())
            only_before = int((joined["before"].notna() & joined["after"].isna()).sum())
            only_after = int((joined["after"].notna() & joined["before"].isna()).sum())
            report["modes"][new_tag] = {"pairs": int(len(joined)), "differ": differ, "only_before": only_before, "only_after": only_after}
            failed |= bool(differ or only_before or only_after)
    report["identical"] = not failed
    text = json.dumps(report, indent=2)
    print(text)
    if args.json:
        args.json.write_text(text + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
