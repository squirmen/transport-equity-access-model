# TEAM method

TEAM answers three questions for every populated part of twenty New Zealand
cities and towns and the land that commutes into them:

1. How long does it take to reach everyday services and jobs without a car?
2. Who lives where that takes too long?
3. What kind of change would bring those places within reach?

It reports plain quantities: minutes to the nearest service, the number of
jobs within a set time, and the number of people on either side of a stated
standard. There is no composite index. Each figure can be traced back to a
travel time, a destination list and a census count.

Each place has its own configuration in [`configs/`](../configs/), with the
same method and parameters; they differ only in their inputs and fares.

**What a place covers.** A place is built from Stats NZ's functional urban
areas (2023): an urban core with the satellite towns and rural land whose
workers commute into it (Stats NZ, 2021). That is the extent of a city as
people use it, rather than as its council boundary or its built-up edge draws
it. Census blocks are
assigned to a functional urban area by where their centre falls
(`scripts/add_city.py --fua`). Auckland covers the Auckland Council area, which
holds 99% of its functional urban area; Greater Christchurch adds the rest of
Christchurch City. Where one network serves several neighbouring areas they are
joined: Greater Wellington is the Wellington, Kāpiti Coast, Ōtaki and Masterton
areas with the four cities and the South Wairarapa towns, all on Metlink;
Greater Hamilton is Hamilton, Cambridge, Te Awamutu and Huntly on Busit;
Tauranga and Western Bay is Tauranga, Te Puke and Katikati on Baybus; and
Palmerston North and Feilding share Horizons' network. The rest are one area
each.

Together the twenty places hold 4.12 million of the 4.99 million people the
2023 Census counted (83%). Every urban area of 30,000 people or more is in,
with the towns and farmland that commute into it. Left out are towns that are
functional urban areas of their own but have little or no bus service in a
published timetable feed, among them Levin, Timaru, Ashburton, Oamaru, Hāwera
and Wānaka; Pōkeno and Tuakau, which commute to Auckland but lie outside the
Auckland Council area; and rural land beyond any functional urban area.

**Timetables without a feed.** Gisborne, Blenheim and Invercargill publish no
GTFS. Gisborne's and Invercargill's councils show their timetables through Ride
Guide, which serves every stop's position and every trip's times; TEAM reads
those for the two days it routes and writes them out as GTFS
(`scripts/build_rideguide_gtfs.py`), leaving out school-only routes. Blenheim's
times come from the council's printed timetable, placed on Ride Guide's stop
positions (`scripts/build_blenheim_gtfs.py`). A council's own GTFS, if one is
published, should replace these. Definitions of
every output field are in [`indicators.md`](indicators.md).

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
people near the edge are not cut off from services across it. Schools, early
childhood services and GPs come from national or regional lists and are kept
within about 8 km of the area; jobs cover the area's own statistical areas.

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
| Walking | 4.8 km/h, the speed used in public transport accessibility levels (Transport for London, 2015), slowed on slopes |
| Walking at a slower pace | 3.6 km/h (1 m/s), about the pace of people in their eighties (Bohannon & Williams Andrews, 2011); used for errand rounds and for public transport at a slower pace |
| Low-stress cycling | 15 km/h, on streets at traffic stress level 2 or below, slowed on slopes |
| Cycling on any bikeable street | 15 km/h, traffic stress level 3 or below |
| Public transport | walking up to 15 minutes to and from stops; median time over every departure minute in the window, including waiting |
| Car | uncongested driving; for reference only |

**Time windows.** Public transport is timed in three windows: the weekday
morning peak (07:00–09:00), weekday off-peak (10:00–12:00) and Saturday
(10:00–12:00). The weekday is a Tuesday in school term and the Saturday falls
in the same term. Each service has a usual window, which every figure uses
unless another time is picked: the weekday peak for schools, early childhood
services and jobs, and weekday off-peak for supermarkets, GPs and pharmacies.
Supermarkets, GPs, pharmacies and jobs are also timed in the other two
windows. School trips are timed in the peak only, because a Saturday school
run is not a real trip. Walking, cycling and driving times do not depend on
the clock.

