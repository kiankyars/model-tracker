# Historical backfill

The target is every month from January 2022 through October 2026: 58 months. Earlier models found during research remain eligible. The first source sweep is recorded for all 58 months. Every month retains explicit gaps; this is not a complete release census.

Scope includes company and institutional lab releases, including continued pretraining, fine-tuning, distillation and trained variants of another publisher’s model. Independently pretrained research releases remain eligible; community derivatives are excluded. Verify publisher status from primary sources rather than a hosting account type or base-model tag, and keep uncertain cases pending. Dedicated ASR/OCR, embeddings, rerankers, classifiers, media-only generators, routing endpoints and serving tiers are outside the language-generation catalog. Conversational audio and multimodal models that generate language remain eligible.

`coverage.json` records month-level review status. `unreviewed` means the required source sweep has not been completed. `reviewed_with_gaps` means some primary-source review has occurred with work remaining. `audited` means the prescribed review has been completed and outstanding gaps recorded, not that every release is known. A month with zero candidates is not an audited month.

## Models.dev history

The extraction traverses every commit reachable from the pinned ref, including merge-parent changes. It reads current and removed canonical models, legacy provider model records, explicit `base_model` relationships and symbolic links. Exact version suffixes are retained. The snapshot records the ref, extraction counts, parse failures and limitations.

Files:

- `models-dev-candidates.json`: one row per historical canonical model ID, with catalog matches and upstream date claims.
- `models-dev-provider-candidates.json`: unresolved provider records grouped by exact case-insensitive model key. These groups are identity-review tasks, not independent releases.
- `models-dev-bindings.jsonl`: provider paths with explicit canonical model or symbolic-link bindings.
- `models-dev-parse-errors.json`: invalid historical TOML requiring parser/source review. Clearly quoted identity and date fields are retained as leads.
- `models-dev-snapshot.json`: snapshot provenance, counts, and limitations.
- `requirements.json`: persistent audit requirements and remaining work.
- `canonical-dispositions.json`: primary-source dispositions for the 142 initially unmatched text-output canonical candidates.
- `reviews/`: monthly primary-source checks and remaining questions across all 58 months.
- `evidence/` and `sample-review-*.json`: candidate dispositions, archive checks and independent reviews.
- `models-dev-*-dispositions.json`: reconciled canonical and provider outcomes, including specific pending identity questions.
- `reconciliation.json`: current counts after applying the catalog and primary-source decisions.

No upstream date is added to published model data by this extraction. Models.dev history starts in June 2025 and contains erroneous dates, provider launch dates, mutable aliases and distribution variants. Removal from its catalog is not proof of retirement. Text-output metadata can also describe transcription, embeddings or classification incorrectly; primary sources decide scope.

Rebuild from a complete bare clone:

```sh
git clone --bare https://github.com/anomalyco/models.dev.git /tmp/models-dev-history
python3 scripts/backfill-inventory.py --repo /tmp/models-dev-history
```

To reproduce a snapshot, pass `--ref` with the commit in `models-dev-snapshot.json`. Regeneration preserves existing monthly review status, source checks and review dates. It does not mark months reviewed or publish candidates.

## Review process

Work along both axes: each month and each publisher/model family. A month-only news search misses quiet releases; a current-catalog-only sweep misses retired models. Review old publisher announcements, dated API changelogs/deprecations, official model cards and weight histories, research-lab repositories and technical reports. Compare the union with provider catalogs and historical snapshots. Resolve aliases and quantizations separately from trained model variants.

For each model, record primary evidence for its first actual release or announcement, date precision and access. Repository creation times and paper dates are leads unless evidence establishes public availability on that date. Preserve unresolved fields. Add or correct each independently verified model in its own commit.

For each month, record the primary sources actually checked, unresolved candidates and the last review date. Finish the complete 58-month sweep before repeating recent months for convenience. Return to unresolved identities after the first pass and retain gaps that primary evidence cannot resolve.

Run `npm run reconcile` after catalog changes to refresh dispositions and coverage without downloading upstream history again. Exact identities and documented bindings can reconcile leads; similar names alone remain pending. Source-filtered non-text entries stay in the inventory and are not presented as primary-verified exclusions.
