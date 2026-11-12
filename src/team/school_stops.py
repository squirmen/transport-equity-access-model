"""Stops near a school (D6): how far the school end of a bus or train trip is.

For each school, every stop or platform in the place's timetable feed
(`location_type` 0 or empty) within 1,300 m in a straight line is routed on
foot to the school's routing point with r5py: the place's walking network
and elevation, 4.8 km/h, whole minutes rounded down. Stops with a walk of 15
minutes or less are kept. Platforms with a `parent_station` are grouped under
the station, whose walk is its quickest platform's.

Train and ferry stations further out (0.12.0 review): a stop group (a parent
station with its platforms, or a stop with none) that any train or ferry in
the feed stops at, on any day (`route_type`), is a station. For each school,
every station platform within 2,600 m in a straight line is routed the same
way, up to 30 minutes, and the school's nearest stations within a 30-minute
walk are kept, up to 3, nearest first. Those over 15 minutes are added to the
list marked `far`; those within 15 are already in it, unchanged. The
stations Mt Albert Grammar School's students use, Baldwin Ave and Mt Albert,
are 16 and 17 minutes' walk from its point, so the 15-minute list left them
out.

For each kept stop: the routes and trips that set down there (drop_off_type
not 1) arriving from 07:00:00 to 08:59:59 on the routing day (Tuesday 15
September 2026), counting the services that run that day by calendar.txt and
calendar_dates.txt; per route (by short name and mode) its mode (from
`route_type`), headsigns and trips. At the school end students get off, so a
school bus that ends at the school's stop counts, and a train counts as it
arrives. Trips a person can board there in the window (pickup_type not 1,
departing in the window) are kept too, as `boarding`. A stop is listed whether or not the trip R5 times uses
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
# Each school's nearest train or ferry stations, up to STATIONS_MOST within a
# STATION_WALK_MINUTES walk; those beyond MAX_WALK_MINUTES are marked far.
STATION_MODES = ("train", "ferry")
STATION_WALK_MINUTES = 30
STATION_SEARCH_METRES = 2600.0
STATIONS_MOST = 3
COLUMNS = ["school", "moe", "stop", "code", "name", "station", "lat", "lon", "walk", "metres", "routes", "trips", "boarding", "served",
           "far", "station_mode"]

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
    """Trips calling at the `wanted` stops in [start, end) on `day`: stop_id,
    trip_id, route_id, headsign, alight (sets down there, drop_off_type not
    1, arriving in the window) and board (picks up there, pickup_type not 1,
    departing in the window). A trip of the day before that runs past
    midnight counts at its time less 24 hours. The stops any trip in the feed
    stops at, on any day, are in `.attrs["served"]`."""
    trips = _read(feed, "trips.txt", ["trip_id", "route_id", "service_id", "trip_headsign"])
    calendar = _read(feed, "calendar.txt")
    dates = _read(feed, "calendar_dates.txt")
    today = services_on(calendar, dates, day)
    yesterday = services_on(calendar, dates, day - dt.timedelta(days=1))
    times = _read(feed, "stop_times.txt", ["trip_id", "stop_id", "departure_time", "arrival_time", "stop_headsign",
                                           "pickup_type", "drop_off_type"])
    times = times[times["stop_id"].isin(wanted)].copy()
    served = set(times["stop_id"])
    departure = times["departure_time"].where(times["departure_time"].str.strip() != "", times["arrival_time"])
    arrival = times["arrival_time"].where(times["arrival_time"].str.strip() != "", times["departure_time"])
    times["dep"] = _seconds(departure.fillna(""))
    times["arr"] = _seconds(arrival.fillna(""))
    times = times.merge(trips, on="trip_id", how="inner")

    def within(seconds: pd.Series) -> pd.Series:
        on_today = times["service_id"].isin(today) & (seconds >= start) & (seconds < end)
        late = times["service_id"].isin(yesterday) & (seconds >= start + 86400) & (seconds < end + 86400)
        return on_today | late

    # 1: no pickup (or no drop-off) there.
    times["board"] = within(times["dep"]) & (times["pickup_type"].str.strip() != "1")
    times["alight"] = within(times["arr"]) & (times["drop_off_type"].str.strip() != "1")
    times = times[times["board"] | times["alight"]]
    headsign = times.get("stop_headsign", pd.Series("", index=times.index)).fillna("").str.strip()
    times["headsign"] = headsign.where(headsign != "", times["trip_headsign"].fillna("").str.strip())
    out = times[["stop_id", "trip_id", "route_id", "headsign", "alight", "board"]].reset_index(drop=True)
    out.attrs["served"] = served
    return out


def _route_name(about: pd.DataFrame, route_id) -> str:
    name = about["route_short_name"].get(route_id, "") if "route_short_name" in about else ""
    if not str(name).strip():
        name = about["route_long_name"].get(route_id, route_id) if "route_long_name" in about else route_id
    return str(name).strip()


def _routes_by_group(times: pd.DataFrame, routes: pd.DataFrame, group: pd.Series) -> dict[str, tuple[list[dict], int, int]]:
    """Per stop group: routes that set down there in the window (short name,
    mode, headsigns, trips), the trips setting down in all, and the trips a
    person can board there. A feed with one route_id per direction or variant
    under the same short name (Otago's 1A and 1B are both '1') is one route."""
    if times.empty:
        return {}
    about = routes.set_index("route_id")
    frame = times.assign(group=times["stop_id"].map(group),
                         route=times["route_id"].map(lambda r: _route_name(about, r)),
                         mode=times["route_id"].map(lambda r: route_mode(about["route_type"].get(r) if "route_type" in about else None)))
    out = {}
    for key, rows in frame.groupby("group", sort=False):
        alight = rows[rows["alight"]]
        listed = []
        for (name, mode), part in alight.groupby(["route", "mode"], sort=False):
            listed.append({
                "route": name,
                "mode": mode,
                "headsigns": sorted({h for h in part["headsign"] if h}),
                "trips": int(part["trip_id"].nunique()),
            })
        listed.sort(key=lambda r: (-r["trips"], r["route"]))
        out[str(key)] = (listed, int(alight["trip_id"].nunique()), int(rows.loc[rows["board"], "trip_id"].nunique()))
    return out


def _nztm(lon, lat) -> np.ndarray:
    import geopandas as gpd

    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs=4326).to_crs(2193)
    return np.column_stack([points.x.to_numpy(), points.y.to_numpy()])


