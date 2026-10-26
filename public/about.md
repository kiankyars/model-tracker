# About the data

Model releases is an open timeline of language models. Use it to explore when models arrived, how releases are distributed across developers, and how their published capabilities compare.

## Coverage

The catalog combines [Models.dev](https://models.dev/) model metadata with historical releases and source-backed corrections maintained in [this repository](https://github.com/kiankyars/model-tracker). It includes text-generating models and multimodal models that generate text. It excludes embedding-only models, rerankers, image-only generators, and anonymous routing endpoints.

Coverage is broad, but not exhaustive. Research models, regional releases, fine-tunes, and models without API distribution are less consistently represented. Statistics describe this catalog. They do not measure the entire industry's release volume. A month with no records means no catalogued releases, not proof that no models were released.

## What counts as a release?

Each record represents an identified model or a distinct published revision. Different parameter sizes can be separate releases. Hosting the same model at another provider does not make it a new release. Known aliases are merged through an explicit correction map; distinct dated revisions are retained. The community catalog may contain other aliases that have not yet been resolved.

Release dates aim to represent first public availability of the named model, including public previews. They are not training dates or knowledge cutoffs. Upstream dates can reflect announcements or provider availability instead; source-backed corrections resolve known discrepancies. Month-only dates retain month precision. An unknown date is not assigned to a month.

## Sources and uncertainty

Every record links to its source. Most records inherit metadata from the community-maintained Models.dev catalog; a source link does not mean every claim has been independently verified. Historical additions and corrections link to papers, model cards, or developer announcements. Where sources disagree, the correction layer records the basis for the chosen value.

Unknown values are stored as `null`. Parameter counts are in billions. Some sizes are parsed from explicit names such as “7B”; these are labeled as name-derived and should not be treated as exact measured counts. Mixture-of-experts models can have separate total and active counts. Do not compare active counts with total counts. Closed-model parameter counts remain unknown unless disclosed.

Context windows are measured in tokens and describe the catalog's model-level value. Actual limits can vary by serving provider or API configuration. Reasoning denotes the source's capability flag, not an evaluation score. Multimodal means the recorded inputs or outputs include a modality other than text.

## Open weights and licenses

Open weights means model weights are publicly available. It does not mean the model meets an open-source definition or permits every commercial use. Check each model's license and original model card. Missing license information remains unknown. “Closed” means the source marks the weights as unavailable; an unspecified access status remains unknown.

The site's code and distributed metadata use the [MIT license](./LICENSE), with the Models.dev copyright notice retained in [third-party notices](./THIRD_PARTY_NOTICES). Linked publications and model weights retain their own terms. Agents may read, analyze, and reuse this site's data under those license terms.

## Updates and corrections

A GitHub Actions workflow refreshes the upstream catalog daily at 06:23 UTC, validates the data, and publishes the site. Scheduled runs depend on GitHub availability and can be delayed. The displayed refresh time is the last successful source retrieval, not a guarantee that upstream information is current.

Source snapshots and their SHA-256 hashes are versioned in Git. Previously catalogued records are retained when upstream removes them, with their upstream-presence status recorded. Failed validation prevents publication. Historical additions and corrections remain in separate, reviewable files.

To report a missing model or incorrect field, [open an issue](https://github.com/kiankyars/model-tracker/issues/new) with a primary source, the model identifier, and the proposed correction. Contributions should distinguish a new release from an alias, a model from a hosting endpoint, and a public release date from an announcement.

## Privacy

The site has no analytics, account system, cookies, or third-party scripts. Search and filtering run in your browser. Filter state is stored in the URL so you can bookmark or share a view. GitHub Pages operates the hosting infrastructure under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
