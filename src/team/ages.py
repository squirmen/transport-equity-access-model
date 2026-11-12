"""Children of school age in each hexagon, from 2023 Census age bands.

School and early childhood figures count the children of the ages each one
serves, not everyone. docs/schools.md ("Who is counted: school-age children")
sets out the rule; in short:

1. Each 2023 SA1 gives its usual residents and the five-year bands 0-4, 5-9,
   10-14 and 15-19 (Stats NZ, 2023 Census totals by topic for individuals by
   SA1). A suppressed band is the SA1's residents times its SA2's share in
   that band (2023 SA2 table), or the national share if that is suppressed
   too.
2. A band is split into single years by the 2018 Census shape of the SA2
   around the SA1 (`scripts/fetch_census_ages.py`), or nationally where that
   SA2 is small. The 2023 single years by SA2 (Aotearoa Data Explorer) need a
   key; given that table, the same code uses it.
3. Groups: 0_4 = B(0-4); 5_10 = B(5-9) + f10 B(10-14);
   11_12 = (f11 + f12) B(10-14); 13_17 = (f13 + f14) B(10-14) + (f15 + f16 + f17) B(15-19).
4. Each SA1's children are spread over hexagons as its residents are
   (`scripts/add_city.py build_grid`): water blocks dropped, each land block's
   people split by its area in each hexagon.

Ages are as at the census (7 March 2023). A child's school year is taken
from age, so 13-17 stands for Years 9-13. Census day is early in the school
year, so about a third of Year 7 and of Year 9 students are counted with the
age group below, and some 17-year-olds have left school.

13_14 (Years 9-10) is kept as well, for a secondary school that takes one
stage only; 15-17 (Years 11-13) is 13_17 less 13_14. The share of girls
among the children of each group comes from the 2018 Census single years by
sex in the place's 2018 SA2s (sex_shares), for girls' and boys' schools.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Settings

log = logging.getLogger("team.ages")

GROUPS = {"0_4": (0, 4), "5_10": (5, 10), "11_12": (11, 12), "13_17": (13, 17), "13_14": (13, 14)}
SERVICE_GROUP = {
    "early_childhood": "0_4",
    "primary_school": "5_10",
    "intermediate_school": "11_12",
    "secondary_school": "13_17",
}
LABELS = {
    "0_4": {"label": "children aged 0–4", "years": "before school", "ages": [0, 4]},
    "5_10": {"label": "children aged 5–10", "years": "Years 1–6", "ages": [5, 10]},
    "11_12": {"label": "children aged 11–12", "years": "Years 7–8", "ages": [11, 12]},
    "13_17": {"label": "children aged 13–17", "years": "Years 9–13", "ages": [13, 17]},
    "13_14": {"label": "children aged 13–14", "years": "Years 9–10", "ages": [13, 14]},
    # Not sent: the page takes 13_17 less 13_14.
    "15_17": {"label": "children aged 15–17", "years": "Years 11–13", "ages": [15, 17], "from": "13_17 less 13_14"},
}
COLUMNS = [f"age_{g}" for g in GROUPS]
RULE = ("2023 Census five-year age bands by SA1, split into single years by the 2018 Census shape of the "
        "surrounding SA2, spread onto hexagons as residents are. Age stands for school year: 5-10 for "
        "Years 1-6, 11-12 for Years 7-8, 13-17 for Years 9-13.")

RESIDENTS = "VAR_1_3"   # usual resident population, never suppressed
BANDS = {"b0_4": "VAR_1_49", "b5_9": "VAR_1_50", "b10_14": "VAR_1_51", "b15_19": "VAR_1_52"}
GRID_POPULATION = "C23_URPopTot"
SOURCES = [
    "Stats NZ, 2023 Census totals by topic for individuals by SA1 and by SA2 (five-year age bands), CC BY 4.0: "
    "https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/2023_Census_totals_by_topic_for_individuals_by_SA1/FeatureServer/1",
    "Stats NZ, 2018 Census age by single year by SA2 (Data8277), CC BY 4.0, for the shape inside each band: "
    "https://www3.stats.govt.nz/2018census/Age-sex-by-ethnic-group-grouped-total-responses-census-usually-resident-population-counts-2006-2013-2018-Censuses-RC-TA-SA2-DHB.zip",
    "Stats NZ, Statistical Area 2 2018 boundaries, CC BY 4.0: "
    "https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/2018_Census_usually_resident_population_and_age_groups_by_Statistical_Area_2/FeatureServer/0",
]
# Bands each group is built from, for the rounding allowance in sa2_check.
GROUP_BANDS = {"0_4": 1, "5_10": 2, "11_12": 1, "13_17": 2, "13_14": 1}


def _records(path: Path) -> pd.DataFrame:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = raw.get("records") or [f.get("attributes", {}) for f in raw.get("features", [])]
    return pd.DataFrame(rows)


def _code(values: pd.Series) -> pd.Series:
    return values.astype(str).str.replace(r"\.0$", "", regex=True)


def _count(values: pd.Series) -> pd.Series:
    """Census counts; a negative value is suppressed, not zero."""
    numbers = pd.to_numeric(values, errors="coerce")
    return numbers.mask(numbers < 0)


# ---------------------------------------------------------------------------
# Rule 1: bands per SA1, with suppressed bands filled


def fill_bands(sa1: pd.DataFrame, sa2: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Bands per SA1 with suppressed ones filled.

    `sa1`: sa1, sa2, residents, b0_4 ... b15_19 (NaN where suppressed).
    `sa2`: sa2, residents, b0_4 ... (NaN where suppressed).
    A suppressed band is residents x the SA2's share in it, or x the national
    share where the SA2's band is suppressed too. Returns the filled table and
    what was filled ({sa2: {cells, people}, national: {cells, people}}).
    """
    out = sa1.copy()
    by_sa2 = sa2.set_index("sa2")
    total = by_sa2["residents"].where(by_sa2["residents"] > 0)
    filled = {"sa2": {"cells": 0, "people": 0.0}, "national": {"cells": 0, "people": 0.0}}
    for band in BANDS:
        known = by_sa2[band].notna() & total.notna()
        national = float(by_sa2.loc[known, band].sum() / by_sa2.loc[known, "residents"].sum())
        share_sa2 = (by_sa2[band] / total).reindex(out["sa2"]).to_numpy()
        missing = out[band].isna().to_numpy()
        residents = out["residents"].fillna(0).to_numpy(dtype="float64")
        from_sa2 = missing & np.isfinite(share_sa2)
        from_nation = missing & ~np.isfinite(share_sa2)
        values = out[band].to_numpy(dtype="float64").copy()
        values[from_sa2] = residents[from_sa2] * share_sa2[from_sa2]
        values[from_nation] = residents[from_nation] * national
        out[band] = values
        for key, mask in (("sa2", from_sa2), ("national", from_nation)):
            filled[key]["cells"] += int((mask & (residents > 0)).sum())
            filled[key]["people"] += float(values[mask].sum())
    for key in filled:
        filled[key]["people"] = round(filled[key]["people"], 1)
    return out, filled


