import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, buildData } from '../scripts/build-data.mjs';
import { catalogTimestamps, csv, eligibleModel, isFuture, mergeCatalog, namedParameters, normalize, slugFor, statistics, validDate, validateModels } from '../scripts/data-lib.mjs';

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

test('curated text-generating models retain observation dates when upstream calls them image-only', () => {
  const historical = [{ ...normalize('lab/multimodal', upstream(), at), source_type: 'primary', source_url: 'https://example.org/model', sources: [{ url: 'https://example.org/model' }], modalities: { input: ['text'], output: ['text', 'image'] } }];
  const options = { upstream: { 'lab/multimodal': { ...upstream(), type: 'image' } }, historical, retrievedAt: at, asOf: '2026-10-26' };
  const first = mergeCatalog({ ...options, reviewedAt: at });
  const refreshed = mergeCatalog({ ...options, previous: first.models, reviewedAt: '2026-10-29T12:00:00Z' });
  assert.deepEqual(refreshed.models, first.models);
  assert.equal(refreshed.models[0].upstream_present, false);
});

test('service tiers do not reappear as releases after refresh or inflate alias counts', () => {
  const options = {
    upstream: { 'lab/model': upstream(), 'lab/model-fast': upstream() },
    previous: [normalize('lab/model-fast', upstream(), at)],
    corrections: { exclude: { 'lab/model-fast': { category: 'service_tier', reason: 'Processing option for the same model', related_model_id: 'lab/model', source_url: 'https://example.org/fast' } } },
    retrievedAt: at, asOf: '2026-10-26',
  };
  const first = mergeCatalog(options);
  const refreshed = mergeCatalog({ ...options, previous: first.models });
  assert.deepEqual(refreshed.models.map(model => model.id), ['lab/model']);
  assert.equal(statistics(refreshed.models).total_models, 1);
  assert.equal(refreshed.coverage.excluded_service_tiers, 1);
  assert.equal(refreshed.coverage.excluded_mutable_aliases, 0);
  assert.equal(refreshed.coverage.excluded_non_language_models, 0);
});

test('explicit alias corrections collapse aliases while preserving distinct versions', () => {
  const result = mergeCatalog({ upstream: { 'lab/model': upstream(), 'lab/model-2025': upstream(), 'lab/model-v2': { ...upstream(), release_date: '2026-01-01' } }, corrections: { aliases: { 'lab/model-2025': 'lab/model' }, overrides: { 'lab/model': { release_date: '2025-02-28' } } }, retrievedAt: at, asOf: '2026-10-26' });
  assert.equal(result.models.length, 2);
  assert.deepEqual(result.models.find(model => model.id === 'lab/model').aliases, ['lab/model-2025']);
  assert.equal(result.models.find(model => model.id === 'lab/model').release_date, '2025-02-28');
});

test('third-party derivatives stay excluded across refreshes without inflating alias counts', () => {
  const result = mergeCatalog({
    upstream: { 'lab/base': upstream(), 'other/tuned': upstream() },
    historical: [normalize('other/tuned', upstream(), at)],
    previous: [normalize('other/tuned', upstream(), at)],
    corrections: { exclude: { 'other/tuned': { category: 'third_party_derivative', reason: 'Fine-tune of lab/base' } } },
    retrievedAt: at, asOf: '2026-10-26',
  });
  assert.deepEqual(result.models.map(model => model.id), ['lab/base']);
  assert.equal(result.coverage.excluded_third_party_derivatives, 1);
  assert.equal(result.coverage.excluded_mutable_aliases, 0);
});

