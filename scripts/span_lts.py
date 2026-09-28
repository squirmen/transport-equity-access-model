"""Auckland's bicycle traffic stress from SPAN, written into the OSM that R5 reads.

R5 rates every street's traffic stress for cycling from its OSM tags, with a
rule written for US streets. It also accepts an explicit `lts` tag (1 to 4) on
a way and uses that instead. SPAN, the lab's cycling investment model, rates
Auckland's network with an auditable local rule that uses facility type, road
class, speed, lanes, traffic volume and intersection stress, and an Auckland
Transport facility overlay. This carries SPAN's ratings into TEAM.

SPAN rates each directed segment; R5 takes one tag per way. A way gets the
stress that covers most of its length, and a tie goes to the higher stress, so
a way is never rated calmer than most of it is.

    python scripts/span_lts.py --data-root <root> \\
        --topology <SPAN run>/artifacts/build-topology/topology/topology.json

The topology file is about a gigabyte of JSON, so it is read line by line
rather than loaded.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import logging
import re
from pathlib import Path

log = logging.getLogger("span_lts")

SOURCE = "processed/auckland/osm/auckland_bbox.osm.pbf"
TARGET = "processed/auckland/osm/auckland_bbox_span_lts.osm.pbf"
TABLE = "processed/auckland/osm/span_lts_by_way.csv"

NUMBER = re.compile(r'^\s*"(lts|length_m)": (null|-?[0-9.eE+-]+),?\s*$')
WAY = re.compile(r'^\s*"source_way_id": "?([0-9]+)"?,?\s*$')
END = re.compile(r'^\s*"v": ')


def way_stress(topology: Path) -> dict[int, dict]:
    """Stress by OSM way: the rating covering most of its length."""
    lengths: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    in_edges = False
    current: dict = {}
    edges = 0
    with topology.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not in_edges:
                if line.startswith('  "edges": '):
                    in_edges = True
                continue
            if line.startswith('  "') and not line.startswith('  "edges"'):
                break  # the next top-level key: the edges are done
            match = NUMBER.match(line)
            if match:
                key, value = match.groups()
                current[key] = None if value == "null" else float(value)
                continue
            match = WAY.match(line)
            if match:
                current["way"] = int(match.group(1))
                continue
            if END.match(line):
                if current.get("way") is not None and current.get("lts") is not None:
                    lengths[current["way"]][int(current["lts"])] += current.get("length_m") or 0.0
                    edges += 1
                current = {}
    log.info("read %d rated segments on %d ways", edges, len(lengths))
    out = {}
    for way, by_lts in lengths.items():
        total = sum(by_lts.values())
        lts = max(by_lts, key=lambda k: (by_lts[k], k))
        out[way] = {"lts": lts, "share": by_lts[lts] / total if total else 1.0, "length_m": total}
    return out


def tag_osm(source: Path, target: Path, stress: dict[int, dict]) -> dict:
    import osmium

    counts = collections.Counter()

    class Tagger(osmium.SimpleHandler):
        def __init__(self, writer):
            super().__init__()
            self.writer = writer

        def node(self, n):
            self.writer.add_node(n)

        def way(self, w):
            rated = stress.get(w.id)
            if "highway" in w.tags:
                counts["highway_ways"] += 1
            if rated is None:
                self.writer.add_way(w)
                return
            tags = {t.k: t.v for t in w.tags if t.k != "lts"}
            tags["lts"] = str(rated["lts"])
            counts["tagged"] += 1
            counts[f"lts_{rated['lts']}"] += 1
            self.writer.add_way(w.replace(tags=tags))

        def relation(self, r):
            self.writer.add_relation(r)

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    writer = osmium.SimpleWriter(str(target))
    try:
        Tagger(writer).apply_file(str(source))
    finally:
        writer.close()
    return dict(counts)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--topology", required=True, type=Path, help="SPAN build-topology topology.json")
    args = parser.parse_args()
    root = args.data_root.expanduser().resolve()

    stress = way_stress(args.topology)
    table = root / TABLE
    table.parent.mkdir(parents=True, exist_ok=True)
    with table.open("w", encoding="utf-8") as handle:
        handle.write("way_id,lts,share_of_length,length_m\n")
        for way, row in sorted(stress.items()):
            handle.write(f"{way},{row['lts']},{row['share']:.3f},{row['length_m']:.1f}\n")

    counts = tag_osm(root / SOURCE, root / TARGET, stress)
    mixed = sum(1 for row in stress.values() if row["share"] < 0.999)
    meta = {
        "dataset_id": "auckland_bbox_span_lts",
        "written_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_osm": SOURCE,
        "span_topology": str(args.topology),
        "method": "Each OSM way is tagged lts=N with the SPAN stress covering most of its length; ties go to the higher stress. "
                  "R5 uses an explicit lts tag in place of its own rating.",
        "ways_rated_by_span": len(stress),
        "ways_with_mixed_stress": mixed,
        "counts": counts,
        "caveat": "SPAN's OSM extract and TEAM's may differ in date; ways only in TEAM's keep R5's own rating.",
    }
    (root / TARGET).with_suffix(".pbf.metadata.json").write_text(json.dumps(meta, indent=2))
    log.info("tagged %s of %s highway ways; wrote %s", counts.get("tagged"), counts.get("highway_ways"), TARGET)
    log.info("by stress: %s", {k: v for k, v in sorted(counts.items()) if k.startswith("lts_")})


if __name__ == "__main__":
    main()
