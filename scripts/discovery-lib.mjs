const DAY = 86_400_000;
export const QUEUE_STATUSES = new Set(['pending', 'tracked', 'duplicate', 'excluded']);
const TEXT_TASKS = new Set(['text-generation', 'text2text-generation', 'image-text-to-text', 'any-to-any', 'multimodal-dialogue', 'audio-text-to-text', 'video-text-to-text', 'image-to-text', 'visual-question-answering']);

export function isoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function nextLink(value, base) {
  const match = value?.match(/<([^>]+)>\s*;\s*rel=["']?next["']?/i);
  return match ? new URL(match[1], base).href : null;
}

function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Expected a public HTTPS URL');
  for (const key of url.searchParams.keys()) {
    if (/token|api[_-]?key|authorization|secret/i.test(key)) throw new Error('Credentials must not appear in source URLs');
  }
  return url.href;
}

export async function request(url, { fetcher = fetch, headers = {}, format = 'json' } = {}) {
  publicUrl(url);
  const response = await fetcher(url, { headers: { 'User-Agent': 'model-tracker-discovery/1.0', ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = format === 'text' ? await response.text() : await response.json();
  return { body, headers: response.headers };
}

/** Page limits are work budgets, never proof that a source has been exhausted. */
export async function enumeratePages({ startUrl, readPage, maxPages = 20, resume = null }) {
  let url = resume?.next_url || startUrl;
  const origin = new URL(startUrl).origin;
  const observations = [];
  const seen = new Set();
  const seenKeys = new Set();
  const pages = [];
  const priorCount = resume?.items_seen || 0;
  let itemsSeen = priorCount;
  let declaredTotal = null;
  let oldest = null;
  while (url) {
    if (maxPages && pages.length >= maxPages) {
      return finish('truncated', 'Page budget reached; continue from cursor.', url);
    }
    if (seen.has(url)) return finish('failed', 'Pagination repeated a URL.', url);
    try {
      publicUrl(url);
      if (new URL(url).origin !== origin) throw new Error('Pagination changed source origin');
      seen.add(url);
      const page = await readPage(url);
      if (!Array.isArray(page.items)) throw new Error('Invalid page: items must be an array');
      if (page.total !== undefined && page.total !== null) declaredTotal = page.total;
      itemsSeen += page.examined ?? page.items.length;
      for (const item of page.items) {
        if (!item?.key) throw new Error('Invalid page: candidate key is missing');
        if (!seenKeys.has(item.key)) { observations.push(item); seenKeys.add(item.key); }
      }
      if (page.oldest) oldest = !oldest || page.oldest < oldest ? page.oldest : oldest;
      pages.push({ url, items: page.items.length, examined: page.examined ?? page.items.length });
      if (page.blocked) return finish('truncated', page.blocked, page.resumable === false ? null : page.next || null);
      if (page.boundary) return finish('complete', 'Reached requested date boundary.', null);
      if (!page.next) {
        if (page.expectTotal && declaredTotal !== null && itemsSeen < declaredTotal) {
          return finish('failed', `Source ended after ${itemsSeen} of ${declaredTotal} listed entries.`, null);
        }
        return finish('complete', 'Source pagination exhausted.', null);
      }
      url = new URL(page.next, url).href;
    } catch (error) {
      return finish('failed', error.message, url);
    }
  }
  return finish('complete', 'Source pagination exhausted.', null);

  function finish(status, reason, nextUrl) {
    return {
      status, reason, observations, pages, items_seen: itemsSeen,
      total_reported: declaredTotal, oldest_seen: oldest,
      cursor: nextUrl ? { next_url: nextUrl, items_seen: itemsSeen } : null,
    };
  }
}

export function dateWindow(items, { since, through, field, sorted = false }) {
  const from = new Date(since).valueOf();
  const end = new Date(through).valueOf();
  if (!Number.isFinite(from) || !Number.isFinite(end) || from > end) throw new Error('Invalid discovery window');
  const stamps = items.map(item => isoDate(item[field]));
  const known = stamps.filter(Boolean);
  const descending = known.every((date, index) => !index || date <= known[index - 1]);
  return {
    items: items.filter((_, index) => !stamps[index] || (new Date(stamps[index]).valueOf() >= from && new Date(stamps[index]).valueOf() <= end)),
    // Unknown or unsorted timestamps cannot establish a safe stopping point.
    boundary: sorted && items.length > 0 && known.length === items.length && descending && stamps.at(-1) < since,
    oldest: known.length ? [...known].sort()[0] : null,
  };
}

export function modelObservation(sourceId, key, name, url, extra = {}) {
  return { source_id: sourceId, key, name, url, kind: 'model', source_date: null, date_kind: null, ...extra };
}

export async function collectHuggingFace(source, options) {
  const streams = [];
  for (const task of source.tasks) {
    for (const sort of ['createdAt', 'lastModified']) {
      const streamId = `${task}:${sort}`;
      if (options.resuming && !options.resume?.[streamId]) continue;
      const url = new URL(source.url);
      url.search = new URLSearchParams({ pipeline_tag: task, sort, direction: '-1', limit: String(options.pageSize || 100), full: 'true' });
      const result = await enumeratePages({ startUrl: url.href, maxPages: options.maxPages, resume: options.resume?.[streamId], readPage: async pageUrl => {
        const { body, headers } = await request(pageUrl, options);
        if (!Array.isArray(body) || body.some(row => typeof row.id !== 'string')) throw new Error('Unexpected Hugging Face schema');
        const window = dateWindow(body, { ...options, field: sort, sorted: true });
        return {
          items: window.items.map(row => modelObservation(source.id, row.id, row.id.split('/').at(-1), `https://huggingface.co/${row.id}`, {
            source_date: isoDate(row[sort]), date_kind: sort === 'createdAt' ? 'repository_created' : 'repository_updated',
            publisher: row.author || row.id.split('/')[0], tasks: [row.pipeline_tag || task],
            revision: row.sha || null,
            lineage_tags: (row.tags || []).filter(tag => /^base_model:/.test(tag)),
            review_hint: (row.tags || []).some(tag => /base_model:(quantized|adapter|finetune|merge):/.test(tag)) ? 'Derived checkpoint: review scope and exact base identity.' : null,
          })),
          examined: body.length, next: nextLink(headers.get('link'), pageUrl), boundary: window.boundary, oldest: window.oldest,
        };
      }});
      streams.push({ stream_id: streamId, ...result });
    }
  }
  return streams;
}

export async function collectOpenRouter(source, options) {
  return [{ stream_id: 'catalog', ...await enumeratePages({ startUrl: source.url, maxPages: options.maxPages, resume: options.resume?.catalog, readPage: async url => {
    const { body } = await request(url, options);
    if (!Array.isArray(body.data) || body.data.some(row => typeof row.id !== 'string')) throw new Error('Unexpected OpenRouter schema');
    const rows = body.data.filter(row => !row.architecture?.output_modalities || row.architecture.output_modalities.includes('text'));
    return {
      items: rows.map(row => modelObservation(source.id, row.id, row.name || row.id, `https://openrouter.ai/${row.id}`, {
        source_date: isoDate(row.created), date_kind: 'provider_listing', canonical_id: row.id,
        identity_urls: row.hugging_face_id ? [`https://huggingface.co/${row.hugging_face_id}`] : [],
      })),
      examined: body.data.length, total: body.total_count,
      // Compare the upstream total to examined rows, including non-text entries.
      next: body.links?.next || nextLink((body.links || {}).header, url), expectTotal: true,
      blocked: body.links === undefined && body.total_count > body.data.length ? 'Source reports more rows without a pagination link.' : null,
    };
  }}) }];
}

export function parseModelsDev(body, sourceId) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || body.data || !Object.keys(body).length) throw new Error('Unexpected Models.dev canonical schema');
  return Object.entries(body).map(([key, row]) => {
    if (typeof row !== 'object' || Array.isArray(row) || typeof row.name !== 'string' || !key.includes('/')) throw new Error('Unexpected Models.dev model record');
    return modelObservation(sourceId, key, row.name, `https://models.dev/?search=${encodeURIComponent(key)}`, {
      canonical_id: key, source_date: isoDate(row.release_date), date_kind: 'catalog_claimed_release',
      identity_urls: typeof row.weights === 'string' ? [row.weights] : [],
    });
  });
}

export async function collectModelsDev(source, options) {
  const attempts = [];
  try {
    const { body } = await request(source.url, options);
    const observations = parseModelsDev(body, source.id);
    return [{ stream_id: 'catalog', status: 'complete', reason: 'Canonical catalog retrieved.', observations, pages: [{ url: source.url, items: observations.length }], attempts, cursor: null }];
  } catch (error) { attempts.push({ url: source.url, status: 'failed', reason: error.message }); }
  try {
    const { body } = await request(source.fallback_url, options);
    if (!Array.isArray(body.tree) || typeof body.truncated !== 'boolean') throw new Error('Unexpected GitHub tree schema');
    const observations = body.tree.filter(row => row.type === 'blob' && /^models\/[^/]+\/[^/]+\.toml$/.test(row.path)).map(row => {
      const id = row.path.replace(/^models\//, '').replace(/\.toml$/, '');
      return modelObservation(source.id, id, id.split('/').at(-1), `https://github.com/anomalyco/models.dev/blob/${body.sha}/${row.path}`, { canonical_id: id, revision: row.sha, review_hint: 'GitHub inventory only; fetch canonical TOML for metadata and verify original release sources.' });
    });
    if (!observations.length) throw new Error('GitHub tree contained no canonical model files');
    return [{ stream_id: 'catalog', status: body.truncated ? 'truncated' : 'complete', reason: body.truncated ? 'GitHub truncated its tree; enumerate model directories before claiming a full inventory.' : 'GitHub canonical model inventory retrieved; metadata not imported.', observations, pages: [{ url: source.fallback_url, items: observations.length }], attempts, cursor: null }];
  } catch (error) {
    attempts.push({ url: source.fallback_url, status: 'failed', reason: error.message });
    return [{ stream_id: 'catalog', status: 'failed', reason: 'Canonical endpoint and GitHub fallback failed.', observations: [], pages: [], attempts, cursor: null }];
  }
}

export async function collectModelScope(source, options) {
  const start = new URL(source.url);
  const pageSize = Math.min(options.pageSize || 50, 50);
  const resume = options.resume?.updated ? structuredClone(options.resume.updated) : null;
  if (resume) {
    const url = new URL(resume.next_url);
    if (Number(url.searchParams.get('page_size')) > 50) {
      // Revisit the same offset with the accepted page size when resuming older reports.
      const offset = (Number(url.searchParams.get('page_number')) - 1) * Number(url.searchParams.get('page_size'));
      url.searchParams.set('page_number', Math.floor(offset / pageSize) + 1);
      url.searchParams.set('page_size', pageSize);
      resume.next_url = url.href;
    }
  }
  start.search = new URLSearchParams({ sort: 'last_modified', page_number: '1', page_size: String(pageSize) });
  return [{ stream_id: 'updated', ...await enumeratePages({ startUrl: start.href, maxPages: options.maxPages, resume, readPage: async url => {
    const { body } = await request(url, options);
    if (body.success !== true || !Array.isArray(body.data?.models) || body.data.models.some(row => typeof row.id !== 'string')) throw new Error('Unexpected ModelScope schema');
    const { models, total_count: total, page_number: page, page_size: size } = body.data;
    if (!Number.isInteger(page) || !Number.isInteger(size) || !Number.isInteger(total)) throw new Error('Unexpected ModelScope pagination');
    const window = dateWindow(models, { ...options, field: 'last_modified', sorted: true });
    const next = new URL(url);
    next.searchParams.set('page_number', page + 1);
    const hasMore = page * size < total;
    // The public API ignores task filters in live probes, so check returned tags locally.
    const relevant = window.items.filter(row => !row.tasks?.length || row.tasks.some(task => TEXT_TASKS.has(task)));
    return {
      items: relevant.map(row => modelObservation(source.id, row.id, row.display_name || row.id, `https://modelscope.cn/models/${row.id}`, {
        source_date: isoDate(row.last_modified), date_kind: 'repository_updated', publisher: row.id.split('/')[0], tasks: row.tasks || [],
        review_hint: !row.tasks?.length ? 'No task metadata; verify language-model scope.' : null,
      })),
      resumable: false, examined: models.length, total, next: hasMore ? next.href : null, boundary: window.boundary, oldest: window.oldest,
      blocked: !window.boundary && hasMore && (page + 1) * size > 3000 ? 'ModelScope public API exposes at most the first 3,000 results. Split by owner/search or review the site; this window is incomplete.' : null,
    };
  }}) }];
}

function xmlText(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]).trim();
}

export function parseFeed(xml, sourceId) {
  if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error('Expected RSS or Atom XML');
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return entries.map(([, , item]) => {
    const field = name => item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1];
    const url = xmlText(field('link')) || item.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    if (!url || !field('title')) throw new Error('Feed entry missing title or URL');
    return modelObservation(sourceId, xmlText(url), xmlText(field('title')), xmlText(url), {
      kind: 'article', source_date: isoDate(xmlText(field('pubDate') || field('published') || field('updated'))), date_kind: 'article_published',
      review_hint: 'Publisher article; verify that it announces an in-scope model.',
    });
  });
}

