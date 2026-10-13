// MapLibre map: basemaps, the hexagon layer, network overlays and selection.
// Cell colours are set per feature through feature-state `k`, an index into the
// colour list of the current view, so switching views never rebuilds geometry.
// Hover and selection outlines use one-feature sources of their own, so moving
// the pointer never touches the 30,000-cell layer.

/* global maplibregl, h3 */

import { CELL_OPACITY, DESTINATION_COLOURS, DESTINATION_OTHER, TRIP_LINE } from './palette.js';

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
// function of the place's meta.
export const OVERLAYS = {
  rail: {
    label: 'Rail and ferry',
    group: 'Public transport',
    caption: (meta) => timetable(meta),
    layers: ['ov-rail', 'ov-ferry'],
    key: [
      { swatch: 'line', colour: '#0c0c48', label: 'Rail' },
      { swatch: 'dash', colour: '#0c0c48', label: 'Ferry' },
    ],
  },
  frequent_bus: {
    label: 'Frequent bus routes',
    group: 'Public transport',
    caption: () => 'Four or more an hour',
    layers: ['ov-frequent_bus'],
    key: [{ swatch: 'line', colour: '#2b2b2b', label: 'Bus, four or more an hour' }],
  },
  stops: {
    label: 'Stops and stations',
    group: 'Public transport',
    caption: () => 'Click one for departures an hour',
    layers: ['ov-stops'],
    key: [
      { swatch: 'dot', colour: '#0c0c48', label: 'Train or ferry stop' },
      { swatch: 'dot', colour: '#2b78c4', label: 'Frequent stop' },
      { swatch: 'dot', colour: '#9bb0bd', label: 'Other stop' },
    ],
  },
  cycling: {
    label: 'Cycleways and shared paths',
    group: 'Cycling',
    caption: () => 'From OpenStreetMap',
    layers: ['ov-cycling'],
    key: [{ swatch: 'line', colour: '#1d5c3a', label: 'Cycleway or shared path' }],
  },
  destinations: {
    // Named and coloured by the place chosen under Getting to, when it is drawn.
    label: 'Places you are getting to',
    group: 'Getting to',
    caption: () => 'Click one for its name',
    layers: ['destinations'],
    key: [{ swatch: 'dot', colour: null, label: 'The destination chosen' }],
  },
};

function timetable(meta) {
  const agency = (meta && meta.naming && meta.naming.agency) || 'The local';
  if (!meta || !meta.routing_date) return `${agency} timetable`;
  const date = new Date(`${meta.routing_date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${agency} timetable, ${date}`;
}

const STOP_COLOUR = [
  'match', ['get', 'kind'],
  'rail_ferry', '#0c0c48',
  'frequent', '#2b78c4',
  '#9bb0bd',
];

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
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e6e6e3' } },
      { id: 'bm-light', type: 'raster', source: 'esri-light' },
      { id: 'bm-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
      { id: 'bm-imagery', type: 'raster', source: 'esri-imagery', layout: { visibility: 'none' } },
      { id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': cellColour(['#000000']), 'fill-opacity': CELL_OPACITY.usual } },
      {
        id: 'cells-gap', type: 'line', source: 'cells', minzoom: 11,
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.5, 16, 1.5] },
      },
      {
        id: 'ov-cycling', type: 'line', source: 'cycling', layout: { visibility: 'none', 'line-cap': 'round' },
        filter: ['==', ['get', 'class'], 'low_stress'],
        paint: { 'line-color': '#1d5c3a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3] },
      },
      {
        id: 'ov-frequent_bus', type: 'line', source: 'frequent_bus', layout: { visibility: 'none', 'line-cap': 'round' },
        paint: { 'line-color': '#2b2b2b', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 2.5] },
      },
      {
        id: 'ov-ferry', type: 'line', source: 'ferry', layout: { visibility: 'none' },
        paint: { 'line-color': '#0c0c48', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      },
      {
        id: 'ov-rail', type: 'line', source: 'rail', layout: { visibility: 'none' },
        paint: { 'line-color': '#0c0c48', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 4] },
      },
      {
        id: 'ov-stops', type: 'circle', source: 'stops', layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 14, 3.4, 17, 6],
          'circle-color': STOP_COLOUR,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0, 14, 0.8],
        },
      },
      { id: 'bm-light-labels', type: 'raster', source: 'esri-light-labels' },
      { id: 'bm-imagery-labels', type: 'raster', source: 'esri-imagery-labels', layout: { visibility: 'none' } },
      {
        id: 'destinations', type: 'circle', source: 'destinations', layout: { visibility: 'none' },
        paint: {
          // A pin under the pointer grows and takes a dark ring, so it reads
          // as something to click rather than part of the map.
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            10, ['case', ['boolean', ['feature-state', 'hover'], false], 5, 3],
            15, ['case', ['boolean', ['feature-state', 'hover'], false], 10, 6.5]],
          'circle-color': DESTINATION_OTHER,
          'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#0c0c48', '#ffffff'],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5],
        },
      },
      { id: 'cell-hover', type: 'line', source: 'hover', paint: { 'line-color': '#0c0c48', 'line-width': 1.5 } },
      // The picked hexagon: navy over a white halo, so it reads on blue and on orange.
      { id: 'cell-selected-halo', type: 'line', source: 'selected', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.95 } },
      { id: 'cell-selected', type: 'line', source: 'selected', paint: { 'line-color': '#0c0c48', 'line-width': 3.5 } },
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

