"""Write the fixtures for web/js/trip_data.js from real Auckland files, with the answers worked out here.

    python tests/fixtures/make_trip_fixture.py
    python tests/fixtures/make_trip_fixture.py --site DIR --pairs-cache DIR

Two parts, both under tests/fixtures/trip/, laid out as the site's data folder:

- mate/graph/: MATE's graph tiles for Devonport and two small neighbours (gzipped), and graph_expected.json: 50 cell
  pairs routed with scipy's Dijkstra on those tiles for every variant and view. The routing rules (MATE
  docs/team_export.md, graph/) are written out again here, without MATE's code, so the test compares two
  separate readings of the format.
- pairs/, mate/stops/ and transit.json: TEAM's pairs and public transport paths, MATE's stop walks and the stops'
  names, cut down to 10
  real pairs, and pt_expected.json: their times, paths and leg swaps, worked out from TEAM's parquet cache
  (~/.cache/team/auckland/cell_pairs) rather than from the files the page reads.

Reads the built site (team-site/data/auckland) and the cache. Writes only into tests/fixtures/trip/.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
from pathlib import Path

import h3
import numpy as np
import pandas as pd

HERE = Path(__file__).parent
OUT = HERE / "trip"
ROOT = HERE.parents[2]
SITE = ROOT / "team-site" / "data" / "auckland"
CACHE = Path.home() / ".cache" / "team" / "auckland" / "cell_pairs"

# Devonport's resolution 6 cell and the two small ones beside it on the peninsula.
GRAPH_TILES = ["86bb50007ffffff", "86bb50017ffffff", "86bb5001fffffff"]
GRAPH_PAIRS = 50
NORTH_SHORE_LAT = -36.838
SEED = 13

# Ten real pairs, cells.json places, checked by hand on 13 October 2026 against the parquet cache, transit.json
# and the timetable's usual run times. Off-peak:
# - Devonport to Britomart: 1.3 min to Devonport Ferry Terminal, DEV ferry 12 min (the usual crossing), 13.7 min
#   average wait (half-hourly), 6.2 min from Downtown Ferry Terminal Pier 4. A manual wheelchair has no walk on
#   MATE's graph from Pier 4 to the Britomart cell within 15 minutes (it is cut off there in MATE's data).
# - Mt Albert to Britomart: E-W train, 20 min to Waitemata; no manual wheelchair walk to the station in 15 min.
# - Ponsonby to Britomart: 20 then CTY, with a 2.5 min walk between them.
# - Papatoetoe to Manukau: bus 36, 11 min. Henderson to New Lynn: E-W train, 12 min.
# - Newmarket to the next cell: walked all the way in 13 min, so no stops.
# - Devonport to Henderson: nothing within 45 minutes. Clevedon: rural, so no public transport timed.
# - Takapuna to Devonport: bus 814, 22 min; none on Saturday.
# - The blocked pair: 4 min walk to Rising Parade for bus 83; no manual wheelchair walk to it in 15 min.
# Every leg swap is the profile's two walks plus the wait, ride and change minutes (1 + 13.7 + 12 + 7 = 33.7 min
# walking, Devonport to Britomart).
PT_PAIRS = [
    ("Devonport to Britomart, by ferry", 1, 113),
    ("Mt Albert to Britomart, by train", 5313, 113),
    ("Ponsonby to Britomart, two buses", 981, 113),
    ("Papatoetoe to Manukau, by bus", 4117, 4111),
    ("Henderson to New Lynn, by train", 5652, 5248),
    ("Newmarket to the next cell, walked all the way", 666, 667),
    ("Devonport to Henderson, not within 45 minutes", 1, 5652),
    ("Clevedon (rural) to its neighbour, no public transport timed", 26133, None),
    ("Takapuna to Devonport", 272, 1),
    ("A pair a manual wheelchair cannot start", None, None),
]
WINDOWS = ("am_peak", "interpeak", "saturday")
PT_PROFILES = (
    "walk",
    "older_walker",
    "manual_wheelchair",
    "powered_chair_scooter",
    "pram",
    "child",
)
VIEWS_RANGE = ("nkb", "cautious")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload, gz: bool = False) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if gz:
        with gzip.GzipFile(
            path.with_suffix(path.suffix + ".gz"), "wb", compresslevel=9, mtime=0
        ) as f:
            f.write(raw)
    else:
        path.write_bytes(raw)
    return len(raw)


# ---------------------------------------------------------------- graph: a second reading of MATE's tiles


def load_tiles(folder: Path, names):
    index = read_json(folder / "index.json")
    edges, cells, stops, loaded = {}, {}, {}, []
    for name in names:
        body = read_json(folder / f"{name}.json")
        n0 = body["n0"]
        loaded.append((n0, n0 + body["nn"]))
        ids = list(range(body["e0"], body["e0"] + body["ne"])) + body["fe"]
        a = n0
        for q, e in enumerate(ids):
            a += body["a"][q]
            edges[e] = (a, a + body["b"][q], body["l"][q], body["k"][q], body["t"][q])
        for prefix, store in (("c", cells), ("s", stops)):
            at = 0
            for key, n in zip(body[prefix], body[f"{prefix}n"]):
                store[key] = [
                    (n0 + body[f"{prefix}j"][r], body[f"{prefix}d"][r], body[f"{prefix}m"][r])
                    for r in range(at, at + n)
                ]
                at += n
    return index, edges, cells, stops, loaded


def side_cost(byte: int, shift: int, view: str, costs: dict):
    code = (byte >> shift) & 3
    hard = (byte >> (shift + 2)) & 1
    if code == 3 or (view == "known" and code == 2):
        return None, code
    mult = costs["harder"] if hard else 1.0
    if view == "cautious" and code == 2:
        mult = mult * costs["unknown_cautious"]
    return mult, code


def edge_cost(index, j, view, length_units, klass, kind):
    """Seconds and the status of the side taken: (length + (mult - 1) * xlen) / speed + eps for each usable side,
    the quicker side, the better (first) side on a tie."""
    costs = index["costs"]
    var = index["variants"][j]
    byte = index["classes"][klass][j]
    length = length_units / index["per_m"]
    xlen = costs["junction_xlen_m"] if index["kinds"][kind] == "junction" else length
    speed = (var["foot_kmh"] if index["walked"][kind] else var["speed_kmh"]) / 3.6
    best, status = math.inf, -1
    for shift in (0, 3):
        mult, code = side_cost(byte, shift, view, costs)
        if mult is None:
            continue
        cost = (length + (mult - 1.0) * xlen) / speed + costs["eps_s"]
        if cost < best:
            best, status = cost, code
    return best, status


def route_all(index, edges, cells, loaded, origins, j, view):
    """scipy's Dijkstra from each origin cell, on the loaded tiles as the page sees them: a node outside them is
    reached but not left. Returns the distance matrix rows, predecessors, and the node numbers used."""
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra

    def is_loaded(node):
        return any(lo <= node < hi for lo, hi in loaded)

    n = index["nodes"]
    keys = sorted(cells)
    cell_out = {c: n + 2 * q for q, c in enumerate(keys)}
    cell_in = {c: n + 2 * q + 1 for q, c in enumerate(keys)}
    size = n + 2 * len(keys)
    bit = 1 << (3 * j + index["views"].index(view))
    walk = index["variants"][j]["foot_kmh"] / 3.6
    eps = index["costs"]["eps_s"]
    best = {}

    def add(u, v, w, e):
        if w < best.get((u, v), (math.inf, None))[0]:
            best[(u, v)] = (w, e)

    for e, (a, b, ln, k, t) in edges.items():
        w, _ = edge_cost(index, j, view, ln, k, t)
        if not math.isfinite(w):
            continue
        if is_loaded(a):
            add(a, b, w, e)
        if is_loaded(b):
            add(b, a, w, e)
    for c in keys:
        mine = [(node, d) for node, d, m in cells[c] if m & bit]
        if not mine:
            add(cell_out[c], cell_in[c], eps, None)
        for node, d in mine:
            w = d / index["per_m"] / walk + eps
            add(cell_out[c], node, w, None)
            add(node, cell_in[c], w, None)
    r = np.array([k[0] for k in best], dtype=np.int64)
    c = np.array([k[1] for k in best], dtype=np.int64)
    w = np.array([v[0] for v in best.values()])
    m = csr_matrix((w, (r, c)), shape=(size, size))
    D, P = dijkstra(
        m, directed=True, indices=[cell_out[o] for o in origins], return_predecessors=True
    )
    return D, P, cell_out, cell_in, best, is_loaded


def graph_fixture(graph_dir: Path) -> dict:
    out = OUT / "mate" / "graph"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copy(graph_dir / "index.json", out / "index.json")
    for name in GRAPH_TILES:
        write_json(out / f"{name}.json", read_json(graph_dir / f"{name}.json"), gz=True)
    index, edges, cells, stops, loaded = load_tiles(graph_dir, GRAPH_TILES)
    ids = read_json(SITE / "cells.json")["h3"]
    # Pairs: both cells on the Devonport side of the harbour (the tile reaches across it to the city), 300 m to
    # 2 km apart as the crow flies.
    here = [
        c
        for c in sorted(cells)
        if h3.cell_to_parent(ids[c], 6) == GRAPH_TILES[0]
        and h3.cell_to_latlng(ids[c])[0] > NORTH_SHORE_LAT
    ]
    rng = np.random.default_rng(SEED)
    pairs = []
    while len(pairs) < GRAPH_PAIRS:
        o, d = (int(x) for x in rng.choice(here, 2, replace=False))
        km = h3.great_circle_distance(
            h3.cell_to_latlng(ids[o]), h3.cell_to_latlng(ids[d]), unit="km"
        )
        if 0.3 <= km <= 2.0 and (o, d) not in pairs:
            pairs.append((o, d))
    origins = sorted({o for o, _ in pairs})
    results = {}
    for j, var in enumerate(index["variants"]):
        for view in index["views"]:
            D, P, cell_out, cell_in, best, is_loaded = route_all(
                index, edges, cells, loaded, origins, j, view
            )
            frontier = [x for x in {v for e in edges.values() for v in e[:2]} if not is_loaded(x)]
            for o, d in pairs:
                row = origins.index(o)
                s = float(D[row, cell_in[d]])
                res = {"seconds": s if math.isfinite(s) else None}
                # As the page: complete unless a node outside the tiles is nearer than the destination.
                reached = [D[row, x] for x in frontier if math.isfinite(D[row, x])]
                res["complete"] = not any(x < s for x in reached)
                if math.isfinite(s):
                    # Walk the predecessors back from the destination to read the route.
                    path, u = [], cell_in[d]
                    while u != cell_out[o]:
                        path.append(u)
                        u = int(P[row, u])
                    path.append(u)
                    path.reverse()
                    nodes = path[1:-1]
                    metres = [0.0, 0.0, 0.0]
                    for a, b in zip(nodes[:-1], nodes[1:]):
                        _, e = best[(a, b)]
                        _, _, ln, k, t = edges[e]
                        _, status = edge_cost(index, j, view, ln, k, t)
                        metres[status] += ln / index["per_m"]
                    res.update(
                        {
                            "minutes": int(math.floor(s / 60 + 0.5)),
                            "edges": len(nodes) - 1,
                            "first": nodes[0],
                            "last": nodes[-1],
                            "metres": [round(x, 3) for x in metres],
                        }
                    )
                results.setdefault(f"{o}-{d}", {}).setdefault(var["key"], {})[view] = res
    geo = {
        ids[c]: {
            "r6": h3.cell_to_parent(ids[c], 6),
            "r7": h3.cell_to_parent(ids[c], 7),
            "centre": [
                round(h3.cell_to_latlng(ids[c])[1], 6),
                round(h3.cell_to_latlng(ids[c])[0], 6),
            ],
        }
        for c in {x for p in pairs for x in p}
    }
    expected = {
        "what": "MATE's graph tiles routed with scipy (tests/fixtures/make_trip_fixture.py)",
        "tiles": GRAPH_TILES,
        "pairs": [list(p) for p in pairs],
        "ids": {str(c): ids[c] for c in {x for p in pairs for x in p}},
        "geo": geo,
        "results": results,
    }
    write_json(OUT / "graph_expected.json", expected)
    done = sum(
        r[v["key"]][w]["complete"]
        for r in results.values()
        for v in index["variants"]
        for w in index["views"]
    )
    print(
        f"graph: {len(pairs)} pairs, {done} of {len(results) * len(index['variants']) * len(index['views'])} "
        "routes complete on the fixture tiles"
    )
    return expected


# ---------------------------------------------------------------- public transport: pairs, paths and walks


def stop_names():
    transit = read_json(SITE / "transit.json")
    names = {f["properties"]["id"]: f for f in transit["stops"]["features"]}
    return transit, names


_STOP_FILES: dict = {}


def walk_minutes(stops_dir: Path, ids, cell: int):
    """MATE's stop walks from a cell: {(variant, view, stop_id): minutes}, or None without a stops/ file row."""
    path = stops_dir / f"{h3.cell_to_parent(ids[cell], 6)}.json"
    if not path.exists():
        return None
    if path not in _STOP_FILES:
        _STOP_FILES[path] = read_json(path)
    body = _STOP_FILES[path]
    if cell not in body["cells"]:
        return None
    k = body["cells"].index(cell)
    out = {}
    for variant, views in body["s"].items():
        for view, block in views.items():
            start = sum(block["n"][:k])
            for x in range(start, start + block["n"][k]):
                out[(variant, view, body["stop_id"][block["s"][x]])] = block["m"][x]
    return out


