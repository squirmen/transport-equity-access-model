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

CHILDREN = ["VAR_1_49", "VAR_1_50", "VAR_1_51"]  # under 15
OLDER = ["VAR_1_62", "VAR_1_63", "VAR_1_64", "VAR_1_65", "VAR_1_66", "VAR_1_67"]  # 65 and over
AGE_TOTAL = "VAR_1_68"
LOW_INCOME = ["VAR_4_214", "VAR_4_215", "VAR_4_216", "VAR_4_217"]  # household income $70,000 or less
INCOME_TOTAL = "VAR_4_224"
MEDIAN_INCOME = "VAR_4_225"
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
    table = _records(settings.data("census_age"))
    total = _count(table[AGE_TOTAL])
    return pd.DataFrame(
        {
            "sa1": table["sa1"],
            "children_share": _share(sum(_count(table[c]).fillna(0) for c in CHILDREN), total),
            "older_share": _share(sum(_count(table[c]).fillna(0) for c in OLDER), total),
        }
    )


def household_shares(settings: Settings) -> pd.DataFrame:
    table = _records(settings.data("census_households"))
    return pd.DataFrame(
        {
            "sa1": table["sa1"],
            "no_vehicle_share": _share(_count(table[NO_VEHICLE]), _count(table[VEHICLE_TOTAL])),
            "low_income_share": _share(sum(_count(table[c]).fillna(0) for c in LOW_INCOME), _count(table[INCOME_TOTAL])),
            "median_income": _count(table[MEDIAN_INCOME]),
        }
    )


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
    people = people.merge(age_shares(settings), on="sa1", how="left")
    people = people.merge(household_shares(settings), on="sa1", how="left")
    people["working_age_share"] = (1.0 - people["children_share"].fillna(0) - people["older_share"].fillna(0)).clip(0, 1)

    commute_path = settings.data("commute_share")
    if commute_path.exists():
        commute = pd.read_csv(commute_path)
        code = next(c for c in commute.columns if c.lower() in ("sa2_code", "sa22023_code", "sa2"))
        share = next(c for c in commute.columns if c.lower() in ("commute_car_share", "car_share", "share"))
        commute = commute[[code, share]].rename(columns={code: "sa2_code", share: "commute_car_share"})
        commute["sa2_code"] = commute["sa2_code"].astype(str).str.replace(r"\.0$", "", regex=True)
        people["sa2_code"] = people["sa2_code"].astype(str)
        people = people.merge(commute, on="sa2_code", how="left")
    return people.set_index("h3")
