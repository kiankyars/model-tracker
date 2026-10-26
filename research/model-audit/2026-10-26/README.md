# Model audit

Scope: the 563 models in `baseline.json`. Each model requires its own agent and report, including models whose specifications remain undisclosed. New catalog changes do not alter this frozen assignment list.

`manifest.json` records each actual agent assignment and parent review. `reports/NNN.json` holds that model's evidence and proposed corrections. The report number matches the manifest index.

Run `node scripts/model-audit.mjs` to see progress and the next pending assignments. Spawn the exact named task for one model, record the returned agent path, and give it `INSTRUCTIONS.md`. Resume existing agents for follow-ups to the same model; do not assign multiple models to one agent.

Review a returned report against its cited sources. Mark it accepted in the manifest only after review, with a dated `review.note`. Optional `review.accepted_proposed_fields` explicitly selects additional component or phase-count fields. `node scripts/model-audit.mjs --apply` incorporates accepted reports into the correction layer. Run `npm run check`, inspect the data diff, and verify the deployed API after publishing.

`--complete` checks assignment/report/review coverage. It is only a structural check. Completion also requires reviewing unresolved findings and verifying that accepted corrections appear correctly in the live site and API. An unknown value is not automatically an error; an unsupported inferred value is.