export async function collectFeed(source, options) {
  try {
    const { body } = await request(source.url, { ...options, format: 'text' });
    const entries = parseFeed(body, source.id);
    const window = dateWindow(entries, { ...options, field: 'source_date' });
    const complete = window.oldest && window.oldest <= options.since;
    return [{ stream_id: 'feed', status: complete ? 'complete' : 'partial', reason: complete ? 'Feed reaches the requested start; publisher feeds may omit or remove posts.' : 'Feed does not reach the requested start. Review the publisher archive for earlier entries.', observations: window.items, pages: [{ url: source.url, items: window.items.length, examined: entries.length }], oldest_seen: window.oldest, cursor: null }];
  } catch (error) { return [{ stream_id: 'feed', status: 'failed', reason: error.message, observations: [], pages: [], cursor: null }]; }
}

export async function collectArtificialAnalysis(source, options) {
  const key = options.env?.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!key) return [{ stream_id: 'catalog', status: 'needs_credentials', reason: 'Set ARTIFICIAL_ANALYSIS_API_KEY for the official API; otherwise review the public model list manually.', observations: [], pages: [], cursor: null }];
  try {
    const { body } = await request(source.url, { ...options, headers: { 'x-api-key': key } });
    if (!Array.isArray(body.data) || body.data.some(row => typeof row.id !== 'string')) throw new Error('Unexpected Artificial Analysis schema');
    const observations = body.data.map(row => modelObservation(source.id, row.id, row.name || row.id, `https://artificialanalysis.ai/models/${row.slug || row.id}`, { publisher: row.model_creator?.name || null }));
    return [{ stream_id: 'catalog', status: 'partial', reason: 'Official benchmark API retrieved. This API is a selective benchmark list, not an exhaustive release inventory.', observations, pages: [{ url: source.url, items: observations.length }], cursor: null }];
  } catch (error) { return [{ stream_id: 'catalog', status: 'failed', reason: error.message, observations: [], pages: [], cursor: null }]; }
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') {
      row.push(field); field = ''; closed = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; field = ''; closed = false;
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Malformed CSV quoting');
      field += char;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quoted field');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  const header = rows.shift();
  if (!header?.length || new Set(header).size !== header.length) throw new Error('Invalid CSV header');
  return rows.map(values => {
    if (values.length !== header.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(header.map((key, index) => [key, values[index]]));
  });
}

