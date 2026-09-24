# What TEAM measures, and how it relates to PTAL and TAI-PT

TEAM asks how long it takes to reach everyday needs without a car, who lives
where that takes too long, and why. In Auckland, 87% of residents can reach a GP
within 20 minutes on foot, on a low-stress bike route or by public transport.
The other 203,000 are the point of the model: it names them, counts them,
describes who they are, and gives a reason for each place they live.

Transport for NSW is consulting on a prototype Transport Access Indicator for
public transport (TAI-PT) to replace Public Transport Accessibility Levels
(PTAL). TEAM now carries both kinds of measure: minutes against a stated
standard, and a gravity score of the TAI-PT kind, with a toggle between them in
the web app. This note sets out what TEAM measures, what the two answer, and
where they sit next to PTAL and TAI-PT. Descriptions of TAI-PT come from the
documents Transport for NSW released in August and September 2026, listed at
the end.

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

## The second measure: a gravity score

Standards answer whether the nearest service is close enough. They say nothing
about how much else is within reach, and they treat the second supermarket as
worth nothing. So TEAM also publishes a gravity score, built the way TAI-PT
builds its measure: every opportunity counted, each one discounted by how long
it takes to reach.

The impedance functions are TAI-PT's own, from Table 4.9 of the technical
report, fitted to the New South Wales Household Travel Survey and paired to
TEAM's purposes. Walking uses their walking function, public transport uses
their combined public transport and walking function. Those parameters describe
Sydney travel, not Auckland travel, and are a starting point chosen so the two
measures line up rather than a local calibration. They are settings in the
configuration file. Journeys over 45 minutes are not counted.

Each score is published three ways: the raw score, an index where the
population-weighted regional mean is 100, and a population-weighted decile from
1 to 10. The deciles put a tenth of residents in each band, so a decile names
people rather than a tenth of the map.

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

On the gravity score, with 100 as the regional average, the typical Auckland
resident scores 72 for all opportunities by public transport and 52 for jobs.
Access is far more unequal than the standards suggest: the best-served tenth of
residents score 15 times the least-served 40%.

Both measures track behaviour about equally well. The gravity score for jobs by
public transport rises with the share of workers who did not drive to work
across the 611 SA2s, with a Spearman's rho of 0.60, against 0.61 for the
45-minute job share. Neither is a calibration, and the agreement is a reason to
publish both rather than to prefer one.

The deprivation pattern also holds on the new measure, in the same direction
and for the same reason: by public transport the most deprived fifth of
neighbourhoods score 84 against 36 for the least deprived fifth, because
deprivation in Auckland sits closer to the centre.

The second finding is the one that shapes policy advice. A map of relative
access would show the same rural areas scoring low. It would not show that the
people furthest from a GP are mostly not the most deprived, or that the
deprivation gap reverses once location is held constant.

## Side by side

| | PTAL | TAI-PT (prototype) | TEAM |
| --- | --- | --- | --- |
| Question | How much public transport service is near here? | How easily can people reach opportunities from here by public transport, relative to elsewhere? | How long does it take to reach everyday needs without a car, who lives where that is too long, and why? |
| Measure | walk time to stops plus average wait, from frequency | gravity model: opportunities weighted by attractiveness, discounted by travel time | minutes to the nearest service; jobs within 30 and 45 minutes; and a gravity score on the same impedance functions as TAI-PT |
| Result | index, grouped into levels 0 to 6b | raw score, published in deciles of relative access | minutes, counts and people; whether a stated standard is met; and the gravity score as a raw score, an index against the regional mean, or deciles |
| Destinations | none | 15 sub-categories in 8 broad groups, including employment, education, health, food shopping, and social and leisure | supermarkets, GPs, pharmacies, primary, intermediate and secondary schools, and jobs |
| How extra opportunities count | – | each further opportunity of the same kind adds less (diminishing marginal utility) | nearest only under the standards; every opportunity, discounted by travel time, under the gravity score; job access also adjusted for workers competing for the same jobs |
| Modes | public transport, walking to stops | public transport and walking | walking, low-stress cycling, public transport; cycling on any street and car for comparison |
| Time | a fixed peak period | hourly scores for a typical Tuesday and Saturday; the prototype maps weekday 08:00–09:00 and 12:00–13:00 | median over a two-hour window (07:00–09:00 for schools and jobs, 10:00–12:00 for other services) |
| Spatial unit | grid points | H3 resolution 10 (about 0.015 km², 130 m across) | H3 resolution 9 (about 0.1 km², 350 m across) |
| People | not included | can be overlaid by the user | built in: people below each standard by deprivation, car ownership and age |
| Why access is poor | not reported | not reported | a screening reason for each place that misses a standard |
| Travel times | – | hourly matrices from the GTFS timetable | R5 with the GTFS timetable |
| Code and data | published method | prototype released for consultation | open source; the hexagon dataset is published with the tool |

## The differences that matter

**Units.** TAI-PT publishes deciles, which show where access is higher or lower
than elsewhere in the study area. TEAM leads with minutes, counts and the number
of people on either side of a standard, and offers the score, the index and the
deciles beside them. A decile ranks; a count of people beyond a standard states
a need and can be set against a target, a service change or a budget. Having
both in one tool makes the difference visible: the same suburb can sit in a high
decile and still hold thousands of people beyond a 20-minute standard.

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

TEAM is built by the [Better Places Lab](https://betterplaces.blogs.auckland.ac.nz)
at Waipapa Taumata Rau | University of Auckland. Questions, corrections and data
offers: t.welch@auckland.ac.nz
