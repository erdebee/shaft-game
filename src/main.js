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
import * as infrastructure from './ui/screens/infrastructureScreen.js';
import * as porters from './ui/screens/porters.js';
import * as inspect from './ui/screens/inspect.js';
import * as accord from './ui/screens/accordScreen.js';
import * as selection from './ui/selection.js';
import { createShaftView } from './ui/view/shaftView.js';
import { loadRoomArt } from './ui/view/roomArt.js';
import { setIcons, setRooms } from './ui/icons.js';
import { nameOf } from './systems/resources/stores.js';
import { focusLevel } from './ui/view/viewport.js';
import { mount as mountTimeControls } from './ui/components/timeControls.js';
import * as logPanel from './ui/components/logPanel.js';
import * as resourceTip from './ui/components/resourceTip.js';
import * as dilemmaModal from './ui/components/dilemmaModal.js';
import * as lawStatus from './ui/components/lawStatus.js';
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
  setRooms(roomArt.rooms);

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
  const law = lawStatus.mount(topbar, () => show('accord'));
  const cases = dilemmaModal.mount(document.body, dispatch);
  // Any icon carrying data-resource, anywhere on the page, opens the card.
  resourceTip.mount(() => ({ state, ctx }));
  const shaftView = createShaftView(shaftHost, state, ctx, roomArt, dispatch);

  // Open on the inhabited middle of the shaft rather than level 1. The top
  // levels are administration and mostly still; the traffic is between
  // cultivation and the canteens, and that is what the view is for.
  const levels = state.buildings.map((b) => b.level).sort((a, b) => a - b);
  if (levels.length) focusLevel(shaftView.viewport, levels[Math.floor(levels.length / 2)]);

  // The panel: the tabs, the active screen, and the log, which stays in view
  // whichever tab is open. A tab with sub-tabs shows them in a second row
  // while it is open, and remembers which one was open last.
  const tabBar = document.createElement('nav');
  tabBar.className = 'tabs';
  tabBar.setAttribute('aria-label', 'Panels');
  const subBar = document.createElement('nav');
  subBar.className = 'tabs tabs-sub';
  subBar.setAttribute('aria-label', 'Sub-panels');
  const screenHost = document.createElement('div');
  screenHost.className = 'screen';
  const record = document.createElement('section');
  record.className = 'card record';
  record.innerHTML = '<h2>Record</h2>';
  logPanel.mount(record);
  panel.append(tabBar, subBar, screenHost, record);

  router.attach(screenHost, { state, ctx, dispatch });
  const tabs = [
    { label: 'Stats', screens: [['dashboard', 'Stats', dashboard]] },
    { label: 'Build', screens: [['buildings', 'Buildings', build], ['infrastructure', 'Infrastructure', infrastructure]] },
    { label: 'Porters', screens: [['porters', 'Porters', porters]] },
    { label: 'Accord', screens: [['accord', 'Accord', accord]] },
  ];
  // Inspect has no tab: a room clicked in the shaft opens it.
  router.register('inspect', inspect);
  const lastOf = new Map();
  const tabButtons = [];
  for (const tab of tabs) {
    for (const [name, , screen] of tab.screens) router.register(name, screen);
    lastOf.set(tab, tab.screens[0][0]);
    const top = document.createElement('button');
    top.type = 'button';
    top.textContent = tab.label;
    top.addEventListener('click', () => show(lastOf.get(tab)));
    tabBar.appendChild(top);
    const subs = tab.screens.length > 1 ? tab.screens.map(([name, label]) => {
      const sub = document.createElement('button');
      sub.type = 'button';
      sub.textContent = label;
      sub.addEventListener('click', () => show(name));
      return [name, sub];
    }) : [];
    tabButtons.push({ tab, top, subs });
  }
  const show = (name) => {
    // The shaft draws a network only while the Infrastructure panel is open.
    if (name !== 'infrastructure') selection.showNetwork(null);
    if (router.current() !== name) router.go(name);
    // A building in hand belongs to the Buildings tab: leaving it drops it.
    if (name !== 'buildings') selection.place(null);
    let subs = [];
    for (const entry of tabButtons) {
      const open = entry.tab.screens.some(([n]) => n === name);
      entry.top.setAttribute('aria-pressed', String(open));
      if (!open) continue;
      lastOf.set(entry.tab, name);
      subs = entry.subs;
      for (const [n, sub] of subs) sub.setAttribute('aria-pressed', String(n === name));
    }
    subBar.replaceChildren(...subs.map(([, sub]) => sub));
    subBar.hidden = subs.length === 0;
  };
  show('dashboard');

  // Clicking the shaft picks something: a room opens it in Inspect, an empty
  // stretch of a level opens the Buildings tab. While a porter's route is open the Porters tab holds the editor,
  // and a click on a room offers to add it as a stop instead; closing the
  // route leaves the player on the Porters tab.
  let wasEditing = null;
  selection.subscribe(({ instanceId, level, editing }, kind) => {
    // Opening a network or laying a link changes what the shaft draws, not
    // which panel is open.
    if (kind === 'network') return;
    const closed = wasEditing && !editing;
    wasEditing = editing;
    if (editing) show('porters');
    else if (closed) return;
    else if (instanceId) show('inspect');
    else if (level !== null) show('buildings');
  });

  wireLog(state, ctx);

  engine.view = shaftView;
  engine.onFrame = (currentState) => {
    timeControls.update(currentState);
    law.update(currentState, ctx);
    cases.update(currentState, ctx);
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
  on('link:refused', ({ network, reason }) => {
    const net = ctx.catalog.networks.byId[network];
    const max = net?.maxSpanLevels;
    const why = {
      'cannot-join': `those two do not join on the ${net?.name.toLowerCase()}`,
      'too-long': `a ${net?.link} spans at most ${max} levels`,
      linked: 'they are already linked',
      cost: 'the stores cannot pay for it',
      same: 'that is the same building',
    }[reason] ?? reason;
    if (reason !== 'same') record(`Cannot lay that ${net?.link ?? 'link'}: ${why}`, 'warn');
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

  // --- the law engine ----------------------------------------------------
  const caseTitle = (id) => ctx.content.dilemmas.byId[id]?.title ?? id;
  const lawTitle = (id) => ctx.content.lawCards.byId[id]?.title ?? id;
  on('dilemma:raised', ({ dilemmaId }) => record(`A case for the Mayor: ${caseTitle(dilemmaId)}`, 'warn'));
  on('dilemma:resolved', ({ label, leaning, codified }) => {
    record(`Ruled (${leaning}): ${label}`);
    if (codified) record(`${lawTitle(codified)} is now law, by your own precedent`);
  });
  on('promise:kept', ({ label }) => record(`Promise kept: ${label}. The Shaft will remember it.`));
  on('promise:broken', ({ label }) => record(`Promise broken: ${label}. The Shaft will remember that too.`, 'critical'));
  on('accord:sessionOpened', ({ authority }) => record(`The Accord is in session. Authority ${Math.floor(authority)}.`));
  on('accord:sessionClosed', () => record('The Accord session has closed'));
  on('accord:refused', ({ cardId, reason }) => {
    const why = { closed: 'the Accord is not in session', authority: 'not enough Authority', requires: 'its requirements are not met', enacted: 'it is already law', unrepealable: 'it cannot be repealed' }[reason] ?? reason;
    record(`${lawTitle(cardId)}: refused, ${why}`, 'warn');
  });
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