export async function collectEpoch(source, options) {
  try {
    const { body } = await request(source.url, { ...options, format: 'text' });
    const rows = parseCsv(body);
    if (!rows.length || ['Model', 'Organization', 'Publication date', 'Domain', 'Task', 'Link'].some(key => !(key in rows[0]))) throw new Error('Unexpected Epoch CSV schema');
    const relevant = rows.filter(row => /(^|,)Language(,|$)/i.test(row.Domain) || /language model|text generation|question answer|conversation|translation/i.test(row.Task));
    const issues = [];
    const observations = relevant.flatMap(row => {
      const name = row.Model || row.Reference?.trim();
      if (!row.Model) issues.push({ organization: row.Organization, reference: row.Reference || null, link: row.Link || null, reason: 'Model field is blank; retained under its reference title when available.' });
      if (!name) return [];
      const sourceLinks = (row.Link.match(/https?:\/\/[^\s,;]+/g) || []);
      const extra = {
        publisher: row.Organization || null, tasks: row.Task.split(',').map(value => value.trim()).filter(Boolean),
        identity_urls: sourceLinks,
        source_metadata: { model_name: row.Model || null, organization: row.Organization, domain: row.Domain, task: row.Task, publication_date: row['Publication date'], base_model: row['Base model'] || null, accessibility: row['Model accessibility'] || null, reference: row.Reference || null, source_links: sourceLinks },
        review_hint: 'Epoch AI (CC BY 4.0) discovery lead. Publication date and accessibility are unverified catalog claims; inspect the linked original source.',
      };
      const key = `${row.Organization}/${name}`;
      const items = [modelObservation(source.id, key, name, source.documentation, { ...extra, source_date: isoDate(row['Publication date']), date_kind: 'catalog_publication' })];
      if (row['Last modified']) items.push(modelObservation(source.id, key, name, source.documentation, { ...extra, source_date: isoDate(row['Last modified']), date_kind: 'catalog_updated' }));
      return dateWindow(items, { ...options, field: 'source_date' }).items;
    });
    return [{ stream_id: 'catalog', status: issues.some(issue => !issue.reference) ? 'partial' : 'complete', reason: 'Entire public Epoch AI CSV parsed; language leads filtered by publication/update window. This curated dataset is not an exhaustive release census.', observations, pages: [{ url: source.url, items: observations.length, examined: rows.length }], items_seen: rows.length, language_rows: relevant.length, issues, cursor: null }];
  } catch (error) { return [{ stream_id: 'catalog', status: 'failed', reason: error.message, observations: [], pages: [], cursor: null }]; }
}