export function setOverlays(map, overlays, destinations) {
  for (const name of ['rail', 'ferry', 'frequent_bus', 'cycling', 'stops']) {
    if (overlays[name]) map.getSource(name).setData(overlays[name]);
  }
  map.getSource('destinations').setData({
    type: 'FeatureCollection',
    features: destinations.map((d, i) => ({
      type: 'Feature',
      id: i,
      properties: { name: d.name || '', services: d.services },
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
    })),
  });
}

export function showDestinationsFor(map, service) {
  map.setFilter('destinations', service ? ['in', service, ['get', 'services']] : ['boolean', false]);
  map.setPaintProperty('destinations', 'circle-color', DESTINATION_COLOURS[service] || DESTINATION_OTHER);
}

const POINT_LAYERS = ['destinations', 'ov-stops'];

/** The pin or stop under the pointer, if one is showing there. */
function pointAt(map, point) {
  const layers = POINT_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  if (!layers.length) return null;
  const hits = map.queryRenderedFeatures(point, { layers });
  return hits.length ? hits[0] : null;
}

export function setBasemap(map, key) {
  for (const [name, spec] of Object.entries(BASEMAPS)) {
    for (const layer of spec.layers) map.setLayoutProperty(layer, 'visibility', name === key ? 'visible' : 'none');
  }
}

export function setOverlay(map, key, on) {
  for (const layer of OVERLAYS[key].layers) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
}

/** Clicks on a destination pin or a stop, which are points rather than cells
 *  and so need their own handler. Returns what was clicked and where. Hovering
 *  one calls `hover` with what it is, so it can say it can be clicked. */
export function onPoints(map, handler, { hover, leave } = {}) {
  let lit = null;
  const unlight = () => {
    if (lit != null) map.setFeatureState({ source: 'destinations', id: lit }, { hover: false });
    lit = null;
  };
  for (const layer of POINT_LAYERS) {
    map.on('click', layer, (event) => {
      const feature = event.features && event.features[0];
      // While picking, the hexagon under the pin is what is wanted.
      if (!feature || picking) return;
      // Stop the cell underneath from also being selected.
      event.originalEvent.stopPropagation();
      handler({
        kind: layer === 'destinations' ? 'destination' : 'stop',
        properties: feature.properties || {},
        lngLat: event.lngLat,
      });
    });
    map.on('mousemove', layer, (event) => {
      // Where a pin and a stop overlap, both layers fire; only the one drawn
      // on top answers, so the tooltip and the highlight agree.
      const top = pointAt(map, event.point);
      if (top && top.layer.id !== layer) {
        if (layer === 'destinations') unlight();
        return;
      }
      const feature = top || (event.features && event.features[0]);
      if (!feature || picking) return;
      map.getCanvas().style.cursor = 'pointer';
      if (layer === 'destinations' && feature.id !== lit) {
        unlight();
        lit = feature.id;
        map.setFeatureState({ source: 'destinations', id: lit }, { hover: true });
      }
      if (hover) hover({ kind: layer === 'destinations' ? 'destination' : 'stop', properties: feature.properties || {} }, event.point);
    });
    map.on('mouseleave', layer, () => {
      if (picking) return;
      map.getCanvas().style.cursor = '';
      if (layer === 'destinations') unlight();
      if (leave) leave();
    });
  }
}

export function onCells(map, { hover, leave, click }) {
  let hovered = null;
  map.on('mousemove', 'cells-fill', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    // A pin or stop sits on top of a cell; it has its own hover, so the cell
    // steps back rather than covering it with a tooltip.
    if (!picking && pointAt(map, event.point)) {
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
    if (!picking && pointAt(map, event.point)) return;
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
  map.addLayer({ id: 'cell-dest-halo', type: 'line', source: 'dest', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.95 } });
  map.addLayer({ id: 'cell-dest', type: 'line', source: 'dest', paint: { 'line-color': '#1f6178', 'line-width': 3.5 } });
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

/** Draw a trip: the destination ring, the labels over both rings, and the lines and stops of `drawing`
 *  (trip.js tripDrawing). Null clears it all. */
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
  for (const stop of trip.drawing?.stops || []) {
    const box = tag(stop.label, 'stop');
    box.title = stop.name;
    tripMarkers.push(marker(map, box, [stop.lon, stop.lat]));
  }
  const label = trip.drawing?.label;
  if (label && label.text) tripMarkers.push(marker(map, tag(label.text, 'route'), [label.lon, label.lat]));
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
