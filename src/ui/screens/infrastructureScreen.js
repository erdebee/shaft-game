/**
 * infrastructureScreen.js
 * The Infrastructure panel: where the player lays the Shaft's networks —
 * power, water, sewage and air (its two duct lines on one page). The junctions, cisterns,
 * fans and the rest are built from the Buildings tab like any other room;
 * here they are joined up.
 *
 * One network is open at a time, and the shaft draws it while it is
 * (view/networkLayer.js): its links, what each hub reaches, and what nothing
 * reaches. The panel shows how the network is doing, what nothing reaches,
 * and every node grouped by what it is linked to.
 *
 * Laying a link: "Link" on a node, or a click on it in the shaft, starts
 * one; "Link here", or a click on a second node, lays it, and carries on
 * from there, so a chain of junctions is a run of clicks. Esc, or clicking
 * the first node again, stops (the shaft's network layer listens for both). Every link goes through player:link;
 * priorities through player:setPriority.
 *
 * Rebuilds its lists only when the network's shape changes; per frame it
 * refreshes the readouts.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { readNetwork, networkIds, colorOf, roleOf, describe, airingOf } from '../networkStatus.js';
import { canLink, isHub, networkDef, reachOf } from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';
import { cisternCapacity } from '../../systems/water/greywaterLoop.js';
import { inStorehouses, nameOf } from '../../systems/resources/stores.js';
import { outputScale } from '../../systems/buildings/buildingRegistry.js';
import { fanMode, SUCK, BLOW, AIR_LINES, FOUL, FRESH } from '../../systems/airQuality/airflow.js';

/** The one page both air lines share: they are one loop. */
const AIR = 'air';

/** Which page was open last, and which air line was being laid, kept across tab switches. */
let lastMode = 'power-grid';
let lastLine = FOUL;

const REFUSED = {
  'cannot-join': 'cannot join these',
  'too-long': 'too far',
  linked: 'already linked',
  same: '',
  cost: 'cannot afford',
};

/** The network a page lays: the air page lays whichever line is chosen. */
const networkOfMode = (mode) => (mode === AIR ? lastLine : mode);

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const picker = el('nav', 'net-picker');
  picker.setAttribute('aria-label', 'Networks');
  const body = el('div', 'net-body');
  root.append(picker, body);

  const modes = [...new Set(networkIds(ctx).map((id) => (AIR_LINES.includes(id) ? AIR : id)))];
  const tabs = new Map();
  for (const mode of modes) {
    const def = mode === AIR ? null : networkDef(ctx, mode);
    const label = def ? def.short ?? def.name : 'Air';
    const b = button(label, def ? `Lay the ${def.name.toLowerCase()}` : 'Lay the air ducts', () => open(mode), 'net-tab');
    b.style.setProperty('--net', colorOf(networkOfMode(mode)));
    tabs.set(mode, b);
    picker.appendChild(b);
  }

  let page = null;

  function open(mode) {
    lastMode = mode;
    for (const [m, b] of tabs) b.setAttribute('aria-pressed', String(m === mode));
    body.replaceChildren();
    selection.showNetwork(networkOfMode(mode));
    page = mode === AIR ? airPage(body, state, ctx, dispatch) : networkPage(body, state, ctx, dispatch, mode);
  }
  open(modes.includes(lastMode) ? lastMode : modes[0]);

  return {
    update(currentState, currentCtx) {
      // Something else closed the network (a room opened in the inspector
      // and back): put ours back.
      if (selection.get().network !== networkOfMode(lastMode)) selection.showNetwork(networkOfMode(lastMode));
      page?.update(currentState, currentCtx);
    },
  };
}

/**
 * The air: both duct lines on one page. What the loop is for comes first —
 * the oxygen and the pollution in every room — then which line to lay, and
 * that line's nodes.
 */
