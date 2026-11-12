"""Enrolment zones: which state schools must take a child living in each hexagon.

Read from the Ministry of Education's enrolment scheme master file (MapInfo
TAB, CC BY 3.0 NZ). docs/schools.md ("Enrolment zones (In zone)") sets out the
rules; in short:

Z1  A polygon is in force on the reference date when its effective date (or,
    with none, its approval date) is on or before it, or when it has no date
    at all (flagged). A later polygon is upcoming. The directory says whether a
    school has a scheme; the file holds the map:

        scheme  polygons          status          In zone counts the school for
        yes     some in force     in_force        residents inside its zone
        yes     only upcoming     upcoming_used   residents inside the upcoming zone
        yes     none              no_map          everyone
        no      none (or later)   none            everyone (it must take any student)
        no      some in force     not_applied     everyone; the polygon is listed

Z2  A polygon's years come from its name ("Zone B (yrs 7-8)", "Y11-13"). It
    applies to a service when it covers the school's entry year for that
    service: the later of the service's first year (primary 1, intermediate 7,
    secondary 9) and the first year the school teaches. A polygon with no years
    applies to every service, unless the school also has polygons with years,
    in which case configs/schools/zone_years.csv must say (else unclear_years,
    counted for everyone and listed).
Z3  Several polygons for one service are joined (Whenuapai's extension).
Z4  In zone counts state schools taught in English that teach the service's
    years and take the student, and are counted for everyone under Z1 or whose
    zone holds the home.

Where a zone line crosses a hexagon, residents are placed by LINZ address
points, each carrying its census block's residents divided by the block's
points. The hexagon takes the set of zones most of its residents live in
(its "majority set"); each zone's share of its residents is kept for One
school.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import logging
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

log = logging.getLogger("team.zones")

REFERENCE_DATE = dt.date(2026, 11, 12)  # the directory snapshot's date
FORMAT = 2
OUTLINE_FORMAT = 1
OUTLINE_SIMPLIFY_M = 5
SAMPLE_SPACING_M = 10.0

REPO_CONFIGS = Path(__file__).resolve().parents[2] / "configs" / "schools"

FIRST_YEAR = {"primary": 1, "intermediate": 7, "secondary": 9}
YEARS_RE = re.compile(r"(?i)(?:\b(?:years?|yrs?)\s*|\by\s*)(\d{1,2})\s*(?:-|–|&|to|and)\s*(\d{1,2})\b")

ZONED = ("in_force", "upcoming_used")
EVERYONE = ("no_map", "none", "not_applied", "unclear_years")
STATUSES = ZONED + EVERYONE

SOURCE_URL = "https://www.educationcounts.govt.nz/__data/assets/file/0003/108606/Enrolmentschememaster.zip"
LICENCE = "CC BY 3.0 NZ"

RULE = ("In zone counts state schools taught in English that teach the service's years and take the student, "
        "and either have no enrolment scheme in the directory (or a scheme with no usable map) or have a zone "
        "holding the home. A zone is in force when its effective date, or its approval date, is on or before "
        "{date}; a school whose only zone starts later is given that zone. A year-level zone applies from the "
        "school's entry year for the service. Where a zone line crosses a hexagon, residents are placed by LINZ "
        "address points (each point carries its census block's residents shared equally), and the hexagon takes "
        "the zones most of its residents live in.")


# ---------------------------------------------------------------------------
# The file


def _tab_in_zip(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".tab")]
    if len(names) != 1:
        raise SystemExit(f"{path}: expected one .TAB inside, found {names}")
    return f"/vsizip/{path}/{names[0]}"


def to_nztm(frame, path: Path | str = "zone file"):
    """The frame in NZTM2000 (EPSG:2193), by the rule in docs/schools.md.

    The Ministry's TAB names its projection "unnamed" Transverse Mercator on
    NZGD2000 with the NZTM parameters: pyproj's `equals` says it is not EPSG:2193
    (names and axis metadata differ) but `to_epsg` finds 2193. A file on the
    old New Zealand Map Grid (NZGD1949) is transformed. Anything else, and a file
    with no projection, is refused.
    """
    crs = frame.crs
    if crs is None:
        raise SystemExit(f"{path} has no projection; check the .TAB before using it.")
    epsg = crs.to_epsg(min_confidence=20)
    if epsg == 2193:
        return frame.set_crs(2193, allow_override=True)
    proj4 = crs.to_proj4() or ""
    if epsg == 27200 or "+proj=nzmg" in proj4:
        return frame.to_crs(2193)
    raise SystemExit(f"{path}: projection is neither NZTM2000 nor NZMG ({crs.name}); refusing to guess.")


def parse_years(name: str) -> tuple[int, int] | None:
    """Year levels a polygon is for, from its name; None when it gives none."""
    found = YEARS_RE.search(str(name or ""))
    return (int(found.group(1)), int(found.group(2))) if found else None


def _polygonal(geometry):
    """A valid (multi)polygon from a stored geometry: make_valid, keep the polygonal parts."""
    import shapely
    from shapely.geometry import MultiPolygon, Polygon

    if geometry is None or geometry.is_empty:
        return None
    fixed = shapely.make_valid(geometry) if not geometry.is_valid else geometry
    parts = [p for p in shapely.get_parts(fixed) if isinstance(p, (Polygon, MultiPolygon))]
    flat = []
    for part in parts:
        flat.extend(part.geoms if isinstance(part, MultiPolygon) else [part])
    flat = [p for p in flat if p.area > 0]
    if not flat:
        return None
    return flat[0] if len(flat) == 1 else MultiPolygon(flat)


def _date(value):
    if value is None:
        return None
    stamp = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(stamp) else stamp.date()


def read(path: Path | str):
    """The Ministry's zones: moe, polygon_id, name, approved, effective, date,
    date_source, years_from, years_to, geometry (EPSG:2193).

    `path` is the zip as downloaded, its extracted .TAB, or any file GDAL reads
    with the same fields. `date` is the effective date, else the approval
    date (date_source says which), else missing.
    """
    import geopandas as gpd

    path = Path(path)
    source = _tab_in_zip(path) if path.suffix.lower() == ".zip" else str(path)
    raw = gpd.read_file(source)
    raw = to_nztm(raw, path)
    lower = {c.lower(): c for c in raw.columns}

    def column(*names):
        return next((lower[n.lower()] for n in names if n.lower() in lower), None)

    sid, pid, name = column("SchoolID", "School_ID"), column("PolyID", "Poly_ID"), column("PolyName", "School_name")
    approved, effective = column("ApprovalDate", "Approval_date"), column("EffectiveDate", "Effective_date")
    if not sid or not pid:
        raise SystemExit(f"{path}: no SchoolID or PolyID field in {list(raw.columns)}")
    out = gpd.GeoDataFrame({
        "moe": pd.to_numeric(raw[sid], errors="coerce").astype("int64"),
        "polygon_id": pd.to_numeric(raw[pid], errors="coerce").astype("int64"),
        "name": raw[name].astype(str).str.strip() if name else "",
        "approved": [_date(v) for v in raw[approved]] if approved else None,
        "effective": [_date(v) for v in raw[effective]] if effective else None,
    }, geometry=[_polygonal(g) for g in raw.geometry], crs="EPSG:2193")
    out["date"] = [e if e is not None else a for e, a in zip(out["effective"], out["approved"])]
    out["date_source"] = ["effective" if e is not None else ("approval" if a is not None else None)
                          for e, a in zip(out["effective"], out["approved"])]
    years = out["name"].apply(parse_years)
    out["years_from"] = pd.array([y[0] if y else None for y in years], dtype="Int64")
    out["years_to"] = pd.array([y[1] if y else None for y in years], dtype="Int64")
    return out[out.geometry.notna()].reset_index(drop=True)


def file_record(settings: Settings) -> dict:
    """What the zone file is, from its metadata file and the archive."""
    path = settings.data("zones")
    meta_path = Path(str(path) + ".metadata.json")
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    name = Path(_tab_in_zip(path)).stem if path.suffix.lower() == ".zip" else path.stem
    found = re.search(r"v(\d{2})(\d{2})(\d{4})", name)
    version = f"{found.group(3)}-{found.group(2)}-{found.group(1)}" if found else None
    return {
        "file": name,
        "version": version,
        "downloaded": str(meta.get("downloaded_at_utc") or "")[:10] or None,
        "sha256": meta.get("sha256") or hashlib.sha256(path.read_bytes()).hexdigest(),
        "licence": LICENCE,
        "url": meta.get("source_url") or SOURCE_URL,
    }


def available(settings: Settings) -> bool:
    data = settings.raw.get("data", {})
    return "zones" in data and settings.data("zones").exists()


# ---------------------------------------------------------------------------
# Z1, Z2: status and the polygons each service uses


def checked_years(folder: Path = REPO_CONFIGS) -> dict[int, tuple[int, int]]:
    """Checked year levels for polygons whose names do not give them."""
    path = folder / "zone_years.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(line for line in handle if not line.lstrip().startswith("#")))
    out = {}
    for row in rows:
        if str(row.get("checked_by", "")).strip() and str(row.get("checked_on", "")).strip():
            out[int(row["polygon_id"])] = (int(row["years_from"]), int(row["years_to"]))
    return out


def service_first_years(settings: Settings) -> dict[str, int]:
    from .schools import school_level, school_service_ids

    return {s: FIRST_YEAR.get(school_level(s, settings.services[s]) or "", 1) for s in school_service_ids(settings)}


def entry_year(first_year: int, school_from) -> int:
    """The first year a student of this service joins the school."""
    return max(int(first_year), int(school_from)) if school_from is not None and pd.notna(school_from) else int(first_year)


def _covers(years: tuple | None, year: int) -> bool:
    return years is None or years[0] <= year <= years[1]


def statuses(listed: pd.DataFrame, zones, first_years: dict[str, int], reference: dt.date = REFERENCE_DATE,
             years: dict[int, tuple[int, int]] | None = None) -> pd.DataFrame:
    """Z1 and Z2 for every school in `listed` (school_table rows).

    Columns: school, moe, status, from (the date of the zone used), next_from
    (the start of a later zone not applied), map_from (the date of a polygon
    listed but not applied), date_unknown, and polygons: {service: [PolyID]}
    for the zone each service uses (empty for schools counted for everyone).
    """
    years = checked_years() if years is None else years
    rows = []
    by_moe = {int(m): g for m, g in zones.groupby("moe")} if len(zones) else {}
    for record in listed.to_dict("records"):
        moe = int(record["moe"])
        polys = by_moe.get(moe)
        services = [s for s in str(record.get("services") or "").split(",") if s]
        scheme = bool(record.get("scheme"))
        row = {"school": record["school"], "moe": moe, "status": None, "from": None, "next_from": None,
               "map_from": None, "date_unknown": False, "polygons": {}}
        if polys is None or polys.empty:
            row["status"] = "no_map" if scheme else "none"
            rows.append(row)
            continue
        dates = polys["date"]
        in_force = polys[[d is None or d <= reference for d in dates]]
        upcoming = polys[[d is not None and d > reference for d in dates]]
        next_from = min(upcoming["date"]) if len(upcoming) else None
        if not scheme:
            if len(in_force):
                row["status"] = "not_applied"
                known = [d for d in in_force["date"] if d is not None]
                row["map_from"] = max(known).isoformat() if known else None
            else:
                row["status"] = "none"
                row["next_from"] = next_from.isoformat() if next_from else None
            rows.append(row)
            continue
        if len(in_force):
            used = in_force
            row["status"] = "in_force"
            known = [d for d in used["date"] if d is not None]
            row["from"] = max(known).isoformat() if known else None
            row["date_unknown"] = any(d is None for d in used["date"])
            row["next_from"] = next_from.isoformat() if next_from else None
        else:
            # Decision 2: the Ministry's file holds only a later zone; it is used.
            used = upcoming[upcoming["date"] == next_from]
            row["status"] = "upcoming_used"
            row["from"] = next_from.isoformat()
        # Z2: which polygon applies to each service.
        spans = {}
        for poly in used.to_dict("records"):
            pid = int(poly["polygon_id"])
            parsed = (int(poly["years_from"]), int(poly["years_to"])) if pd.notna(poly["years_from"]) else None
            spans[pid] = years.get(pid, parsed)
        with_years = [p for p, s in spans.items() if s is not None]
        without = [p for p, s in spans.items() if s is None]
        if with_years and without:
            row["status"] = "unclear_years"
            row["unclear"] = sorted(without)
            rows.append(row)
            continue
        for service in services:
            year = entry_year(first_years.get(service, 1), record.get("years_from"))
            row["polygons"][service] = sorted(p for p, s in spans.items() if _covers(s, year))
        missing = [s for s in services if not row["polygons"].get(s)]
        if missing:
            # A year-level map with no zone for the year this service starts at:
            # the file does not say who the school must take, so it counts for everyone.
            row["status"] = "unclear_years"
            row["unclear"] = sorted(spans)
            row["polygons"] = {}
        rows.append(row)
    return pd.DataFrame(rows)


def zone_geometries(zones, status: pd.DataFrame, service: str) -> dict[str, object]:
    """Z3: each zoned school's zone for a service, its polygons joined."""
    import shapely

    by_id = zones.set_index("polygon_id").geometry
    out = {}
    for record in status.to_dict("records"):
        if record["status"] not in ZONED:
            continue
        ids = record["polygons"].get(service) or []
        geoms = [by_id.loc[i] for i in ids if i in by_id.index]
        if geoms:
            out[record["school"]] = geoms[0] if len(geoms) == 1 else shapely.union_all(geoms)
    return out


