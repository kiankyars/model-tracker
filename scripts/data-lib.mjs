export const SOURCE_URL = 'https://models.dev/models.json';
export const SCHEMA_VERSION = '1.0';
const LABS = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', alibaba: 'Alibaba',
  meta: 'Meta', mistral: 'Mistral', deepseek: 'DeepSeek', cohere: 'Cohere', xai: 'xAI',
  nvidia: 'NVIDIA', microsoft: 'Microsoft', amazon: 'Amazon', zhipuai: 'Z.ai',
  minimax: 'MiniMax', moonshotai: 'Moonshot AI', 'bytedance-seed': 'ByteDance',
  xiaomi: 'Xiaomi', tencent: 'Tencent', inclusionai: 'InclusionAI', deepreinforce: 'DeepReinforce',
  upstage: 'Upstage', sakana: 'Sakana AI', poolside: 'Poolside', perplexity: 'Perplexity',
  openbmb: 'OpenBMB', 'aion-labs': 'Aion Labs', stepfun: 'StepFun', baidu: 'Baidu',
  inception: 'Inception', nousresearch: 'Nous Research', 'arcee-ai': 'Arcee AI',
  vispark: 'Vispark', sao10k: 'Sao10K', ibm: 'IBM', thedrummer: 'TheDrummer',
  sarvam: 'Sarvam AI', baai: 'BAAI', rekaai: 'Reka AI', quiverai: 'QuiverAI',
  thinkingmachines: 'Thinking Machines', meituan: 'Meituan', canopylabs: 'Canopy Labs',
  'swiss-ai': 'Swiss AI', ai21: 'AI21 Labs', 'inference-net': 'Inference.net', writer: 'Writer',
  morph: 'Morph', relace: 'Relace', perceptron: 'Perceptron', mindlab: 'MindLab',
  sdaia: 'SDAIA', 'motif-technologies': 'Motif Technologies', 'nex-agi': 'Nex AGI',
  baichuan: 'Baichuan', essentialai: 'Essential AI', paddlepaddle: 'PaddlePaddle',
  undi95: 'Undi95', aisingapore: 'AI Singapore', recursive: 'Recursive', fireworks: 'Fireworks',
  vivgrid: 'Vivgrid', unbiased: 'Unbiased', reflection: 'Reflection', lightonai: 'LightOn',
  trendyol: 'Trendyol', gryphe: 'Gryphe', mancer: 'Mancer', apodex: 'Apodex',
  liquid: 'Liquid AI', cognitivecomputations: 'Cognitive Computations',
  'anthracite-org': 'Anthracite', 'aleph-alpha': 'Aleph Alpha', abacusai: 'Abacus.AI',
  mixedbread: 'Mixedbread', bigscience: 'BigScience', eleutherai: 'EleutherAI',
};

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return false;
  const full = value.length === 7 ? `${value}-01` : value;
  const date = new Date(`${full}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === full;
}

export function isFuture(value, asOf) {
  return value ? value.slice(0, value.length === 7 ? 7 : 10) > asOf.slice(0, value.length === 7 ? 7 : 10) : false;
}

export function slugFor(id) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(id) || id.includes('..')) throw new Error(`Unsafe model ID: ${id}`);
  return id.toLowerCase().replaceAll('/', '--');
}

export function eligibleModel(model) {
  return Array.isArray(model.modalities?.output) && model.modalities.output.includes('text') &&
    !['image', 'video', 'speech', 'transcription', 'embedding', 'reranking', 'decision'].includes(model.type);
}

export function namedParameters(name, id = '') {
  // Expert widths and Llama 4's active-parameter labels are not total model size.
  if (/\d+\s*x\s*\d+(?:\.\d+)?\s*[bmt]\b/i.test(name) || /llama-4-(scout|maverick)/.test(id)) {
    return { parameters_b: null, active_parameters_b: null, parameters_source: null, architecture: null };
  }
  const unit = { b: 1, m: 0.001, t: 1000 };
  const total = name.match(/(?:^|[\s_(-])(\d+(?:\.\d+)?)\s*([bmt])(?=$|[\s_)\-])/i);
  const active = name.match(/(?:^|[\s_(-])a(\d+(?:\.\d+)?)\s*([bmt])(?=$|[\s_)\-])/i);
  return {
    parameters_b: total ? Number((Number(total[1]) * unit[total[2].toLowerCase()]).toPrecision(12)) : null,
    active_parameters_b: active ? Number((Number(active[1]) * unit[active[2].toLowerCase()]).toPrecision(12)) : null,
    parameters_source: total ? 'model_name' : null,
    architecture: active ? 'moe' : null,
  };
}

export function normalize(id, model, retrievedAt) {
  const developerId = id.split('/')[0];
  if (model.release_date && !validDate(model.release_date)) throw new Error(`Invalid release date for ${id}: ${model.release_date}`);
  const sourceUrl = `https://github.com/anomalyco/models.dev/blob/dev/models/${id}.toml`;
  return {
    id, slug: slugFor(id), name: model.name, developer: LABS[developerId] || developerId,
    developer_id: developerId, family: model.family || null,
    description: model.description || null,
    release_date: model.release_date || null,
    date_precision: model.release_date ? (model.release_date.length === 7 ? 'month' : 'day') : null,
    open_weights: typeof model.open_weights === 'boolean' ? model.open_weights : null,
    license: model.license || null,
    ...namedParameters(model.name, id),
    context_window: model.limit?.context > 0 ? model.limit.context : null,
    modalities: { input: model.modalities?.input || [], output: model.modalities?.output || [] },
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : null,
    tool_call: typeof model.tool_call === 'boolean' ? model.tool_call : null,
    source_url: sourceUrl, source_type: 'catalog',
    sources: [
      { label: 'Models.dev record', url: sourceUrl, type: 'catalog' },
      ...(model.links || []).map(link => ({ label: link.label || 'Source', url: link.url, type: link.type || 'docs' })),
      ...(model.weights || []).map(link => ({ label: link.label || 'Model weights', url: link.url, type: 'weights' })),
    ],
    aliases: [], first_seen: retrievedAt, last_seen: retrievedAt, upstream_present: true,
  };
}

