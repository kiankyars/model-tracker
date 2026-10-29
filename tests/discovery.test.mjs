import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectArtificialAnalysis, collectHuggingFace, collectModelsDev, collectModelScope, collectOpenRouter, collectEpoch,
  dateWindow, dueCandidates, enumeratePages, mergeCandidates, modelObservation, parseFeed,
  parseModelsDev, reviewCandidate, seedFromReports, parseCsv, metadataDisposition, reconcileCatalogCandidates,
} from '../scripts/discovery-lib.mjs';

const now = '2026-10-29T10:00:00.000Z';
const old = '2026-10-01T00:00:00.000Z';
const options = { since: '2026-10-15T00:00:00.000Z', through: now, maxPages: 2, pageSize: 2 };
const empty = () => ({ schema_version: '1.0', updated_at: now, candidates: [] });
const response = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), { status, headers });
const source = id => ({ id, url: `https://example.com/${id}` });

test('catalog reconciliation closes newly verified identities and respects exclusions and pending rollout checks', () => {
  const queue = { candidates: [
    { id: 'new', status: 'pending', sources: [{ key: 'lab/model', url: 'https://example.org' }] },
    { id: 'old', status: 'tracked', model_id: 'other/tuned', sources: [] },
    { id: 'rollout', status: 'pending', model_id: 'lab/model', reason: 'External availability unverified', sources: [] },
  ] };
  const result = reconcileCatalogCandidates(queue, [{ id: 'lab/model', aliases: [], sources: [] }], { exclude: { 'other/tuned': { reason: 'External base fine-tune' } } }, now);
  assert.equal(result.candidates[0].status, 'tracked');
  assert.equal(result.candidates[1].status, 'excluded');
  assert.equal(result.candidates[2].status, 'pending');
  assert.equal(queue.candidates[0].status, 'pending');
});

test('a related base-model citation cannot silently catalog a missing base as its instruction variant', () => {
  const catalog = [{ id: 'lab/model-instruct', aliases: [], source_url: 'https://example.org/launch', sources: [{ url: 'https://huggingface.co/Lab/Model' }, { url: 'https://huggingface.co/Lab/Model-Instruct' }] }];
  const base = modelObservation('huggingface', 'Lab/Model', 'Base', 'https://huggingface.co/Lab/Model');
  const instruct = modelObservation('huggingface', 'Lab/Model-Instruct', 'Instruct', 'https://huggingface.co/Lab/Model-Instruct');
  const result = mergeCandidates(empty(), [base, instruct], catalog, now);
  assert.equal(result.candidates.find(row => row.name === 'Base').status, 'pending');
  assert.equal(result.candidates.find(row => row.name === 'Instruct').status, 'tracked');
});

test('automatic inherited identity is checked before exclusion while explicitly reviewed aliases survive', () => {
  const catalog = [{ id: 'lab/base', source_url: 'https://huggingface.co/lab/Base', aliases: [], sources: [] }];
  const corrections = { exclude: { 'community/tuned': { reason: 'Community derivative.', source_url: 'https://huggingface.co/community/Tuned' } } };
  const source = { key: 'lab/Base', url: 'https://huggingface.co/lab/Base' };
  const queue = { candidates: [
    { id: 'wrong', status: 'tracked', model_id: 'community/tuned', reason: 'Exact catalog ID or weight-repository match.', sources: [source] },
    { id: 'manual-alias', status: 'tracked', model_id: 'community/tuned', reason: 'Publisher confirms this provider alias identifies the tuned model.', sources: [{ key: 'provider/alias', url: 'https://provider.example/alias' }] },
    { id: 'correct', status: 'tracked', model_id: 'community/tuned', reason: 'Exact catalog ID or weight-repository match.', sources: [{ key: 'community/tuned', url: 'https://huggingface.co/community/Tuned' }] },
  ] };
  const result = reconcileCatalogCandidates(queue, catalog, corrections, now);
  assert.equal(result.candidates[0].status, 'tracked');
  assert.equal(result.candidates[0].model_id, 'lab/base');
  assert.equal(result.candidates[1].status, 'excluded');
  assert.equal(result.candidates[1].model_id, 'community/tuned');
  assert.equal(result.candidates[2].status, 'excluded');
});

