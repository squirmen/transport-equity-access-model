// Map symbols: what each point on the map is drawn as, the images MapLibre
// draws them with, the key's rows for what is on screen, and the stops near
// a school as the map draws them. docs/design.md, "Map symbols".
//
// Shape says what kind of thing: a disc is a place you are getting to, a
// rounded square public transport (a station's with a white line inside its
// edge), a map pin the school picked, a pill a walking time or a name. The
// glyph says which one; fill and ring say its state. Every image is drawn
// here on a canvas from glyphs.js, at the screen's pixel ratio (2 or 3).

import { GLYPH_GRID, GLYPHS } from './glyphs.js';
import { DESTINATION_COLOURS, DESTINATION_OTHER, EDGE_WIDTH, LEARNING, MODE_COLOURS, SYMBOL_EDGE, SYMBOL_GREY } from './palette.js';

const NAVY = '#0c0c48';
const INK = '#15252e';
const WHITE = '#ffffff';
const GREY = SYMBOL_GREY;
// Hexagons outside one school's zone (app.js OUTSIDE_ZONE).
const OUTSIDE = '#b4bbc2';
// Drawn at the screen's pixel ratio, 2 or 3, so a symbol is sharp on a phone.
export const PIXEL_RATIO = Math.min(3, Math.max(2, Math.ceil((typeof window !== 'undefined' && window.devicePixelRatio) || 2)));
// Room round a shape for its halo (2 px) and edge (EDGE_WIDTH).
const PAD = 2 + EDGE_WIDTH;
// The zoom from which bus stops and schools carry their glyph (map.js); below
// it they are plain shapes, and the key shows them so.
export const GLYPH_ZOOM = 13;

export const SERVICE_GLYPH = {
  supermarket: 'shopping_cart',
  gp: 'medical_services',
  pharmacy: 'local_pharmacy',
  library: 'local_library',
  bank_post: 'account_balance',
  early_childhood: 'child_friendly',
  primary_school: 'school',
  intermediate_school: 'school',
  secondary_school: 'school',
  tertiary: 'school',
  trades_training: 'build',
};
// A train is Temaki's rail car in side view, so a station is not taken for a
// bus stop: Material's bus and train are both a vehicle seen from the front.
export const MODE_GLYPH = { bus: 'directions_bus', train: 'temaki_tram_side', ferry: 'directions_boat' };

/** GTFS route_type as bus, train or ferry: tram, metro and rail are trains
 *  (as the build's RAIL_TYPES), ferries ferries, the rest buses. */
export function modeOf(type) {
  const t = Number(type);
  if ([0, 1, 2].includes(t) || (t >= 100 && t < 200) || (t >= 400 && t < 500) || (t >= 900 && t < 1000)) return 'train';
  if (t === 4 || (t >= 1000 && t < 1100) || t === 1200) return 'ferry';
  return 'bus';
}

const colourOf = (service) => DESTINATION_COLOURS[service] || DESTINATION_OTHER;

// ------------------------------------------------------------------ images

/** Every fixed image, by id: what it draws. Sizes are CSS pixels at zoom 16;
 *  `-dot` is the plain shape drawn below the zoom where a glyph would be a
 *  smudge. */
