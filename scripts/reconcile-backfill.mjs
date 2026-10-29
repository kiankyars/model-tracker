import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function reconcileCandidates({ catalog, corrections = {}, canonical, providers, bindings = [], decisions = [] }) {
  const ids = new Set(catalog.map(model => model.id));
  const aliases = new Map(Object.entries(corrections.aliases || {}));
  for (const model of catalog) for (const alias of model.aliases || []) aliases.set(alias, model.id);
  const find = id => ids.has(id) ? id : ids.has(aliases.get(id)) ? aliases.get(id) : null;
  const reviewed = new Map(decisions.map(row => [row.id, row]));
  const bound = new Map();
  for (const row of bindings) {
    const key = row.model_key.toLowerCase();
    bound.set(key, [...new Set([...(bound.get(key) || []), ...row.base_models])]);
  }
  const canonicalReview = canonical.map(row => {
    const catalogId = find(row.id);
    const excluded = corrections.exclude?.[row.id];
    const review = reviewed.get(row.id);
    if (catalogId) return { id: row.id, status: 'tracked', model_id: catalogId, reason: 'Exact catalog identity or curated alias.', sources: [row.source_url] };
    if (excluded) return { id: row.id, status: 'excluded', reason: excluded.reason, sources: excluded.sources || [excluded.source_url] };
    if (review) {
      const targets = review.related_model_ids || [review.model_id || review.catalog_id || review.canonical_id].filter(Boolean);
      if (['tracked', 'proposed'].includes(review.status) && (!targets.length || !targets.every(find))) {
        return { ...review, status: 'pending', reason: 'Reviewed proposal is not present in the published catalog yet.' };
      }
      return { ...review, status: review.status === 'proposed' ? 'tracked' : review.status };
    }
    if (row.scope_lead === 'other_output_claimed') return { id: row.id, status: 'scope_filtered', reason: 'Upstream claims no text output. Retained for metadata/scope review, outside the text-model candidate count; this is not a primary-source exclusion.', sources: [row.source_url] };
    return { id: row.id, status: 'pending', reason: `Verify ${row.name}'s original publisher, language-model scope, trained checkpoint identity and first external availability. Upstream modality and date claims are unverified.`, sources: [row.source_url, ...row.source_links] };
  });
  const canonicalById = new Map(canonicalReview.map(row => [row.id, row]));
  const providerReview = providers.map(row => {
    const catalogId = find(row.model_key);
    const excluded = corrections.exclude?.[row.model_key];
    const sources = row.records.map(record => record.source_url);
    if (catalogId) return { id: row.id, status: 'tracked', model_id: catalogId, reason: 'Exact catalog identity or curated alias.', sources };
    if (excluded) return { id: row.id, status: 'excluded', reason: excluded.reason, sources: excluded.sources || [excluded.source_url] };
    if (row.scope_lead === 'other_output_claimed') return { id: row.id, status: 'scope_filtered', reason: 'Upstream claims no text output. Retained outside the text-model candidate count; modality metadata remains unverified.', sources };
    const targets = [...new Set([row.canonical_id, ...(bound.get(row.model_key) || [])].filter(Boolean))];
    if (targets.length && targets.every(id => find(id) || ['tracked', 'excluded'].includes(canonicalById.get(id)?.status))) {
      return { id: row.id, status: 'mapped', canonical_ids: targets, reason: 'Explicit upstream canonical identity or historical base_model binding. Targets have catalog dispositions; this mapping does not verify a provider launch date or prove every historical revision equivalent.', sources };
    }
    const possible = [...new Set([...targets, ...row.possible_catalog_matches, ...row.possible_canonical_matches])];
    const question = possible.length
      ? `Establish whether ${row.model_key} is a provider alias, distribution variant or distinct trained revision of ${possible.join(', ')}.`
      : `Identify the original publisher and trained checkpoint behind ${row.model_key}; establish language-model scope and whether it is an original release.`;
    return { id: row.id, status: 'pending', reason: `${question} Verify first external availability separately from the provider's date claim.`, possible_model_ids: possible, sources };
  });
  return { canonical: canonicalReview, providers: providerReview };
}

