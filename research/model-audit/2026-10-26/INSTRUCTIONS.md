# Individual model audit

The user requires a separate sub-agent for every model in the frozen 563-model baseline. Each numbered task owns exactly one model. Do not batch models or substitute a family review for an individual review. The manifest records actual spawned tasks; a report alone does not establish that an agent was spawned.

Read your assigned original record with `node scripts/model-audit.mjs --record N` (your manifest index), then research it independently using current web sources. Prefer original developer announcements, official model cards, technical reports, configuration files and official API documentation. Follow the record's source links and search beyond Models.dev. A catalog entry is a lead, not verification. Check that the evidence describes the exact variant and revision, especially dated API identifiers and fine-tunes. Never assume an undisclosed closed model's size, architecture, or active parameters. For dense models, do not equate total and active counts unless the source defines the latter; explain when active counts are not separately reported or not applicable. Counts in billions may be nominal if the source labels them that way.

Before calling a parameter count undisclosed, check later first-party technical reports and model-card comparison tables for the exact model name. For architecture, also search first-party interpretability and training research about the exact model; these can disclose Transformer structure omitted by a model card. Do not confuse sparse-autoencoder or transcoder feature counts with production model parameters. A later sibling card can directly report this model's total and active counts; use the exact labeled column rather than transferring sibling specifications.

Audit every public factual field: name, developer, family, release_date, open_weights, license, parameters_b, active_parameters_b, architecture, context_window, modalities, reasoning, tool_call, and description. Focus especially on parameter counts and architecture. Check whether descriptions contain unsupported claims. Keep unknowns null where evidence is insufficient; distinguish undisclosed information from failed verification. Record conflicts instead of guessing. An inaccessible or absent model card must be reported honestly. Other search results can help discover primary evidence but cannot replace it for technical claims.

When using checkpoint tensor counts, check quantization and buffers. Scale tensors, packed storage elements, and other non-parameter metadata are not automatically learned model parameters. Distinguish nominal model counts, complete parameter counts, and storage-element totals; avoid downloading whole weight shards when metadata, configuration, and tensor headers suffice.

Write only your own report to `reports/NNN.json`. Do not edit the shared catalog, manifest, corrections, frontend, or other reports. Do not commit. Use this structure:

```json
{
  "index": 1,
  "model_id": "developer/model",
  "reviewed_at": "ISO UTC timestamp",
  "sources": [
    {"id": "s1", "url": "https://...", "title": "Source title", "publisher": "Developer", "accessed": true, "evidence": "Concise paraphrase of what this source establishes for this exact model."}
  ],
  "fields": {
    "parameters_b": {"value": null, "status": "verified|undisclosed|unverified|not_applicable", "source_ids": ["s1"], "note": "Basis, units and precision."}
  },
  "patch": {},
  "summary": "What changed or was confirmed; unresolved issues."
}
```

Include one `fields` assessment for every field listed above. `value` is the supported value (or null); `patch` contains only justified corrections to the baseline, using existing catalog field types. For confirmed parameter counts set `parameters_source` to `primary_source` in the patch. Add `notes` if necessary to avoid a misleading interpretation. Include source URLs in the patch's `sources` array for corrected claims, using `{label,url,type}`. Do not use `source_type: primary` for the entire record unless release-date evidence is also primary and explicit. Do not fabricate evidence, claim exhaustive search, or mark a field verified merely because it exists in the baseline.

Keep component/phase breakdowns in an optional `proposed_fields` object for parent review. Do not add `parameters_scope` for a complete checkpoint count: total is already the default. A component scope must be a short key matched to a numeric `parameter_components_b` entry, not a prose explanation. Do not add checksum bookkeeping. Keep evidence notes concise.

The license field accepts a supported descriptive `proprietary` classification as well as named licenses; it is not limited to SPDX identifiers. Do not mark it not applicable solely because weights are not distributed.

For nullable fields, explicitly clear an unsupported baseline assertion in `patch`; an unverified assessment must not leave an asserted value merely because it was already in the catalog. A complete indexed primary page can establish last-documented specifications if its age and access limitations are recorded; it cannot prove current endpoint operation. Distinguish the earliest public release from a later region, provider listing or upgrade. Preserve month precision when the release day genuinely remains unresolved.

Finish with your report path and a concise account of the findings. The parent reviews evidence and integrates accepted changes. Unresolved cases remain open in the overall audit.
