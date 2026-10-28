import test from 'node:test';
import assert from 'node:assert/strict';
import { paginationDefaults, readPagination, pageWindow, pageForIndex } from './pagination.js';

test('pagination URLs accept supported sizes and reject unsafe or invalid page values', () => {
  assert.deepEqual(readPagination(new URLSearchParams()), paginationDefaults);
  assert.deepEqual(readPagination(new URLSearchParams('page=3&rows=200')), { page: 3, rows: '200' });
  assert.deepEqual(readPagination(new URLSearchParams('page=6&rows=all')), { page: 1, rows: 'all' });
  for (const page of ['0', '-1', '1.5', 'Infinity', '9007199254740992', 'abc']) {
    assert.deepEqual(readPagination(new URLSearchParams({ page, rows: '75' })), paginationDefaults);
  }
});

test('page windows cover the whole result without overlap and clamp stale links', () => {
  const indices = [];
  for (let page = 1; page <= 6; page++) {
    const window = pageWindow(559, { page, rows: '100' });
    indices.push(...Array.from({ length: window.end - window.start }, (_, i) => window.start + i));
  }
  assert.deepEqual(indices, Array.from({ length: 559 }, (_, i) => i));
  assert.deepEqual(pageWindow(559, { page: 999, rows: '100' }), { page: 6, pages: 6, start: 500, end: 559 });
  assert.deepEqual(pageWindow(0, { page: 3, rows: '100' }), { page: 1, pages: 1, start: 0, end: 0 });
  assert.deepEqual(pageWindow(559, { page: 1, rows: 'all' }), { page: 1, pages: 1, start: 0, end: 559 });
});

test('a selected model remains in the visible page when page size changes', () => {
  for (const index of [0, 49, 50, 99, 100, 199, 200, 558]) {
    for (const rows of ['50', '100', '200', 'all']) {
      const window = pageWindow(559, { page: pageForIndex(index, rows), rows });
      assert.ok(window.start <= index && index < window.end, `${index} is outside ${rows}-row page`);
    }
  }
});
