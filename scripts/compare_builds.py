"""Before and after: what a rebuild changed in a place's published figures.

    python scripts/compare_builds.py --old SITE_BEFORE/data/auckland --new SITE_AFTER/data/auckland \\
        [--json out.json] [--markdown out.md]

For each service and mode it gives the share of people within the service's
standard (all hexagons, and urban hexagons only) before and after, and how
many hexagons and people have a different time. Times over the 60-minute
limit, which 0.12.0 stops publishing, are counted apart. Other arrays in
cells.json and cells_more.json (job access, scores, choice counts, fares) are
listed with how many values changed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

MODES = ["walk", "bike_low_stress", "bike", "pt", "car"]


def load(folder: Path) -> tuple[dict, dict, dict]:
    cells = json.loads((folder / "cells.json").read_text(encoding="utf-8"))
    more_path = folder / "cells_more.json"
    if more_path.exists():
        cells.update(json.loads(more_path.read_text(encoding="utf-8")))
    summary = json.loads((folder / "summary.json").read_text(encoding="utf-8"))
    dests = json.loads((folder / "destinations.json").read_text(encoding="utf-8"))
    return cells, summary, dests


def arr(values) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype="float64")


def share(t: np.ndarray, weights: np.ndarray, limit: float) -> float:
    use = weights > 0
    total = weights[use].sum()
    return float(weights[use & np.isfinite(t) & (t <= limit)].sum() / total) if total > 0 else float("nan")


def best_of(t: dict, modes: list[str], n: int) -> np.ndarray:
    stack = np.vstack([arr(t[m]) if m in t else np.full(n, np.nan) for m in modes])
    filled = np.where(np.isnan(stack), np.inf, stack)
    out = filled.min(axis=0)
    return np.where(np.isinf(out), np.nan, out)


def flatten(value, prefix="") -> dict[str, list]:
    """Every list of numbers in a nested dict, keyed by its path."""
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else str(k)))
    elif isinstance(value, list) and value and not isinstance(value[0], (dict, list)):
        out[prefix] = value
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--old", required=True, type=Path)
    parser.add_argument("--new", required=True, type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--markdown", type=Path)
    args = parser.parse_args()
    old, old_summary, old_dests = load(args.old)
    new, new_summary, new_dests = load(args.new)
    if old["h3"] != new["h3"]:
        raise SystemExit("The two builds have different hexagons; compare like with like.")
    n = len(new["h3"])
    pop = arr(new["pop"])
    urban = arr(new["urban"]) if new.get("urban") else np.ones(n)
    meta = new_summary["meta"]
    standard_modes = meta["standard_modes"]
    limit = float(meta.get("routing_max_minutes", 60))
    rows = []
    for service, spec in meta["services"].items():
        standard = float(spec["standard_minutes"])
        old_t, new_t = old["t"].get(service, {}), new["t"].get(service, {})
        for mode in [*MODES, "best"]:
            if mode == "best":
                a, b = best_of(old_t, standard_modes, n), best_of(new_t, standard_modes, n)
            elif mode in old_t or mode in new_t:
                a = arr(old_t.get(mode, [None] * n))
                b = arr(new_t.get(mode, [None] * n))
            else:
                continue
            differ = ~((np.isnan(a) & np.isnan(b)) | (a == b))
            over = differ & (a > limit) & np.isnan(b)
            rows.append({
                "service": service, "mode": mode, "standard": standard,
                "share_before": round(share(a, pop, standard), 5), "share_after": round(share(b, pop, standard), 5),
                "urban_before": round(share(a, pop * urban, standard), 5), "urban_after": round(share(b, pop * urban, standard), 5),
                "cells_changed": int(differ.sum()), "people_changed": round(float(pop[differ].sum())),
                "over_limit_dropped": int(over.sum()),
                "cells_changed_otherwise": int((differ & ~over).sum()),
            })
    # Every other array, to show what else moved.
    others = {}
    skip = {"t", "h3", "nearest", "nearest_mode", "ties"}
    for key in sorted(set(old) | set(new)):
        if key in skip:
            continue
        a, b = flatten(old.get(key)), flatten(new.get(key))
        for path in sorted(set(a) | set(b)):
            if path not in a or path not in b:
                others[f"{key}.{path}" if path else key] = "added" if path not in a else "removed"
                continue
            x, y = a[path], b[path]
            if x != y:
                changed = sum(1 for p, q in zip(x, y) if p != q) + abs(len(x) - len(y))
                others[f"{key}.{path}" if path else key] = changed
    # Nearest names: compare by name and place, since destination indices move when the list changes.
    def name_of(dests, i):
        return None if i is None else (dests[i].get("name"), dests[i].get("lon"), dests[i].get("lat"))

    nearest = {}
    for service in meta["services"]:
        a = [name_of(old_dests, i) for i in old["nearest"].get(service, [])]
        b = [name_of(new_dests, i) for i in new["nearest"].get(service, [])]
        nearest[service] = sum(1 for p, q in zip(a, b) if p != q)
    report = {"old": str(args.old), "new": str(args.new), "old_version": old_summary["meta"]["version"],
              "new_version": meta["version"], "cells": n, "people": round(float(pop.sum())), "times": rows,
              "nearest_changed": nearest, "other_arrays_changed": others}
    if args.json:
        args.json.write_text(json.dumps(report, indent=1) + "\n")
    lines = ["| Service | Mode | Within standard before | After | Hexagons changed | of which over 60 dropped | People in changed hexagons |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        if r["cells_changed"] == 0:
            continue
        lines.append(f"| {r['service']} | {r['mode']} | {100 * r['share_before']:.2f}% | {100 * r['share_after']:.2f}% | "
                     f"{r['cells_changed']:,} | {r['over_limit_dropped']:,} | {r['people_changed']:,} |")
    text = "\n".join(lines)
    if args.markdown:
        args.markdown.write_text(text + "\n")
    print(text)
    print("nearest (fastest mode) changed:", nearest)
    print("other arrays changed:", json.dumps(others, indent=0)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
