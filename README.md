# Model releases

Language model releases by date, developer, type, and parameter count. Charts show release counts, cumulative releases, developers, and model sizes. Filters apply to charts, the table, and downloads.

**[Website](https://kiankyars.github.io/model-tracker/) · [API](https://kiankyars.github.io/model-tracker/api.html) · [Data](https://kiankyars.github.io/model-tracker/api/v1/models.json) · [llms.txt](https://kiankyars.github.io/model-tracker/llms.txt)**

HTML, CSS, and JavaScript, hosted on GitHub Pages with a static JSON API. No frontend dependencies or analytics.

## Run locally

Requires Node.js 22 or later and Python 3 for the local preview server. No package installation is required.

```sh
npm run check
npm run dev
```

Open http://localhost:4173. `npm run check` regenerates the API from the checked-in source snapshot, builds `dist/`, and runs tests without fetching the network.

```sh
npm run refresh  # fetch upstream and preserve catalog history
npm run check
```

## Data

The primary source is the MIT-licensed [Models.dev](https://github.com/anomalyco/models.dev) canonical model catalog, supplemented by source-linked historical releases and corrections. The dataset is broad but incomplete. Open weights does not mean open source. Unknown fields are null; explicitly named parameter sizes are labeled as name-derived. Known aliases are merged; separately released revisions remain distinct. Read [methodology](public/about.md) before interpreting statistics.

- `data/source/`: Recorded upstream snapshot and retrieval metadata.
- `data/catalog.json`: Normalized catalog, including retained history.
- `data/historical.json`: Primary-source historical additions.
- `data/corrections.json`: Explicit corrections and aliases.
- `data/research-metadata.json`: Research completion timestamp, created after the first research run.
- `public/api/`: Generated, untracked API artifacts.
- `public/api-schema.json`, `public/openapi.json`: Machine-readable contracts.
- `public/api.md`, `public/about.md`: Human- and agent-readable documentation.

To contribute, include a primary source for dates, sizes, or licensing claims. Do not guess undisclosed model sizes or replace a release date with a training cutoff. Add a regression test for transformations and data integrity rules. Run `npm run check` before submitting.

## Publishing and updates

Enable **Settings → Pages → Source → GitHub Actions**. The `Publish tracker` workflow builds, tests, and deploys pushes to `main` and manual dispatches. Pull requests build and test. It does not fetch data, commit changes, or run on a schedule.

A Codex automation in the project chat researches releases weekly on Monday at 09:00 Europe/Helsinki. It follows [RESEARCH.md](RESEARCH.md), searches developer announcements and model cards, adds verified records and corrections, and pushes after validation. The desktop app and computer need to be running. The automation is configured in Codex, outside this repository.

`npm run refresh` remains an optional manual import from Models.dev. It supplements independent research. The SHA-256 in `data/source/metadata.json` covers the exact saved bytes of `data/source/models.dev.json` (formatted JSON with sorted top-level IDs). Builds check that these files match. This checksum detects snapshot changes; it does not verify the accuracy of the source's claims.

The API consists of versioned static JSON resources, including complete and partitioned catalogs. It does not execute server-side query parameters. Browser filtering runs locally. See the [API reference](public/api.md) for examples and limitations.

`llms.txt` follows the [llmstxt.org proposal](https://llmstxt.org/), with Markdown documentation, JSON Schema, and OpenAPI discovery. Project-level GitHub Pages cannot control the domain-root `robots.txt`; this project does not make claims about that file or crawler enforcement.

## License

[MIT](LICENSE). Imported Models.dev metadata retains its original copyright and license in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Model weights and linked publications retain their own terms.
