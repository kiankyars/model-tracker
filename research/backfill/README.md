# Historical backfill

The target is every month from January 2022 through October 2026: 58 months. Earlier models found during research remain eligible. The current inventory is a discovery input; the historical audit is not finished.

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
