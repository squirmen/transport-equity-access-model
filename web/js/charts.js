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
    value.setAttribute('role', 'cell');
    if (row.title) line.title = row.title;
    line.append(name, track, value);
    table.append(line);
  }
  container.append(table);
}
