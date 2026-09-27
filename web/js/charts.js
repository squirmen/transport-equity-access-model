// Horizontal bars with the value at the tip. One series, one hue; the numbers are
// always visible, so nothing depends on hovering.

import { el } from './format.js';

export function bars(container, rows, { format, max = 1, caption, label } = {}) {
  container.replaceChildren();
  if (caption) container.append(el('p', 'chart-caption', caption));
  const table = el('div', 'bars');
  table.setAttribute('role', 'table');
  if (label) table.setAttribute('aria-label', label);
  for (const row of rows) {
    const line = el('div', `bar-row${row.emphasis ? ' is-emphasis' : ''}`);
    line.setAttribute('role', 'row');
    const name = el('span', 'bar-label', row.label);
    name.setAttribute('role', 'rowheader');
    const track = el('span', 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'bar-fill');
    const share = Number.isFinite(row.value) ? Math.max(0, Math.min(1, row.value / max)) : 0;
    fill.style.width = `${(share * 100).toFixed(1)}%`;
    track.append(fill);
    const value = el('span', 'bar-value', format(row.value));
    // A second figure, quieter, for a row that needs two numbers to read.
    if (row.detail) value.append(el('span', 'bar-detail', ` · ${row.detail}`));
    value.setAttribute('role', 'cell');
    if (row.title) line.title = row.title;
    line.append(name, track, value);
    table.append(line);
  }
  container.append(table);
}

const SVG = 'http://www.w3.org/2000/svg';

/** Lines across a shared x axis, each labelled at its end. For a handful of
 *  series that are read against each other, like the share meeting a
 *  standard as the standard moves. The figures are also given as text for
 *  anyone who cannot see the chart. */
export function lines(container, series, { xs, format, caption, label, marker } = {}) {
  container.replaceChildren();
  if (caption) container.append(el('p', 'chart-caption', caption));
  const width = 300;
  const height = 150;
  const pad = { left: 30, right: 88, top: 8, bottom: 20 };
  const x = (v) => pad.left + ((v - xs[0]) / (xs[xs.length - 1] - xs[0])) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - v) * (height - pad.top - pad.bottom);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'line-chart');
  svg.setAttribute('role', 'img');
  if (label) svg.setAttribute('aria-label', label);
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    svg.append(node);
    return node;
  };
  for (const tick of [0, 0.5, 1]) {
    add('line', { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: 'grid' });
    add('text', { x: pad.left - 4, y: y(tick) + 3, 'text-anchor': 'end', class: 'axis' }, format(tick));
  }
  for (const v of xs.filter((_, k) => k % 2 === 0)) {
    add('text', { x: x(v), y: height - 6, 'text-anchor': 'middle', class: 'axis' }, String(v));
  }
  if (marker != null) add('line', { x1: x(marker), x2: x(marker), y1: pad.top, y2: height - pad.bottom, class: 'marker' });
  for (const s of series) {
    const points = s.values.map((v, k) => (Number.isFinite(v) ? `${x(xs[k]).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean);
    if (points.length < 2) continue;
    add('polyline', { points: points.join(' '), class: `series${s.emphasis ? ' is-emphasis' : ''}`, stroke: s.colour });
    const last = s.values[s.values.length - 1];
    add('text', { x: width - pad.right + 4, y: y(last) + 3, class: 'series-label', fill: s.colour }, s.label);
  }
  container.append(svg);
  const text = series.map((s) => `${s.label}: ${xs.map((v, k) => `${v} min ${format(s.values[k])}`).join(', ')}`).join('; ');
  container.append(el('p', 'visually-hidden', text));
}
