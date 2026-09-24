/**
 * commands.js
 * Player intent. The UI never writes state — it dispatches a command, which is
 * recorded and then applied here.
 *
 * A run is `seed + configHash + commandLog`. That is what makes a bug report
 * a 2KB file instead of a save game, and it is what keeps the UI honest: a
 * screen that mutates state directly breaks replay immediately and visibly,
 * rather than rotting quietly.
 *
 * Commands run while paused, because intent is not simulation time. They are
 * stamped with the tick they were issued on, so replay applies each one at the
 * same point in the timeline it originally landed.
 */

import { SPEEDS } from './clock.js';
import { resolve as resolveDilemma, raise as raiseDilemma } from '../narrative/dilemmaEngine.js';
import { enact, repeal } from '../governance/statuteEngine.js';
import { createInstance } from '../systems/buildings/buildingRegistry.js';
import { emit as busEmit } from './eventBus.js';
import { inStorehouses, takeFromStorehouses } from '../systems/resources/stores.js';
import { used } from '../systems/resources/ledger.js';
import { hire } from '../systems/population/roster.js';
import { labourPool } from '../systems/population/staffing.js';
import { validRoute } from '../systems/haulage/haulageMethods.js';
import { canLink, canTap, networkDef, isHub } from '../systems/infrastructure/networkGraph.js';

