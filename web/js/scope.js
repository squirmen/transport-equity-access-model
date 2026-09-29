// The area the side panel's figures are for. Zoomed out, that is the whole
// place. Zoomed in, it is the council, ward, Auckland local board or suburb
// under the middle of the map: the smallest of them that fills a good part of
// the view. The choice depends on the zoom and the map's centre only, not on
// the size of the screen, so a link opens on the same area everywhere.

export const LEVELS = ['council', 'ward', 'board', 'suburb'];

export const LEVEL_NOUN = { council: 'council', ward: 'ward', board: 'local board', suburb: 'suburb' };

// Half a kilometre, near enough the width of a hexagon's surroundings: a
// suburb of one hexagon is still that wide.
const MIN_EXTENT_M = 500;

// A resolution 9 hexagon covers about 0.105 km².
const CELL_M2 = 105300;

/** Which council, ward, local board and suburb each hexagon is in, with each
 *  area's population and extent. `centres` holds [lat, lng] for each cell. */
export function buildAreas({ n, pop, place, places, areas }, centres) {
  const levels = {};
  let total = 0;
  for (let i = 0; i < n; i += 1) total += pop[i] > 0 ? pop[i] : 0;
  for (const key of LEVELS) {
    const source = key === 'suburb'
      ? (places && place ? { names: places.map((p) => p.name), cell: place } : null)
      : areas && areas[key];
    if (!source || !source.names || !source.names.length) continue;
    const of = Int32Array.from({ length: n }, (_, i) => (source.cell[i] == null ? -1 : source.cell[i]));
    const people = new Float64Array(source.names.length);
    const cells = new Uint32Array(source.names.length);
    const box = source.names.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
    for (let i = 0; i < n; i += 1) {
      const a = of[i];
      if (a < 0) continue;
      people[a] += pop[i] > 0 ? pop[i] : 0;
      if (pop[i] > 0) cells[a] += 1;
      const [lat, lng] = centres[i];
      const b = box[a];
      if (lng < b[0]) b[0] = lng;
      if (lat < b[1]) b[1] = lat;
      if (lng > b[2]) b[2] = lng;
      if (lat > b[3]) b[3] = lat;
    }
    levels[key] = { names: source.names, of, people, cells, box };
  }
  return { levels, total, pop, masks: new Map() };
}

/** The areas a hexagon is in, largest first. A level that holds the same
 *  people as the one above it, such as Auckland's single council or a ward
 *  that is one local board, is left out. */
export function chainAt(scope, i) {
  const chain = [];
  let above = scope.total;
  for (const key of LEVELS) {
    const level = scope.levels[key];
    if (!level || i == null || i < 0) continue;
    const a = level.of[i];
    if (a < 0) continue;
    const people = level.people[a];
    if (!(people > 0) || Math.abs(people - above) <= 0.005 * above) continue;
    chain.push({ level: key, id: a, name: level.names[a], people, cells: level.cells[a], bbox: level.box[a] });
    above = people;
  }
  return chain;
}

/** How big an area is across, in metres: the geometric mean of its width and
 *  height, so a long thin area is not taken for a large one. */
export function sizeMetres(bbox) {
  const mid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const wide = Math.max((bbox[2] - bbox[0]) * 111320 * Math.cos(mid), MIN_EXTENT_M);
  const tall = Math.max((bbox[3] - bbox[1]) * 110574, MIN_EXTENT_M);
  return Math.sqrt(wide * tall);
}

/** How big an area looks on the map: its size across, or, for a large area
 *  where few people live, the size of the hexagons that are drawn in it. */
export function areaSize(area) {
  const box = sizeMetres(area.bbox);
  return area.cells ? Math.min(box, Math.max(Math.sqrt(area.cells * CELL_M2), MIN_EXTENT_M)) : box;
}

/** The smallest area in the chain at least `fill` of the way across a view
 *  `referencePx` pixels wide at this zoom, or null for the whole place. In
 *  Auckland that is a ward from about zoom 11.5, a local board from 12 and a
 *  suburb from 14.5 to 15. */
export function pickArea(chain, zoom, lat, { referencePx = 1000, fill = 0.4 } = {}) {
  const metresPerPx = (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  const reach = referencePx * metresPerPx * fill;
  for (let k = chain.length - 1; k >= 0; k -= 1) {
    if (areaSize(chain[k]) >= reach) return chain[k];
  }
  return null;
}

function entry(scope, level, id) {
  const lv = scope.levels[level];
  return { level, id, name: lv.names[id], people: lv.people[id], cells: lv.cells[id], bbox: lv.box[id] };
}

/** An area with the areas around it, largest first and ending with it. At each
 *  level above, the one holding most of its people: a suburb can straddle two
 *  wards. An area with the same people as the one above it, such as a local
 *  board that is a whole ward, gives that one instead; null means the whole
 *  place. */
export function chainOf(scope, level, id) {
  const lv = scope.levels[level];
  if (!lv || id == null || id < 0 || id >= lv.names.length) return null;
  const above = LEVELS.slice(0, LEVELS.indexOf(level)).filter((k) => scope.levels[k]);
  const counts = above.map(() => new Map());
  for (let i = 0; i < lv.of.length; i += 1) {
    if (lv.of[i] !== id) continue;
    const w = (scope.pop[i] > 0 ? scope.pop[i] : 0) + 1e-6;
    above.forEach((k, j) => {
      const a = scope.levels[k].of[i];
      if (a >= 0) counts[j].set(a, (counts[j].get(a) || 0) + w);
    });
  }
  const chain = [];
  let parent = scope.total;
  above.forEach((k, j) => {
    if (!counts[j].size) return;
    const a = [...counts[j].entries()].sort((x, y) => y[1] - x[1])[0][0];
    const people = scope.levels[k].people[a];
    if (!(people > 0) || Math.abs(people - parent) <= 0.005 * parent) return;
    chain.push(entry(scope, k, a));
    parent = people;
  });
  if (!(lv.people[id] > 0)) return null;
  // Only an area with the same people as the one above stands aside for it;
  // a larger area that spills over it does not.
  if (Math.abs(lv.people[id] - parent) <= 0.005 * parent) return chain.length ? { area: chain[chain.length - 1], chain } : null;
  const area = entry(scope, level, id);
  chain.push(area);
  return { area, chain };
}

/** The area of this level with this name, for links. */
export function areaNamed(scope, level, name) {
  const lv = scope.levels[level];
  if (!lv) return null;
  return chainOf(scope, level, lv.names.indexOf(name));
}

/** 1 for the hexagons in an area. */
export function maskFor(scope, area) {
  const key = `${area.level}:${area.id}`;
  if (!scope.masks.has(key)) {
    const of = scope.levels[area.level].of;
    scope.masks.set(key, Uint8Array.from(of, (a) => (a === area.id ? 1 : 0)));
  }
  return scope.masks.get(key);
}
