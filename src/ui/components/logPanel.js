/** Scrolling record of decisions and events. The player's own paper trail. */

let container = null;
let rendered = 0;

export function mount(root) {
  container = document.createElement('div');
  container.className = 'log';
  container.setAttribute('role', 'log');
  container.setAttribute('aria-live', 'polite');
  root.appendChild(container);
  rendered = 0;
  return { update };
}

/**
 * Append only what is new. state.log is the record; this panel is a view of
 * it, so it never holds entries the log does not — which means a loaded save
 * shows its own history without any extra bookkeeping.
 */
export function update(state) {
  if (!container) return;

  if (state.log.length < rendered) {
    // A load replaced the log with a shorter one; rebuild rather than diff.
    container.replaceChildren();
    rendered = 0;
  }

  for (let i = rendered; i < state.log.length; i++) {
    append(state.log[i]);
  }
  rendered = state.log.length;
}

export function append(entry) {
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'log-entry';
  row.dataset.kind = entry.kind ?? 'info';

  const at = document.createElement('span');
  at.className = 'at';
  at.textContent = `t${entry.tick}`;

  const what = document.createElement('span');
  what.className = 'what';
  what.textContent = entry.message;

  row.append(at, what);
  // Prepended because the panel is column-reverse: newest nearest the eye.
  container.prepend(row);

  // The log is a paper trail, not an archive — 200 rows is plenty on screen,
  // and state.log keeps the full record regardless.
  while (container.childElementCount > 200) container.lastElementChild.remove();
}
