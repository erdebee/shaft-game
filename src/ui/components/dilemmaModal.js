/**
 * dilemmaModal.js
 * Presents the active dilemma and its rulings. Shows what is known, not what
 * is true — consequences are stated as the advisor's expectation, which may
 * be wrong.
 *
 * Opens itself whenever state.narrative.activeDilemma is set and closes when
 * it clears, so a loaded save with an open case shows it without any extra
 * wiring. Each ruling bundles a systemic response and a judgment on the
 * person, and carries its leaning; the case history for the theme shows once
 * the player has one, and a settled pattern appears as one more ruling —
 * make it policy — styled as the law it would become.
 *
 * Reads state, dispatches player:resolveDilemma, writes nothing.
 */

import { el } from './dom.js';
import { present } from '../../narrative/dilemmaEngine.js';
import { calendar } from '../../core/clock.js';
import { effectList, describePredicate, humanize, LEANING_NAMES } from './lawText.js';

export function mount(host, dispatch) {
  const overlay = el('div', 'case-overlay');
  overlay.hidden = true;
  const dialog = el('div', 'case');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'case-title');
  overlay.appendChild(dialog);
  host.appendChild(overlay);

  let shownKey = null;

  function build(state, ctx, view) {
    const dilemma = ctx.content.dilemmas.byId[view.id];
    const theme = ctx.content.precedentThemes.byId[view.theme];
    const day = calendar({ ...state.clock, tick: view.raisedTick }).day;

    const title = el('h2', 'case-title', dilemma.title ?? humanize(view.id));
    title.id = 'case-title';
    dialog.replaceChildren(
      el('div', 'case-kicker', `A case · ${theme?.name ?? humanize(view.theme)} · day ${day}`),
      title,
      el('p', 'case-prompt', view.prompt),
      record(ctx, view),
    );

    const options = el('div', 'case-options');
    for (const option of view.options) options.appendChild(ruling(state, ctx, view, option));
    dialog.appendChild(options);
    dialog.appendChild(el('p', 'case-foot', 'The effects are your advisors’ expectation. The Shaft keeps its own count.'));

    const first = options.querySelector('button:not([disabled])');
    first?.focus();
  }

  function ruling(state, ctx, view, option) {
    const b = el('button', `case-option${option.codify ? ' codify' : ''}`);
    b.type = 'button';
    b.dataset.leaning = option.leaning;
    const head = el('span', 'case-option-head');
    head.append(el('span', 'case-option-label', option.label), el('span', 'case-leaning', LEANING_NAMES[option.leaning] ?? option.leaning));
    b.append(head, el('span', 'case-option-detail', option.detail ?? ''), effectList(ctx, option.effects));
    if (option.codify) {
      const full = ctx.content.lawCards.byId[option.codify.cardId]?.authorityCost;
      b.appendChild(el('span', 'case-codify-note', `${option.codify.cost} Authority, down from ${full}: the Shaft already expects it.`));
    }
    if (!option.available) {
      b.disabled = true;
      b.appendChild(el('span', 'case-why', whyNot(state, ctx, option)));
    }
    b.addEventListener('click', () => dispatch({ type: 'player:resolveDilemma', dilemmaId: view.id, optionId: option.id }));
    return b;
  }

  return {
    update(state, ctx) {
      const view = present(state, ctx);
      if (!view) {
        if (!overlay.hidden) overlay.hidden = true;
        shownKey = null;
        return;
      }
      const key = `${view.id}:${view.raisedTick}:${view.options.map((o) => `${o.id}${o.available ? '+' : '-'}`).join()}`;
      if (key === shownKey) return;
      shownKey = key;
      overlay.hidden = false;
      build(state, ctx, view);
    },
  };
}

/** The theme's case history, once there is one, and the last ruling on this case. */
function record(ctx, view) {
  const box = el('div', 'case-record');
  const theme = ctx.content.precedentThemes.byId[view.theme];
  const { visible, counts, leaning } = view.leaning;
  if (visible) {
    box.appendChild(el('span', '', `Your record on ${theme.name.toLowerCase()}: `));
    for (const [l, n] of Object.entries(counts)) {
      const pip = el('span', `case-count${l === leaning ? ' lead' : ''}`, `${LEANING_NAMES[l]} ${n}`);
      box.appendChild(pip);
    }
  } else {
    box.appendChild(el('span', '', `No settled record on ${theme?.name.toLowerCase() ?? view.theme} yet.`));
  }
  const last = view.similar[0];
  if (last) {
    const dilemma = ctx.content.dilemmas.byId[view.id];
    const label = dilemma.options.find((o) => o.id === last.optionId)?.label ?? humanize(last.optionId);
    const day = Math.floor(last.tick / (ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay)) + 1;
    box.appendChild(el('div', 'case-last', `Last time, on day ${day}, you ruled: ${label}.`));
  }
  return box;
}

function whyNot(state, ctx, option) {
  if (option.reason === 'requires') return `Needs ${describePredicate(ctx, option.unmet)}.`;
  if (option.reason === 'promised') return 'You have already given your word on this.';
  if (option.reason === 'authority') return `Needs ${option.codify.cost} Authority; you hold ${Math.floor(state.governance.authority)}.`;
  return 'Not possible now.';
}
