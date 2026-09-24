/**
 * infrastructureScreen.js
 * The Infrastructure panel: where the player lays the Shaft's networks, a
 * page per loop — power (the high-voltage cables and the low-voltage
 * wires), water (the mains, the sewer and the feed lines) and air (its two
 * duct lines). The junctions, cisterns, fans and the rest are built from the
 * Buildings tab like any other room; here they are joined up.
 *
 * One page is open at a time, and the shaft draws its lines while it is
 * (view/networkLayer.js), with every socket on them: the player lays a link
 * by clicking a free socket and then the socket (or room) it goes to, and
 * takes one out by clicking a used socket. The panel shows how the loop is
 * doing, what nothing reaches, and every node on the chosen line grouped by
 * what it is linked to, with its sockets in use and a ✕ on each link.
 * Priorities go through player:setPriority, fans through player:setFanMode,
 * links out through player:unlink.
 *
 * Rebuilds its lists only when the network's shape changes; per frame it
 * refreshes the readouts.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { readNetwork, colorOf, roleOf, describe, airingOf, PAGES, pageOf } from '../networkStatus.js';
import { isHub, networkDef, reachOf, socketsOf, socketUse } from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';
import { cisternCapacity } from '../../systems/water/greywaterLoop.js';
import { outputScale } from '../../systems/buildings/buildingRegistry.js';
import { fanMode, SUCK, BLOW, AIR_LINES, FOUL, FRESH, isOutside } from '../../systems/airQuality/airflow.js';

/** What each page is for, in a paragraph. */
const ABOUT = {
  power: 'The generators\' high-voltage cables run to the junctions — a generator has six outputs, a junction one input, and a battery sits on the way with one of each — and each junction\'s low-voltage wires run to the rooms it lights, one wire to a room and twelve to a junction, no more than four levels. A room on no wire is dark. When the generators run short, junctions are served in priority order.',
  water: 'Pumps push water up the mains, down the left of the stairwell, to the cisterns; the sewer carries what is used down the right-hand side, downhill only, to a reclamation plant, whose recovered water a pump sends back up the mains. Each cistern waters the rooms plugged into its feed sleeves — a double line, water in and the used water back — ten to a cistern, no more than four levels away. A home\'s residents drink through its feed line.',
  air: 'Sucking fans draw the foul air off their levels into the foul-air ducts, up the right-hand side; a scrubber cleans it, an oxygen garden on the way freshens it, and the fresh-air ducts, down the left of the stairwell, carry it on to the blowing fans. Between a blower and a sucker the air has to go through the Shaft, and it airs every level it crosses: nothing flows past a level beyond the last fan, or between two fans turning the same way. Keep every room\'s oxygen up and its pollution down.',
};

/** Which page was open last, and which line each page was listing, kept across tab switches. */
let lastMode = 'power';
const lastLine = { power: 'power-lines', water: 'water-feeds', air: FOUL };

/** The line a page lists. */
const networkOfMode = (mode) => lastLine[mode];

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const picker = el('nav', 'net-picker');
  picker.setAttribute('aria-label', 'Networks');
  const body = el('div', 'net-body');
  root.append(picker, body);

  const modes = PAGES.filter((p) => p.lines.every((l) => networkDef(ctx, l))).map((p) => p.id);
  const tabs = new Map();
  for (const mode of modes) {
    const { name, lines } = PAGES.find((p) => p.id === mode);
    const b = button(name, `Lay the ${name.toLowerCase()}`, () => open(mode), 'net-tab');
    b.style.setProperty('--net', colorOf(lines[0]));
    tabs.set(mode, b);
    picker.appendChild(b);
  }

  let page = null;

  function open(mode) {
    lastMode = mode;
    for (const [m, b] of tabs) b.setAttribute('aria-pressed', String(m === mode));
    body.replaceChildren();
    selection.showNetwork(networkOfMode(mode));
    page = sharedPage(body, state, ctx, dispatch, mode);
  }
  open(modes.includes(lastMode) ? lastMode : modes[0]);

  return {
    update(currentState, currentCtx) {
      // A socket clicked on another of the page's lines opens that line.
      const { network } = selection.get();
      if (network && network !== networkOfMode(lastMode) && pageOf(network)?.id === lastMode) page?.chooseLine(network);
      // Something else closed the network (a room opened in the inspector
      // and back): put ours back.
      if (selection.get().network !== networkOfMode(lastMode)) selection.showNetwork(networkOfMode(lastMode));
      page?.update(currentState, currentCtx);
    },
  };
}