# ---------------------------------------------------------------------------
# Rules 2 and 3: single years and groups


def national_shape(meta: dict) -> dict[str, float]:
    """f10..f17 from the shape file's national fractions."""
    nat = meta.get("national", {})
    out = {f"f{a}": float(nat["10_14"][str(a)]) for a in range(10, 15)}
    out.update({f"f{a}": float(nat["15_19"][str(a)]) for a in range(15, 18)})
    return out


def groups(bands: pd.DataFrame) -> pd.DataFrame:
    """The four groups from bands and single-year shares (columns b*, f10..f17)."""
    b = {k: bands[k].fillna(0.0) for k in BANDS}
    f = {a: bands[f"f{a}"] for a in range(10, 18)}
    return pd.DataFrame({
        "0_4": b["b0_4"],
        "5_10": b["b5_9"] + f[10] * b["b10_14"],
        "11_12": (f[11] + f[12]) * b["b10_14"],
        "13_17": (f[13] + f[14]) * b["b10_14"] + (f[15] + f[16] + f[17]) * b["b15_19"],
        "13_14": (f[13] + f[14]) * b["b10_14"],
    }, index=bands.index)


def even_groups(bands: pd.DataFrame) -> pd.DataFrame:
    """The same groups with each band split evenly by year, for comparison."""
    b = {k: bands[k].fillna(0.0) for k in BANDS}
    return pd.DataFrame({
        "0_4": b["b0_4"],
        "5_10": b["b5_9"] + 0.2 * b["b10_14"],
        "11_12": 0.4 * b["b10_14"],
        "13_17": 0.4 * b["b10_14"] + 0.6 * b["b15_19"],
        "13_14": 0.4 * b["b10_14"],
    }, index=bands.index)