Picking a time changes every public transport figure: travel times, fares,
the gravity scores and job access. Gravity scores in any window are indexed
against the usual window's regional mean, so a thinner Saturday timetable
shows as a lower score rather than being rescaled back to 100. Fares follow
the time too: Wellington charges less off-peak and at weekends, and SuperGold
travel is free after 9am on weekdays and all weekend.

**Hills.** Walking and cycling, including the walk to public transport, are
slowed on slopes by Tobler's hiking function, which R5 applies
from an elevation model sampled along each street. Each place's elevation
model is built from LINZ's national 1 m LiDAR elevation model where it has
been flown and LINZ's 8 m model elsewhere, averaged to a 20 m grid
(`scripts/build_dem.py`). LiDAR is bare earth, so a bridge takes the height of
the ground beneath it; a walk over a gully bridge is counted as down and up
again. Driving is not slowed by hills. The walk from the last stop of a public
transport trip, and walks between stops, are not slowed.

**Traffic stress.** R5 classifies every street from its OpenStreetMap tags,
following Mekuria, Furth & Nixon (2012). Level 2 or below covers off-road
paths, protected lanes and quiet residential streets, which most people are
willing to ride (Dill & McNeil, 2016). Level 3 adds streets a confident rider
would use. In Auckland the rating comes from SPAN, the lab's cycling
investment model, which rates each street from its facility, road class,
speed, lanes, traffic volume and intersections and Auckland Transport's
facility records. It is written onto each OpenStreetMap way as an `lts` tag,
which R5 uses in place of its own rating (`scripts/span_lts.py`); a way takes
the stress covering most of its length. Streets SPAN does not rate, mostly
footpaths and driveways, keep R5's rating.

**Public transport.** A public transport trip can be a walk the whole way when
the walk takes 15 minutes or less, the limit set for walking to and from stops.
Longer walks count only under walking, so a service 15 to 20 minutes away on
foot can show a longer public transport time than walking time. The median over
the window reflects the timetable a person would meet if they left at a random
minute, which is how frequency enters the measure.

For each hexagon and service, TEAM keeps the minutes to the nearest destination
by each mode, which destination that was, how many destinations are within 10,
15, 20 and 30 minutes, and the straight-line distance to the nearest.

**Errand rounds.** A single trip is not how most errands are run. A round
starts at home, stops at a GP, a pharmacy and a supermarket, and comes home;
the pharmacy comes after the GP, where the prescription is written, and the
supermarket can come at any point. Its length is the travel time only, not
the time spent inside. Legs from home are the service trips above; legs
between stops are routed from every stop to every other. Each home tries the
five nearest stops of each kind in every order allowed and keeps the quickest
round, which finds a GP with a pharmacy next door even when a nearer GP has
none. A round can also be limited on its longest stretch, since many people
manage several short walks and not one long one. Rounds are worked out for
walking, walking and public transport (the faster of the two on each leg),
and low-stress cycling, at the usual pace and the slower one, and for any two
or three of the stops. The way home from the last stop is routed for walking
and cycling, so a climb home counts; by public transport it is taken as the
way out. The standard is 30 minutes of travel for the round.

This draws on time geography (Hägerstrand, 1970), which treats what a person
can do as a path in space and time rather than a trip to one place.

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
   residents who could get there within *T* minutes by car or by the mode being
   measured: *R_j = S_j / Σ_k P_k*, over origins *k* that can reach *j* in time.
2. For each home location *k*, add up *R_j* over the job locations it can reach
   within *T* by the mode being measured: *A_k = Σ_j R_j*.

Competition counts everyone who could reach a job, however they travel.
Counting only people who can reach it by the same mode leaves jobs that public
transport barely serves with a handful of competitors, and gives the few
residents who can reach them ratios in the hundreds. *A_k* is divided by its
average over working-age residents, so 1.0 is the area's average for that mode.
Working-age residents are those aged 15 to 64.

Job access is shown as a count first, because a share of each area's own jobs
makes a small city look well served just for having few jobs to divide by.