/**
 * A page: the loop's headline numbers first — on the air, the oxygen and
 * the pollution in every room — then which of its lines to list, and that
 * line's nodes.
 */
function sharedPage(parent, state, ctx, dispatch, mode) {
  const { name, lines } = PAGES.find((p) => p.id === mode);
  const card = el('section', 'card net-card');
  card.style.setProperty('--net', colorOf(mode === 'air' ? FRESH : lines[0]));
  const about = el('p', 'meter-label net-about', ABOUT[mode] ?? '');
  const status = el('div', 'net-status');
  const hint = el('div', 'net-hint');
  const lineNav = el('div', 'net-priority net-lines');
  const levels = mode === 'air' ? el('div', 'air-levels') : null;
  card.append(el('h2', 'net-title', name), about, status, hint);
  if (levels) card.append(el('h3', 'build-zone', 'Oxygen and pollution'), levels);
  card.append(lineNav);
  const lineBody = el('div');
  parent.append(card, lineBody);

  lineNav.appendChild(el('span', 'meter-label', 'Showing'));
  const lineButtons = new Map();
  for (const line of lines) {
    const def = networkDef(ctx, line);
    const b = button(def.name, `List the ${def.name.toLowerCase()}`, () => chooseLine(line), 'net-prio net-line');
    b.style.setProperty('--net', colorOf(line));
    lineButtons.set(line, b);
    lineNav.appendChild(b);
  }

  let linePage = null;
  function chooseLine(line) {
    lastLine[mode] = line;
    for (const [l, b] of lineButtons) b.setAttribute('aria-pressed', String(l === line));
    lineBody.replaceChildren();
    // Keep a link in hand if it is on this line.
    if (selection.get().network !== line) selection.showNetwork(line);
    linePage = networkPage(lineBody, state, ctx, dispatch, line);
  }
  chooseLine(lastLine[mode]);

  let rowsKey = null;
  let rows = [];
  return {
    chooseLine,
    update(currentState, currentCtx) {
      hint.textContent = hintOf(currentState, currentCtx);
      hint.dataset.active = String(!!selection.get().linkFrom);
      status.replaceChildren(...statusLines(currentState, currentCtx, mode).map(([text, band]) => {
        const line = el('div', 'inspect-status', text);
        line.dataset.state = band;
        return line;
      }));
      if (!levels) {
        linePage?.update(currentState, currentCtx);
        return;
      }

      // A row per built level: its rooms, then its oxygen and pollution.
      const key = currentState.buildings.map((b) => `${b.instanceId}@${b.level}`).join();
      if (key !== rowsKey) {
        rowsKey = key;
        levels.replaceChildren();
        rows = [];
        const byLevel = new Map();
        for (const b of currentState.buildings) {
          const at = currentState.levels[b.level - 1];
          if (!at || isOutside(currentCtx, at)) continue; // the surface is outside the Shaft's air
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

/**
 * One line's list: what it is, what nothing reaches, and its nodes, each
 * with its sockets in use and its links.
 */
function networkPage(parent, state, ctx, dispatch, networkId) {
  const net = networkDef(ctx, networkId);
  const card = el('section', 'card net-card');
  card.style.setProperty('--net', colorOf(networkId));
  const title = el('h2', 'net-title', net.name);
  const about = el('p', 'meter-label net-about', describe(ctx, networkId));
  const gaps = el('div', 'net-gaps');
  const nodes = el('div', 'net-nodes');
  card.append(title, about, gaps, nodes);
  parent.appendChild(card);

  let signature = null;
  let readouts = [];

  function rebuild(currentState, currentCtx, view) {
    const { linkFrom } = selection.get();
    const from = linkFrom?.network === networkId ? currentState.buildings.find((b) => b.instanceId === linkFrom.instanceId) : null;

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
        : `${networkId.startsWith('power') ? 'Grid' : 'Group'} ${letters[lettered++] ?? '?'} · ${group.live ? 'live' : 'nothing feeding it'}`;
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

    // Its sockets on this line: how many of each kind are in use.
    const use = socketUse(currentState, currentCtx, networkId, node);
    const plugs = el('span', 'meter-label net-sockets', socketsOf(currentCtx, networkId, node.buildingId)
      .map((k) => `${k.label} ${use.get(k.id)?.length ?? 0}/${k.count}`).join(' · '));
    row.append(tag, name, reading, plugs);

    // Junction priority, 1 served first.
    if (networkId.startsWith('power') && isHub(currentCtx, 'power-lines', node.buildingId)) {
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
        // A tap ends in a tee on another run, not at a building.
        const other = link.tap ? null : link.from === node.instanceId ? link.b : link.a;
        const level = other?.level ?? link.tee?.level ?? node.level;
        const what = other ? currentCtx.catalog.buildings.byId[other.buildingId].name : 'tee';
        const span = Math.abs(level - node.level);
        const downhill = net.flowsDownhill ? (level > node.level ? ' ↓' : level < node.level ? ' ↑' : '') : '';
        const item = el('span', 'net-link');
        item.append(
          el('span', 'meter-label', `${link.tap ? '⊢' : '↔'} ${what} L${level} · ${span} lv${downhill}`),
          button('✕', `Take out the ${net.link} to the ${what.toLowerCase()} on level ${level}`, () => {
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

  return {
    update(currentState, currentCtx) {
      const view = readNetwork(currentState, currentCtx, networkId);
      const { linkFrom } = selection.get();
      const key = JSON.stringify([
        view.groups.map((g) => [g.key, g.live, g.nodes.map((n) => n.instanceId)]),
        view.links.map((l) => l.id),
        view.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}:${g.what}`),
        linkFrom?.network === networkId ? linkFrom.instanceId : null,
        networkId.startsWith('power') ? currentState.buildings.map((b) => b.priority ?? '') : null,
        AIR_LINES.includes(networkId) ? currentState.buildings.map((b) => b.fanMode ?? '') : null,
      ]);
      if (key !== signature) {
        signature = key;
        rebuild(currentState, currentCtx, view);
      }
      for (const { node, reading } of readouts) reading.textContent = readingOf(currentState, currentCtx, networkId, node);
    },
  };
}

/** What to do next, in the shaft: start a link, or finish the one in hand. */
function hintOf(state, ctx) {
  const { network, linkFrom } = selection.get();
  if (!linkFrom) return 'Click a free socket on a room in the Shaft to lay a line from it, or a joint on a pipe to tee a room into it. Click a line to pick it out; its sockets then offer ✕ to take it out.';
  const net = networkDef(ctx, linkFrom.network);
  if (linkFrom.tap) return `Teeing into a ${net?.link ?? network}: click a lit socket, or a room with one, to plug it in. Right-click or Esc stops.`;
  const from = state.buildings.find((b) => b.instanceId === linkFrom.instanceId);
  const name = from ? ctx.catalog.buildings.byId[from.buildingId].name.toLowerCase() : 'room';
  return `Laying a ${net?.link ?? network} from the ${name} on level ${from?.level ?? '?'}: click a lit socket, or a room with one, to plug it in, or a run to tee into (at most ${net?.maxSpanLevels} levels). Right-click or Esc stops.`;
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
      if (power.offGrid?.length) lines.push([`${power.offGrid.length} rooms wired to no junction`, 'critical']);
      break;
    }
    case 'water-mains': {
      lines.push([`Pumps push ${round(water.reclaimed)} reclaimed + ${round(water.pumped)} fresh a tick, for ${round(water.demand)} wanted`, water.peopleShare < 1 ? 'critical' : water.buildingShare < 1 ? 'warn' : 'ok']);
      if ((water.stranded ?? 0) > 0.5) lines.push([`${round(water.stranded)} a tick reclaimed but wasted: no pump to push it back`, 'warn']);
      lines.push([`Cisterns ${round(water.stored)} of ${round(water.capacity)} · quality ${round(water.quality)}%`, water.quality < ctx.config.population.waterQualitySafe ? 'warn' : 'ok']);
      if (water.peopleShare < 1) lines.push([`People get ${round(water.peopleShare * 100)}% of what they drink`, 'critical']);
      break;
    }
    case 'power':
      lines.push(...statusLines(state, ctx, 'power-grid'));
      break;
    case 'water':
      lines.push(...statusLines(state, ctx, 'water-mains'), ...statusLines(state, ctx, 'sewer'));
      if (water.unserved?.length) lines.push([`${water.unserved.length} rooms on no feed line`, 'critical']);
      if (water.dryLevels?.length) lines.push([`Residents with no water on level${water.dryLevels.length > 1 ? 's' : ''} ${water.dryLevels.join(', ')}`, 'critical']);
      break;
    case 'sewer': {
      const dumped = (water.spilled ?? []).reduce((a, b) => a + b, 0);
      lines.push([`Draining ${round(water.greywater)} a tick to reclamation`, 'ok']);
      if (dumped > 0.01) {
        const where = (water.spilled ?? []).map((q, l) => (q > 0.01 ? l : null)).filter(Boolean);
        lines.push([`Dumping ${Math.round(dumped * 10) / 10} a tick on level${where.length > 1 ? 's' : ''} ${where.join(', ')}`, 'critical']);
      }
      break;
    }
    case 'air': {
      const band = (q) => (q < ctx.config.air.qualityCriticalThreshold ? 'critical' : q < ctx.config.air.qualityWarnThreshold ? 'warn' : 'ok');
      const lived = state.levels.filter((l) => !isOutside(ctx, l) && state.buildings.some((b) => b.level === l.index));
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
    case 'power-grid':
    case 'power-lines': {
      const j = power.junctions?.[node.instanceId];
      if (j) return `${Math.round(j.load)}/${j.capacity} kW · ${j.consumers} rooms${j.dark ? ` · ${j.dark} dark` : ''}`;
      if (networkId === 'power-lines') return node.powered === false ? 'dark' : 'lit';
      if (power.batteries?.[node.instanceId] !== undefined) {
        const cap = (def.effects ?? []).find((e) => e.op === 'buffer.add')?.value ?? 1;
        return `charge ${Math.round((power.batteries[node.instanceId] / cap) * 100)}%`;
      }
      const made = (def.produces ?? []).find((p) => p.id === 'power');
      return made ? `${Math.round(made.qty * outputScale({ ...node, powered: true }, def, ctx))} kW` : '';
    }
    case 'water-mains':
    case 'sewer':
    case 'water-feeds': {
      const cap = cisternCapacity(def);
      if (cap > 0) return `${Math.round(water.cisterns?.[node.instanceId] ?? 0)}/${cap} held`;
      if (networkId === 'water-feeds') return `${Math.round((node.waterShare ?? 1) * 100)}% of its water`;
      if (water.sewage?.[node.instanceId] !== undefined) return `${Math.round(water.sewage[node.instanceId])} a tick coming in`;
      if (water.lift?.[node.instanceId] !== undefined) return `pushing water up ${Math.round(water.lift[node.instanceId])} levels`;
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
