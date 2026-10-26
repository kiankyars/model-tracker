# Data API

A public, read-only JSON API. No API key, account, or application server. The website and API use the same versioned dataset.

Base URL: `https://kiankyars.github.io/model-tracker/api/v1/`

## Endpoints

- [index.json](./api/v1/index.json): Endpoint discovery and available partitions.
- [models.json](./api/v1/models.json): Complete catalog, metadata, and coverage information. Records are in the `models` array.
- [stats.json](./api/v1/stats.json): Aggregates for the complete catalog.
- `months/YYYY-MM.json`: Records released in one calendar month.
- `developers/DEVELOPER_ID.json`: Records from one model developer.
- `models/SLUG.json`: One record. Read `slug` from the catalog; do not construct it from a display name.
- [models.csv](./api/v1/models.csv): Tabular download of the catalog.
- [JSON Schema](./api-schema.json): Model record schema.
- [OpenAPI](./openapi.json): Machine-readable HTTP API description.

Only partitions listed in the index exist. An unpublished month, developer, or model path returns HTTP 404. Follow the index instead of guessing identifiers.

## Querying

GitHub Pages serves static resources. Query strings do not filter API responses. Use a month or developer partition to reduce transfer, or fetch the full catalog and filter locally. The website's URL parameters are browser filters, not API parameters.

```javascript
const base = 'https://kiankyars.github.io/model-tracker/api/v1/';
const response = await fetch(`${base}models.json`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { models } = await response.json();
const results = models.filter(model =>
  model.open_weights === true &&
  model.parameters_b !== null &&
  model.parameters_b <= 8 &&
  model.release_date?.startsWith('2025-')
);
console.table(results.map(({ name, release_date, parameters_b }) =>
  ({ name, release_date, parameters_b })
));
```

```sh
curl -fsSL https://kiankyars.github.io/model-tracker/api/v1/models.json \
  | jq '.models[] | select(.developer_id == "anthropic")'
```

## Interpreting fields

- `id`: Stable canonical model identifier, including developer namespace.
- `slug`: Filename-safe identifier for the individual model endpoint.
- `developer`, `developer_id`: Model creator, independent of hosting provider.
- `release_date`: ISO day or month, or `null`. Respect `date_precision`.
- `open_weights`: `true`, `false`, or `null`. This is not an open-source license classification.
- `parameters_b`: Total parameters in billions, or `null`.
- `active_parameters_b`: Active parameters in billions for a mixture-of-experts model when known.
- `parameters_source`: Where the size came from. Name-derived sizes are not independently measured.
- `context_window`: Maximum context tokens in the model catalog, or `null`.
- `modalities`: Input and output modality arrays.
- `reasoning`, `tool_call`: Source-reported capability flags; unknown values remain `null`.
- `source_url`, `sources`: Provenance for the record and source-backed corrections.
- `upstream_present`: Whether a record is in the current upstream snapshot. Removed models are retained in the historical catalog.

Models can have overlapping types: a model may be both multimodal and reasoning-capable. Unknown numerical values are not zero and should be excluded from numerical averages. Use the catalog's coverage counts to disclose missingness in your own analysis.

## Versioning and refreshes

The `/v1/` contract supports additive fields. Clients should ignore unfamiliar fields and tolerate nulls. Breaking changes require a new API path. Data corrections can change historical aggregates; record the catalog's `updated_at` and source snapshot hash when reproducibility matters, or pin a source commit in the repository.

The upstream catalog is scheduled to refresh daily. The API is served through GitHub Pages' CDN and may remain cached briefly after publication. Cache your downloads and use conditional requests with `ETag` or `Last-Modified` when provided. GitHub hosting limits apply; this project provides no uptime or rate-limit guarantee.

## For agents

[llms.txt](./llms.txt) provides a concise entry point to data and documentation. It is an emerging discovery convention, not an access-control mechanism. Automated reading and reuse are permitted under the [MIT license](./LICENSE), including its notice requirements. Model weights and third-party publications retain their own licenses. See [coverage and methodology](./about.md) before treating the data as exhaustive.
