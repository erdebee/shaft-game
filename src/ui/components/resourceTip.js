/**
 * resourceTip.js
 * The card that opens over any resource icon: what the thing is, a line from
 * someone who has to live with it, who makes it and who uses it, and how fast
 * both are happening right now.
 *
 * One card for the whole page, found by delegation. Anything carrying
 * `data-resource="<id>"` gets it — an icon in the inspector, a slot on a
 * room's shortage plate in the shaft — so a new place that shows an icon
 * needs the attribute and nothing else. Keyboard focus opens it too, which is
 * why the inspector's icons are focusable.
 *
 * The description and the quote are catalogue text (resources/data/catalog/
 * resources/*.json). The rates are live: goods from the ledger
 * (systems/resources/ledger.js), networks and abstracts from their own state.
 * Refreshed once a sim tick while open, never per frame.
 */

import { el } from './dom.js';
import { iconOf } from '../icons.js';
import { nameOf, total } from '../../systems/resources/stores.js';
import { ratesOf, sourcesOf, sourceName } from '../../systems/resources/ledger.js';
import { powerDemand, workScale } from '../../systems/buildings/buildingRegistry.js';
import { breathable } from '../../core/selectors.js';

const KINDS = [
  ['stocks', 'Stock'],
  ['minerals', 'Mineral'],
  ['components', 'Component'],
  ['flows', 'Network'],
  ['abstracts', 'Abstract'],
];

const UNITS = {
  t: 'tonnes', kg: 'kg', km: 'km', m2: 'm²', m3: 'm³', kW: 'kW',
  ration: 'rations', quire: 'quires', unit: 'units', index: 'index',
  'worker-shift': 'worker-shifts', focus: 'focus', authority: 'authority',
};

/** At most this many rows per list; the rest fold into "and N more". */
const ROWS = 6;

/**
 * Under this, a rate reads as nothing. A source that has stopped decays in the
 * ledger rather than vanishing, and "0.01 a day" from a workshop that went
 * idle yesterday is noise, not news.
 */
const QUIET = 0.05;

let tip = null;

/**
 * Attach the card to the page. `get()` returns the live `{ state, ctx }`; the
 * card reads it when it opens and on every update() while open.
 */
export function mount(get) {
  tip = {
    get,
    node: el('div', 'res-tip'),
    target: null,
    id: null,
    tick: null,
    live: null,
  };
  tip.node.setAttribute('role', 'tooltip');
  tip.node.id = 'res-tip';
  document.body.appendChild(tip.node);

  // Pointer and focus both open it; leaving the icon, pressing anywhere or
  // scrolling closes it. A press is how the shaft starts a drag, and a card
  // hanging where the icon used to be is worse than no card.
  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-resource]');
    if (target) open(target);
  });
  document.addEventListener('pointerout', (event) => {
    if (!tip.target) return;
    const into = event.relatedTarget;
    if (into && tip.target.contains(into)) return;
    if (event.target.closest?.('[data-resource]') === tip.target) close();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('[data-resource]');
    if (target) open(target);
  });
  document.addEventListener('focusout', (event) => {
    if (event.target === tip.target) close();
  });
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('scroll', close, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
}

/** Per frame from main.js. Cheap when closed; one rebuild per tick when open. */
export function update() {
  if (!tip?.target) return;
  // The icon went away under the pointer — the plate cleared, the inspector
  // switched rooms. Nothing will send a pointerout for it.
  if (!tip.target.isConnected || tip.target.dataset.resource !== tip.id) {
    close();
    return;
  }
  const { state, ctx } = tip.get();
  if (state.clock.tick === tip.tick) return;
  tip.tick = state.clock.tick;
  renderLive(tip.live, state, ctx, tip.id);
}

function open(target) {
  const id = target.dataset.resource;
  if (!id) return;
  if (tip.target === target && tip.id === id) return;
  tip.target = target;
  tip.id = id;
  const { state, ctx } = tip.get();
  tip.tick = state.clock.tick;
  tip.live = build(tip.node, state, ctx, id);
  target.setAttribute('aria-describedby', 'res-tip');
  tip.node.classList.add('shown');
  place(tip.node, target);
}

