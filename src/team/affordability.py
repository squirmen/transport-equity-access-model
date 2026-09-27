"""What a fare means against what people earn.

A $7 return trip is a small part of a day's income in a well-off suburb and a
large part of it where incomes are low. TEAM measures that as the burden of a
trip: its fare as a share of a day's income in the area where the traveller
lives.

    burden = return fare / (equivalised income / 365)

Income is the 2023 Census median household income of the SA1 around each
hexagon, adjusted in two ways:

* For household size, with the square-root equivalence scale (OECD): the
  household's income divided by the square root of the number of people it
  supports. A $120,000 household of four lives on less per person than a
  $120,000 household of one, and a fare is paid per person. The census gives
  the median income and the mean household size of each SA1, so this is the
  median income over the root of the mean size, an approximation of the
  median equivalised income.

* To the year the fares are from. Census income is for the year to March
  2023. It is raised by the growth in average ordinary-time hourly earnings
  in the Quarterly Employment Survey, from $38.93 in the March 2023 quarter
  to $44.62 in the June 2026 quarter.

The income is before tax, so a burden against take-home pay would be higher.

A return trip that costs a given share of a day's income, made every day, is
the same share of income spent on a month of daily return trips: the
60-trip month Carruthers, Dick and Saurkar (2005) use for the World Bank's
affordability index.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

EARNINGS_2023_Q1 = 38.93   # average ordinary-time hourly earnings, March 2023 quarter
EARNINGS_2026_Q2 = 44.62   # the same, June 2026 quarter
INCOME_UPLIFT = EARNINGS_2026_Q2 / EARNINGS_2023_Q1
UPLIFT_SOURCE = (
    "Stats NZ, Labour market statistics (income), March 2023 and June 2026 quarters: "
    "average ordinary-time hourly earnings, Quarterly Employment Survey"
)


def equivalised(median_income: pd.Series, household_size: pd.Series, uplift: float = INCOME_UPLIFT) -> pd.Series:
    """Household income per equivalent adult, in the fare year's dollars.

    Missing or implausible sizes leave the income missing rather than guess.
    """
    size = pd.to_numeric(household_size, errors="coerce")
    size = size.where(size >= 1.0)
    income = pd.to_numeric(median_income, errors="coerce")
    income = income.where(income > 0)
    return (income * float(uplift) / np.sqrt(size)).astype("float64")


def burden(return_fare: float | np.ndarray, income: float | np.ndarray) -> np.ndarray:
    """A return fare as a share of a day's equivalised income."""
    daily = np.asarray(income, dtype="float64") / 365.0
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(daily > 0, np.asarray(return_fare, dtype="float64") / daily, np.nan)
