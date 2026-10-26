import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, buildData } from './build-data.mjs';
import { SOURCE_URL, eligibleModel, normalize, sha256 } from './data-lib.mjs';

const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'ModelTracker/1.0 (+https://github.com/kiankyars/model-tracker)' } });
if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
const upstream = await response.json();
if (!upstream || Array.isArray(upstream) || typeof upstream !== 'object' || Object.keys(upstream).length < 100) throw new Error('Unexpected or incomplete source catalog');
let previousCount = 0;
try { previousCount = Object.keys(JSON.parse(await fs.readFile(path.join(ROOT, 'data/source/models.dev.json'), 'utf8'))).length; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (Object.keys(upstream).length < previousCount * 0.8) throw new Error('Source shrank more than 20%; manual review required before refresh');
const retrievedAt = new Date().toISOString();
if (Object.values(upstream).filter(eligibleModel).length < 100) throw new Error('Too few language models; upstream schema may have changed');
for (const [id, model] of Object.entries(upstream)) {
  if (model.id !== id || typeof model.name !== 'string') throw new Error(`Source identity mismatch: ${id}`);
  if (!Array.isArray(model.modalities?.input) || !Array.isArray(model.modalities?.output)) throw new Error(`Missing source modalities: ${id}`);
  if (eligibleModel(model)) normalize(id, model, retrievedAt);
}
const raw = `${JSON.stringify(Object.fromEntries(Object.entries(upstream).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
await fs.mkdir(path.join(ROOT, 'data/source'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'data/source/models.dev.json'), raw);
await fs.writeFile(path.join(ROOT, 'data/source/metadata.json'), `${JSON.stringify({ url: SOURCE_URL, retrieved_at: retrievedAt, sha256: sha256(raw), records: Object.keys(upstream).length }, null, 2)}\n`);
await buildData();
