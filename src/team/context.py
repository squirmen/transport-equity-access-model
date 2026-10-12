"""What the transport network looks like around each cell, and map overlays.

Public transport frequency comes from the GTFS timetable for the routing date:
departures per hour at the busiest stop within 800 m of the cell centre, in
each routing window. Distances are straight lines from the cell centre.
"""

from __future__ import annotations

import datetime as dt
import io
import zipfile

import numpy as np
import pandas as pd

from .config import Settings

LOW_STRESS_FACILITIES = {
    "Off-road shared path",
    "Off-road cycleway",
    "Off-road trail",
    "On-road protected cycle lane",
    "On-road protected cycle lane (bi-directional)",
    "Local area traffic management",
    "Shared zone",
}
RAIL_TYPES = {0, 1, 2}
FERRY_TYPES = {4}
STOP_RADIUS_M = 800.0
FREQUENT_PER_HOUR = 4.0
LINE_TOLERANCE_DEG = 0.0001  # about 10 m, for simplifying network lines drawn on the map


def _read(zf: zipfile.ZipFile, name: str, **kwargs) -> pd.DataFrame:
    with zf.open(name) as handle:
        return pd.read_csv(io.TextIOWrapper(handle, encoding="utf-8-sig"), dtype=str, **kwargs)


def _read_some(zf: zipfile.ZipFile, name: str, required: list[str], optional: list[str]) -> pd.DataFrame:
    """The required columns of a table, and whichever optional ones it has.
    A missing optional column comes back empty."""
    with zf.open(name) as handle:
        header = io.TextIOWrapper(handle, encoding="utf-8-sig").readline().strip().split(",")
    header = [h.strip().strip('"') for h in header]
    table = _read(zf, name, usecols=required + [c for c in optional if c in header])
    for column in optional:
        if column not in table:
            table[column] = pd.NA
    return table


def active_services(zf: zipfile.ZipFile, date: dt.date) -> set[str]:
    """Service ids running on `date`, from calendar.txt and calendar_dates.txt."""
    stamp = date.strftime("%Y%m%d")
    active: set[str] = set()
    names = set(zf.namelist())
    if "calendar.txt" in names:
        calendar = _read(zf, "calendar.txt")
        weekday = date.strftime("%A").lower()
        running = (calendar["start_date"] <= stamp) & (calendar["end_date"] >= stamp) & (calendar[weekday] == "1")
        active |= set(calendar.loc[running, "service_id"])
    if "calendar_dates.txt" in names:
        exceptions = _read(zf, "calendar_dates.txt")
        today = exceptions[exceptions["date"] == stamp]
        active |= set(today.loc[today["exception_type"] == "1", "service_id"])
        active -= set(today.loc[today["exception_type"] == "2", "service_id"])
    return active


