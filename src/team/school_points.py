"""Where a school's trips end: checking each school's map point (D5).

Trips end at the Ministry's map point for each school. This checks every
point against two independent records of where the school's grounds are:

* LINZ NZ Facilities (https://data.linz.govt.nz/layer/105588-nz-facilities/,
  CC BY 4.0; `scripts/fetch_school_grounds.py`), matched on
  `source_facility_id`, which is the MoE number;
* OpenStreetMap school grounds (`amenity=school` areas) in the place's street
  file, matched on their MoE tag (`MOE:id`, `ref:moe`), or by name within
  200 m when they have none (the name match is shown, never used to move a
  point).

and against the street network: the straight-line distance to the nearest
OpenStreetMap way a person can walk on, and to the place R5 links the point
to (r5py `snap_to_network`, walking).

Rule D5-1 is the only rule that moves a point. It moves one only when all of
these hold:

  (a) the point is more than 100 m outside its own LINZ grounds;
  (b) its OpenStreetMap grounds, matched by MoE number, overlap its LINZ
      grounds with an intersection over union of at least 0.5, so the two
      sources agree where the school is;
  (c) the point is inside no school's grounds in either source.

The new point is the point of the LINZ grounds nearest the old point, 10 m in
from the edge (the grounds' representative point if they are narrower than
20 m). Every other school that needs a look (more than 50 m outside its own
grounds, inside another school's grounds, more than 150 m from a walkable way
or from where R5 links it, or with no LINZ grounds) is listed for a person to
check and is not changed by the rule.

A person's check goes into configs/schools/points.csv with a blank rule: a
new point (lon, lat) with its sources, or no point, which keeps the Ministry's
(schools.kept_points). The audit marks those schools `checked` ("moved" or
"kept") and they are no longer listed to check. The audit always measures the
directory's point.
"""

from __future__ import annotations

import logging
import re
import subprocess
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("team.school_points")

RULE = "D5-1"
OUTSIDE_FLAG_M = 50.0
OUTSIDE_MOVE_M = 100.0
IOU_AGREE = 0.5
INSET_M = 10.0
FAR_FROM_NETWORK_M = 150.0
NAME_MATCH_M = 200.0
MOE_TAGS = ("MOE:id", "ref:moe", "moe:id", "ref:MOE", "MOE:ID")
# Ways a person cannot walk along.
NOT_WALKABLE = ("motorway", "motorway_link", "trunk_link", "proposed", "construction", "raceway", "abandoned", "razed")

RULE_TEXT = (
    "Rule D5-1 moves a school's point only when it is more than 100 m outside its own LINZ grounds, its OpenStreetMap "
    "grounds (matched by MoE number) overlap the LINZ grounds with an intersection over union of at least 0.5, and the "
    "point is inside no school's grounds in either source. The new point is inside the LINZ grounds, 10 m in from the "
    "edge nearest the old point."
)