export function catalogTimestamps(retrievedAt, reviewedAt = null) {
  const timestamp = (value, label) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`Invalid ${label} timestamp`);
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf()) || !validDate(value.slice(0, 10))) throw new Error(`Invalid ${label} timestamp`);
    return date.toISOString();
  };
  const source = timestamp(retrievedAt, 'retrieved_at');
  const review = reviewedAt === null ? null : timestamp(reviewedAt, 'reviewed_at');
  return { source, review, updated: review && review > source ? review : source };
}

function confirmedRelease(record) {
  return record?.source_type === 'primary' && validDate(record.release_date) &&
    /^https:\/\//.test(record.source_url || '') && record.sources?.some(source => /^https:\/\//.test(source.url || ''));
}

export function mergeCatalog({ upstream, previous = [], historical = [], corrections = {}, retrievedAt, asOf, reviewedAt = null }) {
  const timestamps = catalogTimestamps(retrievedAt, reviewedAt);
  const sourceAsOf = [asOf || timestamps.source.slice(0, 10), timestamps.source.slice(0, 10)].sort()[0];
  const researchAsOf = timestamps.review?.slice(0, 10) || sourceAsOf;
  const publicationAsOf = researchAsOf > sourceAsOf ? researchAsOf : sourceAsOf;
  const reviewedIds = new Set(timestamps.review ? previous.filter(confirmedRelease).map(model => model.id) : []);
  const map = new Map(previous.map(model => [model.id, { ...model, upstream_present: false }]));
  let excludedTypes = 0;
  let future = 0;
  for (const [id, source] of Object.entries(upstream)) {
    if (!eligibleModel(source)) { excludedTypes++; map.delete(id); continue; }
    const model = normalize(id, source, retrievedAt);
    const correction = corrections.overrides?.[id];
    const confirmed = timestamps.review && confirmedRelease(correction) && !isFuture(correction.release_date, researchAsOf);
    if (isFuture(model.release_date, sourceAsOf) && !confirmed) { future++; map.delete(id); continue; }
    const old = map.get(id);
    const observedAt = isFuture(model.release_date, sourceAsOf) && confirmed ? timestamps.review : retrievedAt;
    map.set(id, { ...model, first_seen: old?.first_seen || observedAt, last_seen: observedAt });
  }
  for (const item of historical) {
    const old = map.get(item.id);
    const confirmed = timestamps.review && confirmedRelease(item);
    if (confirmed) reviewedIds.add(item.id);
    const observedAt = confirmed ? timestamps.review : retrievedAt;
    const defaults = normalize(item.id, { name: item.name, modalities: item.modalities || { input: ['text'], output: ['text'] } }, observedAt);
    map.set(item.id, {
      ...defaults, ...old, ...item, slug: slugFor(item.id),
      date_precision: item.release_date ? (item.release_date.length === 7 ? 'month' : 'day') : null,
      first_seen: old?.first_seen || observedAt, last_seen: old?.last_seen || observedAt,
      upstream_present: old?.upstream_present || false,
    });
  }
  for (const [id, fields] of Object.entries(corrections.overrides || {})) {
    if (!map.has(id)) throw new Error(`Correction targets missing model: ${id}`);
    const model = map.get(id);
    if (timestamps.review && confirmedRelease(fields)) reviewedIds.add(id);
    map.set(id, { ...model, ...fields, sources: [...(fields.sources || []), ...model.sources] });
  }
  for (const [alias, target] of Object.entries(corrections.aliases || {})) {
    if (Object.hasOwn(corrections.aliases, target)) throw new Error(`Alias chains must be flattened: ${alias}`);
    if (!map.has(target)) throw new Error(`Alias target missing: ${target}`);
    if (alias === target) throw new Error(`Self alias: ${alias}`);
    const targetModel = map.get(target);
    targetModel.aliases = [...new Set([...targetModel.aliases, alias])].sort();
    if (corrections.alias_sources?.[alias]) {
      targetModel.alias_sources = { ...(targetModel.alias_sources || {}), [alias]: corrections.alias_sources[alias] };
      targetModel.sources.push({ label: 'Alias documentation', url: corrections.alias_sources[alias].url, type: 'docs' });
    }
    map.delete(alias);
  }
  let excludedMutableAliases = 0;
  let excludedServiceTiers = 0;
  for (const [id, exclusion] of Object.entries(corrections.exclude || {})) {
    if (exclusion.category === 'non_language_model') {
      if (map.has(id)) excludedTypes++;
    } else if (exclusion.category === 'service_tier') excludedServiceTiers++;
    else excludedMutableAliases++;
    map.delete(id);
  }
  for (const model of map.values()) model.sources = [...new Map(model.sources.map(source => [source.url, source])).values()];
  const models = [...map.values()].filter(model => !isFuture(model.release_date, reviewedIds.has(model.id) ? researchAsOf : sourceAsOf))
    .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || '') || a.id.localeCompare(b.id));
  validateModels(models, publicationAsOf);
  return {
    models,
    coverage: {
      source_records: Object.keys(upstream).length,
      tracked_models: models.length,
      upstream_models: models.filter(model => model.upstream_present).length,
      historical_additions: historical.length,
      retained_models: models.filter(model => !model.upstream_present && !historical.some(item => item.id === model.id)).length,
      excluded_non_language_models: excludedTypes,
      excluded_future_releases: future,
      merged_aliases: Object.keys(corrections.aliases || {}).length,
      excluded_mutable_aliases: excludedMutableAliases,
      excluded_service_tiers: excludedServiceTiers,
      date_basis: 'First public release, as recorded by sources. Month precision is preserved.',
      limitation: 'A growing source-backed catalog, not an exhaustive census. Coverage depends on upstream and contributed records. Model variants count separately; explicitly identified aliases are merged.',
    },
  };
}

