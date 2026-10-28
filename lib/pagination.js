export const paginationDefaults = Object.freeze({ page: 1, rows: '100' });

export function readPagination(query) {
  const rows = ['50', '100', '200', 'all'].includes(query.get('rows')) ? query.get('rows') : paginationDefaults.rows;
  const value = query.get('page');
  const page = /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 1;
  return { page: rows === 'all' ? 1 : page, rows };
}

export function pageWindow(total, state) {
  const size = state.rows === 'all' ? Math.max(1, total) : Number(state.rows);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.max(1, Math.min(state.page, pages));
  const start = (page - 1) * size;
  return { page, pages, start, end: Math.min(start + size, total) };
}

export function pageForIndex(index, rows) {
  return rows === 'all' ? 1 : Math.floor(index / Number(rows)) + 1;
}
