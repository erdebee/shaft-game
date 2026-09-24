/**
 * dashboard.js
 * The Stats tab: the settlement at a glance. Power, stores, people and what
 * they lack, the meters, the departments, and the maintenance crews.
 *
 * Reads state, dispatches commands, writes nothing. update() runs every frame,
 * so it builds its DOM once in mount() and only sets text and widths after.
 */

import { render as renderMeter, flowState } from '../components/resourceMeter.js';
import { el, button, card } from '../components/dom.js';
import { daysOfSupply } from '../../core/selectors.js';
import { unhoused, residentsByLevel } from '../../systems/population/housing.js';
import { total, nameOf } from '../../systems/resources/stores.js';
import * as selection from '../selection.js';

const WATCHED_STOCKS = ['food', 'fuel', 'activated-carbon', 'scrubber-catalyst', 'basic-parts', 'paper', 'wood'];
const METERS = ['morale', 'trust', 'stability', 'productivity', 'discontent', 'freedom', 'legitimacy', 'structural-integrity'];

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();

  // --- power -------------------------------------------------------------
  const power = card(root, 'Power');
  const powerMeter = renderMeter(power, { label: 'Load', unit: 'kW' });
  const powerNote = el('div', 'meter-label');
  power.appendChild(powerNote);

  // --- waiting -----------------------------------------------------------
  // Rooms held up by the porters: short of an input, or full of an output.
  // Each row opens the room in Inspect.
  const waiting = card(root, 'Waiting for porters');
  const waitingList = el('div', 'waiting-list');
  waiting.appendChild(waitingList);
  let waitingKey = null;

  // --- stores ------------------------------------------------------------
  const stores = card(root, 'Stores');
  const stockMeters = new Map(WATCHED_STOCKS.map((id) => {
    const def = ctx.catalog.stocks.byId[id] ?? ctx.catalog.components.byId[id];
    return [id, renderMeter(stores, { label: def?.name ?? id, unit: def?.unit ?? '' })];
  }));

  // --- people ------------------------------------------------------------
  const people = card(root, 'People');
  const headcount = renderMeter(people, { label: 'Population' });
  const health = renderMeter(people, { label: 'Health' });
  const homeless = renderMeter(people, { label: 'Without a home' });
  const labour = renderMeter(people, { label: 'Labour in work' });
  const porters = renderMeter(people, { label: 'Porters hauling' });

  // --- needs -------------------------------------------------------------
  const needs = card(root, 'Needs');
  const water = renderMeter(needs, { label: 'Water to people' });
  const waterQuality = renderMeter(needs, { label: 'Water quality' });
  const air = renderMeter(needs, { label: 'Air where people live' });
  const worstAir = renderMeter(needs, { label: 'Worst inhabited level' });

  // --- society -----------------------------------------------------------
  const society = card(root, 'Society');
  const meters = new Map(METERS
    .filter((id) => id in state.meters)
    .map((id) => [id, renderMeter(society, { label: ctx.catalog.meters.byId[id]?.name ?? id })]));
  const strikes = el('div', 'meter-label');
  society.appendChild(strikes);

  // --- departments -------------------------------------------------------
  const departments = card(root, 'Departments');
  const factions = new Map(ctx.catalog.factions.ids.map((id) =>
    [id, renderMeter(departments, { label: ctx.catalog.factions.byId[id].name })]));

  // --- maintenance -------------------------------------------------------
  const maintenance = card(root, 'Maintenance');
  const crewRow = el('div', 'inspect-row');
  const crewValue = el('span', 'meter-value');
  crewRow.append(
    el('span', 'meter-label', 'Repair crews'),
    button('−', 'Fewer repair crews', () => dispatch({ type: 'player:setMaintenanceCrews', count: state.maintenance.crewTarget - 1 })),
    crewValue,
    button('+', 'More repair crews', () => dispatch({ type: 'player:setMaintenanceCrews', count: state.maintenance.crewTarget + 1 })),
  );
  const repairNote = el('div', 'meter-label');
  maintenance.append(crewRow, repairNote);

  return {
    update(s, c) {
      const flow = s.resources.flows.power;
      powerMeter.update(flow.demand, Math.max(flow.generation, flow.demand), flowState(flow, c.catalog.flows.byId.power));
      powerNote.textContent = flow.brownedOut.length
        ? `${flow.brownedOut.length} browned out · ${Math.round(flow.generation)} of ${Math.round(flow.demand)} kW`
        : `${Math.round(flow.generation)} kW available`;

      const held = s.buildings.filter((b) => (b.starved || b.blocked) && b.powered !== false && !b.brokenDown);
      const key = held.map((b) => `${b.instanceId}:${b.missing}:${b.full}`).join('|');
      if (key !== waitingKey) {
        waitingKey = key;
        const said = (ids) => ids.map((id) => nameOf(c, id).toLowerCase()).join(', ');
        waitingList.replaceChildren(...(held.length ? held.slice(0, 10).map((b) => {
          const name = c.catalog.buildings.byId[b.buildingId]?.name ?? b.buildingId;
          const why = b.starved ? `needs ${said(b.missing)}` : `full of ${said(b.full)}`;
          const row = button(`L${b.level} ${name} — ${why}`, `Inspect the ${name} on level ${b.level}`, () => selection.select({ instanceId: b.instanceId, level: b.level }), `waiting-row ${b.starved ? 'starved' : 'blocked'}`);
          return row;
        }) : [el('div', 'meter-label', 'Nothing is waiting.')]));
        if (held.length > 10) waitingList.appendChild(el('div', 'meter-label', `and ${held.length - 10} more`));
      }

      for (const [id, meter] of stockMeters) {
        const amount = total(s, id);
        const days = daysOfSupply(s, c, id);
        const def = c.catalog.stocks.byId[id];
        let band = 'ok';
        if (Number.isFinite(days) && def) {
          if (days < (def.criticalDaysOfSupply ?? -1)) band = 'critical';
          else if (days < (def.warnDaysOfSupply ?? -1)) band = 'warn';
        }
        const reserve = c.catalog.components.byId[id]?.reserve ?? def?.reserve;
        if (reserve && amount < reserve / 4) band = 'critical';
        const note = Number.isFinite(days) && days < 100
          ? `${Math.round(amount)} · ${days.toFixed(1)}d`
          : `${Math.round(amount)}`;
        meter.update(amount, Math.max(amount, reserve ?? 100), band, note);
      }

      const pop = s.population;
      headcount.update(pop.headcount, pop.headcount, 'ok', `${Math.round(pop.headcount)}`);
      health.update(pop.health, 100, band(pop.health, 60, 40), `${Math.round(pop.health)}`);
      const without = unhoused(s, c);
      homeless.update(without, pop.headcount, without > pop.headcount * 0.25 ? 'critical' : without > 0 ? 'warn' : 'ok', `${Math.round(without)}`);
      const { pool, assigned, wanted } = pop.labour;
      labour.update(assigned, Math.max(pool, 1), wanted > pool ? 'critical' : 'ok', `${Math.round(assigned)} of ${Math.round(pool)} · wanted ${wanted}`);
      const hauling = s.haulage.trips.length;
      porters.update(hauling, Math.max(pop.workers.length, 1), 'ok', `${hauling} of ${pop.workers.length}`);

      water.update(pop.needs.water * 100, 100, band(pop.needs.water * 100, 99, 80), `${Math.round(pop.needs.water * 100)}%`);
      waterQuality.update(pop.needs.waterQuality, 100, band(pop.needs.waterQuality, 60, 35), `${Math.round(pop.needs.waterQuality)}`);
      const warn = c.config.air.qualityWarnThreshold;
      const critical = c.config.air.qualityCriticalThreshold;
      air.update(pop.needs.air, 100, band(pop.needs.air, warn, critical), `${Math.round(pop.needs.air)}`);
      const worst = worstInhabited(s, c);
      worstAir.update(worst.quality, 100, band(worst.quality, warn, critical), worst.level ? `${Math.round(worst.quality)} · level ${worst.level}` : '—');

      for (const [id, meter] of meters) {
        const value = s.meters[id];
        const b = id === 'discontent'
          ? (value >= c.config.unrest.strikeThreshold ? 'critical' : value >= c.config.unrest.warnThreshold ? 'warn' : 'ok')
          : band(value, 40, 20);
        meter.update(value, 100, b, `${Math.round(value)}`);
      }
      strikes.textContent = pop.strikes.length
        ? `On strike: ${pop.strikes.map((x) => c.catalog.factions.byId[x.faction]?.name ?? x.faction).join(', ')}`
        : '';

      for (const [id, meter] of factions) {
        const value = pop.factionSatisfaction[id] ?? 0;
        const striking = pop.strikes.some((x) => x.faction === id);
        meter.update(value, 100, striking ? 'critical' : band(value, 45, c.config.factions.sabotageThreshold), striking ? 'on strike' : `${Math.round(value)}`);
      }

      const m = s.maintenance;
      crewValue.textContent = `${m.crews} / ${m.crewTarget}`;
      const queued = s.buildings.filter((b) => b.repairing).length;
      repairNote.textContent = m.stalledOn
        ? `Stalled: no ${m.stalledOn} · ${queued} waiting`
        : `${queued} on the repair list`;
    },
  };
}

/** ok above `warn`, warn above `critical`, critical below. */
function band(value, warn, critical) {
  if (value < critical) return 'critical';
  if (value < warn) return 'warn';
  return 'ok';
}

/** The inhabited level with the worst air. */
function worstInhabited(state, ctx) {
  const residents = residentsByLevel(state, ctx);
  let worst = { level: null, quality: 100 };
  for (const level of state.levels) {
    if ((residents[level.index] ?? 0) >= 1 && level.airQuality < worst.quality) {
      worst = { level: level.index, quality: level.airQuality };
    }
  }
  return worst;
}
