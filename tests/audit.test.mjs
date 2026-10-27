import test from 'node:test';
import assert from 'node:assert/strict';
import { auditFields, validateReport, applyAcceptedReports } from '../scripts/model-audit.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateModels, normalize, csv } from '../scripts/data-lib.mjs';
import { modelSizeLabel, activeSizeLabel, missingLabel } from '../lib/parameter-labels.js';
import { toCSV, filterModels, sortModels } from '../lib/model-data.js';
import { sizePoints } from '../lib/chart-data.js';

test('an audit report cannot substitute another model or unsupported claims', () => {
  const entry = { index: 1, id: 'lab/model', task_name: 'audit_001', agent: '/root/audit_001' };
  const report = { index: 1, model_id: entry.id, reviewed_at: '2026-10-26T14:00:00Z', sources: [{ id: 's1', url: 'https://example.org/model', title: 'Official model card', accessed: true, evidence: 'Technical information is not disclosed.' }], fields: Object.fromEntries(auditFields.map(field => [field, { value: null, status: 'undisclosed', source_ids: ['s1'], note: 'Not disclosed by the developer.' }])), patch: {}, summary: 'Reviewed.' };
  assert.equal(validateReport(report, entry), report);
  assert.equal(validateReport({ ...report, patch: { remove_source_urls: ['https://example.org/wrong-model'] } }, entry).index, 1);
  assert.throws(() => validateReport({ ...report, patch: { remove_source_urls: 'https://example.org/wrong-model' } }, entry), /source removals/);
  assert.throws(() => validateReport({ ...report, model_id: 'lab/other' }, entry), /identity/);
  assert.throws(() => validateReport(report, { ...entry, agent: null }), /dedicated agent/);
  const unsupported = structuredClone(report);
  unsupported.fields.parameters_b.status = 'verified';
  assert.throws(() => validateReport(unsupported, entry), /requires a value/);
  const mismatch = structuredClone(report);
  mismatch.patch.parameters_b = 42;
  assert.throws(() => validateReport(mismatch, entry), /disagrees/);
  const excluded = structuredClone(report);
  excluded.proposed_fields = { catalog_exclusion: { category: 'service_tier', reason: 'Documented processing option', related_model_id: 'lab/base', source_url: report.sources[0].url } };
  assert.equal(validateReport(excluded, entry), excluded);
  excluded.proposed_fields.catalog_exclusion.source_url = 'https://example.org/unread';
  assert.throws(() => validateReport(excluded, entry), /exclusion/);
});

test('phase-dependent counts retain their scope in validation, display and both CSV exports', () => {
  const model = { ...normalize('lab/model', { name: 'Test', modalities: { input: ['text'], output: ['text'] } }, '2026-10-26T14:00:00Z'), parameters_b: 552, active_parameters_b: 16, parameters_scope: 'backbone', active_parameters_scope: 'decode', parameter_components_b: { backbone: 552, engram: 196 }, active_parameters_by_phase_b: { prefill: 8, decode: 16 } };
  validateModels([model]);
  assert.equal(modelSizeLabel(model), '552B backbone');
  assert.equal(activeSizeLabel(model), '8B prefill / 16B decode');
  assert.throws(() => validateModels([{ ...model, active_parameters_b: 8 }]), /phase count/);
  assert.throws(() => validateModels([{ ...model, parameters_b: 748 }]), /component count/);
  for (const output of [csv([model]), toCSV([model])]) {
    assert.match(output, /active_parameters_by_phase_b/);
    assert.match(output, /""prefill"":8/);
    assert.match(output, /"backbone"/);
  }
  assert.equal(missingLabel({ field_status: { parameters_b: 'undisclosed' } }, 'parameters_b'), 'Not disclosed');
  assert.equal(activeSizeLabel({ field_status: { active_parameters_b: 'not_applicable' } }), 'Not separately reported');
  const multimodal = { ...model, active_parameters_b: 3, active_parameters_scope: 'thinker_decoder', active_parameters_by_phase_b: undefined };
  validateModels([multimodal]);
  assert.equal(activeSizeLabel(multimodal), '3B thinker decoder');
  const hosted = { ...multimodal, parameters_b: 35, parameters_scope: 'language_decoder', parameter_components_b: { language_decoder: 35 }, active_parameters_scope: 'language_decoder' };
  validateModels([hosted]);
  assert.equal(modelSizeLabel(hosted), '35B language decoder');
  assert.throws(() => validateModels([{ ...multimodal, active_parameters_b: null }]), /active parameter scope/);
});