def _seconds(clock: pd.Series) -> pd.Series:
    parts = clock.str.split(":", expand=True).astype(float)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def timetable(settings: Settings):
    """Stops with departures per hour in each window, and trips with their route type.

    Stops keep their GTFS name, code and parent station, and trips their
    route's short name, for naming stops and lines on the map.
    """
    date = dt.date.fromisoformat(str(settings.routing["date"]))
    # A window can run on its own day, such as a Saturday, and a Saturday
    # timetable is a different set of trips.
    dated = {
        name: dt.date.fromisoformat(str(spec["date"])) if spec.get("date") else date
        for name, spec in settings.routing["windows"].items()
    }
    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        running = {day: set(active_services(zf, day)) for day in {date, *dated.values()}}
        routes = _read_some(zf, "routes.txt", ["route_id", "route_type"], ["route_short_name", "route_long_name"])
        # shape_id is optional in GTFS; a feed written from a printed timetable has none.
        all_trips = _read(zf, "trips.txt")
        if "shape_id" not in all_trips:
            all_trips["shape_id"] = pd.NA
        all_trips = all_trips[["trip_id", "route_id", "service_id", "shape_id"]]
        all_trips = all_trips.merge(routes, on="route_id", how="left")
        all_trips["route_type"] = pd.to_numeric(all_trips["route_type"], errors="coerce")
        times = _read_some(zf, "stop_times.txt", ["trip_id", "departure_time", "stop_id"], ["stop_sequence"])
        stops = _read_some(zf, "stops.txt", ["stop_id", "stop_lat", "stop_lon"],
                           ["stop_name", "stop_code", "parent_station", "location_type"])
    service_of = all_trips.set_index("trip_id")["service_id"]
    times = times[times["trip_id"].isin(set(all_trips.loc[all_trips["service_id"].isin(set().union(*running.values())), "trip_id"]))].copy()
    times["t"] = _seconds(times["departure_time"].fillna("99:00:00"))
    # Stops in a trip's order. Two stops can share a departure time, so the
    # order comes from stop_sequence where the feed has it.
    times["seq"] = pd.to_numeric(times.pop("stop_sequence"), errors="coerce").fillna(times["t"])
    times["service_id"] = times["trip_id"].map(service_of)
    stops[["stop_lat", "stop_lon"]] = stops[["stop_lat", "stop_lon"]].astype(float)
    for name, spec in settings.routing["windows"].items():
        hour, minute = (int(p) for p in str(spec["start"]).split(":"))
        start = hour * 3600 + minute * 60
        length = int(spec["minutes"]) * 60
        on_day = times["service_id"].isin(running[dated[name]])
        in_window = times[on_day & (times["t"] >= start) & (times["t"] < start + length)]
        per_hour = in_window.groupby("stop_id").size() / (length / 3600)
        stops[f"per_hour_{name}"] = stops["stop_id"].map(per_hour).fillna(0.0)
    # Everything else describes the ordinary weekday.
    trips = all_trips[all_trips["service_id"].isin(running[date])]
    times = times[times["service_id"].isin(running[date])].drop(columns="service_id")
    stop_types = times[["trip_id", "stop_id"]].merge(trips[["trip_id", "route_type"]], on="trip_id")
    rail = set(stop_types.loc[stop_types["route_type"].isin(RAIL_TYPES), "stop_id"])
    ferry = set(stop_types.loc[stop_types["route_type"].isin(FERRY_TYPES), "stop_id"])
    stops["rail_or_ferry"] = stops["stop_id"].isin(rail | ferry)
    return stops, trips, times


def _xy(lon, lat) -> np.ndarray:
    import geopandas as gpd

    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs="EPSG:4326").to_crs("EPSG:2193")
    return np.column_stack([points.x.to_numpy(), points.y.to_numpy()])


def build(settings: Settings, origins) -> pd.DataFrame:
    from scipy.spatial import cKDTree

    cells = _xy(origins.geometry.x, origins.geometry.y)
    out = pd.DataFrame(index=pd.Index(origins["id"], name="h3"))
    stops, _, _ = timetable(settings)
    stop_xy = _xy(stops["stop_lon"], stops["stop_lat"])
    tree = cKDTree(stop_xy)
    nearby = tree.query_ball_point(cells, r=STOP_RADIUS_M)
    for window in settings.routing["windows"]:
        rates = stops[f"per_hour_{window}"].to_numpy()
        out[f"pt_per_hour_{window}"] = [float(rates[idx].max()) if idx else 0.0 for idx in nearby]

    def nearest(mask: np.ndarray) -> np.ndarray:
        if not mask.any():
            return np.full(len(cells), np.nan)
        distance, _ = cKDTree(stop_xy[mask]).query(cells, k=1)
        return distance

    first_window = next(iter(settings.routing["windows"]))
    out["m_frequent_stop"] = nearest(stops[f"per_hour_{first_window}"].to_numpy() >= FREQUENT_PER_HOUR)
    out["m_rail_ferry"] = nearest(stops["rail_or_ferry"].to_numpy())
    out["m_low_stress_route"] = low_stress_distance(settings, cells)
    return out.round(1)


def low_stress_network(settings: Settings):
    import geopandas as gpd

    # Optional: not every city publishes a cycling network layer, and the
    # distance to a low-stress route is the only thing that needs it.
    if "cycling_network" not in settings.raw["data"]:
        return None
    path = settings.data("cycling_network")
    if not path.exists():
        return None
    network = gpd.read_file(path).to_crs("EPSG:2193")
    facility = network.get("TYPEOFFACILITY", pd.Series("", index=network.index)).fillna("").astype(str).str.strip()
    network["facility"] = facility
    network["low_stress"] = facility.isin(LOW_STRESS_FACILITIES)
    return network


