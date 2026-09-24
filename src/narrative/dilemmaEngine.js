/**
 * dilemmaEngine.js
 * Selects, presents and resolves dilemmas. A dilemma is eligible when it
 * belongs to this chapter, its preconditions hold, its cooldown has elapsed
 * since it was last ruled on, a one-shot one has not fired, and at least one
 * of its rulings can be given. Selection is a weighted draw from the
 * `narrative` stream, at most once per narrative.dilemmaBaseIntervalTicks
 * (± jitter); when nothing is eligible the engine looks again next shift,
 * without drawing.
 *
 * A raised dilemma sits in state.narrative.activeDilemma until the player
 * rules (commands.js player:resolveDilemma), and a hard-pausing one holds the
 * clock still until then (core/engine.js). Only the id and what was decided
 * at raise time are stored; the prompt and the rulings on offer are derived
 * by present(), because they depend on the law and the stores as they stand.
 *
 * Where the law engine meets the case:
 *   VARIANTS      the first variant whose `when` holds rewrites the prompt
 *                 and withdraws options — with rationing quotas already law,
 *                 the ration thief is not made an example of.
 *   CODIFICATION  once a theme's leaning is settled (precedentTracker.js
 *                 codification), its next case offers one more ruling: the
 *                 settled one, made policy, at a discount.
 *   PROMISES      a lenient ruling's gains are worth more from a Mayor who
 *                 keeps promises, and less from one who has broken one.
 *
 * Effects apply through core/effects.js. Reads of precedent come from
 * governance/precedentTracker.js; nothing here writes the governance domain
 * except through effects and the case record.
 */

import { evaluate } from '../core/predicates.js';
import { applyEffects } from '../core/effects.js';
import { codification, record, findSimilar, leaningOf } from '../governance/precedentTracker.js';
import { canAfford } from '../governance/authorityLedger.js';

/** The flags a promise's own content sets when it is kept or broken. */
export const PROMISE_FLAGS = { kept: 'keeps-promises', broken: 'broken-promise' };

export function tick(state, ctx) {
  const n = state.narrative;
  if (n.activeDilemma) return;
  if (n.nextDilemmaTick === null || n.nextDilemmaTick === undefined) n.nextDilemmaTick = state.clock.tick + interval(ctx);
  if (state.clock.tick < n.nextDilemmaTick) return;

  const pool = ctx.content.dilemmas.ids
    .map((id) => ctx.content.dilemmas.byId[id])
    .filter((d) => eligible(d, state, ctx));
  if (pool.length === 0) {
    n.nextDilemmaTick = state.clock.tick + ctx.config.clock.ticksPerShift;
    return;
  }
  raise(state, ctx, weighted(pool, ctx.rng.narrative).id);
  n.nextDilemmaTick = state.clock.tick + interval(ctx);
}

function interval(ctx) {
  const { dilemmaBaseIntervalTicks: base, dilemmaIntervalJitterTicks: jitter } = ctx.config.narrative;
  return Math.max(1, base + ctx.rng.narrative.int(-jitter, jitter));
}

function weighted(pool, rng) {
  const sum = pool.reduce((s, d) => s + (d.weight ?? 1), 0);
  let roll = rng.next() * sum;
  for (const d of pool) {
    roll -= d.weight ?? 1;
    if (roll < 0) return d;
  }
  return pool.at(-1);
}

export function eligible(dilemma, state, ctx) {
  const n = state.narrative;
  if (dilemma.chapter !== null && dilemma.chapter !== undefined && dilemma.chapter !== state.meta.chapter) return false;
  if (dilemma.oneShot && (n.firedDilemmas ?? []).includes(dilemma.id)) return false;
  const last = n.dilemmaCooldowns[dilemma.id];
  if (last !== undefined && state.clock.tick - last < (dilemma.cooldownTicks ?? 0)) return false;
  if (!evaluate(state, ctx, dilemma.preconditions)) return false;
  return rulings(state, ctx, dilemma, null).some((o) => o.available);
}

/**
 * Put a dilemma in front of the player. What the codified ruling would be is
 * settled now, so its price cannot move while the player reads.
 */
export function raise(state, ctx, dilemmaId) {
  const dilemma = ctx.content.dilemmas.byId[dilemmaId];
  if (!dilemma) throw new Error(`dilemmaEngine: unknown dilemma "${dilemmaId}"`);
  state.narrative.activeDilemma = {
    id: dilemmaId,
    raisedTick: state.clock.tick,
    hardPause: dilemma.hardPause !== false && ctx.config.narrative.dilemmaHardPause,
    codify: codification(state, ctx, dilemma.theme),
  };
  ctx.emit('dilemma:raised', { dilemmaId, theme: dilemma.theme });
}

