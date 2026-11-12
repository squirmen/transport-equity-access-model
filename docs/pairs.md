# Cell to cell pairs and public transport paths

TEAM's routing runs keep one summary per cell. `team pairs` keeps the pairs:
which cells each cell reaches, in how many minutes, and for public transport
the stops and routes of the trip. MATE uses them to judge the walk to and from
the stops for each mobility profile, and for trips between two cells. Only
places with a `pairs:` block in their configuration have them; so far that is
Auckland.

This page is the contract between the build and the web app. Code:
[`src/team/pairs.py`](../src/team/pairs.py). How to run it:
[`running.md`](running.md#cell-to-cell-pairs).

## What is routed

| Run | From | To | Kept when | Clock |
| --- | --- | --- | --- | --- |
| `walk` | every TEAM cell | every TEAM cell | 20 minutes or less | none |
| `bike_low_stress` | every TEAM cell | every TEAM cell | 20 minutes or less | none |
| `bike` | every TEAM cell | every TEAM cell | 20 minutes or less | none |
| `pt_am_peak`, `pt_interpeak`, `pt_saturday` | urban cells | every TEAM cell | 45 minutes or less | the window's two hours |

- **Cells.** TEAM's cells are the 29,801 populated hexagons in `cells.json`,
  in that order. Urban cells are the 6,792 with TEAM's `urban` flag (a Stats
  NZ urban area of 1,000 people or more). Each cell is placed on the nearest
  street, as in TEAM's other runs; 260 cells are too far from a street and
  have no pairs.
- **Modes.** The same as TEAM's other runs: walking at 4.8 km/h, cycling at
  15 km/h on SPAN's traffic stress (2 or less for low-stress, 3 or less for
  any bikeable street), all slowed by hills. Public transport walks at
  4.8 km/h, at most 15 minutes to and from stops.
- **Times.** Whole minutes. Public transport is the median over the
  departure minutes in the window, so a pair is kept when more than half of
  them arrive within 45 minutes. A cell reaches itself in 0 minutes, and so
  can a neighbour placed on the same street.
- **The same timetable.** Everything is routed on Auckland Transport's feed
  of 1 September 2026 (`at_gtfs_2026-09-01.zip`) for Tuesday 15 September
  2026, and Saturday 19 September for `saturday`.

## The path behind a public transport time

For each departure minute in the window (120 of them), R5 records which routes
and stops the quickest trip used. Half the pairs see three or more different
paths over two hours. The one used in the most departure minutes is kept, and `use`
says in what share of them. Ties go to the quicker path.

The minutes given for the path are its typical trip: the departure minute
whose total wait is nearest the average wait on that path. They add up to that
trip's total, which is not the pair's median `m`. Off-peak, half the totals
are within 2.7 minutes below to 0.8 minutes above `m`, and a few are up to 20
minutes off.

