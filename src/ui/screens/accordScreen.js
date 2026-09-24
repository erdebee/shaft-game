/**
 * accordScreen.js
 * The Accord tab: the law as it stands and the hand it could become.
 *
 *   SESSION     Authority held, and whether an amendment session sits —
 *               law changes only while one does (governance/statuteEngine.js).
 *   PROMISES    every promise outstanding, how long it has left, and whether
 *               the Shaft is holding up the player's end yet.
 *   IN FORCE    enacted law, how long it has stood, and what repeal would
 *               cost now; any pair that contradicts the other is named.
 *   LAW CARDS   what could be enacted, at this player's price — the surcharge
 *               for contradicting their own record is shown, not hidden.
 *   RECORD      the case history per theme, once a pattern shows, and which
 *               themes are settled enough to be made policy.
 *
 * Reads state, dispatches commands, writes nothing. The screen is rebuilt
 * only when what it shows changes (a key over the inputs), not every frame.
 */

import { el, button, card } from '../components/dom.js';
import { render as renderMeter } from '../components/resourceMeter.js';
import { sessionOf, costOf, check, conflicts, repealPenalty } from '../../governance/statuteEngine.js';
import { leaningOf, codification, LEANINGS } from '../../governance/precedentTracker.js';
import { effectList, describePredicate, daysFrom, LEANING_NAMES } from '../components/lawText.js';