test('provider-declared repository identity remains available for later queue reconciliation', () => {
  const catalog = [{ id: 'lab/model', source_url: 'https://huggingface.co/lab/Model', aliases: [], sources: [] }];
  const observation = modelObservation('openrouter', 'provider/model:free', 'Model', 'https://openrouter.ai/provider/model:free', { identity_urls: ['https://huggingface.co/lab/Model'] });
  const queue = mergeCandidates(empty(), [observation], catalog, now);
  assert.equal(queue.candidates[0].status, 'tracked');
  assert.deepEqual(queue.candidates[0].sources[0].identity_urls, observation.identity_urls);
  assert.deepEqual(mergeCandidates(queue, [], catalog, now), queue);
});

function fetchPages(pages) {
  const requests = [];
  return { requests, fetcher: async (url, init) => {
    requests.push({ url, headers: init.headers });
    if (!pages.length) throw new Error('Unexpected request');
    const page = pages.shift();
    if (page instanceof Error) throw page;
    return page;
  } };
}

test('pagination follows links, records explicit truncation and resumes without discarding observations', async () => {
  const pages = {
    'https://example.com/1': { items: [{ key: 'a' }], next: '/2', total: 3, expectTotal: true },
    'https://example.com/2': { items: [{ key: 'b' }], next: '/3', total: 3, expectTotal: true },
    'https://example.com/3': { items: [{ key: 'c' }], next: null, total: 3, expectTotal: true },
  };
  const first = await enumeratePages({ startUrl: 'https://example.com/1', maxPages: 2, readPage: async url => pages[url] });
  assert.equal(first.status, 'truncated');
  assert.equal(first.cursor.next_url, 'https://example.com/3');
  assert.equal(first.observations.length, 2);
  const next = await enumeratePages({ startUrl: 'https://example.com/1', resume: first.cursor, readPage: async url => pages[url] });
  assert.equal(next.status, 'complete');
  assert.equal(next.items_seen, 3);
});

test('pagination detects failures, count mismatch, cycles and foreign continuation origins', async () => {
  const partial = await enumeratePages({ startUrl: 'https://example.com/1', readPage: async url => {
    if (url.endsWith('/2')) throw new Error('HTTP 429');
    return { items: [{ key: 'a' }], next: '/2' };
  } });
  assert.equal(partial.status, 'failed');
  assert.equal(partial.observations.length, 1);
  assert.equal(partial.cursor.next_url, 'https://example.com/2');
  for (const next of ['https://example.com/1', 'https://other.example/2']) {
    const result = await enumeratePages({ startUrl: 'https://example.com/1', readPage: async () => ({ items: [{ key: 'a' }], next }) });
    assert.equal(result.status, 'failed');
  }
  const mismatch = await enumeratePages({ startUrl: 'https://example.com/1', readPage: async () => ({ items: [], examined: 1, total: 2, expectTotal: true }) });
  assert.equal(mismatch.status, 'failed');
  assert.equal(mismatch.cursor, null);
});

test('date windows retain undated evidence and only stop on a known descending boundary', () => {
  const window = dateWindow([{ at: now }, { at: old }], { ...options, field: 'at', sorted: true });
  assert.equal(window.boundary, true);
  assert.equal(window.items.length, 1);
  assert.equal(dateWindow([{ at: now }, {} , { at: old }], { ...options, field: 'at', sorted: true }).boundary, false);
  assert.equal(dateWindow([{ at: old }, { at: now }], { ...options, field: 'at', sorted: true }).boundary, false);
});

test('Hugging Face discovers all authors, both new and updated streams, and resumes only unfinished streams', async () => {
  const fake = fetchPages([
    response([{ id: 'new-lab/tiny', createdAt: now, lastModified: now, tags: [], pipeline_tag: 'text-generation' }], { link: '<https://example.com/huggingface?cursor=2>; rel="next"' }),
    response([{ id: 'old-lab/model', createdAt: old, lastModified: old }]),
    response([{ id: 'new-lab/tiny', createdAt: now, lastModified: now }]),
  ]);
  const result = await collectHuggingFace({ ...source('huggingface'), tasks: ['text-generation'] }, { ...options, ...fake });
  assert.deepEqual(result.map(stream => stream.status), ['complete', 'complete']);
  assert.equal(result[0].observations[0].publisher, 'new-lab');
  assert.equal(result[0].observations[0].date_kind, 'repository_created');
  assert.equal(result[1].observations[0].date_kind, 'repository_updated');
  const resumed = await collectHuggingFace({ ...source('huggingface'), tasks: ['text-generation'] }, { ...options, resuming: true, resume: { 'text-generation:lastModified': { next_url: 'https://example.com/huggingface?cursor=3' } }, fetcher: async () => response([]) });
  assert.deepEqual(resumed.map(stream => stream.stream_id), ['text-generation:lastModified']);
});

