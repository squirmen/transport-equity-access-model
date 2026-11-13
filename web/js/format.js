// Number and label formatting. Round honestly; say "over 60 min" rather than showing a blank.

const whole = new Intl.NumberFormat('en-NZ');

export function count(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  if (n >= 10000) return whole.format(Math.round(n / 1000) * 1000);
  if (n >= 1000) return whole.format(Math.round(n / 100) * 100);
  if (n >= 100) return whole.format(Math.round(n / 10) * 10);
  return whole.format(Math.round(n));
}

export function percent(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return '–';
  return `${(x * 100).toFixed(digits)}%`;
}

export function minutes(m) {
  if (m == null || !Number.isFinite(m)) return 'over 60 min';
  return `${Math.round(m)} min`;
}

export function metres(m) {
  if (m == null || !Number.isFinite(m)) return '–';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${Math.round(m / 10) * 10} m`;
}

export const MODES = {
  best: { label: 'Best without a car', short: 'best option' },
  walk: { label: 'Walking', short: 'walking' },
  walk_slow: { label: 'Walking, slower pace', short: 'walking at 3.6 km/h' },
  bike_low_stress: { label: 'Low-stress cycling', short: 'low-stress cycling' },
  bike: { label: 'Any bike route', short: 'cycling on any street' },
  pt: { label: 'Public transport', short: 'public transport' },
  car: { label: 'Car', short: 'car' },
};

export const MODE_NOTES = {
  best: 'The fastest of walking, low-stress cycling and public transport. Car and busy-road cycling never count.',
  walk: 'Walking at 4.8 km/h on footpaths and paths, slowed on slopes.',
  walk_slow: 'Walking at 3.6 km/h, about the pace of people in their eighties, slowed on slopes.',
  bike_low_stress: 'Cycling at 15 km/h on paths, protected lanes and quiet streets only.',
  bike: 'Cycling at 15 km/h on any street a bike is allowed on, including busy roads. Shown for comparison; it does not count towards the standard.',
  pt: 'Public transport with walking at each end, median over the time window. A walk all the way counts too, but only up to 15 minutes; minutes are rounded down, so a walk shown as 15 min may not count.',
  car: 'Driving time with no traffic delay or parking. Shown for comparison only.',
};

// From 0.12.0 a build may give public transport as the quicker of the trip
// and walking all the way (summary.json meta.pt_or_walk). Set once when the
// data loads, like the place's name, so every sentence about public
// transport says the same.
const PT_NOTE_BEFORE = MODE_NOTES.pt;
const PT_NOTE_OR_WALK = 'Public transport, or walking where that is quicker. A bus or train trip may walk up to 15 minutes to and from stops; the time is the median of trips leaving each minute in the window.';

export const transit = { orWalk: false };

/** How a public transport time is said: "by public transport", and in a
 *  build that takes the walk where it is quicker, ", or on foot where that
 *  is quicker" after it. */
export function ptPhrase() {
  return transit.orWalk ? 'by public transport, or on foot where that is quicker' : 'by public transport';
}

// "public transport" after "by", as a mode is named in headlines, tables and
// keys; from 0.12.0 it is "public transport or on foot", since every public
// transport figure, jobs among them, takes the walk where that is quicker.
const PT_SHORT_BEFORE = MODES.pt.short;
export const PT_SHORT_OR_WALK = 'public transport or on foot';

export function setTransit(meta) {
  transit.orWalk = Boolean(meta && meta.pt_or_walk);
  MODE_NOTES.pt = transit.orWalk ? PT_NOTE_OR_WALK : PT_NOTE_BEFORE;
  MODES.pt.short = transit.orWalk ? PT_SHORT_OR_WALK : PT_SHORT_BEFORE;
}

// How this build names its place. Set once when the data loads, so the copy
// does not have to know which city it is describing.
export const place = {
  name: 'this region',
  residents: 'residents',
  possessive: 'the region\'s',
  agency: 'the local transport agency',
};

export function setPlace(naming) {
  if (!naming) return;
  if (naming.place) place.name = naming.place;
  if (naming.residents) place.residents = naming.residents;
  if (naming.possessive) place.possessive = naming.possessive;
  if (naming.agency) place.agency = naming.agency;
}

// Month names from a fixed list, not the browser's: Chromium and Safari
// abbreviate September differently.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Sep 2026" from "2026-09-15", or "Sep 2026" with `day` false; '' for anything else. */
export function shortDate(iso, { day = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return '';
  return day ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