# ---------------------------------------------------------------------------
# Where residents live inside a hexagon


def hexagons(cells) -> "object":
    """Hexagon polygons in NZTM, in cell order."""
    import geopandas as gpd
    import h3
    from shapely.geometry import Polygon

    return gpd.GeoSeries([Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells],
                         crs="EPSG:4326").to_crs("EPSG:2193").reset_index(drop=True)


def centres(cells) -> np.ndarray:
    """Hexagon centres in NZTM, in cell order."""
    import h3
    from pyproj import Transformer

    latlng = np.array([h3.cell_to_latlng(c) for c in cells]) if len(cells) else np.zeros((0, 2))
    x, y = Transformer.from_crs(4326, 2193, always_xy=True).transform(latlng[:, 1], latlng[:, 0])
    return np.column_stack([x, y])


def area_cover(hexes, geometries: dict[str, object]) -> pd.DataFrame:
    """Share of each hexagon's area in each zone, for shares above zero:
    columns cell, school, share."""
    import shapely

    if not geometries:
        return pd.DataFrame(columns=["cell", "school", "share"])
    names = list(geometries)
    geoms = np.array([geometries[n] for n in names], dtype=object)
    tree = shapely.STRtree(geoms)
    cell_idx, zone_idx = tree.query(np.asarray(hexes.values, dtype=object), predicate="intersects")
    hex_geoms = np.asarray(hexes.values, dtype=object)[cell_idx]
    areas = shapely.area(shapely.intersection(hex_geoms, geoms[zone_idx]))
    share = np.clip(areas / shapely.area(hex_geoms), 0.0, 1.0)
    out = pd.DataFrame({"cell": cell_idx.astype("int64"), "school": np.array(names, dtype=object)[zone_idx], "share": share})
    return out[out["share"] > 1e-9].reset_index(drop=True)


