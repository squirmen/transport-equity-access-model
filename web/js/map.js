// MapLibre map: basemaps, the hexagon layer, network overlays, the point
// symbols and selection. Cell colours are set per feature through
// feature-state `k`, an index into the colour list of the current view, so
// switching views never rebuilds geometry. Hover and selection outlines use
// one-feature sources of their own, so moving the pointer never touches the
// 30,000-cell layer. Points (schools, places, stops) are MapLibre symbol
// layers, so MapLibre keeps them from overlapping (symbols.js).

/* global maplibregl, h3 */

import { GLYPHS } from './glyphs.js';
import { CELL_OPACITY, MODE_COLOURS, TRIP_LINE } from './palette.js';
import {
  addSymbolImages, forgetImage, layerStopProperties, MODE_GLYPH, modeOf, nameImage, nearStopFeatures, pointAt, SERVICE_GLYPH,
} from './symbols.js';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const EMPTY = { type: 'FeatureCollection', features: [] };
const CLEAR = 'rgba(0,0,0,0)';

export const BASEMAPS = {
  light: { label: 'Light', layers: ['bm-light', 'bm-light-labels'] },
  streets: { label: 'Streets', layers: ['bm-osm'] },
  satellite: { label: 'Satellite', layers: ['bm-imagery', 'bm-imagery-labels'] },
};

// Each overlay says what it draws, so the key and the Layers drawer can be
// built from this rather than written out again somewhere else and left to
// drift. `group` and `caption` place it in the drawer; a caption can be a
// function of the place's meta. `icon` is the image beside it in the drawer
// (symbols.js); the key lists each symbol only while it is on screen.
export const OVERLAYS = {
  rail: {
    label: 'Rail and ferry',
    group: 'Public transport',
    caption: (meta) => timetable(meta),
    layers: ['ov-rail-casing', 'ov-rail', 'ov-ferry'],
    icon: 'line-rail',
  },
  frequent_bus: {
    label: 'Frequent bus routes',
    group: 'Public transport',
    caption: () => 'Four or more an hour',
    layers: ['ov-frequent_bus-casing', 'ov-frequent_bus'],
    icon: 'line-bus',
  },
  stops: {
    label: 'Stops and stations',
    group: 'Public transport',
    caption: () => 'Hover or tap one for its name',
    layers: ['ov-station', 'ov-bus'],
    icon: 'bus-on',
  },
  cycling: {
    label: 'Cycleways and shared paths',
    group: 'Cycling',
    caption: () => 'From OpenStreetMap',
    layers: ['ov-cycling'],
    icon: 'line-cycling',
  },
  destinations: {
    // Named and drawn by the place chosen under Getting to, when it is drawn.
    label: 'Places you are getting to',
    group: 'Getting to',
    caption: () => 'Hover or tap one for its name',
    layers: ['places'],
    icon: 'svc-supermarket',
  },
};

