export const defaults = Object.freeze({ q: '', from: '', to: '', developer: '', access: '', type: '', size: '', sort: 'newest' });

export function isMultimodal(model) {
  return [...(model.modalities?.input ?? []), ...(model.modalities?.output ?? [])].some(value => value !== 'text');
}

export function filterModels(models, filters) {
  const words = (filters.q || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(model => {
    const month = model.release_date?.slice(0, 7);
    if (filters.from && (!month || month < filters.from)) return false;
    if (filters.to && (!month || month > filters.to)) return false;
    if (filters.developer && model.developer_id !== filters.developer) return false;
    if (filters.access === 'open' && model.open_weights !== true) return false;
    if (filters.access === 'closed' && model.open_weights !== false) return false;
    if (filters.access === 'unknown' && model.open_weights != null) return false;
    if (filters.type === 'text' && isMultimodal(model)) return false;
    if (filters.type === 'multimodal' && !isMultimodal(model)) return false;
    if (filters.type === 'reasoning' && model.reasoning !== true) return false;
    const size = model.parameters_b;
    if (filters.size === 'unknown' && size != null) return false;
    if (filters.size && filters.size !== 'unknown') {
      if (size == null) return false;
      if (filters.size === 'under3' && size >= 3) return false;
      if (filters.size === '3to10' && (size < 3 || size >= 10)) return false;
      if (filters.size === '10to30' && (size < 10 || size >= 30)) return false;
      if (filters.size === '30to100' && (size < 30 || size >= 100)) return false;
      if (filters.size === '100plus' && size < 100) return false;
    }
    if (words.length) {
      const searchable = [model.name, model.id, model.developer, model.family, model.description].filter(Boolean).join(' ').toLocaleLowerCase();
      if (!words.every(word => searchable.includes(word))) return false;
    }
    return true;
  });
}

export function sortModels(models, sort = 'newest') {
  return [...models].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const field = sort === 'size' ? 'parameters_b' : sort === 'context' ? 'context_window' : 'release_date';
    const left = a[field];
    const right = b[field];
    if (left == null && right != null) return 1;
    if (left != null && right == null) return -1;
    let comparison = typeof left === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''));
    if (sort !== 'oldest') comparison *= -1;
    return comparison || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export function monthSeries(models, { from = '', to = '', fallback = '' } = {}) {
  const counts = new Map();
  for (const model of models) {
    if (model.release_date) {
      const month = model.release_date.slice(0, 7);
      if (!counts.has(month)) counts.set(month, { month, open: 0, closed: 0, unknown: 0, total: 0 });
      const count = counts.get(month);
      count.total++;
      count[model.open_weights === true ? 'open' : model.open_weights === false ? 'closed' : 'unknown']++;
    }
  }
  const keys = [...counts.keys()].sort();
  const last = to || keys.at(-1) || fallback;
  if (!last || !/^\d{4}-\d{2}$/.test(last)) return [];
  const [year, month] = last.split('-').map(Number);
  const end = year * 12 + month - 1;
  const parse = value => { const [y, m] = value.split('-').map(Number); return y * 12 + m - 1; };
  const start = Math.max(end - 23, from ? parse(from) : keys[0] ? parse(keys[0]) : end - 11);
  if (start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = start + index;
    const key = `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}`;
    return counts.get(key) || { month: key, open: 0, closed: 0, unknown: 0, total: 0 };
  });
}

export function toCSV(models) {
  const columns = ['id', 'name', 'developer', 'release_date', 'date_precision', 'open_weights', 'license', 'parameters_b', 'active_parameters_b', 'parameters_source', 'architecture', 'context_window', 'reasoning', 'tool_call', 'source_url'];
  const escape = value => {
    let cell = value == null ? '' : String(value);
    if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  };
  return [columns.join(','), ...models.map(model => columns.map(column => escape(model[column])).join(','))].join('\r\n');
}