export const IMAGES = {
  'school-on': { shape: 'disc', size: 24, fill: LEARNING, glyph: 'school', ink: WHITE },
  // From zoom 11 to 13: small, with its glyph, so a school looks like one in the city view.
  'school-on-sm': { shape: 'disc', size: 17, fill: LEARNING, glyph: 'school', ink: WHITE },
  'school-on-dot': { shape: 'disc', size: 11, fill: LEARNING },
  'school-out': { shape: 'disc', size: 20, fill: WHITE, glyph: 'school', ink: GREY, ring: GREY },
  'school-out-sm': { shape: 'disc', size: 15, fill: WHITE, glyph: 'school', ink: GREY, ring: GREY },
  'school-out-dot': { shape: 'disc', size: 9, fill: WHITE, ring: GREY },
  'school-picked': { shape: 'pin', fill: NAVY, glyph: 'school', ink: WHITE },
};
for (const mode of ['bus', 'train', 'ferry']) {
  const big = mode === 'bus' ? 18 : 22;
  const small = mode === 'bus' ? 8 : 11;
  const glyph = MODE_GLYPH[mode];
  // A station has a white line inside its edge, so it is told from a bus stop by more than colour.
  const keyline = mode !== 'bus';
  IMAGES[`${mode}-on`] = { shape: 'square', size: big, fill: MODE_COLOURS[mode], glyph, ink: WHITE, keyline };
  IMAGES[`${mode}-on-dot`] = { shape: 'square', size: small, fill: MODE_COLOURS[mode], keyline };
  // No trips in the morning window: hollow and dashed.
  IMAGES[`${mode}-none`] = { shape: 'square', size: big, fill: WHITE, glyph, ink: GREY, ring: GREY, dashed: true };
  IMAGES[`${mode}-none-dot`] = { shape: 'square', size: small, fill: WHITE, ring: GREY };
}
// Fewer than four buses an hour (Layers): the same slate as any bus stop with
// buses, drawn smaller. Slate always means a bus stop with service.
IMAGES['bus-few'] = { shape: 'square', size: 13, fill: MODE_COLOURS.bus, glyph: 'directions_bus', ink: WHITE };
IMAGES['bus-few-dot'] = { shape: 'square', size: 6, fill: MODE_COLOURS.bus };
for (const [service, glyph] of Object.entries(SERVICE_GLYPH)) {
  IMAGES[`svc-${service}`] = { shape: 'disc', size: 24, fill: colourOf(service), glyph, ink: WHITE };
  IMAGES[`svc-${service}-dot`] = { shape: 'disc', size: 11, fill: colourOf(service) };
}
// For the key only: lines and areas.
IMAGES['line-zone'] = { shape: 'line', colour: NAVY, width: 2.2, casing: 5 };
IMAGES['line-rail'] = { shape: 'line', colour: MODE_COLOURS.train, width: 3, casing: 6 };
IMAGES['line-ferry'] = { shape: 'line', colour: MODE_COLOURS.ferry, width: 2, dash: [3, 2.4] };
IMAGES['line-bus'] = { shape: 'line', colour: MODE_COLOURS.bus, width: 2.2, casing: 5 };
IMAGES['line-cycling'] = { shape: 'line', colour: '#1d5c3a', width: 2.5 };
IMAGES['box-outside'] = { shape: 'box', fill: OUTSIDE };
IMAGES['box-hexagon'] = { shape: 'hexagon', colour: NAVY };

/** Whether an image id is one this file draws: the fixed ones, a walking
 *  badge (walk-7, drawn "7 min") or a school's name (name-<index>, set with
 *  nameImage). */
export function isSymbolImage(id) {
  return Boolean(IMAGES[id]) || /^walk-\d{1,3}$/.test(id) || /^name-\d+$/.test(id);
}

const names = new Map();

/** The id of the pill with a school's name, beside the school picked. */
export function nameImage(d, name) {
  names.set(String(d), String(name || ''));
  return `name-${d}`;
}

function canvas(w, h) {
  const box = document.createElement('canvas');
  box.width = Math.ceil(w * PIXEL_RATIO);
  box.height = Math.ceil(h * PIXEL_RATIO);
  // Kept off the GPU: every image is read back once (getImageData,
  // toDataURL), which is slow from a GPU canvas on a phone.
  const ctx = box.getContext('2d', { willReadFrequently: true });
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  return [box, ctx];
}

const paths = new Map();
function glyph(ctx, name, cx, cy, size, colour) {
  if (!paths.has(name)) paths.set(name, new Path2D(GLYPHS[name]));
  const grid = GLYPH_GRID[name] || 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / grid, size / grid);
  ctx.fillStyle = colour;
  ctx.fill(paths.get(name));
  ctx.restore();
}

/** A shape with its dark edge (EDGE_WIDTH) outside a 2 px white halo, then
 *  its fill and any ring (dashed for no trips). */