function close() {
  if (!tip?.target) return;
  tip.target.removeAttribute('aria-describedby');
  tip.target = null;
  tip.id = null;
  tip.node.classList.remove('shown');
}

/**
 * Beside the icon, on whichever side has room: right first, since the shaft is
 * on the left of the screen and the panel on the right, then left, then
 * clamped into the viewport.
 */
function place(node, target) {
  const r = target.getBoundingClientRect();
  const gap = 8;
  node.style.left = '0px';
  node.style.top = '0px';
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let x = r.right + gap;
  if (x + w > vw - gap) x = r.left - gap - w;
  x = Math.max(gap, Math.min(x, vw - w - gap));
  let y = r.top;
  y = Math.max(gap, Math.min(y, vh - h - gap));
  node.style.left = `${Math.round(x)}px`;
  node.style.top = `${Math.round(y)}px`;
}

/** The whole card. Returns the nodes that update() refills each tick. */
function build(root, state, ctx, id) {
  const def = definitionOf(ctx, id);
  const [kind] = KINDS.find(([k]) => ctx.catalog[k]?.byId?.[id]) ?? [];
  const label = KINDS.find(([k]) => k === kind)?.[1] ?? 'Resource';
  root.replaceChildren();

  const head = el('div', 'res-tip-head');
  const icon = iconOf(id);
  if (icon) {
    const img = el('img', 'res-tip-icon');
    img.src = icon.href;
    img.alt = '';
    head.appendChild(img);
  }
  const title = el('div', 'res-tip-title');
  title.append(
    el('div', 'res-tip-name', nameOf(ctx, id)),
    el('div', 'res-tip-kind', def?.unit ? `${label} · ${UNITS[def.unit] ?? def.unit}` : label),
  );
  head.appendChild(title);
  root.appendChild(head);

  if (def?.description) root.appendChild(el('p', 'res-tip-desc', def.description));
  if (def?.quote?.text) {
    const quote = el('blockquote', 'res-tip-quote');
    quote.append(el('span', '', `“${def.quote.text}”`));
    if (def.quote.by) quote.append(el('cite', '', `— ${def.quote.by}`));
    root.appendChild(quote);
  }

  const live = {
    totals: el('div', 'res-tip-totals'),
    made: el('div', 'res-tip-list'),
    used: el('div', 'res-tip-list'),
  };
  const madeHead = el('h4', 'res-tip-h', kind === 'abstracts' ? 'Comes from' : 'Made by');
  const usedHead = el('h4', 'res-tip-h', kind === 'abstracts' ? 'Spent on' : 'Used by');
  root.append(live.totals, madeHead, live.made, usedHead, live.used);
  renderLive(live, state, ctx, id);
  return live;
}

/**
 * The live half: the totals line and the two lists, each row a source with
 * how many are built and what it is doing right now.
 */
function renderLive(live, state, ctx, id) {
  const rates = liveRates(state, ctx, id);
  live.totals.replaceChildren(...rates.totals.map(([label, value, band]) => {
    const row = el('div', 'res-tip-total');
    const v = el('span', 'res-tip-value', value);
    if (band) v.dataset.band = band;
    row.append(el('span', '', label), v);
    return row;
  }));

  const { madeBy, usedBy } = sourcesOf(ctx, id);
  live.made.replaceChildren(...rows(state, ctx, madeBy, rates.made, rates.unit));
  live.used.replaceChildren(...rows(state, ctx, usedBy, rates.used, rates.unit));
}

/**
 * One row per source, busiest first. Every catalogue source is listed even at
 * zero — "none built" is part of the answer to "who makes this?" — and any
 * source the ledger saw that the catalogue did not predict is listed too.
 */