SEX_RULE = ("Girls' share of the children of each age group: females over everyone at those single years of age in "
            "the 2018 Census, summed over the 2018 SA2s the place's SA1s fall in (Data8277, Total ethnicity). Used "
            "for a girls' school (boys: one less this); it assumes girls and boys of an age live in the same places "
            "inside the place.")


def sex_shares(settings: Settings, sa1s: set[str]) -> dict | None:
    """{group: girls' share} for the place, or None without the table."""
    if "census_sex" not in settings.raw.get("data", {}) or not settings.data("census_sex").exists():
        return None
    table = pd.read_parquet(settings.data("census_sex"))
    shape, _ = read_shape(settings)
    areas = set(shape.loc[shape.index.isin(sa1s), "sa2_2018"].astype(str))
    mine = table[table["area"].isin(areas) & table["female"].notna() & table["total"].notna()]
    out = {}
    for group, (lo, hi) in {**GROUPS, "15_17": (15, 17)}.items():
        rows = mine[mine["age"].between(lo, hi)]
        total = float(rows["total"].sum())
        out[group] = round(float(rows["female"].sum()) / total, 4) if total > 0 else None
    return {"girls": out, "sa2s": len(areas), "rule": SEX_RULE,
            "source": "Stats NZ, 2018 Census age by single year and sex by SA2 (Data8277), CC BY 4.0"}


def read_shape(settings: Settings) -> tuple[pd.DataFrame, dict]:
    path = settings.data("census_age_shape")
    shape = pd.read_parquet(path)
    shape["sa1"] = _code(shape["sa1"])
    meta_path = Path(str(path) + ".metadata.json")
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    return shape.set_index("sa1"), meta