function sticker(ctx, path, fill, { ring = null, dashed = false } = {}) {
  ctx.lineJoin = 'round';
  path();
  ctx.lineWidth = 4 + 2 * EDGE_WIDTH;
  ctx.strokeStyle = SYMBOL_EDGE;
  ctx.stroke();
  path();
  ctx.lineWidth = 4;
  ctx.strokeStyle = WHITE;
  ctx.stroke();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) {
    ctx.save();
    path();
    ctx.clip();
    if (dashed) ctx.setLineDash([2.5, 2]);
    path();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.restore();
  }
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/** A pill with a name, white on navy, beside the school picked. */
function pill(text, { fill = NAVY, colour = WHITE, weight = 600, size = 12, h = 20 } = {}) {
  const [, measure] = canvas(4, 4);
  measure.font = `${weight} ${size}px ${FONT}`;
  const tw = Math.ceil(measure.measureText(text).width);
  const inner = 6 + tw + 6;
  const [box, ctx] = canvas(inner + PAD * 2, h + PAD * 2);
  sticker(ctx, () => rounded(ctx, PAD, PAD, inner, h, h / 2), fill);
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, PAD + 6 + tw / 2, PAD + h / 2 + 0.5);
  return box;
}

/** The words on a walking badge: "7 min". Walks are rounded down, so 0 is "<1 min". */
export function walkText(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return `${m < 1 ? '<1' : m} min`;
}

// A walking badge's room: 6.8 px for each character of the number (bold 11
// px Inter's widest digit is 7.4, "1" 4.7) and 18 px for "min" (600 10 px
// Inter, 17.7 px), so its width depends only on how many characters the
// number has and it is redrawn the same size once Inter loads.
const BADGE = { h: 18, glyphAt: 4, glyph: 13, digit: 6.8, gap: 2.5, unit: 18, end: 6 };

/** A walking badge: a walking person, the minutes in bold and "min", in
 *  black on white ("<walking person> 7 min"). */
function walkBadge(minutes) {
  const [number, unit] = walkText(minutes).split(' ');
  const b = BADGE;
  const start = b.glyphAt + b.glyph + 0.5;
  const room = Math.ceil(number.length * b.digit) + b.gap + b.unit;
  const inner = start + room + b.end;
  const [box, ctx] = canvas(inner + PAD * 2, b.h + PAD * 2);
  sticker(ctx, () => rounded(ctx, PAD, PAD, inner, b.h, b.h / 2), WHITE);
  glyph(ctx, 'directions_walk', PAD + b.glyphAt + b.glyph / 2, PAD + b.h / 2, b.glyph, INK);
  const big = `700 11px ${FONT}`;
  const small = `600 10px ${FONT}`;
  ctx.font = big;
  const nw = ctx.measureText(number).width;
  ctx.font = small;
  const uw = ctx.measureText(unit).width;
  // The number and "min" on one baseline, centred in their room.
  const x = PAD + start + Math.max(0, (room - (nw + b.gap + uw)) / 2);
  const baseline = PAD + b.h / 2 + 4;
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = big;
  ctx.fillText(number, x, baseline);
  ctx.font = small;
  ctx.fillText(unit, x + nw + b.gap, baseline);
  return box;
}

