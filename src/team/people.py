"""Who lives in each cell: deprivation, age, cars, income and how people commute.

Census 2023 tables are published for SA1 blocks. Each hexagon takes the values
of the block its centre falls in, or the nearest block within 500 m for cells
on the coast. Shares describe the block, so they are a property of the area
around a cell rather than of the cell alone. Local boards come from Auckland
Council's boundaries, assigned the same way.
"""

from __future__ import annotations

import json
import logging

import pandas as pd

from .config import Settings

log = logging.getLogger("team.people")

# Stats NZ rounds every cell to base 3 on its own, including totals, so adding
# five-year bands up does not reproduce the published bracket: summing the six
# bands for 65 and over matches the published cell in about two SA1s in five,
# and can be out by as much as eighteen people. Where Stats NZ publishes the
# bracket as its own cell, take that cell.
CHILDREN = "VAR_1_80"       # under 15
OLDER = "VAR_1_83"          # 65 and over
AGE_TOTAL = "VAR_1_3"       # usual resident population, never suppressed
UNDER_5 = "VAR_1_49"
AGE_15_19 = "VAR_1_52"      # every public transport fare bracket edge falls inside this band
AGE_20_24 = "VAR_1_53"

# Ethnicity is a multiple response: a person counted as Maori may also be
# counted as European, so these shares do not add to one and the groups
# overlap. The denominator is the published total stated, not a sum of parts.
ETHNICITY = {
    "european_share": "VAR_1_158",
    "maori_share": "VAR_1_159",
    "pacific_share": "VAR_1_160",
    "asian_share": "VAR_1_161",
}
ETHNICITY_TOTAL = "VAR_1_168"
DISABLED = "VAR_1_435"
DISABLED_TOTAL = "VAR_1_438"
LOW_INCOME = ["VAR_4_214", "VAR_4_215", "VAR_4_216", "VAR_4_217"]  # household income $70,000 or less
INCOME_TOTAL = "VAR_4_224"
MEDIAN_INCOME = "VAR_4_225"
HOUSEHOLD_SIZE = "VAR_4_117"   # mean usual residents per household, 2023
NO_VEHICLE = "VAR_4_136"
VEHICLE_TOTAL = "VAR_4_144"

BLOCK_FIELDS = ["SA12023_code", "SA22023_code", "SA22023_name", "UR2023_name", "NZDep2023", "NZDep2023_Score"]
LOCAL_BOARD_FIELD = "LocalBoardName"
COAST_METRES = 500


def _records(path) -> pd.DataFrame:
    raw = json.loads(path.read_text(encoding="utf-8"))
    records = raw.get("records") or [feature.get("attributes", {}) for feature in raw.get("features", [])]
    table = pd.DataFrame(records)
    code = "SA12023_V1_00" if "SA12023_V1_00" in table.columns else "SA12023_code"
    table["sa1"] = table[code].astype(str).str.replace(r"\.0$", "", regex=True)
    return table


def _count(series: pd.Series) -> pd.Series:
    """Census counts; negative codes mark suppressed or not-stated values."""
    values = pd.to_numeric(series, errors="coerce")
    return values.mask(values < 0)


def _share(part: pd.Series, total: pd.Series) -> pd.Series:
    return (part / total.where(total > 0)).clip(0.0, 1.0)


def age_shares(settings: Settings) -> pd.DataFrame:
    """Age and group shares of the people living in each census block.

    Reads the equity table when it is configured, and falls back to the older
    age-only table so a data root without it still builds.
    """
    key = "census_equity" if "census_equity" in settings.raw["data"] else "census_age"
    table = _records(settings.data(key))
    if CHILDREN not in table.columns:
        # The older extract has the five-year bands only.
        total = _count(table["VAR_1_68"])
        children = sum(_count(table[c]).fillna(0) for c in ("VAR_1_49", "VAR_1_50", "VAR_1_51"))
        older = sum(_count(table[c]).fillna(0) for c in [f"VAR_1_{n}" for n in range(62, 68)])
        return pd.DataFrame({"sa1": table["sa1"], "children_share": _share(children, total), "older_share": _share(older, total)})

    total = _count(table[AGE_TOTAL])
    out = {
        "sa1": table["sa1"],
        "children_share": _share(_count(table[CHILDREN]), total),
        "older_share": _share(_count(table[OLDER]), total),
        "under5_share": _share(_count(table[UNDER_5]), total),
        # 5 to 15 spans a published bracket and part of the 15 to 19 band. A
        # fare bracket cannot be cut exactly from five-year bands, so the
        # band is split evenly by single year of age and the result is
        # labelled apportioned wherever it is reported.
        "youth_share": _share(_count(table[CHILDREN]) - _count(table[UNDER_5]) + 0.2 * _count(table[AGE_15_19]), total),
        "student_age_share": _share(0.8 * _count(table[AGE_15_19]) + _count(table[AGE_20_24]), total),
    }
    stated = _count(table[ETHNICITY_TOTAL])
    for name, column in ETHNICITY.items():
        if column in table.columns:
            out[name] = _share(_count(table[column]), stated)
    if DISABLED in table.columns:
        out["disabled_share"] = _share(_count(table[DISABLED]), _count(table[DISABLED_TOTAL]))
    return pd.DataFrame(out)