- **Access** is the walk from the origin cell to the first stop, and
  **egress** the walk from the last stop to the destination cell, on R5's
  street network (every way, not MATE's footpath graph).
- **Transfer** is the walk between stops when changing, in total.
- **Wait** is all waiting, at the first stop and at changes. **Ride** is all
  time on board.
- **Walking all the way** was quicker in most departure minutes for some
  pairs, usually neighbours. These have no stops and no routes; `m` is the
  walk. R5 does not hold such a walk to 15 minutes, only to the 45-minute
  limit, and 9% of them take longer than 15 minutes.
- **No path recorded.** From 912 urban cells (26,144 residents, 1.7% of
  urban residents) R5 recorded no path in any window, only times on foot,
  and TEAM's own public transport times are blank for them too. Most have no
  stop with departures within 800 m. The 207 that do (12,056 residents) need
  a closer look: they may be placed on a piece of street cut off from the
  rest. Their rows have only `m` (`use` is null).

**Not public transport or walking.** From 0.12.0 TEAM's public transport
times are the quicker of R5's trip and walking all the way
([`methodology.md`](methodology.md), section 3). The pairs here are R5's own
paths, with their stops and routes, and are not changed: a pair's public
transport time can still be longer than its walk.

R5 does not say whether a stop or vehicle can be used by a given person.
Auckland Transport publishes no stop access data, so the site says "no
information" for it.

## Stops and routes

- **Stop ids** are the GTFS `stop_id` of the feed TEAM routes on, the same
  ids R5 reports, such as `1002-c8bb8209`. Auckland Transport changes the part
  after the dash between feeds, so a stop id is only good with this feed.
  MATE's stop walks are keyed on the same ids.
- **Stop names** are in the `stops` layer of `transit.json` (below). A path
  can leave at a stop with no departures in any window, which that layer
  leaves out; those are in `stops_not_in_overlays` in `pairs/index.json`.
- **Routes** are GTFS `route_id`s, such as `70-205`. A path with a change
  lists them in order, joined with `|`. `pairs/index.json` gives each route's
  short name and GTFS route type, and `transit.json` lists the rail,
  busway, ferry and frequent bus lines with their routes.

## Files for the web app

All under `data/auckland/pairs/` in the site, each with `.gz` and `.br`
copies, like `chains/`. Times for every mode and window are in one tile per
area; the public transport paths are in a tile per window, since most clicks
need one window.

| File | What | Count | Brotli size |
| --- | --- | --- | --- |
| `index.json` | What exists, routes, cell order | 1 | 3 KB |
| `<r7>.json` | Times, every mode and window | 856 | median 5 KB, largest 109 KB |
| `<window>/<r7>.json` | Paths, one window | 265 a window | median 16 KB, largest 229 KB |

In all, 367 MB on disk: 291 MB of JSON, 42 MB gzip and 41 MB brotli.

### `index.json`

```json
{
  "format": 1,
  "built": "2026-10-12",
  "order": "afd8f0cc04dfc99a",
  "cells": 29801,
  "resolution": 7,
  "minutes": {"walk": 20, "bike_low_stress": 20, "bike": 20, "pt": 45},
  "pt_origins": "urban",
  "routing_date": "2026-09-15",
  "windows": {"am_peak": {"start": "07:00", "minutes": 120, "label": "Peak", "when": "weekdays 7 to 9am", "phrase": "..."}, "...": {}},
  "runs": {"walk": {"rows": 822443, "origins_count": 29801, "departure": "...", "window_minutes": 10, "versions": {}, "written": "..."}, "...": {}},
  "tiles": ["87bb50000ffffff", "..."],
  "path_tiles": {"am_peak": ["87bb50000ffffff", "..."], "interpeak": ["..."], "saturday": ["..."]},
  "routes": {"70-205": {"name": "70", "type": 3}, "...": {}},
  "stops_not_in_overlays": {"9002-ffdd37b7": {"name": "Waitemata Train Station 2", "lon": 174.76897, "lat": -36.84451}}
}
```

- `order` is a fingerprint of the list of cell ids in `cells.json`. Cell
  numbers in the tiles are places in that list, so the app should check that
  `order` matches the cells it loaded (the first 16 hex digits of the SHA-256
  of the ids joined by newlines) and treat the pairs as missing if not.
- `tiles` and `path_tiles` list every tile that exists. A cell whose tile is
  not listed has no pairs.
- `routes` gives each route's short name and GTFS route type (2 rail, 3 bus,
  4 ferry).

### `<r7>.json`: times, one per resolution 7 parent of the origin cell

The tile for a cell is `h3.cellToParent(cell, 7)`.

```json
{
  "format": 1,
  "r7": "87bb50000ffffff",
  "order": "afd8f0cc04dfc99a",
  "cells": [1203, 1204, 1207],
  "walk":            {"n": [...], "d": [...], "m": [...]},
  "bike_low_stress": {"n": [...], "d": [...], "m": [...]},
  "bike":            {"n": [...], "d": [...], "m": [...]},
  "pt": {"am_peak": {"n": [...], "d": [...], "m": [...]}, "interpeak": {...}, "saturday": {...}}
}
```