function draw(spec) {
  if (spec.shape === 'disc' || spec.shape === 'square') {
    const w = spec.size + PAD * 2;
    const [box, ctx] = canvas(w, w);
    const path = spec.shape === 'disc'
      ? () => { ctx.beginPath(); ctx.arc(w / 2, w / 2, spec.size / 2, 0, Math.PI * 2); }
      : () => rounded(ctx, PAD, PAD, spec.size, spec.size, spec.size * 0.24);
    sticker(ctx, path, spec.fill, spec);
    if (spec.keyline) {
      // A station: a white line just inside the edge.
      const inset = spec.size >= 16 ? 2.2 : 1.6;
      rounded(ctx, PAD + inset, PAD + inset, spec.size - inset * 2, spec.size - inset * 2, Math.max(1, spec.size * 0.24 - inset));
      ctx.lineWidth = spec.size >= 16 ? 1.4 : 1;
      ctx.strokeStyle = WHITE;
      ctx.stroke();
    }
    if (spec.glyph) glyph(ctx, spec.glyph, w / 2, w / 2, spec.size * (spec.shape === 'disc' ? 0.62 : spec.keyline ? 0.62 : 0.7), spec.ink);
    return box;
  }
  if (spec.shape === 'pin') {
    // A map pin, its tip on the school's point (icon-anchor bottom).
    const W = 30;
    const H = 38;
    const r = 13;
    const [box, ctx] = canvas(W + PAD * 2, H + PAD * 2);
    const cx = (W + PAD * 2) / 2;
    const cy = PAD + r + 1;
    sticker(ctx, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 0.18, false);
      ctx.lineTo(cx, PAD + H);
      ctx.closePath();
    }, spec.fill);
    glyph(ctx, spec.glyph, cx, cy, 17, spec.ink);
    return box;
  }
  if (spec.shape === 'line') {
    const [box, ctx] = canvas(24, 14);
    ctx.lineCap = 'round';
    if (spec.casing) {
      ctx.beginPath();
      ctx.moveTo(3, 7);
      ctx.lineTo(21, 7);
      ctx.lineWidth = spec.casing;
      ctx.strokeStyle = WHITE;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(3, 7);
    ctx.lineTo(21, 7);
    if (spec.dash) {
      ctx.lineCap = 'butt';
      ctx.setLineDash(spec.dash);
    }
    ctx.lineWidth = spec.width;
    ctx.strokeStyle = spec.colour;
    ctx.stroke();
    return box;
  }
  if (spec.shape === 'box') {
    const [box, ctx] = canvas(16, 14);
    rounded(ctx, 1, 1, 14, 12, 2);
    ctx.fillStyle = spec.fill;
    ctx.fill();
    return box;
  }
  if (spec.shape === 'hexagon') {
    const [box, ctx] = canvas(18, 18);
    const hex = () => {
      ctx.beginPath();
      for (let k = 0; k < 6; k += 1) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const x = 9 + 6.5 * Math.cos(a);
        const y = 9 + 6.5 * Math.sin(a);
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    hex();
    ctx.lineWidth = 5;
    ctx.strokeStyle = WHITE;
    ctx.stroke();
    hex();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = spec.colour;
    ctx.stroke();
    return box;
  }
  return null;
}

/** A canvas with the image `id` at twice its size, or null for an id this
 *  file does not draw. */
export function drawSymbol(id) {
  if (IMAGES[id]) return draw(IMAGES[id]);
  let m = /^walk-(\d{1,3})$/.exec(id);
  if (m) return walkBadge(Number(m[1]));
  m = /^name-(\d+)$/.exec(id);
  if (m) return pill(names.get(m[1]) || '');
  return null;
}

function imageData(box) {
  return box.getContext('2d').getImageData(0, 0, box.width, box.height);
}

/** Draw every symbol image the map asks for, when it first asks
 *  (`styleimagemissing`). Text images are drawn again once Inter is in, so a
 *  badge drawn in the fallback font does not stay that way. */
export function addSymbolImages(map) {
  const text = new Set();
  map.on('styleimagemissing', (event) => {
    const id = event.id;
    if (map.hasImage(id) || !isSymbolImage(id)) return;
    const box = drawSymbol(id);
    if (!box) return;
    map.addImage(id, imageData(box), { pixelRatio: PIXEL_RATIO });
    if (!IMAGES[id]) text.add(id);
  });
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load(`700 11px ${FONT}`), document.fonts.load(`600 10px ${FONT}`), document.fonts.load(`600 12px ${FONT}`)]).then(() => {
      for (const id of text) {
        if (!map.hasImage(id)) continue;
        const box = drawSymbol(id);
        try {
          map.updateImage(id, imageData(box));
        } catch {
          map.removeImage(id);
          map.addImage(id, imageData(box), { pixelRatio: PIXEL_RATIO });
        }
      }
      // Only the key's text images change with the font.
      for (const id of [...keyIcons.keys()]) if (!IMAGES[id]) keyIcons.delete(id);
    }).catch(() => {});
  }
}

