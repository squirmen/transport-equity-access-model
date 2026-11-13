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
them hides nothing; Settings counts what differs from the build's defaults
for what is on screen (a link or a reload that spells the defaults out counts
nothing) and Layers counts the layers on.

The key is the only key. It names the view, holds its scale (with the
standard marked), the toggles that belong to the view (the reasons on What
would help, Only where they miss the standard and Rest homes and villages on
Where they live), MATE's catchment when one is drawn, what a trip draws on
its Trip tab, and under "On the map" every symbol on screen as icon and label
pairs that wrap, the most needed first (Map symbols, below). The panel keeps
room down to the end of its headline (the figure, its sentence and the line
under it); the key takes what is left, up to 46% of the column, and scrolls
inside that. Where that leaves too little for the key's scale and symbols, it
takes more, but never past the headline figure: the figure is always in view
and the sentence scrolls up into it (checked at 1280 × 720 to 1536 × 864; at
1440 × 900 the figure, most of the sentence and every symbol under One school
for Mt Albert Grammar School fit). The line saying which schools are counted
is not part of the headline here, as under In zone it is a long list. Folded,
or squeezed to its title, the key shows the symbols on screen as a row of
small icons beside the title; while its body scrolls it can be reached with
the Tab key.

Under the Schools choices sit only what changes the figure: the school picked
with Zoom to its zone and Clear, Find a school (one line, with how to use it
shown under it while it has the cursor) and Only those living in its zone.
The school's facts, the stops near it and the CSV download come after the
headline, so a laptop screen shows the headline and the key together.

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

On a phone the sheet has three heights: a peek with the headline, the scale
and up to two lines of the symbols on screen, half with the panel down to the
headline, and full. The card takes the sheet's place, with the key (scale and
symbols) as a strip over the map above it. The scale and credits sit above
whichever sheet is up, measured as its height changes. Touch targets are 44
px and inputs use 16 px text.

TEAM has a light page only (`color-scheme: light`): a phone or computer set to
dark mode shows the same page. The symbols were checked on Satellite as the
dark ground.

Interface colours and type follow the Better Places Lab: navy `#0c0c48` for
text accents and selected controls, teal `#1f6178` for links and focus, Inter
for all text, MATE's type scale with a 40 px headline figure.

The map's box is set in `index.html` rather than the stylesheet, and the map
is made only once the stylesheet applies: WebKit can run the module before a
slow stylesheet arrives.

## Map symbols

From 0.12.1 every point on the map is a MapLibre symbol: shape says what kind
of thing it is, a glyph says which one, fill and ring say its state, and the
key lists each symbol only while it is on screen. Before, schools, stops and
places were all small circles, and the stops near a school were numbered boxes
the key did not explain.

| Shape | Means | Used for |
| --- | --- | --- |
| Disc | a place you are getting to | schools, supermarkets, GPs, pharmacies, libraries, banks and post shops, early childhood, tertiary, trades training |
| Rounded square | public transport | bus stop; train station and ferry terminal with a white line inside the edge; a trip's A and B |
| Map pin | the one picked | the school picked under One school, with its name in a navy pill |
| Pill | a time or a name | the walk from a stop to the school ("7 min"), a trip's route |
| Line | a network or a boundary | zone outline, rail, ferry, frequent bus, cycleway, trip lines |

- **Glyphs.** Material Icons, filled, by Google (Apache License 2.0), and
  for train stations Temaki's `tram_side` (CC0), kept in `web/assets/icons/`
  as fetched, with both licences and each file's source address and commit.
  `scripts/build_glyphs.py` writes their path data into `web/js/glyphs.js`
  (with the grid of any not on Material's 24 px, Temaki's being 15 px), and
  the page draws every symbol on a canvas from it (`web/js/symbols.js`), at
  the screen's pixel ratio (2 or 3). Tertiary shares the schools'
  mortarboard; only one service's places are drawn at a time and the key
  names it. No operator's marks. A station is a rail car in side view, so it
  is not taken for a bus stop: Material's train and bus are both a vehicle
  seen from the front and look alike at map size. The white line inside a
  station's edge, its size and navy tell it apart as well.
- **Walking badge.** A white pill on a stop near the school, with a walking
  person, the minutes in bold and "min": "7 min", and "<1 min" for a walk
  under a minute (walks are rounded down). Its width depends only on how many
  digits the number has, so it is redrawn the same size once Inter loads.
  The key's row and the stop list show the same badge; the tooltip and the
  read-out say "7 min walk to the school".
