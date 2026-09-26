// Who misses out, and by how much.
//
// A headcount cannot tell a place three minutes over the standard from a
// place forty minutes over, so on its own it cannot rank anywhere for
// attention. These are the measures that can, all recomputed from whatever is
// currently on screen: change the mode, the time or the fare budget and every
// number here changes with it.
//
// The shortfall measures are the Foster-Greer-Thorbecke family, computed
// against the access standard as a poverty line. The direction measure is a
// concentration index, which ranks people by deprivation rather than by their
// own access, so it can say whether the places that miss out are the poor
// ones. An unordered measure like a Gini cannot answer that question.

/** How far past the standard each place is, as a share of the standard.
 *
 *  Zero for anywhere that meets it. Somewhere with no route at all is counted
 *  at `unreachable` minutes rather than left out, because dropping it would
 *  flatter the result in exactly the places that are worst off.
 */
export function shortfalls(times, standard, unreachable = 60) {
  const out = new Float32Array(times.length);
  for (let i = 0; i < times.length; i += 1) {
    const t = Number.isFinite(times[i]) ? times[i] : unreachable;
    out[i] = t > standard ? (t - standard) / standard : 0;
  }
  return out;
}

/** The Foster-Greer-Thorbecke measures, population weighted.
 *
 *  rate   the share of people short of the standard
 *  depth  the average shortfall across everyone, counting those who meet it
 *         as zero, so halving one person's shortfall moves it
 *  severity  the same with the shortfall squared, which weighs the worst off
 *         most heavily
 *  minutesShort  the plain english version: how far short those who miss out
 *         are, on average, in minutes
 */
export function fgt(times, weights, standard, unreachable = 60) {
  const gaps = shortfalls(times, standard, unreachable);
  let people = 0;
  let below = 0;
  let depth = 0;
  let severity = 0;
  let minutes = 0;
  for (let i = 0; i < gaps.length; i += 1) {
    const w = weights[i];
    if (!(w > 0)) continue;
    people += w;
    if (gaps[i] > 0) {
      below += w;
      depth += w * gaps[i];
      severity += w * gaps[i] * gaps[i];
      minutes += w * gaps[i] * standard;
    }
  }
  if (!(people > 0)) return { rate: NaN, depth: NaN, severity: NaN, below: 0, people: 0, minutesShort: NaN };
  return {
    rate: below / people,
    depth: depth / people,
    severity: severity / people,
    below,
    people,
    minutesShort: below > 0 ? minutes / below : 0,
  };
}

/** Split the people who miss out into those a fare shuts out and those
 *  distance shuts out.
 *
 *  `withBudget` is the time to the nearest one a traveller can afford, and
 *  `withoutBudget` the time to the nearest one at any price. Somewhere that
 *  meets the standard on the second and misses on the first is priced out:
 *  the service is close enough, the fare is the thing in the way. No other
 *  access tool can separate these, because none of them price a journey.
 */
export function pricedOut(withBudget, withoutBudget, weights, standard) {
  let priced = 0;
  let distance = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i];
    if (!(w > 0)) continue;
    const near = Number.isFinite(withoutBudget[i]) && withoutBudget[i] <= standard;
    const afford = Number.isFinite(withBudget[i]) && withBudget[i] <= standard;
    if (afford) continue;
    if (near) priced += w;
    else distance += w;
  }
  return { priced, distance };
}

/** Which way access leans: towards the deprived, or away from them.
 *
 *  People are ranked by deprivation, most deprived first, and the index asks
 *  whether access piles up at one end. Negative means the deprived have more
 *  of it, positive means they have less. Zero means deprivation tells you
 *  nothing about access.
 *
 *  `rank` is any measure of disadvantage where a higher number means worse
 *  off, which is how NZDep is written.
 */
export function concentrationIndex(values, weights, rank) {
  const rows = [];
  for (let i = 0; i < values.length; i += 1) {
    if (!(weights[i] > 0) || !Number.isFinite(values[i]) || !Number.isFinite(rank[i])) continue;
    rows.push(i);
  }
  if (rows.length < 2) return NaN;
  // Most deprived first, so a negative answer means access favours them.
  rows.sort((a, b) => rank[b] - rank[a]);
  const total = rows.reduce((sum, i) => sum + weights[i], 0);
  if (!(total > 0)) return NaN;
  const mean = rows.reduce((sum, i) => sum + values[i] * weights[i], 0) / total;
  if (!(Math.abs(mean) > 0)) return NaN;
  let running = 0;
  let index = 0;
  for (const i of rows) {
    const share = weights[i] / total;
    const fractional = running + share / 2;
    running += share;
    index += 2 * (fractional - 0.5) * (values[i] - mean) * share;
  }
  return index / mean;
}

/** The concentration index as a sentence, because the number says nothing on
 *  its own to anyone who has not met one before. */
export function leaning(index, { noun = 'access', groupNoun = 'more deprived areas' } = {}) {
  if (!Number.isFinite(index)) return null;
  const size = Math.abs(index);
  if (size < 0.02) return `${noun} is spread evenly across ${groupNoun} and better-off ones.`;
  const strength = size > 0.2 ? 'strongly' : size > 0.08 ? 'clearly' : 'slightly';
  return index < 0
    ? `${noun} ${strength} favours ${groupNoun}.`
    : `${noun} ${strength} favours better-off areas, not ${groupNoun}.`;
}

/** Shortfall by group, sorted worst first, against the regional rate. */
export function byGroup(times, standard, groups, unreachable = 60) {
  const rows = groups.map(([key, label, weights]) => ({
    key,
    label,
    ...fgt(times, weights, standard, unreachable),
  }));
  rows.sort((a, b) => (b.rate || 0) - (a.rate || 0));
  return rows;
}
