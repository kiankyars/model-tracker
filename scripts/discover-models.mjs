import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSource, dueCandidates, isoDate, mergeCandidates, reviewCandidate, seedFromReports } from './discovery-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (['--dry-run', '--help'].includes(key)) flags[key.slice(2)] = true;
  else if (['--since', '--through', '--sources', '--max-pages', '--page-size', '--resume', '--report', '--review', '--status', '--reason', '--model', '--next-check'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) flags[key.slice(2)] = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${key}`);
}
if (flags.help) {
  console.log(`Usage: node scripts/discover-models.mjs [--since YYYY-MM-DD] [--through YYYY-MM-DD]
  --sources modelsdev,openrouter,huggingface,modelscope,google-feed
  --max-pages 20       Pages per stream; 0 means unlimited. Incomplete streams retain cursors.
  --page-size 100      Rows per page (1–100); ModelScope is capped at its API maximum of 50.
  --resume REPORT     Continue incomplete streams in a saved report and its original window.
  --report PATH       Save a report at this path instead of research/discovery/<timestamp>.json.
  --dry-run           Fetch and report without writing the candidate queue or report.

Review a candidate after checking primary sources:
  --review ID --status pending|tracked|duplicate|excluded --reason TEXT
  [--model CANONICAL_ID] [--next-check YYYY-MM-DD]

Discovery never changes or publishes the model catalog. Repository, provider and article
 timestamps remain discovery evidence; they are not accepted model release dates.`);
  process.exit(0);
}

const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const now = new Date().toISOString();
let queue;
try { queue = await readJson('data/candidates.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; queue = { schema_version: '1.0', updated_at: now, candidates: [] }; }
const catalog = await readJson('data/catalog.json');

if (flags.review) {
  if (!flags.status || !flags.reason) throw new Error('--review requires --status and --reason');
  if (flags.model && !catalog.some(model => model.id === flags.model)) throw new Error('--model must be a published catalog ID');
  reviewCandidate(queue, flags.review, { status: flags.status, reason: flags.reason, model_id: flags.model, next_check: flags['next-check'], reviewed_at: now });
  if (!flags['dry-run']) await writeJson('data/candidates.json', queue);
  console.log(JSON.stringify(queue.candidates.find(item => item.id === flags.review), null, 2));
  process.exit(0);
}
if (flags.status || flags.reason || flags.model || flags['next-check']) throw new Error('Review flags require --review');
const registry = await readJson('research/sources.json');
const previous = flags.resume ? await readJson(flags.resume) : null;
if (previous && (!previous.window || !Array.isArray(previous.sources))) throw new Error('Invalid resume report');
if (previous && (flags.since || flags.through)) throw new Error('--resume preserves the original window; omit --since and --through');
const since = previous?.window.since || isoDate(flags.since || new Date(new Date(now).valueOf() - 14 * 86_400_000).toISOString());
const through = previous?.window.through || isoDate(flags.through ? (flags.through.length === 10 ? `${flags.through}T23:59:59.999Z` : flags.through) : now);
if (!since || !through || since > through) throw new Error('Invalid date window');
const maxPages = Number(flags['max-pages'] ?? 20);
const pageSize = Number(flags['page-size'] ?? 100);
if (!Number.isInteger(maxPages) || maxPages < 0) throw new Error('--max-pages must be a nonnegative integer');
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('--page-size must be between 1 and 100');
const selected = flags.sources?.split(',');
if (selected?.some(id => !registry.sources.some(source => source.id === id))) throw new Error('Unknown source ID');
const sourceResults = [];
const observations = [];
for (const source of registry.sources.filter(source => !selected || selected.includes(source.id))) {
  const prior = previous?.sources.find(item => item.source_id === source.id);
  const resume = Object.fromEntries((prior?.streams || []).filter(stream => stream.cursor).map(stream => [stream.stream_id, stream.cursor]));
  if (previous && !Object.keys(resume).length) continue;
  console.log(`Checking ${source.id}…`);
  const streams = await collectSource(source, { since, through, maxPages, pageSize, resume, resuming: Boolean(previous), env: process.env });
  for (const stream of streams) observations.push(...stream.observations);
  sourceResults.push({
    source_id: source.id, name: source.name, url: source.url,
    streams: streams.map(({ observations: items, ...stream }) => ({ ...stream, candidate_count: items.length })),
  });
}

const datedReports = (await readdir(resolve(root, 'research'))).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
const manualReports = await Promise.all(datedReports.map(name => readJson(`research/${name}`)));
queue = seedFromReports(queue, manualReports, catalog, now);
const beforeIds = new Set(queue.candidates.map(item => item.id));
queue = mergeCandidates(queue, observations, catalog, now, await readJson('data/corrections.json'));
const due = dueCandidates(queue, now);
const byStatus = Object.fromEntries(['pending', 'tracked', 'duplicate', 'excluded'].map(status => [status, queue.candidates.filter(item => item.status === status).length]));
const report = {
  schema_version: '1.0', started_at: now, completed_at: new Date().toISOString(),
  purpose: 'Candidate enumeration only. Complete means the requested source stream/window was exhausted, not that every model release was found.',
  window: { since, through }, budget: { max_pages_per_stream: maxPages, page_size: pageSize },
  ...(flags.resume ? { resumed_from: flags.resume } : {}),
  sources: sourceResults,
  manual_checks: registry.publisher_sentinels.map(item => ({ ...item, status: 'not_checked_by_collector' })),
  candidates: { observed: observations.length, added: queue.candidates.filter(item => !beforeIds.has(item.id)).length, total: queue.candidates.length, by_status: byStatus, due_for_review: due },
  gaps: [
    'A successful API response covers only that source, not all releases. Deleted/private entries, incorrect tags and unannounced models can be missed.',
    'Historical repository updates are not historical release dates; combine inventory/history with dated primary announcements.',
    'Manual sentinels, credential requirements, failures and incomplete pagination require follow-up.',
  ],
};
const reportPath = flags.report || `research/discovery/${now.replace(/[:.]/g, '-')}.json`;
if (!flags['dry-run']) {
  await writeJson('data/candidates.json', queue);
  await writeJson(reportPath, report);
}
console.log(JSON.stringify({ report: flags['dry-run'] ? null : reportPath, candidates: report.candidates.by_status, due_for_review: due.length, sources: sourceResults.map(source => ({ id: source.source_id, streams: source.streams.map(stream => ({ id: stream.stream_id, status: stream.status, count: stream.candidate_count, reason: stream.reason })) })) }, null, 2));

async function writeJson(path, value) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}