def low_stress_distance(settings: Settings, cells: np.ndarray) -> np.ndarray:
    import shapely

    network = low_stress_network(settings)
    if network is None or not network["low_stress"].any():
        return np.full(len(cells), np.nan)
    lines = network.loc[network["low_stress"], "geometry"].to_numpy()
    tree = shapely.STRtree(lines)
    points = shapely.points(cells)
    _, distance = tree.query_nearest(points, return_distance=True, all_matches=False)
    return distance


def _text(value) -> str | None:
    """A GTFS text field, or None when it is blank."""
    if value is None or value is pd.NA or (isinstance(value, float) and np.isnan(value)):
        return None
    value = str(value).strip()
    return value or None


def line_kinds(settings: Settings, trips: pd.DataFrame, frequent_routes: set[str]) -> pd.Series:
    """What each trip's route is as a line: rail, ferry, busway, frequent_bus or bus.

    A busway is a bus route that runs mostly on its own road, listed by short
    name under `busways` in the configuration, because GTFS has no way to say so.
    """
    busways = {str(k) for k in (settings.raw.get("busways") or {})}
    short = trips["route_short_name"].fillna("").astype(str)
    return pd.Series(
        np.select(
            [
                trips["route_type"].isin(RAIL_TYPES),
                trips["route_type"].isin(FERRY_TYPES),
                short.isin(busways) & short.ne(""),
                trips["route_id"].isin(frequent_routes),
            ],
            ["rail", "ferry", "busway", "frequent_bus"],
            default="bus",
        ),
        index=trips.index,
    )


def transit_lines(settings: Settings, stops: pd.DataFrame, trips: pd.DataFrame, times: pd.DataFrame,
                  frequent_routes: set[str], route_rate: pd.Series, boarding: set[str] | None = None) -> list[dict]:
    """Rail, busway, ferry and frequent bus lines, with the stops each one serves.

    A line is the routes that share a short name. Its stops are the stops its
    weekday trips call at: first the most common stopping pattern in order,
    then stops only other patterns use. With `boarding`, only those stops are
    listed (the ones with departures in a routing window). `from` and `to` name
    the ends of the most common pattern, by station where the stop belongs to
    one. `per_hour` is the line's trips an hour, both ways, that start in the
    window job access is timed in.
    """
    trips = trips.copy()
    trips["kind"] = line_kinds(settings, trips, frequent_routes)
    trips = trips[trips["kind"] != "bus"]
    if trips.empty:
        return []
    trips["line"] = trips["route_short_name"].map(_text).fillna(trips["route_id"])
    busways = {str(k): str(v) for k, v in (settings.raw.get("busways") or {}).items()}
    ordered = times[times["trip_id"].isin(set(trips["trip_id"]))].sort_values(["trip_id", "seq"], kind="stable")
    patterns = ordered.groupby("trip_id", sort=False)["stop_id"].agg(tuple)
    trips["pattern"] = trips["trip_id"].map(patterns)
    trips = trips.dropna(subset=["pattern"])
    info = stops.set_index("stop_id")
    station_name = info["stop_name"].map(_text)

    def place(stop_id: str) -> str | None:
        parent = _text(info.at[stop_id, "parent_station"]) if stop_id in info.index else None
        if parent and parent in station_name.index and station_name.get(parent):
            return station_name[parent]
        return station_name.get(stop_id)

    rank = {"rail": 0, "busway": 1, "ferry": 2, "frequent_bus": 3}
    out = []
    for line, group in trips.groupby("line", sort=True):
        counts = group["pattern"].value_counts()
        served: list[str] = []
        seen: set[str] = set()
        for pattern in counts.index:
            for stop_id in pattern:
                if stop_id not in seen and (boarding is None or stop_id in boarding):
                    seen.add(stop_id)
                    served.append(stop_id)
        main = counts.index[0]
        kind = group["kind"].map(rank).min()
        kind = next(k for k, r in rank.items() if r == kind)
        route_ids = sorted(set(group["route_id"]))
        names = {_text(n) for n in group["route_long_name"]} - {None, line}
        entry = {
            "id": str(line),
            "name": str(line),
            "kind": kind,
            "routes": route_ids,
            "from": place(main[0]),
            "to": place(main[-1]),
            "per_hour": round(float(route_rate.reindex(route_ids).fillna(0).sum()), 1),
            "stops": served,
        }
        if len(names) == 1:
            entry["long_name"] = names.pop()
        if kind == "busway" and busways.get(str(line)):
            entry["corridor"] = busways[str(line)]
        out.append(entry)
    out.sort(key=lambda e: (rank[e["kind"]], e["id"]))
    return out