def station_groups(feed: zipfile.ZipFile, routes: pd.DataFrame, group: pd.Series) -> dict[str, str]:
    """The stop groups a train or ferry stops at, on any day in the feed, and
    which: "train" (a metro too) or "ferry"; "train" where both do."""
    if routes.empty or "route_type" not in routes:
        return {}
    modes = routes.set_index("route_id")["route_type"].map(route_mode).replace({"metro": "train"})
    modes = modes[modes.isin(STATION_MODES)]
    if modes.empty:
        return {}
    trips = _read(feed, "trips.txt", ["trip_id", "route_id"])
    trips = trips[trips["route_id"].isin(modes.index)]
    times = _read(feed, "stop_times.txt", ["trip_id", "stop_id"])
    times = times[times["trip_id"].isin(set(trips["trip_id"]))].drop_duplicates(["trip_id", "stop_id"])
    mode_of_trip = trips.set_index("trip_id")["route_id"].map(modes)
    frame = pd.DataFrame({"group": times["stop_id"].map(group).fillna(times["stop_id"]), "mode": times["trip_id"].map(mode_of_trip)})
    out: dict[str, str] = {}
    for key, rows in frame.dropna().groupby("group"):
        found = set(rows["mode"])
        out[str(key)] = next(m for m in STATION_MODES if m in found)
    return out


def quickest_by_group(walks: pd.DataFrame) -> pd.DataFrame:
    """One row per school and stop group: its quickest platform (then the
    nearest in a straight line)."""
    return walks.sort_values(["school", "group", "travel_time", "metres"], kind="stable").drop_duplicates(["school", "group"])


def nearest_stations(walks: pd.DataFrame, stations: dict[str, str]) -> pd.DataFrame:
    """Each school's nearest train or ferry stations within a
    STATION_WALK_MINUTES walk, up to STATIONS_MOST, nearest first, from walks
    with one row per school and stop group (school, group, travel_time,
    metres)."""
    kept = walks[walks["group"].astype(str).isin(stations) & (walks["travel_time"] <= STATION_WALK_MINUTES)]
    kept = kept.sort_values(["school", "travel_time", "metres", "group"], kind="stable")
    return kept.groupby("school", sort=False).head(STATIONS_MOST)