def sa1_table(settings: Settings, blocks: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Bands, shares and groups for every SA1 of the place (`blocks`: sa1, sa2)."""
    raw = _records(settings.data("census_ages"))
    raw["sa1"] = _code(raw["SA12023_V1_00"])
    sa1 = pd.DataFrame({"sa1": raw["sa1"], "residents": _count(raw[RESIDENTS])})
    for band, column in BANDS.items():
        sa1[band] = _count(raw[column])
    sa1 = blocks[["sa1", "sa2"]].drop_duplicates("sa1").merge(sa1, on="sa1", how="left")
    raw2 = _records(settings.data("census_ages_sa2"))
    sa2 = pd.DataFrame({"sa2": _code(raw2["SA22023_V1_00"]), "residents": _count(raw2[RESIDENTS])})
    for band, column in BANDS.items():
        sa2[band] = _count(raw2[column])
    filled_table, filled = fill_bands(sa1, sa2)
    shape, shape_meta = read_shape(settings)
    filled_table = filled_table.set_index("sa1")
    nat = national_shape(shape_meta)
    for a in range(10, 18):
        filled_table[f"f{a}"] = shape[f"f{a}"].reindex(filled_table.index).fillna(nat[f"f{a}"]).to_numpy()
    missing_shape = int(shape["f10"].reindex(filled_table.index).isna().sum())
    info = {"filled": filled, "shape_meta": shape_meta, "sa1_without_shape": missing_shape,
            "national_shape_used": {
                band: int((shape.reindex(filled_table.index)[f"source_{band}"] != "sa2").sum())
                for band in ("10_14", "15_19") if f"source_{band}" in shape}}
    sa2_rows = sa2.set_index("sa2")
    return filled_table, {**info, "sa2_table": sa2_rows}


# ---------------------------------------------------------------------------
# Rule 4: spread over hexagons as people are


_PIECES: dict[tuple[str, str], object] = {}


def block_pieces(settings: Settings):
    """Each land census block cut by the grid's hexagons, as `build_grid` cuts
    them: sa1, h3, piece geometry (NZTM), piece area, the block's area within
    the grid, and the block's residents. Kept for the build, since zones use
    the same pieces."""
    import geopandas as gpd
    import h3
    from shapely.geometry import Polygon

    key = (str(settings.data("census_sa1")), str(settings.data("grid")))
    if key in _PIECES:
        return _PIECES[key]
    blocks = gpd.read_file(settings.data("census_sa1"))
    blocks = blocks[blocks.geometry.notna() & ~blocks.geometry.is_empty]
    if "LANDWATER_NAME" in blocks:
        blocks = blocks[~blocks["LANDWATER_NAME"].str.contains("water", case=False, na=False)]
    blocks["population"] = pd.to_numeric(blocks[GRID_POPULATION], errors="coerce").fillna(0.0)
    blocks["sa1"] = _code(blocks["SA12023_code"])
    blocks["sa2"] = _code(blocks["SA22023_code"]) if "SA22023_code" in blocks else ""
    blocks = blocks.reset_index(names="block")
    cells = sorted(pd.read_parquet(settings.data("grid"), columns=["h3"])["h3"].astype(str))
    hexes = gpd.GeoDataFrame(
        {"h3": cells},
        geometry=[Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells],
        crs="EPSG:4326",
    )
    metric = "EPSG:2193"
    pieces = gpd.overlay(
        blocks[["block", "sa1", "sa2", "population", "geometry"]].to_crs(metric),
        hexes.to_crs(metric),
        how="intersection",
    )
    pieces["piece_area"] = pieces.area
    block_area = pieces.groupby("block")["piece_area"].transform("sum")
    pieces["block_area"] = block_area
    pieces["share"] = pieces["piece_area"] / block_area.where(block_area > 0, 1.0)
    pieces["people"] = pieces["population"] * pieces["share"]
    _PIECES[key] = (pieces, blocks)
    return pieces, blocks


def spread(pieces: pd.DataFrame, per_sa1: pd.DataFrame) -> pd.DataFrame:
    """Per-SA1 counts spread onto hexagons by each piece's share of its block."""
    values = per_sa1.reindex(pieces["sa1"]).fillna(0.0).to_numpy(dtype="float64")
    weighted = pd.DataFrame(values * pieces["share"].to_numpy()[:, None], columns=per_sa1.columns)
    weighted["h3"] = pieces["h3"].to_numpy()
    return weighted.groupby("h3").sum()


def available(settings: Settings) -> bool:
    data = settings.raw.get("data", {})
    return all(k in data for k in ("census_ages", "census_ages_sa2", "census_age_shape")) and \
        all(settings.data(k).exists() for k in ("census_ages", "census_ages_sa2", "census_age_shape"))


def _summary_path(settings: Settings) -> Path:
    return settings.output_dir / "ages" / "ages_summary.json"


def to_grid(children: pd.DataFrame, residents: pd.Series, grid: pd.Series) -> tuple[pd.DataFrame, int]:
    """Children per hexagon on the grid's own population.

    `children` and `residents` are spread from census blocks by area (rule
    4); `grid` is the population the rest of TEAM uses. Each hexagon keeps its
    spread age shares applied to its grid population, so a hexagon's children
    never exceed its residents and the two agree wherever the grid was made
    the same way (everywhere but a few dozen Auckland hexagons, whose grid
    values were kept from an earlier build). A hexagon with grid residents
    but none spread takes the place's shares. Returns the table and how many
    hexagons took the place's shares.
    """
    spread_res = residents.reindex(grid.index).fillna(0.0)
    kids = children.reindex(grid.index).fillna(0.0)
    place = kids.sum() / max(float(spread_res.sum()), 1e-9)
    has = spread_res > 0
    shares = kids.div(spread_res.where(has), axis=0)
    orphan = (~has) & (grid > 0)
    shares.loc[orphan] = place.to_numpy()
    shares = shares.fillna(0.0)
    return shares.mul(grid, axis=0), int(orphan.sum())


def sa2_check(table: pd.DataFrame, shaped: pd.DataFrame, sa2: pd.DataFrame) -> dict:
    """Groups from the 2023 SA2 bands against the same groups summed from SA1s,
    for the SA2s whose residents all live in this place's blocks (within
    base-3 rounding: the SA1 residents add to the SA2's within 1% or 6
    people). SA2 bands are split by the band-weighted mean shape of their SA1s."""
    place_sa2 = sorted(set(table["sa2"].dropna()))
    held = table.groupby("sa2")["residents"].sum().reindex(place_sa2)
    published = sa2["residents"].reindex(place_sa2)
    whole = [s for s in place_sa2 if pd.notna(published.get(s)) and
             abs(float(held.get(s, 0.0)) - float(published[s])) <= max(6.0, 0.01 * float(published[s]))]
    rows = sa2.reindex(whole).copy()
    known = sa2[[*BANDS]].notna().all(axis=1) & (sa2["residents"] > 0)
    for band in BANDS:
        national = float(sa2.loc[known, band].sum() / sa2.loc[known, "residents"].sum())
        rows[band] = rows[band].fillna(rows["residents"].fillna(0) * national)
    mean_shape = pd.DataFrame(index=whole)
    for a in range(10, 18):
        w = (table["b10_14"] if a < 15 else table["b15_19"]).clip(lower=0)
        num = (table[f"f{a}"] * w).groupby(table["sa2"]).sum()
        den = w.groupby(table["sa2"]).sum()
        flat = table[f"f{a}"].groupby(table["sa2"]).mean()
        mean_shape[f"f{a}"] = (num / den.where(den > 0)).fillna(flat).reindex(whole)
    from_sa2 = groups(pd.concat([rows[[*BANDS]], mean_shape], axis=1))
    from_sa1 = shaped[table["sa2"].isin(whole)]
    k = int(table["sa2"].isin(whole).sum()) + len(whole)
    a, b = from_sa1.sum(), from_sa2.sum()
    # Stats NZ rounds every cell to base 3 at random (variance 4/3 a cell), so
    # sums of many cells differ by chance; allow 1%, or three standard
    # deviations of the rounding in the cells summed, whichever is larger.
    allowance = {g: round(max(0.01 * float(b[g]), 3.0 * float(np.sqrt(4.0 / 3.0 * GROUP_BANDS[g] * k))), 1) for g in GROUPS}
    return {
        "sa2s": len(place_sa2),
        "sa2s_whole": len(whole),
        "cells_summed": k,
        "residents_in_whole_sa2s": round(float(published.reindex(whole).sum()), 1),
        "from_sa2": {g: round(float(b[g]), 1) for g in GROUPS},
        "from_sa1": {g: round(float(a[g]), 1) for g in GROUPS},
        "allowance": allowance,
        "within": {g: bool(abs(float(a[g]) - float(b[g])) <= allowance[g]) for g in GROUPS},
    }


def build(settings: Settings, origins) -> pd.DataFrame:
    """Children in each hexagon by group: index h3, columns age_0_4 ... age_13_17.

    Also writes <out>/ages/ages_summary.json, which `meta` reads: totals, the
    even-split totals, the 2023 SA2 check, what was filled, and the check
    that residents spread this way give the grid's population.
    """
    index = pd.Index(origins["id"].astype(str), name="h3")
    if not available(settings):
        log.info("ages: no census age files configured; school figures will count all residents")
        return pd.DataFrame(index=index)
    out, summary = compute(settings, origins)
    path = _summary_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2))
    log.info("ages: %s", summary["totals"])
    return out


