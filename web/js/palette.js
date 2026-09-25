// Data colours, chosen by the job each does and checked with the data-viz
// validator (docs/design.md records the results). Interface colours are in team.css.

// Minutes to the nearest service, diverging at the standard. Blue is within it
// (darker is faster); orange is beyond it (darker is slower). The two arms are
// matched step for step in lightness.
export const ACCESS = ['#184f95', '#3987e5', '#9ec5f4', '#f8ad8b', '#d65d15', '#833607'];

// People missing the standard in a cell: one hue, light to dark.
export const PEOPLE = ['#fecbb4', '#f0986f', '#d56326', '#933d09'];

// Share of the region's jobs within reach: one hue, light to dark.
export const JOBS = ['#b7d3f6', '#6da7ec', '#2a78d6', '#184f95', '#0d366b'];
export const JOBS_BREAKS = [2, 5, 10, 25];

// Job access allowing for competition, diverging at the regional average (1.0).
export const FAIR = ['#833607', '#f8ad8b', '#f0efec', '#9ec5f4', '#184f95'];
export const FAIR_BREAKS = [0.5, 0.8, 1.25, 2];

// Main reason a place misses the standard. Maps allow three categorical hues
// before neighbours become hard to tell apart, so the transport fixes take the
// three hues and "nothing within reach" takes a neutral grey. The last entry is
// the faded colour used when one reason is picked out.
export const REASON_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#8f8c85', '#dedcd5'];
export const FADED = 4;
export const REASON_GROUPS = [
  { cls: 0, codes: [1], label: 'The walking route is indirect', fix: 'A new walking link or crossing' },
  { cls: 1, codes: [2], label: 'No low-stress bike route', fix: 'A safe cycling connection' },
  { cls: 2, codes: [3, 4], label: 'Public transport is too slow', fix: 'More frequent or more direct service' },
  { cls: 3, codes: [5], label: 'Nothing within reach', fix: 'A service closer to home' },
];
export const REASON_CLASS = { 1: 0, 2: 1, 3: 2, 4: 2, 5: 3 };

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

// Cheapest fare to reach the nearest one inside the time standard. The first
// step is free, because walking and cycling cost nothing, and the rest follow
// Auckland Transport's four zone fares.
export const FARE = ['#1a7f5a', '#7cb342', '#f2c200', '#f08a24', '#e0562d', '#9c2f2f'];