const CATEGORY_NAMES = {
  'order-security': 'Order and security',
  economy: 'Economy',
  freedom: 'Freedom',
  information: 'Information',
  population: 'Population',
};

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();

  const session = card(root, 'The Accord');
  const authority = renderMeter(session, { label: 'Authority' });
  const sessionLine = el('div', 'accord-session');
  const conflictBox = el('div', 'accord-conflicts');
  session.append(sessionLine, conflictBox);

  const promises = card(root, 'Promises');
  const promiseList = el('div', 'accord-list');
  promises.appendChild(promiseList);

  const inForce = card(root, 'In force');
  const inForceList = el('div', 'accord-list');
  inForce.appendChild(inForceList);

  const hand = card(root, 'Law cards');
  const handList = el('div', 'accord-list');
  hand.appendChild(handList);

  const history = card(root, 'Case history');
  const historyList = el('div', 'accord-list');
  history.appendChild(historyList);

  let key = null;

  function build(s, c) {
    const open = sessionOf(s, c).open;

    // --- conflicts ---------------------------------------------------------
    conflictBox.replaceChildren(...conflicts(s, c).map(({ article, ids }) => {
      const [a, b] = ids.map((id) => c.content.lawCards.byId[id].title);
      const heading = c.content.articles.byId[article]?.title ?? article;
      return el('div', 'accord-conflict', `${a} and ${b} both govern the ${heading} and pull opposite ways.`);
    }));

    // --- promises ----------------------------------------------------------
    const timers = s.narrative.timers.filter((t) => t.promise);
    const { kept = 0, broken = 0 } = s.narrative.promiseRecord ?? {};
    promises.hidden = timers.length === 0 && kept + broken === 0;
    promiseList.replaceChildren(...timers.map((t) => {
      const row = el('div', 'accord-promise');
      const left = daysFrom(c, Math.max(0, t.expiresTick - s.clock.tick));
      const hold = t.holdTicks ?? c.config.narrative.promiseHoldTicks;
      const bar = el('span', 'accord-bar');
      const fill = el('span', 'accord-bar-fill');
      fill.style.width = `${Math.max(0, Math.min(100, 100 * (t.expiresTick - s.clock.tick) / (t.expiresTick - t.startTick)))}%`;
      bar.appendChild(fill);
      const status = t.heldTicks > 0
        ? `Holding: ${daysFrom(c, t.heldTicks)} of ${daysFrom(c, hold)} days`
        : `Kept once ${describePredicate(c, t.condition)} for ${daysFrom(c, hold)} days running`;
      row.append(
        el('div', 'accord-row-head', ''),
        bar,
        el('div', `accord-note${t.heldTicks > 0 ? ' holding' : ''}`, status),
      );
      row.firstChild.append(el('span', 'accord-title', t.label ?? t.id), el('span', 'accord-days', `${left} days left`));
      return row;
    }));
    if (kept + broken > 0) {
      promiseList.appendChild(el('div', 'accord-note', `Your word: kept ${kept}, broken ${broken}.`));
    }

    // --- in force ----------------------------------------------------------
    const enacted = s.governance.enacted;
    inForceList.replaceChildren(...(enacted.length ? enacted.map(({ id, enactedTick }) => {
      const law = c.content.lawCards.byId[id];
      const penalty = repealPenalty(s, c, id).penalty;
      const row = el('div', 'accord-law');
      const head = el('div', 'accord-row-head');
      head.append(el('span', 'accord-title', law.title), el('span', 'accord-days', `${daysFrom(c, s.clock.tick - enactedTick)} days`));
      const repeal = button(
        penalty ? `Repeal · −${penalty} stability and trust` : 'Repeal · no penalty yet',
        `Repeal ${law.title}`,
        () => dispatch({ type: 'player:repealStatute', cardId: id }),
        'accord-action',
      );
      repeal.disabled = !open || law.repealable === false;
      row.append(head, el('div', 'accord-note', c.content.articles.byId[law.article]?.title ?? ''), effectList(c, law.effects), repeal);
      return row;
    }) : [el('div', 'accord-note', 'Nothing enacted. The Accord stands as the founders left it.')]));

    // --- the hand ----------------------------------------------------------
    const cards = c.content.lawCards.ids.filter((id) => !enacted.some((e) => e.id === id));
    handList.replaceChildren(...cards.map((id) => {
      const law = c.content.lawCards.byId[id];
      const cost = costOf(s, c, id);
      const verdict = check(s, c, id);
      const row = el('div', 'accord-law');
      row.dataset.leaning = law.leaning;
      const head = el('div', 'accord-row-head');
      head.append(el('span', 'accord-title', law.title), el('span', 'accord-cost', `${cost.total} Authority`));
      row.append(head, el('div', 'accord-note', `${CATEGORY_NAMES[law.category] ?? law.category} · ${LEANING_NAMES[law.leaning]} on ${law.leaningTheme}`));
      if (cost.surcharge > 0) {
        row.appendChild(el('div', 'accord-note surcharge', `${cost.base} + ${cost.surcharge} against your own record on ${law.leaningTheme}`));
      }
      row.appendChild(effectList(c, law.effects));
      const enact = button('Enact', `Enact ${law.title}`, () => dispatch({ type: 'player:enactStatute', cardId: id }), 'accord-action');
      enact.disabled = !verdict.ok;
      row.appendChild(enact);
      if (!verdict.ok && verdict.reason !== 'closed') {
        const why = {
          requires: `Needs ${describePredicate(c, law.requires)}.`,
          authority: `You hold ${Math.floor(s.governance.authority)} Authority.`,
        }[verdict.reason];
        if (why) row.appendChild(el('div', 'accord-note', why));
      }
      return row;
    }));

    // --- case history ------------------------------------------------------
    historyList.replaceChildren(...c.content.precedentThemes.ids.map((themeId) => {
      const theme = c.content.precedentThemes.byId[themeId];
      const lean = leaningOf(s, c, themeId);
      const row = el('div', 'accord-theme');
      row.appendChild(el('div', 'accord-title', theme.name));
      if (!lean.visible) {
        row.appendChild(el('div', 'accord-note', 'No settled pattern yet.'));
        return row;
      }
      const counts = el('div', 'accord-counts');
      for (const l of LEANINGS) {
        const pip = el('span', `case-count${l === lean.leaning ? ' lead' : ''}`, `${LEANING_NAMES[l]} ${lean.counts[l]}`);
        counts.appendChild(pip);
      }
      row.appendChild(counts);
      const settled = codification(s, c, themeId);
      if (settled) {
        const law = c.content.lawCards.byId[settled.cardId];
        row.appendChild(el('div', 'accord-note settled', `Settled. The next ${theme.name.toLowerCase()} case can be made policy: ${law.title}, for ${settled.cost} Authority.`));
      }
      return row;
    }));
  }

  return {
    update(s, c) {
      const sess = sessionOf(s, c);
      const cap = c.config.governance.authorityCap;
      authority.update(s.governance.authority, cap, 'ok', `${Math.floor(s.governance.authority)} of ${cap}`);
      sessionLine.textContent = sess.open
        ? `In session: the Accord may be amended for ${daysFrom(c, sess.closesAt - s.clock.tick)} more days.`
        : `Out of session. The next opens in ${daysFrom(c, sess.opensAt - s.clock.tick)} days.`;
      sessionLine.dataset.open = String(sess.open);

      const perDay = c.config.clock.ticksPerShift * c.config.clock.shiftsPerDay;
      const next = JSON.stringify([
        sess.open, Math.floor(s.governance.authority), s.governance.enacted, s.governance.precedent,
        s.narrative.timers.map((t) => [t.id, Math.floor((t.expiresTick - s.clock.tick) / perDay * 10), Math.floor(t.heldTicks / 6)]),
        s.narrative.promiseRecord, Math.floor(s.clock.tick / perDay),
        c.content.lawCards.ids.map((id) => check(s, c, id).reason),
      ]);
      if (next === key) return;
      key = next;
      build(s, c);
    },
  };
}