- `cells`: the origin cells in this tile, as places in `cells.json`, in
  ascending order.
- In each block, `n[k]` is how many rows belong to `cells[k]`. Rows run in
  the order of `cells`, and within a cell by destination. The other keys are
  parallel arrays, one entry per row.
- `d`: the destination, as a place in `cells.json`. `m`: minutes.
- A block is missing when no origin in the tile has pairs for it. Under `pt`,
  rural cells have `n` 0.

### `<window>/<r7>.json`: public transport paths for one window

The same rows as `pt.<window>` in the times tile, with the path:

```json
{
  "format": 1, "r7": "87bb50000ffffff", "order": "afd8f0cc04dfc99a", "window": "interpeak",
  "cells": [1203, 1204, 1207],
  "n": [...], "d": [...], "m": [...],
  "b": [...], "a": [...], "r": [...], "acc": [...], "egr": [...], "xfer": [...], "wait": [...], "ride": [...], "use": [...],
  "stops": ["1002-c8bb8209", "..."],
  "routes": ["70-205", "711-221|70-205", "..."]
}
```

| Key | Meaning |
| --- | --- |
| `b` | First boarding stop, as a place in the file's `stops`; null when walking all the way |
| `a` | Last alighting stop, as a place in `stops`; null when walking all the way |
| `r` | The routes in order, as a place in the file's `routes` (route ids joined with `\|`); null when walking all the way |
| `acc` | Walk to the first stop, minutes to one decimal |
| `egr` | Walk from the last stop |
| `xfer` | Walking between stops when changing |
| `wait` | All waiting |
| `ride` | All time on board |
| `use` | Percent of the window's departure minutes that took this path; null when no path was recorded |

The number of rides is the number of routes in `routes[r]`. The kept trip's
total is `acc + wait + ride + xfer + egr`.

Reading one cell's off-peak trips:

```js
const tile = await fetchJson(`pairs/interpeak/${h3.cellToParent(cell, 7)}.json`);
const k = tile.cells.indexOf(cellIndex);           // cellIndex: place in cells.json
const start = tile.n.slice(0, k).reduce((s, x) => s + x, 0);
for (let i = start; i < start + (tile.n[k] || 0); i++) {
  const to = tile.d[i];                            // place in cells.json
  const minutes = tile.m[i];
  const board = tile.b[i] === null ? null : tile.stops[tile.b[i]];
  const routes = tile.r[i] === null ? [] : tile.routes[tile.r[i]].split('|');
}
```

### Sizes

| Run | Pairs | From | Median pairs a cell | Parquet |
| --- | --- | --- | --- | --- |
| `walk` | 822,443 | 29,541 cells | 27 | 1.9 MB |
| `bike_low_stress` | 1,347,671 | 29,541 | 40 | 2.3 MB |
| `bike` | 2,656,055 | 29,541 | 80 | 3.7 MB |
| `pt_am_peak` | 1,729,778 | 6,792 | 222 | 29.1 MB |
| `pt_interpeak` | 1,700,352 | 6,792 | 207 | 27.9 MB |
| `pt_saturday` | 1,577,865 | 6,792 | 191 | 25.6 MB |

Off-peak, 1,055,492 pairs take one ride, 538,448 change at least once, and
99,620 are walked all the way, besides each cell to itself. Of those, 11,729
are from the urban cells with no path recorded (above).

## Files for MATE and other analysis

In the cache, `~/.cache/team/auckland/cell_pairs/`:

- `walk.parquet`, `bike_low_stress.parquet`, `bike.parquet`: `origin`,
  `destination` (H3 ids), `minutes` (uint8).
- `pt_am_peak.parquet`, `pt_interpeak.parquet`, `pt_saturday.parquet`: the
  same, and for the kept path `legs`, `routes`, `board`, `alight`, `boards`
  and `alights` (every boarding and alighting stop, joined with `|`), `rides`
  and `waits` (per ride, joined with `|`), `access`, `egress`, `transfer`,
  `wait`, `ride`, `total` (minutes, float32), `iters` (departure minutes on
  the kept path), `reached` (departure minutes arriving within 45 minutes on
  any path) and `paths` (distinct paths seen).
