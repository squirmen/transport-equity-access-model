"""Before and after taking walking where it is quicker than public transport.

For each place built, compares R5's public transport figures (the `_r5`
columns of team_cells.parquet) with public transport or walking, whichever is
quicker (pt_or_walk.py), for every service and window, and jobs within 30 and
45 minutes. Weighted by all residents, with every school counted (All), so it
isolates this one change.

    standard   share of residents within the service's standard by public transport
    jobs       population-weighted mean share of the region's jobs within the minutes

Columns: place, kind, measure, window, standard, share_before, share_after,
people_before, people_after (standards only), hexagons_changed (the time or
the count differs), pairs_changed (origin-destination pairs where walking is
quicker than R5 or R5 has none within 60 minutes).

    PYTHONPATH=src python scripts/pt_or_walk_report.py --data-root DATA --out-root OUTS \\
        --cache-root CACHES --to REPORTS/d2_before_after configs/*.yml
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from team import config, pt_or_walk, routing  # noqa: E402


def _changed(pairs: pd.DataFrame | None) -> int:
    if pairs is None or "r5" not in pairs:
        return 0
    return int((~(pairs["r5"] <= pairs["minutes"])).sum())


def place_rows(settings) -> list[dict]:
    table = pd.read_parquet(settings.output_dir / "team_cells.parquet")
    people = table["population"].astype("float64")
    total = float(people.sum())
    rows = []
    schools = {sid for sid, spec in settings.services.items() if spec.get("school_types")}
    for service, spec in settings.services.items():
        standard = float(spec["standard_minutes"])
        windows = routing.service_windows(spec)
        dataset = "schools" if service in schools else "services"
        for window in windows:
            suffix = "" if window == windows[0] else f"_{window}"
            after, before = f"t_{service}_pt{suffix}", f"t_{service}_pt{suffix}_r5"
            if after not in table or before not in table:
                continue
            a, b = table[after].astype("float64"), table[before].astype("float64")
            changed = ~((a == b) | (a.isna() & b.isna()))
            pairs = pt_or_walk.load_merged(settings, dataset, "pt", window, services=[service])
            people_b, people_a = float(people[b <= standard].sum()), float(people[a <= standard].sum())
            rows.append({
                "place": settings.raw["name"], "kind": "standard", "measure": service, "window": window, "standard": standard,
                "share_before": round(people_b / total, 6), "share_after": round(people_a / total, 6),
                "people_before": round(people_b), "people_after": round(people_a),
                "hexagons_changed": int(changed.sum()), "pairs_changed": _changed(pairs),
            })
    jobs_total = float(pd.read_parquet(settings.output_dir / "destinations" / "jobs.parquet")["jobs"].sum())
    windows = routing.job_windows(settings)
    for window in windows:
        key = "pt" if window == windows[0] else f"pt_{window}"
        pairs = pt_or_walk.load_merged(settings, "jobs", "pt", window)
        for limit in settings.jobs["thresholds"]:
            after, before = f"jobs{limit}_{key}", f"jobs{limit}_{key}_r5"
            if after not in table or before not in table:
                continue
            a, b = table[after].astype("float64"), table[before].astype("float64")
            rows.append({
                "place": settings.raw["name"], "kind": "jobs", "measure": f"jobs within {limit} min", "window": window,
                "standard": float(limit),
                "share_before": round(float(np.average(b / jobs_total, weights=people)), 6),
                "share_after": round(float(np.average(a / jobs_total, weights=people)), 6),
                "people_before": None, "people_after": None,
                "hexagons_changed": int((np.abs(a - b) > 1e-6).sum()), "pairs_changed": _changed(pairs),
            })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("configs", nargs="+", type=Path)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--out-root", required=True, type=Path)
    parser.add_argument("--cache-root", type=Path, help="folder holding each place's cache, <cache-root>/<place>")
    parser.add_argument("--to", required=True, type=Path, help="path without suffix: writes .csv and .md")
    args = parser.parse_args()
    rows = []
    for path in args.configs:
        cache = args.cache_root / path.stem if args.cache_root else None
        settings = config.load(path, args.data_root, args.out_root / path.stem, cache)
        rows += place_rows(settings)
        print(path.stem, "done", flush=True)
    frame = pd.DataFrame(rows)
    args.to.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.to.with_suffix(".csv"), index=False)
    lines = ["# Public transport, or walking where that is quicker: before and after", "",
             "All residents, every school counted (All). Before: public transport as R5 routes it. After: the quicker of "
             "public transport and walking, pair by pair. Jobs: population-weighted mean share of the region's jobs.", ""]
    for place, part in frame.groupby("place", sort=False):
        lines += [f"## {place}", "", "| Measure | Window | Standard | Before | After | People before | People after | Hexagons changed | Pairs changed |",
                  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for r in part.to_dict("records"):
            people = (f"{r['people_before']:,.0f} | {r['people_after']:,.0f}" if r["kind"] == "standard" else " | ")
            lines.append(f"| {r['measure']} | {r['window']} | {r['standard']:.0f} | {100 * r['share_before']:.2f}% | "
                         f"{100 * r['share_after']:.2f}% | {people} | {r['hexagons_changed']:,} | {r['pairs_changed']:,} |")
        lines.append("")
    args.to.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