def pick_blocked(p_inter: pd.DataFrame, ids, stops_dir: Path) -> tuple[int, int]:
    """A real pair where walking reaches the boarding stop and a manual wheelchair does not."""
    sample = p_inter[p_inter["legs"] >= 1].sample(4000, random_state=SEED)
    pos = {c: i for i, c in enumerate(ids)}
    for row in sample.itertuples():
        o, d = pos[row.origin], pos[row.destination]
        w = walk_minutes(stops_dir, ids, o)
        if not w:
            continue
        if (
            ("walk", "nkb", row.board) in w
            and ("manual_wheelchair", "nkb", row.board) not in w
            and walk_minutes(stops_dir, ids, d)
        ):
            return o, d
    raise SystemExit("no blocked pair found")


def trim_rows(block: dict, cells: list[int], keep_cells: list[int], keys) -> dict:
    out = {"n": []}
    for k in keys:
        out[k] = []
    start = 0
    for c, n in zip(cells, block["n"]):
        if c in keep_cells:
            out["n"].append(n)
            for k in keys:
                out[k].extend(block[k][start : start + n])
        start += n
    return out


def pt_fixture() -> dict:
    out = OUT
    for old in (OUT / "pairs", OUT / "mate" / "stops"):
        if old.exists():
            shutil.rmtree(old)
    ids = read_json(SITE / "cells.json")["h3"]
    index = read_json(SITE / "pairs" / "index.json")
    pos = {c: i for i, c in enumerate(ids)}
    parquet = {w: pd.read_parquet(CACHE / f"pt_{w}.parquet") for w in WINDOWS}
    pairs = []
    for note, o, d in PT_PAIRS:
        if o is None:
            o, d = pick_blocked(parquet["interpeak"], ids, SITE / "mate" / "stops")
        if d is None:
            d = next(pos[x] for x in h3.grid_ring(ids[o], 1) if x in pos)
        pairs.append((note, o, d))

    # TEAM's tiles, cut down to the origins used.
    by_r7 = {}
    for _, o, _ in pairs:
        by_r7.setdefault(h3.cell_to_parent(ids[o], 7), set()).add(o)
    for r7, keep in by_r7.items():
        keep = sorted(keep)
        tile = read_json(SITE / "pairs" / f"{r7}.json")
        small = {k: tile[k] for k in ("format", "r7", "order")}
        small["cells"] = [c for c in tile["cells"] if c in keep]
        for mode in ("walk", "bike_low_stress", "bike"):
            if mode in tile:
                small[mode] = trim_rows(tile[mode], tile["cells"], keep, ("d", "m"))
        small["pt"] = {
            w: trim_rows(b, tile["cells"], keep, ("d", "m")) for w, b in tile.get("pt", {}).items()
        }
        write_json(out / "pairs" / f"{r7}.json", small, gz=True)
        for w in WINDOWS:
            if r7 not in index["path_tiles"][w]:
                continue
            path = read_json(SITE / "pairs" / w / f"{r7}.json")
            cols = ("d", "m", "b", "a", "r", "acc", "egr", "xfer", "wait", "ride", "use")
            rows = trim_rows(path, path["cells"], keep, cols)
            stops_used = sorted({x for k in ("b", "a") for x in rows[k] if x is not None})
            routes_used = sorted({x for x in rows["r"] if x is not None})
            sm = {k: path[k] for k in ("format", "r7", "order", "window")}
            sm["cells"] = [c for c in path["cells"] if c in keep]
            sm.update(rows)
            sm["b"] = [None if x is None else stops_used.index(x) for x in rows["b"]]
            sm["a"] = [None if x is None else stops_used.index(x) for x in rows["a"]]
            sm["r"] = [None if x is None else routes_used.index(x) for x in rows["r"]]
            sm["stops"] = [path["stops"][x] for x in stops_used]
            sm["routes"] = [path["routes"][x] for x in routes_used]
            write_json(out / "pairs" / w / f"{r7}.json", sm, gz=True)
    small_index = dict(index)
    small_index["tiles"] = sorted(by_r7)
    small_index["path_tiles"] = {
        w: [t for t in sorted(by_r7) if t in index["path_tiles"][w]] for w in WINDOWS
    }
    write_json(out / "pairs" / "index.json", small_index, gz=True)

    # MATE's stop walks, cut down to the cells used, and the stops' names.
    cells_used = sorted({x for _, o, d in pairs for x in (o, d)})
    by_r6 = {}
    for c in cells_used:
        by_r6.setdefault(h3.cell_to_parent(ids[c], 6), []).append(c)
    stops_named = set()
    for r6, keep in by_r6.items():
        path = SITE / "mate" / "stops" / f"{r6}.json"
        if not path.exists():
            continue
        body = read_json(path)
        keep = [c for c in body["cells"] if c in keep]
        if not keep:
            continue
        s = {}
        used = set()
        for variant, views in body["s"].items():
            s[variant] = {}
            for view, block in views.items():
                s[variant][view] = trim_rows(block, body["cells"], keep, ("s", "m"))
                used.update(s[variant][view]["s"])
        used = sorted(used)
        for views in s.values():
            for block in views.values():
                block["s"] = [used.index(x) for x in block["s"]]
        write_json(
            out / "mate" / "stops" / f"{r6}.json",
            {"cells": keep, "stop_id": [body["stop_id"][x] for x in used], "s": s},
            gz=True,
        )

    transit, names = stop_names()

    # The answers, from the parquet cache.
    walk = {m: pd.read_parquet(CACHE / f"{m}.parquet") for m in ("walk", "bike_low_stress", "bike")}
    routes = index["routes"]
    expected = []
    for note, o, d in pairs:
        oi, di = ids[o], ids[d]
        row = {"note": note, "o": o, "d": d, "times": {}, "pt": {}}
        for m, frame in walk.items():
            hit = frame[(frame["origin"] == oi) & (frame["destination"] == di)]
            row["times"][m] = int(hit["minutes"].iloc[0]) if len(hit) else None
        row["times"]["pt"] = {}
        for w in WINDOWS:
            frame = parquet[w]
            hit = frame[(frame["origin"] == oi) & (frame["destination"] == di)]
            row["times"]["pt"][w] = int(hit["minutes"].iloc[0]) if len(hit) else None
            if not len(hit):
                row["pt"][w] = None
                continue
            h = hit.iloc[0]
            if not h["legs"]:
                # Walked all the way, or no path recorded (docs/pairs.md): no stops.
                row["pt"][w] = {"kind": "walk" if h["iters"] and h["iters"] > 0 else "no-path"}
                continue
            board, alight = h["board"], h["alight"]
            stops_named.update([board, alight])
            ride = {
                "kind": "ride",
                "board": board,
                "alight": alight,
                "board_name": names[board]["properties"]["name"]
                if board in names
                else index["stops_not_in_overlays"].get(board, {}).get("name"),
                "alight_name": names[alight]["properties"]["name"]
                if alight in names
                else index["stops_not_in_overlays"].get(alight, {}).get("name"),
                "routes": [routes[r]["name"] for r in h["routes"].split("|")],
                "access": round(float(h["access"]), 1),
                "egress": round(float(h["egress"]), 1),
                "transfer": round(float(h["transfer"]), 1),
                "wait": round(float(h["wait"]), 1),
                "ride": round(float(h["ride"]), 1),
            }
            between = ride["wait"] + ride["ride"] + ride["transfer"]
            ride["between"] = round(between, 1)
            wo = walk_minutes(SITE / "mate" / "stops", ids, o)
            wd = walk_minutes(SITE / "mate" / "stops", ids, d)
            ride["profiles"] = {}
            for p in PT_PROFILES:
                ride["profiles"][p] = {}
                for view in VIEWS_RANGE:
                    to_stop = wo.get((p, view, board)) if wo else None
                    from_stop = wd.get((p, view, alight)) if wd else None
                    total = (
                        round(to_stop + between + from_stop, 1)
                        if to_stop is not None and from_stop is not None
                        else None
                    )
                    ride["profiles"][p][view] = {
                        "toStop": to_stop,
                        "fromStop": from_stop,
                        "total": total,
                    }
            row["pt"][w] = ride
        expected.append(row)

    keep_features = [
        f for f in transit["stops"]["features"] if f["properties"]["id"] in stops_named
    ]
    write_json(
        out / "transit.json", {"stops": {"type": "FeatureCollection", "features": keep_features}}
    )
    geo = {
        ids[c]: {"r6": h3.cell_to_parent(ids[c], 6), "r7": h3.cell_to_parent(ids[c], 7)}
        for c in cells_used
    }
    write_json(
        OUT / "pt_expected.json",
        {
            "what": "TEAM's pairs and MATE's stop walks for 10 real pairs, from the "
            "parquet cache (tests/fixtures/make_trip_fixture.py)",
            "order": index["order"],
            "ids": {str(c): ids[c] for c in cells_used},
            "geo": geo,
            "pairs": expected,
        },
    )
    for row in expected:
        print(f"{row['note']}: cells {row['o']} to {row['d']}; times {row['times']}")
        ip = row["pt"].get("interpeak")
        if ip and ip.get("kind") == "ride":
            print(
                f"   off-peak: {ip['access']} min walk to {ip['board_name']}, {' then '.join(ip['routes'])}, "
                f"wait {ip['wait']}, ride {ip['ride']}, change {ip['transfer']}, {ip['egress']} min walk from "
                f"{ip['alight_name']}"
            )
            for p, v in ip["profiles"].items():
                print(f"   {p:22s} {v['nkb']}  |  {v['cautious']}")
        else:
            print(f"   off-peak: {ip}")
    return expected


def order_digest(ids) -> str:
    return hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()[:16]


def main() -> None:
    global SITE, CACHE
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--site", type=Path, default=SITE, help="Auckland's data folder in the built site"
    )
    ap.add_argument(
        "--graph", type=Path, help="MATE's graph tiles (default: the site's mate/graph)"
    )
    ap.add_argument("--pairs-cache", type=Path, default=CACHE)
    args = ap.parse_args()
    SITE, CACHE = args.site, args.pairs_cache
    ids = read_json(SITE / "cells.json")["h3"]
    if order_digest(ids) != read_json(SITE / "pairs" / "index.json")["order"]:
        raise SystemExit("the pairs were routed for another cell order")
    # A small order check for cellOrder() in the page: the first five ids.
    write_json(OUT / "order.json", {"ids": ids[:5], "order": order_digest(ids[:5])})
    graph_fixture(args.graph or SITE / "mate" / "graph")
    pt_fixture()


if __name__ == "__main__":
    main()
