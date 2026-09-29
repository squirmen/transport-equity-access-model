import test from 'node:test';
import assert from 'node:assert/strict';
import { areaNamed, areaSize, buildAreas, chainAt, chainOf, pickArea, sizeMetres } from '../../web/js/scope.js';

// Six hexagons: one council, two wards; ward A is one local board, ward B two.
function sample() {
  const centres = [[-36.90, 174.70], [-36.91, 174.71], [-36.92, 174.80], [-36.93, 174.81], [-36.94, 174.90], [-36.95, 174.91]];
  return buildAreas({
    n: 6,
    pop: Float32Array.from([100, 100, 100, 100, 100, 100]),
    place: [0, 0, 1, 1, 2, 3],
    places: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }, { name: 'Delta' }],
    areas: {
      council: { names: ['Only'], cell: [0, 0, 0, 0, 0, 0] },
      ward: { names: ['A Ward', 'B Ward'], cell: [0, 0, 1, 1, 1, 1] },
      board: { names: ['A', 'B1', 'B2'], cell: [0, 0, 1, 1, 2, 2] },
    },
  }, centres);
}

test('a level with the same people as the one above it is skipped', () => {
  const scope = sample();
  assert.deepEqual(chainAt(scope, 0).map((a) => `${a.level}:${a.name}`), ['ward:A Ward']); // board A and suburb Alpha are the whole ward
  assert.deepEqual(chainAt(scope, 4).map((a) => `${a.level}:${a.name}`), ['ward:B Ward', 'board:B2', 'suburb:Gamma']);
});

test('zoomed out gives the whole place; zoomed in gives the smallest area that fills the view', () => {
  const scope = sample();
  const chain = chainAt(scope, 4);
  assert.equal(pickArea(chain, 8, -36.9), null);
  const ward = pickArea(chain, 15.3, -36.9); // four hexagons, spread out: a small area on the map
  assert.equal(ward.level, 'ward');
  assert.equal(pickArea(chain, 17, -36.9).level, 'suburb');
});

test('sizes are in metres, with a floor for a one-hexagon area', () => {
  assert.equal(sizeMetres([174.7, -36.9, 174.7, -36.9]), 500);
  assert.ok(Math.abs(sizeMetres([174.7, -36.9, 174.8, -36.8]) - 9923) < 60);
});

test('an area can be found again by level and name, for links', () => {
  const found = areaNamed(sample(), 'board', 'B1');
  assert.equal(found.area.name, 'B1');
  assert.deepEqual(found.chain.map((a) => a.name), ['B Ward', 'B1']);
  assert.equal(areaNamed(sample(), 'board', 'Nowhere'), null);
});

test('a large area where few people live counts by its hexagons, not its box', () => {
  const sparse = { bbox: [174.7, -41.4, 175.0, -41.2], cells: 4 };
  assert.ok(sizeMetres(sparse.bbox) > 20000);
  assert.ok(Math.abs(areaSize(sparse) - Math.sqrt(4 * 105300)) < 1);
});

test('an area named in a link takes the ward most of its people live in, and a board that is a whole ward gives the ward', () => {
  const scope = sample();
  // Suburb Gamma is one of board B2's two hexagons, both in ward B.
  assert.deepEqual(areaNamed(scope, 'suburb', 'Gamma').chain.map((a) => a.name), ['B Ward', 'B2', 'Gamma']);
  // Suburb Beta is all of board B1, so the board stands for it.
  assert.equal(areaNamed(scope, 'suburb', 'Beta').area.name, 'B1');
  // Board A is all of ward A.
  const board = areaNamed(scope, 'board', 'A');
  assert.equal(board.area.level, 'ward');
  assert.equal(board.area.name, 'A Ward');
  // The single council is the whole place.
  assert.equal(chainOf(scope, 'council', 0), null);
});
