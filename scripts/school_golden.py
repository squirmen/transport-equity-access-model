"""Headline figures for each school choice, from a place's published files.

Reads cells.json, destinations.json, summary.json and schools/*.json from a
place's data folder, works each choice out the way the site must
(team.schools.choice_times), and writes the figures the site's engine is
tested against. It also checks the published files agree with each other:

* for every cell, service and mode, the first school in the reach list is the
  one cells.json names (nearest_mode) and its minutes are the time shown (t);
* the schools cells.json lists as tied have the same minutes;
* no published time is over the routing limit;
* public transport lists (format 2) are never slower than walking to the
  same school, and R5's own minutes (`r5`) are given only where they are
  slower than the time shown, or missing.

For the hexagons given with --cell it also writes, under `r5`, R5's own
public transport minutes to each school named by public transport (null:
none within 60 minutes), so a test can tell a walk from a bus.

For the hexagons given with --cell it also writes every time and the schools
named (MoE numbers, ties after the first, in the reach list's order).

    PYTHONPATH=src python scripts/school_golden.py --site SITE/data/auckland \\
        --out tests/fixtures/schools/golden_auckland.json --one 69 70 --cell 89bb50021a3ffff

Exits 1 if a check fails.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from team import schools  # noqa: E402


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", required=True, type=Path, help="the place's data folder")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--one", nargs="*", type=int, default=[], help="MoE numbers to give one-school figures for")
    parser.add_argument("--cell", nargs="*", default=[], help="hexagons to give every figure for")
    args = parser.parse_args()

    cells = load(args.site / "cells.json")
    more = load(args.site / "cells_more.json") if (args.site / "cells_more.json").exists() else {}
    dests = load(args.site / "destinations.json")
    meta = load(args.site / "summary.json")["meta"]
    standard_modes = meta["standard_modes"]
    limit = int(meta.get("routing_max_minutes", 60))
    n = len(cells["h3"])
    pop = np.array([p if p is not None else 0.0 for p in cells["pop"]], dtype="float64")
    urban = np.array(cells["urban"], dtype="float64") if cells.get("urban") else np.ones(n)
    services = [s for s in meta["schools"]["services"]]
    nearest_mode = {**more.get("nearest_mode", {}), **cells.get("nearest_mode", {})}
    problems: list[str] = []
    out = {"place": meta["naming"].get("slug"), "version": meta["version"], "built": meta["built"],
           "directory": meta["schools"]["directory"]["file"], "people": round(float(pop.sum()), 1),
           "urban_people": round(float((pop * urban).sum()), 1), "standards": {}, "figures": {}, "cells": {}, "named": {},
           "r5": {}, "formats": meta.get("formats", {}), "checks": {}}

    def as_array(values):
        return np.array([np.nan if v is None else v for v in values], dtype="float64")

    for service in services:
        standard = float(meta["services"][service]["standard_minutes"])
        out["standards"][service] = standard
        reaches = {}
        for mode in schools.GOLDEN_MODES:
            path = args.site / "schools" / f"{service}_{mode}.json"
            if path.exists():
                reaches[mode] = load(path)
        # The published files must agree with each other.
        checked = 0
        for mode, reach in reaches.items():
            shown = as_array(cells["t"][service].get(mode, [None] * n))
            first_t, first_d = schools.published_times(reach, schools.published_counts(dests, service, "all", None))
            named = np.array([-1 if v is None else v for v in nearest_mode.get(service, {}).get(mode, [None] * n)])
            bad_t = int((~((np.isnan(shown) & np.isnan(first_t)) | (shown == first_t))).sum())
            bad_d = int((named != first_d).sum())
            over = int((shown > limit).sum())
            ties = cells.get("ties", {}).get(service, {}).get(mode, {})
            bad_ties = 0
            offsets = reach["o"]
            for cell, tied in ties.items():
                i = int(cell)
                listed = {reach["d"][k]: reach["m"][k] for k in range(offsets[i], offsets[i + 1])}
                bad_ties += sum(1 for d in tied if listed.get(d) != shown[i])
            checked += n
            bad_walk = bad_r5 = 0
            if reach.get("pt_or_walk") and mode == "pt" and "walk" in reaches:
                walk = reaches["walk"]
                on_foot = {}
                for i in range(n):
                    for k in range(walk["o"][i], walk["o"][i + 1]):
                        on_foot[(i, walk["d"][k])] = walk["m"][k]
                for i in range(n):
                    for k in range(offsets[i], offsets[i + 1]):
                        w = on_foot.get((i, reach["d"][k]))
                        bad_walk += int(w is not None and reach["m"][k] > w)
                bad_r5 = sum(1 for k, m in zip(reach["r5"]["k"], reach["r5"]["m"]) if m is not None and m <= reach["m"][k])
                if bad_walk or bad_r5:
                    problems.append(f"{service} {mode}: {bad_walk} entries slower than walking, {bad_r5} r5 entries not slower")
            if bad_t or bad_d or over or bad_ties:
                problems.append(f"{service} {mode}: {bad_t} times and {bad_d} names differ from the reach list, "
                                f"{over} over {limit} min, {bad_ties} ties with other minutes")
        out["checks"][service] = {"cells_by_mode": checked, "problems": [p for p in problems if p.startswith(service)]}

        choices = [("all", None), ("state", "both"), ("state", "girls"), ("state", "boys")]
        choices += [(f"one:{m}", None) for m in args.one if any(d.get("moe") == m and service in d["services"] for d in dests)]
        for choice, student in choices:
            key = choice if student is None else f"{choice}:{student}"
            # A short list (car) answers All and State only.
            usable = reaches if not choice.startswith("one:") else {m: r for m, r in reaches.items() if r.get("complete", True)}
            times = schools.choice_times(usable, dests, service, choice, student, standard_modes)
            block = {}
            for mode, minutes in times.items():
                share, total = schools.share_within(minutes, pop, standard)
                share_u, total_u = schools.share_within(minutes, pop * urban, standard)
                block[mode] = {"share": round(share, 6), "share_urban": round(share_u, 6),
                               "people_within": round(share * total, 1), "people": round(total, 1)}
            out["figures"].setdefault(key, {})[service] = block
            for h3 in args.cell:
                if h3 in cells["h3"]:
                    i = cells["h3"].index(h3)
                    out["cells"].setdefault(h3, {}).setdefault(key, {})[service] = {
                        m: (None if np.isnan(v[i]) else int(v[i])) for m, v in times.items()}
                    named = schools.choice_named(usable, dests, service, choice, student, i)
                    out["named"].setdefault(h3, {}).setdefault(key, {})[service] = named
                    if "pt" in usable and "r5" in usable["pt"]:
                        body = usable["pt"]
                        r5 = dict(zip(body["r5"]["k"], body["r5"]["m"]))
                        by_moe = {dests[body["d"][k]].get("moe"): r5.get(k, body["m"][k]) for k in range(body["o"][i], body["o"][i + 1])}
                        out["r5"].setdefault(h3, {}).setdefault(key, {})[service] = {str(m): by_moe.get(m) for m in named.get("pt", [])}
        if not reaches:
            problems.append(f"{service}: no reach lists")
    out["checks"]["ok"] = not problems
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8")
    for p in problems:
        print("PROBLEM", p)
    print(json.dumps({k: out["figures"][k].get("secondary_school", {}).get("best") for k in out["figures"]}, indent=1))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
