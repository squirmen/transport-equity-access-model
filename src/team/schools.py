"""Schools: the Ministry of Education directory, what each school is, where a
trip to it ends, and the reach lists the site filters by kind of school.

Everything here is read from three inputs:

* the directory snapshot, one dated file for the whole country
  (`scripts/fetch_school_directory.py`), cut to the place's routing area
  whatever the regional council;
* `configs/schools/points.csv`, corrected map points, checked by a person or
  moved by rule D5-1 (`school_points.py`);
* `configs/schools/entrances.csv`, entrances a person has checked;
* `configs/schools/attributes.csv`, directory fields a person has checked and
  corrected.

Only rows with `checked_by` and `checked_on` filled are used from the CSV
files. docs/schools.md sets out every rule below and why.

A school is routed to its checked entrances when it has any, and otherwise to
its directory point (or the corrected point). Its time is the fastest of its
entrances. Routing points are named `moe:<School_Id>` for the point and
`moe:<School_Id>/e<n>` for entrances; every result is kept by school,
`moe:<School_Id>`.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import logging
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

log = logging.getLogger("team.schools")

REPO_CONFIGS = Path(__file__).resolve().parents[2] / "configs" / "schools"

# Org_Type values that are in no school service, and why. Every type in a
# place's directory must be in a service's `school_types` or here
# (tests/test_schools.py), so a new or misspelt type cannot drop out unseen.
EXCLUDED_TYPES = {
    "Specialist School": "enrols by referral, for students with high learning needs",
    "Teen Parent Unit": "for school-age parents, attached to a host school",
    "Activity Centre": "a placement of up to a few terms, by referral",
    "Correspondence School": "Te Kura teaches at a distance, not at a site",
}

# Years taught, from the Ministry's Org_Type. The Ministry counts to Year 15
# for students who stay on past Year 13; the range is kept as it names it.
TYPE_YEARS = {
    "Contributing": (1, 6),
    "Full Primary": (1, 8),
    "Intermediate": (7, 8),
    "Secondary (Year 7-15)": (7, 15),
    "Secondary (Year 9-15)": (9, 15),
    "Secondary (Year 11-15)": (11, 15),
    "Secondary (Year 7-10)": (7, 10),
    "Composite": (1, 15),
    "Composite (Year 1-10)": (1, 10),
    "Restricted Composite (Year 7-10)": (7, 10),
}

# Authority to kind of school.
KINDS = {
    "State": "state",
    "State : Integrated": "integrated",
    "Private : Fully Registered": "private",
    "Private : Provisionally Registered": "private",
    "Charter School": "charter",
}

# Language_of_Instruction. A school where all students are taught in te reo
# Māori or a Pacific language is not English-medium; a school with a bilingual
# or immersion unit is, since most of its students are taught in English.
LANGUAGES = {
    "All students taught in English/other setting": "english",
    "Some students taught in te reo Māori": "english",
    "Some students taught in a Pacific language": "english",
    "Some students taught in te reo Māori or a Pacific language": "english",
    "All students taught in te reo Māori": "maori",
    "All students taught in a Pacific language": "pacific",
}

# Which years each school service is about. A service can set `school_level`
# in its config; these are the defaults for the three TEAM uses.
SERVICE_LEVELS = {"primary_school": "primary", "intermediate_school": "intermediate", "secondary_school": "secondary"}

KIND_ORDER = ("state", "integrated", "private", "charter")
SEXES = ("co-ed", "girls", "boys")


def _fold(text: str) -> str:
    """A column name without macrons, so 'Takiwā' and 'Takiwa' are one field."""
    return "".join(c for c in unicodedata.normalize("NFKD", str(text)) if not unicodedata.combining(c))


def read_directory(path: Path) -> pd.DataFrame:
    """The directory as text columns, from the dated CSV snapshot or from an
    older per-region JSON file ({"records": [...]})."""
    path = Path(path)
    if path.suffix.lower() == ".csv":
        table = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8")
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))
        records = payload["records"] if isinstance(payload, dict) else payload
        table = pd.DataFrame(records)
        table = table.astype(object).where(table.notna(), "").astype(str)
    table.columns = [_fold(c) for c in table.columns]
    for column in table.columns:
        table[column] = table[column].astype(str).str.strip()
    return table


def snapshot_meta(path: Path) -> dict:
    """The snapshot's metadata file, if it has one."""
    meta = Path(str(path) + ".metadata.json")
    return json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {}


def school_level(service_id: str, spec: dict) -> str | None:
    return spec.get("school_level") or SERVICE_LEVELS.get(service_id)


def school_service_ids(settings: Settings) -> list[str]:
    """Services filled from the school directory, in config order."""
    return [sid for sid, spec in settings.services.items() if spec.get("school_types")]


def sex_for(coed: str, level: str | None) -> str | None:
    """Who a school takes at the years a service is about.

    'Primary Co-Ed/Secondary Girls' schools take boys only to Year 6, so they
    are girls' schools for intermediate and secondary years. King's College and
    St Paul's Collegiate ('Boys/Senior Co-Ed') take girls only from Year 12,
    so they are boys' schools for a student starting secondary school.
    """
    coed = (coed or "").strip()
    if coed == "Co-Educational":
        return "co-ed"
    if coed == "Girls School":
        return "girls"
    if coed == "Boys School":
        return "boys"
    if coed == "Primary Co-Ed/Secondary Girls":
        return "co-ed" if level == "primary" else "girls"
    if coed == "Primary Co-Ed/Secondary Boys":
        return "co-ed" if level == "primary" else "boys"
    if coed == "Boys/Senior Co-Ed":
        return "co-ed" if level == "primary" else "boys"
    return None


def takes(sex: str | None, student: str) -> bool:
    """Whether a school with this `sex` takes a girl or a boy ('girls', 'boys')."""
    return sex == "co-ed" or sex == student


def _int(value) -> int | None:
    number = pd.to_numeric(value, errors="coerce")
    return int(number) if pd.notna(number) else None


def _date(value) -> str | None:
    text = str(value or "").strip()
    return text[:10] if re.match(r"\d{4}-\d{2}-\d{2}", text) else None


def type_services(settings: Settings) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for sid, spec in settings.services.items():
        for kind in spec.get("school_types", []):
            out.setdefault(str(kind), []).append(sid)
    return out


