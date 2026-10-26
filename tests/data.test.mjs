import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../scripts/build-data.mjs';
import { csv, eligibleModel, isFuture, mergeCatalog, namedParameters, normalize, sha256, slugFor, statistics, validDate, validateModels } from '../scripts/data-lib.mjs';

const at = '2026-10-26T12:00:00.000Z';
const upstream = (name = 'Test 7B') => ({ name, release_date: '2025-03-01', open_weights: true, reasoning: false, tool_call: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 8192 } });

test('dates preserve precision and reject invalid calendar days', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
  assert.equal(validDate('2025-13'), false);
  assert.equal(validDate('2025-09'), true);
  assert.equal(isFuture('2026-10', '2026-10-01'), false);
  assert.equal(isFuture('2026-11', '2026-10-26'), true);
  assert.equal(normalize('lab/test', { ...upstream(), release_date: '2025-09' }, at).date_precision, 'month');
});

test('parameter labels distinguish total, active and ambiguous expert widths', () => {
  assert.equal(namedParameters('Qwen 3.8 2.4T A95B').parameters_b, 2400);
  assert.equal(namedParameters('Qwen 3.8 2.4T A95B').active_parameters_b, 95);
  assert.equal(namedParameters('GPT-4.1').parameters_b, null);
  assert.equal(namedParameters('Model 350M').parameters_b, 0.35);
  assert.equal(namedParameters('Mixtral 8x7B').parameters_b, null);
  assert.equal(namedParameters('Llama 4 Scout 17B Instruct', 'meta/llama-4-scout-17b-instruct').parameters_b, null);
  assert.equal(namedParameters('Gemma 3n E2B IT').parameters_b, null);
});

test('catalog scope excludes embeddings and image-generation models', () => {
  assert.equal(eligibleModel(upstream()), true);
  assert.equal(eligibleModel({ ...upstream(), type: 'embedding' }), false);
  assert.equal(eligibleModel({ ...upstream(), type: 'transcription' }), false);
  assert.equal(eligibleModel({ ...upstream(), type: 'image' }), false);
  assert.equal(eligibleModel({ ...upstream(), modalities: { input: ['text'], output: ['image'] } }), false);
});

test('refresh retains removed records and first-seen dates; future releases are not counted', () => {
  const previous = [normalize('lab/old', upstream(), '2026-01-01T00:00:00.000Z'), normalize('lab/current', upstream(), '2026-01-01T00:00:00.000Z')];
  const result = mergeCatalog({ upstream: { 'lab/current': upstream(), 'lab/future': { ...upstream(), release_date: '2027-01-01' } }, previous, retrievedAt: at, asOf: '2026-10-26' });
  assert.equal(result.models.length, 2);
  assert.equal(result.models.find(model => model.id === 'lab/old').upstream_present, false);
  assert.equal(result.models.find(model => model.id === 'lab/current').first_seen, previous[1].first_seen);
  assert.equal(result.coverage.excluded_future_releases, 1);
});

test('a model explicitly reclassified outside scope is removed instead of historically retained', () => {
  const result = mergeCatalog({
    upstream: { 'lab/classifier': { ...upstream(), type: 'embedding' }, 'lab/guard': upstream() },
    previous: [normalize('lab/classifier', upstream(), at)],
    corrections: { exclude: { 'lab/guard': { category: 'non_language_model', reason: 'Sequence classifier' } } },
    retrievedAt: at, asOf: '2026-10-26',
  });
  assert.equal(result.models.length, 0);
  assert.equal(result.coverage.excluded_non_language_models, 2);
  assert.equal(result.coverage.excluded_mutable_aliases, 0);
});

test('an upstream date corrected into the future removes an earlier mistaken release', () => {
  const result = mergeCatalog({
    upstream: { 'lab/model': { ...upstream(), release_date: '2027-01-01' } },
    previous: [normalize('lab/model', upstream(), at)],
    retrievedAt: at, asOf: '2026-10-26',
  });
  assert.equal(result.models.length, 0);
  assert.equal(result.coverage.excluded_future_releases, 1);
});

test('explicit alias corrections collapse aliases while preserving distinct versions', () => {
  const result = mergeCatalog({ upstream: { 'lab/model': upstream(), 'lab/model-2025': upstream(), 'lab/model-v2': { ...upstream(), release_date: '2026-01-01' } }, corrections: { aliases: { 'lab/model-2025': 'lab/model' }, overrides: { 'lab/model': { release_date: '2025-02-28' } } }, retrievedAt: at, asOf: '2026-10-26' });
  assert.equal(result.models.length, 2);
  assert.deepEqual(result.models.find(model => model.id === 'lab/model').aliases, ['lab/model-2025']);
  assert.equal(result.models.find(model => model.id === 'lab/model').release_date, '2025-02-28');
});

