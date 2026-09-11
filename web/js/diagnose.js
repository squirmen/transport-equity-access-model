// Why a place misses an access standard. Mirrors src/team/diagnosis.py so the
// map can update when the standard is changed. Rules are checked in order; the
// first that applies is the reason.

export const REASON = { MEETS: 0, WALK_LINK: 1, SAFE_BIKE: 2, PT_FREQUENCY: 3, PT_TRIP: 4, DISTANCE: 5, NO_DATA: 9 };

export const RULES = {
  walkKmh: 4.8,
  circuity: 1.3,        // a normal walking route is about 30% longer than a straight line
  ptSpeedKmh: 12,       // door-to-door bus speed, including the walk and the wait
  frequentPerHour: 4,   // every 15 minutes or better
};

const within = (value, limit) => Number.isFinite(value) && value <= limit;

export function diagnoseCell(cell, limit, rules = RULES) {
  const { km, walk, bikeLow, bike, pt, car, best, freq } = cell;
  const routed = [walk, bikeLow, bike, pt, car].some(Number.isFinite);
  if (!routed) return REASON.NO_DATA;
  if (within(best, limit)) return REASON.MEETS;
  const straightWalk = Number.isFinite(km) ? (km / rules.walkKmh) * 60 * rules.circuity : Infinity;
  if (straightWalk <= limit && !within(walk, limit)) return REASON.WALK_LINK;
  if (within(bike, limit) && !within(bikeLow, limit)) return REASON.SAFE_BIKE;
  const inBusRange = Number.isFinite(km) && km <= (rules.ptSpeedKmh * limit) / 60;
  if (inBusRange && !within(pt, limit)) {
    return (freq || 0) >= rules.frequentPerHour ? REASON.PT_TRIP : REASON.PT_FREQUENCY;
  }
  return REASON.DISTANCE;
}