def unknown_types(settings: Settings, directory: pd.DataFrame) -> list[str]:
    """Org_Type values in the directory that are in no service and not excluded."""
    known = set(type_services(settings)) | set(EXCLUDED_TYPES)
    return sorted({t for t in directory.get("Org_Type", pd.Series(dtype=str)) if t and t not in known})


# A school is kept only where the place's street file has a street a person
# can walk on within this many metres of its map point. R5 links a point to
# the nearest street within 1,600 m; past about a kilometre the nearest street
# in the file is seldom the school's own, because the file stops a little
# beyond the place's census blocks, and the trip would be timed to the wrong
# road.
STREET_REACH_M = 1000.0


def routing_area(settings: Settings) -> tuple[float, float, float, float] | None:
    """The box a place's schools may be in: the cut every national destination
    file gets (`destinations.city_bounds`, census blocks plus 0.08 degrees).
    None when the place has no census blocks to cut by."""
    if "census_sa1" not in settings.raw["data"] or not settings.data("census_sa1").exists():
        return None
    from .destinations import city_bounds

    return tuple(float(v) for v in city_bounds(settings))  # type: ignore[return-value]


def street_metres(settings: Settings, lon: np.ndarray, lat: np.ndarray) -> np.ndarray | None:
    """Straight-line metres from each point to the nearest street a person can
    walk on in the place's street file (school_points.walkable_ways); None
    when the place has no street file."""
    if "osm" not in settings.raw["data"] or not settings.data("osm").exists():
        return None
    import geopandas as gpd

    from .school_points import walkable_ways

    ways = walkable_ways(settings.data("osm"), settings.cache_dir / "school_checks")
    points = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs=4326).to_crs(2193)
    nearest = ways.sindex.nearest(points, return_all=False, return_distance=True)
    out = np.full(len(points), np.inf)
    (where, _), distance = nearest
    out[where] = distance
    return out


def place_directory(settings: Settings, record: dict | None = None) -> pd.DataFrame:
    """The open schools in the place's routing area, from any region, as the
    directory has them: inside `routing_area` and within STREET_REACH_M of a
    street in the place's street file, so they can be routed.

    Before 0.12.0 a place kept only its own regional councils' schools, so a
    school over a regional boundary was never counted, however near. Pass a
    dict as `record` to be told which schools in the box were left out for
    being too far from the street file.
    """
    table = read_directory(settings.data("schools"))
    status = table.get("Status", pd.Series("", index=table.index)).str.lower()
    # 'Proposed' schools are not open yet; an empty status is taken as open.
    table = table[(status == "") | status.str.contains("open")]
    area = routing_area(settings)
    if area is not None and {"Longitude", "Latitude"} <= set(table.columns):
        west, south, east, north = area
        lon = pd.to_numeric(table["Longitude"], errors="coerce")
        lat = pd.to_numeric(table["Latitude"], errors="coerce")
        table = table[lon.between(west, east) & lat.between(south, north)]
        metres = street_metres(settings, pd.to_numeric(table["Longitude"]).to_numpy(), pd.to_numeric(table["Latitude"]).to_numpy())
        if metres is not None:
            far = metres > STREET_REACH_M
            if record is not None:
                record["far_from_streets"] = [
                    {"moe": int(m), "name": n, "region": r or None, "street_m": round(float(d))}
                    for m, n, r, d in zip(table.loc[far, "School_Id"], table.loc[far, "Org_Name"],
                                          table.loc[far].get("Regional_Council", pd.Series("", index=table.index[far])), metres[far])
                ]
            table = table[~far]
    return table.copy()


def regional_councils(table: pd.DataFrame) -> dict[str, int]:
    """Schools by regional council, for the record of where they came from."""
    if "Regional_Council" not in table or table.empty:
        return {}
    names = table["Regional_Council"].fillna("").replace("", "not given")
    return {str(k): int(v) for k, v in names.value_counts().sort_index().items()}


def _checked(path: Path) -> pd.DataFrame:
    """Rows of a hand-kept CSV that a person has checked."""
    if not path.exists():
        return pd.DataFrame()
    with path.open(encoding="utf-8", newline="") as handle:
        rows = [r for r in csv.DictReader(line for line in handle if not line.lstrip().startswith("#"))]
    table = pd.DataFrame(rows)
    if table.empty:
        return table
    table = table.fillna("")
    keep = (table.get("checked_by", "").astype(str).str.strip() != "") & (table.get("checked_on", "").astype(str).str.strip() != "")
    return table[keep].copy()


def corrected_points(folder: Path = REPO_CONFIGS) -> dict[int, tuple[float, float, str]]:
    """Replacements for directory points: {moe: (lon, lat, source)}.

    A row counts when checked_by and checked_on are filled: by a person, or
    by a rule (`rule` D5-1, checked_by "rule D5-1"), which moves a point only
    when two sources agree where the school's grounds are (school_points.py).
    """
    table = _checked(folder / "points.csv")
    out = {}
    for row in table.to_dict("records"):
        out[int(row["moe"])] = (float(row["lon"]), float(row["lat"]), str(row.get("source", "")))
    return out


def point_rules(folder: Path = REPO_CONFIGS) -> dict[int, dict]:
    """The rest of each used points.csv row: rule, reason and who checked it."""
    table = _checked(folder / "points.csv")
    return {int(r["moe"]): {k: str(r.get(k, "") or "") for k in ("rule", "reason", "source", "checked_by", "checked_on")}
            for r in table.to_dict("records")}


# A state school the directory gives no teaching language for, whose peak body
# is one of the two Māori-medium bodies, is taken as Māori-medium: of the 113
# open schools with a peak body in the 12 November 2026 directory, 106 teach
# all students in te reo Māori.
MAORI_PEAK_BODIES = ("Ngā Kura ā Iwi o Aotearoa Inc", "Te Rūnanga nui o ngā Kura Kaupapa Māori o Aotearoa")


def checked_attributes(folder: Path = REPO_CONFIGS) -> dict[int, dict[str, tuple[str, str]]]:
    """Checked corrections to directory fields: {moe: {field: (value, source)}}.

    `field` is a directory column (Language_of_Instruction, CoEd_Status, ...);
    the corrected value is read as if the directory had it.
    """
    table = _checked(folder / "attributes.csv")
    out: dict[int, dict[str, tuple[str, str]]] = {}
    for row in table.to_dict("records"):
        out.setdefault(int(row["moe"]), {})[str(row["field"]).strip()] = (str(row.get("value", "")).strip(), str(row.get("source", "")))
    return out


