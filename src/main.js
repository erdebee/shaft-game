/**
 * main.js
 * Entry point. Loads the dataset, builds state, wires systems into the engine,
 * mounts the UI, and starts the loop.
 *
 * The only place that knows about both the simulation and the DOM. Systems get
 * a context; the view gets state; neither imports the other.
 */

import { start, stepOnce } from './core/engine.js';
import { createRun, placeOpening } from './core/run.js';
import { dispatch as dispatchCommand } from './core/commands.js';
import { on } from './core/eventBus.js';

import * as router from './ui/router.js';
import * as dashboard from './ui/screens/dashboard.js';
import * as build from './ui/screens/build.js';
import * as inspect from './ui/screens/inspect.js';
import * as selection from './ui/selection.js';
import { createShaftView } from './ui/view/shaftView.js';
import { loadRoomArt } from './ui/view/roomArt.js';
import { setIcons } from './ui/icons.js';
import { nameOf } from './systems/resources/stores.js';
import { focusLevel } from './ui/view/viewport.js';
import { mount as mountTimeControls } from './ui/components/timeControls.js';
import * as logPanel from './ui/components/logPanel.js';
import * as resourceTip from './ui/components/resourceTip.js';
import * as musicToggle from './ui/components/musicToggle.js';
import { loadMusic, createMusic } from './ui/audio/music.js';

async function boot({ chapter = 1, seed = 1234, profile = 'default' } = {}) {
  // createRun owns everything deterministic: dataset, state, streams, systems,
  // opening stores and the porter roster. Nothing that shapes a run may live
  // here, or the run stops replaying from its command log alone.
  const { engine, state, ctx, dataset } = await createRun({ chapter, seed, profile });

  const dispatch = (command) => dispatchCommand(state, ctx, command);

  // The opening layout (the Shaft profile's `opening`) goes through the
  // command path the player uses, so it lands in the command log and replays
  // with everything else.
  placeOpening(state, ctx, dispatchCommand);

  // --- UI --------------------------------------------------------------
  // The score loads beside the art. Music is decoration: if it fails to load,
  // the game boots silent rather than not at all.
  const [roomArt, musicFiles] = await Promise.all([
    loadRoomArt(),
    loadMusic().catch((err) => { console.warn('Music unavailable:', err); return null; }),
  ]);
  setIcons(roomArt.icons);

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
  const music = musicFiles ? createMusic(musicFiles) : null;
  if (music) musicToggle.mount(topbar, music);
  // Any icon carrying data-resource, anywhere on the page, opens the card.
  resourceTip.mount(() => ({ state, ctx }));
  const shaftView = createShaftView(shaftHost, state, ctx, roomArt);

  // Open on the inhabited middle of the shaft rather than level 1. The top
  // levels are administration and mostly still; the traffic is between
  // cultivation and the canteens, and that is what the view is for.
  const levels = state.buildings.map((b) => b.level).sort((a, b) => a - b);
  if (levels.length) focusLevel(shaftView.viewport, levels[Math.floor(levels.length / 2)]);

  // The panel: a tab bar, the active screen, and the log, which stays in view
  // whichever tab is open.
  const tabBar = document.createElement('nav');
  tabBar.className = 'tabs';
  tabBar.setAttribute('aria-label', 'Panels');
  const screenHost = document.createElement('div');
  screenHost.className = 'screen';
  const record = document.createElement('section');
  record.className = 'card record';
  record.innerHTML = '<h2>Record</h2>';
  logPanel.mount(record);
  panel.append(tabBar, screenHost, record);

  router.attach(screenHost, { state, ctx, dispatch });
  const tabs = [['dashboard', 'Status', dashboard], ['build', 'Build', build], ['inspect', 'Inspect', inspect]];
  const tabButtons = new Map();
  for (const [name, label, screen] of tabs) {
    router.register(name, screen);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = label;
    tab.addEventListener('click', () => show(name));
    tabBar.appendChild(tab);
    tabButtons.set(name, tab);
  }
  const show = (name) => {
    if (router.current() !== name) router.go(name);
    for (const [n, tab] of tabButtons) tab.setAttribute('aria-pressed', String(n === name));
  };
  show('dashboard');

  // Clicking the shaft picks something: a room opens it in Inspect, an empty
  // stretch of a level opens Build there. While a porter's route is open, a
  // click adds a stop instead, and the editor stays in view.
  selection.subscribe(({ instanceId, level, editing }) => {
    if (editing || instanceId) show('inspect');
    else if (level !== null) show('build');
  });

  wireLog(state, ctx);

  engine.view = shaftView;
  engine.onFrame = (currentState) => {
    timeControls.update(currentState);
    router.update(currentState, ctx);
    logPanel.update(currentState);
    resourceTip.update();
  };

  // One tick before the first frame, so the view opens on a settled sim
  // rather than an empty one.
  stepOnce(engine);
  start(engine);

  // Exposed for debugging and for driving the sim from the console.
  window.game = { engine, state, ctx, dispatch, dataset, shaftView, music };
  return window.game;
}

