/**
 * promiseTimers.js
 * Runs the timers `timer.start` sets — above all promises, which are a gamble
 * rather than a free option. A timer carries a condition, which is what it
 * means to keep it, and two effect lists:
 *
 *   KEPT     the condition has held holdTicks ticks in a row (the timer's
 *            own, else narrative.promiseHoldTicks), or holds on the tick the
 *            deadline falls: onMet applies.
 *            Early is allowed — a shortage that ends in week two ended
 *            within the month — but a single good tick is not enough.
 *   BROKEN   the deadline falls and the condition does not hold: onExpire.
 *
 * A timer with no condition simply runs out and applies onExpire.
 *
 * Owns state.narrative.timers and state.narrative.promiseRecord. What keeping
 * or breaking a promise does lives in the content's onMet and onExpire.
 */

import { evaluate } from '../core/predicates.js';
import { applyEffects } from '../core/effects.js';

export function tick(state, ctx) {
  const n = state.narrative;
  if (n.timers.length === 0) return;
  const done = [];

  for (const timer of n.timers) {
    const holds = timer.condition ? evaluate(state, ctx, timer.condition) : false;
    timer.heldTicks = holds ? (timer.heldTicks ?? 0) + 1 : 0;
    const due = state.clock.tick >= timer.expiresTick;
    const hold = timer.holdTicks ?? ctx.config.narrative.promiseHoldTicks;
    if (timer.condition && (timer.heldTicks >= hold || (due && holds))) done.push([timer, true]);
    else if (due) done.push([timer, false]);
  }

  for (const [timer, kept] of done) {
    n.timers = n.timers.filter((t) => t !== timer);
    applyEffects(state, ctx, kept ? timer.onMet : timer.onExpire, `timer:${timer.id}`);
    if (timer.promise) {
      n.promiseRecord ??= { kept: 0, broken: 0 };
      n.promiseRecord[kept ? 'kept' : 'broken'] += 1;
      ctx.emit(kept ? 'promise:kept' : 'promise:broken', { id: timer.id, label: timer.label });
    } else {
      ctx.emit('timer:done', { id: timer.id, met: kept });
    }
  }
}