function rows(state, ctx, sources, rates, unit) {
  const all = [...sources];
  for (const source of Object.keys(rates)) if (!all.includes(source)) all.push(source);
  if (!all.length) return [el('div', 'res-tip-none', 'Nothing')];

  const built = (source) => state.buildings.filter((b) => b.buildingId === source).length;
  const isBuilding = (source) => Boolean(ctx.catalog.buildings.byId[source]);
  const entries = all.map((source) => ({
    source,
    rate: rates[source] ?? 0,
    count: isBuilding(source) ? built(source) : null,
  }));
  entries.sort((a, b) => b.rate - a.rate || (b.count ?? 0) - (a.count ?? 0) || all.indexOf(a.source) - all.indexOf(b.source));

  const out = entries.slice(0, ROWS).map(({ source, rate, count }) => {
    const row = el('div', 'res-tip-row');
    if (count === 0) row.classList.add('unbuilt');
    const name = el('span', 'res-tip-src', sourceName(ctx, source));
    if (count) name.appendChild(el('span', 'res-tip-count', ` ×${count}`));
    const value = count === 0 ? 'none built' : rate >= QUIET ? unit(rate) : '—';
    row.append(name, el('span', 'res-tip-rate', value));
    return row;
  });
  if (entries.length > ROWS) out.push(el('div', 'res-tip-none', `and ${entries.length - ROWS} more`));
  return out;
}

/**
 * What is happening to a resource right now, in whatever terms suit it:
 * a day's making and using for goods (from the ledger), kW for power,
 * cubic metres a day for water, an index for air, heads for labour.
 * `{ totals: [[label, text, band?]], made: {source: n}, used: {source: n}, unit(n) }`.
 */
function liveRates(state, ctx, id) {
  const perDay = ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay;
  const def = definitionOf(ctx, id);

  if (ctx.catalog.flows.byId[id] || ctx.catalog.abstracts.byId[id]) return flowRates(state, ctx, id, perDay);

  const unitName = UNITS[def?.unit] ?? def?.unit ?? '';
  const r = ratesOf(state, id);
  const toDay = (list) => Object.fromEntries(list.map(([s, q]) => [s, q * perDay]));
  const net = (r.madeTotal - r.usedTotal) * perDay;
  const band = Math.abs(net) < QUIET ? null : net > 0 ? 'ok' : 'warn';
  const sign = band === 'ok' ? '+' : band === 'warn' ? '−' : '';
  return {
    totals: [
      ['Making', `${fmt(r.madeTotal * perDay)} a day`],
      ['Using', `${fmt(r.usedTotal * perDay)} a day`],
      ['Net', `${sign}${fmt(band ? Math.abs(net) : 0)} a day`, band],
      ['In the Shaft', `${fmt(total(state, id))} ${unitName}`.trim()],
    ],
    made: toDay(r.made),
    used: toDay(r.used),
    unit: (n) => `${fmt(n)}/day`,
  };
}

