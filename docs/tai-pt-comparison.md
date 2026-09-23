# What TEAM measures, and how it relates to PTAL and TAI-PT

TEAM asks how long it takes to reach everyday needs without a car, who lives
where that takes too long, and why. In Auckland, 87% of residents can reach a GP
within 20 minutes on foot, on a low-stress bike route or by public transport.
The other 203,000 are the point of the model: it names them, counts them,
describes who they are, and gives a reason for each place they live.

Transport for NSW is consulting on a prototype Transport Access Indicator for
public transport (TAI-PT) to replace Public Transport Accessibility Levels
(PTAL). The three tools answer different questions. This note sets out what
TEAM does, then where it sits next to the other two. Descriptions of TAI-PT come
from the documents Transport for NSW released in August and September 2026,
listed at the end.

## What TEAM measures

Every populated hexagon in the region, about 0.1 km² each, gets a travel time to
the nearest supermarket, GP, pharmacy, primary school, intermediate school and
secondary school. Times are calculated for walking, cycling on low-stress
routes, and public transport including the walk at each end. Cycling on any
street and car times are calculated for comparison and never count towards a
standard.

Each service has a stated standard: 20 minutes to a supermarket, GP or pharmacy,
15 to a primary school, 20 to an intermediate, 30 to a secondary school. A place
meets the standard if any of the three counting modes gets there in time. The
standards are settings, not fixed rules, and the web app recalculates every
figure when they move.

Jobs are handled separately: the share of the region's jobs reachable within 30
and 45 minutes, with a second version that divides the jobs at each place by the
workers who can also reach them, so job access is not double counted across a
crowded catchment.

Three things then follow that a service-quality index cannot produce.

**The people behind the number.** TEAM carries 2023 Census population into every
hexagon, so a shortfall is a count of residents, broken down by neighbourhood
deprivation, households without a car, children under 15 and people aged 65 and
over.

**A reason for every shortfall.** Where a place misses a standard, TEAM gives a
screening reason: the walking route is indirect, there is no low-stress bike
route, public transport nearby is infrequent, the public transport trip is slow,
or there is nothing within reach. Each points at a different kind of fix.

**A figure that moves.** Minutes and counts of people respond when the network
improves, including when it improves everywhere at once.

## What it shows in Auckland

From the first full build, using the timetable for a school-term Tuesday and the
2023 Census:

- 87% of Aucklanders meet the 20-minute GP standard without a car. Two-thirds of
  the 203,000 who do not live outside the main urban area, where fewer than half
  of residents meet it. Inside the urban area, 95% do.
- People in the most deprived fifth of neighbourhoods meet the GP standard more
  often (94%) than people in the least deprived fifth (78%). Most of that is
  location: 28% of the least deprived fifth live outside the main urban area,
  against 4% of the most deprived. Inside the urban area the order reverses,
  96% against 91%.
- For a typical resident, about 5% of the region's jobs are within 45 minutes by
  public transport, against 96% by car in free-flowing traffic.
- Across 611 SA2s, modelled job access by public transport rises with the share
  of workers who did not drive to work in the 2023 Census, with a Spearman's rho
  of 0.61.

The second finding is the one that shapes policy advice. A map of relative
access would show the same rural areas scoring low. It would not show that the
people furthest from a GP are mostly not the most deprived, or that the
deprivation gap reverses once location is held constant.

## Side by side