test('Models.dev rejects provider-shaped JSON and uses a validated canonical Git tree fallback', async () => {
  assert.throws(() => parseModelsDev({ data: [{ id: 'lab/model' }] }, 'modelsdev'), /schema/);
  const fake = fetchPages([response({}, {}, 403), response({ sha: 'revision', truncated: false, tree: [{ type: 'blob', path: 'models/new-lab/model.toml', sha: 'blob' }] })]);
  const result = await collectModelsDev({ ...source('modelsdev'), fallback_url: 'https://example.com/tree' }, fake);
  assert.equal(result[0].status, 'complete');
  assert.equal(result[0].attempts[0].reason, 'HTTP 403');
  assert.equal(result[0].observations[0].canonical_id, 'new-lab/model');
  assert.equal(result[0].observations[0].source_date, null);
  const truncated = await collectModelsDev({ ...source('modelsdev'), fallback_url: 'https://example.com/tree' }, { fetcher: async url => url.endsWith('tree') ? response({ truncated: true, tree: [{ type: 'blob', path: 'models/lab/model.toml' }] }) : response({}, {}, 403) });
  assert.equal(truncated[0].status, 'truncated');
});

test('OpenRouter follows provider pagination and counts non-text rows without treating listing dates as releases', async () => {
  const fake = fetchPages([
    response({ data: [{ id: 'lab/model', created: 1793268000 }, { id: 'lab/image', architecture: { output_modalities: ['image'] } }], total_count: 3, links: { next: '/next' } }),
    response({ data: [{ id: 'lab/model2' }], total_count: 3, links: { next: null } }),
  ]);
  const [result] = await collectOpenRouter(source('openrouter'), { ...options, ...fake });
  assert.equal(result.status, 'complete');
  assert.equal(result.observations.length, 2);
  assert.equal(result.items_seen, 3);
  assert.equal(result.observations[0].date_kind, 'provider_listing');
  const [missing] = await collectOpenRouter(source('openrouter'), { ...options, fetcher: async () => response({ data: [], total_count: 2, links: { next: null } }) });
  assert.equal(missing.status, 'failed');
});

test('ModelScope public result cap is explicitly incomplete, not a resumable impossible page', async () => {
  const [result] = await collectModelScope(source('modelscope'), { ...options, resume: { updated: { next_url: 'https://example.com/modelscope?page_number=30&page_size=100' } }, fetcher: async () => response({ success: true, data: { page_number: 30, page_size: 100, total_count: 10000, models: [{ id: 'newlab/model', tasks: ['text-generation'], last_modified: now }] } }) });
  assert.equal(result.status, 'truncated');
  assert.match(result.reason, /3,000/);
  assert.equal(result.cursor, null);
});

test('RSS requires a valid feed and keeps first-party article evidence distinct from a release', () => {
  const [item] = parseFeed('<rss><channel><item><title><![CDATA[New A &amp; B]]></title><link>https://example.com/new</link><pubDate>Thu, 29 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>', 'publisher');
  assert.equal(item.kind, 'article');
  assert.equal(item.name, 'New A & B');
  assert.equal(item.date_kind, 'article_published');
  assert.throws(() => parseFeed('<html>Blocked</html>', 'publisher'), /RSS/);
});

test('Artificial Analysis reports absent credentials without making a request or inventing coverage', async () => {
  const [result] = await collectArtificialAnalysis(source('artificialanalysis'), { env: {}, fetcher: () => { throw new Error('Must not fetch'); } });
  assert.equal(result.status, 'needs_credentials');
});