export async function collectSource(source, options) {
  const adapters = { huggingface: collectHuggingFace, modelsdev: collectModelsDev, openrouter: collectOpenRouter, modelscope: collectModelScope, rss: collectFeed, artificialanalysis: collectArtificialAnalysis, epoch: collectEpoch };
  if (!adapters[source.adapter]) return [{ stream_id: 'manual', status: 'manual_required', reason: source.note, observations: [], pages: [], cursor: null }];
  return adapters[source.adapter](source, options);
}

function identityUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'huggingface.co') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0] !== 'api') return `https://huggingface.co/${parts[0]}/${parts[1]}`.toLowerCase();
    }
    if (url.hostname === 'modelscope.cn') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'models' && parts.length >= 3) return `https://modelscope.cn/models/${parts[1]}/${parts[2]}`.toLowerCase();
    }
  } catch {}
  return null;
}

export function catalogIndex(catalog) {
  const ids = new Map(), urls = new Map();
  const add = (map, key, value) => map.set(key, map.has(key) && map.get(key) !== value ? null : value);
  for (const model of catalog) {
    add(ids, model.id, model.id);
    for (const alias of model.aliases || []) if (typeof alias === 'string' && alias.includes('/')) add(ids, alias, model.id);
    const names = new Set([model.id, ...(model.aliases || [])].map(id => id.split('/').at(-1).toLowerCase().replace(/[^a-z0-9]/g, '')));
    const linkedRepositories = (model.sources || []).map(source => source.url).filter(value => {
      const url = identityUrl(value);
      return url && names.has(url.split('/').at(-1).replace(/[^a-z0-9]/g, ''));
    });
    for (const value of [model.source_url, ...linkedRepositories]) {
      const url = identityUrl(value);
      if (url) add(urls, url, model.id);
    }
  }
  return { ids, urls };
}

