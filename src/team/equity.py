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

GROUPS = {
    "everyone": ("Everyone", None),
    "no_car": ("People in households without a car", "no_vehicle_share"),
    "children": ("Children under 15", "children_share"),
    "older": ("People aged 65 and over", "older_share"),
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
    if column is None:
        return population
    return population * table[column].clip(0.0, 1.0).fillna(0.0)


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