/** A school's name was drawn before: draw it again for a new name. */
export function forgetImage(map, id) {
  if (map.hasImage(id)) map.removeImage(id);
}

const keyIcons = new Map();

/** The image `id` as an <img alt=""> at its own size times `scale`, for the
 *  key, the Layers drawer, popups and the stop list. */
export function keyIcon(id, scale = 0.8) {
  const img = document.createElement('img');
  img.alt = '';
  img.className = 'key-icon';
  img.dataset.icon = id;
  if (!keyIcons.has(id)) {
    const box = drawSymbol(id);
    keyIcons.set(id, box ? { src: box.toDataURL(), w: box.width / PIXEL_RATIO, h: box.height / PIXEL_RATIO } : null);
  }
  const found = keyIcons.get(id);
  if (!found) return img;
  img.src = found.src;
  img.width = Math.round(found.w * scale);
  img.height = Math.round(found.h * scale);
  return img;
}

// ------------------------------------------------------------------ layers

/** The map's symbol layers, top first: MapLibre places the top layer's
 *  symbols first, so this is also their priority. The walking badges come
 *  before their stops, so a stop's square never pushes a badge off; the
 *  nearest station's and the nearest stop's badges always show. The school's
 *  name shows from zoom 14.5 where no walking badge is in its way, and
 *  takes no room itself. */
export const SYMBOL_LAYERS = [
  'picked', 'near-badge-key', 'near-badge-key-all', 'near-badge', 'near-badge-all', 'picked-name', 'near-stop', 'near-stop-all',
  'dest', 'places', 'dest-out', 'ov-station', 'ov-station-all', 'ov-bus',
];
// Lines with a key row, and the symbol each stands for.
export const LINE_SYMBOLS = {
  'school-zone-line': 'zone', 'ov-rail': 'rail', 'ov-ferry': 'ferry', 'ov-frequent_bus': 'bus', 'ov-cycling': 'cycling', 'cell-selected': 'hexagon',
};

/** The symbol a rendered feature stands for in the key. */
export function symbolOf(feature) {
  const layer = feature.layer && feature.layer.id;
  if (!layer) return null;
  if (layer.startsWith('near-badge')) return 'walk';
  if (layer.startsWith('ov-station')) return (feature.properties && feature.properties.sym) || null;
  if (layer === 'picked' || layer === 'picked-name') return 'school-picked';
  // Layers' places are drawn for the service on screen, which the page knows.
  if (layer === 'places') return 'places';
  if (LINE_SYMBOLS[layer]) return LINE_SYMBOLS[layer];
  return (feature.properties && feature.properties.sym) || null;
}

/** The symbols drawn on screen now, as a set of ids (keyRows). Only symbols
 *  MapLibre placed count: one hidden where symbols crowd is not on screen.
 *  `box` ([[x0, y0], [x1, y1]] on the map's canvas) is the part of the map
 *  the panel and card leave clear; without it, the whole map. */
export function symbolsOnScreen(map, box = null) {
  const present = new Set();
  const shown = (id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none';
  const layers = [...SYMBOL_LAYERS, ...Object.keys(LINE_SYMBOLS)].filter(shown);
  if (!layers.length) return present;
  const found = box ? map.queryRenderedFeatures(box, { layers }) : map.queryRenderedFeatures({ layers });
  for (const feature of found) {
    const sym = symbolOf(feature);
    if (sym) present.add(sym);
  }
  return present;
}

/** The symbol under a point on the map, or null: the one drawn on top
 *  where the point is on a symbol, otherwise the one whose point is nearest
 *  within `radius` pixels (22 for a finger, so it has a 44 px target). */
export function pointAt(map, point, radius = 6) {
  const layers = SYMBOL_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  if (!layers.length) return null;
  const x = point.x ?? point[0];
  const y = point.y ?? point[1];
  const order = (f) => SYMBOL_LAYERS.indexOf(f.layer.id);
  const exact = map.queryRenderedFeatures([x, y], { layers });
  if (exact.length) return exact.sort((a, b) => order(a) - order(b))[0];
  if (!radius) return null;
  const hits = map.queryRenderedFeatures([[x - radius, y - radius], [x + radius, y + radius]], { layers });
  if (!hits.length) return null;
  const far = (f) => {
    const at = map.project(f.geometry.coordinates);
    return (at.x - x) ** 2 + (at.y - y) ** 2;
  };
  return hits.map((f) => [far(f), order(f), f]).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0][2];
}