test('queue deduplicates source identities, preserves provenance and all pending leads across empty windows', () => {
  const observation = modelObservation('huggingface', 'new-lab/model', 'Model', 'https://huggingface.co/new-lab/model', { source_date: now, date_kind: 'repository_created' });
  let queue = mergeCandidates(empty(), [observation, observation, { ...observation, date_kind: 'repository_updated' }], [], now);
  assert.equal(queue.candidates.length, 1);
  assert.equal(queue.candidates[0].sources.length, 2);
  const later = '2026-11-20T00:00:00.000Z';
  queue = mergeCandidates(queue, [], [], later);
  assert.deepEqual(dueCandidates(queue, later), ['huggingface:new-lab/model']);
  assert.equal(queue.candidates[0].first_seen, now);
  assert.equal(queue.candidates[0].last_seen, now);
});

test('exact identities can close a missing-model lead; similar names never merge and dispositions survive', () => {
  const catalog = [{ id: 'lab/model', aliases: [], source_url: 'https://huggingface.co/Lab/Model', sources: [] }];
  const observation = modelObservation('huggingface', 'Lab/Model', 'Model', 'https://huggingface.co/Lab/Model');
  let queue = mergeCandidates(empty(), [observation], catalog, now);
  assert.equal(queue.candidates[0].model_id, 'lab/model');
  assert.equal(queue.candidates[0].status, 'tracked');
  queue = mergeCandidates(queue, [modelObservation('huggingface', 'other/Model', 'Model', 'https://huggingface.co/other/Model')], catalog, now);
  assert.equal(queue.candidates.find(item => item.id === 'huggingface:other/Model').status, 'pending');
  reviewCandidate(queue, 'huggingface:other/Model', { status: 'excluded', reason: 'Image-only model.', reviewed_at: now });
  queue = mergeCandidates(queue, [modelObservation('huggingface', 'other/Model', 'New display name', 'https://huggingface.co/other/Model')], catalog, now);
  assert.equal(queue.candidates.find(item => item.id === 'huggingface:other/Model').status, 'excluded');
});

test('changed tracked sources reopen review and are not immediately closed by their existing catalog match', () => {
  const catalog = [{ id: 'lab/model', aliases: [], sources: [] }];
  const observation = modelObservation('modelsdev', 'lab/model', 'Model', 'https://example.com/model', { canonical_id: 'lab/model', revision: 'one' });
  let queue = mergeCandidates(empty(), [observation], catalog, now);
  queue = mergeCandidates(queue, [{ ...observation, revision: 'two' }, { ...observation, revision: 'two' }], catalog, now);
  assert.equal(queue.candidates[0].status, 'pending');
  assert.equal(queue.candidates[0].model_id, 'lab/model');
});

test('manual review requires a reason and canonical identity; unresolved reviews get a future check', () => {
  const queue = mergeCandidates(empty(), [modelObservation('s', 'a', 'A', 'https://example.com/a')], [], now);
  assert.throws(() => reviewCandidate(queue, 's:a', { status: 'excluded', reviewed_at: now }), /reason/);
  assert.throws(() => reviewCandidate(queue, 's:a', { status: 'duplicate', reason: 'Same model', reviewed_at: now }), /canonical/);
  reviewCandidate(queue, 's:a', { status: 'pending', reason: 'Launch date not established.', reviewed_at: now });
  assert.equal(queue.candidates[0].next_check, '2026-10-30T10:00:00.000Z');
});

test('all old reports seed unresolved leads; later explicit decisions win and an empty report does not erase them', () => {
  const reports = [
    { research_date: '2026-10-01', unresolved_candidates: [{ id: 'lab/model', uncertainty: 'Exact launch date unknown.' }, { candidate: 'Preview', uncertainty: 'Not available yet.' }] },
    { research_date: '2026-10-02', excluded_candidates: [{ candidate: 'Preview', reason: 'Image-only model.' }] },
    { research_date: '2026-10-03', unresolved_candidates: [] },
  ];
  let queue = seedFromReports(empty(), reports, [{ id: 'lab/model', name: 'Model', sources: [] }], now);
  assert.equal(queue.candidates.length, 2);
  assert.equal(queue.candidates.find(item => item.id === 'research:lab/model').status, 'pending');
  assert.equal(queue.candidates.find(item => item.id === 'research:lab/model').model_id, 'lab/model');
  assert.equal(queue.candidates.find(item => item.id === 'research:preview').status, 'excluded');
  reviewCandidate(queue, 'research:lab/model', { status: 'tracked', reason: 'Verified launch date.', model_id: 'lab/model', reviewed_at: now });
  queue = seedFromReports(queue, reports, [], now);
  assert.equal(queue.candidates.find(item => item.id === 'research:lab/model').status, 'tracked');
});

