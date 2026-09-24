/**
 * lawStatus.js
 * The law at a glance, in the top bar: Authority held, whether the Accord is
 * in session, and the nearest promise's deadline — the tension a promise
 * makes only works if the clock on it is always in view. Clicking it opens
 * the Accord tab.
 */

import { el } from './dom.js';
import { sessionOf } from '../../governance/statuteEngine.js';
import { daysFrom } from './lawText.js';

export function mount(root, onOpen) {
  const wrap = el('button', 'law-status');
  wrap.type = 'button';
  wrap.title = 'Open the Accord';
  const authority = el('span', 'law-status-authority');
  const session = el('span', 'law-status-session');
  const promise = el('span', 'law-status-promise');
  wrap.append(authority, session, promise);
  wrap.addEventListener('click', onOpen);
  root.appendChild(wrap);

  let last = null;
  return {
    update(state, ctx) {
      const sess = sessionOf(state, ctx);
      const nearest = state.narrative.timers
        .filter((t) => t.promise)
        .sort((a, b) => a.expiresTick - b.expiresTick)[0];
      const text = [
        `Authority ${Math.floor(state.governance.authority)}`,
        sess.open ? 'In session' : `Session in ${daysFrom(ctx, sess.opensAt - state.clock.tick)}d`,
        nearest ? `Promise: ${daysFrom(ctx, nearest.expiresTick - state.clock.tick)}d` : '',
      ];
      const key = text.join('|');
      if (key === last) return;
      last = key;
      authority.textContent = text[0];
      session.textContent = text[1];
      session.dataset.open = String(sess.open);
      promise.textContent = text[2];
      promise.hidden = !nearest;
    },
  };
}
