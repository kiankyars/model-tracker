# Model releases

A minimal timeline of open-weight and closed language model releases: filter by date, developer, modality, capability, and parameter size; inspect monthly statistics; download the data.

**[Website](https://kiankyars.github.io/model-tracker/) · [API](https://kiankyars.github.io/model-tracker/api.html) · [Data](https://kiankyars.github.io/model-tracker/api/v1/models.json) · [llms.txt](https://kiankyars.github.io/model-tracker/llms.txt)**

Built with HTML, CSS, and browser JavaScript. No frontend dependencies, analytics, account system, database, or API keys. GitHub Pages serves both the site and the static JSON API.

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
- `public/api/`: Generated, untracked API artifacts.
- `public/api-schema.json`, `public/openapi.json`: Machine-readable contracts.
- `public/api.md`, `public/about.md`: Human- and agent-readable documentation.

To contribute, include a primary source for dates, sizes, or licensing claims. Do not guess undisclosed model sizes or replace a release date with a training cutoff. Add a regression test for transformations and data integrity rules. Run `npm run check` before submitting.

## Publishing and updates

Enable **Settings → Pages → Source → GitHub Actions**. The `Publish tracker` workflow builds and deploys pushes to `main`. Pull requests build and test without deployment. The daily 06:23 UTC schedule and manual workflow dispatch refresh upstream data, validate it, preserve changes in Git, and publish. Invalid or unavailable upstream data fails the run; the last successful site remains online.

The API consists of versioned static JSON resources, including complete and partitioned catalogs. It does not execute server-side query parameters. Browser filtering runs locally. See the [API reference](public/api.md) for examples and limitations.

`llms.txt` follows the [llmstxt.org proposal](https://llmstxt.org/), with Markdown documentation, JSON Schema, and OpenAPI discovery. Project-level GitHub Pages cannot control the domain-root `robots.txt`; this project does not make claims about that file or crawler enforcement.

## License

[MIT](LICENSE). Imported Models.dev metadata retains its original copyright and license in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Model weights and linked publications retain their own terms.