test('Hugging Face registry includes encoder-decoder text generation', async () => {
  const { readFile } = await import('node:fs/promises');
  const registry = JSON.parse(await readFile(new URL('../research/sources.json', import.meta.url), 'utf8'));
  assert.ok(registry.sources.find(item => item.id === 'huggingface').tasks.includes('text2text-generation'));
  for (const task of ['audio-text-to-text', 'video-text-to-text', 'image-to-text', 'visual-question-answering']) assert.ok(registry.sources.find(item => item.id === 'huggingface').tasks.includes(task));
});

test('ModelScope honors the live 50-row maximum and migrates failed old pagination without skipping offsets', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(new URL(url));
    return response({ success: true, data: { page_number: 1, page_size: 50, total_count: 0, models: [] } });
  };
  await collectModelScope(source('modelscope'), { ...options, pageSize: 100, fetcher });
  assert.equal(urls[0].searchParams.get('page_size'), '50');
  await collectModelScope(source('modelscope'), { ...options, pageSize: 100, fetcher, resume: { updated: { next_url: 'https://example.com/modelscope?page_number=3&page_size=100', items_seen: 200 } } });
  assert.equal(urls[1].searchParams.get('page_number'), '5');
  assert.equal(urls[1].searchParams.get('page_size'), '50');
});

test('CSV handles quoted commas, newlines, escaped quotes and rejects truncation', () => {
  assert.deepEqual(parseCsv('\uFEFFname,note\r\nA,"one, two\nthree ""four"""\r\n'), [{ name: 'A', note: 'one, two\nthree "four"' }]);
  for (const text of ['a,b\n1,"oops', 'a,b\n1', 'a,b\n1,"two"tail']) assert.throws(() => parseCsv(text), /CSV/);
});

test('Epoch preserves primary links and lineage/access claims without converting publication to release', async () => {
  const csv = 'Model,Organization,Publication date,Domain,Task,Link,Base model,Model accessibility,Last modified\nCarbon,Google,2026-10-28,"Language,Multimodal",Language modeling,https://google.example/carbon,,Unreleased,2026-10-28\nOld model,Lab,2024-01-01,Language,Language modeling,https://lab.example/old,Other/Base,Open weights,2026-10-28\nImage,Lab,2026-10-28,Vision,Image generation,https://lab.example/image,,Open weights,2026-10-28\n';
  const [result] = await collectEpoch({ ...source('epoch'), documentation: 'https://epoch.ai/data/ai-models' }, { ...options, fetcher: async () => new Response(csv) });
  assert.equal(result.status, 'complete');
  assert.equal(result.items_seen, 3);
  assert.equal(result.observations.length, 3);
  const carbon = result.observations.find(row => row.name === 'Carbon');
  assert.equal(carbon.date_kind, 'catalog_publication');
  assert.equal(carbon.source_metadata.accessibility, 'Unreleased');
  assert.deepEqual(carbon.source_metadata.source_links, ['https://google.example/carbon']);
  assert.equal(result.observations.find(row => row.name === 'Old model').date_kind, 'catalog_updated');
  assert.equal((await collectEpoch(source('epoch'), { ...options, fetcher: async () => new Response('error') }))[0].status, 'failed');
});

