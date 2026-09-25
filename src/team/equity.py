"""Who meets the access standards, who does not, and where they live.

All figures are weighted by population over hexagon cells. Group counts are
cell population times the group's share in the surrounding census block, so
they estimate people in an area rather than count individuals.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Settings
from .diagnosis import REASONS

# Each group is a share of the census block around a cell, so a group count
# estimates people in an area rather than counting individuals. Ethnicity is a
# multiple response, so those groups overlap and do not add to the population.
GROUPS = {
    "everyone": ("Everyone", None),
    "no_car": ("People in households without a car", "no_vehicle_share"),
    "children": ("Children under 15", "children_share"),
    "older": ("People aged 65 and over", "older_share"),
    "low_income": ("People in households under $70,000", "low_income_share"),
    "maori": ("Māori", "maori_share"),
    "pacific": ("Pacific peoples", "pacific_share"),
    "asian": ("Asian", "asian_share"),
    "disabled": ("Disabled people", "disabled_share"),
}

QUINTILE_LABELS = {
    1: "NZDep 1–2 (least deprived)",
    2: "NZDep 3–4",
    3: "NZDep 5–6",
    4: "NZDep 7–8",
    5: "NZDep 9–10 (most deprived)",
}


def group_weights(table: pd.DataFrame, group: str) -> pd.Series:
    population = table["population"].fillna(0.0)
    column = GROUPS[group][1]
    if column is None or column not in table.columns:
        return population if column is None else pd.Series(0.0, index=table.index)
    return population * table[column].clip(0.0, 1.0).fillna(0.0)


def available_groups(table: pd.DataFrame) -> list[str]:
    """Groups the current data can describe."""
    return [g for g, (_, column) in GROUPS.items() if column is None or column in table.columns]


def nzdep_quintile(nzdep: pd.Series) -> pd.Series:
    return ((nzdep + 1) // 2).astype("Int8")


def weighted_share(flags: pd.Series, weights: pd.Series) -> float:
    total = float(weights.sum())
    return float((weights * flags.astype(float)).sum() / total) if total > 0 else float("nan")


def weighted_quantile(values: pd.Series, weights: pd.Series, q: float) -> float:
    mask = values.notna() & (weights > 0)
    if not mask.any():
        return float("nan")
    order = np.argsort(values[mask].to_numpy())
    v = values[mask].to_numpy()[order]
    w = weights[mask].to_numpy()[order]
    cumulative = np.cumsum(w) / w.sum()
    return float(v[np.searchsorted(cumulative, q)])


def palma_ratio(values: pd.Series, weights: pd.Series) -> float:
    """Mean access of the best-served 10% of residents over the least-served 40%."""
    mask = values.notna() & (weights > 0)
    order = np.argsort(values[mask].to_numpy())
    v = values[mask].to_numpy()[order]
    w = weights[mask].to_numpy()[order]
    cumulative = np.cumsum(w) / w.sum()
    bottom = cumulative <= 0.4
    top = cumulative > 0.9
    if not bottom.any() or not top.any():
        return float("nan")
    low = np.average(v[bottom], weights=w[bottom])
    high = np.average(v[top], weights=w[top])
    return float(high / low) if low > 0 else float("inf")


def service_summary(table: pd.DataFrame, settings: Settings) -> list[dict]:
    quintile = nzdep_quintile(table["nzdep"])
    everyone = group_weights(table, "everyone")
    out = []
    for service, spec in settings.services.items():
        meets = table[f"meets_{service}"].fillna(False)
        entry = {
            "service": service,
            "label": spec["label"],
            "standard_minutes": spec["standard_minutes"],
            "share_meeting": {},
            "people_below": {},
            "by_quintile": [],
            "reasons": {},
        }
        for group in GROUPS:
            weights = group_weights(table, group)
            entry["share_meeting"][group] = weighted_share(meets, weights)
            entry["people_below"][group] = float((weights * (~meets)).sum())
        for q, label in QUINTILE_LABELS.items():
            in_q = (quintile == q).fillna(False)
            entry["by_quintile"].append(
                {
                    "quintile": q,
                    "label": label,
                    "share_meeting": weighted_share(meets[in_q], everyone[in_q]),
                    "population": float(everyone[in_q].sum()),
                }
            )
        low, high = entry["by_quintile"][0]["share_meeting"], entry["by_quintile"][-1]["share_meeting"]
        entry["gap_points"] = round(100 * (low - high), 1) if np.isfinite(low) and np.isfinite(high) else None
        why = table[f"why_{service}"]
        for code, (key, _, _) in REASONS.items():
            if code in (0, 9):
                continue
            entry["reasons"][key] = float(everyone[why == code].sum())
        out.append(entry)
    return out


def jobs_summary(table: pd.DataFrame, settings: Settings) -> list[dict]:
    weights = group_weights(table, "everyone")
    quintile = nzdep_quintile(table["nzdep"])
    out = []
    for column in sorted(c for c in table.columns if c.startswith("jobshare")):
        limit, mode_id = column.removeprefix("jobshare").split("_", 1)
        values = table[column]
        entry = {
            "mode": mode_id,
            "minutes": int(limit),
            "median_share": weighted_quantile(values, weights, 0.5),
            "mean_share": float(np.average(values.fillna(0.0), weights=weights)) if weights.sum() > 0 else None,
            "palma": palma_ratio(values, weights),
            "by_quintile": [],
        }
        for q, label in QUINTILE_LABELS.items():
            in_q = (quintile == q).fillna(False)
            entry["by_quintile"].append({"quintile": q, "label": label, "median_share": weighted_quantile(values[in_q], weights[in_q], 0.5)})
        out.append(entry)
    return out


def area_summary(table: pd.DataFrame, settings: Settings, key: str) -> pd.DataFrame:
    """One row per area: residents, share meeting each standard, residents below it,
    and the most common reason among them."""
    weights = group_weights(table, "everyone")
    no_car = group_weights(table, "no_car")
    rows = []
    for area, cells in table.groupby(key):
        if not isinstance(area, str) or not area:
            continue
        w = weights.loc[cells.index]
        row = {key: area, "population": float(w.sum()), "no_car_people": float(no_car.loc[cells.index].sum())}
        row["nzdep_median"] = weighted_quantile(cells["nzdep"], w, 0.5)
        for service in settings.services:
            meets = cells[f"meets_{service}"].fillna(False)
            row[f"share_{service}"] = weighted_share(meets, w)
            row[f"below_{service}"] = float((w * ~meets).sum())
            row[f"below_no_car_{service}"] = float((no_car.loc[cells.index] * ~meets).sum())
            below = cells[~meets]
            if len(below):
                people_by_reason = w.loc[below.index].groupby(below[f"why_{service}"]).sum()
                people_by_reason = people_by_reason.drop(index=[0, 9], errors="ignore")
                row[f"why_{service}"] = int(people_by_reason.idxmax()) if len(people_by_reason) else 0
            else:
                row[f"why_{service}"] = 0
        rows.append(row)
    return pd.DataFrame(rows)


def commute_check(
    table: pd.DataFrame, mode: str = "pt", minutes: int = 45, column: str | None = None
) -> dict | None:
    """Rank correlation across SA2s between job access and not driving to work.

    A plausibility check, not a calibration: areas where more jobs are within
    reach without a car should tend to be areas where more workers got to work
    without driving in the 2023 Census. Each SA2's job access is the
    population-weighted mean over its hexagons.
    """
    column = column or f"jobshare{minutes}_{mode}"
    needed = ["sa2", "population", column, "commute_car_share"]
    if not set(needed) <= set(table.columns):
        return None
    frame = table[needed].dropna()
    frame = frame[frame["population"] > 0]
    frame = frame.assign(weighted=frame[column] * frame["population"])
    areas = frame.groupby("sa2").agg(
        weighted=("weighted", "sum"), population=("population", "sum"), drove=("commute_car_share", "first")
    )
    if len(areas) < 3:
        return None
    access = areas["weighted"] / areas["population"]
    rho = access.rank().corr((1.0 - areas["drove"]).rank())
    return {
        "measure": column,
        "census": "share of workers who did not drive to work, 2023 Census",
        "areas": int(len(areas)),
        "spearman": round(float(rho), 3),
    }


def gravity_summary(table: pd.DataFrame, settings: Settings) -> dict:
    """Regional figures for the gravity scores: the middle of the distribution,
    how unequal it is, and how it varies with deprivation."""
    weights = group_weights(table, "everyone")
    quintile = nzdep_quintile(table["nzdep"])
    modes = list(settings.gravity.get("modes", []))
    measures = []
    for column in sorted(c for c in table.columns if c.startswith("accessidx_")):
        rest = column.removeprefix("accessidx_")
        mode_id = next((m for m in modes if rest.endswith(f"_{m}")), None)
        if mode_id is None:
            continue
        purpose = rest[: -(len(mode_id) + 1)]
        values = table[column]
        entry = {
            "purpose": purpose,
            "mode": mode_id,
            "median_index": weighted_quantile(values, weights, 0.5),
            "palma": palma_ratio(values, weights),
            "by_quintile": [],
        }
        for q, label in QUINTILE_LABELS.items():
            in_q = (quintile == q).fillna(False)
            entry["by_quintile"].append(
                {"quintile": q, "label": label, "median_index": weighted_quantile(values[in_q], weights[in_q], 0.5)}
            )
        measures.append(entry)
    checks = {}
    for mode_id in modes:
        check = commute_check(table, mode=mode_id, column=f"accessidx_jobs_{mode_id}")
        if check:
            checks[mode_id] = check
    return {"measures": measures, "checks": checks}


def fare_summary(table: pd.DataFrame, settings: Settings) -> dict:
    """What each zone budget buys, regionally and by deprivation.

    A zone limit is what a dollar budget buys once the traveller and the fare
    table are known, so these are the figures behind a sentence like "a third
    of people without a car can reach a supermarket for the price of a one
    zone fare".
    """
    weights = group_weights(table, "everyone")
    quintile = nzdep_quintile(table["nzdep"])
    spec = settings.fares
    if not spec:
        return {}
    out = []
    for purpose in spec.get("purposes", []):
        columns = sorted(c for c in table.columns if c.startswith(f"costaccess_{purpose}_z"))
        if not columns:
            continue
        entry = {"purpose": purpose, "by_zone": []}
        for column in columns:
            limit = int(column.rsplit("_z", 1)[1])
            reached = table[column].fillna(0.0)
            any_one = reached > 0
            share_column = f"costshare_{purpose}_z{limit}"
            row = {
                "zones": limit,
                "share_reaching_any": weighted_share(any_one, weights),
                "mean_share_of_all": float(np.average(table[share_column].fillna(0.0), weights=weights))
                if share_column in table and weights.sum() > 0
                else None,
                "by_quintile": [],
            }
            for q, label in QUINTILE_LABELS.items():
                in_q = (quintile == q).fillna(False)
                row["by_quintile"].append(
                    {"quintile": q, "label": label, "share_reaching_any": weighted_share(any_one[in_q], weights[in_q])}
                )
            entry["by_zone"].append(row)
        out.append(entry)
    zones = table["costzone"] if "costzone" in table else pd.Series(dtype="object")
    people_by_zone = (
        {str(z): float(weights[zones == z].sum()) for z in sorted(zones.dropna().unique())} if len(zones) else {}
    )
    return {"measures": out, "people_by_zone": people_by_zone}