function timetable(meta) {
  const agency = (meta && meta.naming && meta.naming.agency) || 'The local';
  if (!meta || !meta.routing_date) return `${agency} timetable`;
  const date = new Date(`${meta.routing_date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${agency} timetable, ${date}`;
}

let cells = EMPTY;
let lastClasses = null;
// While a trip's destination is picked, a click picks a hexagon even on a stop
// or pin, and the pointer is a crosshair.
let picking = false;

function raster(url, maxzoom, attribution) {
  return { type: 'raster', tiles: [url], tileSize: 256, maxzoom, ...(attribution ? { attribution } : {}) };
}

function cellColour(colours) {
  return ['match', ['feature-state', 'k'], ...colours.flatMap((colour, k) => [k, colour]), CLEAR];
}

const zoomed = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
// The plain shape below zoom `z`, the shape with its glyph from there. An
// image is chosen for each tile, at a whole zoom, so the steps are whole.
const stepped = (z) => ['step', ['zoom'], ['concat', ['get', 'img'], '-dot'], z, ['get', 'img']];
// The walking badge beside its stop, on the side away from the school.
const BADGE = {
  'icon-image': ['get', 'badge'],
  'icon-anchor': ['match', ['get', 'side'], 'L', 'right', 'left'],
  'icon-offset': ['match', ['get', 'side'], 'L',
    ['case', ['==', ['get', 'station'], 1], ['literal', [-15.5, 0]], ['literal', [-13, 0]]],
    ['case', ['==', ['get', 'station'], 1], ['literal', [15.5, 0]], ['literal', [13, 0]]]],
  'icon-allow-overlap': false,
  'icon-padding': 0,
  'symbol-sort-key': ['get', 'place'],
};
// Stops near the school: every one drawn, stations and the quicker walks on top.
const NEAR_STOP = {
  'icon-image': ['step', ['zoom'], ['concat', ['get', 'img'], '-dot'],
    12, ['case', ['==', ['get', 'station'], 1], ['get', 'img'], ['concat', ['get', 'img'], '-dot']],
    14, ['get', 'img']],
  'icon-size': zoomed(12, 0.85, 14, 0.8, 16, 1),
  'icon-allow-overlap': true,
  'icon-padding': 0,
  'symbol-sort-key': ['get', 'draw'],
  'symbol-z-order': 'source',
};
// Two stops either side of a road are one symbol below this zoom.
export const STOPS_APART = 16.5;
// School pins, and larger while one is to be picked.
const PIN_SIZE = zoomed(10, 0.8, 13, 0.75, 14, 0.85, 16, 1);
const PIN_SIZE_PICKING = zoomed(10, 1.05, 13, 0.95, 14, 1, 16, 1.1);

export function createMap(container, { topRight = null } = {}) {
  const style = {
    version: 8,
    sources: {
      'esri-light': raster(`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, 16,
        'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'),
      'esri-light-labels': raster(`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, 16),
      osm: raster('https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19,
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'),
      'esri-imagery': raster(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, 19,
        'Imagery &copy; Esri, Maxar, Earthstar Geographics'),
      'esri-imagery-labels': raster(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, 19),
      cells: { type: 'geojson', data: EMPTY },
      hover: { type: 'geojson', data: EMPTY },
      selected: { type: 'geojson', data: EMPTY },
      rail: { type: 'geojson', data: EMPTY },
      ferry: { type: 'geojson', data: EMPTY },
      frequent_bus: { type: 'geojson', data: EMPTY },
      cycling: { type: 'geojson', data: EMPTY },
      stops: { type: 'geojson', data: EMPTY },
      destinations: { type: 'geojson', data: EMPTY },
      'school-zone': { type: 'geojson', data: EMPTY },
      'school-pins': { type: 'geojson', data: EMPTY },
      near: { type: 'geojson', data: EMPTY },
      'near-all': { type: 'geojson', data: EMPTY },
      'point-hover': { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e6e6e3' } },
      { id: 'bm-light', type: 'raster', source: 'esri-light' },
      { id: 'bm-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
      { id: 'bm-imagery', type: 'raster', source: 'esri-imagery', layout: { visibility: 'none' } },
      { id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': cellColour(['#000000']), 'fill-opacity': CELL_OPACITY.usual } },
      {
        id: 'cells-gap', type: 'line', source: 'cells', minzoom: 11,
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.75, 'line-width': zoomed(11, 0, 13, 0.5, 16, 1.5) },
      },
      {
        id: 'ov-cycling', type: 'line', source: 'cycling', layout: { visibility: 'none', 'line-cap': 'round' },
        filter: ['==', ['get', 'class'], 'low_stress'],
        paint: { 'line-color': '#1d5c3a', 'line-width': zoomed(10, 1, 15, 3) },
      },
      // Bus and rail lines over a white casing, so they read on the darkest hexagons.
      {
        id: 'ov-frequent_bus-casing', type: 'line', source: 'frequent_bus', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': zoomed(10, 2.6, 15, 5) },
      },
      {
        id: 'ov-frequent_bus', type: 'line', source: 'frequent_bus', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': MODE_COLOURS.bus, 'line-width': zoomed(10, 0.8, 15, 2.5) },
      },
      {
        id: 'ov-ferry', type: 'line', source: 'ferry', layout: { visibility: 'none' },
        paint: { 'line-color': MODE_COLOURS.ferry, 'line-width': 2, 'line-dasharray': [2, 1.6] },
      },
      {
        id: 'ov-rail-casing', type: 'line', source: 'rail', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': zoomed(10, 4, 15, 7) },
      },
      {
        id: 'ov-rail', type: 'line', source: 'rail', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': MODE_COLOURS.train, 'line-width': zoomed(10, 2, 15, 4) },
      },
      // One school's zone: navy over a white halo.
      { id: 'school-zone-halo', type: 'line', source: 'school-zone', paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.9 } },
      { id: 'school-zone-line', type: 'line', source: 'school-zone', paint: { 'line-color': '#0c0c48', 'line-width': 2.2 } },
      { id: 'bm-light-labels', type: 'raster', source: 'esri-light-labels' },
      { id: 'bm-imagery-labels', type: 'raster', source: 'esri-imagery-labels', layout: { visibility: 'none' } },
      { id: 'cell-hover', type: 'line', source: 'hover', paint: { 'line-color': '#0c0c48', 'line-width': 1.5 } },
      // The picked hexagon: navy over a white halo, so it reads on blue and on orange.
      { id: 'cell-selected-halo', type: 'line', source: 'selected', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.95 } },
      { id: 'cell-selected', type: 'line', source: 'selected', paint: { 'line-color': '#0c0c48', 'line-width': 3.5 } },
      // A ring round the symbol under the pointer, or the stop the panel's list showed.
      {
        id: 'point-hover', type: 'circle', source: 'point-hover',
        paint: {
          'circle-radius': zoomed(10, 9, 14, 14, 16, 16),
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#0c0c48',
          'circle-stroke-width': 2.5,
        },
      },
      // From here up, symbols. MapLibre places the top layer first, so the
      // stack is the priority (symbols.js SYMBOL_LAYERS): the school picked,
      // the stops near it, their walking minutes, the schools or places, the
      // schools not counted, then the Stops layer.
      {
        id: 'ov-bus', type: 'symbol', source: 'stops', minzoom: 12.5, filter: ['==', ['get', 'station'], 0],
        layout: { visibility: 'none', 'icon-image': stepped(15), 'icon-size': zoomed(12.5, 0.8, 14.5, 0.8, 16, 1), 'icon-allow-overlap': false, 'icon-padding': 0 },
      },
      {
        id: 'ov-station', type: 'symbol', source: 'stops', filter: ['==', ['get', 'station'], 1],
        layout: { visibility: 'none', 'icon-image': stepped(12), 'icon-size': zoomed(10, 0.8, 12, 0.7, 15, 0.9, 16, 1), 'icon-allow-overlap': true },
      },
      {
        id: 'dest-out', type: 'symbol', source: 'school-pins', filter: ['==', ['get', 'st'], 'out'],
        layout: { 'icon-image': stepped(13), 'icon-size': zoomed(10, 0.9, 13, 0.8, 16, 1), 'icon-allow-overlap': false, 'icon-padding': 0 },
      },
      {
        id: 'places', type: 'symbol', source: 'destinations', filter: ['boolean', false],
        layout: { visibility: 'none', 'icon-image': 'svc-supermarket', 'icon-size': zoomed(10, 0.8, 12.5, 0.75, 14, 0.85, 16, 1), 'icon-allow-overlap': true },
      },
      {
        id: 'dest', type: 'symbol', source: 'school-pins', filter: ['==', ['get', 'st'], 'on'],
        layout: { 'icon-image': stepped(13), 'icon-size': PIN_SIZE, 'icon-allow-overlap': true },
      },
      { id: 'near-badge', type: 'symbol', source: 'near', minzoom: 13, maxzoom: STOPS_APART, layout: BADGE },
      { id: 'near-badge-all', type: 'symbol', source: 'near-all', minzoom: STOPS_APART, layout: BADGE },
      { id: 'near-stop', type: 'symbol', source: 'near', maxzoom: STOPS_APART, layout: NEAR_STOP },
      { id: 'near-stop-all', type: 'symbol', source: 'near-all', minzoom: STOPS_APART, layout: NEAR_STOP },
      {
        id: 'picked', type: 'symbol', source: 'school-pins', filter: ['==', ['get', 'st'], 'picked'],
        layout: { 'icon-image': 'school-picked', 'icon-anchor': 'bottom', 'icon-offset': [0, 3.5], 'icon-size': zoomed(10, 0.85, 14, 1), 'icon-allow-overlap': true },
      },
      {
        id: 'picked-name', type: 'symbol', source: 'school-pins', filter: ['==', ['get', 'st'], 'picked'],
        layout: { 'icon-image': ['get', 'name'], 'icon-anchor': 'left', 'icon-offset': [15, -24], 'icon-allow-overlap': true },
      },
    ],
  };
  const map = new maplibregl.Map({
    container,
    style,
    center: [174.76, -36.87],
    zoom: 10,
    minZoom: 7,
    maxZoom: 17,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  addSymbolImages(map);
  // Top right: the basemap, then zoom under it. Credits sit behind an (i).
  if (topRight) map.addControl(topRight, 'top-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  const credits = new maplibregl.AttributionControl({ compact: true });
  map.addControl(credits, 'bottom-right');
  // MapLibre opens the credits until the map is first dragged; they start
  // folded here, behind the (i), so they never cover the map on a phone.
  const fold = () => {
    const box = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    if (box) box.classList.remove('maplibregl-compact-show');
  };
  map.once('load', fold);
  map.once('idle', fold);
  return map;
}

/** A control holding any element, for the basemap buttons on the map. */
export function elementControl(element) {
  return {
    onAdd() {
      element.classList.add('maplibregl-ctrl');
      return element;
    },
    onRemove() {
      element.remove();
    },
  };
}

export function cellCollection(ids) {
  const features = new Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    const ring = h3.cellToBoundary(ids[i], true);
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    features[i] = { type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
  }
  return { type: 'FeatureCollection', features };
}

export function setCells(map, collection) {
  cells = collection;
  lastClasses = null;
  map.getSource('cells').setData(collection);
}

/** Colour every cell: `classes[i]` indexes `colours`, or is -1 to leave the cell clear.
 *  Only cells whose class changed since the last call are touched. */
export function paintCells(map, classes, colours) {
  map.setPaintProperty('cells-fill', 'fill-color', cellColour(colours));
  for (let i = 0; i < classes.length; i += 1) {
    if (lastClasses && lastClasses[i] === classes[i]) continue;
    map.setFeatureState({ source: 'cells', id: i }, { k: classes[i] < 0 ? null : classes[i] });
  }
  lastClasses = Int8Array.from(classes);
}

// ---------------------------------------------------------------- stops (Layers)

// The Layers stops as they arrived (overlays.json), with any names, codes and
// modes added from transit.json once it is in.
let layerStops = [];
let layerLines = { rail: [], ferry: [] };

/** The squared distance in degrees from a point to the nearest vertex of some lines. */
function nearestVertex(lon, lat, lines) {
  let best = Infinity;
  for (const line of lines) {
    for (const [x, y] of line) {
      const d = (x - lon) ** 2 + (y - lat) ** 2;
      if (d < best) best = d;
    }
  }
  return best;
}

function linesOf(collection) {
  const out = [];
  for (const f of (collection && collection.features) || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
  }
  return out;
}

function stopCollection() {
  return {
    type: 'FeatureCollection',
    features: layerStops.map((s, k) => ({
      type: 'Feature',
      id: k,
      properties: { k, ...layerStopProperties(s.kind, s.mode) },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  };
}

/** A Layers stop: { kind, per_hour, mode, name, code } or null. */
export function layerStop(k) {
  return layerStops[k] || null;
}

export function setOverlays(map, overlays, destinations) {
  for (const name of ['rail', 'ferry', 'frequent_bus', 'cycling']) {
    if (overlays[name]) map.getSource(name).setData(overlays[name]);
  }
  if (overlays.rail || overlays.ferry) layerLines = { rail: linesOf(overlays.rail), ferry: linesOf(overlays.ferry) };
  if (overlays.stops) {
    // A train or ferry stop the build did not give a mode for takes the
    // nearer line's, until transit.json says (setStopNames).
    layerStops = (overlays.stops.features || []).map((f) => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry.coordinates;
      let mode = p.mode || null;
      if (p.kind === 'rail_ferry' && mode !== 'train' && mode !== 'ferry') {
        mode = layerLines.ferry.length && nearestVertex(lon, lat, layerLines.ferry) < nearestVertex(lon, lat, layerLines.rail) ? 'ferry' : 'train';
      }
      return { kind: p.kind, per_hour: p.per_hour, mode: mode || 'bus', name: p.name || null, code: p.code || null, lon, lat };
    });
    map.getSource('stops').setData(stopCollection());
  }
  map.getSource('destinations').setData({
    type: 'FeatureCollection',
    features: destinations.map((d, i) => ({
      type: 'Feature',
      id: i,
      properties: { d: i, services: d.services, sym: '' },
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
    })).filter((f) => Number.isFinite(f.geometry.coordinates[0])),
  });
  pinKey = null;
}

/** Names, stop numbers and modes for the Layers stops, from transit.json,
 *  whose stops are overlays.json's in the same order. A file that does not
 *  line up is left alone. */
export function setStopNames(map, transit) {
  const features = transit && transit.stops && transit.stops.features;
  if (!Array.isArray(features) || features.length !== layerStops.length) return false;
  const kinds = new Map();
  for (const line of transit.lines || []) {
    for (const id of line.stops || []) {
      if (!kinds.has(id)) kinds.set(id, new Set());
      kinds.get(id).add(line.kind);
    }
  }
  features.forEach((f, k) => {
    const s = layerStops[k];
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    if (Math.abs(lon - s.lon) > 1e-4 || Math.abs(lat - s.lat) > 1e-4) return;
    s.name = p.name || s.name;
    s.code = p.code || s.code;
    if (s.kind === 'rail_ferry') {
      const on = kinds.get(p.id);
      if (on && on.has('ferry') && !on.has('rail')) s.mode = 'ferry';
      else if (on && on.has('rail')) s.mode = 'train';
    }
  });
  map.getSource('stops').setData(stopCollection());
  return true;
}

/** The service's places as symbols (Layers > Places you are getting to), or none. */
export function showDestinationsFor(map, service) {
  map.setFilter('places', service && SERVICE_GLYPH[service] ? ['in', service, ['get', 'services']] : ['boolean', false]);
  if (service && SERVICE_GLYPH[service]) {
    map.setLayoutProperty('places', 'icon-image', ['step', ['zoom'], `svc-${service}-dot`, 13, `svc-${service}`]);
  }
}

// ---------------------------------------------------------------- schools

let pinKey = null;
let pickedName = null;

/** The schools of `spec.service` as symbols: counted (on), not counted or
 *  another school under One school (out), and the one school picked, with
 *  its name beside it. `spec` = { service, counted (flags by destination, or
 *  null for all), focus (the one picked, or null), one (One school), key
 *  (changes whenever the marks would) }; null for none. */
export function setSchoolPins(map, spec, destinations = []) {
  const source = map.getSource('school-pins');
  if (!source) return;
  const key = spec ? spec.key : null;
  if (key === pinKey) return;
  pinKey = key;
  if (!spec) {
    source.setData(EMPTY);
    return;
  }
  const features = [];
  destinations.forEach((dest, d) => {
    if (!dest.services || !dest.services.includes(spec.service) || !Number.isFinite(dest.lon)) return;
    const picked = d === spec.focus;
    const out = !picked && Boolean(spec.counted && !spec.counted[d]);
    const props = { d, st: picked ? 'picked' : out ? 'out' : 'on' };
    if (picked) {
      const id = nameImage(d, dest.name);
      // A new name, or the same index with another name in another place: draw it afresh.
      if (pickedName !== `${d}|${dest.name}`) forgetImage(map, id);
      pickedName = `${d}|${dest.name}`;
      Object.assign(props, { img: 'school-picked', sym: 'school-picked', name: id });
    } else if (out) {
      Object.assign(props, { img: 'school-out', sym: spec.one ? 'school-other' : 'school-out' });
    } else {
      Object.assign(props, { img: 'school-on', sym: 'school-on' });
    }
    features.push({ type: 'Feature', id: d, properties: props, geometry: { type: 'Point', coordinates: [dest.lon, dest.lat] } });
  });
  // The picked school last, so it is drawn on top of the rest.
  features.sort((a, b) => (a.properties.st === 'picked') - (b.properties.st === 'picked'));
  source.setData({ type: 'FeatureCollection', features });
}

/** School pins larger while One school waits for a school to be picked. */
export function setPinsLarge(map, on) {
  if (!map.getLayer('dest')) return;
  map.setLayoutProperty('dest', 'icon-size', on ? PIN_SIZE_PICKING : PIN_SIZE);
}

/** Outline one school's zone (a GeoJSON geometry), or none. */
export function setSchoolZone(map, geometry) {
  const source = map.getSource('school-zone');
  if (!source) return;
  source.setData(geometry ? { type: 'Feature', properties: {}, geometry } : EMPTY);
}

let stopsKey = null;

/** The stops near one school (One school), as symbols with their walking
 *  minutes (symbols.js nearStopFeatures), or none with null rows. `key`
 *  changes with the school. */
export function setSchoolStops(map, rows, stops, school, key) {
  const next = rows && rows.length ? key : null;
  if (next === stopsKey || !map.getSource('near')) return;
  stopsKey = next;
  map.getSource('near').setData({ type: 'FeatureCollection', features: next ? nearStopFeatures(rows, stops, school, { grouped: true }) : [] });
  map.getSource('near-all').setData({ type: 'FeatureCollection', features: next ? nearStopFeatures(rows, stops, school, { grouped: false }) : [] });
}

/** Ring one point on the map ([lon, lat]), or none: the symbol under the
 *  pointer, or the stop the panel's list was asked to show. */
export function ringPoint(map, lngLat) {
  const source = map.getSource('point-hover');
  if (!source) return;
  source.setData(lngLat ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat } } : EMPTY);
}

/** The box around a GeoJSON geometry, as [west, south, east, north]. */
export function boundsOf(geometry) {
  let box = null;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      box = box ? [Math.min(box[0], c[0]), Math.min(box[1], c[1]), Math.max(box[2], c[0]), Math.max(box[3], c[1])] : [c[0], c[1], c[0], c[1]];
      return;
    }
    for (const part of c) walk(part);
  };
  if (geometry && geometry.coordinates) walk(geometry.coordinates);
  return box;
}

export function setBasemap(map, key) {
  for (const [name, spec] of Object.entries(BASEMAPS)) {
    for (const layer of spec.layers) map.setLayoutProperty(layer, 'visibility', name === key ? 'visible' : 'none');
  }
}

export function setOverlay(map, key, on) {
  for (const layer of OVERLAYS[key].layers) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
}

/** How near a click must be to a symbol: a finger's 44 px target, or 6 px for a mouse. */
export function hitRadius(event) {
  const original = event && event.originalEvent;
  if (original && original.pointerType) return original.pointerType === 'touch' ? 22 : 6;
  return window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 22 : 6;
}

/** What a rendered symbol is: { kind: school | place | near | stop, layer,
 *  d (a destination), ks (rows of the stops near a school), k (a Layers
 *  stop), picked, at ([lon, lat]), key }. */
export function pointInfo(feature) {
  if (!feature) return null;
  const layer = feature.layer.id;
  const p = feature.properties || {};
  const at = feature.geometry.coordinates;
  if (layer === 'picked' || layer === 'picked-name') return { kind: 'school', layer, d: Number(p.d), picked: true, at, key: `school|${p.d}` };
  if (layer === 'dest' || layer === 'dest-out') return { kind: 'school', layer, d: Number(p.d), picked: false, st: p.st, at, key: `school|${p.d}` };
  if (layer === 'places') return { kind: 'place', layer, d: Number(p.d), at, key: `place|${p.d}` };
  if (layer.startsWith('near-')) {
    const ks = String(p.ks).split(',').map(Number);
    // A stop's badge stands for its stop, so the ring goes on the stop.
    return { kind: 'near', layer, ks, at, key: `near|${p.ks}` };
  }
  if (layer === 'ov-bus' || layer === 'ov-station') return { kind: 'stop', layer, k: Number(p.k), at, key: `stop|${p.k}` };
  return null;
}

/** Hovering, clicking or tapping a symbol: a school, a place, a stop near a
 *  school or a Layers stop. `handler` gets what was clicked (pointInfo);
 *  `hover` gets it with the point under the pointer, and `leave` is called
 *  when the pointer leaves it. A tap takes the nearest within 22 px. */
export function onPoints(map, handler, { hover, leave } = {}) {
  let lit = null;
  const off = () => {
    if (lit == null) return;
    lit = null;
    map.getCanvas().style.cursor = picking ? 'crosshair' : '';
    ringPoint(map, null);
    if (leave) leave();
  };
  map.on('mousemove', (event) => {
    if (picking) return;
    const info = pointInfo(pointAt(map, event.point, 6));
    if (!info) {
      off();
      return;
    }
    map.getCanvas().style.cursor = 'pointer';
    if (info.key !== lit) {
      lit = info.key;
      // The picked school's pin stands above its point; the ring would sit at its tip.
      ringPoint(map, info.picked ? null : info.at);
    }
    if (hover) hover(info, event.point);
  });
  map.getCanvas().addEventListener('mouseleave', off);
  map.on('click', (event) => {
    // While picking, the hexagon under the pin is what is wanted.
    if (picking) return;
    const info = pointInfo(pointAt(map, event.point, hitRadius(event)));
    if (!info) return;
    handler(info);
  });
}

export function onCells(map, { hover, leave, click }) {
  let hovered = null;
  map.on('mousemove', 'cells-fill', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    // A pin or stop sits on top of a cell; it has its own hover, so the cell
    // steps back rather than covering it with a tooltip.
    if (!picking && pointAt(map, event.point, 6)) {
      if (hovered != null) {
        hovered = null;
        map.getSource('hover').setData(EMPTY);
      }
      return;
    }
    if (hovered !== feature.id) {
      hovered = feature.id;
      map.getSource('hover').setData(cells.features[hovered] || EMPTY);
    }
    map.getCanvas().style.cursor = picking ? 'crosshair' : 'pointer';
    hover(feature.id, event.point);
  });
  map.on('mouseleave', 'cells-fill', () => {
    hovered = null;
    map.getSource('hover').setData(EMPTY);
    map.getCanvas().style.cursor = picking ? 'crosshair' : '';
    leave();
  });
  map.on('click', 'cells-fill', (event) => {
    // A pin or stop on top answers the click itself; the cell under it does not.
    if (!picking && pointAt(map, event.point, hitRadius(event))) return;
    const feature = event.features && event.features[0];
    if (feature) click(feature.id);
  });
}

export function select(map, previous, next) {
  map.getSource('selected').setData(next != null && cells.features[next] ? cells.features[next] : EMPTY);
}

/** The hexagon at a point on the map's canvas, or null. */
export function cellAtPoint(map, point) {
  const hits = map.queryRenderedFeatures(point, { layers: ['cells-fill'] });
  return hits.length ? hits[0].id : null;
}

// ---------------------------------------------------------------- trips (?mate=1)

// A trip's destination ring, its lines and stops come from sources of their
// own, added the first time a trip needs them, so the map is the same as ever
// without one. The colours are palette.js TRIP_LINE.
let tripMarkers = [];

function ensureTripLayers(map) {
  if (map.getSource('dest')) return;
  map.addSource('dest', { type: 'geojson', data: EMPTY });
  map.addSource('trip', { type: 'geojson', data: EMPTY });
  // While picking: the hexagon under the pointer, dashed in teal.
  map.addLayer({
    id: 'cell-pick', type: 'line', source: 'hover', layout: { visibility: 'none' },
    paint: { 'line-color': '#1f6178', 'line-width': 3, 'line-dasharray': [2, 1.5] },
  }, 'cell-selected-halo');
  const route = ['==', ['get', 'kind'], 'route'];
  const known = ['all', route, ['!=', ['get', 'status'], 2]];
  const unknown = ['all', route, ['==', ['get', 'status'], 2]];
  const lines = [
    // Every line over a white casing, so it reads over any hexagon; the walks' is narrower, as they are.
    { id: 'trip-casing', filter: ['in', ['get', 'kind'], ['literal', ['walk', 'ride', 'route']]], paint: { 'line-color': '#ffffff', 'line-width': ['match', ['get', 'kind'], 'walk', 6, 8], 'line-opacity': 0.9 } },
    { id: 'trip-walk', filter: ['==', ['get', 'kind'], 'walk'], paint: { 'line-color': TRIP_LINE.walk, 'line-width': 2.5, 'line-dasharray': [1.2, 1.6] } },
    { id: 'trip-ride', filter: ['==', ['get', 'kind'], 'ride'], paint: { 'line-color': TRIP_LINE.ride, 'line-width': 4 } },
    { id: 'trip-route', filter: known, paint: { 'line-color': ['match', ['get', 'status'], 1, TRIP_LINE.status[1], TRIP_LINE.status[0]], 'line-width': 4.5 } },
    { id: 'trip-route-unknown', filter: unknown, paint: { 'line-color': TRIP_LINE.status[2], 'line-width': 4.5, 'line-dasharray': [1.1, 1.1] } },
  ];
  for (const spec of lines) {
    map.addLayer({ id: spec.id, type: 'line', source: 'trip', filter: spec.filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: spec.paint }, 'cell-hover');
  }
  map.addLayer({ id: 'cell-dest-halo', type: 'line', source: 'dest', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.95 } }, 'point-hover');
  map.addLayer({ id: 'cell-dest', type: 'line', source: 'dest', paint: { 'line-color': '#1f6178', 'line-width': 3.5 } }, 'point-hover');
}

/** Picking a destination: the pointer becomes a crosshair and the hexagon under it is dashed in teal. */
export function setPicking(map, on) {
  picking = Boolean(on);
  if (!map.getSource('selected')) return;
  if (on) ensureTripLayers(map);
  if (map.getLayer('cell-pick')) {
    map.setLayoutProperty('cell-pick', 'visibility', on ? 'visible' : 'none');
    map.setLayoutProperty('cell-hover', 'visibility', on ? 'none' : 'visible');
  }
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
}

export function isPicking() {
  return picking;
}

function marker(map, element, lngLat, anchor = 'center') {
  return new maplibregl.Marker({ element, anchor }).setLngLat(lngLat).addTo(map);
}

/** The top corner of a hexagon, for the label over its ring. */
function topOf(i) {
  const ring = cells.features[i]?.geometry.coordinates[0];
  if (!ring) return null;
  return ring.reduce((a, b) => (b[1] > a[1] ? b : a));
}

/** Fade TEAM's hexagons while a trip's lines are drawn over them, so the trip reads first. */
export function fadeCells(map, on) {
  if (!map.getLayer('cells-fill')) return;
  map.setPaintProperty('cells-fill', 'fill-opacity', on ? CELL_OPACITY.trip : CELL_OPACITY.usual);
}

/** A glyph as inline SVG, for a map tag. */
function glyphSvg(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', GLYPHS[name]);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/** Draw a trip: the destination ring, the labels over both rings, and the lines and stops of `drawing`
 *  (trip.js tripDrawing). Null clears it all. A and B are rounded squares in the ride's mode, and the
 *  route's label carries the mode's glyph. */
export function setTrip(map, trip) {
  if (!map.getSource('selected')) return;
  for (const m of tripMarkers) m.remove();
  tripMarkers = [];
  if (!trip) {
    if (map.getSource('dest')) {
      map.getSource('dest').setData(EMPTY);
      map.getSource('trip').setData(EMPTY);
    }
    return;
  }
  ensureTripLayers(map);
  map.getSource('dest').setData(cells.features[trip.dest] || EMPTY);
  map.getSource('trip').setData({ type: 'FeatureCollection', features: trip.drawing?.lines || [] });
  const tag = (text, kind) => {
    const box = document.createElement('span');
    box.className = `map-tag is-${kind}`;
    box.textContent = text;
    box.setAttribute('aria-hidden', 'true');
    return box;
  };
  for (const [i, text, kind] of [[trip.origin, 'From', 'from'], [trip.dest, 'To', 'to']]) {
    const at = topOf(i);
    if (at) tripMarkers.push(marker(map, tag(text, kind), at, 'bottom'));
  }
  const mode = trip.drawing?.mode || 'bus';
  for (const stop of trip.drawing?.stops || []) {
    const box = tag(stop.label, 'stop');
    box.classList.add(`is-${mode}`);
    box.title = stop.name;
    tripMarkers.push(marker(map, box, [stop.lon, stop.lat]));
  }
  const label = trip.drawing?.label;
  if (label && label.text) {
    const box = tag('', 'route');
    box.classList.add(`is-${mode}`);
    box.append(glyphSvg(MODE_GLYPH[mode] || MODE_GLYPH.bus), document.createTextNode(label.text));
    tripMarkers.push(marker(map, box, [label.lon, label.lat]));
  }
}

/** The mode a trip rides, from its routes' GTFS types: train or ferry if any leg is, else bus. */
export function tripMode(routes = []) {
  const modes = routes.map((r) => modeOf(r.type));
  return modes.includes('train') ? 'train' : modes.includes('ferry') ? 'ferry' : 'bus';
}

/** The middle of a hexagon, as [lon, lat]. */
export function centreOf(i) {
  const ring = cells.features[i]?.geometry.coordinates[0];
  if (!ring) return null;
  const n = ring.length - 1;
  let x = 0;
  let y = 0;
  for (let k = 0; k < n; k += 1) {
    x += ring[k][0];
    y += ring[k][1];
  }
  return [x / n, y / n];
}

// MATE's catchment colours the hexagons through paintCells like any view. The
// ones walking reaches and the profile does not also get a hatch, from a small
// source of their own, added the first time it is needed so the map is the
// same as ever without it.
const HATCH = 'mate-hatch';

/** Diagonal stripes that tile, as image data MapLibre takes without a canvas. */
export function hatchImage(size = 12, rgba = [131, 54, 7, 230]) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % size < 2) data.set(rgba, (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

/** Hatch these hexagons (indexes into the cell layer), or none. */
export function setHatch(map, ids) {
  if (!map.getSource('hatch')) {
    if (!ids.length) return;
    if (!map.hasImage(HATCH)) map.addImage(HATCH, hatchImage(), { pixelRatio: 2 });
    map.addSource('hatch', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'hatch', type: 'fill', source: 'hatch', paint: { 'fill-pattern': HATCH } }, 'cells-gap');
  }
  map.getSource('hatch').setData(ids.length
    ? { type: 'FeatureCollection', features: ids.map((i) => cells.features[i]).filter(Boolean) }
    : EMPTY);
}

export function fitPlace(map, bbox) {
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, maxZoom: 14, duration: 600 });
}