def _hstore(text) -> dict[str, str]:
    """GDAL's other_tags ('"k"=>"v","k2"=>"v2"') as a dict."""
    if not isinstance(text, str) or not text:
        return {}
    return {k: v for k, v in re.findall(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"', text)}


def _moe(tags: dict[str, str]) -> int | None:
    for key in MOE_TAGS:
        value = str(tags.get(key, "")).strip()
        if value.isdigit():
            return int(value)
    return None


def fold_name(text) -> str:
    """A school name for matching: no macrons, lower case, 'saint' as 'st', 'mount' as 'mt', no punctuation."""
    text = "".join(c for c in unicodedata.normalize("NFKD", str(text or "")) if not unicodedata.combining(c)).lower()
    text = re.sub(r"\bsaint\b", "st", text)
    text = re.sub(r"\bmount\b", "mt", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def read_linz_grounds(path: Path):
    """LINZ school grounds, one row per MoE number (polygons dissolved), NZTM."""
    import geopandas as gpd

    table = gpd.read_file(path)
    table = table.to_crs(2193) if table.crs is not None else table.set_crs(2193)
    table["moe"] = pd.to_numeric(table["source_facility_id"], errors="coerce")
    table = table[table["moe"].notna()].copy()
    table["moe"] = table["moe"].astype("int64")
    table["geometry"] = table.geometry.make_valid()
    table["facility_id"] = table["facility_id"].astype(str)
    grouped = table.dissolve(by="moe", aggfunc={"facility_id": lambda v: ";".join(sorted(set(v))), "name": "first"})
    return grouped.reset_index()


def _filter(osm: Path, work: Path, name: str, expression: str) -> Path:
    work.mkdir(parents=True, exist_ok=True)
    target = work / f"{name}.osm.pbf"
    if not target.exists() or target.stat().st_mtime < osm.stat().st_mtime:
        subprocess.run(["osmium", "tags-filter", "-O", "-o", str(target), str(osm), expression], check=True,
                       capture_output=True)
    return target


def osm_school_areas(osm: Path, work: Path):
    """OpenStreetMap school grounds (amenity=school areas) from a street file, NZTM."""
    import geopandas as gpd
    import pyogrio

    path = _filter(Path(osm), Path(work), "schools", "nwr/amenity=school")
    frame = pyogrio.read_dataframe(path, layer="multipolygons", columns=["osm_id", "osm_way_id", "name", "amenity", "other_tags"])
    frame = frame[frame["amenity"] == "school"].copy()
    tags = frame["other_tags"].apply(_hstore)
    frame["moe"] = pd.array([_moe(t) for t in tags], dtype="Int64")
    frame["osm"] = np.where(frame["osm_way_id"].notna(), "way/" + frame["osm_way_id"].astype(str), "relation/" + frame["osm_id"].astype(str))
    frame = gpd.GeoDataFrame(frame[["osm", "name", "moe"]], geometry=frame.geometry.make_valid(), crs=4326).to_crs(2193)
    return frame.reset_index(drop=True)


def walkable_ways(osm: Path, work: Path):
    """Ways a person can walk on (any highway except motorways, trunk links, proposed and the like, and foot=no), NZTM."""
    import geopandas as gpd
    import pyogrio

    path = _filter(Path(osm), Path(work), "ways", "w/highway")
    frame = pyogrio.read_dataframe(path, layer="lines", columns=["highway", "other_tags"])
    foot = frame["other_tags"].fillna("").str.contains('"foot"=>"no"|"access"=>"no"', regex=True)
    keep = frame["highway"].notna() & ~frame["highway"].isin(NOT_WALKABLE) & ~foot
    return gpd.GeoSeries(frame.geometry[keep].to_numpy(), crs=4326).to_crs(2193).reset_index(drop=True)


def inset_point(grounds, point):
    """The point of `grounds` nearest `point`, INSET_M in from the edge; the
    representative point when the grounds are narrower than twice that."""
    from shapely.ops import nearest_points

    inner = grounds.buffer(-INSET_M)
    if inner.is_empty:
        return grounds.representative_point()
    return nearest_points(inner, point)[0]


def iou(a, b) -> float:
    if a is None or b is None or a.is_empty or b.is_empty:
        return 0.0
    union = a.union(b).area
    return float(a.intersection(b).area / union) if union > 0 else 0.0


def audit(listed: pd.DataFrame, linz, osm, ways=None, snapped: dict[int, float] | None = None,
          checked: dict[int, str] | None = None) -> pd.DataFrame:
    """Every school's directory point against its grounds and the network, and
    what rule D5-1 does with it. `listed` is a school_list (dir_lon, dir_lat
    are the directory's point); `snapped` gives metres to R5's link, by MoE;
    `checked` gives the schools a person has checked, "moved" or "kept"
    (schools.checked_points)."""
    import geopandas as gpd
    from shapely.geometry import Point

    lon = listed["dir_lon"] if "dir_lon" in listed else listed["lon"]
    lat = listed["dir_lat"] if "dir_lat" in listed else listed["lat"]
    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs=4326).to_crs(2193)
    linz_by = linz.set_index("moe")
    osm_moe = osm[osm["moe"].notna()].copy()
    osm_moe["moe"] = osm_moe["moe"].astype("int64")
    osm_by = osm_moe.dissolve(by="moe", aggfunc={"osm": lambda v: ";".join(v)}) if len(osm_moe) else osm_moe.set_index("moe")
    linz_index = linz.sindex
    osm_index = osm.sindex
    way_tree = ways.sindex if ways is not None and len(ways) else None
    rows = []
    lons, lats = np.asarray(lon, dtype="float64"), np.asarray(lat, dtype="float64")
    for record, point, x, y in zip(listed.to_dict("records"), points, lons, lats):
        moe = int(record["moe"])
        own = linz_by.geometry.get(moe)
        own_osm = osm_by.geometry.get(moe) if len(osm_by) else None
        osm_match = "moe" if own_osm is not None else None
        osm_id = osm_by.loc[moe, "osm"] if own_osm is not None else None
        if own_osm is None and len(osm):
            # By name within 200 m, for the record only.
            near = osm.iloc[osm_index.query(point.buffer(NAME_MATCH_M), predicate="intersects")]
            same = near[near["name"].apply(fold_name) == fold_name(record["name"])]
            if len(same):
                own_osm = same.geometry.union_all()
                osm_match = "name"
                osm_id = ";".join(same["osm"])
        linz_out = np.nan if own is None else (0.0 if own.covers(point) else float(own.distance(point)))
        osm_out = np.nan if own_osm is None else (0.0 if own_osm.covers(point) else float(own_osm.distance(point)))
        others = set()
        for k in linz_index.query(point, predicate="intersects"):
            if int(linz.iloc[k]["moe"]) != moe:
                others.add(int(linz.iloc[k]["moe"]))
        osm_other = []
        for k in osm_index.query(point, predicate="intersects"):
            row = osm.iloc[k]
            if pd.notna(row["moe"]) and int(row["moe"]) == moe:
                continue
            if osm_match == "name" and row["osm"] in str(osm_id).split(";"):
                continue
            if pd.notna(row["moe"]):
                others.add(int(row["moe"]))
            else:
                osm_other.append(row["osm"])
        agree = iou(own, osm_by.geometry.get(moe) if len(osm_by) else None)
        way_m = np.nan
        if way_tree is not None:
            nearest = way_tree.nearest(point, return_all=False)
            way_m = float(ways.iloc[int(np.ravel(nearest)[-1])].distance(point))
        snap_m = (snapped or {}).get(moe, np.nan)
        move = bool(own is not None and linz_out > OUTSIDE_MOVE_M and osm_match == "moe" and agree >= IOU_AGREE
                    and not others and not osm_other)
        new = inset_point(own, point) if move else None
        flags = []
        if own is None:
            flags.append("no LINZ grounds")
        elif linz_out > OUTSIDE_FLAG_M:
            flags.append(f"{linz_out:.0f} m outside its LINZ grounds")
        if others or osm_other:
            flags.append("inside another school's grounds")
        if np.isfinite(way_m) and way_m > FAR_FROM_NETWORK_M:
            flags.append(f"{way_m:.0f} m from a walkable way")
        if np.isinf(snap_m):
            flags.append("R5 links it to no street within 1,600 m")
        elif np.isfinite(snap_m) and snap_m > FAR_FROM_NETWORK_M:
            flags.append(f"{snap_m:.0f} m from where R5 links it")
        new_ll = gpd.GeoSeries([new], crs=2193).to_crs(4326).iloc[0] if new is not None else None
        rows.append({
            "moe": moe,
            "name": record["name"],
            "kind": record.get("kind"),
            "dir_lon": float(x),
            "dir_lat": float(y),
            "linz_facility": linz_by.loc[moe, "facility_id"] if own is not None else None,
            "linz_outside_m": None if np.isnan(linz_out) else round(linz_out, 1),
            "osm": osm_id,
            "osm_match": osm_match,
            "osm_outside_m": None if np.isnan(osm_out) else round(osm_out, 1),
            "linz_osm_iou": round(agree, 3),
            "inside_other": ";".join(str(m) for m in sorted(others)) or None,
            "inside_other_osm": ";".join(osm_other) or None,
            "walkable_way_m": None if np.isnan(way_m) else round(way_m, 1),
            "r5_link_m": None if not np.isfinite(snap_m) else round(float(snap_m), 1),
            "flags": "; ".join(flags) or None,
            "move": move,
            "checked": (checked or {}).get(moe),
            "new_lon": round(new_ll.x, 6) if new_ll is not None else None,
            "new_lat": round(new_ll.y, 6) if new_ll is not None else None,
            "moved_m": round(float(new.distance(point)), 1) if new is not None else None,
            "map": f"https://www.openstreetmap.org/?mlat={y:.6f}&mlon={x:.6f}#map=17/{y:.6f}/{x:.6f}",
        })
    return pd.DataFrame(rows)


def to_check(audited: pd.DataFrame) -> pd.Series:
    """Schools still listed for a person: flagged, not moved by rule D5-1 and
    not checked by a person."""
    out = audited["flags"].notna() & ~audited["move"].astype(bool)
    if "checked" in audited:
        out &= audited["checked"].isna()
    return out


def point_rows(audited: pd.DataFrame, checked_on: str) -> pd.DataFrame:
    """configs/schools/points.csv rows for the points rule D5-1 moves."""
    moved = audited[audited["move"]]
    return pd.DataFrame({
        "moe": moved["moe"].astype(int),
        "name": moved["name"],
        "lon": moved["new_lon"],
        "lat": moved["new_lat"],
        "source": [f"LINZ NZ Facilities {f} (OpenStreetMap {o} agrees, IoU {u:.2f}); directory point {x:.6f},{y:.6f}; moved {m:.0f} m"
                   for f, o, u, x, y, m in zip(moved["linz_facility"], moved["osm"], moved["linz_osm_iou"], moved["dir_lon"],
                                               moved["dir_lat"], moved["moved_m"])],
        "reason": [f"directory point {d:.0f} m outside the school's grounds" for d in moved["linz_outside_m"]],
        "rule": RULE,
        "checked_by": f"rule {RULE}",
        "checked_on": checked_on,
    })


def snap_metres(network, listed: pd.DataFrame) -> dict[int, float]:
    """Straight-line metres from each school's directory point to where R5 links it for walking."""
    import geopandas as gpd

    lon = listed["dir_lon"] if "dir_lon" in listed else listed["lon"]
    lat = listed["dir_lat"] if "dir_lat" in listed else listed["lat"]
    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs=4326)
    snapped = network.snap_to_network(points)
    before = points.to_crs(2193)
    after = gpd.GeoSeries(snapped.to_numpy(), crs=4326).to_crs(2193)
    out = {}
    for moe, a, b in zip(listed["moe"], before, after):
        out[int(moe)] = float(a.distance(b)) if b is not None and not b.is_empty else float("inf")
    return out


def audit_place(settings, work: Path, snapped: dict[int, float] | None = None, listed: pd.DataFrame | None = None) -> pd.DataFrame:
    """The audit for one place's schools (after the regional boundary rule),
    against data.school_grounds and the place's street file. `work` holds the
    filtered OpenStreetMap files."""
    from . import schools

    listed = schools.school_table(settings) if listed is None else listed
    linz = read_linz_grounds(settings.data("school_grounds"))
    osm = osm_school_areas(settings.data("osm"), work)
    ways = walkable_ways(settings.data("osm"), work)
    out = audit(listed, linz, osm, ways, snapped, schools.checked_points())
    out.insert(0, "place", settings.raw["name"])
    return out


def read_snap(settings) -> dict[int, float] | None:
    """Metres from each school's directory point to R5's link, if `team schools stops` has written them."""
    import json

    path = settings.output_dir / "destinations" / "school_snap.json"
    if not path.exists():
        return None
    # null: R5 found no street to link it to within its 1,600 m radius.
    return {int(k): (float("inf") if v is None else float(v)) for k, v in json.loads(path.read_text()).items()}