export function validateModels(models, asOf = '9999-12-31') {
  const ids = new Set();
  const slugs = new Set();
  for (const model of models) {
    if (!model.id || !model.name || !model.developer || !model.developer_id) throw new Error('Model identity is incomplete');
    if (ids.has(model.id) || slugs.has(model.slug)) throw new Error(`Duplicate ID/slug: ${model.id}`);
    ids.add(model.id); slugs.add(model.slug);
    if (model.slug !== slugFor(model.id)) throw new Error(`Invalid slug: ${model.id}`);
    if (model.release_date && (!validDate(model.release_date) || isFuture(model.release_date, asOf))) throw new Error(`Invalid/future date: ${model.id}`);
    if (model.release_date && model.date_precision !== (model.release_date.length === 7 ? 'month' : 'day')) throw new Error(`Date precision mismatch: ${model.id}`);
    for (const key of ['parameters_b', 'active_parameters_b', 'context_window']) {
      if (model[key] !== null && (!Number.isFinite(model[key]) || model[key] <= 0)) throw new Error(`Invalid ${key}: ${model.id}`);
    }
    if (model.active_parameters_b && model.parameters_b && model.active_parameters_b > model.parameters_b) throw new Error(`Active size exceeds total: ${model.id}`);
    for (const key of ['parameter_components_b', 'active_parameters_by_phase_b']) {
      if (model[key] === undefined) continue;
      if (!model[key] || Array.isArray(model[key]) || typeof model[key] !== 'object' || !Object.keys(model[key]).length) throw new Error(`Invalid ${key}: ${model.id}`);
      for (const [label, value] of Object.entries(model[key])) {
        if (!/^[a-z][a-z0-9_]*$/.test(label) || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${key}.${label}: ${model.id}`);
      }
    }
    if (model.parameters_scope && model.parameter_components_b?.[model.parameters_scope] !== model.parameters_b) throw new Error(`Parameter scope disagrees with component count: ${model.id}`);
    if (model.active_parameters_scope !== undefined) {
      if (typeof model.active_parameters_scope !== 'string' || !/^[a-z][a-z0-9_]*$/.test(model.active_parameters_scope) || !model.active_parameters_b) throw new Error(`Invalid active parameter scope: ${model.id}`);
      if (model.active_parameters_by_phase_b && model.active_parameters_by_phase_b[model.active_parameters_scope] !== model.active_parameters_b) throw new Error(`Active parameter scope disagrees with phase count: ${model.id}`);
    }
    if (![true, false, null].includes(model.open_weights)) throw new Error(`Invalid openness: ${model.id}`);
    if (!Array.isArray(model.modalities?.input) || !Array.isArray(model.modalities?.output) || !model.modalities.output.includes('text')) throw new Error(`Not a language model: ${model.id}`);
    for (const url of [model.source_url, ...model.sources.map(source => source.url)]) {
      if (!/^https:\/\//.test(url)) throw new Error(`Unsafe source URL: ${model.id}`);
    }
  }
}

export function statistics(models) {
  const months = new Map();
  const developers = new Map();
  for (const model of models) {
    const month = model.release_date?.slice(0, 7) || 'unknown';
    const bucket = months.get(month) || { month, total: 0, open: 0, closed: 0, unknown: 0 };
    bucket.total++;
    bucket[model.open_weights === true ? 'open' : model.open_weights === false ? 'closed' : 'unknown']++;
    months.set(month, bucket);
    const developer = developers.get(model.developer_id) || { id: model.developer_id, name: model.developer, count: 0 };
    developer.count++;
    developers.set(model.developer_id, developer);
  }
  const dates = models.map(model => model.release_date).filter(Boolean).sort();
  return {
    total_models: models.length,
    developers: developers.size,
    open_weights: models.filter(model => model.open_weights === true).length,
    closed_weights: models.filter(model => model.open_weights === false).length,
    unknown_openness: models.filter(model => model.open_weights === null).length,
    known_parameters: models.filter(model => model.parameters_b !== null).length,
    unknown_parameters: models.filter(model => model.parameters_b === null).length,
    unknown_release_dates: models.filter(model => model.release_date === null).length,
    earliest_release: dates[0] || null,
    latest_release: dates.at(-1) || null,
    by_month: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    by_developer: [...developers.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function csv(models) {
  const columns = ['id', 'name', 'developer', 'family', 'release_date', 'date_precision', 'open_weights', 'license', 'parameters_b', 'active_parameters_b', 'parameters_source', 'parameters_scope', 'active_parameters_scope', 'parameter_components_b', 'active_parameters_by_phase_b', 'architecture', 'context_window', 'reasoning', 'tool_call', 'source_url'];
  const cell = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[-=+@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns.map(cell).join(','), ...models.map(model => columns.map(key => cell(model[key])).join(','))].join('\r\n') + '\r\n';
}
