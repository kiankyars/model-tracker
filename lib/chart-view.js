import { timeBuckets, cumulativeBuckets, developerBuckets, sizePoints } from './chart-data.js';
import { modelSizeLabel, activeSizeLabel } from './parameter-labels.js';

const SVG = 'http://www.w3.org/2000/svg';
const format = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const colors = { total: '#24231f', open: '#a64128', closed: '#99978d', unknown: '#d5d3c9' };
const $ = id => document.getElementById(id);
const text = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
};
const svgNode = (tag, attributes = {}, content) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (content != null) node.textContent = content;
  return node;
};
const shortDate = value => new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', ...(value.length > 7 ? { day: 'numeric' } : {}), timeZone: 'UTC' });
const monthDate = value => `${value.slice(0, 7)}-15T00:00:00Z`;
const timeOf = point => Date.parse(point.date_precision === 'month' || point.date.length === 7 ? monthDate(point.date) : `${point.date}T00:00:00Z`);

function legend(items) {
  $('chart-legend').replaceChildren(...items.map(([name, color]) => {
    const item = text('span', 'chart-key', name);
    item.style.setProperty('--key-color', color);
    return item;
  }));
}

function interactive(node, label, activate, detail = label) {
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', label);
  node.append(svgNode('title', {}, detail));
  node.addEventListener('mouseenter', () => { $('chart-detail').textContent = detail; });
  node.addEventListener('focus', () => { $('chart-detail').textContent = detail; });
  node.addEventListener('click', activate);
  node.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
  });
}

function canvas(label) {
  const width = Math.max(290, Math.round($('chart').getBoundingClientRect().width));
  const height = 260;
  const frame = { width, height, left: 44, right: width - 12, top: 12, bottom: height - 30 };
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': label, class: 'chart-svg' });
  $('chart').append(svg);
  return { svg, ...frame, plotWidth: frame.right - frame.left, plotHeight: frame.bottom - frame.top };
}

function axisLine(svg, x1, y1, x2, y2) {
  svg.append(svgNode('line', { x1, y1, x2, y2, class: 'chart-grid-line' }));
}

function numberAxis(frame, maximum) {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, maximum)));
  const top = Math.max(1, Math.ceil(maximum / power) * power);
  const ticks = Math.min(4, top);
  for (let i = 0; i <= ticks; i++) {
    const value = Math.round(top * i / ticks);
    const y = frame.bottom - value / top * frame.plotHeight;
    axisLine(frame.svg, frame.left, y, frame.right, y);
    frame.svg.append(svgNode('text', { x: frame.left - 9, y: y + 3, 'text-anchor': 'end', class: 'chart-axis-label' }, format.format(value)));
  }
  return top;
}

function timeAxis(frame, buckets, position) {
  const count = Math.min(buckets.length, Math.max(2, Math.floor(frame.width / 135)));
  const indices = [...new Set(Array.from({ length: count }, (_, i) => Math.round(i / Math.max(1, count - 1) * (buckets.length - 1))))];
  for (const i of indices) {
    frame.svg.append(svgNode('text', {
      x: position(i), y: frame.height - 8,
      'text-anchor': i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle', class: 'chart-axis-label',
    }, buckets[i].label));
  }
}

