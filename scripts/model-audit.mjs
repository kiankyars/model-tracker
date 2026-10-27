import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';

export const auditFields = ['name', 'developer', 'family', 'release_date', 'open_weights', 'license', 'parameters_b', 'active_parameters_b', 'architecture', 'context_window', 'modalities', 'reasoning', 'tool_call', 'description'];
const statuses = new Set(['verified', 'undisclosed', 'unverified', 'not_applicable']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const auditDirectory = path.join(root, 'research/model-audit/2026-10-26');
const read = async name => JSON.parse(await fs.readFile(name, 'utf8'));
const readBaseline = manifest => JSON.parse(execFileSync('git', ['show', `${manifest.baseline_ref}:data/catalog.json`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));

export function validateReport(report, entry) {
  const fail = message => { throw new Error(`${entry.id}: ${message}`); };
  if (report.index !== entry.index || report.model_id !== entry.id) fail('report identity does not match assignment');
  if (!entry.agent || entry.agent !== `/root/${entry.task_name}`) fail('no recorded dedicated agent');
  if (!Number.isFinite(Date.parse(report.reviewed_at))) fail('invalid review timestamp');
  if (!Array.isArray(report.sources) || !report.sources.length) fail('sources missing');
  const sources = new Map();
  for (const source of report.sources) {
    if (!source.id || sources.has(source.id) || !/^https:\/\//.test(source.url) || !source.title || typeof source.accessed !== 'boolean') fail('invalid source');
    if (source.accessed && !source.evidence) fail(`source ${source.id} has no evidence summary`);
    sources.set(source.id, source);
  }
  for (const field of auditFields) {
    const assessment = report.fields?.[field];
    if (!assessment || !Object.hasOwn(assessment, 'value') || !statuses.has(assessment.status) || !assessment.note || !Array.isArray(assessment.source_ids)) fail(`incomplete ${field} assessment`);
    if (assessment.source_ids.some(id => !sources.has(id))) fail(`unknown source for ${field}`);
    if (assessment.status === 'verified' && (assessment.value === null || !assessment.source_ids.some(id => sources.get(id).accessed))) fail(`verified ${field} requires a value and accessed evidence`);
    if (assessment.status !== 'verified' && assessment.value !== null) fail(`${field} must remain null when not verified`);
  }
  if (!report.patch || Array.isArray(report.patch) || typeof report.patch !== 'object') fail('patch missing');
  const extras = new Set(['parameters_source', 'date_precision', 'source_url', 'source_type', 'sources', 'remove_source_urls', 'notes']);
  if (report.patch.remove_source_urls !== undefined && (!Array.isArray(report.patch.remove_source_urls) || report.patch.remove_source_urls.some(url => typeof url !== 'string' || !url.startsWith('https://')))) fail('invalid source removals');
  for (const [field, value] of Object.entries(report.patch)) {
    if (!auditFields.includes(field) && !extras.has(field)) fail(`unexpected patch field ${field}`);
    if (auditFields.includes(field) && !isDeepStrictEqual(value, report.fields[field].value)) fail(`patch disagrees with ${field} assessment`);
  }
  const exclusion = report.proposed_fields?.catalog_exclusion;
  if (exclusion && (exclusion.category !== 'service_tier' || !exclusion.reason || !exclusion.related_model_id || exclusion.related_model_id === entry.id || !report.sources.some(source => source.accessed && source.url === exclusion.source_url))) fail('catalog exclusion requires a service-tier relationship and accessed source');
  if (Object.hasOwn(report.patch, 'release_date') && report.patch.release_date !== null && Object.hasOwn(report.patch, 'date_precision') && report.patch.date_precision !== (report.patch.release_date.length === 7 ? 'month' : 'day')) fail('corrected date needs matching precision');
  if (!report.summary) fail('summary missing');
  return report;
}

export async function auditStatus(directory = auditDirectory) {
  const manifest = await read(path.join(directory, 'manifest.json'));
  const baseline = readBaseline(manifest);
  if (manifest.models.length !== manifest.model_count || baseline.length !== manifest.model_count) throw new Error('Frozen audit scope changed');
  if (new Set(manifest.models.map(entry => entry.id)).size !== manifest.model_count || new Set(manifest.models.map(entry => entry.task_name)).size !== manifest.model_count) throw new Error('Assignments must be distinct');
  const baselineIds = new Set(baseline.map(model => model.id));
  if (manifest.models.some(entry => !baselineIds.has(entry.id))) throw new Error('Assignment missing from baseline');
  const reports = [], errors = [];
  for (const entry of manifest.models) {
    try {
      const report = await read(path.join(directory, 'reports', `${String(entry.index).padStart(3, '0')}.json`));
      reports.push(validateReport(report, entry));
    } catch (error) { if (error.code !== 'ENOENT') errors.push(error.message); }
  }
  return {
    scope: manifest.model_count,
    spawned: manifest.models.filter(entry => entry.agent).length,
    reports: reports.length,
    accepted: manifest.models.filter(entry => entry.state === 'accepted').length,
    unresolved_fields: reports.reduce((sum, report) => sum + Object.values(report.fields).filter(field => field.status === 'unverified').length, 0),
    pending: manifest.models.filter(entry => !entry.agent).map(entry => ({ index: entry.index, id: entry.id, task_name: entry.task_name })),
    errors,
  };
}

export async function applyAcceptedReports(directory = auditDirectory) {
  const manifest = await read(path.join(directory, 'manifest.json'));
  const correctionsPath = path.join(root, 'data/corrections.json');
  const corrections = await read(correctionsPath);
  const accepted = manifest.models.filter(entry => entry.state === 'accepted');
  const extendedFields = ['parameters_scope', 'active_parameters_scope', 'parameter_components_b', 'active_parameters_by_phase_b'];
  let reviewedAt = '';
  for (const entry of accepted) {
    const report = validateReport(await read(path.join(directory, 'reports', `${String(entry.index).padStart(3, '0')}.json`)), entry);
    if (!entry.review.note) throw new Error(`${entry.id}: parent review is missing`);
    if (entry.review.accepted_proposed_fields?.includes('catalog_exclusion')) {
      const exclusion = report.proposed_fields?.catalog_exclusion;
      if (!exclusion || entry.review.accepted_proposed_fields.length !== 1) throw new Error(`${entry.id}: invalid exclusion approval`);
      corrections.exclude ||= {};
      corrections.exclude[entry.id] = { ...exclusion, audit_url: `https://github.com/kiankyars/model-tracker/blob/main/research/model-audit/2026-10-26/reports/${String(entry.index).padStart(3, '0')}.json` };
      delete corrections.overrides[entry.id];
      if (report.reviewed_at > reviewedAt) reviewedAt = report.reviewed_at;
      continue;
    }
    const old = corrections.overrides[entry.id] || {};
    const patch = { ...old, ...report.patch };
    for (const key of entry.review.accepted_proposed_fields || []) {
      if (!extendedFields.includes(key) || !Object.hasOwn(report.proposed_fields || {}, key)) throw new Error(`${entry.id}: unsupported extended field ${key}`);
      patch[key] = report.proposed_fields[key];
    }
    if (Object.hasOwn(patch, 'release_date')) patch.date_precision = patch.release_date ? (patch.release_date.length === 7 ? 'month' : 'day') : null;
    patch.sources = [...new Map([...(report.patch.sources || []), ...(old.sources || [])].map(source => [source.url, source])).values()];
    patch.field_status = Object.fromEntries(Object.entries(report.fields).filter(([, assessment]) => assessment.status !== 'verified').map(([field, assessment]) => [field, assessment.status]));
    patch.audited_at = report.reviewed_at;
    patch.audit_url = `https://github.com/kiankyars/model-tracker/blob/main/research/model-audit/2026-10-26/reports/${String(entry.index).padStart(3, '0')}.json`;
    corrections.overrides[entry.id] = patch;
    if (report.reviewed_at > reviewedAt) reviewedAt = report.reviewed_at;
  }
  if (!accepted.length) throw new Error('No reviewed reports to apply');
  await fs.writeFile(correctionsPath, `${JSON.stringify(corrections, null, 2)}\n`);
  const metadataPath = path.join(root, 'data/research-metadata.json');
  let previous = {};
  try { previous = await read(metadataPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!previous.reviewed_at || Date.parse(reviewedAt) > Date.parse(previous.reviewed_at)) previous.reviewed_at = new Date(reviewedAt).toISOString();
  await fs.writeFile(metadataPath, `${JSON.stringify(previous, null, 2)}\n`);
  return accepted.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--record')) {
    const index = Number(process.argv[process.argv.indexOf('--record') + 1]);
    const manifest = await read(path.join(auditDirectory, 'manifest.json'));
    const entry = manifest.models.find(model => model.index === index);
    if (!entry) throw new Error('Specify a model index from the manifest');
    console.log(JSON.stringify(readBaseline(manifest).find(model => model.id === entry.id), null, 2));
  } else {
    if (process.argv.includes('--apply')) console.log(`Applied ${await applyAcceptedReports()} accepted individual model reports.`);
    const status = await auditStatus();
    console.log(JSON.stringify({ ...status, pending: status.pending.slice(0, 12) }, null, 2));
    if (status.errors.length || process.argv.includes('--complete') && (status.scope !== status.spawned || status.scope !== status.reports || status.scope !== status.accepted)) process.exitCode = 1;
  }
}
