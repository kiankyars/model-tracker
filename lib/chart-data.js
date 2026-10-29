import { isRecordedRelease } from './model-data.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COUNTS = ['total', 'open', 'closed', 'unknown'];

function monthIndex(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)) return null;
  if (value.length === 10) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  }
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthKey(index) {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}

function increment(bucket, model) {
  bucket.total++;
  bucket[model.open_weights === true ? 'open' : model.open_weights === false ? 'closed' : 'unknown']++;
}

export function timeBuckets(models, { from = '', to = '', interval = 'month' } = {}) {
  const width = { month: 1, quarter: 3, year: 12 }[interval];
  if (!width) throw new RangeError(`Unsupported chart interval: ${interval}`);
  const dated = models.filter(isRecordedRelease).map(model => ({ model, month: monthIndex(model.release_date) })).filter(item => item.month !== null);
  const first = from ? monthIndex(from) : dated.length ? Math.min(...dated.map(item => item.month)) : null;
  const last = to ? monthIndex(to) : dated.length ? Math.max(...dated.map(item => item.month)) : null;
  if (first === null || last === null || first > last) return [];
  const buckets = new Map();
  for (let start = Math.floor(first / width) * width; start <= last; start += width) {
    const year = Math.floor(start / 12);
    const month = start % 12;
    const key = interval === 'year' ? String(year) : interval === 'quarter' ? `${year}-Q${Math.floor(month / 3) + 1}` : monthKey(start);
    const label = interval === 'year' ? String(year) : interval === 'quarter' ? `Q${Math.floor(month / 3) + 1} ${year}` : `${MONTHS[month]} ${year}`;
    buckets.set(start, { key, label, from: monthKey(Math.max(first, start)), to: monthKey(Math.min(last, start + width - 1)), total: 0, open: 0, closed: 0, unknown: 0 });
  }
  for (const { model, month } of dated) {
    if (month < first || month > last) continue;
    increment(buckets.get(Math.floor(month / width) * width), model);
  }
  return [...buckets.values()];
}

export function cumulativeBuckets(buckets) {
  const counts = { total: 0, open: 0, closed: 0, unknown: 0 };
  return buckets.map(bucket => {
    for (const key of COUNTS) counts[key] += bucket[key];
    return { ...bucket, ...counts };
  });
}

export function developerBuckets(models) {
  const buckets = new Map();
  for (const model of models.filter(isRecordedRelease)) {
    if (!buckets.has(model.developer_id)) buckets.set(model.developer_id, { id: model.developer_id, name: model.developer, total: 0, open: 0, closed: 0, unknown: 0 });
    increment(buckets.get(model.developer_id), model);
  }
  return [...buckets.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function sizePoints(models, { metric = 'total' } = {}) {
  const field = { total: 'parameters_b', active: 'active_parameters_b' }[metric];
  if (!field) throw new RangeError(`Unsupported parameter metric: ${metric}`);
  return models.filter(model => isRecordedRelease(model) && monthIndex(model.release_date) !== null && Number.isFinite(model[field]) && model[field] > 0)
    .map(model => ({ id: model.id, name: model.name, date: model.release_date, date_precision: model.date_precision || (model.release_date.length === 7 ? 'month' : 'day'), value: model[field], open_weights: model.open_weights, model }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value || a.id.localeCompare(b.id));
}