function timeChart(models, filters, options, onRange) {
  const buckets = timeBuckets(models, { from: filters.from, to: filters.to, interval: options.interval });
  const cumulative = options.view === 'cumulative';
  const displayed = cumulative ? cumulativeBuckets(buckets) : buckets;
  const names = { month: 'month', quarter: 'quarter', year: 'year' };
  $('chart-title').textContent = cumulative ? 'Cumulative releases' : `Releases by ${names[options.interval]}`;
  if (!displayed.length) return empty('No dated releases match these filters.');
  $('chart-scope').textContent = `${shortDate(buckets[0].from)} – ${shortDate(buckets.at(-1).to)}`;
  const frame = canvas(cumulative ? 'Cumulative model releases over time' : `Model releases by ${names[options.interval]}`);
  const maximum = numberAxis(frame, Math.max(...displayed.map(bucket => bucket.total)));
  const step = frame.plotWidth / displayed.length;
  const position = i => frame.left + step * (i + .5);
  timeAxis(frame, displayed, position);
  if (cumulative) {
    for (const key of ['closed', 'open', 'total']) {
      frame.svg.append(svgNode('path', {
        d: displayed.map((bucket, i) => `${i ? 'L' : 'M'} ${position(i)} ${frame.bottom - bucket[key] / maximum * frame.plotHeight}`).join(' '),
        fill: 'none', stroke: colors[key], 'stroke-width': key === 'total' ? 2 : 1.5,
        'vector-effect': 'non-scaling-stroke', 'aria-hidden': 'true',
      }));
    }
  }
  displayed.forEach((bucket, i) => {
    const group = svgNode('g', { class: 'time-mark' });
    group.append(svgNode('rect', { x: frame.left + i * step, y: frame.top, width: Math.max(step, 1), height: frame.plotHeight, class: 'chart-hit-area' }));
    if (cumulative) {
      group.append(svgNode('circle', { cx: position(i), cy: frame.bottom - bucket.total / maximum * frame.plotHeight, r: 3, fill: colors.total, class: `cumulative-point${displayed.length === 1 ? ' lone' : ''}` }));
    } else {
      let y = frame.bottom;
      const barWidth = Math.min(40, step * .78);
      for (const key of ['open', 'closed', 'unknown']) {
        const height = bucket[key] / maximum * frame.plotHeight;
        y -= height;
        if (height) group.append(svgNode('rect', { x: position(i) - barWidth / 2, y, width: barWidth, height, fill: colors[key], 'pointer-events': 'none' }));
      }
    }
    const detail = `${bucket.label}: ${format.format(bucket.total)} ${cumulative ? 'cumulative ' : ''}releases · ${format.format(bucket.open)} open weights · ${format.format(bucket.closed)} closed${bucket.unknown ? ` · ${bucket.unknown} without weight information` : ''}`;
    interactive(group, `${detail}. Filter to ${bucket.label}.`, () => onRange({ from: bucket.from, to: bucket.to }), detail);
    frame.svg.append(group);
  });
  legend(cumulative ? [['Total', colors.total], ['Open weights', colors.open], ['Closed', colors.closed]] : [['Open weights', colors.open], ['Closed', colors.closed]]);
  const undated = models.filter(model => !model.release_date).length;
  $('chart-note').textContent = `${cumulative ? 'Counts start at the selected range. ' : ''}Select a ${names[options.interval]} to filter.${undated ? ` ${undated} undated releases omitted.` : ''}`;
}

function developersChart(models, onDeveloper) {
  const developers = developerBuckets(models);
  $('chart-title').textContent = 'Releases by developer';
  $('chart-scope').textContent = `${format.format(developers.length)} developers`;
  if (!developers.length) return empty('No releases match these filters.');
  const list = text('div', 'developer-chart');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Developers ranked by model releases');
  const maximum = developers[0].total;
  for (const developer of developers) {
    const button = text('button', 'developer-bar');
    button.type = 'button';
    button.setAttribute('aria-label', `${developer.name}: ${developer.total} releases. Filter to ${developer.name}.`);
    const bar = text('span', 'developer-bar-track');
    const fill = text('span', 'developer-bar-fill');
    fill.style.width = `${developer.total / maximum * 100}%`;
    for (const key of ['open', 'closed', 'unknown']) {
      const segment = text('span');
      segment.style.backgroundColor = colors[key];
      segment.style.width = `${developer[key] / developer.total * 100}%`;
      fill.append(segment);
    }
    bar.append(fill);
    button.append(text('span', 'developer-bar-label', developer.name), bar, text('span', 'developer-bar-value', format.format(developer.total)));
    const detail = `${developer.name}: ${developer.total} releases · ${developer.open} open weights · ${developer.closed} closed`;
    button.addEventListener('mouseenter', () => { $('chart-detail').textContent = detail; });
    button.addEventListener('focus', () => { $('chart-detail').textContent = detail; });
    button.addEventListener('click', () => onDeveloper(developer.id));
    list.append(button);
  }
  $('chart').append(list);
  legend([['Open weights', colors.open], ['Closed', colors.closed]]);
  $('chart-note').textContent = 'Select a developer to filter. Scroll for all developers.';
}

