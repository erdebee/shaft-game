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

    const level = state.levels.find((l) => l.index === cmd.level);
    if (!level) return;

    const slot = firstFreeSlot(state, ctx, def, level);
    if (slot === null) return;

    state.buildings.push(createInstance(def, ctx, {
      instanceId: `b${state.buildings.length + 1}`,
      level: cmd.level,
      slot,
    }));
    log(state, `${def.name} built on level ${cmd.level}`);
  },

  /** Reorder the power priority ladder. */
  'player:setPriorityLadder': (state, ctx, cmd) => {
    if (!Array.isArray(cmd.ladder)) return;
    state.governance.priorityLadder = [...cmd.ladder];
    log(state, 'Order of Supply amended');
  },

  /** Assign or unassign workers to a building. */
  'player:assignStaff': (state, ctx, cmd) => {
    const instance = state.buildings.find((b) => b.instanceId === cmd.instanceId);
    if (!instance) return;
    instance.staffing = Math.max(0, cmd.count);
  },
};

/**
 * A run of free slots wide enough for this building, or null if it cannot be
 * placed. Returning a slot index rather than a boolean is what lets the view
 * lay buildings out side by side instead of stacking them.
 *
 * Leftmost by default. A building with a `fixed` block is part of the Shaft as
 * built rather than something the player fits in: it goes on the level its
 * catalogue entry names and nowhere else, and `align: "right"` puts it at that
 * level's far end — which is where the Exit has always been.
 */
function firstFreeSlot(state, ctx, def, level) {
  const band = depthBandOf(ctx, level.index);
  if (def.levelConstraint && def.levelConstraint !== band) return null;
  if (def.fixed && def.fixed.level !== level.index) return null;

  const placed = state.buildings.filter((b) => b.level === level.index);
  const width = def.slots ?? 1;

  const allowance = ctx.tables?.levels?.levelTemplate?.zoneAllowances?.[def.zone];
  if (allowance) {
    const inZone = placed
      .map((b) => ctx.catalog.buildings.byId[b.buildingId])
      .filter((d) => d?.zone === def.zone)
      .reduce((n, d) => n + (d.slots ?? 1), 0);
    if (inZone + width > allowance) return null;
  }

  const occupied = new Set();
  for (const b of placed) {
    for (let i = 0; i < (b.slots ?? 1); i++) occupied.add((b.slot ?? 0) + i);
  }

  const last = level.buildSlots - width;
  const fromRight = def.fixed?.align === 'right';
  for (let n = 0; n <= last; n++) {
    const start = fromRight ? last - n : n;
    let free = true;
    for (let i = 0; i < width; i++) if (occupied.has(start + i)) { free = false; break; }
    if (free) return start;
  }
  return null;
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
  handler(state, ctx, stamped);

  ctx.emit('command:applied', stamped);
  return stamped;
}

/**
 * Apply a recorded command without re-logging it. Used by replay, which
 * already has the log and must not append to it.
 */
export function applyRecorded(state, ctx, command) {
  const handler = HANDLERS[command.type];
  if (!handler) throw new Error(`commands: unknown command "${command.type}"`);
  handler(state, ctx, command);
}

export function knownCommands() {
  return Object.keys(HANDLERS);
}