test('a reopened model retains its published correction until its fresh review is accepted', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'parameter-reaudit-'));
  try {
    const directory = path.join(projectRoot, 'audit');
    await fs.mkdir(path.join(directory, 'reports'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'data'));
    const write = (file, data) => fs.writeFile(file, JSON.stringify(data));
    const models = [1, 2].map(index => ({ index, id: `lab/model-${index}`, task_name: `audit_00${index}`, agent: `/root/audit_00${index}`, state: 'accepted', review: { note: 'Original review accepted.' }, parameter_reaudit: { state: index === 1 ? 'running' : 'accepted' } }));
    await write(path.join(directory, 'manifest.json'), { models, parameter_reaudit: { model_indices: [1, 2] } });
    for (const entry of models) {
      const report = { index: entry.index, model_id: entry.id, reviewed_at: '2026-10-27T07:00:00Z', sources: [{ id: 's1', url: 'https://example.org/model', title: 'Model card', accessed: true, evidence: 'Published nominal count.' }], fields: Object.fromEntries(auditFields.map(field => [field, { value: field === 'parameters_b' ? entry.index * 10 : null, status: field === 'parameters_b' ? 'verified' : 'undisclosed', source_ids: ['s1'], note: 'Reviewed.' }])), patch: { parameters_b: entry.index * 10 }, summary: 'Fresh parameter evidence.' };
      await write(path.join(directory, 'reports', `00${entry.index}.json`), report);
    }
    await write(path.join(projectRoot, 'data/corrections.json'), { overrides: { 'lab/model-1': { parameters_b: 1 }, 'lab/model-2': { parameters_b: 2 } } });
    assert.equal(await applyAcceptedReports(directory, { projectRoot }), 1);
    const corrections = JSON.parse(await fs.readFile(path.join(projectRoot, 'data/corrections.json'), 'utf8'));
    assert.deepEqual(corrections.overrides['lab/model-1'], { parameters_b: 1 });
    assert.equal(corrections.overrides['lab/model-2'].parameters_b, 20);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('published lower bounds remain distinct from point counts across display, filters and exports', () => {
  const model = { ...normalize('lab/bounded', { name: 'Bounded', modalities: { input: ['text'], output: ['text'] } }, '2026-10-27T09:00:00Z'), release_date: '2026-01-01', date_precision: 'day', parameters_lower_bound_b: 1000, parameters_lower_bound_exclusive: true };
  validateModels([model]);
  assert.equal(model.parameters_b, null);
  assert.equal(modelSizeLabel(model), '>1,000B');
  assert.equal(missingLabel(model, 'parameters_b'), '>1,000B');
  assert.equal(modelSizeLabel({ ...model, parameters_lower_bound_exclusive: false }), '≥1,000B');
  assert.equal(filterModels([model], { size: '100plus' }).length, 1);
  for (const size of ['unknown', 'under3', '3to10', '10to30', '30to100']) assert.equal(filterModels([model], { size }).length, 0);
  assert.equal(sizePoints([model]).length, 0);
  assert.equal(sortModels([{ ...model, id: 'lab/unknown', parameters_lower_bound_b: undefined }, model], 'size')[0].id, model.id);
  assert.throws(() => validateModels([{ ...model, parameters_b: 1000 }]), /lower bound/);
  assert.throws(() => validateModels([{ ...model, parameters_lower_bound_b: -1 }]), /lower bound/);
  assert.throws(() => validateModels([{ ...model, parameters_lower_bound_b: undefined }]), /lower bound/);
  for (const output of [csv([model]), toCSV([model])]) assert.match(output.split('\r\n')[0].replaceAll('"', ''), /parameters_lower_bound_b,parameters_lower_bound_exclusive/);
});