def _household_size_path(settings: Settings):
    """The household size table: configured, or beside the household table."""
    if "census_household_size" in settings.raw["data"]:
        return settings.data("census_household_size")
    return settings.data("census_households").with_name("statsnz_census_household_size_sa1_2023.json")


def household_shares(settings: Settings) -> pd.DataFrame:
    from .affordability import equivalised

    table = _records(settings.data("census_households"))
    out = pd.DataFrame(
        {
            "sa1": table["sa1"],
            "no_vehicle_share": _share(_count(table[NO_VEHICLE]), _count(table[VEHICLE_TOTAL])),
            "low_income_share": _share(sum(_count(table[c]).fillna(0) for c in LOW_INCOME), _count(table[INCOME_TOTAL])),
            "median_income": _count(table[MEDIAN_INCOME]),
        }
    )
    # Household size puts income on a per-person footing for the fare burden.
    # A build without the table still runs; it just has no burden to show.
    path = _household_size_path(settings)
    if path.exists():
        sizes = _records(path)
        sizes = pd.DataFrame({"sa1": sizes["sa1"], "household_size": _count(sizes[HOUSEHOLD_SIZE])})
        out = out.merge(sizes, on="sa1", how="left")
        out["income_equivalised"] = equivalised(out["median_income"], out["household_size"])
    return out


URBAN_MINIMUM = 1000  # Stats NZ's line between an urban area and a rural settlement
RURAL_NAME = r"^(?:Other rural|Rural other|Inland water|Oceanic)"


def urban_flag(table: pd.DataFrame) -> pd.Series:
    """Whether each hexagon is in an urban area of 1,000 people or more.

    Stats NZ's urban rural classification names rural land "Other rural ...",
    and counts a named place of fewer than 1,000 residents as a rural
    settlement. Population is summed from the hexagons in this build, which
    for the council-area builds covers each urban area whole.
    """
    names = table["urban_rural"].astype("string")
    size = table.groupby(names)["population"].transform("sum")
    rural = names.str.contains(RURAL_NAME, regex=True, na=True)
    return (~rural & (size >= URBAN_MINIMUM)).fillna(False).astype(bool)


# A census block is taken to be a rest home or retirement village when far more
# of its residents are 65 or over than ageing in place produces, or when it
# holds a registered aged care facility large enough to shape the block.
# Nationally about 17% of people are 65 or over.
VILLAGE_SHARE = 0.6
CARE_HOME_SHARE = 0.3


def _age_counts(settings: Settings) -> pd.DataFrame:
    """Residents and residents aged 65 and over in each census block."""
    key = "census_equity" if "census_equity" in settings.raw["data"] else "census_age"
    table = _records(settings.data(key))
    if OLDER in table.columns:
        total, older = _count(table[AGE_TOTAL]), _count(table[OLDER])
    else:
        total = _count(table["VAR_1_68"])
        older = sum(_count(table[c]).fillna(0) for c in [f"VAR_1_{n}" for n in range(62, 68)])
    return pd.DataFrame({"sa1": table["sa1"], "residents": total, "older": older})


def _care_blocks(settings: Settings, blocks) -> set[str]:
    """Census blocks holding an aged care facility on Health New Zealand's register."""
    import geopandas as gpd

    if "health_facilities" not in settings.raw["data"]:
        return set()
    path = settings.data("health_facilities")
    if not path.exists():
        return set()
    register = pd.read_excel(path)
    register = register[register["Fac Type"].astype(str).str.strip() == "agedcare"].dropna(subset=["NZGD2K X", "NZGD2K Y"])
    points = gpd.GeoDataFrame(geometry=gpd.points_from_xy(register["NZGD2K X"], register["NZGD2K Y"]), crs="EPSG:4326")
    held = gpd.sjoin(points.to_crs(blocks.crs), blocks[["sa1", "geometry"]], predicate="within")
    return set(held["sa1"])