const HANDLERS = {
  /**
   * Pause, resume, or change speed. The only command available from tick 0.
   * A hard-pausing dilemma holds the clock until it is ruled on.
   */
  'player:setSpeed': (state, ctx, cmd) => {
    const speed = SPEEDS[cmd.speed];
    if (speed === undefined) throw new Error(`commands: unknown speed "${cmd.speed}"`);
    if (state.narrative.activeDilemma?.hardPause && speed !== SPEEDS.PAUSED) return;
    state.clock.speed = speed;
  },

  /**
   * Rule on the active dilemma (narrative/dilemmaEngine.js). A ruling not on
   * offer, or one that cannot be given, is ignored rather than thrown on.
   */
  'player:resolveDilemma': (state, ctx, cmd) => {
    resolveDilemma(state, ctx, cmd.dilemmaId, cmd.optionId);
  },

  /** Enact a law card while a session sits, paying its Authority. */
  'player:enactStatute': (state, ctx, cmd) => {
    const verdict = enact(state, ctx, cmd.cardId);
    const title = ctx.content.lawCards.byId[cmd.cardId]?.title ?? cmd.cardId;
    if (!verdict.ok) {
      ctx.emit('accord:refused', { cardId: cmd.cardId, reason: verdict.reason });
      return;
    }
    log(state, `Enacted: ${title} (${verdict.cost.total} Authority)`);
  },

  /** Repeal an enacted card while a session sits; the flip-flop penalty applies. */
  'player:repealStatute': (state, ctx, cmd) => {
    const result = repeal(state, ctx, cmd.cardId);
    const title = ctx.content.lawCards.byId[cmd.cardId]?.title ?? cmd.cardId;
    if (!result.ok) {
      ctx.emit('accord:refused', { cardId: cmd.cardId, reason: result.reason });
      return;
    }
    log(state, `Repealed: ${title}${result.penalty ? ` (−${result.penalty} stability and trust)` : ''}`, result.penalty ? 'warn' : 'info');
  },

  /**
   * Put a dilemma in front of the player now, ignoring its preconditions —
   * for playtesting a case without waiting for the Shaft to earn it. A
   * command like any other, so a run that used it still replays.
   */
  'debug:raiseDilemma': (state, ctx, cmd) => {
    if (state.narrative.activeDilemma) return;
    raiseDilemma(state, ctx, cmd.dilemmaId);
    if (state.narrative.activeDilemma.hardPause) state.clock.speed = SPEEDS.PAUSED;
  },

  /** Place a building on a level. */
  'player:placeBuilding': (state, ctx, cmd) => {
    const def = ctx.catalog.buildings.byId[cmd.buildingId];
    if (!def) throw new Error(`commands: unknown building "${cmd.buildingId}"`);

    const check = placement(state, ctx, cmd.buildingId, cmd.level, { inherited: cmd.inherited === true, slot: cmd.slot ?? null });
    if (!check.ok) {
      ctx.emit('build:refused', { buildingId: cmd.buildingId, level: cmd.level, reason: check.reason });
      return;
    }
    // Materials come out of the common stores, nearest the site first.
    for (const c of check.cost) used(state, c.id, takeFromStorehouses(state, ctx, c.id, c.qty, cmd.level), 'construction');

    state.buildings.push(createInstance(def, ctx, {
      instanceId: nextInstanceId(state),
      level: cmd.level,
      slot: check.slot,
    }));
    log(state, `${def.name} built on level ${cmd.level}`);
  },

  /**
   * Tear a building down. Nothing is refunded: what went into it is spent.
   * The Shaft's fixed structure cannot be demolished.
   */
  'player:demolish': (state, ctx, cmd) => {
    const instance = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    if (!instance) return;
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (def?.fixed) return;
    state.buildings = state.buildings.filter((b) => b !== instance);
    // Its cables, pipes and ducts come down with it.
    if (state.infrastructure) {
      state.infrastructure.links = withoutOrphans(state.infrastructure.links.filter((l) => l.from !== instance.instanceId && l.to !== instance.instanceId));
    }
    log(state, `${def?.name ?? instance.buildingId} demolished on level ${instance.level}`);
  },

  /**
   * Lay a cable, wire, pipe, drain, feed line or duct between two buildings
   * on a network (catalog/infrastructure/networks.json), plugged into the
   * sockets `fromSocket` and `toSocket` name — or, either left out, the first
   * free socket that fits. With `tap` (a link id) instead of `to`, the line
   * runs into the middle of that link: a tee, on a network that can be
   * branched. The materials come out of the common stores, nearest the upper
   * end first; the Shaft the player inherits is already laid, and free.
   */
  'player:link': (state, ctx, cmd) => {
    const tapping = cmd.tap != null;
    const check = tapping
      ? canTap(state, ctx, cmd.network, cmd.from, cmd.tap, { fromSocket: cmd.fromSocket ?? null })
      : canLink(state, ctx, cmd.network, cmd.from, cmd.to, { fromSocket: cmd.fromSocket ?? null, toSocket: cmd.toSocket ?? null });
    const refused = (reason) => ctx.emit('link:refused', { network: cmd.network, from: cmd.from, to: cmd.to ?? null, tap: cmd.tap ?? null, reason });
    if (!check.ok) {
      refused(check.reason);
      return;
    }
    const cost = cmd.inherited === true ? [] : check.cost;
    const a = state.buildings.find((b) => b.instanceId === cmd.from);
    const farLevel = tapping ? check.level : state.buildings.find((x) => x.instanceId === cmd.to).level;
    const near = Math.min(a.level, farLevel);
    if (!cost.every((c) => inStorehouses(state, ctx, c.id) >= c.qty)) {
      refused('cost');
      return;
    }
    for (const c of cost) used(state, c.id, takeFromStorehouses(state, ctx, c.id, c.qty, near), 'construction');
    state.infrastructure ??= { links: [], nextLinkId: 1 };
    const id = `l${state.infrastructure.nextLinkId}`;
    state.infrastructure.nextLinkId += 1;
    state.infrastructure.links.push(tapping
      ? { id, network: cmd.network, from: cmd.from, to: null, tap: cmd.tap, fromSocket: check.fromSocket, toSocket: null }
      : { id, network: cmd.network, from: cmd.from, to: cmd.to, fromSocket: check.fromSocket, toSocket: check.toSocket });
    if (cmd.inherited !== true) {
      const net = networkDef(ctx, cmd.network);
      log(state, tapping
        ? `${net.name}: ${net.link} teed in from level ${a.level} at level ${farLevel}`
        : `${net.name}: ${net.link} laid between levels ${a.level} and ${farLevel}`);
    }
  },

  /** Take a link out, and every line teed into it. Nothing is recovered. */
  'player:unlink': (state, ctx, cmd) => {
    const links = state.infrastructure?.links ?? [];
    const link = links.find((l) => l.id === cmd.linkId);
    if (!link) return;
    state.infrastructure.links = withoutOrphans(links.filter((l) => l !== link));
    const net = networkDef(ctx, link.network);
    log(state, `${net?.name ?? link.network}: ${net?.link ?? 'link'} taken out`);
  },

  /** Set a duct fan to suck air off its levels or blow it onto them (airflow.js). */
  'player:setFanMode': (state, ctx, cmd) => {
    const instance = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    if (!instance || !isHub(ctx, 'foul-ducts', instance.buildingId)) return;
    if (cmd.mode !== 'suck' && cmd.mode !== 'blow') return;
    instance.fanMode = cmd.mode;
  },

  /**
   * Rank a junction 1 (served first) to 5 (dropped first) for when the
   * generators run short (systems/power/priorityLadder.js).
   */
  'player:setPriority': (state, ctx, cmd) => {
    const instance = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    if (!instance || !isHub(ctx, 'power-lines', instance.buildingId)) return;
    const priority = Math.round(Number(cmd.priority));
    if (!(priority >= 1 && priority <= 5)) return;
    instance.priority = priority;
  },

  /**
   * Pin a recipe building to one recipe, or null to let it choose by reserve
   * (systems/resources/componentChain.js). The batch in hand finishes first.
   */
  'player:setRecipe': (state, ctx, cmd) => {
    const instance = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    if (!instance) return;
    if (cmd.recipeId !== null) {
      const recipe = ctx.catalog.recipes.byId[cmd.recipeId];
      if (!recipe || recipe.building !== instance.buildingId) return;
    }
    instance.recipeId = cmd.recipeId;
  },

  /**
   * Hire a porter at a station, if it has a bed free and the labour pool has
   * someone to spare. They start there, with no route.
   */
  'player:hirePorter': (state, ctx, cmd) => {
    const station = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    const beds = ctx.catalog.buildings.byId[station?.buildingId]?.porterStation?.porters ?? 0;
    if (!station || beds === 0) return;
    const living = state.population.workers.filter((w) => w.stationId === station.instanceId).length;
    if (living >= beds) {
      ctx.emit('haulage:refused', { reason: 'station-full', instanceId: station.instanceId });
      return;
    }
    if (!cmd.inherited && labourPool(state, ctx) < 1) {
      ctx.emit('haulage:refused', { reason: 'no-labour', instanceId: station.instanceId });
      return;
    }
    const porter = hire(state, ctx, 'porter', station.level, station.instanceId);
    log(state, `${porter.name} hired as a porter at the station on level ${station.level}`);
  },

  /**
   * Let a porter go. They return to the labour pool; whatever they were
   * carrying is left where they stand, and lost.
   */
  'player:dismissPorter': (state, ctx, cmd) => {
    const porter = state.population.workers.find((w) => w.id === cmd.workerId && w.job === 'porter');
    if (!porter) return;
    state.population.workers = state.population.workers.filter((w) => w !== porter);
    state.haulage.trips = state.haulage.trips.filter((t) => t.workerId !== porter.id);
    log(state, `${porter.name} dismissed from portering`);
  },

  /**
   * Define a new route, empty unless `stops` are given, named `name` or
   * "Route n". With a `workerId`, that porter is assigned to it at once.
   */
  'player:createRoute': (state, ctx, cmd) => {
    const stops = validRoute(state, ctx, cmd.stops ?? []);
    if (!stops) return;
    const n = state.haulage.nextRouteId;
    const route = { id: `r${n}`, name: routeName(cmd.name) ?? `Route ${n}`, stops };
    state.haulage.nextRouteId += 1;
    state.haulage.routes.push(route);
    if (cmd.workerId !== undefined) HANDLERS['player:assignRoute'](state, ctx, { workerId: cmd.workerId, routeId: route.id });
  },

  'player:renameRoute': (state, ctx, cmd) => {
    const route = state.haulage.routes.find((r) => r.id === cmd.routeId);
    const name = routeName(cmd.name);
    if (route && name) route.name = name;
  },

  /** Set a route's stops: walked in order, then looped, by every porter on it. */
  'player:setRoute': (state, ctx, cmd) => {
    const route = state.haulage.routes.find((r) => r.id === cmd.routeId);
    const stops = route ? validRoute(state, ctx, cmd.stops) : null;
    if (!stops) return;
    route.stops = stops;
    for (const porter of state.population.workers) {
      if (porter.routeId !== route.id) continue;
      porter.stop = Math.min(porter.stop ?? 0, Math.max(0, stops.length - 1));
      porter.item = 0;
    }
  },

  /** Take a route away. Its porters are left with none, and go home. */
  'player:deleteRoute': (state, ctx, cmd) => {
    const route = state.haulage.routes.find((r) => r.id === cmd.routeId);
    if (!route) return;
    state.haulage.routes = state.haulage.routes.filter((r) => r !== route);
    for (const porter of state.population.workers) {
      if (porter.routeId === route.id) {
        porter.routeId = null;
        porter.stop = 0;
        porter.item = 0;
      }
    }
  },

  /**
   * Put a porter on a route, or on none with null. A porter moved to another
   * route starts it from the first stop, carrying what they hold.
   */
  'player:assignRoute': (state, ctx, cmd) => {
    const porter = state.population.workers.find((w) => w.id === cmd.workerId && w.job === 'porter');
    if (!porter) return;
    if (cmd.routeId !== null && !state.haulage.routes.some((r) => r.id === cmd.routeId)) return;
    if (porter.routeId === cmd.routeId) return;
    porter.routeId = cmd.routeId;
    porter.stop = 0;
    porter.item = 0;
  },

  /** How many crews go round repairing, ahead of every building's staff. */
  'player:setMaintenanceCrews': (state, ctx, cmd) => {
    state.maintenance.crewTarget = Math.max(0, Math.floor(cmd.count ?? 0));
  },

  /** Reorder the power priority ladder. */
  'player:setPriorityLadder': (state, ctx, cmd) => {
    if (!Array.isArray(cmd.ladder)) return;
    state.governance.priorityLadder = [...cmd.ladder];
    log(state, 'Order of Supply amended');
  },

  /**
   * Set how many crews a building should have. The labour pool fills it next
   * tick if it can (systems/population/staffing.js); it never exceeds what
   * the building has posts for.
   */
  'player:assignStaff': (state, ctx, cmd) => {
    const instance = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    if (!instance) return;
    const posts = ctx.catalog.buildings.byId[instance.buildingId]?.staffing ?? 0;
    instance.staffTarget = Math.max(0, Math.min(posts, cmd.count));
    // Until the pool next deals, the building has what it asked for — so a
    // building placed and staffed before the first tick works on that tick.
    instance.staffing = instance.staffTarget;
  },
};