def check(settings: Settings, origins) -> dict:
    """What `team ages check` prints: the summary build writes, without writing it."""
    return compute(settings, origins)[1]


def compute(settings: Settings, origins) -> tuple[pd.DataFrame, dict]:
    """The children table for the origins and its summary (see build)."""
    index = pd.Index(origins["id"].astype(str), name="h3")
    pieces, blocks = block_pieces(settings)
    table, info = sa1_table(settings, blocks)
    shaped = groups(table)
    even = even_groups(table)
    residents = pieces.groupby("h3")["people"].sum()
    grid = pd.read_parquet(settings.data("grid"), columns=["h3", "population"]).set_index("h3")["population"].astype("float64")
    diff = (residents.reindex(grid.index).fillna(0.0) - grid).abs()
    check = {"max_abs_diff": round(float(diff.max()), 3), "cells_over_0_01": int((diff > 0.01).sum()),
             "origins_over_0_01": int(((diff > 0.01) & (grid >= float(settings.raw["origins"]["min_population"]))).sum()),
             "cells": int(len(grid))}
    if check["cells_over_0_01"]:
        log.info("ages: residents spread by block area differ from the grid in %d hexagons (largest %.2f); "
                 "those take their spread age shares applied to the grid's population", check["cells_over_0_01"],
                 check["max_abs_diff"])
    kids, orphans = to_grid(spread(pieces, shaped), residents, grid)
    even_kids, _ = to_grid(spread(pieces, even), residents, grid)
    check["cells_given_place_shares"] = orphans

    out = kids.reindex(index).fillna(0.0)
    out.columns = [f"age_{g}" for g in out.columns]
    out = out.astype("float32")
    land = table[table.index.isin(set(blocks["sa1"]))]
    summary = {
        "shape": (info["shape_meta"] or {}).get("shape_source", "census2018_sa2"),
        "totals": {g: round(float(out[f"age_{g}"].sum()), 1) for g in GROUPS},
        "totals_all_hexagons": {g: round(float(kids[g].sum()), 1) for g in GROUPS},
        "even_split_totals": {g: round(float(even_kids[g].reindex(index).fillna(0.0).sum()), 1) for g in GROUPS},
        "sa1_totals": {g: round(float(shaped.loc[land.index, g].sum()), 1) for g in GROUPS},
        "sa2_check": sa2_check(land, shaped.loc[land.index], info["sa2_table"]),
        "residents": round(float(grid.reindex(index).fillna(0).sum()), 1),
        "sa1s": int(len(land)),
        "filled": info["filled"],
        "sa1_without_shape": info["sa1_without_shape"],
        "national_shape_used": info["national_shape_used"],
        "grid_check": check,
        "sex": sex_shares(settings, set(blocks["sa1"].astype(str))),
    }
    return out, summary