def teaching_language(record: dict, corrected: dict[str, tuple[str, str]] | None = None) -> tuple[str | None, str | None]:
    """A school's teaching language and where it came from.

    directory     the directory's Language_of_Instruction
    attributes    configs/schools/attributes.csv, checked by a person
    peak_body     not given, but a state school whose peak body is Māori-medium
    None          not given
    """
    if corrected and "Language_of_Instruction" in corrected:
        return LANGUAGES.get(corrected["Language_of_Instruction"][0]), "attributes"
    language = LANGUAGES.get(record.get("Language_of_Instruction", ""))
    if language is not None:
        return language, "directory"
    if KINDS.get(record.get("Authority", "")) == "state" and str(record.get("KMEPeakBody", "")).strip() in MAORI_PEAK_BODIES:
        return "maori", "peak_body"
    return None, None


def checked_entrances(folder: Path = REPO_CONFIGS) -> dict[int, list[tuple[float, float, str]]]:
    """Checked entrances: {moe: [(lon, lat, label), ...]} in file order."""
    table = _checked(folder / "entrances.csv")
    out: dict[int, list[tuple[float, float, str]]] = {}
    for row in table.to_dict("records"):
        out.setdefault(int(row["moe"]), []).append((float(row["lon"]), float(row["lat"]), str(row.get("entrance", ""))))
    return out


def school_table(settings: Settings, directory: pd.DataFrame | None = None, folder: Path = REPO_CONFIGS) -> pd.DataFrame:
    """One row per school that some school service counts, with what it is.

    Columns: school (moe:<id>), moe, name, org_type, authority, kind, language,
    language_source, medium, coed, years_from, years_to, roll, roll_date,
    scheme, region (regional council), lon, lat, point (directory or
    corrected), point_source, point_moved_m, dir_lon, dir_lat (the directory's
    point), entrances (checked entrances, 0 for none), services
    (comma-separated), and sex_<service> for each school service.
    """
    directory = place_directory(settings) if directory is None else directory
    by_type = type_services(settings)
    levels = {sid: school_level(sid, settings.services[sid]) for sid in school_service_ids(settings)}
    moved = corrected_points(folder)
    rules = point_rules(folder)
    entrances = checked_entrances(folder)
    fixes = checked_attributes(folder)
    rows = []
    for record in directory.to_dict("records"):
        moe_text = str(record.get("School_Id", "")).strip()
        corrected = fixes.get(int(moe_text), {}) if moe_text.isdigit() else {}
        record = {**record, **{k: v for k, (v, _) in corrected.items()}}
        services = by_type.get(record.get("Org_Type", ""), [])
        if not services:
            continue
        try:
            lon, lat = float(record["Longitude"]), float(record["Latitude"])
        except (KeyError, TypeError, ValueError):
            log.warning("school %s has no map point; left out", record.get("School_Id"))
            continue
        moe = int(record["School_Id"])
        point, point_source, moved_m = "directory", "directory", 0.0
        dir_lon, dir_lat = lon, lat
        if moe in moved:
            lon, lat, source = moved[moe]
            point = "corrected"
            rule = rules.get(moe, {})
            point_source = f"{rule.get('rule') or 'checked'}: {source}".strip()
            moved_m = _metres(dir_lon, dir_lat, lon, lat)
        years = TYPE_YEARS.get(record.get("Org_Type", ""), (None, None))
        language, language_source = teaching_language(record, corrected)
        row = {
            "school": f"moe:{moe}",
            "moe": moe,
            "name": record.get("Org_Name"),
            "org_type": record.get("Org_Type"),
            "authority": record.get("Authority"),
            "kind": KINDS.get(record.get("Authority", "")),
            "language": language,
            "language_source": language_source,
            # English-medium, other, or not stated (null).
            "medium": None if language is None else ("english" if language == "english" else "other"),
            "coed": record.get("CoEd_Status") or None,
            "years_from": years[0],
            "years_to": years[1],
            "roll": _int(record.get("Total")),
            "roll_date": _date(record.get("Roll_Date")),
            "scheme": str(record.get("Enrolment_Scheme", "")).strip().lower() == "yes",
            "region": record.get("Regional_Council") or None,
            "lon": lon,
            "lat": lat,
            "point": point,
            "point_source": point_source,
            "point_moved_m": round(moved_m, 1),
            "dir_lon": dir_lon,
            "dir_lat": dir_lat,
            "entrances": len(entrances.get(moe, [])),
            "services": ",".join(services),
        }
        for sid in levels:
            row[f"sex_{sid}"] = sex_for(record.get("CoEd_Status", ""), levels[sid]) if sid in services else None
        rows.append(row)
    table = pd.DataFrame(rows)
    if table.empty:
        return table
    return table.sort_values("moe").reset_index(drop=True)


def _metres(lon0: float, lat0: float, lon1: float, lat1: float) -> float:
    """Straight-line metres between two WGS84 points, in NZTM."""
    from pyproj import Transformer

    to_nztm = Transformer.from_crs(4326, 2193, always_xy=True)
    x0, y0 = to_nztm.transform(lon0, lat0)
    x1, y1 = to_nztm.transform(lon1, lat1)
    return float(np.hypot(x1 - x0, y1 - y0))


def routing_points(schools: pd.DataFrame, folder: Path = REPO_CONFIGS) -> pd.DataFrame:
    """Where each school's trips end, one row per point and service.

    A school with checked entrances is routed to those entrances only. One
    without is routed to its directory point, or its corrected point.
    """
    entrances = checked_entrances(folder)
    rows = []
    for record in schools.to_dict("records"):
        weight = float(record["roll"]) if record.get("roll") and record["roll"] > 0 else 1.0
        points = entrances.get(int(record["moe"]))
        if points:
            places = [(f"{record['school']}/e{n}", lon, lat, "entrance") for n, (lon, lat, _) in enumerate(points, start=1)]
        else:
            places = [(record["school"], record["lon"], record["lat"], record["point"])]
        for service in str(record["services"]).split(","):
            for point_id, lon, lat, kind in places:
                rows.append({
                    "id": point_id,
                    "school": record["school"],
                    "source_id": record["school"],
                    "service": service,
                    "name": record["name"],
                    "source": "Ministry of Education school directory",
                    # The roll weights the gravity scores, as before.
                    "weight": weight,
                    "lon": float(lon),
                    "lat": float(lat),
                    "point": kind,
                })
    columns = ["id", "school", "source_id", "service", "name", "source", "weight", "lon", "lat", "point"]
    return pd.DataFrame(rows, columns=columns).sort_values(["service", "id"]).reset_index(drop=True)