/**
 * A fresh instance id from a counter in state. Not the count of buildings:
 * once a riot has demolished something, count + 1 can name a building that
 * still exists, and even the highest id + 1 can revive a demolished one's id
 * — which the view would take for the old building.
 */
function nextInstanceId(state) {
  state.nextInstanceId ??= 1 + state.buildings.reduce((max, b) => Math.max(max, Number(b.instanceId.slice(1)) || 0), 0);
  const id = `b${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return id;
}

/**
 * Whether a building can go on a level, and where, and what it costs.
 * Returns { ok, slot, cost, reason } — reason is one of 'no-level',
 * 'wrong-depth', 'fixed', 'zone-full', 'no-room', 'cost', or null when ok.
 * The build menu shows the reason; placeBuilding refuses on it.
 *
 * Slot: leftmost free run by default, or exactly `slot` when the player chose
 * one in the shaft — refused as 'occupied' if anything stands in that run, or
 * 'no-room' if the run would overhang the level. A building with a `fixed` block is part
 * of the Shaft as built rather than something the player fits in: it goes on
 * the level its catalogue entry names and nowhere else, and `align: "right"`
 * puts it at that level's far end — which is where the Exit has always been.
 *
 * A `system` building — the council chamber, the archive — is part of the
 * Shaft's government rather than something the player adds: the opening puts
 * it down (`inherited`), and the player cannot build another.
 *
 * Cost: the building's `buildCost`, or its repairCost times
 * buildings.buildCostFromRepair, paid from the depots and storehouses. The
 * Shaft the player inherits is free (`inherited`).
 */
export function placement(state, ctx, buildingId, levelIndex, { inherited = false, slot: chosen = null } = {}) {
  const def = ctx.catalog.buildings.byId[buildingId];
  if (!def) throw new Error(`commands: unknown building "${buildingId}"`);
  const cost = inherited ? [] : buildCost(ctx, def);
  const level = state.levels.find((l) => l.index === levelIndex);
  if (!level) return { ok: false, slot: null, cost, reason: 'no-level' };
  if (def.fixed && def.fixed.level !== levelIndex) return { ok: false, slot: null, cost, reason: 'fixed' };
  if (def.system && !inherited) return { ok: false, slot: null, cost, reason: 'system' };
  if (def.levelConstraint && def.levelConstraint !== depthBandOf(ctx, levelIndex)) {
    return { ok: false, slot: null, cost, reason: 'wrong-depth' };
  }

  const placed = state.buildings.filter((b) => b.level === levelIndex);
  const width = def.slots ?? 1;

  const allowance = ctx.tables?.levels?.levelTemplate?.zoneAllowances?.[def.zone];
  if (allowance) {
    const inZone = placed
      .map((b) => ctx.catalog.buildings.byId[b.buildingId])
      .filter((d) => d?.zone === def.zone)
      .reduce((n, d) => n + (d.slots ?? 1), 0);
    if (inZone + width > allowance) return { ok: false, slot: null, cost, reason: 'zone-full' };
  }

  const occupied = new Set();
  for (const b of placed) {
    for (let i = 0; i < (b.slots ?? 1); i++) occupied.add((b.slot ?? 0) + i);
  }
  let slot = null;
  const last = level.buildSlots - width;
  const fromRight = def.fixed?.align === 'right';
  if (chosen !== null) {
    if (chosen < 0 || chosen > last) return { ok: false, slot: null, cost, reason: 'no-room' };
    for (let i = 0; i < width; i++) {
      if (occupied.has(chosen + i)) return { ok: false, slot: null, cost, reason: 'occupied' };
    }
    slot = chosen;
  }
  for (let n = 0; n <= last && slot === null; n++) {
    const start = fromRight ? last - n : n;
    let free = true;
    for (let i = 0; i < width; i++) if (occupied.has(start + i)) { free = false; break; }
    if (free) slot = start;
  }
  if (slot === null) return { ok: false, slot: null, cost, reason: 'no-room' };

  const affordable = cost.every((c) => inStorehouses(state, ctx, c.id) >= c.qty);
  if (!affordable) return { ok: false, slot, cost, reason: 'cost' };
  return { ok: true, slot, cost, reason: null };
}

/** What a building costs to put up, in materials. */
export function buildCost(ctx, def) {
  if (def.buildCost) return def.buildCost;
  const k = ctx.config.buildings.buildCostFromRepair;
  return (def.repairCost ?? []).map((c) => ({ id: c.id, qty: Math.ceil(c.qty * k) }));
}

/** Which depth band a level falls in, from the levels lookup table. */
export function depthBandOf(ctx, levelIndex) {
  const bands = ctx.tables?.levels?.depthBands ?? [];
  for (const band of bands) {
    const to = band.toLevel ?? Infinity;
    if (levelIndex >= band.fromLevel && levelIndex <= to) return band.id;
  }
  return null;
}

function log(state, message, kind = 'info') {
  state.log.push({ tick: state.clock.tick, message, kind });
}

/**
 * Dispatch a command: record it, then apply it.
 * Recording before applying means a command that throws is still in the log,
 * so a crash is reproducible rather than lost.
 */
export function dispatch(state, ctx, command) {
  const stamped = { ...command, tick: state.clock.tick };
  state.commandLog.push(stamped);

  const handler = HANDLERS[command.type];
  if (!handler) throw new Error(`commands: unknown command "${command.type}"`);
  const live = commandContext(state, ctx);
  handler(state, live, stamped);

  live.emit('command:applied', stamped);
  return stamped;
}

/**
 * A command runs between ticks, outside the engine's pipeline, so nothing
 * will ever drain the per-tick outbox it would otherwise emit into. Its
 * events (a refused build, say) go straight to the bus instead.
 */
function commandContext(state, ctx) {
  return { ...ctx, emit: (event, payload) => busEmit(event, { ...payload, tick: state.clock.tick }) };
}

/**
 * Apply a recorded command without re-logging it. Used by replay, which
 * already has the log and must not append to it.
 */
export function applyRecorded(state, ctx, command) {
  const handler = HANDLERS[command.type];
  if (!handler) throw new Error(`commands: unknown command "${command.type}"`);
  handler(state, commandContext(state, ctx), command);
}

export function knownCommands() {
  return Object.keys(HANDLERS);
}

/** Links whose tapped link is gone go with it: a tee on nothing is nothing. */
function withoutOrphans(links) {
  const kept = new Set();
  return links.filter((l) => {
    if (l.tap && !kept.has(l.tap)) return false;
    kept.add(l.id);
    return true;
  });
}

/** A route's name, trimmed and kept short, or null if there is none. */
function routeName(name) {
  const clean = typeof name === 'string' ? name.trim().slice(0, 40) : '';
  return clean || null;
}