test('corrections and exclusions survive refresh and offline regeneration is idempotent', () => {
  const options = {
    upstream: { 'lab/model': upstream(), 'lab/alias': upstream(), 'lab/model-latest': upstream() },
    historical: [{ ...normalize('lab/historical', upstream(), at), source_type: 'primary', parameters_source: 'primary_source' }],
    corrections: {
      aliases: { 'lab/alias': 'lab/model' },
      alias_sources: { 'lab/alias': { url: 'https://example.org/aliases', note: 'Documented alias' } },
      overrides: { 'lab/model': { release_date: '2025-02-28', sources: [{ label: 'Launch', url: 'https://example.org/launch', type: 'announcement' }] } },
      exclude: { 'lab/model-latest': { reason: 'Mutable alias', source_url: 'https://example.org/aliases' } },
    },
    retrievedAt: at, asOf: '2026-10-26',
  };
  const first = mergeCatalog(options);
  const second = mergeCatalog({ ...options, previous: first.models });
  assert.deepEqual(second.models, first.models);
  assert.equal(second.models.length, 2);
  assert.equal(second.models.find(model => model.id === 'lab/model').release_date, '2025-02-28');
  const refreshed = mergeCatalog({ ...options, previous: first.models, retrievedAt: '2026-10-27T12:00:00.000Z', asOf: '2026-10-27' });
  assert.equal(refreshed.models.find(model => model.id === 'lab/model').first_seen, at);
  assert.equal(refreshed.models.find(model => model.id === 'lab/model').last_seen, '2026-10-27T12:00:00.000Z');
  assert.equal(refreshed.models.find(model => model.id === 'lab/historical').upstream_present, false);
});

test('missing information stays null and unsafe identifiers are rejected', () => {
  const record = normalize('lab/model', { ...upstream('Undisclosed'), open_weights: undefined }, at);
  assert.equal(record.parameters_b, null);
  assert.equal(record.open_weights, null);
  assert.equal(record.license, null);
  assert.throws(() => slugFor('../../escape'));
  assert.throws(() => validateModels([{ ...record, parameters_b: -1 }]));
  assert.throws(() => validateModels([record, record]));
});

test('statistics reconcile and CSV escapes hostile spreadsheet prefixes', () => {
  const records = [normalize('lab/a', upstream(), at), normalize('lab/b', { ...upstream('Unknown'), open_weights: false }, at)];
  const stats = statistics(records);
  assert.equal(stats.total_models, stats.by_month.reduce((sum, month) => sum + month.total, 0));
  assert.equal(stats.total_models, stats.open_weights + stats.closed_weights + stats.unknown_openness);
  assert.match(csv([{ ...records[0], name: '=1+1' }]), /"'=1\+1"/);
});

test('published API reconciles against snapshot and every index route exists', async () => {
  const read = async name => JSON.parse(await fs.readFile(path.join(ROOT, name), 'utf8'));
  const raw = await fs.readFile(path.join(ROOT, 'data/source/models.dev.json'), 'utf8');
  const metadata = await read('data/source/metadata.json');
  assert.equal(sha256(raw), metadata.sha256);
  const full = await read('public/api/v1/models.json');
  const stats = await read('public/api/v1/stats.json');
  const index = await read('public/api/v1/index.json');
  validateModels(full.models, full.updated_at.slice(0, 10));
  assert.equal(full.models.length, stats.total_models);
  assert.equal(full.models.length, index.models.length);
  assert.equal(full.models.length, index.months.reduce((sum, month) => sum + month.count, 0));
  assert.equal(full.models.length, index.developers.reduce((sum, developer) => sum + developer.count, 0));
  const byId = new Map(full.models.map(model => [model.id, model]));
  for (const entry of [...index.models, ...index.months, ...index.developers]) {
    const partition = await read(`public/api/v1/${entry.path}`);
    if (partition.models) {
      assert.equal(partition.count, partition.models.length);
      for (const model of partition.models) {
        assert.deepEqual(model, byId.get(model.id));
        if (partition.month) assert.equal(model.release_date?.slice(0, 7) || 'unknown', partition.month);
        if (partition.developer) assert.equal(model.developer_id, partition.developer.id);
      }
    }
    if (partition.model) assert.deepEqual(partition.model, byId.get(entry.id));
  }
});
