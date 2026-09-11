// MapLibre map: basemaps, the hexagon layer, network overlays and selection.
// Cell colours are set per feature through feature-state `k`, an index into the
// colour list of the current view, so switching views never rebuilds geometry.

/* global maplibregl, h3 */

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const EMPTY = { type: 'FeatureCollection', features: [] };

export const BASEMAPS = {
  light: { label: 'Light', layers: ['bm-light', 'bm-light-labels'] },
  streets: { label: 'Streets', layers: ['bm-osm'] },
  satellite: { label: 'Satellite', layers: ['bm-imagery', 'bm-imagery-labels'] },
};

export const OVERLAYS = {
  rail: { label: 'Rail and ferry', layers: ['ov-rail', 'ov-ferry'] },
  frequent_bus: { label: 'Frequent bus routes', layers: ['ov-frequent_bus'] },
  cycling: { label: 'Low-stress bike routes', layers: ['ov-cycling'] },
  destinations: { label: 'Destinations', layers: ['destinations'] },
};

function raster(url, maxzoom, attribution) {
  return { type: 'raster', tiles: [url], tileSize: 256, maxzoom, ...(attribution ? { attribution } : {}) };
}

function cellColour(colours) {
  return [
    'case',
    ['==', ['typeof', ['feature-state', 'k']], 'number'],
    ['to-color', ['at', ['to-number', ['feature-state', 'k']], ['literal', colours]]],
    'rgba(0,0,0,0)',
  ];
}

export function createMap(container) {
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
      rail: { type: 'geojson', data: EMPTY },
      ferry: { type: 'geojson', data: EMPTY },
      frequent_bus: { type: 'geojson', data: EMPTY },
      cycling: { type: 'geojson', data: EMPTY },
      destinations: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e6e6e3' } },
      { id: 'bm-light', type: 'raster', source: 'esri-light' },
      { id: 'bm-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
      { id: 'bm-imagery', type: 'raster', source: 'esri-imagery', layout: { visibility: 'none' } },
      { id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': cellColour(['#000000']), 'fill-opacity': 0.84 } },
      {
        id: 'cells-gap', type: 'line', source: 'cells',
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
      { id: 'bm-light-labels', type: 'raster', source: 'esri-light-labels' },
      { id: 'bm-imagery-labels', type: 'raster', source: 'esri-imagery-labels', layout: { visibility: 'none' } },
      {
        id: 'destinations', type: 'circle', source: 'destinations', layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#0c0c48',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'cells-hover', type: 'line', source: 'cells',
        paint: { 'line-color': '#0c0c48', 'line-width': 1.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0] },
      },
      {
        id: 'cells-selected', type: 'line', source: 'cells',
        paint: { 'line-color': '#0c0c48', 'line-width': 3, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] },
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
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  return map;
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
  map.getSource('cells').setData(collection);
}

let lastClasses = null;

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
  for (const name of ['rail', 'ferry', 'frequent_bus', 'cycling']) {
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
}

export function setBasemap(map, key) {
  for (const [name, spec] of Object.entries(BASEMAPS)) {
    for (const layer of spec.layers) map.setLayoutProperty(layer, 'visibility', name === key ? 'visible' : 'none');
  }
}

export function setOverlay(map, key, on) {
  for (const layer of OVERLAYS[key].layers) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
}

export function onCells(map, { hover, leave, click }) {
  let hovered = null;
  map.on('mousemove', 'cells-fill', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    if (hovered !== null && hovered !== feature.id) map.setFeatureState({ source: 'cells', id: hovered }, { hover: false });
    hovered = feature.id;
    map.setFeatureState({ source: 'cells', id: hovered }, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
    hover(feature.id, event.point);
  });
  map.on('mouseleave', 'cells-fill', () => {
    if (hovered !== null) map.setFeatureState({ source: 'cells', id: hovered }, { hover: false });
    hovered = null;
    map.getCanvas().style.cursor = '';
    leave();
  });
  map.on('click', 'cells-fill', (event) => {
    const feature = event.features && event.features[0];
    if (feature) click(feature.id);
  });
}

export function select(map, previous, next) {
  if (previous != null) map.setFeatureState({ source: 'cells', id: previous }, { selected: false });
  if (next != null) map.setFeatureState({ source: 'cells', id: next }, { selected: true });
}

export function fitPlace(map, bbox) {
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, maxZoom: 14, duration: 600 });
}