def villages(settings: Settings, cells: pd.DataFrame) -> pd.DataFrame:
    """Residents of rest homes and retirement villages in each hexagon.

    Their residents are counted by the census where they live, so a suburb with
    a rest home can look like one where older people have aged in place. The
    web page leaves them out to find naturally occurring retirement
    communities.

    A block is a rest home or village when at least 60% of its residents are 65
    or over, or when it holds an aged care facility on Health New Zealand's
    register and at least 30% are. Each hexagon touching such a block is split
    by area: the residents and 65+ living in village blocks, and the 65+ living
    in the rest of the hexagon, both scaled to the hexagon's population.
    Returned for those hexagons only.
    """
    import geopandas as gpd
    import h3
    from shapely.geometry import Polygon

    columns = ["village_pop", "village_older", "home_older"]
    empty = pd.DataFrame(columns=columns, dtype="float32")
    blocks = gpd.read_file(settings.data("census_sa1"))
    blocks["sa1"] = blocks["SA12023_code"].astype(str).str.replace(r"\.0$", "", regex=True)
    blocks = blocks[["sa1", "geometry"]].to_crs("EPSG:2193").merge(_age_counts(settings), on="sa1", how="left")
    blocks = blocks[blocks["residents"] > 0]
    share = blocks["older"] / blocks["residents"]
    care = blocks["sa1"].isin(_care_blocks(settings, blocks))
    blocks["village"] = (share >= VILLAGE_SHARE) | (care & (share >= CARE_HOME_SHARE))
    if not blocks["village"].any():
        return empty
    blocks["block_area"] = blocks.geometry.area

    ids = [str(c) for c in cells.index]
    hexes = gpd.GeoDataFrame(
        {"h3": ids},
        geometry=[Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in ids],
        crs="EPSG:4326",
    ).to_crs("EPSG:2193")
    touched = gpd.sjoin(hexes, blocks[blocks["village"]][["geometry"]], predicate="intersects")["h3"].unique()
    if not len(touched):
        return empty
    parts = gpd.overlay(hexes[hexes["h3"].isin(touched)], blocks, how="intersection", keep_geom_type=True)
    fraction = parts.geometry.area / parts["block_area"]
    parts["pop"] = parts["residents"] * fraction
    parts["old"] = parts["older"].fillna(0) * fraction
    parts["v_pop"] = parts["pop"].where(parts["village"], 0.0)
    parts["v_old"] = parts["old"].where(parts["village"], 0.0)
    parts["h_old"] = parts["old"].where(~parts["village"], 0.0)
    sums = parts.groupby("h3")[["pop", "v_pop", "v_old", "h_old"]].sum()
    population = cells["population"].reindex(sums.index).astype(float)
    scale = (population / sums["pop"].where(sums["pop"] > 0)).fillna(0.0)
    out = pd.DataFrame({
        "village_pop": sums["v_pop"] * scale,
        "village_older": sums["v_old"] * scale,
        "home_older": sums["h_old"] * scale,
    })
    out = out[out["village_pop"] > 0]
    log.info("rest homes and villages: %d blocks, touching %d hexagons, about %.0f people aged 65+",
             int(blocks["village"].sum()), len(out), out["village_older"].sum())
    return out.astype("float32")


def assign_areas(points, areas, field: str, max_distance: float = COAST_METRES) -> pd.Series:
    """The `field` value of the area each point falls in, indexed by point id.

    Points outside every area, such as cells on the coast, take the nearest
    area within `max_distance` metres. Both frames need the same metric CRS.
    """
    import geopandas as gpd

    areas = areas[[field, "geometry"]]
    inside = gpd.sjoin(points[["id", "geometry"]], areas, how="left", predicate="within").drop_duplicates("id")
    values = inside.set_index("id")[field]
    missing = values.index[values.isna()]
    if len(missing):
        near = gpd.sjoin_nearest(points[points["id"].isin(missing)][["id", "geometry"]], areas, max_distance=max_distance)
        values.update(near.drop_duplicates("id").set_index("id")[field])
    return values.reindex(points["id"])


def local_boards(settings: Settings, points) -> pd.Series:
    """Local board of each point, or missing when no boundaries are configured."""
    import geopandas as gpd

    path = settings.data("local_boards") if "local_boards" in settings.raw["data"] else None
    if path is None or not path.exists():
        log.warning("no local board boundaries found; local board summaries will be skipped")
        return pd.Series(pd.NA, index=points["id"], dtype="string")
    boards = gpd.read_file(path).to_crs(points.crs)
    return assign_areas(points, boards, LOCAL_BOARD_FIELD).astype("string")


