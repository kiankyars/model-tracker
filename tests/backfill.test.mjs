import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCandidates, mergeMonthReviews } from '../scripts/reconcile-backfill.mjs';

const canonical = [{ id: 'lab/model', name: 'Model', source_url: 'https://example.org/model', source_links: [], date_claims: [{ date: '2022-01-04' }] }];
const provider = { id: 'provider-key:model', model_key: 'model', records: [{ source_url: 'https://example.org/provider' }], possible_catalog_matches: ['lab/model'], possible_canonical_matches: [], date_claims: [{ date: '2022-01-05' }] };

test('historical name similarity stays pending; explicit identity can reconcile it', () => {
  const options = { catalog: [{ id: 'lab/model' }], canonical, providers: [provider] };
  assert.equal(reconcileCandidates(options).providers[0].status, 'pending');
  const bound = reconcileCandidates({ ...options, bindings: [{ model_key: 'model', base_models: ['lab/model'] }] });
  assert.equal(bound.providers[0].status, 'mapped');
  assert.equal(bound.canonical[0].status, 'tracked');
});

test('unpublished proposals and partially resolved bindings remain pending', () => {
  const result = reconcileCandidates({ catalog: [], canonical, providers: [provider], decisions: [{ id: 'lab/model', model_id: 'lab/model', status: 'proposed' }], bindings: [{ model_key: 'model', base_models: ['lab/model', 'lab/missing'] }] });
  assert.equal(result.canonical[0].status, 'pending');
  assert.equal(result.providers[0].status, 'pending');
});

test('coverage refresh preserves reviewed gaps and never promotes an unchecked month', () => {
  const coverage = { months: [{ month: '2022-01', status: 'unreviewed' }, { month: '2022-02', status: 'unreviewed' }] };
  const catalog = [{ id: 'lab/model', release_date: '2022-01-04' }];
  const dispositions = reconcileCandidates({ catalog, canonical, providers: [provider] });
  const result = mergeMonthReviews({ coverage, reviews: [{ month: '2022-01', status: 'reviewed_with_gaps', outstanding_repository_leads: 2, outstanding_primary_questions: 1 }], catalog, canonical, providers: [provider], dispositions, reviewedAt: '2026-10-29T00:00:00Z' });
  assert.equal(result.months[0].outstanding_candidates, 4);
  assert.equal(result.months[0].catalogued_releases, 1);
  assert.equal(result.months[0].status, 'reviewed_with_gaps');
  assert.equal(result.months[1].status, 'unreviewed');
  const refreshed = mergeMonthReviews({ coverage: result, reviews: [], catalog, canonical, providers: [provider], dispositions, reviewedAt: '2026-10-30T00:00:00Z' });
  assert.equal(refreshed.months[0].outstanding_candidates, 4);
  assert.equal(refreshed.months[0].outstanding_repository_leads, 2);
  assert.equal(refreshed.months[0].outstanding_primary_questions, 1);
});
