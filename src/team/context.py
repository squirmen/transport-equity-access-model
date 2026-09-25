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
    """Stops with departures per hour in each window, and trips with their route type."""
    date = dt.date.fromisoformat(str(settings.routing["date"]))
    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        services = active_services(zf, date)
        routes = _read(zf, "routes.txt", usecols=["route_id", "route_type"])
        trips = _read(zf, "trips.txt", usecols=["trip_id", "route_id", "service_id", "shape_id"])
        trips = trips[trips["service_id"].isin(services)].merge(routes, on="route_id", how="left")
        trips["route_type"] = pd.to_numeric(trips["route_type"], errors="coerce")
        times = _read(zf, "stop_times.txt", usecols=["trip_id", "departure_time", "stop_id"])
        times = times[times["trip_id"].isin(set(trips["trip_id"]))].copy()
        stops = _read(zf, "stops.txt", usecols=["stop_id", "stop_lat", "stop_lon"])
    times["t"] = _seconds(times["departure_time"].fillna("99:00:00"))
    stops[["stop_lat", "stop_lon"]] = stops[["stop_lat", "stop_lon"]].astype(float)
    for name, spec in settings.routing["windows"].items():
        hour, minute = (int(p) for p in str(spec["start"]).split(":"))
        start = hour * 3600 + minute * 60
        length = int(spec["minutes"]) * 60
        in_window = times[(times["t"] >= start) & (times["t"] < start + length)]
        per_hour = in_window.groupby("stop_id").size() / (length / 3600)
        stops[f"per_hour_{name}"] = stops["stop_id"].map(per_hour).fillna(0.0)
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


def overlays(settings: Settings) -> dict[str, dict]:
    """Rail, ferry, frequent bus, other bus and cycle network lines for the map."""
    import geopandas as gpd

    stops, trips, times = timetable(settings)
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

    import shapely

    with zipfile.ZipFile(settings.data("gtfs")) as zf:
        shapes = _read(zf, "shapes.txt")
    shapes = shapes[shapes["shape_id"].isin(best.index)].copy()
    shapes["seq"] = shapes["shape_pt_sequence"].astype(int)
    shapes[["lon", "lat"]] = shapes[["shape_pt_lon", "shape_pt_lat"]].astype(float)
    layers: dict[str, list] = {name: [] for name in rank}
    seen: set[tuple] = set()
    for shape_id, points in shapes.sort_values(["shape_id", "seq"]).groupby("shape_id"):
        if len(points) < 2:
            continue
        # Timetable shapes carry a point every few metres; about 10 m is plenty
        # for a network drawn over the map.
        line = shapely.simplify(shapely.LineString(points[["lon", "lat"]].to_numpy()), LINE_TOLERANCE_DEG)
        coords = np.round(shapely.get_coordinates(line), 5).tolist()
        signature = tuple(map(tuple, coords))
        if len(coords) < 2 or signature in seen:
            continue
        seen.add(signature)
        layers[best[shape_id]].append({"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": coords}})
    out = {name: {"type": "FeatureCollection", "features": features} for name, features in layers.items()}

    network = low_stress_network(settings)
    if network is not None:
        cycle = network[["facility", "low_stress", "geometry"]].to_crs("EPSG:4326")
        cycle["geometry"] = cycle.geometry.simplify(0.00002)
        cycle["class"] = np.where(cycle["low_stress"], "low_stress", "other")
        out["cycling"] = gpd.GeoDataFrame(cycle[["class", "facility", "geometry"]]).__geo_interface__
    return out