function airPage(parent, state, ctx, dispatch) {
  const card = el('section', 'card net-card');
  card.style.setProperty('--net', colorOf(FRESH));
  const about = el('p', 'meter-label net-about', 'Sucking fans draw the foul air off their levels into the foul-air ducts, up the right-hand wall; a scrubber cleans it, an oxygen garden on the way freshens it, and the fresh-air ducts, down the stairwell, carry it on to the blowing fans. Between a blower and a sucker the air has to go through the Shaft, and it airs every level it crosses: nothing flows past a level beyond the last fan, or between two fans turning the same way. Keep every room\'s oxygen up and its pollution down.');
  const status = el('div', 'net-status');
  const lineNav = el('div', 'net-priority net-lines');
  const levels = el('div', 'air-levels');
  card.append(el('h2', 'net-title', 'Air'), about, status, el('h3', 'build-zone', 'Oxygen and pollution'), levels, lineNav);
  const lineBody = el('div');
  parent.append(card, lineBody);

  lineNav.appendChild(el('span', 'meter-label', 'Laying'));
  const lineButtons = new Map();
  for (const line of AIR_LINES) {
    const def = networkDef(ctx, line);
    const b = button(def.name, `Lay ${def.name.toLowerCase()}`, () => chooseLine(line), 'net-prio net-line');
    b.style.setProperty('--net', colorOf(line));
    lineButtons.set(line, b);
    lineNav.appendChild(b);
  }

  let linePage = null;
  function chooseLine(line) {
    lastLine = line;
    for (const [l, b] of lineButtons) b.setAttribute('aria-pressed', String(l === line));
    lineBody.replaceChildren();
    selection.showNetwork(line);
    linePage = networkPage(lineBody, state, ctx, dispatch, line);
  }
  chooseLine(lastLine);

  let rowsKey = null;
  let rows = [];
  return {
    update(currentState, currentCtx) {
      status.replaceChildren(...statusLines(currentState, currentCtx, AIR).map(([text, band]) => {
        const line = el('div', 'inspect-status', text);
        line.dataset.state = band;
        return line;
      }));

      // A row per built level: its rooms, then its oxygen and pollution.
      const key = currentState.buildings.map((b) => `${b.instanceId}@${b.level}`).join();
      if (key !== rowsKey) {
        rowsKey = key;
        levels.replaceChildren();
        rows = [];
        const byLevel = new Map();
        for (const b of currentState.buildings) {
          if (!byLevel.has(b.level)) byLevel.set(b.level, []);
          byLevel.get(b.level).push(currentCtx.catalog.buildings.byId[b.buildingId]?.name ?? b.buildingId);
        }
        for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
          const names = byLevel.get(level);
          const row = el('div', 'air-level');
          const oxygen = el('span', 'air-reading');
          const pollution = el('span', 'air-reading');
          const airing = el('span', 'meter-label air-airing');
          row.append(el('span', 'air-level-no', `L${level}`), el('span', 'meter-label air-rooms', names.join(', ')), oxygen, pollution, airing);
          levels.appendChild(row);
          rows.push({ level, oxygen, pollution, airing });
        }
      }
      const { qualityWarnThreshold: warn, qualityCriticalThreshold: critical } = currentCtx.config.air;
      const band = (q) => (q < critical ? 'critical' : q < warn ? 'warn' : 'ok');
      for (const r of rows) {
        const level = currentState.levels[r.level - 1];
        const o2 = Math.round(level?.oxygen ?? 100);
        const purity = Math.round(level?.airQuality ?? 100);
        r.oxygen.textContent = `O₂ ${o2}%`;
        r.oxygen.dataset.state = band(o2);
        r.pollution.textContent = `pollution ${100 - purity}%`;
        r.pollution.dataset.state = band(purity);
        const airing = airingOf(currentState, currentCtx, r.level);
        r.airing.textContent = { still: 'still air', weak: 'barely aired', aired: 'aired' }[airing];
        r.airing.dataset.state = airing === 'aired' ? 'ok' : airing === 'weak' ? 'warn' : 'critical';
      }
      linePage?.update(currentState, currentCtx);
    },
  };
}

