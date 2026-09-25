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
  bike_low_stress: { label: 'Low-stress cycling', short: 'low-stress cycling' },
  bike: { label: 'Any bike route', short: 'cycling on any street' },
  pt: { label: 'Public transport', short: 'public transport' },
  car: { label: 'Car', short: 'car' },
};

export const MODE_NOTES = {
  best: 'The fastest of walking, low-stress cycling and public transport. Car and busy-road cycling never count.',
  walk: 'Walking at 4.8 km/h on footpaths and paths.',
  bike_low_stress: 'Cycling at 15 km/h on paths, protected lanes and quiet streets only.',
  bike: 'Cycling at 15 km/h on any street a bike is allowed on, including busy roads. Shown for comparison; it does not count towards the standard.',
  pt: 'Public transport with walking at each end, median over the time window. A walk of up to 15 minutes also counts.',
  car: 'Driving time with no traffic delay or parking. Shown for comparison only.',
};

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

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
