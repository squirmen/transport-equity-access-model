"""Stops near a school (D6): how far the school end of a bus or train trip is.

For each school, every stop or platform in the place's timetable feed
(`location_type` 0 or empty) within 1,300 m in a straight line is routed on
foot to the school's routing point with r5py: the place's walking network
and elevation, 4.8 km/h, whole minutes rounded down. Stops with a walk of 15
minutes or less are kept. Platforms with a `parent_station` are grouped under
the station, whose walk is its quickest platform's.

For each kept stop: the routes and trips stopping there with a departure
from 07:00:00 to 08:59:59 on the routing day (Tuesday 15 September 2026),
counting the services that run that day by calendar.txt and
calendar_dates.txt; per route its short name, mode (from `route_type`),
headsigns and trips. A stop is listed whether or not the trip R5 times uses
it: this says what is near the school, not how the median trip gets there.
A stop no trip in the feed stops at on any day is listed too, marked
`served` false: Auckland's "Mount Albert Grammar School" stop (1427) is one,
perhaps for the dedicated school buses Auckland Transport's open timetable
leaves out.

`team schools stops` routes the walks and writes
destinations/school_stops.parquet, and the straight-line metres from each
school's directory point to where R5 links it for walking
(destinations/school_snap.json, for the point check in school_points.py).
The build writes data/schools/stops.json and the stops CSV from them.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

log = logging.getLogger("team.school_stops")

MAX_WALK_MINUTES = 15
SEARCH_METRES = 1300.0

# GTFS route_type, basic and extended, to the word the site uses.
BASIC_MODES = {0: "tram", 1: "metro", 2: "train", 3: "bus", 4: "ferry", 5: "cable car", 6: "gondola", 7: "funicular",
               11: "trolleybus", 12: "monorail"}


def route_mode(route_type) -> str:
    try:
        code = int(route_type)
    except (TypeError, ValueError):
        return "other"
    if code in BASIC_MODES:
        return BASIC_MODES[code]
    for low, high, word in ((100, 199, "train"), (200, 299, "bus"), (400, 499, "train"), (700, 799, "bus"), (800, 899, "trolleybus"),
                            (900, 999, "tram"), (1000, 1099, "ferry"), (1200, 1299, "ferry"), (1300, 1399, "gondola"),
                            (1400, 1499, "funicular")):
        if low <= code <= high:
            return word
    return "other"


def _read(feed: zipfile.ZipFile, name: str, columns: list[str] | None = None) -> pd.DataFrame:
    names = {Path(n).name: n for n in feed.namelist()}
    if name not in names:
        return pd.DataFrame(columns=columns or [])
    with feed.open(names[name]) as handle:
        frame = pd.read_csv(handle, dtype=str, keep_default_na=False, encoding="utf-8-sig",
                            usecols=(lambda c: c.strip() in columns) if columns else None)
    frame.columns = [c.strip() for c in frame.columns]
    # Optional columns a feed leaves out read as empty.
    for column in columns or []:
        if column not in frame:
            frame[column] = ""
    return frame


def services_on(calendar: pd.DataFrame, dates: pd.DataFrame, day: dt.date) -> set[str]:
    """Service ids that run on `day`, by calendar.txt and calendar_dates.txt."""
    stamp = day.strftime("%Y%m%d")
    weekday = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[day.weekday()]
    running = set()
    if len(calendar):
        on = (calendar[weekday] == "1") & (calendar["start_date"] <= stamp) & (calendar["end_date"] >= stamp)
        running = set(calendar.loc[on, "service_id"])
    if len(dates):
        today = dates[dates["date"] == stamp]
        running |= set(today.loc[today["exception_type"] == "1", "service_id"])
        running -= set(today.loc[today["exception_type"] == "2", "service_id"])
    return running


def _seconds(text: pd.Series) -> np.ndarray:
    parts = text.str.strip().str.split(":", expand=True)
    if parts.shape[1] < 3:
        return np.full(len(text), np.nan)
    return (pd.to_numeric(parts[0], errors="coerce") * 3600 + pd.to_numeric(parts[1], errors="coerce") * 60
            + pd.to_numeric(parts[2], errors="coerce")).to_numpy(dtype="float64")


def school_window(settings: Settings) -> tuple[dt.date, int, int]:
    """The day and the departure window (seconds after midnight) school trips are routed in."""
    from .schools import school_service_ids

    ids = school_service_ids(settings)
    window = settings.services[ids[0]]["window"] if ids else settings.jobs["window"]
    spec = settings.routing["windows"][window]
    day = dt.date.fromisoformat(str(spec.get("date") or settings.routing["date"]))
    hour, minute = (int(v) for v in str(spec["start"]).split(":"))
    start = hour * 3600 + minute * 60
    return day, start, start + int(spec["minutes"]) * 60


def stop_table(stops: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """The stops a person boards at (location_type 0 or empty), and the group
    each belongs to: its parent station when the feed has one, else itself."""
    kind = stops.get("location_type", pd.Series("", index=stops.index)).fillna("").str.strip()
    boarding = stops[kind.isin(["", "0"])].copy()
    parent = boarding.get("parent_station", pd.Series("", index=boarding.index)).fillna("").str.strip()
    known = set(stops["stop_id"])
    group = parent.where(parent.isin(known) & (parent != ""), boarding["stop_id"])
    return boarding, pd.Series(group.to_numpy(), index=boarding["stop_id"].to_numpy())


def departures(feed: zipfile.ZipFile, wanted: set[str], day: dt.date, start: int, end: int) -> pd.DataFrame:
    """Trips stopping at the `wanted` stops with a departure in [start, end) on
    `day`: stop_id, trip_id, route_id, headsign. A trip of the day before
    that runs past midnight counts at its time less 24 hours. The stops any
    trip in the feed stops at, on any day, are in `.attrs["served"]`."""
    trips = _read(feed, "trips.txt", ["trip_id", "route_id", "service_id", "trip_headsign"])
    calendar = _read(feed, "calendar.txt")
    dates = _read(feed, "calendar_dates.txt")
    today = services_on(calendar, dates, day)
    yesterday = services_on(calendar, dates, day - dt.timedelta(days=1))
    times = _read(feed, "stop_times.txt", ["trip_id", "stop_id", "departure_time", "arrival_time", "stop_headsign", "pickup_type"])
    times = times[times["stop_id"].isin(wanted)].copy()
    served = set(times["stop_id"])
    clock = times["departure_time"].where(times["departure_time"].str.strip() != "", times.get("arrival_time", ""))
    times["seconds"] = _seconds(clock.fillna(""))
    if "pickup_type" in times:
        # 1: no pickup there, so nobody boards.
        times = times[times["pickup_type"].str.strip() != "1"]
    times = times.merge(trips, on="trip_id", how="inner")
    on_today = times["service_id"].isin(today) & (times["seconds"] >= start) & (times["seconds"] < end)
    late = times["service_id"].isin(yesterday) & (times["seconds"] >= start + 86400) & (times["seconds"] < end + 86400)
    times = times[on_today | late]
    headsign = times.get("stop_headsign", pd.Series("", index=times.index)).fillna("").str.strip()
    times["headsign"] = headsign.where(headsign != "", times["trip_headsign"].fillna("").str.strip())
    out = times[["stop_id", "trip_id", "route_id", "headsign"]].reset_index(drop=True)
    out.attrs["served"] = served
    return out


def _routes_by_group(times: pd.DataFrame, routes: pd.DataFrame, group: pd.Series) -> dict[str, tuple[list[dict], int]]:
    """Per stop group: routes (short name, mode, headsigns, trips) and trips in all."""
    if times.empty:
        return {}
    frame = times.assign(group=times["stop_id"].map(group))
    about = routes.set_index("route_id")
    out = {}
    for key, rows in frame.groupby("group", sort=False):
        listed = []
        for route_id, part in rows.groupby("route_id", sort=False):
            name = about["route_short_name"].get(route_id, "") if "route_short_name" in about else ""
            if not str(name).strip():
                name = about["route_long_name"].get(route_id, route_id) if "route_long_name" in about else route_id
            listed.append({
                "route": str(name).strip(),
                "mode": route_mode(about["route_type"].get(route_id) if "route_type" in about else None),
                "headsigns": sorted({h for h in part["headsign"] if h}),
                "trips": int(part["trip_id"].nunique()),
            })
        listed.sort(key=lambda r: (-r["trips"], r["route"]))
        out[str(key)] = (listed, int(rows["trip_id"].nunique()))
    return out


def _nztm(lon, lat) -> np.ndarray:
    import geopandas as gpd

    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs=4326).to_crs(2193)
    return np.column_stack([points.x.to_numpy(), points.y.to_numpy()])


def build(settings: Settings) -> dict:
    """Route the walks from stops to schools and write
    destinations/school_stops.parquet and destinations/school_snap.json."""
    import geopandas as gpd
    from scipy.spatial import cKDTree

    from . import routing, schools as school_data

    listed = school_data.load_list(settings)
    if listed is None or listed.empty:
        raise SystemExit("No school list: run `team destinations --only schools` first.")
    points = pd.read_parquet(settings.output_dir / "destinations" / "schools.parquet").drop_duplicates("id")
    source = settings.data("gtfs")
    day, start, end = school_window(settings)
    started = time.monotonic()
    with zipfile.ZipFile(source) as feed:
        stops = _read(feed, "stops.txt")
        routes = _read(feed, "routes.txt")
        boarding, group = stop_table(stops)
        boarding = boarding[pd.to_numeric(boarding["stop_lat"], errors="coerce").notna()]
        stop_xy = _nztm(pd.to_numeric(boarding["stop_lon"]), pd.to_numeric(boarding["stop_lat"]))
        school_xy = _nztm(points["lon"], points["lat"])
        tree = cKDTree(stop_xy)
        near = tree.query_ball_point(school_xy, r=SEARCH_METRES)
        wanted = sorted({boarding["stop_id"].iloc[k] for found in near for k in found})
        times = departures(feed, set(wanted), day, start, end)
    log.info("%d schools, %d stops within %.0f m, %d trips stopping in the window", len(points), len(wanted), SEARCH_METRES, times["trip_id"].nunique())

    routing.prepare_java(settings)
    import r5py

    walk_mode = settings.modes["walk"]
    gtfs, _ = routing.prepare_gtfs(settings)
    network = routing._network(r5py, settings, walk_mode, gtfs)
    candidates = boarding[boarding["stop_id"].isin(wanted)]
    origins = gpd.GeoDataFrame({"id": candidates["stop_id"].to_numpy()},
                               geometry=gpd.points_from_xy(pd.to_numeric(candidates["stop_lon"]), pd.to_numeric(candidates["stop_lat"])),
                               crs=4326)
    targets = gpd.GeoDataFrame({"id": points["id"].astype(str).to_numpy()}, geometry=gpd.points_from_xy(points["lon"], points["lat"]), crs=4326)
    departure, window_length = routing._departure(settings, None)
    walks = pd.DataFrame(columns=["from_id", "to_id", "travel_time"])
    if len(origins):
        walks = pd.DataFrame(r5py.TravelTimeMatrix(
            network, origins=origins, destinations=targets, departure=departure, departure_time_window=window_length,
            percentiles=[50], max_time=dt.timedelta(minutes=MAX_WALK_MINUTES + 1), snap_to_network=True,
            **routing._mode_kwargs(r5py, walk_mode, settings.routing)))
    walks = walks.dropna(subset=["travel_time"])
    walks = walks[walks["travel_time"] <= MAX_WALK_MINUTES]

    # Each school's routing points, back to the school.
    school_of = points.set_index("id")["school"]
    walks = walks.assign(school=walks["to_id"].map(school_of), group=walks["from_id"].map(group))
    xy = pd.DataFrame(stop_xy, index=boarding["stop_id"].to_numpy(), columns=["x", "y"])
    point_xy = pd.DataFrame(school_xy, index=points["id"].astype(str).to_numpy(), columns=["x", "y"])
    walks["metres"] = np.hypot(walks["from_id"].map(xy["x"]).to_numpy() - walks["to_id"].map(point_xy["x"]).to_numpy(),
                               walks["from_id"].map(xy["y"]).to_numpy() - walks["to_id"].map(point_xy["y"]).to_numpy())
    # A station's walk is its quickest platform's (then the nearest).
    walks = walks.sort_values(["school", "group", "travel_time", "metres"], kind="stable").drop_duplicates(["school", "group"])
    by_group = _routes_by_group(times, routes, group)
    # Stops no trip in the feed stops at, on any day: a stop kept for school
    # buses, say, which some open timetables leave out.
    served_groups = {group.get(s, s) for s in times.attrs.get("served", set())}
    about = stops.set_index("stop_id")
    rows = []
    for record in walks.to_dict("records"):
        key = str(record["group"])
        info = about.loc[key] if key in about.index else about.loc[record["from_id"]]
        listed_routes, trips = by_group.get(key, ([], 0))
        rows.append({
            "school": record["school"],
            "moe": int(str(record["school"]).split(":")[1]),
            "stop": key,
            "code": str(info.get("stop_code", "") or "") or None,
            "name": str(info.get("stop_name", "")),
            "station": key != record["from_id"],
            "lat": round(float(info["stop_lat"]), 6),
            "lon": round(float(info["stop_lon"]), 6),
            "walk": int(record["travel_time"]),
            "metres": round(float(record["metres"])),
            "routes": json.dumps(listed_routes, ensure_ascii=False),
            "trips": trips,
            "served": key in served_groups,
        })
    table = pd.DataFrame(rows, columns=["school", "moe", "stop", "code", "name", "station", "lat", "lon", "walk", "metres", "routes",
                                        "trips", "served"])
    table = table.sort_values(["moe", "walk", "metres", "stop"], kind="stable").reset_index(drop=True)
    table.to_parquet(settings.out("destinations", "school_stops.parquet"), index=False)

    # Where R5 links each directory point for walking, for school_points.py.
    directory = gpd.GeoSeries(gpd.points_from_xy(listed["dir_lon"] if "dir_lon" in listed else listed["lon"],
                                                 listed["dir_lat"] if "dir_lat" in listed else listed["lat"]), crs=4326)
    linked = network.snap_to_network(directory)
    before = directory.to_crs(2193)
    after = gpd.GeoSeries(list(linked), crs=4326).to_crs(2193)
    snap = {int(m): (round(float(a.distance(b)), 1) if b is not None and not b.is_empty else None)
            for m, a, b in zip(listed["moe"], before, after)}
    settings.out("destinations", "school_snap.json").write_text(json.dumps(snap, indent=1))
    record = {
        "gtfs": source.name,
        "date": day.isoformat(),
        "window": [f"{start // 3600:02d}:{start % 3600 // 60:02d}", f"{(end - 60) // 3600:02d}:{(end - 60) % 3600 // 60:02d}"],
        "schools": int(listed["moe"].nunique()),
        "schools_with_none": int(len(set(listed["school"]) - set(table["school"]))),
        "stops_listed": int(len(table)),
        "elapsed_seconds": round(time.monotonic() - started, 1),
    }
    settings.out("destinations", "school_stops.json").write_text(json.dumps(record, indent=2))
    return record


def load(settings: Settings) -> pd.DataFrame | None:
    path = settings.output_dir / "destinations" / "school_stops.parquet"
    return pd.read_parquet(path) if path.exists() else None


def write(settings: Settings, folder: Path, dest_index: dict) -> dict | None:
    """data/schools/stops.json, format 1, and the meta.schools.stops block."""
    from .export import FORMATS, _dump

    table = load(settings)
    listed = settings.output_dir / "destinations" / "school_stops.json"
    if table is None or not listed.exists():
        return None
    record = json.loads(listed.read_text())
    shared = table.drop_duplicates("stop")[["stop", "code", "name", "station", "lat", "lon", "served"]].reset_index(drop=True)
    position = {s: i for i, s in enumerate(shared["stop"])}
    schools: dict[str, list] = {}
    for school, rows in table.groupby("school", sort=False):
        if school not in dest_index:
            continue
        schools[str(dest_index[school])] = [
            {"s": position[r["stop"]], "walk": int(r["walk"]), "metres": int(r["metres"]),
             "routes": json.loads(r["routes"]), "trips": int(r["trips"])}
            for r in rows.to_dict("records")
        ]
    # Every school is listed, so the page can tell "no stop within a
    # 15-minute walk" (an empty list) from a school it has no stops for.
    for school, d in dest_index.items():
        if str(school).startswith("moe:") and str(d) not in schools:
            schools[str(d)] = []
    schools = dict(sorted(schools.items(), key=lambda kv: int(kv[0])))
    body = {
        "format": FORMATS["school_stops"],
        "date": record["date"],
        "window": record["window"],
        "max_walk_minutes": MAX_WALK_MINUTES,
        "gtfs": record["gtfs"],
        # served: false for a stop no trip in the feed stops at, on any day.
        "stops": [{"id": r["stop"], "code": r["code"], "name": r["name"], "station": bool(r["station"]),
                   "lat": r["lat"], "lon": r["lon"], "served": bool(r["served"])} for r in shared.to_dict("records")],
        "schools": schools,
    }
    _dump(folder / "schools" / "stops.json", body)
    return {"file": "schools/stops.json", "date": record["date"], "window": record["window"], "gtfs": record["gtfs"],
            "max_walk_minutes": MAX_WALK_MINUTES, "schools_with_none": record["schools_with_none"]}


def write_csv(settings: Settings, folder: Path) -> Path | None:
    """team_<slug>_school_stops.csv: one row per school and stop."""
    table = load(settings)
    listed = settings.output_dir / "destinations" / "school_stops.json"
    if table is None or not listed.exists():
        return None
    names = school_names(settings)
    rows = []
    for r in table.to_dict("records"):
        routes = json.loads(r["routes"])
        modes = sorted({x["mode"] for x in routes})
        rows.append({
            "moe": r["moe"], "school": names.get(r["moe"]), "stop_id": r["stop"], "stop_code": r["code"], "stop_name": r["name"],
            "station": bool(r["station"]), "mode": ";".join(modes), "walk_minutes": r["walk"], "straight_m": r["metres"],
            "routes": " ".join(f"{x['route']} ({x['trips']})" for x in routes), "trips_7_9": r["trips"],
            "served_any_day": bool(r["served"]),
        })
    path = folder / f"team_{settings.naming['slug']}_school_stops.csv"
    pd.DataFrame(rows, columns=["moe", "school", "stop_id", "stop_code", "stop_name", "station", "mode", "walk_minutes",
                                "straight_m", "routes", "trips_7_9", "served_any_day"]).to_csv(path, index=False)
    return path


def school_names(settings: Settings) -> dict[int, str]:
    from .schools import load_list

    listed = load_list(settings)
    return {} if listed is None else {int(m): n for m, n in zip(listed["moe"], listed["name"])}
