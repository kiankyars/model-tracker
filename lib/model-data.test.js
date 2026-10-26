import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, filterModels, sortModels, monthSeries, isMultimodal, toCSV } from './model-data.js';

const models = [
  { id: 'lab/tiny', name: 'Tiny', developer: 'Lab', developer_id: 'lab', family: 'test', release_date: '2025-01-09', date_precision: 'day', open_weights: true, parameters_b: 3, context_window: 32768, modalities: { input: ['text'], output: ['text'] }, reasoning: false },
  { id: 'lab/vision', name: 'Vision', developer: 'Lab', developer_id: 'lab', release_date: '2025-02', date_precision: 'month', open_weights: false, parameters_b: null, context_window: 128000, modalities: { input: ['text', 'image/png'], output: ['text'] }, reasoning: true },
  { id: 'other/large', name: 'Large', developer: 'Other', developer_id: 'other', release_date: '2024-12-01', open_weights: true, parameters_b: 100, context_window: null, modalities: { input: ['text'], output: ['text'] }, reasoning: true },
  { id: 'other/unknown', name: 'Unknown', developer: 'Other', developer_id: 'other', release_date: null, open_weights: null, parameters_b: null, context_window: null, modalities: { input: ['text'], output: ['text'] }, reasoning: null },
];
const filter = patch => filterModels(models, { ...defaults, ...patch });

test('filters intersect and preserve month precision', () => {
  assert.deepEqual(filter({ from: '2025-01', to: '2025-02', developer: 'lab', type: 'reasoning', access: 'closed' }).map(model => model.id), ['lab/vision']);
  assert.equal(filter({ from: '2025-02', to: '2025-02' }).length, 1);
  assert.equal(filter({ from: '2025-03', to: '2025-01' }).length, 0);
});
test('unknown access and parameter counts are not inferred', () => {
  assert.equal(filter({ access: 'unknown' })[0].id, 'other/unknown');
  assert.equal(filter({ size: 'unknown' }).length, 2);
  assert.equal(filter({ size: 'under3' }).length, 0);
  assert.equal(filter({ size: '3to10' })[0].id, 'lab/tiny');
  assert.equal(filter({ size: '100plus' })[0].id, 'other/large');
  assert.equal(filter({ size: '30to100' }).length, 0);
});
test('search matches all words across fields and handles MIME modalities', () => {
  assert.equal(filter({ q: 'LAB tiny' })[0].id, 'lab/tiny');
  assert.equal(filter({ q: 'tiny other' }).length, 0);
  assert.equal(isMultimodal(models[1]), true);
  assert.equal(filter({ type: 'text' }).length, 3);
});
test('unknown dates and sizes sort last in either direction', () => {
  assert.deepEqual(sortModels(models, 'oldest').map(model => model.id), ['other/large', 'lab/tiny', 'lab/vision', 'other/unknown']);
  assert.deepEqual(sortModels(models, 'newest').map(model => model.id), ['lab/vision', 'lab/tiny', 'other/large', 'other/unknown']);
  assert.equal(sortModels(models, 'size')[0].id, 'other/large');
  assert.equal(sortModels(models, 'context')[0].id, 'lab/vision');
});
test('monthly counts separate weights and exclude unknown dates', () => {
  const series = monthSeries(models, { from: '2024-11', to: '2025-02' });
  assert.deepEqual(series.map(month => month.total), [0, 1, 1, 1]);
  assert.equal(series.at(-1).closed, 1);
  assert.equal(series[1].open, 1);
  assert.equal(monthSeries(models, { from: '2025-06', to: '2025-02' }).length, 0);
});
test('charts cap at 24 months without changing the data', () => {
  assert.equal(monthSeries(models, { from: '2020-01', to: '2025-02' }).length, 24);
  assert.equal(models.length, 4);
});
test('CSV escapes commas, quotes, newlines, and spreadsheet formulas', () => {
  const csv = toCSV([{ ...models[0], name: '=HYPERLINK("https://example.com")', license: 'one,two\nthree' }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"one,two\nthree"'));
});