function sizesChart(models, options, onModel) {
  const points = sizePoints(models, { metric: options.metric });
  const label = options.metric === 'active' ? 'Active parameters' : 'Model parameters';
  $('chart-title').textContent = `${label} by release date`;
  $('chart-scope').textContent = `${format.format(points.length)} of ${format.format(models.length)} releases plotted`;
  if (!points.length) return empty(`No releases have both a date and ${label.toLowerCase()}.`);
  const frame = canvas(`${label} in billions by model release date`);
  const times = points.map(timeOf);
  let minTime = Math.min(...times), maxTime = Math.max(...times);
  if (minTime === maxTime) { minTime -= 86400000 * 15; maxTime += 86400000 * 15; }
  let minSize = Math.floor(Math.log10(Math.min(...points.map(point => point.value))));
  let maxSize = Math.ceil(Math.log10(Math.max(...points.map(point => point.value))));
  if (minSize === maxSize) { minSize--; maxSize++; }
  const x = value => frame.left + (value - minTime) / (maxTime - minTime) * frame.plotWidth;
  const y = value => frame.bottom - (Math.log10(value) - minSize) / (maxSize - minSize) * frame.plotHeight;
  for (let exponent = minSize; exponent <= maxSize; exponent++) {
    const value = 10 ** exponent;
    axisLine(frame.svg, frame.left, y(value), frame.right, y(value));
    frame.svg.append(svgNode('text', { x: frame.left - 9, y: y(value) + 3, 'text-anchor': 'end', class: 'chart-axis-label' }, `${format.format(value)}B`));
  }
  const tickCount = Math.max(2, Math.floor(frame.width / 160));
  for (let i = 0; i < tickCount; i++) {
    const time = minTime + i / (tickCount - 1) * (maxTime - minTime);
    const date = new Date(time).toISOString().slice(0, 7);
    frame.svg.append(svgNode('text', { x: x(time), y: frame.height - 8, 'text-anchor': i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle', class: 'chart-axis-label' }, shortDate(date)));
  }
  for (const point of points) {
    const group = svgNode('g', { class: 'size-mark' });
    group.append(svgNode('circle', { cx: x(timeOf(point)), cy: y(point.value), r: 4, fill: point.open_weights === true ? colors.open : point.open_weights === false ? colors.closed : colors.total, 'fill-opacity': .7 }));
    const detail = `${point.name} · ${shortDate(point.date)} · ${options.metric === 'active' ? activeSizeLabel(point.model) : modelSizeLabel(point.model)} parameters${point.model.parameters_source === 'model_name' ? ' (from model name)' : ''}`;
    interactive(group, `${detail}. Show model details.`, () => onModel(point.id), detail);
    frame.svg.append(group);
  }
  legend([['Open weights', colors.open], ['Closed', colors.closed]]);
  const scoped = points.some(point => options.metric === 'active' ? point.model.active_parameters_scope : point.model.parameters_scope);
  $('chart-note').textContent = `Logarithmic size axis. Select a point for details. ${models.length - points.length} releases lack a date or ${options.metric} size.${scoped ? ' Reported backbone or decode counts are labeled in point details.' : ''}`;
}

function empty(message) {
  $('chart').append(text('p', 'chart-empty', message));
  $('chart-legend').replaceChildren();
  $('chart-note').textContent = '';
}

export function renderChart({ models, filters, options, onRange, onDeveloper, onModel }) {
  $('chart').replaceChildren();
  $('chart-scope').textContent = '';
  $('chart-detail').textContent = '';
  $('chart').className = `chart chart-${options.view}`;
  $('interval-control').hidden = !['releases', 'cumulative'].includes(options.view);
  $('metric-control').hidden = options.view !== 'sizes';
  if (options.view === 'developers') developersChart(models, onDeveloper);
  else if (options.view === 'sizes') sizesChart(models, options, onModel);
  else timeChart(models, filters, options, onRange);
}
