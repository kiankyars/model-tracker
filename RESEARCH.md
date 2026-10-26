# Weekly release research

Research new language model releases and correct existing records. This is a browsing and source-verification task. Refreshing Models.dev alone does not complete it.

## Search

Use the last completed research report in `research/`, or the latest data commit if none exists. Include at least fourteen days of overlap to catch delayed reports. Search beyond the existing developer list for new labs and open-weight releases.

Check first-party announcements, release notes, official Hugging Face organizations and model cards, GitHub release histories, and technical reports. Cover both API-only and downloadable models. Include OpenAI, Anthropic, Google, Meta, Alibaba/Qwen, DeepSeek, Mistral, xAI, Cohere, Microsoft, NVIDIA, Amazon, Moonshot, MiniMax, Z.ai, Baidu, Tencent, ByteDance, and other developers appearing in current searches. Third-party reporting can identify candidates; published claims need the original source.

Check the exact release date, available variants, total and active parameter counts, weight availability, license, modalities, and context length. Distinguish public availability from an announcement, preview identifier, training cutoff, or a provider adding an existing model. Keep missing values null. Do not infer closed-model sizes.

## Update

Inspect the working tree and upstream branch first; preserve unrelated work. Use `npm run refresh` to import current Models.dev metadata when useful, then independently review candidate releases and changed fields. The importer is optional and does not replace research.

Add verified releases missing upstream to `data/historical.json`, the existing source-backed supplement. Use `data/corrections.json` for overrides, aliases, and exclusions. Match the existing record structure and include primary-source URLs and short factual notes where necessary. Keep revisions and parameter-size variants separate; merge only documented aliases. Avoid automatically publishing questionable changes just because they appeared upstream.

For confirmed release dates, set `source_type` to `primary`, supply the explicit `release_date`, and include both `source_url` and a `sources` entry linking to the evidence. After completing research, write the completion time as an ISO timestamp in `data/research-metadata.json`, for example `{ "reviewed_at": "2026-11-02T07:00:00.000Z" }`. This allows verified additions beyond the upstream snapshot date. Keep the source retrieval timestamp tied to the actual import.

Record a brief structured report at `research/YYYY-MM-DD.json`: research date and window, sources checked, added IDs, corrected IDs, unresolved candidates and their specific uncertainties. Do not record a successful check for a source that could not be accessed. Do not claim exhaustive coverage.

## Publish

Run `npm run check` and `git diff --check`. Inspect the diff for unrelated changes and data regressions. Commit the intended files and push to `main`; verify the remote commit and successful GitHub Pages deployment. Read back the live API for the changed records. A failed build or ambiguous source is a reason to preserve the current published data and report the specific issue.

Keep site copy factual. Preserve the author's wording in `public/about.md`. Do not redesign the site as part of a data update.
