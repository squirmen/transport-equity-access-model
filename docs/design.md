# Interface and colour decisions

## Layout

The map fills the window. A control panel sits top left and a place panel
opens top right when a hexagon is selected; on phones both become sheets at the
bottom of the screen. Search, basemaps and layers sit top right. The pattern
follows ALTO, the lab's tree observatory, so the two tools work the same way.

The panel asks three questions in order: how long it takes to get somewhere
(Access), who is beyond the standard (Who misses out), and why (What would
help). Each view leads with one number and one sentence, then its controls,
then its legend or charts. The standard slider sits above the tabs because it
changes all three views.

Interface colours and type follow the Better Places Lab: navy `#0c0c48` for
text accents and selected controls, teal `#1f6178` for links and focus, Inter
for all text.

## Data colours

Data colours are chosen by the job each does and checked with the data-viz
palette validator (OKLab distances, Machado–Oliveira–Fernandes colour-vision
simulation).

| Map | Job | Colours | Result |
| --- | --- | --- | --- |
| Minutes to the nearest service | diverging at the standard | blue `#184f95` `#3987e5` `#9ec5f4` · orange `#f8ad8b` `#d65d15` `#833607` | each arm: lightness monotone, steps ≥ 0.06 apart, single hue; the two arms matched step for step (L 0.81, 0.62, 0.43) |
| People beyond the standard | sequential | `#fecbb4` `#f0986f` `#d56326` `#933d09` | lightness monotone, steps ≥ 0.06 apart, single hue |
| Share of jobs within reach | sequential | `#b7d3f6` `#6da7ec` `#2a78d6` `#184f95` `#0d366b` | lightness monotone, steps ≥ 0.06 apart, single hue |
| Job access against the average | diverging at 1.0 | orange arm, grey `#f0efec`, blue arm | as above, neutral midpoint |
| Main reason | categorical, three hues and grey | `#2a78d6` `#eb6834` `#1baf7a`, grey `#8f8c85` | all-pairs colour-vision separation 9.2 (target 8), normal-vision 24.0 (floor 15) |

The lightest step of each ramp is below 2:1 contrast against the grey basemap.
For map fills this is intended: the light end means "close to the standard",
"few people" or "few jobs" and should recede. Two of the three reason hues are
below 3:1 against the basemap; each reason is also named, with its count, in
the panel list, the ranked places and the place panel, so colour is never the
only way to read it.

Maps allow only three categorical hues before neighbouring colours become hard
to tell apart, so the four reasons use three hues for the transport fixes and a
neutral grey for "nothing within reach". Picking a reason in the list fades
the others.

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
Other places say MATE has no footpath data there yet.

- **Each profile, side by side.** Walking, the older walker, both
  wheelchairs, the pram, the child on their own and the cargo bike: hexagons
  within 15 minutes and minutes to the nearest stop and frequent stop, each
  next to the census group it most nearly describes. A profile picker chooses
  the one the rest of the section and the map are about.
- **Ranges.** Every figure is the no-known-barrier one, then the one if
  unrecorded parts take three times as long: "6, or 5". Nothing unknown is
  shown as passable without saying so.
- **What is in the way.** The footpath's status for the profile in MATE's own
  colours (green no known barrier, amber harder, grey not known, red
  barrier), then the street centre line routes follow where no footpath is
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
  profile does not. A key sits beside the card, and as one strip above the card
  on a phone. The card can switch the map to the cautious figures or back to
  TEAM's view.
- **The address** carries the hexagon (`o=`) and the MATE settings (`mp=`,
  the profile with `d` for after dark, `c` for cautious and `x` for TEAM's
  map), so a link opens on the same card.
