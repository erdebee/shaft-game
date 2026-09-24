/**
 * infrastructureScreen.js
 * The Infrastructure tab, under Build. Reserved for a mechanism of its own,
 * still to be designed; until then it says so rather than borrowing the
 * Buildings list.
 */

import { card, el } from '../components/dom.js';

export function mount(root) {
  root.replaceChildren();
  const section = card(root, 'Infrastructure');
  section.appendChild(el('div', 'meter-label', 'Not built yet.'));
  return {};
}