/** One network's page: status, what nothing reaches, the nodes. */
function networkPage(parent, state, ctx, dispatch, networkId) {
  const net = networkDef(ctx, networkId);
  const card = el('section', 'card net-card');
  card.style.setProperty('--net', colorOf(networkId));
  const title = el('h2', 'net-title', net.name);
  const about = el('p', 'meter-label net-about', describe(ctx, networkId));
  const status = el('div', 'net-status');
  const hint = el('div', 'net-hint');
  const gaps = el('div', 'net-gaps');
  const nodes = el('div', 'net-nodes');
  card.append(title, about, status, hint, gaps, nodes);
  parent.appendChild(card);


  let signature = null;
  let readouts = [];

  function rebuild(currentState, currentCtx, view) {
    const { linkFrom } = selection.get();
    const from = linkFrom ? currentState.buildings.find((b) => b.instanceId === linkFrom) : null;

    // What nothing reaches.
    gaps.replaceChildren();
    if (view.gaps.length) {
      gaps.appendChild(el('h3', 'build-zone', `Not reached · ${view.gaps.length}`));
      const list = el('div', 'net-gap-list');
      for (const gap of view.gaps.slice(0, 12)) {
        const name = gap.instance ? currentCtx.catalog.buildings.byId[gap.instance.buildingId].name : 'Level';
        const row = el('div', 'net-gap', `L${gap.level} · ${name}: ${gap.what}`);
        list.appendChild(row);
      }
      if (view.gaps.length > 12) list.appendChild(el('div', 'meter-label', `…and ${view.gaps.length - 12} more`));
      gaps.appendChild(list);
    }

    // Every node, by group.
    nodes.replaceChildren();
    readouts = [];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let lettered = 0;
    for (const group of view.groups) {
      const alone = group.nodes.length === 1;
      const heading = alone
        ? (group.live ? 'On its own' : 'Not connected')
        : `${networkId === 'power-grid' ? 'Grid' : 'Group'} ${letters[lettered++] ?? '?'} · ${group.live ? 'live' : 'nothing feeding it'}`;
      const head = el('h3', 'build-zone net-group', heading);
      head.dataset.live = String(group.live);
      nodes.appendChild(head);
      for (const node of [...group.nodes].sort((a, b) => a.level - b.level)) {
        nodes.appendChild(nodeRow(currentState, currentCtx, view, node, from));
      }
    }
    if (!view.groups.length) nodes.appendChild(el('div', 'meter-label', `Nothing built yet that joins the ${net.name.toLowerCase()}.`));
  }

  function nodeRow(currentState, currentCtx, view, node, from) {
    const def = currentCtx.catalog.buildings.byId[node.buildingId];
    const row = el('div', 'net-node');
    if (from?.instanceId === node.instanceId) row.dataset.from = 'true';
    const role = roleOf(currentCtx, networkId, node);
    const name = el('span', 'net-node-name', `${def.name} · L${node.level}`);
    const tag = el('span', 'net-role', role);
    const reading = el('span', 'meter-label net-reading');
    readouts.push({ node, reading });

    const actions = el('span', 'net-actions');
    if (!from) {
      actions.appendChild(button('Link', `Start a ${net.link} from the ${def.name.toLowerCase()} on level ${node.level}`, () => selection.startLink(node.instanceId), 'text-button'));
    } else if (from.instanceId === node.instanceId) {
      actions.appendChild(button('Cancel', 'Stop laying', () => selection.startLink(null), 'text-button'));
    } else {
      const check = canLink(currentState, currentCtx, networkId, from.instanceId, node.instanceId);
      const afford = check.cost.every((c) => inStorehouses(currentState, currentCtx, c.id) >= c.qty);
      const cost = check.cost.map((c) => `${c.qty} ${nameOf(currentCtx, c.id).toLowerCase()}`).join(', ');
      const why = !check.ok ? REFUSED[check.reason] ?? check.reason : !afford ? REFUSED.cost : '';
      const lay = button(why ? `✕ ${why}` : `Link here · ${cost}`, why ? `Cannot link: ${why}` : `Lay a ${check.span}-level ${net.link} for ${cost}`, () => layTo(node.instanceId), 'text-button net-lay');
      lay.disabled = !!why;
      actions.appendChild(lay);
    }
    row.append(tag, name, reading, actions);

    // Junction priority, 1 served first.
    if (networkId === 'power-grid' && isHub(currentCtx, networkId, node.buildingId)) {
      const prio = el('div', 'net-priority');
      prio.appendChild(el('span', 'meter-label', 'Priority'));
      const current = priorityOf(node, currentCtx);
      for (let p = 1; p <= 5; p++) {
        const b = button(String(p), `Priority ${p}${p === 1 ? ', served first' : p === 5 ? ', dropped first' : ''}`, () => {
          dispatch({ type: 'player:setPriority', instanceId: node.instanceId, priority: p });
          signature = null;
        }, 'net-prio');
        b.setAttribute('aria-pressed', String(p === current));
        prio.appendChild(b);
      }
      row.appendChild(prio);
    }

    // A fan's direction: suck air off its levels, or blow it onto them.
    if (AIR_LINES.includes(networkId) && isHub(currentCtx, networkId, node.buildingId)) {
      const way = el('div', 'net-priority');
      way.appendChild(el('span', 'meter-label', 'Fan'));
      const mode = fanMode(node);
      for (const [m, label, title] of [[SUCK, '▲ Suck', 'Draw air off these levels into the ducts'], [BLOW, '▼ Blow', 'Push the ducts\' air out onto these levels']]) {
        const b = button(label, title, () => {
          dispatch({ type: 'player:setFanMode', instanceId: node.instanceId, mode: m });
          signature = null;
        }, 'net-prio net-fan');
        b.setAttribute('aria-pressed', String(m === mode));
        way.appendChild(b);
      }
      row.appendChild(way);
    }

    // Its links, each removable.
    const mine = view.links.filter((l) => l.from === node.instanceId || l.to === node.instanceId);
    if (mine.length) {
      const list = el('div', 'net-links');
      for (const link of mine) {
        const other = link.from === node.instanceId ? link.b : link.a;
        const otherDef = currentCtx.catalog.buildings.byId[other.buildingId];
        const span = Math.abs(other.level - node.level);
        const downhill = net.flowsDownhill ? (other.level > node.level ? ' ↓' : other.level < node.level ? ' ↑' : '') : '';
        const item = el('span', 'net-link');
        item.append(
          el('span', 'meter-label', `↔ ${otherDef.name} L${other.level} · ${span} lv${downhill}`),
          button('✕', `Take out the ${net.link} to the ${otherDef.name.toLowerCase()} on level ${other.level}`, () => {
            dispatch({ type: 'player:unlink', linkId: link.id });
            signature = null;
          }, 'route-remove'),
        );
        list.appendChild(item);
      }
      row.appendChild(list);
    }
    return row;
  }

  function layTo(toId) {
    const { linkFrom } = selection.get();
    if (!linkFrom) return;
    const before = state.infrastructure.links.length;
    dispatch({ type: 'player:link', network: networkId, from: linkFrom, to: toId });
    // Laid: carry on from the far end, so a chain is a run of clicks.
    if (state.infrastructure.links.length > before) selection.startLink(toId);
    signature = null;
  }

  return {
    update(currentState, currentCtx) {
      const view = readNetwork(currentState, currentCtx, networkId);
      const { linkFrom } = selection.get();
      const key = JSON.stringify([
        view.groups.map((g) => [g.key, g.live, g.nodes.map((n) => n.instanceId)]),
        view.links.map((l) => l.id),
        view.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}:${g.what}`),
        linkFrom,
        networkId === 'power-grid' ? currentState.buildings.map((b) => b.priority ?? '') : null,
        AIR_LINES.includes(networkId) ? currentState.buildings.map((b) => b.fanMode ?? '') : null,
        // Affordability of the offered links moves with the stores.
        linkFrom ? (net.linkCost ?? []).map((c) => Math.floor(inStorehouses(currentState, currentCtx, c.id))) : null,
      ]);
      if (key !== signature) {
        signature = key;
        rebuild(currentState, currentCtx, view);
      }

      const from = linkFrom ? currentState.buildings.find((b) => b.instanceId === linkFrom) : null;
      hint.textContent = from
        ? `Laying a ${net.link} from the ${currentCtx.catalog.buildings.byId[from.buildingId].name.toLowerCase()} on level ${from.level}: click where it goes, in the Shaft or below. Esc stops.`
        : `Click a node in the Shaft, or Link below, to lay a ${net.link}. A ${net.link} spans at most ${net.maxSpanLevels} levels.`;
      hint.dataset.active = String(!!from);

      status.replaceChildren(...statusLines(currentState, currentCtx, networkId).map(([text, band]) => {
        const line = el('div', 'inspect-status', text);
        line.dataset.state = band;
        return line;
      }));
      for (const { node, reading } of readouts) reading.textContent = readingOf(currentState, currentCtx, networkId, node);
    },
  };
}

/** The network's headline numbers, as [text, band] lines. */
function statusLines(state, ctx, networkId) {
  const lines = [];
  const power = state.resources.flows.power;
  const water = state.resources.flows.water;
  const round = (n) => Math.round(n);
  switch (networkId) {
    case 'power-grid': {
      lines.push([`Generating ${round(power.generation)} kW for ${round(power.demand)} kW asked`, power.generation >= power.demand ? 'ok' : 'warn']);
      if (power.storage > 0) lines.push([`Batteries ${round(power.stored)} of ${round(power.storage)} kW·ticks${power.batteryDraw > 0 ? `, giving ${round(power.batteryDraw)} kW` : ''}`, power.batteryDraw > 0 ? 'warn' : 'ok']);
      if (power.brownedOut.length) lines.push([`${power.brownedOut.length} rooms browned out`, 'critical']);
      if (power.offGrid?.length) lines.push([`${power.offGrid.length} rooms on no junction`, 'critical']);
      break;
    }
    case 'water-mains': {
      lines.push([`Pumped ${round(water.pumped)} + reclaimed ${round(water.reclaimed)} a tick, for ${round(water.demand)} wanted`, water.peopleShare < 1 ? 'critical' : water.buildingShare < 1 ? 'warn' : 'ok']);
      lines.push([`Cisterns ${round(water.stored)} of ${round(water.capacity)} · quality ${round(water.quality)}%`, water.quality < ctx.config.population.waterQualitySafe ? 'warn' : 'ok']);
      if (water.peopleShare < 1) lines.push([`People get ${round(water.peopleShare * 100)}% of what they drink`, 'critical']);
      break;
    }
    case 'sewer': {
      const dumped = (water.spilled ?? []).reduce((a, b) => a + b, 0);
      lines.push([`Draining ${round(water.greywater)} a tick to reclamation`, 'ok']);
      if (dumped > 0.01) {
        const where = (water.spilled ?? []).map((q, l) => (q > 0.01 ? l : null)).filter(Boolean);
        lines.push([`Dumping ${Math.round(dumped * 10) / 10} a tick on level${where.length > 1 ? 's' : ''} ${where.join(', ')}`, 'critical']);
      }
      break;
    }
    case AIR: {
      const band = (q) => (q < ctx.config.air.qualityCriticalThreshold ? 'critical' : q < ctx.config.air.qualityWarnThreshold ? 'warn' : 'ok');
      const lived = state.levels.filter((l) => state.buildings.some((b) => b.level === l.index));
      const worst = (field) => lived.reduce((w, l) => ((l[field] ?? 100) < (w[field] ?? 100) ? l : w), lived[0]);
      const mean = (field) => lived.reduce((t, l) => t + (l[field] ?? 100), 0) / Math.max(1, lived.length);
      if (lived.length) {
        const o = worst('oxygen');
        const p = worst('airQuality');
        lines.push([`Oxygen averages ${round(mean('oxygen'))}%, lowest on level ${o.index} at ${round(o.oxygen ?? 100)}%`, band(Math.min(mean('oxygen'), o.oxygen ?? 100))]);
        lines.push([`Pollution averages ${round(100 - mean('airQuality'))}%, worst on level ${p.index} at ${round(100 - (p.airQuality ?? 100))}%`, band(Math.min(mean('airQuality'), p.airQuality ?? 100))]);
      }
      const still = lived.filter((l) => airingOf(state, ctx, l.index) === 'still').map((l) => l.index);
      if (still.length) lines.push([`Still air on level${still.length > 1 ? 's' : ''} ${still.join(', ')}`, 'warn']);
      break;
    }
    default:
  }
  return lines;
}

/** One node's live figure: load, charge, store, reach. */
function readingOf(state, ctx, networkId, node) {
  const def = ctx.catalog.buildings.byId[node.buildingId];
  const power = state.resources.flows.power;
  const water = state.resources.flows.water;
  const reach = reachOf(ctx, node);
  const span = reach ? `reaches L${Math.max(1, node.level - reach)}–${Math.min(state.levels.length, node.level + reach)}` : '';
  if (node.brokenDown) return 'broken down';
  switch (networkId) {
    case 'power-grid': {
      const j = power.junctions?.[node.instanceId];
      if (j) return `${Math.round(j.load)}/${j.capacity} kW · ${j.consumers} rooms${j.dark ? ` · ${j.dark} dark` : ''} · ${span}`;
      if (power.batteries?.[node.instanceId] !== undefined) {
        const cap = (def.effects ?? []).find((e) => e.op === 'buffer.add')?.value ?? 1;
        return `charge ${Math.round((power.batteries[node.instanceId] / cap) * 100)}%`;
      }
      const made = (def.produces ?? []).find((p) => p.id === 'power');
      return made ? `${Math.round(made.qty * outputScale({ ...node, powered: true }, def, ctx))} kW` : '';
    }
    case 'water-mains':
    case 'sewer': {
      const cap = cisternCapacity(def);
      if (cap > 0) return `${Math.round(water.cisterns?.[node.instanceId] ?? 0)}/${cap} · ${span}`;
      if (water.sewage?.[node.instanceId] !== undefined) return `${Math.round(water.sewage[node.instanceId])} a tick coming in`;
      if (water.lift?.[node.instanceId] !== undefined) return `lifts ${Math.round(water.lift[node.instanceId])} levels`;
      return '';
    }
    case 'foul-ducts':
    case 'fresh-ducts': {
      const air = state.resources.flows.air?.nodes?.[node.instanceId];
      if (reach) {
        if (outputScale(node, def, ctx) <= 0) return 'not running';
        const vents = `L${Math.max(1, node.level - reach)}–${Math.min(state.levels.length, node.level + reach)}`;
        const way = fanMode(node) === SUCK ? `sucking off ${vents}` : `blowing onto ${vents}`;
        return (air?.flow ?? 0) > 0 ? way : `${way} · idle: no loop through a scrubber`;
      }
      if (outputScale(node, def, ctx) <= 0) return 'not working';
      return air?.through ? 'the loop\'s air passes through it' : 'no air passing — works its own level';
    }
    default:
      if (reach) return outputScale(node, def, ctx) > 0 ? span : 'not running';
      return outputScale(node, def, ctx) > 0 ? '' : 'not working';
  }
}
