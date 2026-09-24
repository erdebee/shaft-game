/**
 * lawText.js
 * Effects and predicates in words, for the ruling modal and the Accord tab.
 * One describer for both, so a law card and the ruling that codifies it read
 * the same way. Anything with nothing to say to the player (a flag, a
 * precedent record) says nothing.
 */

import { el } from './dom.js';

/** Metres where a rise is bad news, for the tone of a line. */
const WORSE_UP = new Set(['discontent', 'board-doubt']);

export const LEANING_NAMES = { harsh: 'Harsh', pragmatic: 'Pragmatic', lenient: 'Lenient' };

/** 'ration-theft' → 'Ration theft'. */
export function humanize(id) {
  const s = String(id).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ticks as in-world days: whole from ten up, one decimal below. */
export function daysFrom(ctx, ticks) {
  const perDay = ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay;
  const d = ticks / perDay;
  return d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
}

const signed = (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)}`;
const tone = (v, worseUp = false) => ((v > 0) !== worseUp ? 'up' : 'down');
const percent = (m) => `${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}%`;

function nameIn(ctx, id) {
  for (const kind of ['meters', 'stocks', 'components', 'flows', 'abstracts', 'minerals', 'buildings', 'factions']) {
    const def = ctx.catalog[kind]?.byId?.[id];
    if (def?.name) return def.name;
  }
  return humanize(id);
}

/** One effect as { text, tone }, or null when it has nothing to say. */
export function describeEffect(ctx, e) {
  switch (e.op) {
    case 'meter.add':
      if (e.value === 0) return null;
      return { text: `${nameIn(ctx, e.target)} ${signed(e.value)}${e.reputation ? (e.reputation > 1 ? ' (your word is good)' : ' (your word is doubted)') : ''}`, tone: tone(e.value, WORSE_UP.has(e.target)) };
    case 'meter.shift':
      return { text: `${nameIn(ctx, e.target)} ${signed(e.value)} for good`, tone: tone(e.value, WORSE_UP.has(e.target)) };
    case 'stock.add':
    case 'focus.add':
    case 'faction.satisfaction':
      return { text: `${nameIn(ctx, e.target)} ${signed(e.value)}`, tone: tone(e.value) };
    case 'authority.add':
      return { text: `Authority ${signed(e.value)}`, tone: tone(e.value) };
    case 'doubt.add':
      return { text: `Board doubt ${signed(e.value)}`, tone: tone(e.value, true) };
    case 'consumption.multiply':
      return { text: `${nameIn(ctx, e.target)} used ${percent(e.value)}`, tone: null };
    case 'zone.outputMultiply':
      return { text: `Output in the zone ${percent(e.value)}`, tone: tone(e.value - 1) };
    case 'risk.add':
      return { text: `${humanize(e.target)} risk ${signed(e.value)}`, tone: tone(e.value, true) };
    case 'population.healthRate':
      return { text: e.value < 0 ? 'Health wears down while it stands' : 'Health recovers faster', tone: tone(e.value) };
    case 'lottery.slotsMultiply':
      return { text: `Birth lottery places ${percent(e.value)}`, tone: null };
    case 'capability.enable':
      return { text: `Creates ${humanize(e.target).toLowerCase()}`, tone: null };
    case 'timer.start':
      return e.promise
        ? { text: `Promise: ${e.label ?? humanize(e.target)} — ${daysFrom(ctx, e.ticks)} days`, tone: 'promise' }
        : null;
    case 'statute.enact':
      return { text: `Enacts ${ctx.content.lawCards.byId[e.target]?.title ?? humanize(e.target)}`, tone: 'law' };
    case 'building.demolish':
      return { text: `Tears down the ${nameIn(ctx, e.target).toLowerCase()}`, tone: 'down' };
    case 'building.resize':
      return { text: `${nameIn(ctx, e.target)} ${signed(e.value)} slot`, tone: null };
    case 'priority.reorder':
      return { text: `${humanize(e.target)} moves up the power ladder`, tone: null };
    default:
      return null;
  }
}

export function describeEffects(ctx, effects) {
  return (effects ?? []).map((e) => describeEffect(ctx, e)).filter(Boolean);
}

/** A row of effect chips. */
export function effectList(ctx, effects, className = 'law-effects') {
  const row = el('span', className);
  for (const { text, tone: t } of describeEffects(ctx, effects)) {
    const chip = el('span', 'law-effect', text);
    if (t) chip.dataset.tone = t;
    row.appendChild(chip);
  }
  return row;
}

/** A predicate as a short clause: what has to be true. */
export function describePredicate(ctx, p) {
  if (!p) return '';
  if (Array.isArray(p)) return p.map((q) => describePredicate(ctx, q)).join(', and ');
  switch (p.pred) {
    case 'all-of': return p.of.map((q) => describePredicate(ctx, q)).join(', and ');
    case 'any-of': return p.of.map((q) => describePredicate(ctx, q)).join(', or ');
    case 'building.exists': {
      const name = nameIn(ctx, p.target).toLowerCase();
      return name.endsWith('s') ? name : `a ${name}`;
    }
    case 'stock.above': return `more than ${p.value} ${nameIn(ctx, p.target).toLowerCase()}`;
    case 'stock.aboveDaysOfSupply': return `${nameIn(ctx, p.target).toLowerCase()} stores above ${p.value} days`;
    case 'stock.belowDaysOfSupply': return `${nameIn(ctx, p.target).toLowerCase()} stores below ${p.value} days`;
    case 'need.atLeast': return p.target === 'food' ? 'everyone fed' : `${p.target} served`;
    case 'need.below': return p.target === 'food' ? 'people going hungry' : `${p.target} short`;
    case 'meter.above': return `${nameIn(ctx, p.target).toLowerCase()} above ${p.value}`;
    case 'meter.below': return `${nameIn(ctx, p.target).toLowerCase()} below ${p.value}`;
    case 'statute.active': return `${ctx.content.lawCards.byId[p.target]?.title ?? humanize(p.target)} in force`;
    default: return humanize(p.pred);
  }
}