def build(settings: Settings) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Write destinations/schools.parquet (routing points) and
    destinations/school_list.parquet (one row per school), with a record of
    the snapshot they came from."""
    left_out: dict = {}
    directory = place_directory(settings, left_out)
    missing = unknown_types(settings, directory)
    if missing:
        raise SystemExit(f"School types in no service and not excluded: {', '.join(missing)}. "
                         "Add them to a service's school_types or to schools.EXCLUDED_TYPES.")
    # place_directory has already cut the directory to the place's routing
    # area, by each school's directory point.
    schools = school_table(settings, directory)
    points = routing_points(schools)
    target = settings.out("destinations", "schools.parquet")
    if target.exists():
        # The points the school runs were routed to, for `team schools reroute`.
        import shutil

        shutil.copy2(target, target.with_name("schools_previous.parquet"))
    schools.to_parquet(settings.out("destinations", "school_list.parquet"), index=False)
    points.to_parquet(target, index=False)
    source = settings.data("schools")
    meta = snapshot_meta(source)
    record = {
        "snapshot": str(source),
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "retrieved": meta.get("retrieved"),
        "source_modified": meta.get("resource_last_modified"),
        "roll_dates": schools["roll_date"].value_counts(dropna=False).rename(index=lambda v: v or "none").to_dict(),
        "routing_area": routing_area(settings),
        "street_reach_m": STREET_REACH_M,
        "far_from_streets": left_out.get("far_from_streets", []),
        "regional_councils": regional_councils(schools.rename(columns={"region": "Regional_Council"})),
        "schools": int(len(schools)),
        "points": int(points["id"].nunique()),
        "corrected_points": int((schools["point"] == "corrected").sum()),
        "with_entrances": int((schools["entrances"] > 0).sum()),
    }
    settings.out("destinations", "schools_summary.json").write_text(json.dumps(record, indent=2, default=str))
    log.info("schools: %d schools, %d routing points", len(schools), points["id"].nunique())
    return points, schools


def load_list(settings: Settings) -> pd.DataFrame | None:
    path = settings.output_dir / "destinations" / "school_list.parquet"
    return pd.read_parquet(path) if path.exists() else None


# ---------------------------------------------------------------------------
# Routing results, kept by school


def collapse(matrix: pd.DataFrame, points: pd.DataFrame, max_minutes: int) -> pd.DataFrame:
    """One row per origin and school from R5's rows per routing point.

    The school's time is its fastest entrance (lowest median). Ties between
    entrances go to the lower 10th percentile, then the entrance listed first.
    Its spread (lo, hi) is that entrance's 10th and 90th percentiles. Times
    over `max_minutes` are dropped: R5 can return a minute or two past the
    limit for the walk from the street to the point.
    """
    p50 = "travel_time_p50" if "travel_time_p50" in matrix else "travel_time"
    reached = matrix.dropna(subset=[p50]).copy()
    reached = reached[reached[p50] <= max_minutes]
    lookup = points.drop_duplicates("id").set_index("id")["school"]
    reached["school"] = reached["to_id"].map(lookup)
    reached = reached.dropna(subset=["school"])
    order = list(points.drop_duplicates("id")["id"])
    reached["entrance_order"] = reached["to_id"].map({p: i for i, p in enumerate(order)})
    keys = ["from_id", "school", p50]
    if "travel_time_p10" in reached:
        keys.append("travel_time_p10")
    keys.append("entrance_order")
    reached = reached.sort_values(keys, kind="stable").drop_duplicates(["from_id", "school"])
    out = pd.DataFrame({"origin": reached["from_id"].astype(str), "school": reached["school"].astype(str),
                        "minutes": reached[p50].astype("uint8")})
    if "travel_time_p10" in reached:
        out["lo"] = reached["travel_time_p10"].fillna(255).clip(upper=255).astype("uint8").to_numpy()
        # 255: the 90th percentile is past the routing limit.
        hi = reached["travel_time_p90"]
        out["hi"] = np.where(hi.notna() & (hi <= max_minutes), hi.fillna(255), 255).astype("uint8")
    return out.reset_index(drop=True)


def school_pairs(collapsed: pd.DataFrame, points: pd.DataFrame) -> pd.DataFrame:
    """The by-school rows, one per service each school serves."""
    serves = points[["school", "service"]].drop_duplicates()
    pairs = collapsed.merge(serves, on="school", how="inner").rename(columns={"school": "destination"})
    columns = ["origin", "destination", "service", "minutes", *[c for c in ("lo", "hi") if c in pairs]]
    return pairs[columns].sort_values(["origin", "service", "minutes", "destination"], kind="stable").reset_index(drop=True)


def summarise(pairs: pd.DataFrame) -> pd.DataFrame:
    """Per origin and service: minutes to the nearest school, which one (lowest
    MoE number on a tie), and how many within 10, 15, 20 and 30 minutes. The
    build breaks ties by distance instead (`nearest_schools`)."""
    from .routing import SERVICE_COUNT_MINUTES

    columns = ["origin", "service", "minutes", "nearest_id", *[f"n{t}" for t in SERVICE_COUNT_MINUTES]]
    if pairs.empty:
        return pd.DataFrame(columns=columns)
    frame = pairs.copy()
    frame["moe"] = frame["destination"].str.split(":").str[1].astype(int)
    frame = frame.sort_values(["origin", "service", "minutes", "moe"], kind="stable")
    out = frame.drop_duplicates(["origin", "service"])[["origin", "service", "minutes", "destination"]]
    out = out.rename(columns={"destination": "nearest_id"})
    for limit in SERVICE_COUNT_MINUTES:
        counts = frame[frame["minutes"] <= limit].groupby(["origin", "service"]).size().rename(f"n{limit}").reset_index()
        out = out.merge(counts, on=["origin", "service"], how="left")
        out[f"n{limit}"] = out[f"n{limit}"].fillna(0).astype("int32")
    out["minutes"] = out["minutes"].astype("float32")
    return out[columns].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Measures from the reach lists


def load_reach(settings: Settings, tag: str) -> pd.DataFrame | None:
    from .measures import school_run_done

    if not school_run_done(settings, tag):
        return None
    folder = settings.cache_dir / "pairs" / tag
    files = sorted(folder.glob("origins_*[0-9].parquet"))
    if not files:
        return None
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


def ordered_reach(pairs: pd.DataFrame, origins: pd.Index, origin_xy: np.ndarray, schools: pd.DataFrame) -> pd.DataFrame:
    """Every school reached from each origin, in the order the site lists them:
    minutes, then straight-line distance, then MoE number. Adds `cell` (the
    origin's position) and `metres` (straight line, NZTM)."""
    position = pd.Series(np.arange(len(origins)), index=origins)
    frame = pairs[pairs["origin"].isin(position.index)].copy()
    frame["cell"] = frame["origin"].map(position).astype("int64")
    xy = schools.set_index("school")[["x", "y"]]
    sx = frame["destination"].map(xy["x"]).to_numpy(dtype="float64")
    sy = frame["destination"].map(xy["y"]).to_numpy(dtype="float64")
    ox = origin_xy[frame["cell"].to_numpy(), 0]
    oy = origin_xy[frame["cell"].to_numpy(), 1]
    # Whole metres, so the order does not hang on floating-point noise.
    frame["metres"] = np.rint(np.hypot(sx - ox, sy - oy))
    frame["moe"] = frame["destination"].str.split(":").str[1].astype("int64")
    return frame.sort_values(["cell", "minutes", "metres", "moe"], kind="stable").reset_index(drop=True)


def nearest_schools(reach: pd.DataFrame, n: int) -> tuple[np.ndarray, np.ndarray, dict[int, list[str]]]:
    """Minutes, nearest school and the other schools tied with it, per cell.

    `reach` is one service's `ordered_reach`. Returns minutes (NaN where none
    within the limit), the nearest school key (None) and {cell: [tied keys]}.
    """
    minutes = np.full(n, np.nan, dtype="float32")
    nearest = np.full(n, None, dtype=object)
    ties: dict[int, list[str]] = {}
    if reach.empty:
        return minutes, nearest, ties
    first = reach.drop_duplicates("cell")
    minutes[first["cell"].to_numpy()] = first["minutes"].to_numpy(dtype="float32")
    nearest[first["cell"].to_numpy()] = first["destination"].to_numpy()
    best = pd.Series(minutes).iloc[reach["cell"].to_numpy()].to_numpy()
    tied = reach[(reach["minutes"].to_numpy(dtype="float32") == best)]
    tied = tied[tied.duplicated("cell", keep="first")]
    for cell, group in tied.groupby("cell", sort=True):
        ties[int(cell)] = group["destination"].tolist()
    return minutes, nearest, ties


def counts_within(reach: pd.DataFrame, n: int, limit: int) -> np.ndarray:
    within = reach[reach["minutes"] <= limit]
    out = np.zeros(n, dtype="int32")
    counted = within.groupby("cell").size()
    out[counted.index.to_numpy()] = counted.to_numpy()
    return out


# ---------------------------------------------------------------------------
# Choices: which schools count


def eligible(schools: pd.DataFrame, service: str, choice: str, student: str | None = None) -> pd.Series:
    """Whether each school counts for `service` under a choice.

    all     every school in the directory that teaches the service's years
    state   state schools taught in English (not integrated, private, charter,
            or a school where all students are taught in te reo Māori or a
            Pacific language). A school whose teaching language the directory
            does not give is left out, and counted as such.
    `student` 'girls' or 'boys' keeps the schools that take them.
    """
    serves = schools["services"].str.split(",").apply(lambda s: service in s)
    keep = serves.copy()
    if choice == "state":
        keep &= (schools["kind"] == "state") & (schools["medium"] == "english")
    elif choice != "all":
        raise ValueError(f"unknown choice {choice!r}")
    if student:
        keep &= schools[f"sex_{service}"].apply(lambda s: takes(s, student))
    return keep


def counting_line(schools: pd.DataFrame, service: str) -> dict:
    """The counts behind the 'Counting ...' line, for one service."""
    serves = schools[schools["services"].str.split(",").apply(lambda s: service in s)]
    state_english = serves[(serves["kind"] == "state") & (serves["medium"] == "english")]
    sex = serves[f"sex_{service}"]
    return {
        "all": int(len(serves)),
        "state": int(len(state_english)),
        "kind": {k: int((serves["kind"] == k).sum()) for k in KIND_ORDER},
        # State schools left out of State for their teaching language.
        "state_maori": int(((serves["kind"] == "state") & (serves["language"] == "maori")).sum()),
        "state_pacific": int(((serves["kind"] == "state") & (serves["language"] == "pacific")).sum()),
        "state_language_unknown": int(((serves["kind"] == "state") & serves["medium"].isna()).sum()),
        # State schools taken as Māori-medium from their peak body, the
        # directory giving no teaching language (teaching_language).
        "state_maori_peak_body": sorted(serves.loc[(serves["kind"] == "state") & (serves.get("language_source") == "peak_body"), "name"].tolist())
        if "language_source" in serves else [],
        "sex": {s: int((sex == s).sum()) for s in SEXES},
        "sex_unknown": int(sex.isna().sum()),
        "state_sex": {s: int((state_english[f"sex_{service}"] == s).sum()) for s in SEXES},
        "scheme": int(serves["scheme"].sum()),
        "state_scheme": int(state_english["scheme"].sum()),
    }


def choice_times(reach: pd.DataFrame, keep: set[str], n: int) -> tuple[np.ndarray, np.ndarray]:
    """Minutes to the nearest counted school, and which one, per cell."""
    frame = reach[reach["destination"].isin(keep)]
    minutes, nearest, _ = nearest_schools(frame, n)
    return minutes, nearest


# ---------------------------------------------------------------------------
# Zones (from the Ministry's enrolment scheme file, when it is in)


ZONE_YEARS_RE = re.compile(r"\(Years?\s*(\d+)\s*-\s*(\d+)\)", re.I)


def service_years(level: str | None) -> tuple[int, int]:
    return {"primary": (1, 6), "intermediate": (7, 8), "secondary": (9, 13)}.get(level or "", (1, 13))


def zone_years(name: str) -> tuple[int, int] | None:
    """Year levels a zone is for, from its name ('... (Year 7-8)'); None for all."""
    found = ZONE_YEARS_RE.search(str(name or ""))
    return (int(found.group(1)), int(found.group(2))) if found else None


def _column(frame: pd.DataFrame, *names: str) -> str | None:
    lower = {c.lower(): c for c in frame.columns}
    for name in names:
        if name.lower() in lower:
            return lower[name.lower()]
    return None


def read_zones(path: Path, snapshot: dt.date) -> tuple[pd.DataFrame, pd.DataFrame]:
    """The Ministry's enrolment zones, as (in effect, not yet in effect).

    Reads any file GDAL reads (the Ministry ships MapInfo TAB in a zip; give
    the .TAB or the zip with 'zip://'). Columns kept: moe, name, approved,
    effective, years_from, years_to, geometry (NZTM). A zone is in effect on
    the snapshot date when its effective date is on or before it.
    """
    import geopandas as gpd

    zones = gpd.read_file(path)
    if zones.crs is None:
        raise SystemExit(f"{path} has no projection; check the .prj or .tab before using it.")
    zones = zones.to_crs("EPSG:2193")
    sid = _column(zones, "School_ID", "SchoolID", "Inst_ID", "Institution_Number", "School_Number")
    name = _column(zones, "School_name", "SchoolName", "Name", "Institution_Name")
    approved = _column(zones, "Approval_date", "ApprovalDate", "Approved")
    effective = _column(zones, "Effective_date", "EffectiveDate", "Effective")
    if not sid or not effective:
        raise SystemExit(f"{path}: no school number or effective date column in {list(zones.columns)}")
    out = gpd.GeoDataFrame({
        "moe": pd.to_numeric(zones[sid], errors="coerce").astype("Int64"),
        "name": zones[name] if name else "",
        "approved": pd.to_datetime(zones[approved], errors="coerce").dt.date if approved else None,
        "effective": pd.to_datetime(zones[effective], errors="coerce").dt.date,
    }, geometry=zones.geometry.make_valid(), crs="EPSG:2193")
    years = out["name"].apply(zone_years)
    out["years_from"] = [y[0] if y else None for y in years]
    out["years_to"] = [y[1] if y else None for y in years]
    current = out["effective"].apply(lambda d: d is not None and pd.notna(d) and d <= snapshot)
    return out[current].reset_index(drop=True), out[~current].reset_index(drop=True)


def zone_cover(zones, cells: pd.Index, half: float = 0.5) -> pd.DataFrame:
    """Share of each hexagon each zone covers: rows of zone index, cell
    position and share, for shares above zero. A hexagon is in a zone when the
    share is at least `half`; a share between 0 and 1 means the line cuts it."""
    import geopandas as gpd
    import h3
    from shapely.geometry import Polygon

    hexes = gpd.GeoDataFrame(
        {"cell": np.arange(len(cells))},
        geometry=[Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells],
        crs="EPSG:4326",
    ).to_crs("EPSG:2193")
    hexes["area"] = hexes.geometry.area
    joined = gpd.overlay(hexes, zones.reset_index(names="zone")[["zone", "geometry"]], how="intersection", keep_geom_type=True)
    joined["share"] = joined.geometry.area / joined["area"]
    out = joined.groupby(["zone", "cell"], as_index=False)["share"].sum()
    out["share"] = out["share"].clip(upper=1.0)
    out["inside"] = out["share"] >= half
    out["cut"] = out["share"] < 1.0 - 1e-6
    return out[out["share"] > 1e-9].reset_index(drop=True)


def in_zone_sets(schools: pd.DataFrame, zones, cover: pd.DataFrame, service: str, n: int,
                 student: str | None = None) -> tuple[list[set[str]], np.ndarray, list[str]]:
    """Schools a student living in each cell can enrol at, for one service.

    State English-medium schools whose zone covers at least half the cell,
    plus state English-medium schools with no enrolment scheme (which must
    take any student who applies). Year-level zones count only for the
    service whose years they cover. Returns the sets, a flag for cells a
    counted zone's line crosses, and the zoned schools with no zone in the file.
    """
    level = None
    for prefix, lvl in SERVICE_LEVELS.items():
        if service == prefix:
            level = lvl
    lo, hi = service_years(level)
    keep = eligible(schools, service, "state", student)
    counted = schools[keep]
    open_to_all = set(counted.loc[~counted["scheme"], "school"])
    zoned = counted[counted["scheme"]]
    by_moe = {int(m): s for m, s in zip(zoned["moe"], zoned["school"])}
    applies = []
    for z, row in zones.reset_index(drop=True).iterrows():
        school = by_moe.get(int(row["moe"])) if pd.notna(row["moe"]) else None
        if school is None:
            continue
        if row["years_from"] is not None and pd.notna(row["years_from"]):
            if row["years_to"] < lo or row["years_from"] > hi:
                continue
        applies.append((z, school))
    sets = [set(open_to_all) for _ in range(n)]
    cut = np.zeros(n, dtype=bool)
    with_zone = set()
    if applies:
        zone_school = dict(applies)
        rows = cover[cover["zone"].isin(zone_school)]
        for zone, cell, inside, crosses in zip(rows["zone"], rows["cell"], rows["inside"], rows["cut"]):
            school = zone_school[int(zone)]
            with_zone.add(school)
            if inside:
                sets[int(cell)].add(school)
            if crosses:
                cut[int(cell)] = True
    missing = sorted(set(zoned["school"]) - {s for _, s in applies})
    return sets, cut, missing


# ---------------------------------------------------------------------------
# Moving an existing build to separate school runs


def split(settings: Settings) -> dict:
    """Take the schools out of an existing build's services.parquet and mark
    the services runs that stay valid without them.

    A services run is adopted only when its recorded membership equals the
    old table it was routed against, so a stale run is never passed off as
    current. The old table is kept as services_with_schools.parquet.
    """
    import shutil

    from .routing import _departure, members_digest, plan, run_tag, service_windows  # noqa: F401

    folder = settings.output_dir / "destinations"
    path = folder / "services.parquet"
    backup = folder / "services_with_schools.parquet"
    ids = school_service_ids(settings)
    if not backup.exists():
        shutil.copy2(path, backup)
    old = pd.read_parquet(backup)
    new = old[~old["service"].isin(ids)].reset_index(drop=True)
    new.to_parquet(path, index=False)
    report = {"rows_before": int(len(old)), "rows_after": int(len(new)), "adopted": [], "not_adopted": []}
    for dataset, mode_id, window in plan(settings):
        if dataset != "services":
            continue
        tag = run_tag(dataset, mode_id, window, window is not None)
        manifest = settings.output_dir / "routing" / f"{tag}.json"
        if not manifest.exists():
            continue
        record = json.loads(manifest.read_text())
        if window is not None:
            wanted = [sid for sid, spec in settings.services.items() if window in service_windows(spec)]
            before, after = old[old["service"].isin(wanted)], new[new["service"].isin(wanted)]
        else:
            before, after = old, new
        if record.get("members") == members_digest(before):
            record["members_without_schools"] = members_digest(after)
            manifest.write_text(json.dumps(record, indent=2, default=str))
            report["adopted"].append(tag)
        else:
            report["not_adopted"].append(tag)
    return report


# ---------------------------------------------------------------------------
# What the site is told about the data


def data_dates(settings: Settings) -> dict:
    """Dates of the inputs behind a school figure, read from the files."""
    import zipfile

    out: dict = {}
    source = settings.data("schools")
    meta = snapshot_meta(source)
    out["directory"] = (meta.get("retrieved") or "")[:10] or None
    try:
        with zipfile.ZipFile(settings.data("gtfs")) as feed:
            info = feed.getinfo("feed_info.txt") if "feed_info.txt" in feed.namelist() else feed.infolist()[0]
            out["timetable_written"] = dt.date(*info.date_time[:3]).isoformat()
            if "feed_info.txt" in feed.namelist():
                rows = list(csv.DictReader(feed.read("feed_info.txt").decode("utf-8-sig").splitlines()))
                if rows and rows[0].get("feed_start_date"):
                    start, end = rows[0]["feed_start_date"], rows[0].get("feed_end_date", "")
                    out["timetable_from"] = f"{start[:4]}-{start[4:6]}-{start[6:]}"
                    out["timetable_to"] = f"{end[:4]}-{end[4:6]}-{end[6:]}" if end else None
    except (OSError, KeyError, zipfile.BadZipFile, IndexError):
        pass
    osm_meta = Path(str(settings.data("osm")) + ".metadata.json")
    national = settings.data_root / "raw" / "supporting" / "new-zealand-latest.osm.pbf.metadata.json"
    for candidate in (osm_meta, national):
        if candidate.exists():
            record = json.loads(candidate.read_text(encoding="utf-8"))
            if record.get("source") and Path(record["source"]).name == "new-zealand-latest.osm.pbf" and national.exists():
                record = json.loads(national.read_text(encoding="utf-8"))
            out["osm_downloaded"] = str(record.get("downloaded_at_utc") or "")[:10] or None
            break
    out["routing_date"] = str(settings.routing["date"])
    return out


def _summary(settings: Settings) -> dict:
    path = settings.output_dir / "destinations" / "schools_summary.json"
    return json.loads(path.read_text()) if path.exists() else {}


def points_meta(settings: Settings, schools: pd.DataFrame) -> dict:
    """What the map point check found (school_points.py): how many points were
    checked, which rule D5-1 moved, and how many are listed for a person."""
    from . import school_points

    moved = schools[schools["point"] == "corrected"] if "point" in schools else schools.iloc[:0]
    out = {
        "rule": school_points.RULE_TEXT,
        "moved": [{"moe": int(r["moe"]), "name": r["name"], "metres": float(r.get("point_moved_m") or 0.0),
                   "source": r.get("point_source")} for r in moved.to_dict("records")],
        "audited": None,
        "to_check": None,
    }
    path = settings.output_dir / "destinations" / "school_points_audit.csv"
    if path.exists():
        audited = pd.read_csv(path)
        out["audited"] = int(len(audited))
        out["to_check"] = int((audited["flags"].notna() & ~audited["move"].astype(bool)).sum())
    return out


def meta_block(settings: Settings, schools: pd.DataFrame, zones_in: bool = False) -> dict:
    """The schools part of summary.json's meta."""
    spec = settings.raw.get("schools") or {}
    source = settings.data("schools")
    meta = snapshot_meta(source)
    services = {s: counting_line(schools, s) for s in school_service_ids(settings)}
    return {
        "directory": {
            "file": source.name,
            "retrieved": meta.get("retrieved"),
            "source_modified": meta.get("resource_last_modified"),
            "sha256": meta.get("sha256"),
            # Schools come from any region inside the place's routing area.
            "regional_councils": ({str(k): int(v) for k, v in schools["region"].fillna("not given").value_counts().sort_index().items()}
                                  if "region" in schools else {}),
            "routing_area": routing_area(settings),
            "street_reach_m": STREET_REACH_M,
            "far_from_streets": _summary(settings).get("far_from_streets", []),
            "roll_dates": schools["roll_date"].fillna("none").value_counts().to_dict(),
        },
        "points": points_meta(settings, schools),
        "dates": data_dates(settings),
        "services": services,
        "choices": ["all", "state", "one"] + (["zone"] if zones_in else []),
        "zones": None,
        "routed_to": {
            "point": int(((schools["entrances"] == 0) & (schools["point"] == "directory")).sum()),
            "corrected": int(((schools["entrances"] == 0) & (schools["point"] == "corrected")).sum()),
            "entrances": int((schools["entrances"] > 0).sum()),
        },
        "buses": spec.get("buses"),
        "bus_note": spec.get("bus_note"),
        "minutes": "R5 gives whole minutes, rounded down: 30 min means under 31.",
        "spread": "pt only: 10th and 90th percentiles over every departure minute in the window of the quicker of "
                  "the trip leaving then and walking.",
        "pt_or_walk": "Public transport lists hold the quicker of R5's trip and walking for each school; r5 gives R5's "
                      "own minutes where they are slower or missing.",
    }


# ---------------------------------------------------------------------------
# The choices, worked out from the published files the way the site must.
# tests/fixtures/schools/golden_<place>.json is written from this, and the
# site's engine is tested against it.

STUDENTS = ("both", "girls", "boys")
GOLDEN_MODES = ("walk", "bike_low_stress", "bike", "pt", "car")


def published_counts(dests: list[dict], service: str, choice: str, student: str | None) -> set[int]:
    """Destination indices a choice counts, from destinations.json entries.

    all: every school serving the service. state: kind 'state' and medium
    'english'. A student ('girls' or 'boys') keeps the schools whose sex for
    the service is co-ed or theirs. 'one:<moe>' is that school alone.
    """
    out = set()
    for i, d in enumerate(dests):
        if service not in d.get("services", []) or "moe" not in d:
            continue
        if choice.startswith("one:"):
            if d["moe"] == int(choice.split(":")[1]):
                out.add(i)
            continue
        if choice == "state" and not (d.get("kind") == "state" and d.get("medium") == "english"):
            continue
        if student in ("girls", "boys") and not takes((d.get("sex") or {}).get(service), student):
            continue
        out.add(i)
    return out


def published_times(reach: dict, keep: set[int]) -> tuple[np.ndarray, np.ndarray]:
    """Minutes to the first counted school in each cell's reach list (NaN
    where none), and its destination index (-1)."""
    offsets = np.asarray(reach["o"], dtype="int64")
    dest = np.asarray(reach["d"], dtype="int64")
    minutes = np.asarray(reach["m"], dtype="float64")
    n = len(offsets) - 1
    counted = np.isin(dest, np.fromiter(keep, dtype="int64", count=len(keep))) if keep else np.zeros(len(dest), dtype=bool)
    cell = np.repeat(np.arange(n), np.diff(offsets))
    out_t = np.full(n, np.nan)
    out_d = np.full(n, -1, dtype="int64")
    hits = np.flatnonzero(counted)
    if len(hits):
        first = hits[np.unique(cell[hits], return_index=True)[1]]
        out_t[cell[first]] = minutes[first]
        out_d[cell[first]] = dest[first]
    return out_t, out_d


def choice_times(reaches: dict[str, dict], dests: list[dict], service: str, choice: str,
                 student: str | None, standard_modes: list[str]) -> dict[str, np.ndarray]:
    """Minutes by mode, and 'best', for one choice.

    For girls and boys together (student 'both'), a mode's time is the slower
    of the girls' and the boys' times by that mode, and the best time is the
    slower of the girls' best and the boys' best: each student takes their
    own quickest way, and the hexagon counts only if both get there in time.
    """
    if choice in ("state", "zone") and student in (None, "both"):
        girls = choice_times(reaches, dests, service, choice, "girls", standard_modes)
        boys = choice_times(reaches, dests, service, choice, "boys", standard_modes)
        return {m: np.fmax(girls[m], boys[m]) + np.where(np.isnan(girls[m]) | np.isnan(boys[m]), np.nan, 0.0) for m in girls}
    keep = published_counts(dests, service, choice, student)
    out = {}
    for mode, reach in reaches.items():
        out[mode], _ = published_times(reach, keep)
    stack = np.vstack([out[m] for m in standard_modes if m in out])
    out["best"] = np.where(np.isnan(stack).all(axis=0), np.nan, np.nanmin(np.where(np.isnan(stack), np.inf, stack), axis=0))
    out["best"] = np.where(np.isinf(out["best"]), np.nan, out["best"])
    return out


def choice_named(reaches: dict[str, dict], dests: list[dict], service: str, choice: str,
                 student: str | None, cell: int) -> dict[str, list[int]]:
    """The schools named for one cell under a choice, by mode: the first
    counted school in the cell's reach list and every counted school tied
    with it, in the list's order (minutes, metres, MoE number), as MoE
    numbers. For girls and boys together, the slower one's schools; both
    sets, in list order, when their times are equal."""
    def one(student_: str | None) -> dict[str, tuple[float, list[int]]]:
        keep = published_counts(dests, service, choice, student_)
        out = {}
        for mode, reach in reaches.items():
            lo, hi = reach["o"][cell], reach["o"][cell + 1]
            best, ids = None, []
            for k in range(lo, hi):
                d, m = reach["d"][k], reach["m"][k]
                if m is None or d not in keep:
                    continue
                if best is None:
                    best = m
                if m != best:
                    break
                ids.append(k)
            out[mode] = (np.nan if best is None else float(best), ids)
        return out

    def moe(reach: dict, positions: list[int]) -> list[int]:
        return [dests[reach["d"][k]]["moe"] for k in sorted(set(positions))]

    if choice in ("state", "zone") and student in (None, "both"):
        girls, boys = one("girls"), one("boys")
        out = {}
        for mode, reach in reaches.items():
            (g, gk), (b, bk) = girls[mode], boys[mode]
            if np.isnan(g) or np.isnan(b):
                out[mode] = []
            else:
                out[mode] = moe(reach, gk if g > b else bk if b > g else gk + bk)
        return out
    return {mode: moe(reaches[mode], ks) for mode, (_, ks) in one(student).items()}


def share_within(minutes: np.ndarray, weights: np.ndarray, limit: float) -> tuple[float, float]:
    """Share of the weight within `limit` minutes, and the weight counted (as weightedShare in the site)."""
    weights = np.asarray(weights, dtype="float64")
    use = weights > 0
    total = float(weights[use].sum())
    hit = float(weights[use & np.isfinite(minutes) & (minutes <= limit)].sum())
    return (hit / total if total > 0 else float("nan")), total


# Modes whose reach lists keep only the nearest school under each choice, to
# keep the files small: by car nearly every school is within 60 minutes, and
# car times never count towards a standard.
SHORT_LIST_MODES = ("car",)


def short_list(reach: pd.DataFrame, listed: pd.DataFrame, service: str) -> pd.DataFrame:
    """The first school in each cell's list for All, State, State girls and
    State boys (and every school tied with it), in the same order. Exact for
    those choices; One school is not available from it."""
    about = listed.set_index("school")
    groups = {
        "all": pd.Series(True, index=about.index),
        "state": (about["kind"] == "state") & (about["medium"] == "english"),
    }
    for student in ("girls", "boys"):
        groups[f"state_{student}"] = groups["state"] & about[f"sex_{service}"].apply(lambda s: takes(s, student))
    keep = np.zeros(len(reach), dtype=bool)
    for mask in groups.values():
        member = reach["destination"].map(mask).fillna(False).to_numpy(dtype=bool)
        rows = reach[member]
        if rows.empty:
            continue
        best = rows.groupby("cell")["minutes"].transform("min")
        keep[np.flatnonzero(member)[(rows["minutes"] == best).to_numpy()]] = True
    return reach[keep]
