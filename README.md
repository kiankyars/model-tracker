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

## Frontend design tools

[Impeccable](https://github.com/pbakaus/impeccable) 4.8.0 is installed for this project in `.agents/skills/impeccable`. Its shell launcher keeps engine downloads in the ignored `.impeccable/runtime/` directory and disables telemetry. No global skill installation or automatic hooks are configured. The skill and its engine are development tools; neither is shipped to the website.

```sh
.agents/skills/impeccable/scripts/impeccable detect --json index.html app.js styles.css
```

The vendored skill retains its [Apache 2.0 license](.agents/skills/impeccable/LICENSE) and [third-party notices](.agents/skills/impeccable/NOTICE.md). Preserve the project-local launcher changes when updating it.

Bump `package.json`'s version when changing the frontend. The build uses it in CSS and JavaScript URLs, including module imports, to keep cached files from different releases from mixing.

## Data

The catalog combines MIT-licensed [Models.dev](https://github.com/anomalyco/models.dev) metadata with primary-source research. It includes verified announcements separately from availability; charts count recorded release dates. The dataset is broad but incomplete. Open weights does not mean open source. Unknown fields are null; explicitly named parameter sizes are labeled as name-derived. Known aliases are merged; separately released revisions remain distinct. Read [methodology](public/about.md) before interpreting statistics.

Parameter notes identify nominal counts and their source conventions. A nominal active count can round above a more precise total, such as T5's 3B versus 2.851598336B. Validation permits differences explained by rounding the total to the reported active count's decimal precision; it rejects larger discrepancies.

- `data/source/`: Recorded upstream snapshot and retrieval metadata.
- `data/catalog.json`: Normalized catalog, including retained history.
- `data/historical.json`: Primary-source historical additions.
- `data/corrections.json`: Explicit corrections and aliases.
- `data/research-metadata.json`: Research completion timestamp, created after the first research run.
- `data/candidates.json`: Persistent discovery queue and review decisions.
- `research/sources.json`, `research/discovery/`: Source registry and enumeration diagnostics.
- `research/backfill/`: Historical candidate inventory, monthly review coverage and remaining work.
- `public/api/`: Generated, untracked API artifacts.
- `public/api-schema.json`, `public/openapi.json`: Machine-readable contracts.
- `public/api.md`, `public/about.md`: Human- and agent-readable documentation.

To contribute, include a primary source for dates, sizes, or licensing claims. Do not guess undisclosed model sizes or replace a release date with a training cutoff. Add a regression test for transformations and data integrity rules. Run `npm run check` before submitting.

## Publishing and updates

Enable **Settings → Pages → Source → GitHub Actions**. The `Publish tracker` workflow builds, tests, and deploys pushes to `main` and manual dispatches. Pull requests build and test. It does not fetch data, commit changes, or run on a schedule.

A Codex automation in the project chat researches releases daily at 09:00 Europe/Helsinki. It follows [RESEARCH.md](RESEARCH.md), searches developer announcements and model cards, adds verified records and corrections, and pushes after validation. The desktop app and computer need to be running. The automation is configured in Codex, outside this repository.

`npm run discover` enumerates independent catalogs, global model repositories and publisher feeds into a persistent review queue. It does not publish models. Run `npm run discover -- --help` for source selection, pagination continuation and candidate review. The researcher follows up failed or manual source checks and verifies candidates against original sources. Historical research uses the [Models.dev Git inventory and monthly audit](research/backfill/README.md) alongside publisher and model-family searches.

`npm run refresh` remains an optional manual import from Models.dev. It supplements independent research. Source snapshots, additions, and corrections are tracked in Git.

The API consists of versioned static JSON resources, including complete and partitioned catalogs. It does not execute server-side query parameters. Browser filtering runs locally. See the [API reference](public/api.md) for examples and limitations.

`llms.txt` follows the [llmstxt.org proposal](https://llmstxt.org/), with Markdown documentation, JSON Schema, and OpenAPI discovery. Project-level GitHub Pages cannot control the domain-root `robots.txt`; this project does not make claims about that file or crawler enforcement.

## License

[MIT](LICENSE). Imported Models.dev metadata retains its original copyright and license in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Model weights and linked publications retain their own terms.