// ------------------------------------------------------------------ the key

/** The key's "On the map" rows for the symbols in `present`, each with the
 *  image it is drawn with: `label` in full (a row's title, and what a screen
 *  reader hears), `pair` beside the icon in the key and `short` on a phone's
 *  strip. Under One school the stops and their walking badge come first, as
 *  they are what needs explaining; otherwise the schools. `ctx` = { kind:
 *  all | state | zone | one | pick (One school, none picked yet), school
 *  (the name of the one picked), hours ("7–9am"), services ({ service:
 *  "Supermarkets" }), zoom (the map's, so a symbol drawn as a plain shape
 *  is shown so) }. */
export function keyRows(present, ctx = {}) {
  const hours = ctx.hours || '7–9am';
  const counted = ctx.kind === 'state' || ctx.kind === 'zone';
  const zoom = Number.isFinite(ctx.zoom) ? ctx.zoom : 16;
  // The plain shape below the zoom where the map draws the glyph (map.js).
  const bus = (id) => (zoom < GLYPH_ZOOM ? `${id}-dot` : id);
  const station = (id) => (zoom < 12 ? `${id}-dot` : id);
  const school = (id) => (zoom < 11 ? `${id}-dot` : id);
  const all = {
    'school-picked': { icon: 'school-picked', scale: 0.55, label: ctx.school ? `${ctx.school}, the school picked` : 'The school picked', pair: 'School picked', short: 'School picked' },
    walk: { icon: 'walk-7', scale: 0.9, label: 'Walking time from the stop to the school', pair: 'Walk to the school', short: 'Walk to school' },
    'train-station': { icon: station('train-on'), label: 'Train station', pair: 'Train station', short: 'Train' },
    'ferry-station': { icon: station('ferry-on'), label: 'Ferry terminal', pair: 'Ferry terminal', short: 'Ferry' },
    'bus-near': { icon: bus('bus-on'), label: `Bus stop with trips arriving ${hours}`, pair: `Bus stop, trips ${hours}`, short: 'Bus stop' },
    'bus-frequent': { icon: bus('bus-on'), label: 'Bus stop, four or more an hour', pair: 'Bus stop, 4+ an hour', short: 'Bus, 4+ an hour' },
    'bus-other': { icon: bus('bus-few'), label: 'Bus stop, fewer than four an hour (drawn smaller)', pair: 'Bus stop, under 4 an hour', short: 'Bus, under 4' },
    'bus-none': { icon: bus('bus-none'), label: `Bus stop with no trips arriving ${hours}`, pair: `No trips ${hours}`, short: 'No trips' },
    'train-none': { icon: station('train-none'), label: `Train station with no trips arriving ${hours}`, pair: `Station, no trips ${hours}`, short: 'No trips' },
    'ferry-none': { icon: station('ferry-none'), label: `Ferry terminal with no trips arriving ${hours}`, pair: `Terminal, no trips ${hours}`, short: 'No trips' },
    'school-on': {
      icon: school('school-on'),
      label: counted ? 'School counted' : 'School',
      pair: counted ? 'School counted' : 'School',
      short: counted ? 'Counted' : 'School',
    },
    'school-out': { icon: school('school-out'), label: 'School not counted', pair: 'School not counted', short: 'Not counted' },
    'school-other': { icon: school('school-out'), label: 'Other schools, not counted', pair: 'Other schools', short: 'Other schools' },
    zone: { icon: 'line-zone', label: 'Its home zone', pair: 'Its zone', short: 'Zone' },
    outside: { icon: 'box-outside', label: 'Outside its zone, not counted', pair: 'Outside its zone', short: 'Outside zone' },
    rail: { icon: 'line-rail', label: 'Rail line', pair: 'Rail line', short: 'Rail' },
    ferry: { icon: 'line-ferry', label: 'Ferry route', pair: 'Ferry route', short: 'Ferry route' },
    bus: { icon: 'line-bus', label: 'Bus route, four or more an hour', pair: 'Frequent bus route', short: 'Frequent bus' },
    cycling: { icon: 'line-cycling', label: 'Cycleway or shared path', pair: 'Cycleway or path', short: 'Cycleway' },
    hexagon: { icon: 'box-hexagon', label: 'Hexagon picked', pair: 'Hexagon picked', short: 'Picked' },
  };
  for (const [service, label] of Object.entries(ctx.services || {})) {
    all[`svc-${service}`] = { icon: `svc-${service}`, label, pair: label, short: label };
  }
  const schools = ['school-picked', 'school-on', 'school-out', 'school-other'];
  const stops = ['walk', 'train-station', 'ferry-station', 'bus-near', 'bus-frequent', 'bus-other', 'bus-none', 'train-none', 'ferry-none'];
  const places = Object.keys(ctx.services || {}).map((service) => `svc-${service}`);
  const lines = ['rail', 'ferry', 'bus', 'cycling', 'hexagon'];
  const order = ctx.kind === 'one'
    ? ['school-picked', ...stops, 'school-other', 'zone', 'outside', ...places, ...lines]
    : [...schools, 'zone', 'outside', ...places, ...stops, ...lines];
  return order.filter((sym) => present.has(sym) && all[sym]).map((sym) => ({ sym, ...all[sym] }));
}