**Inequality.** For each mode and time, TEAM reports the Palma ratio of job
access: the average of the best-served 10% of residents over the average of
the least-served 40% (Palma, 2011; applied to accessibility by Pereira et al.,
2019).

## 6. Gravity access scores

The standards in section 4 ask whether the nearest service is close enough. A
gravity score asks how much is within reach, counting every opportunity and
discounting each one by how long it takes to get to. The two answer different
questions and TEAM publishes both.

For origin *i*, purpose *p* and mode *m*:

*A_ipm = Σ_j W_j f_pm(t_ijm)*

where *W_j* is the size of destination *j* and *f* is an impedance function.
Sizes are jobs for employment, school rolls for schools, and 1 for
supermarkets, GPs and pharmacies, which have no published size.

**Impedance functions.** Four families are supported: negative exponential
*exp(-b t)*, gaussian *exp(-b t²)*, log-logistic *1 / (1 + (t/m)^b)* and the
Propensity to Cycle Tool's curve. Walking and public transport use the travel
time distribution parameters the NZ Transport Agency published for the New
Zealand accessibility analysis methodology (Abley and Halden, 2013, tables
13.2 and 13.4, Main Urban Area), fitted to the New Zealand Household Travel
Survey for 2003 to 2010. That report fits a negative exponential to the
cumulative distribution of surveyed travel times, and its lambda is already a
per-minute parameter on travel time, so it is used as published.

Its purposes are paired to TEAM's as: employment for jobs, shopping for
supermarkets, "other" for GPs and pharmacies, and the matching school category
for each school type. "Other" in that report groups medical and dental with
personal business, social welfare and social visits.

**How far each curve counts.** That method fits its curves to the first 95% of
surveyed travel times and counts nothing beyond, so each purpose and mode
carries its own horizon of *ln(20) / b* minutes rather than sharing one limit.
Walking to a supermarket stops at 30 minutes and walking to a job at 46, which
is what the survey says those trips look like. Public transport horizons run
past 80 minutes, longer than the 60 minutes TEAM routes, so those are clipped
at 60 and the public transport scores are cut shorter than the method intends.

**What the curves were fitted to.** Report 512 fits its curves to reported
door-to-door journey times, which include the walk at each end, waiting and
transfers. TEAM's routed times are door to door in the same sense: a public
transport time carries the walk to the stop, the wait, the ride, any transfer
and the walk at the other end. The two are the same quantity, which is what
makes the parameters transferable. They would not be if TEAM reported time on
board only.

**Where a cell is too thin to use.** The report marks cells with small samples
as reference only. Where the bus curve for a school type is marked that way,
TEAM uses the bus all-activities value instead rather than a number the source
says not to rely on. Each substitution is named in `configs/auckland.yml`.

**Cycling, in beta.** Report 512 does publish cycling curves, but every cycling
cell for a school trip is marked reference only, and the sample behind them is
thin. A thin local curve is not an improvement on a sound borrowed one, so
cycling
uses the Propensity to Cycle Tool's Go Dutch distance decay (Lovelace et al.,
2017, with the PCT 2020 coefficients), converted from minutes at the routed
cycling speed of 15 km/h.

The PCT logit describes how likely a commuter is to ride a trip of a given
length, and it rises to a peak around two kilometres because people walk the
shortest trips instead of riding them. That is a statement about which trips
get cycled, not about what a nearby destination is worth, so the curve is held
flat below its peak: everything inside the easiest riding distance counts in
full, and beyond it the weight falls as the PCT says cycling does. The
gradient terms are evaluated at the PCT's reference gradient, so the curve is
flat-terrain. The routed times allow for hills, so hills enter through the
time and not a second time through the curve. The same curve is used for every purpose, which a local survey would improve on.
The cycling score is labelled beta in the interface for these reasons.

The parameters are settings in each city's configuration rather than constants
in the code, so a local calibration is a configuration change. Report 512
fitted them to Main Urban Areas, so they fit the smaller towns, such as
Queenstown, less well.

