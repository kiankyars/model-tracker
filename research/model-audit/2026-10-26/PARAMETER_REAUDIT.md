# Parameter re-audit, October 27

The user requested a fresh audit and a separate new commit for every model whose parameter counts could not be established. The frozen scope in `manifest.json` includes every published record with `parameters_b` or `active_parameters_b` marked `undisclosed` or `unverified` at the start of this pass. Counts explicitly marked `not_applicable` alone do not enter the scope.

Use one dedicated agent per model. Each agent edits only that model's existing numbered report. The parent reviews, applies and commits each model separately, including fresh evidence when a count remains unresolved. Preserve the original audit assignment; record this pass's agent and outcome in the entry's `parameter_reaudit` object.

## Evidence standard

- The catalog records published model specifications. A nominal size is useful evidence; it does not require a complete tensor census, an exact component decomposition or a hosted provider's attestation of every deployed tensor.
- Accept developer-published nominal counts from model cards, technical reports, release posts and explicit model names. Preserve their precision and state that they are nominal. Do not erase a supported nominal size because an exact count is unavailable.
- An explicit developer statement identifying a fine-tune or post-trained version of a named base model can support a clearly labeled inference of nominal size from that base model. Check for pruning, distillation, expert expansion, new modalities or other structural changes that would defeat the inference. Family resemblance alone is insufficient.
- Distinguish the model's parameters from an entire hosted service. Search tools, routing infrastructure and auxiliary services do not require treating a documented model size as unknown. If a source describes only an identified backbone, retain an appropriate component scope rather than pretending it measures an undisclosed complete system.
- Read the previous report, reopen the relevant original evidence and search for missed or newer first-party disclosures. Secondary reporting can identify leads and corroborate a claim, but explain its role. Do not silently turn a rumor or unattributed estimate into a verified specification.
- Recheck total and active counts separately. For dense models, follow the developer's counting convention where given; do not invent an exact per-token count by equating it with total parameters. Explain when active parameters are not separately reported.
- Record what remains unresolved after the fresh search. Honest nulls are appropriate when evidence is insufficient; a missing exact tensor census is not itself a reason to discard published nominal counts.

## Report changes

Update `reviewed_at`, the two parameter assessments, their evidence and explicit patch values. Use `parameters_source: primary_source` for supported developer specifications or clearly documented lineage inferences, and explain the basis in `notes`. Add sources with unique IDs and update stale statements in `summary` and notes. Preserve the other audited fields unless the new parameter evidence directly establishes a related correction. Do not download weight shards. Do not edit shared files or commit from the model agent.

Validate with the exported `validateReport` function in `scripts/model-audit.mjs`, using the assigned manifest entry. Report the actual sources checked, changes and remaining uncertainty to the parent.
