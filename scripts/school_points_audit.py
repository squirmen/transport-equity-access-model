"""Check every school's map point in every place, and apply rule D5-1.

For each place config given, compares each school's directory point with its
grounds in LINZ NZ Facilities and OpenStreetMap and with the street network
(src/team/school_points.py has the rule and the sources). Writes:

    <to>/school_points_audit.csv     every school, every measure
    <to>/school_points_to_check.csv  schools that need a person's look: not moved by rule, not checked
    <to>/school_points_moved.csv     schools rule D5-1 moves

With --write-points the moves go into configs/schools/points.csv (rows with
rule D5-1; rows a person checked are kept as they are). With --snap DIR, the
metres from each point to where R5 links it are read from DIR/<place>.json
(written by `team schools stops`).

    PYTHONPATH=src python scripts/school_points_audit.py --data-root DATA --out-root OUTS \\
        --to REPORTS [--write-points] [--snap DIR] configs/*.yml
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from team import config, school_points, schools  # noqa: E402

POINT_FIELDS = ["moe", "name", "lon", "lat", "source", "reason", "rule", "checked_by", "checked_on"]


def write_points(moves: pd.DataFrame, path: Path, checked_on: str) -> None:
    """Replace the rule's rows in points.csv, keeping the header comments and every row a person checked."""
    lines = path.read_text(encoding="utf-8").splitlines()
    comments = [line for line in lines if line.lstrip().startswith("#")]
    body = [line for line in lines if not line.lstrip().startswith("#")]
    rows = list(csv.DictReader(body)) if body else []
    kept = [r for r in rows if (r.get("rule") or "") != school_points.RULE]
    new = school_points.point_rows(moves, checked_on)
    by_hand = {int(r["moe"]) for r in kept if r.get("moe")}
    new = new[~new["moe"].isin(by_hand)]
    with path.open("w", encoding="utf-8", newline="") as handle:
        for line in comments:
            handle.write(line + "\n")
        writer = csv.DictWriter(handle, fieldnames=POINT_FIELDS, lineterminator="\n")
        writer.writeheader()
        for row in kept:
            writer.writerow({k: row.get(k, "") for k in POINT_FIELDS})
        for row in new.sort_values("moe").to_dict("records"):
            writer.writerow({k: row.get(k, "") for k in POINT_FIELDS})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("configs", nargs="+", type=Path)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--out-root", required=True, type=Path, help="folder holding each place's build output, <out-root>/<place>")
    parser.add_argument("--to", required=True, type=Path)
    parser.add_argument("--work", type=Path, help="folder for the filtered OpenStreetMap files (default: <to>/osm)")
    parser.add_argument("--snap", type=Path, help="folder of <place>.json files: metres to R5's link, by MoE number")
    parser.add_argument("--write-points", action="store_true")
    parser.add_argument("--checked-on", default=dt.date.today().isoformat())
    args = parser.parse_args()
    args.to.mkdir(parents=True, exist_ok=True)
    work = args.work or args.to / "osm"
    frames = []
    for path in args.configs:
        settings = config.load(path, args.data_root, args.out_root / path.stem)
        snapped = None
        if args.snap and (args.snap / f"{path.stem}.json").exists():
            snapped = {int(k): float(v) for k, v in json.loads((args.snap / f"{path.stem}.json").read_text()).items()}
        listed = schools.school_table(settings)
        frame = school_points.audit_place(settings, work / path.stem, snapped, listed)
        frames.append(frame)
        print(f"{path.stem}: {len(frame)} schools, {int(frame['move'].sum())} moved by rule, "
              f"{int(frame['checked'].notna().sum())} checked by a person, "
              f"{int(school_points.to_check(frame).sum())} to check", flush=True)
    audited = pd.concat(frames, ignore_index=True)
    audited.to_csv(args.to / "school_points_audit.csv", index=False)
    to_check = audited[school_points.to_check(audited)]
    to_check.to_csv(args.to / "school_points_to_check.csv", index=False)
    moves = audited[audited["move"]].drop_duplicates("moe")
    moves.to_csv(args.to / "school_points_moved.csv", index=False)
    summary = {
        "schools": int(audited["moe"].nunique()),
        "entries": int(len(audited)),
        "inside_linz": int((audited["linz_outside_m"] == 0).sum()),
        "within_50m": int(((audited["linz_outside_m"] > 0) & (audited["linz_outside_m"] <= 50)).sum()),
        "over_50m": int((audited["linz_outside_m"] > 50).sum()),
        "no_linz": int(audited["linz_outside_m"].isna().sum()),
        "inside_other": int((audited["inside_other"].notna() | audited["inside_other_osm"].notna()).sum()),
        "moved": moves[["moe", "name", "moved_m"]].to_dict("records"),
        "checked_moved": int(audited.loc[audited["checked"] == "moved", "moe"].nunique()),
        "checked_kept": int(audited.loc[audited["checked"] == "kept", "moe"].nunique()),
        "to_check": int(to_check["moe"].nunique()),
        "rule": school_points.RULE_TEXT,
    }
    (args.to / "school_points_summary.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "rule"}, indent=1, default=str))
    if args.write_points:
        write_points(moves, Path(schools.REPO_CONFIGS) / "points.csv", args.checked_on)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