FULL = 1.0 - 1e-6


def _grid_points(geometry, spacing: float) -> np.ndarray:
    """Points on a square grid inside a polygon; its representative point when none fall inside."""
    import shapely

    x0, y0, x1, y1 = geometry.bounds
    xs = np.arange(x0 + spacing / 2, x1, spacing)
    ys = np.arange(y0 + spacing / 2, y1, spacing)
    if len(xs) and len(ys):
        gx, gy = np.meshgrid(xs, ys)
        gx, gy = gx.ravel(), gy.ravel()
        inside = shapely.contains_xy(geometry, gx, gy)
        if inside.any():
            return np.column_stack([gx[inside], gy[inside]])
    point = geometry.representative_point()
    return np.array([[point.x, point.y]])


def sampled(pieces: list[tuple[int, object, float]], spacing: float = SAMPLE_SPACING_M) -> pd.DataFrame:
    """Residents spread evenly over land pieces, as weighted grid points:
    `pieces` is (cell, geometry, people); each piece's people are shared
    equally between its points. Rows cell, x, y, w, source 'area'."""
    frames = []
    for cell, geometry, people in pieces:
        if geometry is None or geometry.is_empty:
            continue
        xy = _grid_points(geometry, spacing)
        frames.append(pd.DataFrame({"cell": cell, "x": xy[:, 0], "y": xy[:, 1], "w": float(people) / len(xy)}))
    if not frames:
        return pd.DataFrame(columns=["cell", "x", "y", "w", "source"])
    out = pd.concat(frames, ignore_index=True)
    out["source"] = "area"
    return out