export function matchCatalog(observation, index) {
  const matches = new Set();
  if (observation.canonical_id && index.ids.get(observation.canonical_id)) matches.add(index.ids.get(observation.canonical_id));
  for (const value of [observation.url, ...(observation.identity_urls || [])]) {
    const key = identityUrl(value);
    if (key && index.urls.get(key)) matches.add(index.urls.get(key));
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function metadataDisposition(observation) {
  if (observation.source_id !== 'huggingface' || !Array.isArray(observation.lineage_tags)) return null;
  const quantized = observation.lineage_tags.filter(tag => tag.startsWith('base_model:quantized:'));
  if (quantized.length) return { status: 'excluded', reason: `Publisher metadata identifies a quantized copy, not a newly trained model: ${quantized.join(', ')}.` };
  const publisherAliases = { thudm: 'zai-org', cohereforai: 'coherelabs', huggingfaceh4: 'huggingfacetb', bigcode: 'huggingfacetb' };
  const publisher = value => publisherAliases[value.toLowerCase()] || value.toLowerCase();
  const own = publisher((observation.publisher || observation.key.split('/')[0]));
  const relations = observation.lineage_tags.map(tag => tag.match(/^base_model:(finetune|adapter|merge):([^/]+\/[^:]+)$/)).filter(Boolean);
  const foreign = relations.filter(match => publisher(match[2].split('/')[0]) !== own);
  // Multiple components can include an external vision/audio encoder. Leave those for review.
  if (foreign.length && (relations.every(match => match[1] === 'merge') || (relations.length === 1 && ['text-generation', 'text2text-generation'].some(task => observation.tasks?.includes(task))))) {
    return { status: 'excluded', reason: `Publisher metadata identifies a third-party derivative of an external pretrained checkpoint: ${foreign.map(match => match[0]).join(', ')}.` };
  }
  return null;
}

export function reconcileCatalogCandidates(queue, catalog, corrections, now) {
  const result = structuredClone(queue);
  const index = catalogIndex(catalog);
  for (const entry of result.candidates) {
    const exclusion = corrections.exclude?.[entry.model_id];
    if (exclusion) {
      Object.assign(entry, { status: 'excluded', reason: exclusion.reason, last_reviewed: now, next_check: null });
      delete entry.review_method;
      continue;
    }
    if (entry.model_id) {
      const canonical = index.ids.get(entry.model_id);
      if (canonical) entry.model_id = canonical;
      else if (['tracked', 'duplicate'].includes(entry.status)) Object.assign(entry, { status: 'pending', reason: 'Previously linked catalog identity is absent; review its replacement or exclusion.', next_check: now });
      if (entry.status === 'tracked' && /^Exact catalog ID/.test(entry.reason || '') && !(entry.sources || []).some(source => matchCatalog({ canonical_id: source.key, url: source.url }, index) === entry.model_id)) {
        Object.assign(entry, { status: 'pending', model_id: null, reason: 'The linked repository does not establish this exact checkpoint identity; inspect whether it cites a base model or a distinct variant.', next_check: now });
      }
      continue;
    }
    if (entry.status !== 'pending' && entry.review_method !== 'publisher_metadata') continue;
    const matches = new Set((entry.sources || []).map(source => matchCatalog({ canonical_id: source.key, url: source.url }, index)).filter(Boolean));
    if (matches.size === 1) {
      Object.assign(entry, { status: 'tracked', model_id: [...matches][0], reason: 'Exact catalog ID, curated alias or primary weight-repository match.', last_reviewed: now, next_check: null });
      delete entry.review_method;
    }
  }
  return { ...result, updated_at: now };
}

export function mergeCandidates(queue, observations, catalog, now, corrections = {}) {
  const index = catalogIndex(catalog);
  const candidates = new Map((queue.candidates || []).map(item => [item.id, structuredClone(item)]));
  for (const observation of observations) {
    const id = `${observation.source_id}:${observation.key}`;
    const existing = candidates.get(id);
    const modelId = matchCatalog(observation, index);
    const evidence = {
      source_id: observation.source_id, key: observation.key, url: observation.url,
      first_seen: existing?.sources?.find(item => item.source_id === observation.source_id && item.key === observation.key && item.date_kind === (observation.date_kind || null))?.first_seen || now,
      last_seen: now, source_date: observation.source_date || null, date_kind: observation.date_kind || null,
      ...(observation.revision ? { revision: observation.revision } : {}),
      ...(Array.isArray(observation.lineage_tags) ? { lineage_tags: observation.lineage_tags } : {}),
      ...(observation.source_metadata ? { metadata: observation.source_metadata } : {}),
    };
    const previousEvidence = existing?.sources?.find(item => item.source_id === evidence.source_id && item.key === evidence.key && item.date_kind === evidence.date_kind);
    const changed = previousEvidence && ((evidence.revision && previousEvidence.revision && evidence.revision !== previousEvidence.revision) || evidence.source_date !== previousEvidence.source_date);
    const sources = [...(existing?.sources || []).filter(item => item.source_id !== evidence.source_id || item.key !== evidence.key || item.date_kind !== evidence.date_kind), evidence];
    const entry = existing || {
      id, name: observation.name, kind: observation.kind || 'model', status: modelId ? 'tracked' : 'pending',
      model_id: modelId, reason: modelId ? 'Exact catalog ID or weight-repository match.' : 'Awaiting primary-source review.',
      first_seen: now, last_reviewed: null, next_check: modelId ? null : now, sources: [],
    };
    // Reviewed dispositions survive fresh observations. A newly cataloged pending item may close automatically.
    if (entry.status === 'tracked' && changed) {
      entry.status = 'pending'; entry.reason = 'Source metadata changed; review the existing model for corrections.'; entry.next_check = now;
    }
    if (entry.status === 'pending' && modelId && !entry.model_id) {
      entry.status = 'tracked'; entry.model_id = modelId; entry.reason = 'Exact catalog ID or weight-repository match.'; entry.next_check = null;
    }
    if (!entry.model_id && (!entry.last_reviewed || entry.review_method === 'publisher_metadata')) {
      const disposition = metadataDisposition(observation);
      if (disposition && (entry.status === 'pending' || entry.review_method === 'publisher_metadata')) {
        Object.assign(entry, disposition, { last_reviewed: now, next_check: null, review_method: 'publisher_metadata' });
      } else if (entry.review_method === 'publisher_metadata' && Array.isArray(observation.lineage_tags)) {
        Object.assign(entry, { status: 'pending', reason: 'Publisher lineage metadata no longer supports the automatic exclusion; review the checkpoint.', next_check: now });
        delete entry.review_method;
      }
    }
    candidates.set(id, { ...entry, name: observation.name || entry.name, last_seen: now, sources,
      ...(observation.publisher ? { publisher: observation.publisher } : {}),
      ...(observation.review_hint ? { review_hint: observation.review_hint } : {}),
      ...(observation.tasks?.length ? { tasks: observation.tasks } : {}),
    });
  }
  // An unresolved lead stays due even when it falls out of every upstream feed.
  for (const entry of candidates.values()) {
    if (!QUEUE_STATUSES.has(entry.status) || !entry.reason) throw new Error(`Invalid candidate disposition: ${entry.id}`);
  }
  return reconcileCatalogCandidates({ schema_version: '1.0', updated_at: now, candidates: [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id)) }, catalog, corrections, now);
}

export function dueCandidates(queue, now) {
  return queue.candidates.filter(item => item.status === 'pending' && (!item.next_check || item.next_check <= now)).map(item => item.id);
}

export function reviewCandidate(queue, id, { status, reason, model_id = null, next_check = null, reviewed_at }) {
  if (!QUEUE_STATUSES.has(status) || !reason?.trim() || !isoDate(reviewed_at)) throw new Error('A valid status, reason and review time are required');
  if (status === 'tracked' && !model_id) throw new Error('Tracked candidates need a catalog model ID');
  if (status === 'duplicate' && !model_id) throw new Error('Duplicates need the canonical model ID');
  if (next_check && !isoDate(next_check)) throw new Error('Invalid next-check date');
  const item = queue.candidates.find(candidate => candidate.id === id);
  if (!item) throw new Error('Candidate not found');
  delete item.review_method;
  Object.assign(item, { status, reason: reason.trim(), model_id, last_reviewed: isoDate(reviewed_at), next_check: status === 'pending' ? isoDate(next_check) || new Date(new Date(reviewed_at).valueOf() + DAY).toISOString() : null });
  queue.updated_at = isoDate(reviewed_at);
  return queue;
}

export function seedFromReports(queue, reports, catalog, now) {
  const items = new Map(queue.candidates.map(item => [item.id, structuredClone(item)]));
  const models = new Map(catalog.map(model => [model.id, model]));
  for (const report of [...reports].sort((a, b) => (a.research_date || '').localeCompare(b.research_date || ''))) {
    const reviewed = isoDate(report.completed_at || report.research_date) || now;
    for (const [field, status] of [['unresolved_candidates', 'pending'], ['excluded_candidates', 'excluded']]) {
      for (const lead of report[field] || []) {
        const model = models.get(lead.id);
        const name = lead.candidate || lead.name || model?.name || lead.id;
        if (!name) throw new Error('Research report contains an unnamed candidate');
        const id = `research:${lead.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        const previous = items.get(id);
        if (previous?.last_reviewed && previous.last_reviewed >= reviewed) continue;
        const urls = [...new Set([...(previous?.sources || []).map(source => source.url), ...(lead.sources || []).map(source => typeof source === 'string' ? source : source.url), ...(model?.sources || []).map(source => source.url)].filter(Boolean))];
        items.set(id, {
          id, name, kind: 'model', status, model_id: model?.id || previous?.model_id || null,
          reason: lead.uncertainty || lead.reason, first_seen: previous?.first_seen || reviewed,
          last_seen: reviewed, last_reviewed: reviewed, next_check: status === 'pending' ? now : null,
          sources: urls.map(url => ({ source_id: 'manual-research', key: url, url, first_seen: previous?.sources?.find(source => source.url === url)?.first_seen || reviewed, last_seen: reviewed, source_date: null, date_kind: null })),
        });
      }
    }
  }
  return { ...queue, candidates: [...items.values()] };
}
