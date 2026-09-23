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
import { applyEffects } from './effects.js';
import { evaluate } from './predicates.js';
import { createInstance } from '../systems/buildings/buildingRegistry.js';
import { emit as busEmit } from './eventBus.js';
import { inStorehouses, takeFromStorehouses } from '../systems/resources/stores.js';
import { hire } from '../systems/population/roster.js';
import { labourPool } from '../systems/population/staffing.js';
import { validRoute } from '../systems/haulage/haulageMethods.js';

const HANDLERS = {
  /** Pause, resume, or change speed. The only command available from tick 0. */
  'player:setSpeed': (state, ctx, cmd) => {
    const speed = SPEEDS[cmd.speed];
    if (speed === undefined) throw new Error(`commands: unknown speed "${cmd.speed}"`);
    state.clock.speed = speed;
  },

  /** Resolve the active dilemma by choosing one of its options. */
  'player:resolveDilemma': (state, ctx, cmd) => {
    const active = state.narrative.activeDilemma;
    if (!active || active.id !== cmd.dilemmaId) return;

    const dilemma = ctx.content.dilemmas.byId[cmd.dilemmaId];
    const option = dilemma?.options.find((o) => o.id === cmd.optionId);
    if (!option) throw new Error(`commands: no option "${cmd.optionId}" on "${cmd.dilemmaId}"`);
    if (!evaluate(state, ctx, option.requires)) return; // gated; ignore rather than throw

    applyEffects(state, ctx, option.effects, `dilemma:${cmd.dilemmaId}:${cmd.optionId}`);
    state.narrative.activeDilemma = null;
    state.narrative.dilemmaCooldowns[cmd.dilemmaId] = state.clock.tick;
    log(state, `Ruled on ${dilemma.id}: ${option.label}`);
  },

  /** Place a building on a level. */
  'player:placeBuilding': (state, ctx, cmd) => {
    const def = ctx.catalog.buildings.byId[cmd.buildingId];
    if (!def) throw new Error(`commands: unknown building "${cmd.buildingId}"`);

    const check = placement(state, ctx, cmd.buildingId, cmd.level, { inherited: cmd.inherited === true });
    if (!check.ok) {
      ctx.emit('build:refused', { buildingId: cmd.buildingId, level: cmd.level, reason: check.reason });
      return;
    }
    // Materials come out of the common stores, nearest the site first.
    for (const c of check.cost) takeFromStorehouses(state, ctx, c.id, c.qty, cmd.level);

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
    log(state, `${def?.name ?? instance.buildingId} demolished on level ${instance.level}`);
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

  /** Give a porter a route: stops they walk in order, then loop. */
  'player:setRoute': (state, ctx, cmd) => {
    const porter = state.population.workers.find((w) => w.id === cmd.workerId && w.job === 'porter');
    const stops = porter ? validRoute(state, ctx, cmd.stops) : null;
    if (!stops) return;
    porter.route = stops;
    porter.stop = Math.min(porter.stop ?? 0, Math.max(0, stops.length - 1));
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
 * Slot: leftmost free run by default. A building with a `fixed` block is part
 * of the Shaft as built rather than something the player fits in: it goes on
 * the level its catalogue entry names and nowhere else, and `align: "right"`
 * puts it at that level's far end — which is where the Exit has always been.
 *
 * Cost: the building's `buildCost`, or its repairCost times
 * buildings.buildCostFromRepair, paid from the depots and storehouses. The
 * Shaft the player inherits is free (`inherited`).
 */
export function placement(state, ctx, buildingId, levelIndex, { inherited = false } = {}) {
  const def = ctx.catalog.buildings.byId[buildingId];
  if (!def) throw new Error(`commands: unknown building "${buildingId}"`);
  const cost = inherited ? [] : buildCost(ctx, def);
  const level = state.levels.find((l) => l.index === levelIndex);
  if (!level) return { ok: false, slot: null, cost, reason: 'no-level' };
  if (def.fixed && def.fixed.level !== levelIndex) return { ok: false, slot: null, cost, reason: 'fixed' };
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

function log(state, message) {
  state.log.push({ tick: state.clock.tick, message });
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
