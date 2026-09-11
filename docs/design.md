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