/**
 * Turn simulation events into player-visible log entries. The bus is the
 * boundary: the log records what happened, and systems never write to it.
 */
function wireLog(state, ctx) {
  const record = (message, kind = 'info') => {
    const entry = { tick: state.clock.tick, message, kind };
    // The log panel renders from state.log each frame, like every other panel.
    state.log.push(entry);
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
  const goods = (ids) => ids.map((id) => nameOf(ctx, id).toLowerCase()).join(', ');
  on('unrest:warning', ({ faction: id }) => record(`${faction(id)} warns that the people are losing patience`, 'warn'));
  on('unrest:strike', ({ faction: id }) => record(`${faction(id)} has walked out: its buildings stand empty`, 'critical'));
  on('unrest:strikeEnded', ({ faction: id }) => record(`${faction(id)} is back at work`));
  on('unrest:demands', () => record('The people are demanding change', 'critical'));
  on('unrest:riot', ({ buildingId, level }) => record(`Rioters wrecked the ${building(buildingId).toLowerCase()} on level ${level}`, 'critical'));
  on('unrest:demolished', ({ buildingId, level }) => record(`Rioters tore down the ${building(buildingId).toLowerCase()} on level ${level}`, 'critical'));

  on('build:refused', ({ buildingId, level, reason }) => {
    const why = { cost: 'the stores cannot pay for it', 'no-room': 'there is no room', 'wrong-depth': 'it cannot go at that depth', 'zone-full': 'that zone is full there', fixed: 'it is fixed in place' }[reason] ?? reason;
    record(`Cannot build a ${building(buildingId).toLowerCase()} on level ${level}: ${why}`, 'warn');
  });

  // A larder that a porter tops up every few ticks goes empty and full again
  // all day; say so once a day per building, not every time. The Waiting card
  // on Status carries the live picture.
  const quietFor = ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay;
  const lastSaid = new Map();
  const once = (key, tick) => {
    const last = lastSaid.get(key);
    if (last !== undefined && tick - last < quietFor) return false;
    lastSaid.set(key, tick);
    return true;
  };
  on('building:starved', ({ instanceId, buildingId, level, missing, tick }) => {
    if (!once(`starved:${instanceId}`, tick)) return;
    record(`The ${building(buildingId).toLowerCase()} on level ${level} is waiting for ${goods(missing)}`, 'warn');
  });
  on('building:blocked', ({ instanceId, buildingId, level, full, tick }) => {
    if (!once(`blocked:${instanceId}`, tick)) return;
    record(`The ${building(buildingId).toLowerCase()} on level ${level} is full of ${goods(full)}: nobody is collecting`, 'warn');
  });
  on('haulage:refused', ({ reason }) => {
    record(reason === 'station-full' ? 'The station has no bed for another porter' : 'Nobody in the labour pool to hire', 'warn');
  });

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