def overlays(settings: Settings) -> dict[str, dict]:
    """Rail, ferry, frequent bus, other bus and cycle network lines for the map,
    the stops and stations with their GTFS ids and names, and the lines a
    person can pick (rail, busway, ferry and frequent bus) with their stops.

    Stop ids are the GTFS stop_id of the timetable TEAM routes on, which is also
    what R5 reports for the stops a trip boards and leaves at.
    """
    import geopandas as gpd

    stops, trips, times = timetable(settings)
    # A feed with no shapes still has stops in order, so each trip pattern is
    # drawn as a line through its stops.
    shapeless = trips["shape_id"].isna()
    if shapeless.any():
        ordered = times[times["trip_id"].isin(set(trips.loc[shapeless, "trip_id"]))].sort_values(["trip_id", "seq"], kind="stable")
        patterns = ordered.groupby("trip_id")["stop_id"].agg(tuple)
        trips = trips.copy()
        trips.loc[shapeless, "shape_id"] = trips.loc[shapeless, "trip_id"].map(lambda t: f"stops:{hash(patterns.get(t, ()))}")
    window = settings.routing["windows"][settings.jobs["window"]]
    hour, minute = (int(p) for p in str(window["start"]).split(":"))
    start, length = hour * 3600 + minute * 60, int(window["minutes"]) * 60
    first = times.sort_values("t").drop_duplicates("trip_id")[["trip_id", "t"]]
    peak = first[(first["t"] >= start) & (first["t"] < start + length)].merge(trips, on="trip_id")
    route_rate = peak.groupby("route_id").size() / (length / 3600)
    frequent_routes = set(route_rate[route_rate >= FREQUENT_PER_HOUR].index)

    def label(row) -> str | None:
        if row["route_type"] in RAIL_TYPES:
            return "rail"
        if row["route_type"] in FERRY_TYPES:
            return "ferry"
        return "frequent_bus" if row["route_id"] in frequent_routes else "bus"

    shape_labels = trips.dropna(subset=["shape_id"]).copy()
    shape_labels["layer"] = shape_labels.apply(label, axis=1)
    rank = {"rail": 0, "ferry": 1, "frequent_bus": 2, "bus": 3}
    shape_labels["rank"] = shape_labels["layer"].map(rank)
    best = shape_labels.sort_values("rank").drop_duplicates("shape_id").set_index("shape_id")["layer"]
    # Each stop at its busiest time, so a network that starts after the
    # morning peak still shows its stops.
    rates = [f"per_hour_{w}" for w in settings.routing["windows"] if f"per_hour_{w}" in stops]
    per_hour = stops[rates].max(axis=1) if rates else pd.Series(0.0, index=stops.index)
    lines = transit_lines(settings, stops, trips, times, frequent_routes, route_rate,
                          boarding=set(stops.loc[per_hour > 0, "stop_id"]))
    # The lines a person can pick, by the shapes their trips are drawn with.
    line_of_route = {r: entry["id"] for entry in lines for r in entry["routes"]}
    shape_lines = (
        shape_labels.assign(line=shape_labels["route_id"].map(line_of_route))
        .dropna(subset=["line"]).groupby("shape_id")["line"].agg(lambda s: sorted(set(s)))
    )

    import shapely

    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        shapes = _read(zf, "shapes.txt") if "shapes.txt" in zf.namelist() else pd.DataFrame(
            columns=["shape_id", "shape_pt_sequence", "shape_pt_lon", "shape_pt_lat"])
    if shapeless.any():
        coords = stops.set_index("stop_id")[["stop_lon", "stop_lat"]]
        drawn = []
        for shape_id, trip_id in trips.loc[shapeless].drop_duplicates("shape_id")[["shape_id", "trip_id"]].itertuples(index=False):
            sequence = ordered[ordered["trip_id"] == trip_id]["stop_id"]
            for k, stop in enumerate(sequence):
                if stop in coords.index:
                    drawn.append({"shape_id": shape_id, "shape_pt_sequence": k,
                                  "shape_pt_lon": coords.at[stop, "stop_lon"], "shape_pt_lat": coords.at[stop, "stop_lat"]})
        shapes = pd.concat([shapes, pd.DataFrame(drawn)], ignore_index=True)
    shapes = shapes[shapes["shape_id"].isin(best.index)].copy()
    shapes["seq"] = shapes["shape_pt_sequence"].astype(int)
    shapes[["lon", "lat"]] = shapes[["shape_pt_lon", "shape_pt_lat"]].astype(float)
    layers: dict[str, list] = {name: [] for name in rank}
    seen: dict[tuple, dict] = {}
    for shape_id, points in shapes.sort_values(["shape_id", "seq"]).groupby("shape_id"):
        if len(points) < 2:
            continue
        # Timetable shapes carry a point every few metres; about 10 m is plenty
        # for a network drawn over the map.
        line = shapely.simplify(shapely.LineString(points[["lon", "lat"]].to_numpy()), LINE_TOLERANCE_DEG)
        coords = np.round(shapely.get_coordinates(line), 5).tolist()
        signature = tuple(map(tuple, coords))
        names = shape_lines.get(shape_id, [])
        if len(coords) < 2:
            continue
        if signature in seen:
            # The same line drawn twice: name every line that uses it.
            properties = seen[signature]["properties"]
            if names:
                properties["lines"] = sorted(set(properties.get("lines", [])) | set(names))
            continue
        feature = {"type": "Feature", "properties": {"lines": names} if names else {},
                   "geometry": {"type": "LineString", "coordinates": coords}}
        seen[signature] = feature
        layers[best[shape_id]].append(feature)
    out = {name: {"type": "FeatureCollection", "features": features} for name, features in layers.items()}

    network = low_stress_network(settings)
    if network is not None:
        cycle = network[["facility", "low_stress", "geometry"]].to_crs("EPSG:4326")
        cycle["geometry"] = cycle.geometry.simplify(0.00002)
        cycle["class"] = np.where(cycle["low_stress"], "low_stress", "other")
        out["cycling"] = gpd.GeoDataFrame(cycle[["class", "facility", "geometry"]]).__geo_interface__

    # Where you can actually board. A route line says a bus passes; a stop says
    # you can get on, which is the thing that decides whether a place has
    # public transport or merely has it going past.
    kinds = np.where(
        stops["rail_or_ferry"], "rail_ferry",
        np.where(per_hour >= FREQUENT_PER_HOUR, "frequent", "other"),
    )
    boarding = stops[per_hour > 0]
    keep = kinds[(per_hour > 0).to_numpy()]

    def stop_properties(kind, rate, row) -> dict:
        properties = {"kind": str(kind), "per_hour": round(float(rate), 1), "id": str(row.stop_id)}
        for key, column in (("name", "stop_name"), ("code", "stop_code"), ("station", "parent_station")):
            value = _text(getattr(row, column))
            if value:
                properties[key] = value
        return properties

    out["stops"] = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": stop_properties(kind, rate, row),
                "geometry": {"type": "Point", "coordinates": [round(float(row.stop_lon), 5), round(float(row.stop_lat), 5)]},
            }
            for kind, rate, row in zip(keep, per_hour[per_hour > 0], boarding.itertuples(index=False))
        ],
    }
    # Stations: the parent of a group of platforms or bays, named once.
    parents = boarding["parent_station"].map(_text).dropna()
    by_parent = pd.DataFrame({"parent": parents, "rail_ferry": boarding.loc[parents.index, "rail_or_ferry"]})
    rail_ferry = by_parent.groupby("parent")["rail_ferry"].any()
    stations = stops[stops["stop_id"].isin(rail_ferry.index)]
    out["stations"] = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": str(row.stop_id), "name": _text(row.stop_name) or str(row.stop_id),
                               "kind": "rail_ferry" if rail_ferry[row.stop_id] else "bus"},
                "geometry": {"type": "Point", "coordinates": [round(float(row.stop_lon), 5), round(float(row.stop_lat), 5)]},
            }
            for row in stations.itertuples(index=False)
        ],
    }
    out["lines"] = lines
    return out