def address_weights(points: pd.DataFrame, blocks) -> pd.DataFrame:
    """Each address point's share of its census block's residents.

    `points`: x, y (NZTM). `blocks`: sa1, population, geometry (NZTM, land
    blocks only). A point carries its block's residents divided by the number
    of points in the block; a point outside every block carries nothing.
    Returns points with sa1 and w.
    """
    import geopandas as gpd

    frame = gpd.GeoDataFrame(points.reset_index(drop=True), geometry=gpd.points_from_xy(points["x"], points["y"]),
                             crs="EPSG:2193")
    joined = gpd.sjoin(frame, blocks[["sa1", "population", "geometry"]], how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    counts = joined.groupby("sa1").size()
    joined["w"] = (joined["population"].fillna(0.0) / joined["sa1"].map(counts)).fillna(0.0)
    return pd.DataFrame(joined.drop(columns=["geometry", "index_right"], errors="ignore"))


def resident_points(addresses: pd.DataFrame, pieces, cells, wanted: set[int], hexes) -> pd.DataFrame:
    """Weighted points standing for the residents of the hexagons in `wanted`.

    `addresses`: x, y, sa1, w (address_weights), in NZTM. `pieces`: the grid's
    land pieces (h3, sa1, people, geometry). For each hexagon: its address
    points with weight; plus, for any census block with residents but no
    address point, that block's piece of the hexagon spread evenly over its
    area. A hexagon whose points carry no weight is spread by area over all its
    pieces (TEAM's area rule), or over the whole hexagon if it has none.
    Rows: cell, x, y, w, source ('address' or 'area').
    """
    import h3
    from pyproj import Transformer

    position = {c: i for i, c in enumerate(cells)}
    out = []
    if len(addresses):
        lon, lat = Transformer.from_crs(2193, 4326, always_xy=True).transform(addresses["x"].to_numpy(), addresses["y"].to_numpy())
        ids = [h3.latlng_to_cell(b, a, 9) for a, b in zip(lon, lat)]
        cell = np.array([position.get(c, -1) for c in ids])
        keep = np.isin(cell, np.fromiter(wanted, dtype="int64", count=len(wanted))) & (addresses["w"].to_numpy() > 0)
        found = pd.DataFrame({"cell": cell[keep], "x": addresses["x"].to_numpy()[keep],
                              "y": addresses["y"].to_numpy()[keep], "w": addresses["w"].to_numpy()[keep]})
        found["source"] = "address"
        out.append(found)
        with_points = set(addresses.loc[addresses["w"] > 0, "sa1"].dropna())
    else:
        with_points = set()
    mine = pieces[pieces["h3"].map(position).isin(wanted)].copy()
    mine["cell"] = mine["h3"].map(position).astype("int64")
    pointless = mine[(mine["people"] > 0) & ~mine["sa1"].isin(with_points)]
    out.append(sampled(list(zip(pointless["cell"], pointless.geometry, pointless["people"]))))
    points = pd.concat([f for f in out if len(f)], ignore_index=True) if any(len(f) for f in out) else \
        pd.DataFrame(columns=["cell", "x", "y", "w", "source"])
    held = points.groupby("cell")["w"].sum() if len(points) else pd.Series(dtype=float)
    empty = sorted(c for c in wanted if held.get(c, 0.0) <= 0)
    if empty:
        points = points[~points["cell"].isin(empty)]
        rest = mine[mine["cell"].isin(empty) & (mine["people"] > 0)]
        extra = [sampled(list(zip(rest["cell"], rest.geometry, rest["people"])))]
        bare = sorted(set(empty) - set(rest["cell"]))
        extra.append(sampled([(c, hexes.iloc[c], 1.0) for c in bare]))
        points = pd.concat([points, *[e for e in extra if len(e)]], ignore_index=True)
    return points.reset_index(drop=True)


def resident_shares(cover: pd.DataFrame, points: pd.DataFrame, geometries: dict[str, object],
                    centre_xy: np.ndarray, n: int, counted: set[str] | None = None,
                    held_by_set: dict[int, float] | None = None
                    ) -> tuple[pd.DataFrame, list[tuple[str, ...]], set[int]]:
    """Each zone's share of each hexagon's residents, the majority set, and
    the hexagons whose residents live in more than one set.

    `cover`: cell, school, share (area_cover). A zone covering the whole
    hexagon holds all its residents; where a zone line crosses it, the share
    is the weight of `points` (resident_points) inside the zone over the
    weight of all the hexagon's points. Each point belongs to the set of
    zones holding it; the hexagon's set is the set holding the largest
    weight (ties: the set holding the hexagon's centre, then the smaller set,
    then the lower sorted list of schools). With `counted`, the sets and the
    split are over those schools' zones only (the zones In zone counts);
    shares are given for every zone. `held_by_set`, when given, is filled
    with the share of each split hexagon's residents living in its set.
    Returns (rows cell, school, w), sets per cell (sorted tuples of school
    keys), split cells.
    """
    import shapely

    full = cover[cover["share"] >= FULL]
    cut = cover[cover["share"] < FULL]
    counts = (lambda s: True) if counted is None else (lambda s: s in counted)
    sets: list[tuple[str, ...]] = [tuple() for _ in range(n)]
    for cell, group in full.groupby("cell"):
        sets[int(cell)] = tuple(sorted(s for s in group["school"] if counts(s)))
    rows = [pd.DataFrame({"cell": full["cell"].to_numpy(), "school": full["school"].to_numpy(), "w": 1.0})]
    split: set[int] = set()
    if len(cut):
        by_cell = {int(c): g for c, g in points.groupby("cell")} if len(points) else {}
        full_by_cell = {int(c): set(g["school"]) for c, g in full.groupby("cell")}
        prepared = {}
        for cell, group in cut.groupby("cell"):
            cell = int(cell)
            pts = by_cell.get(cell)
            base = {s for s in full_by_cell.get(cell, set()) if counts(s)}
            crossing = sorted(group["school"])
            if pts is None or pts["w"].sum() <= 0:
                raise ValueError(f"no resident points for crossed hexagon {cell}")
            xs, ys, ws = pts["x"].to_numpy(), pts["y"].to_numpy(), pts["w"].to_numpy(dtype="float64")
            total = ws.sum()
            inside = np.zeros((len(crossing), len(xs)), dtype=bool)
            centre_in = []
            for k, school in enumerate(crossing):
                geometry = geometries[school]
                if school not in prepared:
                    shapely.prepare(geometry)
                    prepared[school] = True
                inside[k] = shapely.contains_xy(geometry, xs, ys)
                centre_in.append(bool(shapely.contains_xy(geometry, centre_xy[cell, 0], centre_xy[cell, 1])))
                rows.append(pd.DataFrame({"cell": [cell], "school": [school], "w": [float(ws[inside[k]].sum() / total)]}))
            # Weight of each set of the crossing zones that count.
            use = [k for k, s in enumerate(crossing) if counts(s)]
            if not use:
                sets[cell] = tuple(sorted(base))
                continue
            names = [crossing[k] for k in use]
            keys, inverse = np.unique(inside[use].T, axis=0, return_inverse=True)
            weight = np.bincount(inverse.ravel(), weights=ws, minlength=len(keys))
            held = weight > 0
            if held.sum() > 1:
                split.add(cell)
            centre_key = np.array([centre_in[k] for k in use], dtype=bool)
            best = None
            for key, wt in zip(keys[held], weight[held]):
                members = tuple(sorted(base | {s for s, hit in zip(names, key) if hit}))
                rank = (-round(float(wt), 9), 0 if np.array_equal(key, centre_key) else 1, len(members), members)
                if best is None or rank < best[0]:
                    best = (rank, members)
            sets[cell] = best[1] if best else tuple(sorted(base))
            if held_by_set is not None and held.sum() > 1:
                held_by_set[cell] = -best[0][0] / total
    shares = pd.concat(rows, ignore_index=True)
    shares = shares[shares["w"] > 0].sort_values(["cell", "school"]).reset_index(drop=True)
    return shares, sets, split


# ---------------------------------------------------------------------------
# One place


def _moe(school: str) -> int:
    return int(str(school).split(":")[1])


def build(settings: Settings, table: pd.DataFrame, listed: pd.DataFrame | None) -> dict | None:
    """Zone state for one place: statuses, and per service the shares of each
    hexagon's residents in each zone, the majority sets and the split hexagons.

    `table` is the cell table (index h3, in cells.json order; age_ columns
    when present). Returns None when no zone file is configured.
    """
    from . import ages
    from .schools import school_service_ids

    if listed is None or listed.empty or not available(settings):
        return None
    zones = read(settings.data("zones"))
    first = service_first_years(settings)
    status = statuses(listed, zones, first)
    cells = [str(c) for c in table.index]
    n = len(cells)
    hexes = hexagons(cells)
    centre_xy = centres(cells)
    about = listed.set_index("school")
    state_english = set(about.index[(about["kind"] == "state") & (about["medium"] == "english")])
    services = school_service_ids(settings)
    geometries = {s: zone_geometries(zones, status, s) for s in services}
    covers = {s: area_cover(hexes, geometries[s]) for s in services}
    crossed = set()
    for cover in covers.values():
        crossed |= set(cover.loc[cover["share"] < FULL, "cell"].astype(int))
    log.info("zones: %d hexagons crossed by a zone line", len(crossed))
    pieces, blocks = ages.block_pieces(settings)
    points = pd.DataFrame(columns=["cell", "x", "y", "w", "source"])
    address_info = {"file": None, "points": 0}
    if crossed:
        path = settings.data("addresses") if "addresses" in settings.raw["data"] else None
        if path is None or not path.exists():
            raise SystemExit("Zone lines cross hexagons but no address points are configured (data.addresses).")
        addresses = pd.read_parquet(path, columns=["x", "y"])
        weighted = address_weights(addresses, blocks.to_crs("EPSG:2193"))
        address_info = {"file": path.name, "points": int(len(addresses)),
                        "points_with_residents": int((weighted["w"] > 0).sum())}
        points = resident_points(weighted, pieces, cells, crossed, hexes)
    out = {"status": status, "cells": cells, "services": {}, "geometries": geometries, "zones": zones,
           "addresses": address_info, "state_english": state_english, "listed": listed}
    for service in services:
        in_set: dict[int, float] = {}
        shares, sets, split = resident_shares(covers[service], points, geometries[service], centre_xy, n, state_english,
                                              in_set)
        out["services"][service] = {"shares": shares, "sets": sets, "split": sorted(split), "in_set": in_set}
    return out


def annotate(listed: pd.DataFrame, state: dict | None) -> pd.DataFrame:
    """The school list with zone_status, zone_from and zone_next_from."""
    if state is None:
        return listed.assign(zone_status=None, zone_from=None, zone_next_from=None)
    status = state["status"].set_index("school")
    return listed.assign(
        zone_status=listed["school"].map(status["status"]),
        zone_from=listed["school"].map(status["from"]),
        zone_next_from=listed["school"].map(status["next_from"]),
    )


def _offsets(by_cell: dict[int, list], n: int) -> list[int]:
    counts = np.array([len(by_cell.get(i, [])) for i in range(n)], dtype="int64")
    return np.concatenate([[0], np.cumsum(counts)]).astype("int64").tolist()


def payload(settings: Settings, state: dict, dest_index: dict) -> dict:
    """schools/zones.json, format 2 (docs/schools.md)."""
    n = len(state["cells"])
    status = state["status"]
    schools = {}
    for record in status.to_dict("records"):
        d = dest_index.get(record["school"])
        if d is None:
            continue
        entry = {"moe": int(record["moe"]), "status": record["status"], "from": record["from"],
                 "next": {"from": record["next_from"]} if record["next_from"] else None,
                 "polygons": {s: [int(p) for p in v] for s, v in record["polygons"].items() if v}}
        if record.get("date_unknown"):
            entry["date_unknown"] = True
        if record.get("map_from"):
            entry["map_from"] = record["map_from"]
        schools[str(d)] = entry
    body = {"format": FORMAT, "source": file_record(settings), "reference_date": REFERENCE_DATE.isoformat(),
            "rule": RULE.format(date=REFERENCE_DATE.isoformat()), "schools": schools,
            "in": {}, "share": {}, "split": {}}
    for service, block in state["services"].items():
        by_cell = {}
        for cell, members in enumerate(block["sets"]):
            ids = sorted(dest_index[s] for s in members if s in dest_index)
            if ids:
                by_cell[cell] = ids
        body["in"][service] = {"o": _offsets(by_cell, n), "d": [d for i in range(n) for d in by_cell.get(i, [])]}
        shares = block["shares"].copy()
        shares["d"] = shares["school"].map(dest_index)
        shares["w3"] = shares["w"].round(3)
        shares = shares[shares["d"].notna() & (shares["w3"] > 0)].sort_values(["cell", "d"])
        counts = np.bincount(shares["cell"].to_numpy(dtype="int64"), minlength=n) if len(shares) else np.zeros(n, dtype="int64")
        body["share"][service] = {
            "o": np.concatenate([[0], np.cumsum(counts)]).astype("int64").tolist(),
            "d": shares["d"].astype("int64").tolist(),
            "w": [float(v) for v in shares["w3"]],
        }
        body["split"][service] = [int(c) for c in block["split"]]
    return body


def outlines(state: dict, dest_index: dict, service: str) -> dict:
    """zone_outlines_<service>.json: each zoned school's zone for the service,
    simplified 5 m in NZTM (topology kept), WGS84 to 5 decimals."""
    import geopandas as gpd
    import shapely
    from shapely.geometry import mapping

    geometries = state["geometries"].get(service, {})
    names = [s for s in geometries if s in dest_index]
    out = {}
    if names:
        simple = [shapely.simplify(geometries[s], OUTLINE_SIMPLIFY_M, preserve_topology=True) for s in names]
        series = gpd.GeoSeries(simple, crs="EPSG:2193").to_crs(4326)
        for school, geom in zip(names, series):
            geom = shapely.set_precision(geom, 1e-5)
            out[str(dest_index[school])] = mapping(geom)
    return {"format": OUTLINE_FORMAT, "service": service, "simplified_m": OUTLINE_SIMPLIFY_M, "schools": out}


def counts(state: dict) -> dict:
    """Per service, the state schools taught in English by zone status."""
    status = state["status"].set_index("school")
    listed = state["listed"].set_index("school")
    out = {}
    for service in state["services"]:
        serves = listed.index[listed["services"].str.split(",").apply(lambda s: service in s)]
        mine = [s for s in serves if s in state["state_english"]]
        found = status.loc[mine, "status"] if mine else pd.Series(dtype=str)
        record = {"state_english": len(mine)}
        for key in STATUSES:
            record[key] = int((found == key).sum())
        record["zoned"] = record["in_force"] + record["upcoming_used"]
        record["open"] = record["none"]
        out[service] = record
    return out


def split_people(state: dict, table: pd.DataFrame) -> dict:
    """People and children of the service's ages in split hexagons, and how
    many of them live outside the set their hexagon is counted in."""
    from .ages import SERVICE_GROUP

    out = {"split_people": {}, "children_in_split": {}, "people_outside_set": {}, "children_outside_set": {}}
    pop = table["population"].to_numpy(dtype="float64")
    for service, block in state["services"].items():
        cells = np.array(block["split"], dtype="int64")
        outside = np.array([1.0 - block.get("in_set", {}).get(int(c), 1.0) for c in cells])
        column = f"age_{SERVICE_GROUP.get(service, '')}"
        weights = [("split_people", "people_outside_set", pop)]
        if column in table:
            weights.append(("children_in_split", "children_outside_set", table[column].to_numpy(dtype="float64")))
        for key, away, w in weights:
            out[key][service] = round(float(w[cells].sum()), 1) if len(cells) else 0.0
            out[away][service] = round(float((w[cells] * outside).sum()), 1) if len(cells) else 0.0
    return out


def upcoming(state: dict) -> list[dict]:
    """Zones starting after the reference date: applied (the school's only
    zone in the file) or listed. `counted` marks the state schools taught in
    English, the ones In zone counts."""
    status = state["status"]
    names = state["listed"].set_index("school")["name"]
    out = []
    for record in status.to_dict("records"):
        counted = record["school"] in state["state_english"]
        if record["status"] == "upcoming_used":
            out.append({"moe": int(record["moe"]), "name": names.get(record["school"]), "from": record["from"],
                        "applied": True, "counted": counted})
        elif record["next_from"]:
            out.append({"moe": int(record["moe"]), "name": names.get(record["school"]), "from": record["next_from"],
                        "applied": False, "counted": counted})
    return sorted(out, key=lambda r: (r["from"], r["moe"]))


def write(settings: Settings, folder: Path, state: dict | None, dest_index: dict, n: int,
          table: pd.DataFrame | None = None) -> dict | None:
    """Write schools/zones.json and schools/zone_outlines_<service>.json under
    the place's data folder, and the zone table the downloads read. Returns
    meta.schools.zones (None without zones)."""
    from .export import _dump

    if state is None:
        # No zones this build: leave nothing from an earlier one for the downloads.
        for name in ("hexagon_zones.parquet", "school_zones.parquet"):
            (settings.output_dir / "zones" / name).unlink(missing_ok=True)
        return None
    if len(state["cells"]) != n:
        raise ValueError("zone state was built for a different set of cells")
    body = payload(settings, state, dest_index)
    _dump(folder / "schools" / "zones.json", body)
    files = {"zones.json": (folder / "schools" / "zones.json").stat().st_size}
    for service in state["services"]:
        name = f"zone_outlines_{service}.json"
        _dump(folder / "schools" / name, outlines(state, dest_index, service))
        files[name] = (folder / "schools" / name).stat().st_size
    # For the downloads: one row per hexagon, service and zone holding residents.
    rows = []
    for service, block in state["services"].items():
        shares = block["shares"]
        if shares.empty:
            continue
        in_set = {(c, s) for c, members in enumerate(block["sets"]) for s in members}
        rows.append(pd.DataFrame({
            "h3": [state["cells"][c] for c in shares["cell"]],
            "service": service,
            "moe": [_moe(s) for s in shares["school"]],
            "residents_share": shares["w"].round(4).to_numpy(),
            "in_zone_set": [(int(c), s) in in_set for c, s in zip(shares["cell"], shares["school"])],
        }))
    keep = settings.out("zones", "hexagon_zones.parquet")
    (pd.concat(rows, ignore_index=True) if rows else
     pd.DataFrame(columns=["h3", "service", "moe", "residents_share", "in_zone_set"])).to_parquet(keep, index=False)
    annotate(state["listed"], state)[["school", "moe", "zone_status", "zone_from", "zone_next_from"]].to_parquet(
        settings.out("zones", "school_zones.parquet"), index=False)
    splits = split_people(state, table) if table is not None else {}
    meta = {
        "source": body["source"],
        "reference_date": body["reference_date"],
        "rule": body["rule"],
        "file": "schools/zones.json",
        "outlines": {s: f"schools/zone_outlines_{s}.json" for s in state["services"]},
        "sizes": files,
        "counts": counts(state),
        "upcoming": upcoming(state),
        # People in hexagons a zone line splits, and those of them living
        # outside the zones their hexagon is counted in.
        **splits,
        "addresses": state["addresses"],
    }
    return meta


def write_downloads(folder: Path, settings: Settings) -> list[Path]:
    """team_<slug>_school_zones.csv, and the zone columns of team_<slug>_schools.csv."""
    slug = settings.naming["slug"]
    keep = settings.output_dir / "zones" / "hexagon_zones.parquet"
    if not keep.exists():
        return []
    path = folder / f"team_{slug}_school_zones.csv"
    pd.read_parquet(keep).to_csv(path, index=False)
    schools_csv = folder / f"team_{slug}_schools.csv"
    statuses_path = settings.output_dir / "zones" / "school_zones.parquet"
    if schools_csv.exists() and statuses_path.exists():
        # Read as text, so every other column is written back exactly as it was.
        listed = pd.read_csv(schools_csv, dtype=str, keep_default_na=False)
        found = pd.read_parquet(statuses_path).set_index("school")
        for column in ("zone_status", "zone_from", "zone_next_from"):
            listed[column] = listed["id"].map(found[column]).fillna("")
        listed.to_csv(schools_csv, index=False)
    return [path]


# ---------------------------------------------------------------------------
# Reports


def school_zone_people(state: dict, table: pd.DataFrame, school: str, service: str) -> dict:
    """Residents and children of the service's age living in a school's zone
    (fractional shares), for checks and reports."""
    from .ages import SERVICE_GROUP

    shares = state["services"][service]["shares"]
    mine = shares[shares["school"] == school]
    cells = mine["cell"].to_numpy(dtype="int64")
    w = mine["w"].to_numpy(dtype="float64")
    pop = table["population"].to_numpy(dtype="float64")
    out = {"hexagons": int(len(mine)), "crossed": int((w < 1).sum()), "residents": round(float((pop[cells] * w).sum()), 1)}
    column = f"age_{SERVICE_GROUP.get(service, '')}"
    if column in table:
        out["children"] = round(float((table[column].to_numpy(dtype="float64")[cells] * w).sum()), 1)
    return out


def check(settings: Settings) -> dict:
    """What `team zones check` prints: the file, statuses by service, and the
    schools to look at (upcoming zones, unclear years, maps the directory
    does not use, schemes with no map)."""
    from .schools import load_list, school_table

    listed = load_list(settings)
    if listed is None:
        # Before `team destinations --only schools`: the directory's schools
        # around the place, cut as schools.build cuts them.
        from .destinations import city_bounds

        listed = school_table(settings)
        west, south, east, north = city_bounds(settings)
        listed = listed[listed["lon"].between(west, east) & listed["lat"].between(south, north)].reset_index(drop=True)
    zones = read(settings.data("zones"))
    status = statuses(listed, zones, service_first_years(settings))
    names = listed.set_index("school")["name"]
    state_english = (listed["kind"] == "state") & (listed["medium"] == "english")
    by = status.set_index("school")
    out = {"file": file_record(settings), "reference_date": REFERENCE_DATE.isoformat(),
           "polygons": int(len(zones)), "schools_in_file": int(zones["moe"].nunique()),
           "status": by["status"].value_counts().to_dict(),
           "state_english_status": by.loc[listed.loc[state_english, "school"], "status"].value_counts().to_dict(),
           "look_at": []}
    for record in status.to_dict("records"):
        if record["status"] in ("upcoming_used", "no_map", "not_applied", "unclear_years") or record["next_from"] \
                or record.get("date_unknown"):
            out["look_at"].append({"moe": record["moe"], "name": names.get(record["school"]), "status": record["status"],
                                   "from": record["from"], "next_from": record["next_from"],
                                   "map_from": record.get("map_from"), "date_unknown": bool(record.get("date_unknown")),
                                   "state_english": bool(state_english[listed["school"] == record["school"]].any())})
    return out
