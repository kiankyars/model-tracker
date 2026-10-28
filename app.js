import { defaults, filterModels, sortModels, isMultimodal, toCSV } from './lib/model-data.js';
import { renderChart } from './lib/chart-view.js';
import { billions, missingLabel, modelSizeLabel, activeSizeLabel, hasReportedSize } from './lib/parameter-labels.js';
import { paginationDefaults, readPagination, pageWindow, pageForIndex } from './lib/pagination.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en');
let catalog = null;
let state = { ...defaults };
const chartDefaults = { view: 'releases', interval: 'month', metric: 'total' };
let chartState = { ...chartDefaults };
let filtered = [];
let paginationState = { ...paginationDefaults };
let searchTimer;
const expanded = new Set();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function safeLink(url, text) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    const link = element('a', '', text);
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}

function dateLabel(value, precision) {
  if (!value) return 'Unknown';
  const date = new Date(`${value.length === 7 ? `${value}-01` : value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { ...(precision === 'month' || value.length === 7 ? {} : { day: 'numeric' }), month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function parameterLabel(value) {
  if (value == null) return '—';
  return `${number.format(value)}B`;
}

function compactNumber(value) {
  if (value == null) return 'Unknown';
  return number.format(value);
}

function readState() {
  const query = new URLSearchParams(location.search);
  const next = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = query.get(key);
    if (value == null) continue;
    if (key === 'q') next.q = value.slice(0, 500);
    else if (key === 'from' || key === 'to') {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) next[key] = value;
    } else {
      const select = $(key);
      if (select && [...select.options].some(option => option.value === value)) next[key] = value;
    }
  }
  return next;
}

function readChartState() {
  const query = new URLSearchParams(location.search);
  const next = { ...chartDefaults };
  for (const [key, values] of Object.entries({ view: ['releases', 'cumulative', 'developers', 'sizes'], interval: ['month', 'quarter', 'year'], metric: ['total', 'active'] })) {
    if (values.includes(query.get(key))) next[key] = query.get(key);
  }
  return next;
}

function presetRange(preset) {
  if (preset === 'all') return { from: '', to: '' };
  const end = catalog.updated_at.slice(0, 7);
  const [year, month] = end.split('-').map(Number);
  const start = year * 12 + month - (preset === '1y' ? 12 : 36);
  return { from: `${Math.floor(start / 12)}-${String(start % 12 + 1).padStart(2, '0')}`, to: end };
}

function syncControls() {
  for (const [key, value] of Object.entries(state)) $(key === 'q' ? 'search' : key).value = value;
  for (const button of document.querySelectorAll('[data-chart-view]')) button.setAttribute('aria-pressed', String(button.dataset.chartView === chartState.view));
  $('chart-interval').value = chartState.interval;
  $('chart-metric').value = chartState.metric;
  $('page-size').value = paginationState.rows;
  const filterCount = ['from', 'to', 'developer', 'access', 'type', 'size'].filter(key => state[key]).length;
  $('filter-toggle').textContent = filterCount ? `Filters (${filterCount})` : 'Filters';
  if (catalog) for (const button of document.querySelectorAll('[data-range]')) {
    const range = presetRange(button.dataset.range);
    button.setAttribute('aria-pressed', String(state.from === range.from && state.to === range.to));
  }
}

function showFilters(open) {
  $('filter-toggle').setAttribute('aria-expanded', String(open));
  $('filter-options').hidden = !open;
}

function revealActiveFilters() {
  if (['from', 'to', 'developer', 'access', 'type', 'size'].some(key => state[key])) showFilters(true);
}

function writeURL(replace = false) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ ...state, ...chartState, ...paginationState })) {
    if (value && value !== { ...defaults, ...chartDefaults, ...paginationDefaults }[key]) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function changeState(patch, replace = false) {
  clearTimeout(searchTimer);
  state = { ...state, ...patch };
  paginationState.page = 1;
  expanded.clear();
  syncControls();
  writeURL(replace);
  render();
}

function reset() {
  changeState({ ...defaults });
  $('search').focus({ preventScroll: true });
}

function renderStats() {
  const values = [
    ['Developers', new Set(filtered.map(model => model.developer_id)).size],
    ['Open weights', filtered.filter(model => model.open_weights === true).length],
    ['Known sizes', filtered.filter(model => model.parameters_b != null).length],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of values) {
    const wrapper = element('div', 'stat-line');
    wrapper.append(element('dt', '', label), element('dd', '', number.format(value)));
    fragment.append(wrapper);
  }
  $('stats').replaceChildren(fragment);
  renderVisualization();
}

function renderVisualization() {
  if (!catalog) return;
  renderChart({
    models: filtered, filters: state, options: chartState,
    onRange: range => {
      changeState(range);
      showFilters(true);
      $('chart').querySelector('[role="button"]')?.focus({ preventScroll: true });
    },
    onDeveloper: developer => {
      changeState({ developer });
      showFilters(true);
      $('chart').querySelector('button')?.focus({ preventScroll: true });
    },
    onModel: id => {
      const index = filtered.findIndex(model => model.id === id);
      if (index < 0) return;
      paginationState.page = pageForIndex(index, paginationState.rows);
      expanded.add(id);
      writeURL();
      renderRows();
      const row = $(`release-${filtered[index].slug}`);
      row.scrollIntoView({ behavior: 'auto', block: 'center' });
      row.querySelector('button').focus({ preventScroll: true });
    },
  });
}

function changeChart(patch) {
  chartState = { ...chartState, ...patch };
  syncControls();
  writeURL();
  renderVisualization();
}

function addDetail(list, label, value) {
  const item = element('div');
  item.append(element('dt', '', label), element('dd', '', value));
  list.append(item);
}

function detailRow(model, id) {
  const row = element('tr', 'model-details');
  row.id = id;
  const cell = document.createElement('td');
  cell.colSpan = 6;
  if (model.description) cell.append(element('p', 'detail-description', model.description));
  if (model.notes) {
    const note = element('p', 'detail-source-note');
    note.textContent = Array.isArray(model.notes) ? model.notes.join(' ') : model.notes;
    cell.append(note);
  }
  const list = element('dl', 'detail-grid');
  addDetail(list, 'Model ID', model.id);
  addDetail(list, 'Family', model.family || 'Not specified');
  addDetail(list, 'Developer', model.developer);
  addDetail(list, 'Released', dateLabel(model.release_date, model.date_precision));
  addDetail(list, 'Type', isMultimodal(model) ? 'Multimodal' : 'Text');
  addDetail(list, 'Weights', model.open_weights === true ? 'Open' : model.open_weights === false ? 'Closed' : 'Not specified');
  const scope = model.parameters_scope;
  addDetail(list, scope ? `${scope.charAt(0).toUpperCase() + scope.slice(1).replaceAll('_', ' ')} parameters` : 'Total parameters', model.parameters_b == null ? missingLabel(model, 'parameters_b') : parameterLabel(model.parameters_b));
  addDetail(list, 'Active parameters', activeSizeLabel(model));
  addDetail(list, 'Architecture', { moe: 'Mixture of experts', dense: 'Dense', transformer: 'Transformer', 'hybrid-ssm-transformer-moe': 'Hybrid Mamba–Transformer (MoE)' }[model.architecture] || model.architecture || missingLabel(model, 'architecture'));
  for (const [component, size] of Object.entries(model.parameter_components_b || {})) {
    if (component !== model.parameters_scope) addDetail(list, `${component.charAt(0).toUpperCase() + component.slice(1).replaceAll('_', ' ')} parameters`, size < 0.001 ? compactNumber(Math.round(size * 1e9)) : billions(size));
  }
  addDetail(list, 'Context window', model.context_window ? `${compactNumber(model.context_window)} tokens` : 'Unknown');
  addDetail(list, 'License', typeof model.license === 'string' ? model.license : model.license?.name || 'Not specified');
  addDetail(list, 'Release date precision', model.date_precision === 'month' ? 'Month only' : model.release_date ? 'Day' : 'Unknown');
  addDetail(list, 'Input', (model.modalities?.input ?? []).join(', ') || 'Not specified');
  addDetail(list, 'Output', (model.modalities?.output ?? []).join(', ') || 'Not specified');
  addDetail(list, 'Reasoning', model.reasoning == null ? 'Not specified' : model.reasoning ? 'Yes' : 'No');
  addDetail(list, 'Tool calling', model.tool_call == null ? 'Not specified' : model.tool_call ? 'Yes' : 'No');
  cell.append(list);
  const sources = element('p', 'detail-sources');
  sources.append(element('span', '', 'Sources'));
  const links = Array.isArray(model.sources) ? [...model.sources] : [];
  if (model.source_url && !links.some(source => source.url === model.source_url)) links.push({ label: 'Catalog record', url: model.source_url });
  const seen = new Set();
  for (const source of links) {
    if (seen.has(source.url)) continue;
    const link = safeLink(source.url, source.label || 'Source');
    if (link) { sources.append(link); seen.add(source.url); }
  }
  if (seen.size) cell.append(sources);
  if (model.aliases?.length) cell.append(element('p', 'detail-note', `Also indexed as: ${model.aliases.join(', ')}`));
  const notes = [];
  if (model.parameters_source === 'model_name') notes.push('Parameter count is the nominal size published in the model name; it may be rounded.');
  if (!hasReportedSize(model)) notes.push('Parameter count is not recorded in this catalog.');
  if (model.open_weights === true) notes.push('Weights are available; usage rights depend on the model license.');
  if (model.upstream_present === false || model.in_current_source === false) notes.push('Retained from an earlier catalog snapshot or historical supplement.');
  if (notes.length) cell.append(element('p', 'detail-note', notes.join(' ')));
  row.append(cell);
  return row;
}

function renderRows() {
  const window = pageWindow(filtered.length, paginationState);
  if (paginationState.page !== window.page) {
    paginationState.page = window.page;
    writeURL(true);
  }
  const fragment = document.createDocumentFragment();
  for (const [index, model] of filtered.slice(window.start, window.end).entries()) {
    const open = expanded.has(model.id);
    const row = element('tr', `model-row${open ? ' expanded' : ''}`);
    row.id = `release-${model.slug}`;
    const modelCell = document.createElement('td');
    const toggle = element('button', 'model-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    const detailId = `model-detail-${window.start + index}`;
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 12 12');
    chevron.setAttribute('class', 'chevron');
    chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm4 2 4 4-4 4');
    chevron.append(path);
    toggle.append(chevron, element('span', 'model-name', model.name));
    modelCell.append(toggle, element('span', 'mobile-developer', model.developer));
    const date = element('td', `release-date${model.release_date ? '' : ' unknown-value'}`, dateLabel(model.release_date, model.date_precision));
    if (model.date_precision === 'month') date.title = 'Only the release month is known.';
    const type = element('td', 'type-cell');
    type.append(element('span', 'model-type', isMultimodal(model) ? 'Multimodal' : 'Text'));
    if (model.reasoning) type.append(element('span', 'reasoning-label', 'Reasoning'));
    const size = element('td', `numeric parameter-count${!hasReportedSize(model) ? ' unknown-value' : ''}`, modelSizeLabel(model));
    if (!hasReportedSize(model)) size.title = 'Parameter count not recorded in this catalog';
    else if (model.parameters_lower_bound_b != null) size.title = `Published lower bound; the total ${model.parameters_lower_bound_exclusive ? 'exceeds' : 'is at least'} ${billions(model.parameters_lower_bound_b)}`;
    else if (model.parameters_source === 'model_name') size.title = 'Nominal parameter count from the model name';
    const weights = element('td', 'weights-cell');
    weights.append(element('span', `weight-label${model.open_weights === true ? ' open' : model.open_weights == null ? ' unknown-value' : ''}`, model.open_weights === true ? 'Open' : model.open_weights === false ? 'Closed' : '—'));
    row.append(modelCell, element('td', 'developer-name', model.developer), date, type, size, weights);
    let details = open ? detailRow(model, detailId) : null;
    if (details) toggle.setAttribute('aria-controls', detailId);
    toggle.addEventListener('click', () => {
      const next = toggle.getAttribute('aria-expanded') !== 'true';
      if (next && !details) {
        details = detailRow(model, detailId);
        toggle.setAttribute('aria-controls', detailId);
        row.after(details);
      }
      toggle.setAttribute('aria-expanded', String(next));
      row.classList.toggle('expanded', next);
      if (details) details.hidden = !next;
      if (next) expanded.add(model.id); else expanded.delete(model.id);
    });
    fragment.append(row);
    if (details) fragment.append(details);
  }
  $('release-rows').replaceChildren(fragment);
  $('table-scroll').hidden = !filtered.length;
  $('empty-state').hidden = !!filtered.length;
  $('pagination').hidden = !filtered.length;
  $('shown-count').textContent = filtered.length ? `${number.format(window.start + 1)}–${number.format(window.end)} of ${number.format(filtered.length)}` : '';
  $('previous-page').disabled = window.page === 1;
  $('next-page').disabled = window.page === window.pages;
  $('previous-page').parentElement.hidden = window.pages === 1;
}

function focusReleases() {
  $('release-heading').scrollIntoView({ behavior: 'auto', block: 'start' });
  $('release-heading').focus({ preventScroll: true });
}

function changePage(delta) {
  const window = pageWindow(filtered.length, { ...paginationState, page: paginationState.page + delta });
  if (window.page === paginationState.page) return;
  paginationState.page = window.page;
  writeURL();
  renderRows();
  focusReleases();
}

function render() {
  if (!catalog) return;
  filtered = sortModels(filterModels(catalog.models, state), state.sort);
  $('reset').hidden = !Object.keys(defaults).some(key => key !== 'sort' && state[key] !== defaults[key]);
  const invalidRange = state.from && state.to && state.from > state.to;
  $('filter-note').hidden = !invalidRange;
  $('filter-note').textContent = invalidRange ? 'The start month is after the end month. Choose an earlier start or a later end.' : '';
  const count = $('result-count');
  count.replaceChildren(document.createTextNode(`${number.format(filtered.length)} release${filtered.length === 1 ? '' : 's'}`));
  if (filtered.length !== catalog.models.length) count.append(element('span', 'count-context', ` of ${number.format(catalog.models.length)}`));
  $('download-csv').disabled = !filtered.length;
  $('download-json').disabled = !filtered.length;
  renderStats();
  renderRows();
}

function download(format) {
  const data = format === 'csv' ? toCSV(filtered) : JSON.stringify({ schema_version: catalog.schema_version, updated_at: catalog.updated_at, source: catalog.source, coverage: catalog.coverage, filters: state, count: filtered.length, models: filtered }, null, 2) + '\n';
  const blob = new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `model-releases-${catalog.updated_at?.slice(0, 10) || 'export'}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const menu = document.querySelector('.download-menu');
  menu.open = false;
  menu.querySelector('summary').focus();
}

async function load() {
  $('loading').hidden = false;
  $('error').hidden = true;
  try {
    const response = await fetch('./api/v1/models.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Data request returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.models) || !data.models.length) throw new Error('Invalid or empty release index');
    catalog = data;
    const developers = [...new Map(catalog.models.map(model => [model.developer_id, model.developer])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    $('developer').replaceChildren(new Option('All developers', ''), ...developers.map(([id, name]) => new Option(name, id)));
    state = readState();
    chartState = readChartState();
    paginationState = readPagination(new URLSearchParams(location.search));
    syncControls();
    revealActiveFilters();
    writeURL(true);
    $('data-note').textContent = `Updated ${dateLabel(catalog.updated_at)}`;
    $('explorer-content').hidden = false;
    render();
  } catch (error) {
    $('error').hidden = false;
    $('data-note').textContent = 'The data is temporarily unavailable. Please try again.';
    console.error('Unable to load model releases:', error);
  } finally { $('loading').hidden = true; }
}

$('filters').addEventListener('submit', event => { event.preventDefault(); changeState({ q: $('search').value }); });
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => changeState({ q: $('search').value }, true), 180);
});
for (const key of Object.keys(defaults).filter(key => key !== 'q')) $(key).addEventListener('change', () => changeState({ [key]: $(key).value, q: $('search').value }));
for (const button of document.querySelectorAll('[data-chart-view]')) button.addEventListener('click', () => changeChart({ view: button.dataset.chartView }));
for (const button of document.querySelectorAll('[data-range]')) button.addEventListener('click', () => { if (catalog) changeState(presetRange(button.dataset.range)); });
$('chart-interval').addEventListener('change', () => changeChart({ interval: $('chart-interval').value }));
$('chart-metric').addEventListener('change', () => changeChart({ metric: $('chart-metric').value }));
$('chart').addEventListener('mouseleave', () => {
  if (!$('chart').contains(document.activeElement)) $('chart-detail').textContent = '';
});
$('chart').addEventListener('focusout', event => {
  if (!$('chart').contains(event.relatedTarget)) $('chart-detail').textContent = '';
});
$('filter-toggle').addEventListener('click', () => {
  const open = $('filter-toggle').getAttribute('aria-expanded') !== 'true';
  showFilters(open);
});
$('reset').addEventListener('click', reset);
$('empty-reset').addEventListener('click', reset);
$('retry').addEventListener('click', load);
$('previous-page').addEventListener('click', () => changePage(-1));
$('next-page').addEventListener('click', () => changePage(1));
$('page-size').addEventListener('change', () => {
  const firstVisible = pageWindow(filtered.length, paginationState).start;
  paginationState.rows = $('page-size').value;
  paginationState.page = pageForIndex(firstVisible, paginationState.rows);
  writeURL();
  renderRows();
  focusReleases();
});
$('download-csv').addEventListener('click', () => download('csv'));
$('download-json').addEventListener('click', () => download('json'));
window.addEventListener('popstate', () => {
  clearTimeout(searchTimer);
  state = readState();
  chartState = readChartState();
  paginationState = readPagination(new URLSearchParams(location.search));
  writeURL(true);
  expanded.clear();
  syncControls();
  revealActiveFilters();
  render();
});
document.addEventListener('click', event => {
  const menu = document.querySelector('.download-menu');
  if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  const menu = document.querySelector('.download-menu');
  if (event.key === 'Escape' && menu.open) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});

let chartWidth = 0;
let resizeFrame;
new ResizeObserver(entries => {
  const width = Math.round(entries[0].contentRect.width);
  if (!width || width === chartWidth) return;
  chartWidth = width;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderVisualization);
}).observe($('chart'));

load();