/**
 * The active dilemma as the player sees it: the prompt after any variant,
 * the rulings on offer with the effects they will actually have, the theme's
 * case history, and the earlier rulings on this same case.
 */
export function present(state, ctx) {
  const active = state.narrative.activeDilemma;
  if (!active) return null;
  const dilemma = ctx.content.dilemmas.byId[active.id];
  const variant = variantOf(state, ctx, dilemma);
  return {
    id: dilemma.id,
    theme: dilemma.theme,
    raisedTick: active.raisedTick,
    prompt: variant?.prompt || dilemma.prompt,
    variant: variant !== null,
    options: rulings(state, ctx, dilemma, active.codify),
    leaning: leaningOf(state, ctx, dilemma.theme),
    similar: findSimilar(state, dilemma.id),
  };
}

function variantOf(state, ctx, dilemma) {
  return (dilemma.variants ?? []).find((v) => evaluate(state, ctx, v.when)) ?? null;
}

/**
 * The rulings on offer, variant-withdrawn ones left out, each with whether it
 * can be given and the effects it would have. `codify` appends the settled
 * leaning's ruling made policy, built on the first ruling of that leaning.
 */
function rulings(state, ctx, dilemma, codify) {
  const withdrawn = new Set(variantOf(state, ctx, dilemma)?.removeOptions ?? []);
  const offered = dilemma.options.filter((o) => !withdrawn.has(o.id));
  const out = offered.map((o) => ruling(state, ctx, o));

  const base = codify && offered.find((o) => o.leaning === codify.leaning);
  const card = codify && ctx.content.lawCards.byId[codify.cardId];
  if (base && card) {
    const made = ruling(state, ctx, {
      ...base,
      id: 'codify',
      label: `Make it policy: ${card.title}`,
      detail: `Rule as before — ${base.label.toLowerCase()} — and write it into the Accord. The Shaft already expects it.`,
      effects: [
        ...base.effects,
        { op: 'authority.add', value: -codify.cost },
        { op: 'statute.enact', target: codify.cardId, via: 'codified' },
      ],
    });
    made.codify = { ...codify, basedOn: base.id };
    if (made.available && !canAfford(state, codify.cost)) Object.assign(made, { available: false, reason: 'authority' });
    out.push(made);
  }
  return out;
}

function ruling(state, ctx, option) {
  const unmet = (option.requires ?? []).filter((p) => !evaluate(state, ctx, p));
  const promised = (option.effects ?? []).find((e) => e.op === 'timer.start'
    && state.narrative.timers.some((t) => t.id === e.target));
  let reason = null;
  if (unmet.length) reason = 'requires';
  else if (promised) reason = 'promised';
  return {
    id: option.id,
    label: option.label,
    detail: option.detail,
    leaning: option.leaning,
    effects: withReputation(state, ctx, option),
    available: reason === null,
    reason,
    unmet,
  };
}

/**
 * A lenient ruling's gains, as the Shaft will take them from this Mayor:
 * stronger for one who keeps promises, weaker for one who has broken one.
 * Only immediate gains move — a promise's own terms are the promise.
 */
function withReputation(state, ctx, option) {
  const effects = option.effects ?? [];
  if (option.leaning !== 'lenient') return effects;
  const cfg = ctx.config.narrative;
  let k = 1;
  if (state.narrative.flags[PROMISE_FLAGS.kept]) k *= 1 + cfg.promiseKeptSoftBonus;
  if (state.narrative.flags[PROMISE_FLAGS.broken]) k *= 1 - cfg.promiseBrokenSoftMalus;
  if (k === 1) return effects;
  return effects.map((e) => (e.op === 'meter.add' && e.value > 0
    ? { ...e, value: Math.round(e.value * k * 10) / 10, reputation: k }
    : e));
}

/**
 * Rule on the active dilemma. Returns whether the ruling was given; one that
 * is not on offer, or cannot be given, changes nothing.
 */
export function resolve(state, ctx, dilemmaId, optionId) {
  const view = present(state, ctx);
  if (!view || view.id !== dilemmaId) return false;
  const option = view.options.find((o) => o.id === optionId);
  if (!option || !option.available) return false;
  const dilemma = ctx.content.dilemmas.byId[dilemmaId];

  applyEffects(state, ctx, option.effects, `dilemma:${dilemmaId}:${optionId}`);
  record(state, { dilemmaId, optionId, theme: dilemma.theme, leaning: option.leaning });

  const n = state.narrative;
  n.activeDilemma = null;
  n.dilemmaCooldowns[dilemmaId] = state.clock.tick;
  if (dilemma.oneShot) (n.firedDilemmas ??= []).push(dilemmaId);
  ctx.emit('dilemma:resolved', {
    dilemmaId, optionId, label: option.label, leaning: option.leaning, theme: dilemma.theme,
    codified: option.codify?.cardId ?? null,
  });
  return true;
}