def far_stations(near: pd.DataFrame, station_walks: pd.DataFrame, stations: dict[str, str]) -> pd.DataFrame:
    """The stations to add to each school's list: of its nearest stations,
    those beyond a MAX_WALK_MINUTES walk. A nearer one is in the list of
    stops within the walk already, as it was."""
    nearest = nearest_stations(station_walks, stations)
    far = nearest[nearest["travel_time"] > MAX_WALK_MINUTES]
    missing = nearest[(nearest["travel_time"] <= MAX_WALK_MINUTES)
                      & ~nearest.set_index(["school", "group"]).index.isin(near.set_index(["school", "group"]).index)]
    if len(missing):
        log.warning("%d stations within a %d-minute walk of a school are not among its stops: %s", len(missing), MAX_WALK_MINUTES,
                    missing[["school", "group", "travel_time"]].head(10).to_dict("records"))
    return far


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
        stations = station_groups(feed, routes, group)
        stop_xy = _nztm(pd.to_numeric(boarding["stop_lon"]), pd.to_numeric(boarding["stop_lat"]))
        school_xy = _nztm(points["lon"], points["lat"])
        tree = cKDTree(stop_xy)
        near = tree.query_ball_point(school_xy, r=SEARCH_METRES)
        wanted = sorted({boarding["stop_id"].iloc[k] for found in near for k in found})
        # Train and ferry platforms further out, for each school's nearest stations.
        is_station = boarding["stop_id"].map(group).fillna(boarding["stop_id"]).astype(str).isin(stations).to_numpy()
        further = tree.query_ball_point(school_xy, r=STATION_SEARCH_METRES)
        station_wanted = sorted({boarding["stop_id"].iloc[k] for found in further for k in found if is_station[k]})
        times = departures(feed, set(wanted) | set(station_wanted), day, start, end)
    log.info("%d schools, %d stops within %.0f m, %d train or ferry stops within %.0f m (%d stations in the feed), "
             "%d trips stopping in the window", len(points), len(wanted), SEARCH_METRES, len(station_wanted), STATION_SEARCH_METRES,
             len(stations), times["trip_id"].nunique())

    routing.prepare_java(settings)
    import r5py

    walk_mode = settings.modes["walk"]
    gtfs, _ = routing.prepare_gtfs(settings)
    network = routing._network(r5py, settings, walk_mode, gtfs)
    targets = gpd.GeoDataFrame({"id": points["id"].astype(str).to_numpy()}, geometry=gpd.points_from_xy(points["lon"], points["lat"]), crs=4326)
    departure, window_length = routing._departure(settings, None)
    school_of = points.set_index("id")["school"]
    xy = pd.DataFrame(stop_xy, index=boarding["stop_id"].to_numpy(), columns=["x", "y"])
    point_xy = pd.DataFrame(school_xy, index=points["id"].astype(str).to_numpy(), columns=["x", "y"])

    def walk_from(ids: list[str], minutes: int) -> pd.DataFrame:
        """Walks from these stops to every school point, up to `minutes`,
        with each school and stop group, and metres in a straight line."""
        candidates = boarding[boarding["stop_id"].isin(ids)]
        origins = gpd.GeoDataFrame({"id": candidates["stop_id"].to_numpy()},
                                   geometry=gpd.points_from_xy(pd.to_numeric(candidates["stop_lon"]), pd.to_numeric(candidates["stop_lat"])),
                                   crs=4326)
        walks = pd.DataFrame(columns=["from_id", "to_id", "travel_time"])
        if len(origins):
            walks = pd.DataFrame(r5py.TravelTimeMatrix(
                network, origins=origins, destinations=targets, departure=departure, departure_time_window=window_length,
                percentiles=[50], max_time=dt.timedelta(minutes=minutes + 1), snap_to_network=True,
                **routing._mode_kwargs(r5py, walk_mode, settings.routing)))
        walks = walks.dropna(subset=["travel_time"])
        walks = walks[walks["travel_time"] <= minutes]
        # Each school's routing points, back to the school.
        walks = walks.assign(school=walks["to_id"].map(school_of), group=walks["from_id"].map(group))
        walks["metres"] = np.hypot(walks["from_id"].map(xy["x"]).to_numpy() - walks["to_id"].map(point_xy["x"]).to_numpy(),
                                   walks["from_id"].map(xy["y"]).to_numpy() - walks["to_id"].map(point_xy["y"]).to_numpy())
        # A station's walk is its quickest platform's (then the nearest).
        return quickest_by_group(walks)

    walks = walk_from(wanted, MAX_WALK_MINUTES)
    far = far_stations(walks, walk_from(station_wanted, STATION_WALK_MINUTES), stations)
    by_group = _routes_by_group(times, routes, group)
    # Stops no trip in the feed stops at, on any day: a stop kept for school
    # buses, say, which some open timetables leave out.
    served_groups = {group.get(s, s) for s in times.attrs.get("served", set())}
    about = stops.set_index("stop_id")
    rows = []
    for record, is_far in [(r, False) for r in walks.to_dict("records")] + [(r, True) for r in far.to_dict("records")]:
        key = str(record["group"])
        info = about.loc[key] if key in about.index else about.loc[record["from_id"]]
        listed_routes, trips, boardings = by_group.get(key, ([], 0, 0))
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
            "boarding": boardings,
            "served": key in served_groups,
            "far": is_far,
            "station_mode": stations.get(key),
        })
    table = pd.DataFrame(rows, columns=COLUMNS)
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
        "schools_with_none": int(len(set(listed["school"]) - set(table.loc[~table["far"], "school"]))),
        "stops_listed": int((~table["far"]).sum()),
        "counts": COUNT_RULE,
        "stations": FAR_RULE,
        "stations_in_feed": len(stations),
        "far_listed": int(table["far"].sum()),
        "schools_with_far": int(table.loc[table["far"], "school"].nunique()),
        "elapsed_seconds": round(time.monotonic() - started, 1),
    }
    settings.out("destinations", "school_stops.json").write_text(json.dumps(record, indent=2))
    return record