| | PTAL | TAI-PT (prototype) | TEAM |
| --- | --- | --- | --- |
| Question | How much public transport service is near here? | How easily can people reach opportunities from here by public transport, relative to elsewhere? | How long does it take to reach everyday needs without a car, who lives where that is too long, and why? |
| Measure | walk time to stops plus average wait, from frequency | gravity model: opportunities weighted by attractiveness, discounted by travel time | minutes to the nearest service; jobs within 30 and 45 minutes |
| Result | index, grouped into levels 0 to 6b | raw score, published in deciles of relative access | minutes, counts and people; whether a stated standard is met |
| Destinations | none | 15 sub-categories in 8 broad groups, including employment, education, health, food shopping, and social and leisure | supermarkets, GPs, pharmacies, primary, intermediate and secondary schools, and jobs |
| How extra opportunities count | – | each further opportunity of the same kind adds less (diminishing marginal utility) | the nearest service only; job access also adjusted for workers competing for the same jobs |
| Modes | public transport, walking to stops | public transport and walking | walking, low-stress cycling, public transport; cycling on any street and car for comparison |
| Time | a fixed peak period | hourly scores for a typical Tuesday and Saturday; the prototype maps weekday 08:00–09:00 and 12:00–13:00 | median over a two-hour window (07:00–09:00 for schools and jobs, 10:00–12:00 for other services) |
| Spatial unit | grid points | H3 resolution 10 (about 0.015 km², 130 m across) | H3 resolution 9 (about 0.1 km², 350 m across) |
| People | not included | can be overlaid by the user | built in: people below each standard by deprivation, car ownership and age |
| Why access is poor | not reported | not reported | a screening reason for each place that misses a standard |
| Travel times | – | hourly matrices from the GTFS timetable | R5 with the GTFS timetable |
| Code and data | published method | prototype released for consultation | open source; the hexagon dataset is published with the tool |

## The differences that matter

**Units.** TAI-PT publishes deciles, which show where access is higher or lower
than elsewhere in the study area. TEAM reports minutes, counts and the number of
people on either side of a standard. A decile ranks; a count of people beyond a
standard states a need and can be set against a target, a service change or a
budget.

**Coverage of daily life.** TAI-PT sums many kinds of opportunity, each weighted
by size, by how often people visit that kind of place, and by a travel-time
decay fitted to the NSW Household Travel Survey. A single score covers more of
daily life than TEAM's six services, and the gravity form handles choice, which
a nearest-service time does not: two supermarkets at 12 minutes are worth more
than one, and a hospital is not the size of a clinic. TEAM's figures cover less
ground and can be checked by hand.

**Modes.** TAI-PT measures public transport with walking at each end. TEAM also
measures walking and cycling in their own right, and separates cycling on
low-stress routes from cycling on any street, so the difference between the two
shows where a safe connection is missing.

**Resolution and time.** TAI-PT scores 130 m cells, which resolve walk
catchments that TEAM's 350 m cells average over, and it scores each hour of the
day separately. TEAM takes the median over every departure minute in a two-hour
window, so waiting for an infrequent service is inside each travel time.

## Where each fits

PTAL and TAI-PT give a consistent, region-wide score for public transport
access, which is what a business case or a transport impact assessment needs:
every scheme measured the same way, on the same scale. TEAM is built for needs
assessment and equity analysis, which asks a different question: who is short of
a stated standard, by how much, and what kind of change would fix it. Both can
be true of the same suburb at once, and the two outputs sit together without
contradiction.

## Running TEAM somewhere else

Nothing in the model is specific to Auckland. The inputs are a GTFS feed,
OpenStreetMap, a census with small-area population and household data, and a
list of destinations. Travel times come from R5. The pipeline, the standards and
the reason rules are open source, and the hexagon dataset is published with the
tool, so the figures above can be recalculated against different standards
without re-running the routing.

## Sources

Transport for NSW (2026). *Transport Access Indicators: Technical Development
Report for TAI-PT*. August 2026.

Transport for NSW (2026). *Transport Access Indicators: Technical Fact Sheet for
TAI-PT*. August 2026.

Transport for NSW (2026). *Transport Access Indicators: Frequently asked
questions for the prototype TAI-PT*. September 2026.

Transport for London (2015). *Assessing transport connectivity in London*.

TEAM's method is in [`methodology.md`](methodology.md); every published field is
in [`indicators.md`](indicators.md).
