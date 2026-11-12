// Who a figure counts: everyone who lives in a hexagon, or, for early
// childhood and the three school services, the children of the ages that go
// there (cells.json `ages`, summary.json `meta.ages`; docs/schools.md).
//
// Builds before 0.12.0 round 2 send no ages, and then every figure counts all
// residents, as it did.

/** The age group each service counts, as the build names it. */
export const SERVICE_AGE = Object.freeze({
  early_childhood: '0_4',
  primary_school: '5_10',
  intermediate_school: '11_12',
  secondary_school: '13_17',
});

/** Everyone, for every other service. */
export const RESIDENTS_WORDS = Object.freeze({ key: null, many: 'people', one: 'person', column: null, line: null });

/** The age group a service counts in this build, or null for all residents.
 *  `ages` is cells.json's `ages` (or data.ages); a group the build did not
 *  send counts everyone. */
export function ageGroupFor(meta, ages, service) {
  if (!ages || !service) return null;
  const listed = meta && meta.ages && meta.ages.services ? meta.ages.services[service] : undefined;
  const key = listed !== undefined ? listed : SERVICE_AGE[service];
  return key && ages[key] ? key : null;
}

/** "13_17" as [13, 17]. */
function span(key) {
  const m = /^(\d+)_(\d+)$/.exec(String(key || ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The words for a group: { key, many: "children aged 13–17", one: "child
 *  aged 13–17", column: "children_13_17", years: "about Years 9 to 13",
 *  line } where `line` goes under the service's headlines. RESIDENTS_WORDS
 *  for no group. */
export function ageWords(meta, key) {
  if (!key) return RESIDENTS_WORDS;
  const spec = (meta && meta.ages && meta.ages.groups && meta.ages.groups[key]) || {};
  const ages = Array.isArray(spec.ages) && spec.ages.length === 2 ? spec.ages : span(key);
  const many = typeof spec.label === 'string' && spec.label ? spec.label
    : ages ? `children aged ${ages[0]}–${ages[1]}` : 'children';
  const one = many.replace(/^children\b/, 'child');
  // "Years 9–13" as "about Years 9 to 13": age stands in for the school year.
  const years = /^Years? (\d+)\s*[–-]\s*(\d+)$/.exec(String(spec.years || ''));
  const about = years ? `about Years ${years[1]} to ${years[2]}` : null;
  return {
    key,
    many,
    one,
    column: `children_${key}`,
    years: about,
    line: `Counting ${many}${about ? ` (${about})` : ''}, from 2023 Census age groups.`,
  };
}
