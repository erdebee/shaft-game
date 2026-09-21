/**
 * dashboard.js
 * The default screen: settlement status at a glance. Stocks and flows,
 * warnings, and the current decision window.
 *
 * Reads state, dispatches commands, writes nothing. update() runs every frame,
 * so it builds its DOM once in mount() and only sets text and widths after.
 */

import { render as renderMeter, flowState } from '../components/resourceMeter.js';
import * as logPanel from '../components/logPanel.js';
import { daysOfSupply } from '../../core/selectors.js';

const WATCHED_STOCKS = ['food', 'basic-parts', 'paper', 'wood'];

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();

  const power = card(root, 'Power');
  const powerMeter = renderMeter(power, { label: 'Load', unit: 'kW' });
  const powerNote = document.createElement('div');
  powerNote.className = 'meter-label';
  power.appendChild(powerNote);

  const stores = card(root, 'Stores');
  const stockMeters = new Map(
    WATCHED_STOCKS.map((id) => {
      const def = ctx.catalog.stocks.byId[id];
      return [id, renderMeter(stores, { label: def?.name ?? id, unit: def?.unit ?? '' })];
    }),
  );

  const people = card(root, 'People');
  const headcount = renderMeter(people, { label: 'Population' });
  const porters = renderMeter(people, { label: 'Porters hauling' });

  const record = card(root, 'Record');
  logPanel.mount(record);

  return {
    update(currentState, currentCtx) {
      const flow = currentState.resources.flows.power;
      const def = currentCtx.catalog.flows.byId['power'];
      powerMeter.update(flow.demand, Math.max(flow.generation, flow.demand), flowState(flow, def));
      powerNote.textContent = flow.brownedOut.length
        ? `${flow.brownedOut.length} browned out · ${Math.round(flow.generation)} of ${Math.round(flow.demand)} kW`
        : `${Math.round(flow.generation)} kW available`;

      for (const [id, meter] of stockMeters) {
        const amount = currentState.resources.stocks[id] ?? 0;
        const days = daysOfSupply(currentState, currentCtx, id);
        const stockDef = currentCtx.catalog.stocks.byId[id];

        let band = 'ok';
        if (Number.isFinite(days) && stockDef) {
          if (days < (stockDef.criticalDaysOfSupply ?? -1)) band = 'critical';
          else if (days < (stockDef.warnDaysOfSupply ?? -1)) band = 'warn';
        }
        const note = Number.isFinite(days)
          ? `${Math.round(amount)} · ${days < 100 ? `${days.toFixed(1)}d` : '—'}`
          : `${Math.round(amount)}`;
        meter.update(amount, Math.max(amount, 100), band, note);
      }

      headcount.update(currentState.population.headcount, currentState.population.headcount, 'ok');
      const hauling = currentState.haulage.trips.length;
      const total = currentState.population.workers.length;
      porters.update(hauling, Math.max(total, 1), 'ok', `${hauling} of ${total}`);

      logPanel.update(currentState);
    },
  };
}

function card(root, heading) {
  const section = document.createElement('section');
  section.className = 'card';
  const h = document.createElement('h2');
  h.textContent = heading;
  section.appendChild(h);
  root.appendChild(section);
  return section;
}