test('an incorrect weights link stays removed after upstream refresh', () => {
  const wrong = 'https://example.org/other-model';
  const record = { ...upstream(), weights: [{ url: wrong }] };
  const previous = [{ ...normalize('lab/model', record, at), sources: [{ label: 'Weights', url: wrong, type: 'weights' }] }];
  const options = { upstream: { 'lab/model': record }, previous, corrections: { overrides: { 'lab/model': { remove_source_urls: [wrong] } } }, retrievedAt: at, asOf: '2026-10-26' };
  const first = mergeCatalog(options);
  const refreshed = mergeCatalog({ ...options, previous: first.models });
  assert.equal(refreshed.models[0].sources.some(source => source.url === wrong), false);
  assert.equal(Object.hasOwn(refreshed.models[0], 'remove_source_urls'), false);
  assert.ok(refreshed.models[0].sources.length);
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

test('research admits confirmed releases after the source snapshot without admitting unverified future entries', () => {
  const reviewedAt = '2026-11-02T09:00:00.000Z';
  const proof = { source_type: 'primary', source_url: 'https://example.org/release', sources: [{ label: 'Release announcement', url: 'https://example.org/release', type: 'announcement' }] };
  const options = {
    upstream: {
      'lab/existing': upstream(),
      'lab/announced': { ...upstream(), release_date: '2026-10-30' },
      'lab/confirmed': { ...upstream(), release_date: '2026-10-29' },
    },
    historical: [
      { ...normalize('lab/researched', upstream(), at), ...proof, release_date: '2026-10-31' },
      { ...normalize('lab/still-future', upstream(), at), ...proof, release_date: '2026-11-03' },
    ],
    corrections: { overrides: { 'lab/confirmed': { ...proof, release_date: '2026-10-29' } } },
    retrievedAt: at, asOf: '2026-10-26', reviewedAt,
  };
  const first = mergeCatalog(options);
  assert.deepEqual(first.models.map(model => model.id), ['lab/researched', 'lab/confirmed', 'lab/existing']);
  assert.equal(first.models.find(model => model.id === 'lab/researched').first_seen, reviewedAt);
  assert.equal(first.models.find(model => model.id === 'lab/confirmed').first_seen, reviewedAt);
  assert.equal(first.models.find(model => model.id === 'lab/existing').first_seen, at);
  assert.deepEqual(mergeCatalog({ ...options, previous: first.models }).models, first.models);
  const retained = mergeCatalog({ ...options, historical: [], previous: first.models });
  assert.ok(retained.models.some(model => model.id === 'lab/researched'));
});

test('research timestamps are validated and cannot replace newer source retrieval times', () => {
  assert.equal(catalogTimestamps(at).updated, at);
  assert.equal(catalogTimestamps(at, '2026-11-02T11:00:00+02:00').updated, '2026-11-02T09:00:00.000Z');
  assert.equal(catalogTimestamps(at, '2026-10-20T09:00:00Z').updated, at);
  assert.throws(() => catalogTimestamps(at, '2026-02-30T09:00:00Z'));
  assert.throws(() => catalogTimestamps(at, '2026-11-02'));
  const result = mergeCatalog({ upstream: {}, historical: [{ ...normalize('lab/researched', upstream(), at), release_date: '2026-10-25', source_type: 'primary', source_url: 'https://example.org/release', sources: [{ label: 'Launch', url: 'https://example.org/release', type: 'announcement' }] }], retrievedAt: at, reviewedAt: '2026-10-20T09:00:00Z' });
  assert.equal(result.models.length, 0);
});

test('research-only builds update publication metadata while retaining the upstream timestamp', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'model-tracker-research-'));
  try {
    await fs.mkdir(path.join(root, 'data/source'), { recursive: true });
    const raw = JSON.stringify({ 'lab/existing': upstream(), 'lab/announced': { ...upstream(), release_date: '2026-10-30' } });
    const metadata = { retrieved_at: at };
    await fs.writeFile(path.join(root, 'data/source/models.dev.json'), raw);
    await fs.writeFile(path.join(root, 'data/source/metadata.json'), JSON.stringify(metadata));
    const original = await buildData({ root });
    assert.equal(original.envelope.updated_at, at);
    assert.equal(original.envelope.research, undefined);
    const reviewedAt = '2026-11-02T09:00:00.000Z';
    await fs.writeFile(path.join(root, 'data/research-metadata.json'), JSON.stringify({ reviewed_at: reviewedAt }));
    const record = { ...normalize('lab/researched', upstream(), at), release_date: '2026-10-31', source_type: 'primary', source_url: 'https://example.org/release', sources: [{ label: 'Release announcement', url: 'https://example.org/release', type: 'announcement' }] };
    await fs.writeFile(path.join(root, 'data/historical.json'), JSON.stringify([record]));
    const result = await buildData({ root });
    assert.equal(result.envelope.updated_at, reviewedAt);
    assert.equal(result.envelope.research.reviewed_at, reviewedAt);
    assert.equal(result.envelope.source.retrieved_at, at);
    assert.deepEqual(result.models.map(model => model.id), ['lab/researched', 'lab/existing']);
    const single = JSON.parse(await fs.readFile(path.join(root, 'public/api/v1/models/lab--researched.json'), 'utf8'));
    assert.equal(single.updated_at, reviewedAt);
    assert.equal(single.model.first_seen, reviewedAt);
    assert.deepEqual(await buildData({ root }), result);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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

test('published API counts reconcile and every index route exists', async () => {
  const read = async name => JSON.parse(await fs.readFile(path.join(ROOT, name), 'utf8'));
  const full = await read('public/api/v1/models.json');
  const stats = await read('public/api/v1/stats.json');
  const index = await read('public/api/v1/index.json');
  validateModels(full.models, full.updated_at.slice(0, 10));
  assert.equal(full.models.length, stats.total_models);
  assert.equal(full.models.length, index.models.length);
  assert.equal(stats.recorded_releases, index.months.reduce((sum, month) => sum + month.count, 0));
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


test('verified announcements survive without a release date or size and retain their identity through release', () => {
  const record = {
    ...normalize('lab/upcoming', { ...upstream('Upcoming'), release_date: null }, at),
    announcement_date: '2026-10-28', availability: 'announced', source_type: 'primary',
    source_url: 'https://example.org/announcement', sources: [{ label: 'Announcement', url: 'https://example.org/announcement', type: 'announcement' }],
  };
  const options = { upstream: {}, historical: [record], retrievedAt: at, reviewedAt: '2026-10-29T09:00:00Z' };
  const first = mergeCatalog(options).models;
  assert.equal(first.length, 1);
  assert.equal(first[0].release_date, null);
  assert.equal(first[0].parameters_b, null);
  assert.equal(first[0].first_seen, '2026-10-29T09:00:00.000Z');
  const released = mergeCatalog({ ...options, previous: first, historical: [{ ...record, availability: 'limited', release_date: '2026-10-29' }] }).models;
  assert.equal(released.length, 1);
  assert.equal(released[0].id, first[0].id);
  assert.equal(released[0].announcement_date, first[0].announcement_date);
  assert.equal(released[0].first_seen, first[0].first_seen);
  assert.equal(statistics(released).recorded_releases, 1);
  assert.throws(() => validateModels([{ ...released[0], availability: 'announced' }]));
  assert.throws(() => validateModels([{ ...released[0], availability: 'unknown' }]));
  assert.throws(() => validateModels([{ ...record, announcement_date: '2026-02-30' }]));
  assert.throws(() => validateModels([record], '2026-10-27'));
  assert.throws(() => validateModels([{ ...record, announcement_date: null }]));
  assert.throws(() => validateModels([{ ...released[0], release_date: '2026-09', date_precision: 'month' }]));
  assert.doesNotThrow(() => validateModels([{ ...released[0], announcement_date: '2026-10', release_date: '2026-10-01' }]));
  assert.doesNotThrow(() => validateModels([{ ...released[0], release_date: '2026-10', date_precision: 'month' }]));
});

test('lifecycle statistics preserve catalog counts without inventing public availability', () => {
  const records = [
    normalize('lab/released', upstream(), at),
    normalize('lab/undated', { ...upstream(), release_date: null }, at),
    { ...normalize('lab/announced', { ...upstream(), release_date: null }, at), availability: 'announced', announcement_date: '2026-10-25' },
  ];
  const stats = statistics(records);
  assert.equal(stats.total_models, 3);
  assert.equal(stats.recorded_releases, 1);
  assert.equal(stats.by_month.reduce((total, month) => total + month.total, 0), 1);
  assert.equal(stats.by_developer[0].count, 3);
  assert.equal(stats.by_developer[0].recorded_releases, 1);
  assert.equal(stats.unknown_release_dates, 1);
  assert.deepEqual(stats.availability, { announced: 1, limited: 0, public: 0, not_recorded: 2 });
  assert.equal(Object.hasOwn(records[0], 'availability'), false);
});

test('build publishes announcements, candidates and coverage without private queue fields', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'model-tracker-lifecycle-'));
  try {
    await fs.mkdir(path.join(root, 'data/source'), { recursive: true });
    await fs.mkdir(path.join(root, 'research/backfill'), { recursive: true });
    const write = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value));
    await write('data/source/models.dev.json', { 'lab/released': upstream() });
    await write('data/source/metadata.json', { retrieved_at: at });
    await write('data/historical.json', [{ ...normalize('lab/announced', { ...upstream('Upcoming'), release_date: null }, at), availability: 'announced', announcement_date: '2026-10-25' }]);
    await write('data/candidates.json', { schema_version: '1.0', local_path: '/private', candidates: [{ id: 'source:new', name: 'Candidate', status: 'pending', local_path: '/private', sources: [{ url: 'https://example.org/new', local_path: '/private' }, { url: 'file:///private' }] }] });
    await write('research/backfill/coverage.json', { schema_version: '1.0', local_path: '/private', months: [{ month: '2022-01', status: 'unreviewed', outstanding_candidates: 2, last_reviewed: null, local_path: '/private' }] });
    await buildData({ root });
    const read = async name => JSON.parse(await fs.readFile(path.join(root, 'public/api/v1', name), 'utf8'));
    assert.equal((await read('models.json')).models.length, 2);
    assert.equal((await read('models/lab--announced.json')).model.availability, 'announced');
    assert.equal((await read('developers/lab.json')).count, 2);
    assert.equal((await read('stats.json')).recorded_releases, 1);
    const index = await read('index.json');
    assert.equal(index.months.reduce((total, month) => total + month.count, 0), 1);
    for (const endpoint of ['candidates', 'coverage']) {
      const content = await read(index.endpoints[endpoint]);
      assert.equal(JSON.stringify(content).includes('/private'), false);
    }
    assert.equal((await read('candidates.json')).candidates[0].sources.length, 1);
    assert.equal((await read('coverage.json')).months[0].status, 'unreviewed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