/** The line under the key's symbols: how to find out more, and how to pick a school. */
export function keyHint(present, ctx = {}) {
  const touch = Boolean(ctx.touch);
  const first = touch ? 'Tap a symbol for its name' : 'Hover over a symbol for its name';
  if (['school-on', 'school-out', 'school-other'].some((sym) => present.has(sym))) return `${touch ? 'Tap for names' : 'Hover for names'}; ${touch ? 'tap' : 'click'} a school to show only it.`;
  return `${first}.`;
}

// ------------------------------------------------------------------ stops near a school

const metresBetween = (a, b) => Math.hypot(
  (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180),
  (a.lat - b.lat) * 110540,
);

/** A stop's name as the panel lists it: the station's for a platform. */
export const stopTitle = (stop) => (typeof stop.station === 'string' && stop.station) || stop.name || 'Unnamed stop';

/** A row's mode: train or ferry for a station (the file's mode, or else its
 *  routes' when all of them are trains or ferries), otherwise bus. */
export function rowMode(row, stops) {
  const stop = stops.stops[row.s] || {};
  if (stop.mode === 'train' || stop.mode === 'ferry') return stop.mode;
  const modes = [...new Set((row.routes || []).map((r) => r.mode))];
  if (modes.length && modes.every((m) => m === 'train')) return 'train';
  if (modes.length && modes.every((m) => m === 'ferry')) return 'ferry';
  return 'bus';
}

/** Rows of one school's stops (schools.js stopsAt) joined where they are the
 *  same stop either side of a road: the same name within `metres`. Returns
 *  lists of row indexes, in the order of their first row. */
export function groupStops(rows, stops, metres = 80) {
  const groups = [];
  rows.forEach((row, k) => {
    const stop = stops.stops[row.s];
    const name = stopTitle(stop);
    const mode = rowMode(row, stops);
    const found = groups.find((g) => {
      const first = rows[g[0]];
      const other = stops.stops[first.s];
      return stopTitle(other) === name && rowMode(first, stops) === mode && metresBetween(other, stop) < metres;
    });
    if (found) found.push(k);
    else groups.push([k]);
  });
  return groups;
}

