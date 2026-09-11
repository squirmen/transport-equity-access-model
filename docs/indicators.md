# Indicators

Every figure TEAM publishes, what it means and how it is stored. The
downloadable dataset (`team_auckland_h3.gpkg` and `.csv`) has one row per
populated hexagon and the fields below; `fields.csv` in the download repeats
these definitions.

## Services and modes

| Service id | Service | Standard |
| --- | --- | --- |
| `supermarket` | Supermarket | 20 min |
| `gp` | GP or medical centre | 20 min |
| `pharmacy` | Pharmacy | 20 min |
| `primary_school` | Primary school | 15 min |
| `intermediate_school` | Intermediate school | 20 min |
| `secondary_school` | Secondary school | 30 min |

| Mode id | Mode | Counts towards a standard |
| --- | --- | --- |
| `walk` | Walking | yes |
| `bike_low_stress` | Cycling on low-stress routes | yes |
| `pt` | Public transport, with walking at each end | yes |
| `bike` | Cycling on any bikeable street | no |
| `car` | Car, uncongested | no |

## Per hexagon

| Field | Unit | Meaning |
| --- | --- | --- |
| `h3` | id | H3 resolution 9 cell |
| `population` | people | usual residents, 2023 Census, spread from SA1 blocks by area |
| `t_<service>_<mode>` | minutes | time to the nearest destination of that service by that mode; blank when none is within 60 minutes |
| `n_<service>_<mode>` | count | destinations of that service within its standard time by that mode |
| `best_<service>` | minutes | fastest of walking, low-stress cycling and public transport |
| `via_<service>` | mode id | the mode that gave `best_<service>` |
| `meets_<service>` | true/false | `best_<service>` is within the standard |
| `options_<service>` | 0–3 | how many of the three counting modes are within the standard |
| `km_<service>` | km | straight-line distance to the nearest destination of that service |
| `why_<service>` | code | main reason the standard is missed; see below |
| `jobs<T>_<mode>` | jobs | jobs reachable within T minutes (30 or 45) |
| `jobshare<T>_<mode>` | share | the same, as a share of all jobs in the region |
| `jobsfair<T>_<mode>` | ratio | job access allowing for competing workers; 1 is the regional average (public transport and low-stress cycling only) |
| `pt_per_hour_am_peak` | departures | departures per hour at the busiest stop within 800 m, 07:00–09:00 |
| `pt_per_hour_interpeak` | departures | the same, 10:00–12:00 |
| `m_frequent_stop` | metres | straight-line distance to the nearest stop with four or more departures an hour, 07:00–09:00 |
| `m_rail_ferry` | metres | straight-line distance to the nearest rail station or ferry terminal |
| `m_low_stress_route` | metres | straight-line distance to the nearest low-stress cycle facility in the Auckland Transport network |
| `nzdep` | decile | NZDep2023 deprivation, 1 least to 10 most deprived |
| `no_vehicle_share` | share | households with no motor vehicle |
| `children_share` | share | residents under 15 |
| `older_share` | share | residents aged 65 and over |
| `working_age_share` | share | residents aged 15 to 64 |
| `low_income_share` | share | households with income of $70,000 or less |
| `median_income` | dollars | median household income |
| `commute_car_share` | share | workers who drove or were driven to work, by SA2 |
| `sa1`, `sa2_code`, `sa2`, `urban_rural`, `local_board` | text | census geography of the hexagon centre |

Shares are for the SA1 block (or SA2, for commuting) the hexagon falls in, not
for the hexagon alone.

## Reason codes (`why_<service>`)

| Code | Reason | Points to |
| --- | --- | --- |
| 0 | meets the standard | – |
| 1 | the walking route is indirect | a new walking link or crossing |
| 2 | no low-stress bike route | a safe cycling connection |
| 3 | no frequent public transport nearby | more frequent service |
| 4 | public transport is slow for this trip | a more direct route or better connections |
| 5 | nothing within reach | a service closer to home |
| 9 | could not be routed | – |

The rules behind each code are in [`methodology.md`](methodology.md#7-why-a-place-misses-a-standard).

## Regional and area summaries

`summary.json` in the web data holds, for each service:

- the population share meeting the standard, for everyone and for each group
  (households without a car, children, people aged 65 and over);
- the number of people below the standard, for each group;
- the share meeting it in each NZDep quintile, and the gap in percentage points
  between quintile 1 (deciles 1–2) and quintile 5 (deciles 9–10);
- the number of people below the standard by reason.

For jobs, it holds the population-weighted median and mean share of jobs
reachable, the median by NZDep quintile, and the Palma ratio: the average
access of the best-served 10% of residents over that of the least-served 40%.

The same figures are given for each SA2 and local board in the `areas`
section.

## In the web app

The app recalculates standards, reasons and summaries in the browser when the
standard slider moves, using the same rules as the pipeline. Figures at the
default standards match `summary.json`.
