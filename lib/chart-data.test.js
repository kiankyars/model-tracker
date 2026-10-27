import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { timeBuckets, cumulativeBuckets, developerBuckets, sizePoints } from './chart-data.js';

const model = (id, date, open_weights = true, extra = {}) => ({ id, name: id, developer_id: id.split('/')[0], developer: id.split('/')[0], release_date: date, open_weights, ...extra });
const models = [
  model('a/old', '2018-06-11', true, { parameters_b: 0.117 }),
  model('b/last-year', '2024-12-31', false),
  model('a/first-quarter', '2025-02', true, { date_precision: 'month', parameters_b: 109, active_parameters_b: 17 }),
  model('a/second-quarter', '2025-04-01', null, { parameters_b: 7 }),
  model('b/undated', null, true, { parameters_b: 3 }),
];

test('full-history monthly buckets include early releases and zero-filled gaps', () => {
  const buckets = timeBuckets(models);
  assert.equal(buckets[0].key, '2018-06');
  assert.equal(buckets.at(-1).key, '2025-04');
  assert.equal(buckets.length, 83);
  assert.equal(buckets[1].total, 0);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.total, 0), 4);
  assert.equal(buckets.at(-1).total, 1);
});

test('quarter and year counts preserve boundaries and partially selected periods', () => {
  const quarters = timeBuckets(models, { from: '2024-12', to: '2025-04', interval: 'quarter' });
  assert.deepEqual(quarters.map(({ key, from, to, total }) => ({ key, from, to, total })), [
    { key: '2024-Q4', from: '2024-12', to: '2024-12', total: 1 },
    { key: '2025-Q1', from: '2025-01', to: '2025-03', total: 1 },
    { key: '2025-Q2', from: '2025-04', to: '2025-04', total: 1 },
  ]);
  assert.deepEqual(timeBuckets(models, { from: '2024-12', to: '2025-04', interval: 'year' }).map(bucket => [bucket.key, bucket.total]), [['2024', 1], ['2025', 2]]);
  assert.equal(timeBuckets(models, { from: '2025-03', to: '2025-02' }).length, 0);
  assert.deepEqual(timeBuckets([], { from: '2025-01', to: '2025-03' }).map(bucket => bucket.total), [0, 0, 0]);
});

test('cumulative totals reconcile with dated records without mutating release counts', () => {
  const buckets = timeBuckets(models, { interval: 'year' });
  const cumulative = cumulativeBuckets(buckets);
  assert.deepEqual(cumulative.at(-1), { ...buckets.at(-1), total: 4 });
  assert.equal(buckets.at(-1).total, 2);
  assert.ok(cumulative.every((bucket, index) => !index || bucket.total >= cumulative[index - 1].total));
});

test('developer comparisons use creator IDs and count undated records', () => {
  const groups = developerBuckets(models);
  assert.deepEqual(groups.map(group => [group.id, group.total]), [['a', 3], ['b', 2]]);
  assert.equal(groups.reduce((sum, group) => sum + group.total, 0), models.length);
});

test('size plots keep total and active parameters separate and preserve date precision', () => {
  const totals = sizePoints(models);
  assert.deepEqual(totals.map(point => point.value), [0.117, 109, 7]);
  assert.equal(totals[1].date, '2025-02');
  assert.equal(totals[1].date_precision, 'month');
  assert.deepEqual(sizePoints(models, { metric: 'active' }).map(point => point.value), [17]);
  assert.equal(sizePoints([model('bad/date', '2025-02-31', true, { parameters_b: 1 })]).length, 0);
  assert.equal(sizePoints([model('bad/value', '2025-01', true, { parameters_b: 0 })]).length, 0);
});

test('all time intervals reconcile the actual published catalog', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const dated = catalog.filter(model => model.release_date);
  for (const interval of ['month', 'quarter', 'year']) {
    const buckets = timeBuckets(catalog, { interval });
    assert.equal(buckets.reduce((sum, bucket) => sum + bucket.total, 0), dated.length);
    assert.equal(cumulativeBuckets(buckets).at(-1).total, dated.length);
  }
  assert.equal(timeBuckets(catalog)[0].from, '2018-06');
  assert.equal(developerBuckets(catalog).reduce((sum, bucket) => sum + bucket.total, 0), catalog.length);
});
