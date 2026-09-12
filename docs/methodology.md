# TEAM method

TEAM answers three questions for every populated part of Auckland:

1. How long does it take to reach everyday services and jobs without a car?
2. Who lives where that takes too long?
3. What kind of change would bring those places within reach?

It reports plain quantities: minutes to the nearest service, the number of
jobs within a set time, and the number of people on either side of a stated
standard. There is no composite index. Each figure can be traced back to a
travel time, a destination list and a census count.

This document describes version 0.1 for Auckland. Parameter values are in
[`configs/auckland.yml`](../configs/auckland.yml); definitions of every output
field are in [`indicators.md`](indicators.md).

## 1. Places and people

**Grid.** The region is divided into H3 hexagons at resolution 9, each about
0.1 km² and roughly 350 m across ([H3](https://h3geo.org)). Hexagons tile
evenly and every neighbour is the same distance away, which keeps distance
effects consistent across the map.

**Population.** Usual residents from the 2023 Census are spread from SA1
blocks over the hexagons in proportion to area. Cells with fewer than 0.75
residents are dropped; they are slivers of water, parkland or motorway reserve
created by the area weighting.

**Characteristics.** Each hexagon takes the values of the SA1 block its centre
falls in (or the nearest block within 500 m, for coastal cells):

| Field | Source |
| --- | --- |
| Deprivation decile | NZDep2023 (Atkinson, Salmond & Crampton, 2024) |
| Households without a motor vehicle | 2023 Census, households |
| Residents under 15, and aged 65 and over | 2023 Census, individuals |
| Households with income of $70,000 or less | 2023 Census, households |
| Share of workers who drove to work | 2023 Census journey to work, by SA2 |

These are properties of small areas, not of the people in a given hexagon.
Local boards come from Auckland Council's 2025 local board boundaries, by the
same rule.

## 2. Destinations

| Service | Source | Selection |
| --- | --- | --- |
| Supermarket | OpenStreetMap | `shop=supermarket` |
| GP or medical centre | OpenStreetMap | `amenity=doctors`, `healthcare=doctor`, `healthcare=centre`; `amenity=clinic` unless tagged with a non-GP specialty |
| Pharmacy | OpenStreetMap | `amenity=pharmacy`, `healthcare=pharmacy` |
| Primary school | Ministry of Education school directory | open contributing, full primary and composite schools |
| Intermediate school | Ministry of Education school directory | open schools that teach Years 7–8 |
| Secondary school | Ministry of Education school directory | open schools that teach Years 9 and up |
| Jobs | Stats NZ business demography, 2024 | employee counts by SA2, spread over hexagons by area |

A service mapped twice in OpenStreetMap, once as a point and once as a
building, is kept once when the two lie within 40 m. OpenStreetMap services are
taken from the whole extract, which reaches beyond the council boundary, so
people near the edge are not cut off from services across it. Schools and jobs
cover the Auckland region only.

Jobs are summed to H3 resolution 8 (about 0.74 km²) before routing. This keeps
public transport routing to a manageable size; the jobs data is published by
SA2, so finer placement would add no real detail.

## 3. Travel times

Travel times come from the R5 routing engine (Conway, Byrd & van der Linden,
2017) through r5py (Fink et al., 2022), using the OpenStreetMap street and path
network and the Auckland Transport GTFS timetable. Routing starts at the centre
of each populated hexagon and runs to every destination, up to 60 minutes.
Mavoa et al. (2012) measured access to destinations in Auckland by public
transport and walking from timetable and network data in a similar way.

| Mode | Settings |
| --- | --- |
| Walking | 4.8 km/h, the speed used in public transport accessibility levels (Transport for London, 2015) |
| Low-stress cycling | 15 km/h, on streets at traffic stress level 2 or below |
| Cycling on any bikeable street | 15 km/h, traffic stress level 3 or below |
| Public transport | walking up to 15 minutes to and from stops; median time over every departure minute in the window, including waiting |
| Car | uncongested driving; for reference only |

**Time windows.** Schools and jobs use the weekday morning, 07:00–09:00.
Supermarkets, GPs and pharmacies use weekday late morning, 10:00–12:00. The
routing date is a Tuesday in school term.

**Traffic stress.** R5 classifies every street from its OpenStreetMap tags,
following Mekuria, Furth & Nixon (2012). Level 2 or below covers off-road
paths, protected lanes and quiet residential streets, which most people are
willing to ride (Dill & McNeil, 2016). Level 3 adds streets a confident rider
would use.

**Public transport.** Walking the whole way is allowed when it is faster, so a
public transport time is never worse than the walking time. The median over the
window reflects the timetable a person would meet if they left at a random
minute, which is how frequency enters the measure.

For each hexagon and service, TEAM keeps the minutes to the nearest destination
by each mode, which destination that was, how many destinations are within 10,
15, 20 and 30 minutes, and the straight-line distance to the nearest.

## 4. Access standards

A hexagon **meets** a standard when walking, low-stress cycling or public
transport reaches the nearest destination within the standard time. Car times
and cycling on busy roads are reported but never count.

| Service | Standard | Window |
| --- | --- | --- |
| Supermarket | 20 min | 10:00–12:00 |
| GP or medical centre | 20 min | 10:00–12:00 |
| Pharmacy | 20 min | 10:00–12:00 |
| Primary school | 15 min | 07:00–09:00 |
| Intermediate school | 20 min | 07:00–09:00 |
| Secondary school | 30 min | 07:00–09:00 |

The 20-minute figure follows the 20-minute neighbourhood used in Melbourne's
planning (Victoria State Government, 2019), itself one of several time-based
neighbourhood standards (Moreno et al., 2021). Primary pupils get a shorter
standard and secondary pupils a longer one. These are settings, not findings.
The web app lets anyone change them, and the downloadable data holds the
underlying times so any other standard can be applied.

TEAM also counts how many of the three counting modes meet the standard (0 to
3). A place reachable only by one bus route is more exposed to a service change
than one that is also walkable.

Framing access as a minimum everyone should have follows the sufficiency view
of transport justice (Martens, 2017; Lucas, van Wee & Maat, 2016; Pereira,
Schwanen & Banister, 2017): the first question is who falls below an adequate
level, rather than who has most.

## 5. Job access

**Jobs within reach.** For each mode and for 30 and 45 minutes, the number of
jobs reachable, also given as a share of all jobs in the region. This is a
cumulative-opportunities measure (Geurs & van Wee, 2004).

**Allowing for competition.** Job counts alone overstate access where many
people can reach the same jobs. TEAM also reports a two-step floating catchment
measure (Shen, 1998; Luo & Wang, 2003):

1. For each job location *j*, divide its jobs *S_j* by the working-age
   residents who can reach it within *T* minutes:
   *R_j = S_j / Σ_k P_k*, over origins *k* with *t_kj ≤ T*.
2. For each home location *k*, add up *R_j* over the job locations it can reach
   within *T*: *A_k = Σ_j R_j*.

*A_k* is divided by the regional ratio of jobs to working-age residents, so 1.0
is the Auckland average. Working-age residents are those aged 15 to 64.

**Inequality.** For each mode and time, TEAM reports the Palma ratio of job
access: the average of the best-served 10% of residents over the average of
the least-served 40% (Palma, 2011; applied to accessibility by Pereira et al.,
2019).

## 6. Who misses out

For each service and standard, TEAM counts the people living in hexagons that
miss it, overall and for three groups: people in households without a car,
children under 15, and people aged 65 and over. A group count is the cell
population multiplied by the group's share in the SA1 block, so it is an
estimate for an area rather than a count of individuals.

Results are also broken down by NZDep quintile (deciles 1–2 through 9–10),
giving the population share that meets the standard in each. The gap between
the least and most deprived quintiles is reported in percentage points.
Figures are summarised for each SA2 and each of Auckland's 21 local boards.

## 7. Why a place misses a standard

For every hexagon that misses a standard, TEAM records the first of these
rules that applies. Each rule points to a different kind of fix.

| Order | Reason | Test | Points to |
| --- | --- | --- | --- |
| 1 | The walking route is indirect | the nearest service is close enough to walk in time along a normal route (straight line × 1.3), but the actual walk takes longer than the standard | a missing path, crossing or connection |
| 2 | No low-stress bike route | cycling on any bikeable street meets the standard, cycling on low-stress routes does not | a safe cycling connection |
| 3 | No frequent public transport nearby | the service is within bus range (12 km/h door to door) but public transport misses the standard, and no stop within 800 m has four or more departures an hour | more frequent service |
| 4 | Public transport is slow for this trip | as for 3, but a frequent stop is nearby | a more direct route or better connections |
| 5 | Nothing within reach | none of the above | a service closer to home |

The parameters (1.3, 12 km/h, four departures an hour) are in the
configuration. These are screening rules: they say which kind of fix to look at
first. A local study is still needed to design one.

## 8. Checks

- Unit tests with known answers cover the standards, the reason rules, the
  competition adjustment and the equity statistics
  ([`tests/test_core.py`](../tests/test_core.py)). The browser copy of the reason
  rules is tested against the same cases
  ([`tests/web/diagnose.test.mjs`](../tests/web/diagnose.test.mjs)).
- For each SA2, job access by public transport (the population-weighted share
  of Auckland's jobs within 45 minutes) is compared with the share of workers
  who did not drive to work in the 2023 Census, using Spearman's rank
  correlation. The result is recorded under `checks` in `summary.json`. It
  shows whether the pattern is plausible; it is not a calibration.
- Every routing run writes a manifest with its inputs, settings, date and row
  counts, including any empty tables left out of the timetable feed.

## 9. What TEAM does not do

- It uses the nearest service. School zones, GP enrolment, opening hours and
  store size are not modelled, so the nearest service may not be one a person
  can use.
- Travel times come from timetables and street data, not observed journeys.
  Reliability, crowding and missed connections are not included.
- Walking and cycling ignore hills, lighting, footpath condition and personal
  safety.
- Census shares describe small areas. They do not say who in a hexagon misses
  out.
- The car reference ignores congestion and parking, so it understates driving
  times at busy periods.
- The reason rules are a first screen. They do not estimate the cost or effect
  of any fix.

## References

Atkinson, J., Salmond, C., & Crampton, P. (2024). *NZDep2023 Index of
Deprivation*. University of Otago, Wellington.

Conway, M. W., Byrd, A., & van der Linden, M. (2017). Evidence-based transit and
land use sketch planning using interactive accessibility methods on
combinatorial scenario designs. *Transportation Research Record*, 2653, 45–53.

Dill, J., & McNeil, N. (2016). Revisiting the four types of cyclists: findings
from a national survey. *Transportation Research Record*, 2587, 90–99.

Fink, C., Klumpenhouwer, W., Saraiva, M., Pereira, R., & Tenkanen, H. (2022).
*r5py: Rapid Realistic Routing with R5 in Python*. Zenodo.
https://doi.org/10.5281/zenodo.7060438

Geurs, K. T., & van Wee, B. (2004). Accessibility evaluation of land-use and
transport strategies: review and research directions. *Journal of Transport
Geography*, 12(2), 127–140.

Lucas, K., van Wee, B., & Maat, K. (2016). A method to evaluate equitable
accessibility: combining ethical theories and accessibility-based approaches.
*Transportation*, 43(3), 473–490.

Luo, W., & Wang, F. (2003). Measures of spatial accessibility to health care in
a GIS environment: synthesis and a case study in the Chicago region.
*Environment and Planning B*, 30(6), 865–884.

Martens, K. (2017). *Transport Justice: Designing Fair Transportation Systems*.
Routledge.

Mavoa, S., Witten, K., McCreanor, T., & O'Sullivan, D. (2012). GIS based
destination accessibility via public transit and walking in an urban area.
*Journal of Transport Geography*, 20(1), 15–22.

Mekuria, M. C., Furth, P. G., & Nixon, H. (2012). *Low-Stress Bicycling and
Network Connectivity*. Mineta Transportation Institute, Report 11-19.

Moreno, C., Allam, Z., Chabaud, D., Gall, C., & Pratlong, F. (2021).
Introducing the "15-Minute City": sustainability, resilience and place identity
in future post-pandemic cities. *Smart Cities*, 4(1), 93–111.

Palma, J. G. (2011). Homogeneous middles vs. heterogeneous tails, and the end
of the "inverted-U". *Development and Change*, 42(1), 87–153.

Pereira, R. H. M., Schwanen, T., & Banister, D. (2017). Distributive justice and
equity in transportation. *Transport Reviews*, 37(2), 170–191.

Pereira, R. H. M., Banister, D., Schwanen, T., & Wessel, N. (2019).
Distributional effects of transport policies on inequalities in access to
opportunities in Rio de Janeiro. *Journal of Transport and Land Use*, 12(1),
741–764.

Shen, Q. (1998). Location characteristics of inner-city neighborhoods and
employment accessibility of low-wage workers. *Environment and Planning B*,
25(3), 345–365.

Transport for London (2015). *Assessing transport connectivity in London*.
Transport for London.

Victoria State Government (2019). *20-minute neighbourhoods: creating a more
liveable Melbourne*. Department of Environment, Land, Water and Planning.