**Reporting.** Each score is published three ways: the raw score, an index
where the population-weighted mean of the area is 100, and a population-weighted
decile from 1 to 10. The deciles put a tenth of residents in each band, so a
decile names people rather than a tenth of the map. Group figures average the
indices of their members, because the raw scores count different things and
cannot be added together. All opportunities is the mean of the three groups
(jobs, everyday services and education), so each counts a third.

**What a decile cannot say.** A decile is a ranking within one region at one
time. It cannot say whether access anywhere is adequate, it does not move when
access improves everywhere at once, and it cannot be compared between regions
or between runs. The raw score can, because it counts opportunities; the index
cannot, because each area's is scaled to its own mean. TEAM publishes
deciles because they are the unit TAI-PT uses and the comparison is useful, not
because a ranking answers the question.

## 7. Fares, and what they cost against income

**Fares.** Every network's fare table was read from its operator's fares page.
A fare depends only on the zones at each end of a journey, so the
origin-destination pairs already routed for the gravity scores are priced
rather than routed again. Auckland's zones are recovered from Auckland
Transport's printed map, because AT publishes no zone geometry. Every other
zone network (Wellington, Hamilton, Tauranga, Palmerston North, Napier-Hastings,
Nelson and New Plymouth) puts the zone on each stop in its timetable feed, so
each hexagon takes the zone of its nearest stop. Where a place lies inside one
zone or pays one fare, as Christchurch, Dunedin, Whanganui, Taupō, Tokoroa and
Whakatāne do, every trip costs the same. A journey's fare counts the zones it
passes through, capped as the operator caps it. Baybus prices each pair of
Western Bay towns rather than counting zones, so its pair fares are turned
into a count of rings out from Tauranga; the fare table lists the trips this
gets wrong, the largest being Tauranga to Ōmokoroa, charged $1.04 too much.
Metlink's zones are joined where their shapes touch, and consecutive zones are
joined directly where empty land such as the Remutaka Range leaves no path. Off-peak prices, and
SuperGold's free hours, follow the time of day being shown.

A fare budget turns into the number of zones a traveller can afford, and a
public transport trip counts only when it stays inside them. The budget covers
a return trip unless set to one way, because the transfer window joins the
legs of one journey and not a trip out and back.

**Fares against income.** The same fare is a different burden in different
places. TEAM measures it as the fare as a share of a day's income where the
traveller lives:

    burden = fare / (income / 365)

Income is the 2023 Census median household income of the SA1 around each
hexagon, divided by the square root of the SA1's average household size (the
OECD square-root equivalence scale), so a household of four on the same
income as a household of one counts as less well off per person. Because the
census gives a median income and a mean household size, this approximates the
median equivalised income rather than measuring it. Census income is for the
year to March 2023; it is raised by the growth in the Quarterly Employment
Survey's average ordinary-time hourly earnings, from $38.93 in the March 2023
quarter to $44.62 in the June 2026 quarter, a factor of 1.146. SA1 medians
the census publishes above $200,000 are held at that figure. Income is before
tax, so the burden against take-home pay is higher.

A trip that takes a given share of a day's income, made every day, takes that
share of income over a month. That is the 60-trip month Carruthers, Dick and
Saurkar (2005) use for the World Bank's public transport affordability index,
so the burden of a daily return trip reads directly against it. Weekly fare
caps, which lower the cost of travelling that often, are not applied.

The site uses the burden two ways. Its map shows the fare for the cheapest bus
trip that reaches the nearest destination inside the standard, as a share of a
day's income. It is counted whether or not the traveller could walk or cycle
instead, because plenty of people cannot. Its panel compares the average
burden in the most and least deprived fifths of areas, for everyone with a bus
there in time. And a fare budget can be set as a share of a day's
income instead of in dollars, which gives every area its own budget, so the
same share buys fewer zones where incomes are lower; every access and equity
figure then follows. This follows Guzman and Oviedo (2018), who judged a
public transport subsidy in Bogotá by what each income group could reach
within what it could afford, and El-Geneidy et al. (2016), who showed that
counting fares changes who comes out ahead on transit access.