- `<run>.json`: what the run routed (network, timetable, departure, limits,
  the cell order fingerprint, versions) and when.
- `check_pt_interpeak.json`: a sample of paths compared with r5py's
  `DetailedItineraries` and the timetable (`team pairs check`, below).
- `<run>/`: the batches behind each run, kept so a stopped run resumes.

## Stops, stations and lines by name

`transit.json` sits beside `overlays.json` and is written with it (`team
build`, or `team overlays`). Every visitor loads `overlays.json` when the map
opens, so it keeps only what the map draws: the line shapes, and the stops
with `kind` and `per_hour`. The names are in `transit.json`, which nothing
loads until a part of the site uses it. It carries:

- **`stops`**: every stop with departures in a window, in the same order and
  places as the map's. Properties: `kind`
  (`rail_ferry`, `frequent` or `other`), `per_hour` (departures an hour at its
  busiest window), `id` (GTFS `stop_id`), `name`, `code` (the number on the
  stop) and `station` (its parent station's `stop_id`, when it has one).
- **`stations`**: the parent stations of those stops, with `id`, `name` and
  `kind` (`rail_ferry` or `bus`).
- **`lines`**: a list of the lines a person can pick, rail first, then
  busway, ferry and frequent bus. Each has `id` and `name` (the route short
  name, such as `E-W` or `NX1`; Auckland Transport's feed has no longer
  names), `kind` (`rail`, `busway`, `ferry` or `frequent_bus`), `routes`
  (route ids), `from` and `to` (the ends of its most common stopping pattern,
  by station name where there is one), `per_hour` (trips an hour, both ways,
  starting in the morning peak), `stops` (stop ids with departures in a
  window, the most common pattern first in order, then stops only other
  patterns use) and, for busways, `corridor` (such as "Northern Busway").
  Busway routes are listed by hand under `busways` in the configuration.
- **`drawn`**: the line shapes of those lines, as the map draws them, each
  with `lines` (the ids of the lines drawn with it) and `layer` (the
  overlay it is drawn in: `rail`, `ferry`, `frequent_bus` or `bus`).

## Checks

`team pairs check` takes 10 off-peak pairs that use public transport (a third
of them with a change) and compares each kept path with r5py's
`DetailedItineraries` over the same window and with the timetable. On 12
October 2026:

- Every one of the 13 rides took the time the timetable gives between the
  two stops, to 0.2 minutes, or within the range of the trips in the window.
- Each walk to the first stop, at 4.8 km/h, covered 1.1 to 1.6 times the
  straight line to it.
- `DetailedItineraries` used the same routes in 9 of the 10 pairs, and the
  same stops as well in 5. Otherwise it mostly boards or leaves the same
  route a stop or two along. Its point to point search weighs walking
  differently from the regional search behind TEAM's times, which is why the
  paths come from the regional search.
- The times on a path add up to its total, to rounding, and every walk to or
  from a stop is 15 minutes or less.

## Keeping things in step

The tiles name cells by their place in `cells.json`, and stops by the ids of
one timetable. Routing again is needed when TEAM's cells, the street network
or the timetable change, and `team pairs route` starts a run afresh when it
sees any of these differ from its batches. `team pairs write` refuses to tile
pairs routed to another cell list, or to write beside a `cells.json` that
lists other cells.

## Versions

The path results come from a part of R5 that r5py does not expose, read
through jpype. They are pinned: r5py 1.1.3 (the `pairs` extra), which loads
R5 v7.5-r5py (`r5-v7.5-r5py-all.jar`, SHA-256
`70c89e57f9f98dd96c9d2be5fdc00d53a133893b2620e0d8d05e3e602f34e4d5`).
`team pairs` stops on any other. The times alone come from r5py's public
`TravelTimeMatrix`, as in TEAM's other runs.