# Two decimals: many hexagons hold a small fraction of a child, and rounding
# them to one decimal drops about 0.2% of the children in a place (Dunedin,
# 0-4); to two decimals they stay within 0.2% (Taupō 0-4, 3 children).
DIGITS = 2


def payload(table: pd.DataFrame) -> dict | None:
    """cells.json "ages": children per hexagon by group, to two decimals."""
    if not all(c in table for c in COLUMNS):
        return None
    out = {}
    for group in GROUPS:
        values = pd.to_numeric(table[f"age_{group}"], errors="coerce").to_numpy(dtype="float64")
        out[group] = [round(float(v), DIGITS) if np.isfinite(v) else None for v in values]
    return out


def meta(settings: Settings, table: pd.DataFrame) -> dict | None:
    """summary.json meta.ages."""
    if not all(c in table for c in COLUMNS):
        return None
    path = _summary_path(settings)
    summary = json.loads(path.read_text()) if path.exists() else {}
    return {
        "groups": LABELS,
        "services": {s: g for s, g in SERVICE_GROUP.items() if s in settings.services},
        "shape": summary.get("shape", "census2018_sa2"),
        "census": "2023 Census, usual residents, ages on census day, 7 March 2023",
        "rule": RULE,
        "sources": SOURCES,
        # The sums of the published values, so the page's own sums match.
        "totals": {g: round(float(sum(v for v in values if v is not None)), 1) for g, values in payload(table).items()},
        "totals_unrounded": {g: round(float(table[f"age_{g}"].sum()), 1) for g in GROUPS},
        "even_split_totals": summary.get("even_split_totals"),
        "sa1_totals": summary.get("sa1_totals"),
        # The same groups from the 2023 SA2 table, for the SA2s wholly in the
        # place, against the SA1 sums for those SA2s (sa2_check).
        "sa2_totals": (summary.get("sa2_check") or {}).get("from_sa2"),
        "sa2_check": summary.get("sa2_check"),
        "filled": summary.get("filled"),
        "national_shape_used": summary.get("national_shape_used"),
        "grid_check": summary.get("grid_check"),
        # The share of girls among the children of each group, for a girls'
        # or a boys' school (sex_shares).
        "sex": summary.get("sex"),
    }
