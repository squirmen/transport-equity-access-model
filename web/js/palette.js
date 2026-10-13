// Data colours, chosen by the job each does and checked with the data-viz
// validator (docs/design.md records the results). Interface colours are in team.css.

// Minutes to the nearest service, diverging at the standard. Blue is within it
// (darker is faster); orange is beyond it (darker is slower). The two arms are
// matched step for step in lightness.
export const ACCESS = ['#184f95', '#3987e5', '#9ec5f4', '#f8ad8b', '#d65d15', '#833607'];

// People missing the standard in a cell: one hue, light to dark.
export const PEOPLE = ['#fecbb4', '#f0986f', '#d56326', '#933d09'];

// Where a group lives: its share of residents set against its share across
// the whole place. Below that share is quiet grey; above it, purple darkens,
// so the eye goes to the concentrations.
export const CONCENTRATION = ['#e9e7e2', '#c2bfb6', '#b49ce0', '#8f71c9', '#4b2a7a'];

// Rest homes and retirement villages, marked apart from the 65+ scale.
export const VILLAGE = '#5f9e94';

// People per hexagon, when the group is everyone: one hue, light to dark.
export const DENSITY = ['#ddd3ee', '#a58ed1', '#6f4fb0', '#43287a'];

// Destination pins by kind of place, so a pin says what it is before it is
// clicked: food teal, health dark red, learning orange, anything else navy.
// Not green against red, which colour-blind readers cannot tell apart
// (tests/web/palette.test.mjs).
export const DESTINATION_COLOURS = {
  supermarket: '#0e7a7e',
  gp: '#a8172b',
  pharmacy: '#a8172b',
  early_childhood: '#e8890c',
  primary_school: '#e8890c',
  intermediate_school: '#e8890c',
  secondary_school: '#e8890c',
  tertiary: '#e8890c',
  trades_training: '#e8890c',
};
export const DESTINATION_OTHER = '#0c0c48';

// Share of the region's jobs within reach: one hue, light to dark.
export const JOBS = ['#b7d3f6', '#6da7ec', '#2a78d6', '#184f95', '#0c3163'];
export const JOBS_BREAKS = [2, 5, 10, 25];

// Job access allowing for competition, diverging at the regional average (1.0).
export const FAIR = ['#833607', '#f8ad8b', '#f0efec', '#9ec5f4', '#184f95'];
export const FAIR_BREAKS = [0.5, 0.8, 1.25, 2];

// Main reason a place misses the standard. Maps allow three categorical hues
// before neighbours become hard to tell apart, so the transport fixes take
// blue, orange and teal, "nothing within reach" takes a neutral grey, and the
// fare (only with a budget) purple. The last entry is the faded colour used
// when one reason is picked out.
export const REASON_PALETTE = ['#2a78d6', '#e8890c', '#0e7a7e', '#8f8c85', '#7a3fa0', '#dedcd5'];
export const FADED = 5;
export const REASON_GROUPS = [
  { cls: 0, codes: [1], label: 'The walking route is indirect', fix: 'A new walking link or crossing' },
  { cls: 1, codes: [2], label: 'No low-stress bike route', fix: 'A safe cycling connection' },
  { cls: 2, codes: [3, 4], label: 'Public transport is too slow', fix: 'More frequent or more direct service' },
  { cls: 3, codes: [5], label: 'Nothing within reach', fix: 'A service closer to home' },
  // Only arises with a fare budget set.
  { cls: 4, codes: [6], label: 'The fare is the barrier', fix: 'A concession, fare cap or cheaper fare', budgetOnly: true },
];
export const REASON_CLASS = { 1: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4 };

/** Class edges for minutes, relative to the standard T: T/2, 3T/4, T, 1.5T, 2.25T.
 *  Times stop at 60 minutes, so once 2.25T passes 60 the two upper edges share
 *  the room left between T and 60. */
export function accessBreaks(standard) {
  const top = Math.min(60, Math.round(standard * 2.25));
  return [
    Math.round(standard * 0.5),
    Math.round(standard * 0.75),
    standard,
    Math.min(Math.round(standard * 1.5), Math.round((standard + top) / 2)),
    top,
  ];
}

export function classify(value, breaks) {
  for (let k = 0; k < breaks.length; k += 1) if (value <= breaks[k]) return k;
  return breaks.length;
}

const NICE = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500];

/** Rounded quartile edges of the positive values, for people counts per cell. */
export function quartileBreaks(values) {
  const positive = Array.from(values).filter((v) => v > 0).sort((a, b) => a - b);
  if (!positive.length) return [1, 2, 5];
  const pick = (q) => positive[Math.min(positive.length - 1, Math.floor(q * positive.length))];
  const edges = [];
  for (const q of [0.25, 0.5, 0.75]) {
    const target = pick(q);
    const nice = NICE.find((n) => n >= target) ?? Math.ceil(target);
    edges.push(edges.length && nice <= edges[edges.length - 1] ? NICE.find((n) => n > edges[edges.length - 1]) : nice);
  }
  return edges;
}

// Gravity access score: one hue, light to dark, with the class edges set
// against the regional average (100) rather than the data range.
export const SCORE = ['#e6eef8', '#b7d3f6', '#6da7ec', '#2a78d6', '#184f95', '#0d2f5e'];
export const SCORE_BREAKS = [25, 50, 100, 200, 400];

// Deciles of the same score. Ten steps of the same hue, so a decile map reads
// as a ranking rather than as a measure.
export const DECILE = [
  '#f0f5fb', '#dbe8f8', '#c3daf4', '#a8c9ef', '#8ab6e9',
  '#6da7ec', '#4a8ddf', '#2a78d6', '#1b5eae', '#0d366b',
];

// Cheapest fare to reach the nearest one inside the time standard, and the
// fare burden. Free is the blue of the minutes map, because walking and
// cycling cost nothing; the fare steps darken in orange as they cost more,
// following Auckland Transport's four zone fares; no way in time is dark grey.
export const FARE = ['#3987e5', '#fbd3bd', '#f39a66', '#d65d15', '#833607', '#5d5a55'];

// While a trip's destination is picked: how far the origin gets in 10, 20, 30
// and 45 minutes. The minutes map's blues, darker is quicker; beyond is clear.
export const REACH = ['#184f95', '#3987e5', '#9ec5f4', '#dbe8f8'];

// A trip's two ends on the map: From in navy, To in teal, each over a white halo.
export const TRIP_ENDS = { from: '#0c0c48', to: '#1f6178' };

// The lines a trip draws, each over a white casing: the walks to and from the
// stops dashed in slate, the ride in navy, and a route on foot in MATE's
// colours for no known barrier, harder and not known (mate.js STATUS).
export const TRIP_LINE = { walk: '#55646c', ride: '#0c0c48', status: ['#3b7fb6', '#e8890c', '#8a938d'] };
// TEAM's hexagons under a trip that is drawn, faded so the trip reads first.
// Without a trip they are filled at 0.84.
export const CELL_OPACITY = { usual: 0.84, trip: 0.35 };

// Which way a measure leans with deprivation: towards the fair way (blue) or
// the unfair way (dark red), as MATE pairs them.
export const LEAN = { toward: '#3b7fb6', away: '#a8172b' };