function flowRates(state, ctx, id, perDay) {
  const byType = (fn) => {
    const out = {};
    for (const b of state.buildings) {
      const def = ctx.catalog.buildings.byId[b.buildingId];
      const v = def ? fn(b, def) : 0;
      if (v > 0) out[def.id] = (out[def.id] ?? 0) + v;
    }
    return out;
  };

  if (id === 'power') {
    const p = state.resources.flows.power;
    const gen = byType((b, def) => (b.powered === false || b.brokenDown ? 0 : (def.produces ?? []).find((x) => x.id === 'power')?.qty ?? 0));
    return {
      totals: [
        ['Generating', `${fmt(p.generation)} kW`],
        ['Demand', `${fmt(p.demand)} kW`, p.demand > p.generation ? 'critical' : null],
        ...(p.brownedOut.length ? [['Browned out', `${p.brownedOut.length} rooms`, 'critical']] : []),
      ],
      made: gen,
      used: byType((b, def) => powerDemand(b, def, ctx, state)),
      unit: (n) => `${fmt(n)} kW`,
    };
  }

  if (id === 'water') {
    const w = state.resources.flows.water;
    // What each room actually drew: its want, scaled as greywaterLoop scales
    // it, times the share it was given.
    const used = byType((b, def) => ((def.consumes ?? []).find((x) => x.id === 'water')?.qty ?? 0) * workScale(b, def, ctx) * (b.waterShare ?? 1) * perDay);
    if (w.toPeople > 0) used.people = w.toPeople * perDay;
    // The pumps share what was pumped by how much each could lift; the
    // reclamation plants, what was reclaimed.
    const made = {};
    const lift = byType((b, def) => ((def.produces ?? []).find((x) => x.id === 'water')?.qty ?? 0) * workScale(b, def, ctx));
    const lifts = Object.values(lift).reduce((a, b) => a + b, 0);
    for (const [source, qty] of Object.entries(lift)) made[source] = lifts > 0 ? (w.pumped ?? 0) * (qty / lifts) * perDay : 0;
    const reclaimers = byType((b, def) => ((def.effects ?? []).some((e) => e.op === 'reclamation.enable') ? workScale(b, def, ctx) : 0));
    const reclaim = Object.values(reclaimers).reduce((a, b) => a + b, 0);
    for (const [source, share] of Object.entries(reclaimers)) made[source] = reclaim > 0 ? (w.reclaimed ?? 0) * (share / reclaim) * perDay : 0;
    return {
      totals: [
        ['Supply', `${fmt(w.generation * perDay)} m³ a day`],
        ['Demand', `${fmt(w.demand * perDay)} m³ a day`, w.demand > w.generation + (w.stored ?? 0) ? 'critical' : null],
        ['In cisterns', `${fmt(w.stored ?? 0)} of ${fmt(w.capacity)} m³`],
        ['Quality', `${Math.round(w.quality)}%`, w.quality < 60 ? 'warn' : null],
      ],
      made,
      used,
      unit: (n) => `${fmt(n)} m³/day`,
    };
  }

  if (id === 'air-quality') {
    const lived = state.levels.filter((l) => state.buildings.some((b) => b.level === l.index));
    const avg = lived.length ? lived.reduce((s, l) => s + breathable(l), 0) / lived.length : 0;
    const worst = lived.reduce((w, l) => (w && breathable(w) <= breathable(l) ? w : l), null);
    const mean = (field) => (lived.length ? lived.reduce((s, l) => s + (l[field] ?? 100), 0) / lived.length : 100);
    const flow = ctx.catalog.flows.byId['air-quality'];
    const band = (q) => (q < flow.criticalThreshold ? 'critical' : q < flow.warnThreshold ? 'warn' : null);
    return {
      totals: [
        ['Average, lived-in levels', `${Math.round(avg)}`, band(avg)],
        ...(worst ? [[`Worst, level ${worst.index}`, `${Math.round(breathable(worst))}${worst.oxygen < worst.airQuality ? ' (short of oxygen)' : ''}`, band(breathable(worst))]] : []),
        ['Purity, on average', `${Math.round(mean('airQuality'))}`, band(mean('airQuality'))],
        ['Oxygen, on average', `${Math.round(mean('oxygen'))}`, band(mean('oxygen'))],
      ],
      made: byType((b, def) => (((def.effects ?? []).some((e) => e.op === 'flow.scrub') || def.oxygenOutput > 0) && b.powered !== false && !b.brokenDown ? 1 : 0)),
      used: {},
      unit: (n) => `${fmt(n)} working`,
    };
  }

  if (id === 'labour') {
    const l = state.population.labour;
    return {
      totals: [
        ['Labour pool', `${fmt(l.pool)} crews`],
        ['In work', `${fmt(l.assigned)}`],
        ['Wanted', `${fmt(l.wanted)}`, l.wanted > l.pool ? 'warn' : null],
      ],
      made: {},
      used: byType((b) => b.staffing ?? 0),
      unit: (n) => `${fmt(n)} crews`,
    };
  }

  const held = id === 'authority' ? state.governance.authority : state.resources.abstracts[id] ?? 0;
  const cap = id === 'authority' ? ctx.config.governance.authorityCap : ctx.catalog.abstracts.byId[id]?.cap;
  return {
    totals: [['Held', cap ? `${fmt(held)} of ${fmt(cap)}` : fmt(held)]],
    made: {},
    used: {},
    unit: fmt,
  };
}

function definitionOf(ctx, id) {
  for (const [kind] of KINDS) {
    const def = ctx.catalog[kind]?.byId?.[id];
    if (def) return def;
  }
  return null;
}

/** 0.4, 12, 1,240, 12k: enough precision to tell a trickle from nothing. */
function fmt(n) {
  const v = Math.abs(n);
  if (v >= 10000) return `${Math.round(n / 1000).toLocaleString('en')}k`;
  if (v >= 100) return Math.round(n).toLocaleString('en');
  if (v >= QUIET) return (Math.round(n * 10) / 10).toLocaleString('en');
  return '0';
}
