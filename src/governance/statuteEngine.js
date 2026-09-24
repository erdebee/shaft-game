/**
 * statuteEngine.js
 * The Accord editor's rules: when law may change, what a law card costs, what
 * repealing one costs, and where the Accord contradicts itself. This is the
 * bridge between the law the player writes and the numbers the simulation
 * uses — though the bridge itself is short, because an enacted card's
 * effects are standing modifiers that core/effects.js collectModifiers reads
 * every tick. Repeal needs no undo: the card stops being read.
 *
 *   SESSIONS   law changes only while an amendment session sits. One opens
 *              every clock.ticksPerAmendmentWindow ticks, the first at tick
 *              0, and sits for governance.sessionTicks; Authority is paid as
 *              it opens. Derived from the tick, so it needs no state.
 *   COST       authorityCost, plus governance.contradictionSurchargePerLeaningStep
 *              of it per leaning step the player's own rulings sit away from
 *              the card (precedentTracker.js contradictionSteps). Proposing
 *              assembly rights after three harsh dissent rulings costs more
 *              than twice its price, and reads as hypocrisy.
 *   REPEAL     free of Authority, but costs flipFlopPenaltyPerWindowStood per
 *              amendment window the law stood, off each flipFlopMeters meter.
 *              Early experimentation is cheap; reversing entrenched law is not.
 *
 * Owns state.governance.enacted and state.governance.history. Enactment
 * itself goes through the `statute.enact` effect, so a law enacted from this
 * screen and one codified from a ruling take force the same way.
 */

import { applyEffects } from '../core/effects.js';
import { evaluate } from '../core/predicates.js';
import { spend, earn, canAfford } from './authorityLedger.js';
import { contradictionSteps, leaningDistance } from './precedentTracker.js';

/** Where the amendment calendar stands: is a session sitting, and until when. */
export function sessionOf(state, ctx) {
  const every = ctx.config.clock.ticksPerAmendmentWindow;
  const sits = ctx.config.governance.sessionTicks;
  const tick = state.clock.tick;
  const opened = tick - (tick % every);
  const open = tick - opened < sits;
  return { open, closesAt: opened + sits, opensAt: open ? opened : opened + every };
}

/** What a card costs this player, and why. */
export function costOf(state, ctx, cardId) {
  const card = ctx.content.lawCards.byId[cardId];
  const base = card.authorityCost;
  const steps = contradictionSteps(state, card.leaningTheme, card.leaning);
  const surcharge = Math.ceil(base * ctx.config.governance.contradictionSurchargePerLeaningStep * steps);
  return { base, steps, surcharge, total: base + surcharge };
}

/**
 * Whether a card can be enacted now. reason is one of 'closed', 'enacted',
 * 'requires', 'authority', or null when it can.
 */
export function check(state, ctx, cardId) {
  const card = ctx.content.lawCards.byId[cardId];
  if (!card) throw new Error(`statuteEngine: unknown law card "${cardId}"`);
  const cost = costOf(state, ctx, cardId);
  const refuse = (reason) => ({ ok: false, reason, cost });
  if (state.governance.enacted.some((e) => e.id === cardId)) return refuse('enacted');
  if (!sessionOf(state, ctx).open) return refuse('closed');
  if (!evaluate(state, ctx, card.requires)) return refuse('requires');
  if (!canAfford(state, cost.total)) return refuse('authority');
  return { ok: true, reason: null, cost };
}

/** Enact a card from the Accord: pay for it, and it takes force. */
export function enact(state, ctx, cardId) {
  const verdict = check(state, ctx, cardId);
  if (!verdict.ok) return verdict;
  spend(state, verdict.cost.total);
  applyEffects(state, ctx, [{ op: 'statute.enact', target: cardId, via: 'accord' }], `accord:${cardId}`);
  return verdict;
}

/** What repealing an enacted card would cost, per flipFlopMeters meter. */
export function repealPenalty(state, ctx, cardId) {
  const record = state.governance.enacted.find((e) => e.id === cardId);
  if (!record) return null;
  const g = ctx.config.governance;
  const windows = (state.clock.tick - record.enactedTick) / ctx.config.clock.ticksPerAmendmentWindow;
  const penalty = Math.round(Math.min(g.flipFlopPenaltyCap, g.flipFlopPenaltyPerWindowStood * windows));
  return { windows, penalty, meters: g.flipFlopMeters };
}

/**
 * Strike a card from the Accord. Its standing effects stop at once; what it
 * did on the day it was enacted stays done, and the history keeps both acts —
 * repeal removes effects without rewriting what happened.
 */
export function repeal(state, ctx, cardId) {
  const cost = repealPenalty(state, ctx, cardId);
  if (!cost) return { ok: false, reason: 'not-enacted' };
  if (!sessionOf(state, ctx).open) return { ok: false, reason: 'closed' };
  if (ctx.content.lawCards.byId[cardId]?.repealable === false) return { ok: false, reason: 'unrepealable' };

  state.governance.enacted = state.governance.enacted.filter((e) => e.id !== cardId);
  state.governance.history ??= [];
  state.governance.history.push({ id: cardId, tick: state.clock.tick, act: 'repealed', penalty: cost.penalty });
  if (cost.penalty > 0) {
    applyEffects(state, ctx, cost.meters.map((target) => ({ op: 'meter.add', target, value: -cost.penalty })), `repeal:${cardId}`);
  }
  return { ok: true, reason: null, penalty: cost.penalty };
}

/**
 * Enacted cards that govern the same article and pull opposite ways — a
 * curfew and assembly rights, both law. Reported, never silently resolved:
 * the player wrote both, and deciding which one wins is theirs.
 */
export function conflicts(state, ctx) {
  const cards = state.governance.enacted.map((e) => ctx.content.lawCards.byId[e.id]).filter(Boolean);
  const found = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const [a, b] = [cards[i], cards[j]];
      if (a.article === b.article && leaningDistance(a.leaning, b.leaning) === 2) {
        found.push({ article: a.article, ids: [a.id, b.id] });
      }
    }
  }
  return found;
}

/** Open and close sessions, paying Authority as one opens. */
export function tick(state, ctx) {
  const every = ctx.config.clock.ticksPerAmendmentWindow;
  const at = state.clock.tick % every;
  if (at === 0) {
    earn(state, ctx, ctx.config.governance.authorityRegenPerWindow);
    ctx.emit('accord:sessionOpened', { authority: state.governance.authority });
  } else if (at === ctx.config.governance.sessionTicks) {
    ctx.emit('accord:sessionClosed', {});
  }
}
