import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, SOURCE_URL, catalogTimestamps, csv, mergeCatalog, statistics } from './data-lib.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

function publicCandidates(queue) {
  return {
    ...pick(queue, ['schema_version', 'updated_at']),
    candidates: (queue.candidates || []).map(candidate => ({
      ...pick(candidate, ['id', 'name', 'kind', 'publisher', 'model_id', 'status', 'reason', 'first_seen', 'last_seen', 'last_reviewed', 'next_check']),
      sources: (candidate.sources || []).filter(source => /^https:\/\//.test(source.url || '')).map(source => pick(source, ['source_id', 'key', 'url', 'first_seen', 'last_seen', 'source_date', 'date_kind', 'revision'])),
    })),
  };
}

function publicCoverage(coverage) {
  return {
    ...pick(coverage, ['schema_version', 'updated_at', 'window', 'definition', 'limitations']),
    months: (coverage.months || []).map(month => pick(month, ['month', 'status', 'primary_sources_checked', 'outstanding_candidates', 'last_reviewed'])),
  };
}

export async function buildData({ root = ROOT } = {}) {
  const read = async (name, fallback) => {
    try { return JSON.parse(await fs.readFile(path.join(root, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
  };
  const writeJSON = async (name, content) => {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(content, null, 2)}\n`);
  };
  const raw = await fs.readFile(path.join(root, 'data/source/models.dev.json'), 'utf8');
  const metadata = await read('data/source/metadata.json');
  const upstream = JSON.parse(raw);
  const historical = await read('data/historical.json', []);
  const corrections = await read('data/corrections.json', {});
  const previous = await read('data/catalog.json', []);
  const research = await read('data/research-metadata.json', null);
  if (research !== null && (!research || typeof research !== 'object' || typeof research.reviewed_at !== 'string')) throw new Error('Research metadata requires reviewed_at');
  const timestamps = catalogTimestamps(metadata.retrieved_at, research?.reviewed_at ?? null);
  const asOf = metadata.retrieved_at.slice(0, 10);
  const { models, coverage } = mergeCatalog({ upstream, previous, historical, corrections, retrievedAt: metadata.retrieved_at, asOf, reviewedAt: timestamps.review });
  const envelope = {
    schema_version: SCHEMA_VERSION,
    updated_at: research === null ? metadata.retrieved_at : timestamps.updated,
    source: { name: 'Models.dev', url: SOURCE_URL, retrieved_at: metadata.retrieved_at, license: 'MIT' },
    coverage,
  };
  if (research !== null) envelope.research = { reviewed_at: timestamps.review };
  await writeJSON('data/catalog.json', models);
  const api = path.join(root, 'public/api/v1');
  await fs.rm(api, { recursive: true, force: true });
  await writeJSON('public/api/v1/models.json', { ...envelope, models });
  const stats = statistics(models);
  await writeJSON('public/api/v1/stats.json', { ...envelope, ...stats });
  await writeJSON('public/api/v1/candidates.json', publicCandidates(await read('data/candidates.json', { schema_version: '1.0', candidates: [] })));
  await writeJSON('public/api/v1/coverage.json', publicCoverage(await read('research/backfill/coverage.json', { schema_version: '1.0', months: [] })));
  for (const model of models) await writeJSON(`public/api/v1/models/${model.slug}.json`, { schema_version: SCHEMA_VERSION, updated_at: envelope.updated_at, model });
  const months = stats.by_month.map(bucket => ({ month: bucket.month, count: bucket.total, path: `months/${bucket.month}.json` }));
  for (const month of months) await writeJSON(`public/api/v1/${month.path}`, { ...envelope, month: month.month, count: month.count, models: models.filter(model => (model.release_date?.slice(0, 7) || 'unknown') === month.month) });
  const developers = stats.by_developer.map(developer => ({ ...developer, path: `developers/${developer.id}.json` }));
  for (const developer of developers) await writeJSON(`public/api/v1/${developer.path}`, { ...envelope, developer: { id: developer.id, name: developer.name }, count: developer.count, models: models.filter(model => model.developer_id === developer.id) });
  await writeJSON('public/api/v1/index.json', {
    ...envelope,
    endpoints: { models: 'models.json', stats: 'stats.json', candidates: 'candidates.json', coverage: 'coverage.json', csv: 'models.csv', schema: '../../api-schema.json', openapi: '../../openapi.json' },
    months, developers,
    models: models.map(model => ({ id: model.id, path: `models/${model.slug}.json` })),
  });
  await fs.writeFile(path.join(api, 'models.csv'), csv(models));
  console.log(`Built ${models.length} models, ${stats.recorded_releases} recorded releases, ${stats.developers} developers, ${months.length} months (${coverage.merged_aliases} aliases merged).`);
  return { envelope, models, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildData();
