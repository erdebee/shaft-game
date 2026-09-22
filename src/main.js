/**
 * main.js
 * Entry point. Loads the dataset, builds state, wires systems into the engine,
 * mounts the UI, and starts the loop.
 *
 * The only place that knows about both the simulation and the DOM. Systems get
 * a context; the view gets state; neither imports the other.
 */

import { start, stepOnce } from './core/engine.js';
import { createRun } from './core/run.js';
import { dispatch as dispatchCommand } from './core/commands.js';
import { on } from './core/eventBus.js';

import * as router from './ui/router.js';
import * as dashboard from './ui/screens/dashboard.js';
import { createShaftView } from './ui/view/shaftView.js';
import { loadRoomArt } from './ui/view/roomArt.js';
import { focusLevel } from './ui/view/viewport.js';
import { mount as mountTimeControls } from './ui/components/timeControls.js';
import { append as logAppend } from './ui/components/logPanel.js';

/**
 * Starting layout for the slice. Placed through the same command path the
 * player uses, so nothing here is a special case the UI cannot also produce.
 *
 * Cultivation deliberately sits high and the canteens low, so food has to be
 * hauled a long way down — which is what puts porters on the stairwell where
 * they can be watched. Balance is placeholder throughout (see base.json).
 */
const OPENING_LAYOUT = [
  // Level 1 was built before the player: the hall takes six slots at one end
  // and the Exit four at the other, which fills the level. Both carry a
  // `fixed` block, so the command path puts them where the catalogue says and
  // nowhere else.
  ['auditorium', 1],
  ['shaft-exit', 1],
  ['council-chamber', 2],
  ['archive', 3],
  ['oxygen-garden', 6],
  ['superior-suite', 8],
  ['common-hall', 10],
  ['junction', 12],
  ['hydroponics-bay', 13],
  ['hydroponics-bay', 13],
  ['hydroponics-bay', 14],
  ['hydroponics-bay', 14],
  ['protein-vats', 15],
  ['protein-vats', 15],
  ['hydroponics-bay', 16],
  ['hydroponics-bay', 16],
  ['food-processing', 17],
  ['grove', 5],
  ['scrubber-bank', 20],
  ['freight-elevator', 20],
  ['clinic', 22],
  ['simple-suite', 24],
  ['canteen', 26],
  ['simple-suite', 27],
  ['canteen', 28],
  ['junction', 30],
  ['cistern', 32],
  ['scrubber-bank', 34],
  ['workshop', 36],
  ['smelter', 37],
  ['main-generator', 38],
  ['judicial', 4],
  ['dig-face', 40],
  ['deep-pump', 40],
  ['reclamation-plant', 42],
];

async function boot({ chapter = 1, seed = 1234, profile = 'default' } = {}) {
  // createRun owns everything deterministic: dataset, state, streams, systems,
  // opening stores and the porter roster. Nothing that shapes a run may live
  // here, or the run stops replaying from its command log alone.
  const { engine, state, ctx, dataset } = await createRun({ chapter, seed, profile });

  const dispatch = (command) => dispatchCommand(state, ctx, command);

  // The opening layout goes through the command path the player uses, so it
  // lands in the command log and replays with everything else.
  for (const [buildingId, level] of OPENING_LAYOUT) {
    dispatch({ type: 'player:placeBuilding', buildingId, level });
  }
  for (const instance of state.buildings) {
    const def = dataset.catalog.buildings.byId[instance.buildingId];
    dispatch({ type: 'player:assignStaff', instanceId: instance.instanceId, count: def.staffing ?? 0 });
  }

  // --- UI --------------------------------------------------------------
  const roomArt = await loadRoomArt();

  const app = document.getElementById('app');
  app.replaceChildren();

  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  app.appendChild(topbar);

  const shaftHost = document.createElement('div');
  shaftHost.className = 'shaft-host';
  app.appendChild(shaftHost);

  const panel = document.createElement('div');
  panel.className = 'panel';
  app.appendChild(panel);

  document.documentElement.dataset.chapter = String(chapter);

  const timeControls = mountTimeControls(topbar, dispatch);
  const shaftView = createShaftView(shaftHost, state, ctx, roomArt);

  // Open on the inhabited middle of the shaft rather than level 1. The top
  // levels are administration and mostly still; the traffic is between
  // cultivation and the canteens, and that is what the view is for.
  const levels = state.buildings.map((b) => b.level).sort((a, b) => a - b);
  if (levels.length) focusLevel(shaftView.viewport, levels[Math.floor(levels.length / 2)]);

  router.attach(panel, { state, ctx, dispatch });
  router.register('dashboard', dashboard);
  router.go('dashboard');

  wireLog(state, ctx);

  engine.view = shaftView;
  engine.onFrame = (currentState) => {
    timeControls.update(currentState);
    router.update(currentState, ctx);
  };

  // One tick before the first frame, so the view opens on a settled sim
  // rather than an empty one.
  stepOnce(engine);
  start(engine);

  // Exposed for debugging and for driving the sim from the console.
  window.game = { engine, state, ctx, dispatch, dataset, shaftView };
  return window.game;
}