test('metadata triage excludes quantization copies while company and unknown-publisher adaptations stay pending', () => {
  const obs = modelObservation('huggingface', 'new-lab/New', 'New', 'https://huggingface.co/new-lab/New', { publisher: 'new-lab', tasks: ['text-generation'], lineage_tags: [] });
  assert.equal(metadataDisposition(obs), null);
  assert.equal(metadataDisposition({ ...obs, name: 'Llama-Quantized', lineage_tags: [] }), null);
  assert.equal(metadataDisposition({ ...obs, lineage_tags: ['base_model:finetune:new-lab/Base'] }), null);
  assert.equal(metadataDisposition({ ...obs, lineage_tags: ['base_model:finetune:Qwen/Base'] }), null);
  assert.equal(metadataDisposition({ ...obs, publisher: 'nvidia', lineage_tags: ['base_model:finetune:meta-llama/Base'] }), null);
  assert.equal(metadataDisposition({ ...obs, lineage_tags: ['base_model:merge:Qwen/Base', 'base_model:merge:google/Base'] }), null);
  assert.equal(metadataDisposition({ ...obs, lineage_tags: ['base_model:quantized:new-lab/Base'] }).status, 'excluded');
  assert.equal(metadataDisposition({ ...obs, tasks: ['image-text-to-text'], lineage_tags: ['base_model:finetune:google/siglip'] }), null);
  const derived = { ...obs, lineage_tags: ['base_model:finetune:Qwen/Base'] };
  let queue = mergeCandidates(empty(), [derived], [], now);
  assert.equal(queue.candidates[0].status, 'pending');
  assert.deepEqual(queue.candidates[0].sources[0].lineage_tags, derived.lineage_tags);
  queue = mergeCandidates(queue, [{ ...obs, lineage_tags: ['base_model:quantized:new-lab/Base'] }], [], now);
  assert.equal(queue.candidates[0].status, 'excluded');
  queue = mergeCandidates(queue, [obs], [], now);
  assert.equal(queue.candidates[0].status, 'pending');
  reviewCandidate(queue, obs.source_id + ':' + obs.key, { status: 'excluded', reason: 'Primary source confirms a community derivative.', reviewed_at: now });
  queue = mergeCandidates(queue, [derived], [], now);
  assert.equal(queue.candidates[0].status, 'excluded');
  assert.equal(queue.candidates[0].reason, 'Primary source confirms a community derivative.');
});

test('scope change reopens old automatic derivative exclusions without fresh observations and preserves quantization and manual decisions', () => {
  const item = (id, relation, automatic = true) => ({
    id, name: id, status: 'excluded', reason: 'Previous scope decision.',
    last_reviewed: old, next_check: null,
    ...(automatic ? { review_method: 'publisher_metadata' } : {}),
    sources: [{ source_id: 'huggingface', key: id, url: `https://huggingface.co/${id}`, lineage_tags: [`base_model:${relation}:other/Base`] }],
  });
  const queue = { ...empty(), candidates: [item('company/Tuned', 'finetune'), item('unknown/Merged', 'merge'), item('quantizer/Q4', 'quantized'), item('community/Tuned', 'finetune', false)] };
  const result = mergeCandidates(queue, [], [], now);
  for (const id of ['company/Tuned', 'unknown/Merged']) {
    const entry = result.candidates.find(row => row.id === id);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.next_check, now);
    assert.match(entry.reason, /Verify the publisher/);
    assert.equal(entry.review_method, undefined);
    assert.deepEqual(entry.sources, queue.candidates.find(row => row.id === id).sources);
  }
  assert.equal(result.candidates.find(row => row.id === 'quantizer/Q4').status, 'excluded');
  assert.equal(result.candidates.find(row => row.id === 'community/Tuned').status, 'excluded');
  assert.equal(queue.candidates[0].status, 'excluded');
  assert.deepEqual(mergeCandidates(result, [], [], now), result);
});

test('Epoch retains a nameless source row under its reference title and reports the source defect', async () => {
  const csv = 'Model,Organization,Publication date,Domain,Task,Link,Reference\n,Lab,2026-10-28,Language,Language modeling,https://lab.example/model,Developer announcement\n';
  const [result] = await collectEpoch({ ...source('epoch'), documentation: 'https://epoch.ai/data/ai-models' }, { ...options, fetcher: async () => new Response(csv) });
  assert.equal(result.status, 'complete');
  assert.equal(result.issues.length, 1);
  assert.equal(result.observations[0].name, 'Developer announcement');
  assert.equal(result.observations[0].source_metadata.model_name, null);
  const queue = mergeCandidates(empty(), result.observations, [], now);
  assert.equal(queue.candidates[0].sources[0].metadata.model_name, null);
});
