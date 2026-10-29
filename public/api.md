# Data API

Read-only JSON and CSV. No authentication required.

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
- `open_weights`: `true` when downloadable weights are publicly available for the model; `false` when no public weight release is available at the latest review. This is not an open-source license classification. A hosted variant can be closed even when its base model has open weights. Clients should tolerate `null` for records awaiting review.
- `parameters_b`: Reported model parameters in billions, or `null`. Normally total model parameters; `parameters_scope` identifies a reported subset, such as `backbone` or `language_decoder`.
- `parameters_lower_bound_b`, `parameters_lower_bound_exclusive`: A published lower bound when the point count is `null`; `true` means strictly greater, `false` means at least. Bounds display in the table and qualify for the 100B+ filter when at least 100B, but are excluded from point charts and `known_parameters` statistics. Size sorting uses the published bound.
- `active_parameters_b`: Active parameters in billions when known. `active_parameters_scope` identifies the measured component or inference phase, such as `language_decoder` or `decode`.
- `parameter_components_b`, `active_parameters_by_phase_b`: Optional named component and phase counts, in billions. Do not add rounded components to infer a complete checkpoint count.
- `field_status`: Optional explanations for unresolved fields: `undisclosed`, `not_applicable`, or `unverified`. `audit_url` links to the individual research report; `audited_at` dates that review.
- `parameters_source`: Where the size came from. Name-derived sizes are not independently measured.
- `context_window`: Maximum context tokens in the model catalog, or `null`.
- `modalities`: Input and output modality arrays.
- `reasoning`, `tool_call`: Source-reported capability flags; unknown values remain `null`.
- `source_url`, `sources`: Provenance for the record and source-backed corrections.
- `upstream_present`: Whether a record is in the current upstream snapshot. Removed models are retained in the historical catalog.

Models can have overlapping types: a model may be both multimodal and reasoning-capable. Unknown numerical values are not zero and should be excluded from numerical averages. Use the catalog's coverage counts to disclose missingness in your own analysis.

## Versioning and refreshes

The `/v1/` contract supports additive fields. Clients should ignore unfamiliar fields and tolerate nulls. Data corrections can change historical aggregates; pin a repository commit when you need a reproducible dataset.

Releases are researched daily. GitHub Pages publishes changes after validation. `updated_at` is the later of source retrieval and completed research. `source.retrieved_at` dates the Models.dev snapshot; optional `research.reviewed_at` dates the latest research review.

Cache downloads and use conditional requests with `ETag` or `Last-Modified` when provided. GitHub Pages caching and hosting limits apply.

## For agents

[llms.txt](./llms.txt) links to data and documentation. Automated reading and reuse are permitted under the [MIT license](./LICENSE). Model weights and third-party publications retain their own licenses. See [coverage](./about.md).
