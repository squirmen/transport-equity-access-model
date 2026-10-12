# Interface and colour decisions

## Layout

The map fills the window. On the left is one column: the panel, then the key
docked under it. A hexagon's card opens on the right. On a phone both become
one bottom sheet. The look is the Better Places Lab's; the structure follows
MATE's, so the lab's map tools work the same way.

The panel reads top to bottom in one order: Place, Getting to (a grouped list
that also holds the access scores), Travel by (the ways that count as
segments, with the comparisons under More), then the three questions as tabs:
how long it takes to get somewhere (Access), who is beyond the standard (Who
misses out), and why (What would help). Each tab's body is a small row saying
what the map shows, the number, one sentence, at most one note, then folded
detail (charts, area lists, methods), each fold with a short summary. Which
folds are open is kept for the session.

Who misses out and What would help count the fastest way without a car, so on
those tabs Travel by shows Best with the other ways disabled.

Settings (who is counted, when, the standard, the jobs window, fares and the
traveller) and Layers (grouped, with captions and the basemap) are drawers
under the tab's body. One opens at a time; while one is open the tab's body
and the key fold away. Each drawer's button says what is set, so folding
them hides nothing; Settings counts what differs from the defaults and Layers
counts the layers on.

The key is the only key. It names the view, holds its scale (with the
standard marked), the toggles that belong to the view (the reasons on What
would help, Only where they miss the standard and Rest homes and villages on
Where they live), the layers that are on, and MATE's catchment when one is
drawn. The panel scrolls before the key gives way.

The area in the headline is a button: it opens the list of areas the figures
can be for (the whole place, the areas under the middle of the map, and the
local boards).

Basemap and zoom sit top right, the scale bottom left beside the column, and
the map credits behind an (i). The picked hexagon has a navy outline over a
white halo, so it reads on blue and on orange.