export function mergeMonthReviews({ coverage, reviews, catalog, canonical, providers, dispositions, reviewedAt }) {
  const canonicalPending = new Set(dispositions.canonical.filter(row => row.status === 'pending').map(row => row.id));
  const providerPending = new Set(dispositions.providers.filter(row => row.status === 'pending').map(row => row.id));
  const claimsInMonth = (rows, ids, month) => rows.filter(row => ids.has(row.id) && row.date_claims.some(claim => claim.date.slice(0, 7) === month)).length;
  const byMonth = new Map(reviews.map(row => [row.month, row]));
  return {
    ...coverage, updated_at: reviewedAt,
    limitations: 'Pending counts combine unverified canonical identities, provider identity groups and publisher repository leads; they are not counts of missing models. Conflicting upstream date claims can place one lead in several months. Leads without dates remain in the research inventories. A source sweep is not an exhaustive release census.',
    months: coverage.months.map(previous => {
      const review = byMonth.get(previous.month);
      const merged = { ...previous, ...(review || {}) };
      const canonicalCount = claimsInMonth(canonical, canonicalPending, previous.month);
      const providerCount = claimsInMonth(providers, providerPending, previous.month);
      const repositoryCount = merged.outstanding_repository_leads || 0;
      return {
        ...merged,
        status: review?.status || previous.status,
        outstanding_canonical_candidates: canonicalCount,
        outstanding_provider_identity_groups: providerCount,
        outstanding_repository_leads: repositoryCount,
        outstanding_candidates: canonicalCount + providerCount + repositoryCount + (merged.outstanding_primary_questions || 0),
        catalogued_releases: catalog.filter(model => model.release_date?.slice(0, 7) === previous.month).length,
      };
    }),
  };
}

export async function reconcile(root, directory = path.join(root, 'research/backfill')) {
  const read = async (name, fallback) => {
    try { return JSON.parse(await fs.readFile(name, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
  };
  const write = (name, value) => fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  const catalog = await read(path.join(root, 'data/catalog.json'));
  const corrections = await read(path.join(root, 'data/corrections.json'));
  const canonical = await read(path.join(directory, 'models-dev-candidates.json'));
  const providers = await read(path.join(directory, 'models-dev-provider-candidates.json'));
  const bindings = (await fs.readFile(path.join(directory, 'models-dev-bindings.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const review = await read(path.join(directory, 'canonical-dispositions.json'), { items: [] });
  const decisions = review.items.map(row => ({
    ...row, status: ({ excluded: 'excluded', alias: 'tracked', verified_new_record: 'tracked', unresolved_primary_gap: 'pending' })[row.disposition] || 'pending',
    sources: row.primary_sources_checked,
  }));
  const dispositions = reconcileCandidates({ catalog, corrections, canonical, providers, bindings, decisions });
  await write('models-dev-canonical-dispositions.json', dispositions.canonical);
  await write('models-dev-provider-dispositions.json', dispositions.providers);
  const reviews = [];
  for (const name of ['2022', '2023', '2024', '2025-2026']) reviews.push(...await read(path.join(directory, 'reviews', `${name}.json`), []));
  const coverage = mergeMonthReviews({ coverage: await read(path.join(directory, 'coverage.json')), reviews, catalog, canonical, providers, dispositions, reviewedAt: new Date().toISOString() });
  await write('coverage.json', coverage);
  const count = rows => Object.fromEntries([...new Set(rows.map(row => row.status))].map(status => [status, rows.filter(row => row.status === status).length]));
  const summary = { updated_at: coverage.updated_at, catalog_records: catalog.length, canonical: count(dispositions.canonical), provider_groups: count(dispositions.providers), months: count(coverage.months), source_snapshot: 'models-dev-snapshot.json' };
  await write('reconciliation.json', summary);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(await reconcile(root, process.argv[2] ? path.resolve(process.argv[2]) : undefined), null, 2));
}