def named_areas(settings: Settings, points, key: str, field: str, code: str | None = None) -> pd.Series:
    """Council or ward of each point, from a national boundary file, or missing
    when none is configured. Ward names drop "General" (Wellington's
    "Takapū/Northern General Ward" is shown as "Takapū/Northern Ward"). With
    `code`, each value is "code|name"."""
    import geopandas as gpd
    from shapely.geometry import box

    path = settings.data(key) if key in settings.raw["data"] else None
    if path is None or not path.exists():
        return pd.Series(pd.NA, index=points["id"], dtype="string")
    areas = gpd.read_file(path).to_crs(points.crs)
    areas = areas[areas.intersects(box(*points.total_bounds))].copy()
    names = areas[field].str.replace(r" General Ward$", " Ward", regex=True)
    areas["_value"] = areas[code].astype(str) + "|" + names if code else names
    return assign_areas(points, areas, "_value").astype("string")


def councils_and_wards(settings: Settings, points) -> pd.DataFrame:
    """Council and ward of each point. A ward belongs to one council (its code
    starts with the council's), so a point near the edge of a council elected
    at large, such as Upper Hutt, is not given a neighbour's ward."""
    council = named_areas(settings, points, "councils", "TA_name", code="TA_code")
    ward = named_areas(settings, points, "wards", "Ward_name", code="Ward_code")
    council_code = council.str.split("|").str[0]
    ward_code = ward.str.split("|").str[0]
    own = ward_code.str[:3] == council_code
    return pd.DataFrame({
        "council": council.str.split("|", n=1).str[1],
        "ward": ward.str.split("|", n=1).str[1].where(own.fillna(False)),
    }, index=council.index)


def build(settings: Settings, origins) -> pd.DataFrame:
    import geopandas as gpd

    blocks = gpd.read_file(settings.data("census_sa1"))
    fields = [c for c in BLOCK_FIELDS if c in blocks.columns]
    blocks = blocks[fields + ["geometry"]].to_crs("EPSG:2193")
    points = origins[["id", "geometry"]].to_crs("EPSG:2193")

    joined = gpd.sjoin(points, blocks, how="left", predicate="within").drop_duplicates("id")
    outside = joined["SA12023_code"].isna()
    if outside.any():
        nearest = gpd.sjoin_nearest(points[points["id"].isin(joined.loc[outside, "id"])], blocks, max_distance=COAST_METRES)
        joined = pd.concat([joined[~outside], nearest.drop_duplicates("id")], ignore_index=True)

    people = pd.DataFrame(
        {
            "h3": joined["id"].to_numpy(),
            "sa1": joined["SA12023_code"].astype("string").str.replace(r"\.0$", "", regex=True).to_numpy(),
            "sa2_code": joined.get("SA22023_code", pd.Series(dtype="string")).astype("string").to_numpy(),
            "sa2": joined.get("SA22023_name", pd.Series(dtype="string")).astype("string").to_numpy(),
            "urban_rural": joined.get("UR2023_name", pd.Series(dtype="string")).astype("string").to_numpy(),
            "nzdep": pd.to_numeric(joined.get("NZDep2023"), errors="coerce").to_numpy(),
        }
    )
    people["local_board"] = local_boards(settings, points).reindex(people["h3"]).to_numpy()
    areas = councils_and_wards(settings, points).reindex(people["h3"])
    people["council"] = areas["council"].to_numpy()
    people["ward"] = areas["ward"].to_numpy()
    # Two councils in one place can each have, say, a Central Ward.
    shared = people.groupby("ward")["council"].nunique()
    shared = set(shared[shared > 1].index)
    if shared:
        clash = people["ward"].isin(shared)
        people.loc[clash, "ward"] = people.loc[clash, "ward"] + " (" + people.loc[clash, "council"].fillna("") + ")"
    people = people.merge(age_shares(settings), on="sa1", how="left")
    people = people.merge(household_shares(settings), on="sa1", how="left")
    people["working_age_share"] = (1.0 - people["children_share"].fillna(0) - people["older_share"].fillna(0)).clip(0, 1)

    # Optional: a city without this file still builds, it just loses the
    # plausibility check against how people actually got to work.
    commute_path = settings.data("commute_share") if "commute_share" in settings.raw["data"] else None
    if commute_path is not None and commute_path.exists():
        commute = pd.read_csv(commute_path)
        code = next(c for c in commute.columns if c.lower() in ("sa2_code", "sa22023_code", "sa2"))
        share = next(c for c in commute.columns if c.lower() in ("commute_car_share", "car_share", "share"))
        commute = commute[[code, share]].rename(columns={code: "sa2_code", share: "commute_car_share"})
        commute["sa2_code"] = commute["sa2_code"].astype(str).str.replace(r"\.0$", "", regex=True)
        people["sa2_code"] = people["sa2_code"].astype(str)
        people = people.merge(commute, on="sa2_code", how="left")
    return people.set_index("h3")