/**
 * Turn simulation events into player-visible log entries. The bus is the
 * boundary: the log records what happened, and systems never write to it.
 */
function wireLog(state, ctx) {
  const record = (message, kind = 'info') => {
    const entry = { tick: state.clock.tick, message, kind };
    state.log.push(entry);
    logAppend(entry);
  };

  /**
   * A shortfall fires every tick it persists, which would bury the log in one
   * repeated line. Report the onset, then stay quiet until it clears: the
   * dashboard carries ongoing state, the log carries events.
   */
  const ongoing = new Map();
  const onset = (key, tick) => {
    const last = ongoing.get(key);
    ongoing.set(key, tick);
    return last === undefined || tick - last > 1;
  };

  on('power:shortfall', ({ brownedOut, levels, tick }) => {
    if (!onset('power', tick)) return;
    record(
      `Brownout: ${brownedOut.length} buildings dark on level${levels.length > 1 ? 's' : ''} ${levels.join(', ')}`,
      'critical',
    );
  });

  on('building:breakdown', ({ buildingId, level }) => {
    record(`${buildingId} broke down on level ${level}`, 'warn');
  });

  on('resource:shortfall', ({ id, qty, tick }) => {
    if (!onset(`stock:${id}`, tick)) return;
    record(`Short of ${id} by ${qty.toFixed(1)}`, 'warn');
  });

  on('water:shortfall', ({ peopleShare, tick }) => {
    if (!onset('water', tick)) return;
    record(peopleShare < 1 ? 'Water rationed: people are going thirsty' : 'Water rationed: buildings on short supply', 'critical');
  });

  on('air:critical', ({ level }) => record(`The air on level ${level} is failing`, 'critical'));
  on('air:recovered', ({ level }) => record(`The air on level ${level} is breathable again`));

  on('population:day', ({ deaths, births, departures }) => {
    const causes = { starvation: 'starved', thirst: 'died of thirst', suffocation: 'suffocated', illness: 'died of illness' };
    const lost = Object.entries(deaths)
      .map(([cause, n]) => [cause, Math.round(n)])
      .filter(([, n]) => n > 0)
      .map(([cause, n]) => `${n} ${causes[cause]}`);
    if (departures >= 1) lost.push(`${Math.round(departures)} left through the Exit`);
    if (lost.length) record(`Today ${lost.join(', ')}`, 'critical');
    if (births >= 1) record(`${Math.round(births)} born under the lottery`);
  });

  const faction = (id) => ctx.catalog.factions.byId[id]?.name ?? id;
  const building = (id) => ctx.catalog.buildings.byId[id]?.name ?? id;
  on('unrest:warning', ({ faction: id }) => record(`${faction(id)} warns that the people are losing patience`, 'warn'));
  on('unrest:strike', ({ faction: id }) => record(`${faction(id)} has walked out: its buildings stand empty`, 'critical'));
  on('unrest:strikeEnded', ({ faction: id }) => record(`${faction(id)} is back at work`));
  on('unrest:demands', () => record('The people are demanding change', 'critical'));
  on('unrest:riot', ({ buildingId, level }) => record(`Rioters wrecked the ${building(buildingId).toLowerCase()} on level ${level}`, 'critical'));
  on('unrest:demolished', ({ buildingId, level }) => record(`Rioters tore down the ${building(buildingId).toLowerCase()} on level ${level}`, 'critical'));

  on('maintenance:stalled', ({ id, tick }) => {
    if (!onset(`repairs:${id}`, tick)) return;
    record(`Repairs stalled: no ${id} in the stores`, 'warn');
  });

  on('supply:delivered', ({ id, qty }) => record(`${qty} ${id} came down from outside`));

  on('clock:autoPaused', ({ reason }) => {
    record(`Paused: ${reason}`, 'warn');
  });

  on('decision:window', () => record('Decision window open'));
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const app = document.getElementById('app');
  if (app) {
    app.textContent = `Boot failed: ${err.message}`;
    app.style.color = 'var(--critical)';
    app.style.padding = '2rem';
    app.style.fontFamily = 'var(--font-mono)';
  }
});
