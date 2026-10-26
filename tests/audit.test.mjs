import test from 'node:test';
import assert from 'node:assert/strict';
import { auditFields, validateReport } from '../scripts/model-audit.mjs';
import { validateModels, normalize, csv } from '../scripts/data-lib.mjs';
import { modelSizeLabel, activeSizeLabel, missingLabel } from '../lib/parameter-labels.js';
import { toCSV } from '../lib/model-data.js';

test('an audit report cannot substitute another model or unsupported claims', () => {
  const entry = { index: 1, id: 'lab/model', task_name: 'audit_001', agent: '/root/audit_001' };
  const report = { index: 1, model_id: entry.id, reviewed_at: '2026-10-26T14:00:00Z', sources: [{ id: 's1', url: 'https://example.org/model', title: 'Official model card', accessed: true, evidence: 'Technical information is not disclosed.' }], fields: Object.fromEntries(auditFields.map(field => [field, { value: null, status: 'undisclosed', source_ids: ['s1'], note: 'Not disclosed by the developer.' }])), patch: {}, summary: 'Reviewed.' };
  assert.equal(validateReport(report, entry), report);
  assert.throws(() => validateReport({ ...report, model_id: 'lab/other' }, entry), /identity/);
  assert.throws(() => validateReport(report, { ...entry, agent: null }), /dedicated agent/);
  const unsupported = structuredClone(report);
  unsupported.fields.parameters_b.status = 'verified';
  assert.throws(() => validateReport(unsupported, entry), /requires a value/);
  const mismatch = structuredClone(report);
  mismatch.patch.parameters_b = 42;
  assert.throws(() => validateReport(mismatch, entry), /disagrees/);
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
  assert.throws(() => validateModels([{ ...multimodal, active_parameters_b: null }]), /active parameter scope/);
});