Incomes describe an area, not a household: a low-income household in a
well-off area is counted at the area's income. Cells with no published income
take the city's median when they need a budget, and are left off the burden
map.

**Fare caps.** Several networks cap what a card pays in a day or a week.
The fare burden can count one return trip, or a return trip every day for a
week after the daily and weekly caps the traveller's way of paying qualifies
for, set against a week's income. Auckland caps AT HOP at $50 a week;
Christchurch, Gisborne, Hamilton and the Horizons towns publish their own.
Wellington has no cap, only passes, which a traveller must choose to buy and
TEAM does not assume.

## 8. How robust an answer is

Three checks sit behind each Access figure. **Every time of day:** the share
who meet the standard in every window a service is timed in, not only the one
on screen. **More than one way:** the share who could get there in time by two
or more of walking, low-stress cycling and public transport; someone with only
one way is one route or service change from missing out. **As the standard
moves:** the share meeting the standard at every standard from 5 to 60
minutes, for everyone and for the most and least deprived fifths of areas, so
a result that depends on the exact standard chosen shows it.

**Choice.** A standard asks about the nearest service. Where a GP's books are
closed or a supermarket is small, the number within reach matters too, so TEAM
counts every one within 10, 15, 20 and 30 minutes by walking, low-stress
cycling or public transport, taking whichever reaches the most, and reports the
share of people with two or more.

**Urban areas only.** Every place takes in rural land, where the question of
access without a car is a different one. The figures can be limited to
hexagons in Stats NZ urban areas of 1,000 people or more, the line Stats NZ
draws between an urban area and a rural settlement.

## 9. Who misses out

For each service and standard, TEAM counts the people living in hexagons that
miss it, overall and for groups: people in households without a car, children
under 15, people aged 65 and over, people in lower-income households, Māori,
Pacific peoples, Asian residents and disabled people. A group count is the
cell population multiplied by the group's share in the SA1 block, so it is an
estimate for an area rather than a count of individuals.

A headcount cannot tell a place three minutes over the standard from one
forty minutes over, so the site also reports how far short people are, using
the Foster-Greer-Thorbecke measures with the standard as the line (Foster,
Greer & Thorbecke, 1984; applied to accessibility by Lucas, van Wee & Maat,
2016). The shortfall of a place is its time past the standard as a share of
the standard, and zero where the standard is met. The headcount rate is the
share of people with any shortfall, the poverty gap index is the average
shortfall across everyone, and the squared gap index weights the worst off
most. A place with no route within the 60-minute routing limit counts at 60
minutes rather than being dropped, which would flatter the result where it is
worst.

Where the shortfall falls is a concentration index of the shortfall, ranked by
NZDep with the most deprived first (Wagstaff, Paci & van Doorslaer, 1991).
A negative index means the shortfall piles up in more deprived areas. Karner,
Pereira & Farber (2025) recommend ordered measures like this over Gini and
Theil indices, which describe spread without saying who is on the losing end.
Everything here is recomputed in the browser from what is on screen, so it
changes with the standard, the mode, the time and the fare budget.

With a fare budget set, the people who miss out are split into those who could
get there in time but not on that budget, and those too far away at any
price.

Results are also broken down by NZDep quintile (deciles 1–2 through 9–10),
giving the population share that meets the standard in each. The gap between
the least and most deprived quintiles is reported in percentage points.
Figures are summarised for each SA2 and, in Auckland, each of the 21 local boards.

## 10. Why a place misses a standard

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

## 11. Checks

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

## 12. What TEAM does not do

- It uses the nearest service. School zones, GP enrolment, opening hours and
  store size are not modelled, so the nearest service may not be one a person
  can use.
- Travel times come from timetables and street data, not observed journeys.
  Reliability, crowding and missed connections are not included.
- Walking and cycling allow for hills, but not lighting, footpath condition,
  benches or personal safety.
- Errand rounds ignore opening hours, time spent inside and carrying shopping.
- Census shares describe small areas. They do not say who in a hexagon misses
  out.
