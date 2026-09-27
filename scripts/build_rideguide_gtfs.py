"""Write a GTFS feed for a network that publishes its timetable only on the web.

Gisborne, Marlborough and Invercargill publish no GTFS. Their council pages
embed Ride Guide timetables, which are served stop by stop, with every stop's
position and every trip's times. This reads those timetables for the days
TEAM routes and writes them out as a standard GTFS feed, so R5 can route on
them like any other network.

Only the days asked for are written, each as its own service in
calendar_dates.txt, so a route that runs three days a week is not assumed to
run every weekday. School-only routes are left out by default: TEAM measures
what the public can ride.

The same timetables are on the council sites. When a council publishes its
own GTFS, use that instead.

    python scripts/build_rideguide_gtfs.py --data-root <root> --dataset gisborne-nz \\
        --city gisborne --name gizzybus --agency "GizzyBus" --url https://www.gdc.govt.nz \\
        --dates 20260915 20260919
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import logging
import re
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

log = logging.getLogger("rideguide")

API = "https://api.app.ride.guide"
AGENT = "TEAM research (Better Places Lab, University of Auckland)"
PICKUP = {"REGULAR_SCHEDULE": 0, "NO_PICKUP": 1, "PHONE_AGENCY": 2, "COORDINATE_WITH_DRIVER": 3}
ROUTE_TYPES = {"TRAM": 0, "SUBWAY": 1, "RAIL": 2, "BUS": 3, "FERRY": 4}


def _get(path: str, key: str | None = None):
    # The web app sends its own address as the origin; some datasets check it.
    headers = {"User-Agent": AGENT, "Origin": "https://app.ride.guide", "Referer": "https://app.ride.guide/"}
    if key:
        headers["x-api-key"] = key
    request = urllib.request.Request(f"{API}{path}", headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    time.sleep(0.5)  # a page view's pace, not a crawler's
    return payload


def fetch(dataset: str, dates: list[str], skip: str | None) -> dict:
    """Routes, stops and trips for each date, as the timetable pages show them."""
    query = urllib.parse.urlencode({"clientName": "rideguide", "datasetName": dataset})
    keys = _get(f"/v1/api-keys?{query}")
    if not keys:
        raise SystemExit(f"Ride Guide has no dataset called {dataset!r}.")
    key = keys[0]["apiKeyValue"]
    routes = _get("/v1/schedule/routes", key)
    if skip:
        pattern = re.compile(skip, re.I)
        kept = [r for r in routes if not pattern.search(f"{r.get('routeShortName', '')} {r.get('routeLongName', '')}")]
        log.info("routes: %d, leaving out %d matching %r", len(routes), len(routes) - len(kept), skip)
        routes = kept
    timetables = {}
    for route in routes:
        for date in dates:
            timetables[(route["routeId"], date)] = _get(
                f"/v2/timetable?{urllib.parse.urlencode({'routeId': route['routeId'], 'date': date})}", key
            )
    return {"routes": routes, "timetables": timetables}


def _csv(rows: list[dict], fields: list[str]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def write(data: dict, dates: list[str], out: Path, agency: str, url: str, source_page: str) -> dict:
    agencies = {r["agencyId"] for r in data["routes"]}
    stops: dict[str, dict] = {}
    trips: list[dict] = []
    times: list[dict] = []
    for (route_id, date), table in data["timetables"].items():
        for direction in table.get("directions", []):
            for stop in direction.get("stops", []):
                lon, lat = stop["location"]
                stops[stop["id"]] = {
                    "stop_id": stop["id"],
                    "stop_code": stop.get("stopCode") or "",
                    "stop_name": stop.get("name") or stop["id"],
                    "stop_lat": f"{lat:.7f}",
                    "stop_lon": f"{lon:.7f}",
                }
            for trip in direction.get("trips", []):
                trip_id = f"{route_id}_{date}_{direction['id']}_{trip['tripId']}"
                trips.append({
                    "route_id": route_id,
                    "service_id": f"D{date}",
                    "trip_id": trip_id,
                    "direction_id": direction["id"],
                    "trip_headsign": direction.get("directionName") or "",
                })
                for st in trip["stopTimes"]:
                    if not st or not st.get("time"):  # a stop this trip skips
                        continue
                    times.append({
                        "trip_id": trip_id,
                        "arrival_time": st["time"],
                        "departure_time": st["time"],
                        "stop_id": st["id"],
                        "stop_sequence": st["sequence"],
                        "pickup_type": PICKUP.get(st.get("pickupType"), 0),
                        "drop_off_type": PICKUP.get(st.get("dropOffType"), 0),
                        "timepoint": 1 if st.get("timepoint") else 0,
                    })
    routes = [{
        "route_id": r["routeId"],
        "agency_id": r["agencyId"],
        "route_short_name": r.get("routeShortName") or "",
        "route_long_name": r.get("routeLongName") or "",
        "route_type": ROUTE_TYPES.get(str(r.get("routeType", "BUS")).upper(), 3),
        "route_color": r.get("routeColor") or "",
        "route_text_color": r.get("routeTextColor") or "",
    } for r in data["routes"]]
    files = {
        "agency.txt": _csv([{"agency_id": a, "agency_name": agency, "agency_url": url, "agency_timezone": "Pacific/Auckland"}
                            for a in sorted(agencies)], ["agency_id", "agency_name", "agency_url", "agency_timezone"]),
        "stops.txt": _csv(sorted(stops.values(), key=lambda s: s["stop_id"]), ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"]),
        "routes.txt": _csv(routes, ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"]),
        "trips.txt": _csv(trips, ["route_id", "service_id", "trip_id", "direction_id", "trip_headsign"]),
        "stop_times.txt": _csv(times, ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type", "timepoint"]),
        "calendar_dates.txt": _csv([{"service_id": f"D{d}", "date": d, "exception_type": 1} for d in dates], ["service_id", "date", "exception_type"]),
        "feed_info.txt": _csv([{
            "feed_publisher_name": "TEAM, from the timetables published on the council's website",
            "feed_publisher_url": source_page,
            "feed_lang": "en",
            "feed_start_date": min(dates),
            "feed_end_date": max(dates),
        }], ["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date"]),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text)
    by_date = {d: sum(1 for t in trips if t["service_id"] == f"D{d}") for d in dates}
    meta = {
        "downloaded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": "Ride Guide timetables embedded on the council website",
        "source_page": source_page,
        "routes": [f"{r['route_short_name']} {r['route_long_name']}" for r in routes],
        "stops": len(stops),
        "trips_by_date": by_date,
        "notes": "Written by scripts/build_rideguide_gtfs.py for the dates TEAM routes only. "
                 "Replace with the council's own GTFS if one is published.",
    }
    out.with_suffix(out.suffix + ".metadata.json").write_text(json.dumps(meta, indent=2))
    return meta


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--dataset", required=True, help="Ride Guide dataset name, e.g. gisborne-nz")
    parser.add_argument("--city", required=True)
    parser.add_argument("--name", required=True, help="network name for the file")
    parser.add_argument("--agency", required=True)
    parser.add_argument("--url", required=True, help="the council's bus page")
    parser.add_argument("--dates", nargs="+", required=True, help="YYYYMMDD dates to write")
    parser.add_argument("--skip", default=r"Waka Kura|school|^S\d", help="leave out routes whose name matches (regex)")
    args = parser.parse_args()
    data = fetch(args.dataset, args.dates, args.skip or None)
    stamp = dt.date.today().isoformat()
    out = args.data_root.expanduser().resolve() / "raw" / args.city / "gtfs" / f"{args.name}_gtfs_{stamp}.zip"
    meta = write(data, args.dates, out, args.agency, args.url, args.url)
    print(json.dumps({k: meta[k] for k in ("routes", "stops", "trips_by_date")}, indent=2))
    print(out)


if __name__ == "__main__":
    main()
