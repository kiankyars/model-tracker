import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, SOURCE_URL, csv, mergeCatalog, sha256, statistics } from './data-lib.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (name, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
};
const writeJSON = async (name, content) => {
  const target = path.join(ROOT, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(content, null, 2)}\n`);
};

export async function buildData() {
  const raw = await fs.readFile(path.join(ROOT, 'data/source/models.dev.json'), 'utf8');
  const metadata = await read('data/source/metadata.json');
  if (sha256(raw) !== metadata.sha256) throw new Error('Source snapshot SHA256 mismatch');
  const upstream = JSON.parse(raw);
  const historical = await read('data/historical.json', []);
  const corrections = await read('data/corrections.json', {});
  const previous = await read('data/catalog.json', []);
  const asOf = metadata.retrieved_at.slice(0, 10);
  const { models, coverage } = mergeCatalog({ upstream, previous, historical, corrections, retrievedAt: metadata.retrieved_at, asOf });
  const envelope = {
    schema_version: SCHEMA_VERSION,
    updated_at: metadata.retrieved_at,
    source: { name: 'Models.dev', url: SOURCE_URL, retrieved_at: metadata.retrieved_at, sha256: metadata.sha256, license: 'MIT' },
    coverage,
  };
  await writeJSON('data/catalog.json', models);
  const api = path.join(ROOT, 'public/api/v1');
  await fs.rm(api, { recursive: true, force: true });
  await writeJSON('public/api/v1/models.json', { ...envelope, models });
  const stats = statistics(models);
  await writeJSON('public/api/v1/stats.json', { ...envelope, ...stats });
  for (const model of models) await writeJSON(`public/api/v1/models/${model.slug}.json`, { schema_version: SCHEMA_VERSION, updated_at: metadata.retrieved_at, model });
  const months = stats.by_month.map(bucket => ({ month: bucket.month, count: bucket.total, path: `months/${bucket.month}.json` }));
  for (const month of months) await writeJSON(`public/api/v1/${month.path}`, { ...envelope, month: month.month, count: month.count, models: models.filter(model => (model.release_date?.slice(0, 7) || 'unknown') === month.month) });
  const developers = stats.by_developer.map(developer => ({ ...developer, path: `developers/${developer.id}.json` }));
  for (const developer of developers) await writeJSON(`public/api/v1/${developer.path}`, { ...envelope, developer: { id: developer.id, name: developer.name }, count: developer.count, models: models.filter(model => model.developer_id === developer.id) });
  await writeJSON('public/api/v1/index.json', {
    ...envelope,
    endpoints: { models: 'models.json', stats: 'stats.json', csv: 'models.csv', schema: '../../api-schema.json', openapi: '../../openapi.json' },
    months, developers,
    models: models.map(model => ({ id: model.id, path: `models/${model.slug}.json` })),
  });
  await fs.writeFile(path.join(api, 'models.csv'), csv(models));
  console.log(`Built ${models.length} language-model releases, ${stats.developers} developers, ${months.length} months (${coverage.merged_aliases} aliases merged).`);
  return { envelope, models, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildData();