The card answers first: a band for the service and way of travelling on
screen (Meets, Misses or Doesn't count), a line for every standard, three
numbers (jobs within 45 minutes, the nearest stop with four or more
departures an hour, the access score), then folded sections: services, jobs,
around here, who lives here, how the place stands. The address always carries
the hexagon picked (`o=`).

On a phone the sheet has three heights: a peek with the headline and the key
as one strip, half with the panel down to the headline, and full. The card
takes the sheet's place, with the key as a strip over the map above it. Touch
targets are 44 px and inputs use 16 px text.

Interface colours and type follow the Better Places Lab: navy `#0c0c48` for
text accents and selected controls, teal `#1f6178` for links and focus, Inter
for all text, MATE's type scale with a 40 px headline figure.

The map's box is set in `index.html` rather than the stylesheet, and the map
is made only once the stylesheet applies: WebKit can run the module before a
slow stylesheet arrives.

## Data colours

Data colours are chosen by the job each does and checked for colour-blind
readers by `tests/web/palette.test.mjs`, ported from MATE's test: each colour
is passed through Machado, Oliveira and Fernandes (2009) at severity 1 for
protanopia, deuteranopia and tritanopia and compared in CIEDE2000. Categories
drawn with the same mark differ by 9 or more in every vision; each step of a
ramp differs from the next by 9 or more.

| Map | Job | Colours |
| --- | --- | --- |
| Minutes to the nearest service | diverging at the standard | blue `#184f95` `#3987e5` `#9ec5f4` · orange `#f8ad8b` `#d65d15` `#833607` |
| What it costs (Fare) and Fare burden | free, then the fare | free in the minutes blue `#3987e5`, fares in orange `#fbd3bd` `#f39a66` `#d65d15` `#833607`, no way in time dark grey `#5d5a55` |
| People beyond the standard | sequential | `#fecbb4` `#f0986f` `#d56326` `#933d09` |
| Where a group lives | below the place's share grey, above it purple | `#e9e7e2` `#c2bfb6` · `#b49ce0` `#8f71c9` `#4b2a7a` |
| Share of jobs within reach | sequential | `#b7d3f6` `#6da7ec` `#2a78d6` `#184f95` `#0c3163` |
| Job access against the average | diverging at 1.0 | orange arm, grey `#f0efec`, blue arm |
| Main reason | categorical | blue `#2a78d6`, orange `#e8890c`, teal `#0e7a7e`, grey `#8f8c85` for nothing within reach, purple `#7a3fa0` for the fare |
| Destination pins | categorical | food teal `#0e7a7e`, health dark red `#a8172b`, learning orange `#e8890c`, anything else navy |
| Which way a measure leans | two dots | fair way blue `#3b7fb6`, unfair way dark red `#a8172b` |

The 13 October audit found three palettes that failed: the fare ramp ran
green to red (lime and yellow 8.7 apart for protanopia), the reasons' green
and grey were 7.2 apart for deuteranopia, and the pins' green and red 7.0. The
jobs ramp's two darkest steps (8.5) and the two greys of where a group lives
(6.6) were close too, and were darkened or lightened a little. The test also
checks that the old fare, reason and pin colours would fail.

The lightest step of each ramp is below 2:1 contrast against the grey basemap.
For map fills this is intended: the light end means "close to the standard",
"few people" or "few jobs" and should recede. Each reason is also named, with
its count, in the key, the ranked places and the card, so colour is never the
only way to read it.

## Writing

Every label and sentence is written for a planner reading quickly: the number
first, then one plain sentence, then a note only where a reader would
otherwise misread the figure. The same wording is used in the app, the
downloads and these documents.

## MATE in the hexagon card (preview)

With `?mate=1` in the address, an Auckland hexagon's card ends with a section
from MATE, the lab's map of footpaths for people with limited mobility. It
stays behind the flag until the Devonport field check is done. Without it the
site is as it was, and `js/mate.js` is never loaded. MATE builds its files into
`data/auckland/mate/` (MATE's `docs/team_export.md`); the card fetches two of
them on the first click and one small file for each area clicked after that.
Other places' cards say trips and mobility profiles are not yet there, and
load nothing from MATE.

- **Each profile, side by side.** Walking, the older walker, both
  wheelchairs, the pram, the child on their own and the cargo bike: hexagons
  within 15 minutes and minutes to the nearest stop and frequent stop, each
  next to the census group it most nearly describes. A profile picker chooses
  the one the rest of the section and the map are about.
- **Ranges.** Every figure is the no-known-barrier one, then the one if
  unrecorded parts take three times as long: "6, or 5". Nothing unknown is
  shown as passable without saying so.
- **What is in the way.** The footpath's status for the profile in MATE's own
  colours (blue no known barrier, orange harder, grey hatched not known, dark
  red barrier), then the street centre line routes follow where no footpath is
  drawn, with its status, then steps, slope, width (recorded and estimated,
  against the profile's own width limit), kerbs and main-road crossings.
  Kerbs and lighting lead with how much is recorded; estimates say so. The
  kerb line also counts what routing assumes: street junctions with no
  crossing mapped, and footpaths joined where they stop just short, both with
  kerbs not recorded. These are what the cautious figure counts against.
- **After dark** swaps in the older walker's and the child's after-dark rules.
  Public transport stays by day, and the card says so.
- **Public transport** gives the nearest stop each profile can reach, by name,
  and each profile's reach within 45 minutes, as an estimate: the walker's
  trip from TEAM's routing with the profile's own walks to and from its stops.
  It follows the time picked under When, and otherwise the window of TEAM's
  jobs line above it. Its walking row is MATE's estimate made the same way, so
  the profiles compare with it; the card gives TEAM's own figure beside it and
  says why the two differ.
- **The map** colours hexagons by minutes on foot from the selected one for the
  chosen profile, in the blues of the minutes map (5, 10 and 15 minutes), and
  hatches in dark orange over light orange those that walking reaches and the
  profile does not. The docked key shows the catchment's scale and the switch
  between no known barrier, cautious and TEAM's map; on a phone it is the strip
  above the card.
- **The card's section** is one fold, "On foot, by profile", with the profile
  picker, after dark, the headline and the footpath's status bar at its top
  and the rest folded inside it: every profile, using only what is recorded,
  services on foot, what is in the way, lighting, public transport, the map,
  and assumptions and sources.
- **The address** carries the hexagon (`o=`, now always) and the MATE settings (`mp=`,
  the profile with `d` for after dark, `c` for cautious and `x` for TEAM's
  map), so a link opens on the same card.
