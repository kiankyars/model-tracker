# Daily model research

Find new language models and correct existing records using primary sources. The scheduled prompt delegates to this workflow; an upstream import alone does not complete a run.

## Discover

Run `npm run discover`, keeping at least fourteen days of overlap with the last completed research report. It enumerates Models.dev, OpenRouter, global Hugging Face and ModelScope listings, and publisher feeds. It saves candidates in `data/candidates.json` and source diagnostics in `research/discovery/`.

Read those diagnostics. Resume unfinished pagination with `npm run discover -- --resume REPORT`; a page limit, blocked request, missing credential or manual source is not a successful check. Follow `research/sources.json` for publisher changelogs, Arena, Artificial Analysis and Epoch checks that the collector cannot perform. Record the actual result of each check.

Search beyond that registry: unfamiliar authors, new labs, GitHub releases, research reports, community leads and non-English announcements. A fixed source union reduces omissions but does not establish complete coverage. Repository changes, provider listing dates and benchmark appearances are leads, not release dates.

Review due candidates, prioritizing company/lab releases and rollout checks while rotating through older unresolved leads. Keep unreviewed leads pending; preserve a specific question and `next_check` when evidence is missing. Record `tracked`, `duplicate` or `excluded` with a reason and canonical model ID where applicable:

```sh
npm run discover -- --review CANDIDATE_ID --status pending --reason "First external availability remains unverified" --next-check YYYY-MM-DD
```

## Verify and update

Check the original announcement, official model card, weight repository, API changelog or technical report. Verify identity, first availability, trained variants, total and active parameters, license, modalities and context. Keep unsupported values null; never infer closed-model sizes.

An official announcement is enough to list a model: record `announcement_date`, `availability: "announced"` and a null `release_date` until external access is verified. Use `limited` after restricted external access and `public` after general availability. This records the release stage reached; it does not assert that a historical service still runs. Keep one canonical ID through these stages. `release_date` means first verified external availability; preserve month precision when the day is unresolved. Missing sizes or dates must not hide a verified model.

Keep an announced or limited model's availability follow-up pending in the queue, linked to its published `model_id`, until the relevant rollout is resolved.

Check official documentation and weight repositories before setting `open_weights`. It is true for an available downloadable checkpoint or explicitly documented equivalent; otherwise false at review time. Open weights does not imply an unrestricted license. A hosted revision does not inherit its base model's weight availability.

Include company and institutional lab releases, including continued pretraining, fine-tuning, distillation and trained variants of another publisher's model. Preserve independently pretrained research releases. Exclude community derivatives. Verify the publishing organization from primary sources; a Hugging Face organization or an external-base tag alone does not establish company or community status. Keep uncertain cases pending.

Include speech-native conversational language models when primary sources verify generative dialogue, even without text input or output. Review them manually; dedicated synthesis, transcription, voice conversion and audio classification remain outside scope.

Add models to `data/historical.json`; use `data/corrections.json` for overrides, aliases and exclusions. Include primary URLs and concise evidence notes. Count independently trained sizes, base/instruct variants and released revisions separately. Merge documented aliases; exclude mirrors, quantizations, intermediate training checkpoints and serving/reasoning tiers of the same model.

## Historical coverage

Continue the January 2022–October 2026 backfill in `research/backfill/requirements.json`. Models.dev's current catalog and full reachable Git history are candidate inventories, including removed records. Their date claims still need verification.

Work by month and by publisher/model family. Apply the same scope to every year, including small and discontinued models. Review all 58 months before repeatedly searching recent months. Record actual primary checks, candidate dispositions and remaining gaps in `research/backfill/coverage.json`; inventory extraction alone never marks a month reviewed. After the initial sweep, independently recheck a sample across years, regions, sizes and access types using different discovery sources. Then rotate through the least recently reviewed historical months during daily research.

## Publish

Save a structured `research/YYYY-MM-DD.json` report with the search window, checks, additions, corrections and unresolved questions. Set `data/research-metadata.json`'s `reviewed_at` to the research completion time; keep source retrieval timestamps tied to actual imports.

Run `npm run check` and `git diff --check`. Make one commit per model addition or correction, including its evidence and generated catalog change. Commit workflow/interface changes separately. Push to `main`, verify the remote commit and successful Pages deployment, and read back changed live API records. A build failure or ambiguous claim is not a completed publication.

Keep site copy factual and preserve the author's `public/about.md` prose. Data updates do not require a redesign.