COUNT_RULE = "trips setting down (drop_off_type not 1) arriving in the window; boarding: picking up (pickup_type not 1) departing in it"
FAR_RULE = (f"each school's nearest train or ferry stations (any trip of those modes on any day) within a {STATION_WALK_MINUTES}-minute "
            f"walk, up to {STATIONS_MOST}; those over {MAX_WALK_MINUTES} minutes are listed as far")


def with_defaults(table: pd.DataFrame) -> pd.DataFrame:
    """A table from before far stations: none far, no station modes."""
    if "far" not in table:
        table = table.assign(far=False)
    if "station_mode" not in table:
        table = table.assign(station_mode=None)
    table["far"] = table["far"].fillna(False).astype(bool)
    return table


def recount(settings: Settings) -> dict:
    """Count the trips at the stops already listed again, from the feed,
    without routing the walks again: for a change to how trips are counted."""
    table = load(settings)
    listed = settings.output_dir / "destinations" / "school_stops.json"
    if table is None or not listed.exists():
        raise SystemExit("No stops near schools yet: run `team schools stops` first.")
    record = json.loads(listed.read_text())
    day, start, end = school_window(settings)
    with zipfile.ZipFile(settings.data("gtfs")) as feed:
        stops = _read(feed, "stops.txt")
        routes = _read(feed, "routes.txt")
        boarding, group = stop_table(stops)
        groups = set(table["stop"].astype(str))
        wanted = {s for s, g in group.items() if str(g) in groups}
        times = departures(feed, wanted, day, start, end)
    by_group = _routes_by_group(times, routes, group)
    served_groups = {group.get(s, s) for s in times.attrs.get("served", set())}
    counted = [by_group.get(str(k), ([], 0, 0)) for k in table["stop"]]
    table = table.assign(routes=[json.dumps(c[0], ensure_ascii=False) for c in counted],
                         trips=[c[1] for c in counted], boarding=[c[2] for c in counted],
                         served=[str(k) in served_groups for k in table["stop"]])[COLUMNS]
    table.to_parquet(settings.out("destinations", "school_stops.parquet"), index=False)
    record.update({"counts": COUNT_RULE, "recounted": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
    listed.write_text(json.dumps(record, indent=2))
    return {"stops": int(len(table)), "with_trips": int((table["trips"] > 0).sum()), "far": int(table["far"].sum())}


def load(settings: Settings) -> pd.DataFrame | None:
    path = settings.output_dir / "destinations" / "school_stops.parquet"
    return with_defaults(pd.read_parquet(path)) if path.exists() else None


def write(settings: Settings, folder: Path, dest_index: dict) -> dict | None:
    """data/schools/stops.json, format 1, and the meta.schools.stops block."""
    from .export import FORMATS, _dump

    table = load(settings)
    listed = settings.output_dir / "destinations" / "school_stops.json"
    if table is None or not listed.exists():
        return None
    record = json.loads(listed.read_text())
    shared = table.drop_duplicates("stop")[["stop", "code", "name", "station", "lat", "lon", "served", "station_mode"]].reset_index(drop=True)
    position = {s: i for i, s in enumerate(shared["stop"])}
    schools: dict[str, list] = {}
    for school, rows in table.groupby("school", sort=False):
        if school not in dest_index:
            continue
        schools[str(dest_index[school])] = [
            {"s": position[r["stop"]], "walk": int(r["walk"]), "metres": int(r["metres"]),
             "routes": json.loads(r["routes"]), "trips": int(r["trips"]), "board": int(r.get("boarding", 0) or 0),
             **({"far": True} if r["far"] else {})}
            for r in rows.to_dict("records")
        ]
    # Every school is listed, so the page can tell "no stop within a
    # 15-minute walk" (an empty list, or far stations only) from a school it
    # has no stops for.
    for school, d in dest_index.items():
        if str(school).startswith("moe:") and str(d) not in schools:
            schools[str(d)] = []
    schools = dict(sorted(schools.items(), key=lambda kv: int(kv[0])))
    far_schools = sum(1 for rows in schools.values() if any(r.get("far") for r in rows))
    body = {
        "format": FORMATS["school_stops"],
        "date": record["date"],
        "window": record["window"],
        "max_walk_minutes": MAX_WALK_MINUTES,
        # far: a school's nearest train or ferry stations beyond max_walk_minutes,
        # up to far_most of them within far_walk_minutes.
        "far_walk_minutes": STATION_WALK_MINUTES,
        "far_most": STATIONS_MOST,
        "gtfs": record["gtfs"],
        # trips: setting down there, arriving in the window; board: picking up, departing in it.
        "counts": "arrivals",
        # served: false for a stop no trip in the feed stops at, on any day;
        # mode: "train" or "ferry" for a stop or station one stops at, on any day.
        "stops": [{"id": r["stop"], "code": r["code"], "name": r["name"], "station": bool(r["station"]),
                   "lat": r["lat"], "lon": r["lon"], "served": bool(r["served"]),
                   **({"mode": r["station_mode"]} if isinstance(r["station_mode"], str) and r["station_mode"] else {})}
                  for r in shared.to_dict("records")],
        "schools": schools,
    }
    _dump(folder / "schools" / "stops.json", body)
    return {"file": "schools/stops.json", "date": record["date"], "window": record["window"], "gtfs": record["gtfs"],
            "max_walk_minutes": MAX_WALK_MINUTES, "schools_with_none": record["schools_with_none"],
            "far_walk_minutes": STATION_WALK_MINUTES, "far_most": STATIONS_MOST, "schools_with_far": far_schools,
            "counts": record.get("counts", COUNT_RULE)}


def write_csv(settings: Settings, folder: Path) -> Path | None:
    """team_<slug>_school_stops.csv: one row per school and stop. far_station
    (the last column) is true for a train or ferry station beyond a
    15-minute walk, one of the school's nearest within 30."""
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
            "routes": " ".join(f"{x['route']} ({x['trips']})" for x in routes), "trips_arriving_7_9": r["trips"],
            "trips_boarding_7_9": int(r.get("boarding", 0) or 0), "served_any_day": bool(r["served"]),
            "far_station": bool(r["far"]),
        })
    path = folder / f"team_{settings.naming['slug']}_school_stops.csv"
    pd.DataFrame(rows, columns=["moe", "school", "stop_id", "stop_code", "stop_name", "station", "mode", "walk_minutes",
                                "straight_m", "routes", "trips_arriving_7_9", "trips_boarding_7_9",
                                "served_any_day", "far_station"]).to_csv(path, index=False)
    return path


def school_names(settings: Settings) -> dict[int, str]:
    from .schools import load_list

    listed = load_list(settings)
    return {} if listed is None else {int(m): n for m, n in zip(listed["moe"], listed["name"])}
