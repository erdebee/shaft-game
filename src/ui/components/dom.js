/** Small DOM helpers shared by the panel screens. */

export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A compact button, labelled for screen readers when its text is a glyph. */
export function button(text, label, onClick, className = 'icon-button') {
  const b = el('button', className, text);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/** A panel card with its heading. */
export function card(root, heading) {
  const section = el('section', 'card');
  section.appendChild(el('h2', '', heading));
  root.appendChild(section);
  return section;
}