- The car reference ignores congestion and parking, so it understates driving
  times at busy periods.
- The reason rules are a first screen. They do not estimate the cost or effect
  of any fix.

## References

Abley, S. and Halden, D. (2013). *The New Zealand accessibility analysis
methodology*. NZ Transport Agency research report 512. Wellington: NZ
Transport Agency. ISBN 978-0-478-40717-4.

Atkinson, J., Salmond, C., & Crampton, P. (2024). *NZDep2023 Index of
Deprivation*. University of Otago, Wellington.

Bohannon, R. W., & Williams Andrews, A. (2011). Normal walking speed: a
descriptive meta-analysis. *Physiotherapy*, 97(3), 182–189.

Carruthers, R., Dick, M., & Saurkar, A. (2005). *Affordability of public transport in
developing countries*. Transport Paper TP-3, World Bank, Washington DC.

Conway, M. W., Byrd, A., & van der Linden, M. (2017). Evidence-based transit and
land use sketch planning using interactive accessibility methods on
combinatorial scenario designs. *Transportation Research Record*, 2653, 45–53.

Dill, J., & McNeil, N. (2016). Revisiting the four types of cyclists: findings
from a national survey. *Transportation Research Record*, 2587, 90–99.

El-Geneidy, A., Levinson, D., Diab, E., Boisjoly, G., Verbich, D., & Loong, C. (2016).
The cost of equity: Assessing transit accessibility and social disparity using
total travel cost. *Transportation Research Part A*, 91, 302–316.

Fink, C., Klumpenhouwer, W., Saraiva, M., Pereira, R., & Tenkanen, H. (2022).
*r5py: Rapid Realistic Routing with R5 in Python*. Zenodo.
https://doi.org/10.5281/zenodo.7060438

Foster, J., Greer, J., & Thorbecke, E. (1984). A class of decomposable poverty
measures. *Econometrica*, 52(3), 761–766.

Geurs, K. T., & van Wee, B. (2004). Accessibility evaluation of land-use and
transport strategies: review and research directions. *Journal of Transport
Geography*, 12(2), 127–140.

Guzman, L. A., & Oviedo, D. (2018). Accessibility, affordability and equity:
Assessing 'pro-poor' public transport subsidies in Bogotá. *Transport Policy*,
68, 37–51.

Hägerstrand, T. (1970). What about people in regional science? *Papers of the
Regional Science Association*, 24, 7–21.

Karner, A., Pereira, R. H. M., & Farber, S. (2025). Advances and pitfalls in
measuring transportation equity. *Transportation*, 52, 1399–1427.

Lovelace, R., Goodman, A., Aldred, R., Berkoff, N., Abbas, A., & Woodcock, J.
(2017). The Propensity to Cycle Tool: an open source online system for
sustainable transport planning. *Journal of Transport and Land Use*, 10(1),
505–528.

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

Pereira, R. H. M., Banister, D., Schwanen, T., & Wessel, N. (2019).
Distributional effects of transport policies on inequalities in access to
opportunities in Rio de Janeiro. *Journal of Transport and Land Use*, 12(1),
741–764.

Pereira, R. H. M., Schwanen, T., & Banister, D. (2017). Distributive justice and
equity in transportation. *Transport Reviews*, 37(2), 170–191.

Shen, Q. (1998). Location characteristics of inner-city neighborhoods and
employment accessibility of low-wage workers. *Environment and Planning B*,
25(3), 345–365.

Stats NZ (2021). *Functional urban areas: methodology and classification*.
Wellington: Stats NZ. Classification updated for 2023.

Transport for London (2015). *Assessing transport connectivity in London*.
Transport for London.

Transport for NSW (2026). *Transport Access Indicators: Technical Development
Report for TAI-PT*. August 2026.

Victoria State Government (2019). *20-minute neighbourhoods: creating a more
liveable Melbourne*. Department of Environment, Land, Water and Planning.

Wagstaff, A., Paci, P., & van Doorslaer, E. (1991). On the measurement of
inequalities in health. *Social Science & Medicine*, 33(5), 545–557.
