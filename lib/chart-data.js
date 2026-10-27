const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

export function timeBuckets(models, { from = '', to = '', interval = 'month' } = {}) {
  const width = { month: 1, quarter: 3, year: 12 }[interval];
  if (!width) throw new RangeError(`Unsupported chart interval: ${interval}`);
  const dated = models.map(model => monthIndex(model.release_date)).filter(month => month !== null);
  const first = from ? monthIndex(from) : dated.length ? Math.min(...dated) : null;
  const last = to ? monthIndex(to) : dated.length ? Math.max(...dated) : null;
  if (first === null || last === null || first > last) return [];
  const buckets = new Map();
  for (let start = Math.floor(first / width) * width; start <= last; start += width) {
    const year = Math.floor(start / 12);
    const month = start % 12;
    const key = interval === 'year' ? String(year) : interval === 'quarter' ? `${year}-Q${Math.floor(month / 3) + 1}` : monthKey(start);
    const label = interval === 'year' ? String(year) : interval === 'quarter' ? `Q${Math.floor(month / 3) + 1} ${year}` : `${MONTHS[month]} ${year}`;
    buckets.set(start, { key, label, from: monthKey(Math.max(first, start)), to: monthKey(Math.min(last, start + width - 1)), total: 0 });
  }
  for (const month of dated) {
    if (month < first || month > last) continue;
    buckets.get(Math.floor(month / width) * width).total++;
  }
  return [...buckets.values()];
}

export function cumulativeBuckets(buckets) {
  let total = 0;
  return buckets.map(bucket => {
    total += bucket.total;
    return { ...bucket, total };
  });
}

export function developerBuckets(models) {
  const buckets = new Map();
  for (const model of models) {
    if (!buckets.has(model.developer_id)) buckets.set(model.developer_id, { id: model.developer_id, name: model.developer, total: 0 });
    buckets.get(model.developer_id).total++;
  }
  return [...buckets.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function sizePoints(models, { metric = 'total' } = {}) {
  const field = { total: 'parameters_b', active: 'active_parameters_b' }[metric];
  if (!field) throw new RangeError(`Unsupported parameter metric: ${metric}`);
  return models.filter(model => monthIndex(model.release_date) !== null && Number.isFinite(model[field]) && model[field] > 0)
    .map(model => ({ id: model.id, name: model.name, date: model.release_date, date_precision: model.date_precision || (model.release_date.length === 7 ? 'month' : 'day'), value: model[field], model }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value || a.id.localeCompare(b.id));
}
