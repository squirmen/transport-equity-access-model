# TEAM, TAI-PT and PTAL

Transport for NSW is consulting on a prototype Transport Access Indicator for
public transport (TAI-PT), intended to replace Public Transport Accessibility
Levels (PTAL) in NSW. This note sets out how TEAM's measures are built and how
they differ from both. Descriptions of TAI-PT come from the documents Transport
for NSW released for consultation in August and September 2026, listed at the
end.

## In one table

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

## Where the three differ

**Units.** TAI-PT publishes deciles, which show where access is higher or
lower than elsewhere in the study area. TEAM reports minutes, counts and the
number of people on either side of a standard. A decile cannot say whether
access anywhere is adequate, and it does not change when access improves
everywhere at once; a count of people beyond a standard does both.

**Standards.** TEAM states a time for each service and asks who falls short.
That makes the result a statement of need rather than a ranking. The standards
are settings and can be changed in the web app or applied afresh to the
published travel times.

**Destinations and weighting.** TAI-PT sums many kinds of opportunity, each
weighted by size, by how often people visit that kind of place, and by a
travel-time decay fitted to the NSW Household Travel Survey. TEAM measures a
short list of everyday services one at a time, using the nearest of each, and
counts jobs within fixed times. TEAM's figures are simpler and can be checked
by hand; TAI-PT's single score covers more of daily life.

**Modes.** TAI-PT measures public transport with walking, and does not assess
the quality of walking or cycling routes. TEAM also measures walking and
cycling on their own, and separates cycling on low-stress routes from cycling
on any street, so the gap between the two shows where a safe connection is
missing.

**People.** TEAM counts the residents behind each result and breaks them down
by deprivation, households without a car, children and older people. TAI-PT
leaves that step to the user.

**Diagnosis.** For each place that misses a standard, TEAM gives a screening
reason: an indirect walking route, no low-stress bike route, infrequent public
transport, a slow public transport trip, or no service nearby. Neither PTAL nor
TAI-PT reports why access is poor.

**Time of day.** TAI-PT scores each hour separately. TEAM takes the median over
every departure minute in a two-hour window, so waiting for an infrequent
service is part of each time.

## Where each fits

PTAL and TAI-PT give a consistent, region-wide measure of public transport
access for use in business cases and transport impact assessments. TEAM is
designed for needs assessment and equity analysis: finding the people without
adequate access to everyday services and pointing to the kind of change that
would help them. The approaches can sit side by side; they answer different
questions.

## Sources

Transport for NSW (2026). *Transport Access Indicators: Technical Development
Report for TAI-PT*. August 2026.

Transport for NSW (2026). *Transport Access Indicators: Technical Fact Sheet for
TAI-PT*. August 2026.

Transport for NSW (2026). *Transport Access Indicators: Frequently asked
questions for the prototype TAI-PT*. September 2026.

Transport for London (2015). *Assessing transport connectivity in London*.

TEAM's own method is in [`methodology.md`](methodology.md).