/** The symbol for one or more stops near a school, as the key names it, and
 *  the image it is drawn with: bus-near, train-station or ferry-station with
 *  trips arriving in the window, bus-none, train-none or ferry-none without. */
export function stopSymbolOf(rows, stops) {
  const mode = rows.map((row) => rowMode(row, stops)).find((m) => m !== 'bus') || 'bus';
  const trips = rows.some((row) => Number(row.trips) > 0);
  if (mode === 'bus') return { mode, sym: trips ? 'bus-near' : 'bus-none', img: trips ? 'bus-on' : 'bus-none' };
  return { mode, sym: trips ? `${mode}-station` : `${mode}-none`, img: `${mode}-${trips ? 'on' : 'none'}` };
}

/** The stops near a school as map features: one a stop with `grouped`
 *  false, otherwise one for each group (groupStops). Each carries its image
 *  (img), key symbol (sym), walking badge (badge, the quickest walk from a
 *  stop with trips arriving in the window; none where no stop has any, as
 *  it is no way to get to school then), whether it is a station, `must` for
 *  the nearest station and the nearest bus stop with trips (their badges
 *  always show), the side of the stop its badge goes on (away from the
 *  school), the order badges are placed in (place: stations first, then the
 *  quickest walk) and drawn in (draw: stations and quicker walks on top),
 *  and `ks`, the indexes of its rows. */
export function nearStopFeatures(rows, stops, school, { grouped = true } = {}) {
  if (!rows || !rows.length || !stops) return [];
  const ok = rows.map((row, k) => [row, k]).filter(([row]) => {
    const stop = stops.stops[row.s];
    return stop && Number.isFinite(stop.lon) && Number.isFinite(stop.lat);
  });
  const kept = ok.map(([row]) => row);
  const index = ok.map(([, k]) => k);
  const groups = grouped ? groupStops(kept, stops) : kept.map((row, k) => [k]);
  const features = groups.map((g, n) => {
    const members = g.map((k) => kept[k]);
    const served = members.filter((row) => Number(row.trips) > 0);
    const quickest = (served.length ? served : members).reduce((a, b) => (b.walk < a.walk ? b : a));
    const { mode, sym, img } = stopSymbolOf(members, stops);
    const station = mode !== 'bus';
    const points = members.map((row) => stops.stops[row.s]);
    const lon = points.reduce((a, p) => a + p.lon, 0) / points.length;
    const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
    const walk = Number(quickest.walk) || 0;
    const side = school && Number.isFinite(school.lon) && lon < school.lon ? 'L' : 'R';
    return {
      type: 'Feature',
      id: (grouped ? 0 : 5000) + n,
      properties: {
        ks: g.map((k) => index[k]).join(','),
        img,
        sym,
        mode,
        badge: served.length ? `walk-${walk}` : '',
        walk,
        trips: served.length ? 1 : 0,
        must: 0,
        station: station ? 1 : 0,
        side,
        place: station ? 0 : 100 + walk,
        draw: (station ? 1000 : 0) + (served.length ? 500 : 0) - walk,
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    };
  });
  // The nearest station and the nearest bus stop with trips keep their badges whatever crowds them.
  for (const want of [1, 0]) {
    const best = features.filter((f) => f.properties.trips && f.properties.station === want)
      .reduce((a, f) => (!a || f.properties.walk < a.properties.walk ? f : a), null);
    if (best) best.properties.must = 1;
  }
  return features;
}

/** A Layers stop as a map feature: its image and key symbol from its kind
 *  (rail_ferry, frequent, other) and mode (train or ferry for rail_ferry). */
export function layerStopProperties(kind, mode) {
  if (kind === 'rail_ferry') {
    const m = mode === 'ferry' ? 'ferry' : 'train';
    return { img: `${m}-on`, sym: `${m}-station`, mode: m, station: 1 };
  }
  if (kind === 'frequent') return { img: 'bus-on', sym: 'bus-frequent', mode: 'bus', station: 0 };
  return { img: 'bus-few', sym: 'bus-other', mode: 'bus', station: 0 };
}
