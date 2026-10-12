// Folded detail: a line that opens to charts, lists and methods.
//
// The panel and the card are drawn afresh on every change, so a fold that was
// opened would close again as soon as anything moved. Each fold has a key,
// and whether it is open is kept for the session (in this browser only; if
// storage is blocked, for as long as the page is open).

import { el } from './format.js';

const STORE = 'team.folds';
let opened = null;

function store() {
  if (opened) return opened;
  opened = new Map();
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORE) || '{}');
    for (const [key, open] of Object.entries(saved)) opened.set(key, Boolean(open));
  } catch {
    // nothing kept: every fold starts as its default
  }
  return opened;
}

function save() {
  try {
    window.sessionStorage.setItem(STORE, JSON.stringify(Object.fromEntries(store())));
  } catch {
    // kept for this page only
  }
}

/** Whether a fold is open: as left this session, or its default. */
export function isOpen(key, fallback = false) {
  const known = store();
  return known.has(key) ? known.get(key) : fallback;
}

export function setOpen(key, open) {
  store().set(key, Boolean(open));
  save();
}

/** A fold: `title` on the left, a short `summary` on the right, then the
 *  children when opened. `open` is its state the first time it is seen. */
export function fold(key, title, summary, children, { open = false, className = '' } = {}) {
  const box = el('details', `fold${className ? ` ${className}` : ''}`);
  box.dataset.fold = key;
  box.open = isOpen(key, open);
  const head = el('summary');
  const name = el('span', 'fold-title');
  if (typeof title === 'string') name.textContent = title;
  else name.append(...[].concat(title).filter(Boolean));
  head.append(name);
  if (summary) head.append(el('span', 'fold-sum', summary));
  box.append(head);
  const body = el('div', 'fold-body');
  body.append(...[].concat(children).filter(Boolean).map((child) => (typeof child === 'string' ? el('p', 'note', child) : child)));
  box.append(body);
  box.addEventListener('toggle', () => setOpen(key, box.open));
  return box;
}