- **State.** Filled with a white glyph: counted, or a stop with trips. White
  with a grey glyph and ring: not counted, or another school under One school.
  White with a dashed grey ring: a stop with no trips arriving in the morning
  window, which has no walking badge either. Slate always means a bus stop
  with buses: in Layers one under four an hour is slate too, drawn smaller.
  State is never colour alone: filled against hollow, a pin for the one
  picked, a dash for no trips, size for frequency, and words in the key and
  the tooltip.
- **Edge.** Each symbol has a 2 px white halo and outside it a 1.5 px dark
  edge, so one or the other is 3:1 or more on every basemap and hexagon
  colour, still at the smallest size a symbol is drawn (0.7). Rail and
  frequent bus lines sit on a white casing for the same reason. Streets is
  shown with its colour muted, so OpenStreetMap's own blue stop marks are not
  taken for TEAM's.
- **Zoom.** Below the zoom where a glyph would be a smudge, a symbol is its
  plain shape, and the key shows it so: schools take a small glyph from zoom
  11 and the full one from 13, stations theirs from 12, bus stops from 13
  (the Stops layer's bus stops start at 12.5). Below 12 the stops near a
  school are only its stations. Images are picked per tile, at whole zooms.
- **Crowding.** MapLibre places symbols top layer first: the school picked,
  the walking badges, the stops near it, its name, the schools counted or the
  service's places, the schools not counted, then the Stops layer. Stops near
  the school are always drawn and take no room from anything. The badges of
  the nearest station and the nearest bus stop with trips always show; the
  rest show where they fit, stations first and then the quickest walks, from
  zoom 13 (stations' from 12). Two stops of the same name within 80 m
  (either side of a road) are one symbol below zoom 16.5, with the quicker
  walk on its badge: near Mt Albert Grammar School 35 stops are 23 symbols. A
  badge sits on the side of its stop away from the school. The school's name
  shows beside its pin from zoom 14.5 where no badge is in its way. In the
  Stops layer a station's platforms or a terminal's piers are one symbol
  below zoom 16. The service's places (Layers) may overlap at city zooms:
  their density is the point, and the map has no font server to draw counts
  on cluster discs.
- **Hover, tap and keyboard.** Hovering a symbol rings it and shows its name
  and what it is; a click or tap opens the same in a popup, with its button
  ("Show only this school"), or in the sheet on a phone. A tap takes the
  symbol under the finger, or else the nearest within 22 px. With the map
  focused from the keyboard a ring marks its middle, the arrow keys move it,
  what is under the ring is read out once the map has settled, N and Shift+N
  step the ring through the symbols in view (nearest first, "3 of 26"),
  Enter opens what is under it and Escape closes it again. The map's canvas
  is the one region named Map, and its name says how to use it.
- **Picking a school.** The Schools row always has "Find a school"; a pick
  shows only that school, with Zoom to its zone and Clear (back to the
  choice before). Every school choice shows the service's school pins, All
  too, and a pin's popup offers "Show only this school". Each school the card
  names is a link that does the same. One school with none picked shows no
  figure until one is picked, and the link says `sch=one`.

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
| Destination pins | categorical, each with a white glyph | food teal `#0e7a7e`, health dark red `#a8172b`, learning purple `#5b2a86`, anything else dark brown `#3e2723`. Before 0.12.1 learning was orange `#e8890c` (a white glyph did not read on it, and orange means beyond the standard) and anything else navy, the train's colour |
| Public transport | categorical, each with its own glyph | bus slate `#455a64`, train navy `#0c0c48`, ferry ocean `#0277bd`, on stops, stations and lines; not any operator's colours |
| Which way a measure leans | two dots | fair way blue `#3b7fb6`, unfair way dark red `#a8172b` |
| Where a trip's origin gets (while picking) | sequential | `#184f95` `#3987e5` `#9ec5f4` `#dbe8f8` for 10, 20, 30 and 45 minutes |
| A trip's two ends | two rings | From navy `#0c0c48`, To teal `#1f6178`, each over a white halo and labelled |
| What a trip draws | lines over a white casing | walks dashed slate `#55646c`, the ride navy `#0c0c48`, a route on foot in MATE's no known barrier `#3b7fb6`, harder `#e8890c` and not known `#8a938d` (dashed) |

While a trip's lines are drawn, TEAM's hexagons under them are filled at 0.35
rather than 0.84, and the key's scale is faded to match. The route on foot
uses MATE's blue and orange, which mean something else on TEAM's minutes map;
faded, the hexagons step back and the lines read first, and every line has a
white casing. Over the darkest blue hexagons the walk dash goes from 1.06:1 to
2.8:1 and the route's blue from 1.35:1 to 2.0:1 (WCAG ratio, before the
casing); against its casing the walk is 6.1:1, the route's blue 4.3:1 and its
orange 2.6:1.

The test also checks the map symbols: a white glyph is 4.5:1 or more on every
pin and stop colour (the ferry's 4.8:1 is the lowest), on each
basemap's common ground and each hexagon colour either a symbol's white halo
or its dark edge is 3:1 or more at the smallest size drawn, every place colour
differs from every public transport colour by 9 or more under normal vision
and 6 or more under each simulated one, and learning is far from the orange
arm of the minutes map.

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

## Trips (preview)

Behind `?mate=1` and in Auckland only, like MATE's section; elsewhere the card
says trips are not yet there. Without the flag nothing below loads.
`js/trip_data.js` fetches the figures (TEAM's `pairs/`, `docs/pairs.md`, and
MATE's `stops/` and `graph/`) and `js/trip.js` draws the Trip tab; both load
the first time a trip is planned.

- **Picking.** "Plan a trip from here" on the card puts a navy strip at its
  top ("Pick where to go", Cancel) and colours the map by how far the origin
  gets in 10, 20, 30 and 45 minutes: the fastest of walking, low-stress
  cycling and public transport, or the way of travelling on screen. The key
  says which. The hexagon under the pointer is dashed in teal and its
  tooltip gives the minutes. Escape or Cancel stops; the same hexagon says
  "Pick another". With a keyboard the map takes focus, the arrow keys move
  it and Enter picks the hexagon under the mark in the middle. On a phone
  the card drops to a strip and a tap picks.
- **The card.** The header becomes the trip (how far in a straight line, from
  and to, the time window) with Swap and Close. Close ends the trip and goes
  back to the From card. Three tabs: From and To are each end's own card,
  with MATE's section; Trip is the trip. Both ends stay ringed and named on
  the map on every tab. The trip's lines and stops are drawn on the Trip tab
  only, over TEAM's view faded; From and To show MATE's catchment for that
  end, with no trip lines.
- **The Trip tab.** Walking, low-stress cycling and any-street cycling
  (comparison) from TEAM's pairs, kept to 20 minutes; public transport in all
  three windows, kept to 45, the one shown in bold (each is a button that
  changes When). Then the walker's trip in that window: a bar to scale (walks
  grey, waiting hatched, rides navy), the walk to the first stop, the rides
  with their route numbers, the walk from the last stop, and how often that
  path was used. The minutes are rounded by the largest remainder, so the bar,
  the three steps and the total in the title always add up. Rides drawn on the map follow the line's shape where the map
  draws it, and otherwise go straight from stop to stop.
- **First and last mile, by profile** (an estimate): the walker's trip with
  each profile's own walk to and from the same stops on MATE's footpath map,
  each as a range ("3, or 4"; "none" where the walk is over 15 minutes). A
  line above the profiles says they are on MATE's footpath map, so their
  walking can differ from TEAM's by a minute or two.
- **On foot, by profile** (trips up to 3 km in a straight line): each
  profile's minutes on MATE's map, routed in the page on MATE's graph tiles
  for every profile and both views, with the route for the profile chosen
  drawn on the map in MATE's status colours and what it passes in words
  (metres by status, crossings and kerbs, steps, what nobody has recorded).
  Its line gives the range first, then which route is drawn ("Manual
  wheelchair: 35, or 40 min. Route shown: no known barrier, 35 min.").
- **Fold summaries** name the profile in full and give the unit ("manual
  wheelchair: 10, or 6 hexagons" on From and To, "manual wheelchair: 34, or
  35 min" on Trip).
- **The key**, on the Trip tab, keeps TEAM's scale (faded, without its notes)
  and adds a line for each part drawn: the stops, the ride (and whether it is
  drawn straight) and the walks; or whose route on foot it is, with its three
  colours. A phone's strip over the map carries the same lines. The two ends
  need no row: each is named on the map.
- **The address** carries the destination as `d=` beside `o=`; a link with
  both opens on the Trip tab.
