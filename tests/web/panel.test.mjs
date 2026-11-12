import assert from 'node:assert/strict';
import test from 'node:test';

import { goalGroups, setServices, SERVICE_ORDER, shortScaleLabel, travelOptions } from '../../web/js/panel.js';

const META = {
  services: Object.fromEntries(['supermarket', 'gp', 'pharmacy', 'library', 'bank_post', 'early_childhood', 'primary_school',
    'intermediate_school', 'secondary_school', 'tertiary', 'trades_training'].map((k) => [k, { label: k }])),
  chains: { stops: ['gp', 'pharmacy', 'supermarket'] },
};

test('Getting to groups every service, then jobs, then the access scores', () => {
  setServices(META);
  const groups = goalGroups(SERVICE_ORDER, [['all', 'All opportunities'], ['everyday', 'Everyday services'], ['education', 'Schools'], ['jobs', 'Jobs']]);
  assert.deepEqual(groups.map((g) => g.label), ['Everyday', 'Community', 'Education', 'Work', 'Everything, nearer counts more']);
  assert.deepEqual(groups[0].options.map(([v]) => v), ['supermarket', 'gp', 'pharmacy', 'errands']);
  assert.deepEqual(groups[3].options, [['jobs', 'Jobs']]);
  assert.deepEqual(groups[4].options.map(([v, l]) => [v, l]), [
    ['score:all', 'Access score: all'], ['score:everyday', 'Access score: everyday'],
    ['score:education', 'Access score: education'], ['score:jobs', 'Access score: jobs'],
  ]);
  // Every service the build has is in the list once.
  const listed = groups.flatMap((g) => g.options.map(([v]) => v)).filter((v) => !v.startsWith('score:'));
  assert.deepEqual([...listed].sort(), [...SERVICE_ORDER].sort());
});

test('a destination the list does not know still appears, under Other', () => {
  setServices({ services: { ...META.services, dentist: { label: 'Dentist' } } });
  const groups = goalGroups(SERVICE_ORDER);
  const other = groups.find((g) => g.label === 'Other');
  assert.deepEqual(other.options, [['dentist', 'Dentist']]);
  assert.equal(groups[groups.length - 1].label, 'Work', 'jobs stay last when there is no score');
  setServices(META);
});

test('no errand round where the build has none', () => {
  setServices({ services: META.services });
  assert.ok(!goalGroups(SERVICE_ORDER)[0].options.some(([v]) => v === 'errands'));
  setServices(META);
});

test('Travel by: the ways that count as segments, comparisons under More', () => {
  const service = travelOptions('service', { standardModes: ['walk', 'bike_low_stress', 'pt'], slowWalk: true });
  assert.deepEqual(service.segments.map(([m, label]) => [m, label]), [['best', 'Best'], ['walk', 'Walk'], ['bike_low_stress', 'Cycle'], ['pt', 'PT']]);
  assert.deepEqual(service.more.map(([m]) => m), ['walk_slow', 'bike', 'car']);
  assert.match(service.more[1][1], /comparison/);
  assert.equal(travelOptions('service', { standardModes: ['walk', 'pt'] }).more[0][0], 'bike', 'no slower pace where none was built');
});

test('Travel by for jobs, the errand round and the score', () => {
  const jobs = travelOptions('jobs', { jobsModes: ['pt', 'bike_low_stress', 'bike', 'walk', 'car'] });
  assert.deepEqual(jobs.segments.map(([m]) => m), ['pt', 'walk', 'bike_low_stress']);
  assert.deepEqual(jobs.more.map(([m]) => m), ['bike', 'car']);
  const round = travelOptions('errands', { roundModes: ['walk', 'pt', 'bike_low_stress'] });
  assert.deepEqual(round.segments.map(([, label]) => label), ['Walk', 'Walk and PT', 'Cycle']);
  assert.equal(round.more.length, 0);
  const score = travelOptions('score', { scoreModes: ['walk', 'pt', 'bike_low_stress'], betaModes: ['bike_low_stress'] });
  assert.deepEqual(score.segments.map(([, label]) => label), ['Walk', 'PT', 'Cycle (beta)']);
});

test('a phone\'s key strip shows each step by its upper figure', () => {
  assert.equal(shortScaleLabel('10 or less'), '10');
  assert.equal(shortScaleLabel('10–15'), '15');
  assert.equal(shortScaleLabel('over 45'), '45+');
  assert.equal(shortScaleLabel('2.5–5%'), '5%');
  assert.equal(shortScaleLabel('No way'), 'No way');
  assert.equal(shortScaleLabel('under 2.5%'), 'under 2.5%');
});

test('One school with everyone counted: a count of people, and for an area only, a share named as such', async () => {
  const { withinSentence } = await import('../../web/js/panel.js');
  const base = { noun: 'Mt Albert Grammar School', standard: 30, within: 57002.8 };
  assert.equal(withinSentence({ ...base, mode: 'pt' }), 'people live within 30 minutes of Mt Albert Grammar School by public transport.');
  assert.equal(withinSentence({ ...base, mode: 'walk' }), 'people live within 30 minutes of Mt Albert Grammar School on foot.');
  assert.equal(withinSentence({ ...base, mode: 'best' }), 'people live within 30 minutes of Mt Albert Grammar School without a car.');
  assert.equal(withinSentence({ ...base, mode: 'pt', where: 'the Albert-Eden Local Board area' }),
    'people in the Albert-Eden Local Board area live within 30 minutes of Mt Albert Grammar School by public transport.');
  assert.equal(withinSentence({ ...base, within: 1, mode: 'bike_low_stress' }), 'person lives within 30 minutes of Mt Albert Grammar School by low-stress cycling.');
});
