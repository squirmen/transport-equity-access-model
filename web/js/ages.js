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

/** A group as the figures may count it: an age group the build sends
 *  ("13_17"), 15_17 (13_17 less 13_14), either with ":girls" or ":boys"
 *  for a single-sex school. { group, sex }. */
export function splitKey(key) {
  const [group, sex] = String(key || '').split(':');
  return { group, sex: sex === 'girls' || sex === 'boys' ? sex : null };
}

/** The share of girls (or boys) among the children of a group here, from
 *  meta.ages.sex (2018 Census, the place's SA2s), or null. */
export function sexShare(meta, group, sex) {
  const girls = meta && meta.ages && meta.ages.sex && meta.ages.sex.girls ? meta.ages.sex.girls[group] : null;
  if (!Number.isFinite(girls) || !sex) return null;
  return sex === 'girls' ? girls : 1 - girls;
}

/** Who One school counts: the children of the ages its own years cover
 *  (a secondary school starting at Year 11 counts 15–17, one stopping at
 *  Year 10 counts 13–14), and of its sex where it takes girls or boys only.
 *  `ages` is the data's ages, `dest` the school. Null where the build sends
 *  no ages for the service. */
export function schoolAgeKey(meta, ages, service, dest) {
  let key = ageGroupFor(meta, ages, service);
  if (!key) return null;
  const years = dest && Array.isArray(dest.years) ? dest.years.map(Number) : null;
  if (service === 'secondary_school' && key === '13_17' && ages['13_14'] && years && years.every(Number.isFinite)) {
    const junior = years[0] <= 10 && years[1] >= 9;
    const senior = years[0] <= 13 && years[1] >= 11;
    if (junior && !senior) key = '13_14';
    else if (senior && !junior) key = '15_17';
  }
  const sex = dest && dest.sex && typeof dest.sex === 'object' ? dest.sex[service] : null;
  if ((sex === 'girls' || sex === 'boys') && sexShare(meta, key, sex) != null) key = `${key}:${sex}`;
  return key;
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
  const { group, sex } = splitKey(key);
  const spec = (meta && meta.ages && meta.ages.groups && meta.ages.groups[group]) || {};
  const ages = Array.isArray(spec.ages) && spec.ages.length === 2 ? spec.ages : span(group);
  let many = typeof spec.label === 'string' && spec.label ? spec.label
    : ages ? `children aged ${ages[0]}–${ages[1]}` : 'children';
  let one = many.replace(/^children\b/, 'child');
  if (sex) {
    many = many.replace(/^children\b/, sex);
    one = one.replace(/^child\b/, sex === 'girls' ? 'girl' : 'boy');
  }
  // "Years 9–13" as "about Years 9 to 13": age stands in for the school year.
  const years = /^Years? (\d+)\s*[–-]\s*(\d+)$/.exec(String(spec.years || ''));
  const about = years ? `about Years ${years[1]} to ${years[2]}` : null;
  const share = sex ? sexShare(meta, group, sex) : null;
  // A single-sex school: the census gives children by age for each block,
  // not by sex, so girls (or boys) are taken as the place's share of them.
  const sexLine = share != null
    ? ` ${sex === 'girls' ? 'Girls' : 'Boys'} are ${Math.round(share * 100)}% of the ${spec.label || 'children of these ages'} in this place (2018 Census), and are taken to live where the others do.`
    : '';
  return {
    key,
    many,
    one,
    column: `${sex || 'children'}_${group}`,
    years: about,
    sexShare: share,
    line: `Counting ${many}${about ? ` (${about})` : ''}, from 2023 Census age groups.${sexLine}`,
  };
}
