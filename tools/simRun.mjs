#!/usr/bin/env node
/**
 * simRun.mjs
 * Play the opening headlessly and print one line per day: the balance
 * instrument. Nothing here is special-cased — it builds a run exactly as the
 * browser does (core/run.js createRun + placeOpening) and steps the same
 * engine, with no player input unless --set changes a tunable.
 *
 *   node tools/simRun.mjs                         30 days, default Shaft
 *   node tools/simRun.mjs --days 60 --every 5     a line every fifth day
 *   node tools/simRun.mjs --set population.foodPerCapitaPerTick=0.02
 *   node tools/simRun.mjs --profile deep-cold --seed 7
 *   node tools/simRun.mjs --events                also print the day's events
 *   node tools/simRun.mjs --rule lenient          answer every case with the
 *                         first ruling of that leaning that can be given
 *                         (else the first that can); without --rule a case is
 *                         left open, which holds every later one back
 *
 * Columns: pop (deaths/departures that day), health, food stock (days of
 * supply), water served to people, air (mean where people live / worst
 * inhabited level), power (generation/demand, buildings dark), fuel, parts,
 * the meters, labour (pool/wanted), and anything notable (strikes, riots).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRun, placeOpening } from '../src/core/run.js';
import { stepOnce } from '../src/core/engine.js';
import { dispatch } from '../src/core/commands.js';
import { on } from '../src/core/eventBus.js';
import { loadDataset } from '../src/config/contentLoader.js';
import { daysOfSupply, breathable } from '../src/core/selectors.js';
import { residentsByLevel } from '../src/systems/population/housing.js';
import { totals } from '../src/systems/resources/stores.js';
import { present } from '../src/narrative/dilemmaEngine.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../resources/data');
const readJson = async (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));

const args = parseArgs(process.argv.slice(2));
const days = Number(args.days ?? 30);
const every = Number(args.every ?? 1);

const dataset = await loadDataset({ readJson, chapter: Number(args.chapter ?? 1), profile: args.profile ?? 'default' });
for (const assignment of [].concat(args.set ?? [])) setTunable(dataset.config, assignment);

const { engine, state, ctx } = await createRun({ dataset, seed: Number(args.seed ?? 1234), readJson });
placeOpening(state, ctx, dispatch);

const ticksPerDay = ctx.config.clock.ticksPerShift * ctx.config.clock.shiftsPerDay;
let dayReport = null;
let notes = [];
const events = [];
on('population:day', (p) => { dayReport = p; });
on('unrest:warning', (p) => notes.push(`warn:${p.faction}`));
on('unrest:strike', (p) => notes.push(`STRIKE:${p.faction}`));
on('unrest:demands', () => notes.push('DEMANDS'));
on('unrest:riot', (p) => notes.push(`riot:${p.buildingId}`));
on('unrest:demolished', (p) => notes.push(`DEMOLISHED:${p.buildingId}`));
on('building:breakdown', (p) => notes.push(`broke:${p.buildingId}`));
on('mining:seamExhausted', (p) => notes.push(`seam-out:${p.id}`));
on('dilemma:resolved', (p) => notes.push(`RULED:${p.dilemmaId}=${p.optionId}${p.codified ? `(law:${p.codified})` : ''}`));
on('promise:kept', (p) => notes.push(`kept:${p.id}`));
on('promise:broken', (p) => notes.push(`BROKEN:${p.id}`));
if (args.events) {
  for (const e of ['air:critical', 'maintenance:stalled', 'resource:shortfall', 'water:shortfall', 'labour:shortfall']) {
    on(e, (p) => events.push(`${e} ${JSON.stringify(p)}`));
  }
}

console.log(header());
for (let day = 1; day <= days; day++) {
  for (let t = 0; t < ticksPerDay; t++) {
    stepOnce(engine);
    if (state.narrative.activeDilemma && args.rule) rule(args.rule);
  }
  if (state.narrative.activeDilemma && !args.rule) notes.push(`OPEN:${state.narrative.activeDilemma.id}`);
  // Notes and events carry over to the next printed day, so --every never
  // hides a strike that happened on a day it skipped.
  if (day % every !== 0 && day !== days) continue;
  console.log(row(day));
  if (args.events && events.length) {
    for (const line of [...new Set(events)].slice(0, 12)) console.log(`      ${line}`);
  }
  events.length = 0;
  notes = [];
}

function header() {
  return [
    pad('day', 3), pad('pop', 11), pad('hlth', 4), pad('food(d)', 11), pad('wtr', 4), pad('air', 7),
    pad('power', 13), pad('fuel', 4), pad('prts', 4), pad('mor', 3), pad('tru', 3), pad('stb', 3),
    pad('prd', 3), pad('dis', 3), pad('labour', 9), 'notes',
  ].join(' ');
}

function row(day) {
  const pop = state.population;
  const s = totals(state);
  const m = state.meters;
  const power = state.resources.flows.power;
  const lost = dayReport
    ? Object.values(dayReport.deaths).reduce((a, b) => a + b, 0) + (dayReport.departures ?? 0)
    : 0;
  const foodDays = daysOfSupply(state, ctx, 'food');
  const inhabited = inhabitedAir();
  return [
    pad(day, 3),
    pad(`${Math.round(pop.headcount)}(-${Math.round(lost)})`, 11),
    pad(pop.health.toFixed(0), 4),
    pad(`${Math.round(s.food ?? 0)}(${Number.isFinite(foodDays) ? foodDays.toFixed(1) : '∞'})`, 11),
    pad(pop.needs.water.toFixed(2), 4),
    pad(`${Math.round(pop.needs.air)}/${Math.round(inhabited)}`, 7),
    pad(`${Math.round(power.generation)}/${Math.round(power.demand)} ${power.brownedOut.length}d`, 13),
    pad(Math.round(s.fuel ?? 0), 4),
    pad(Math.round(s['basic-parts'] ?? 0), 4),
    pad(Math.round(m.morale), 3), pad(Math.round(m.trust), 3), pad(Math.round(m.stability), 3),
    pad(Math.round(m.productivity), 3), pad(Math.round(m.discontent), 3),
    pad(`${Math.round(pop.labour.pool)}/${pop.labour.wanted}`, 9),
    [...pop.strikes.map((x) => `on-strike:${x.faction}`), ...new Set(notes)].join(' '),
  ].join(' ');
}

/** Answer the open case with a leaning, the way a consistent player would. */
function rule(leaning) {
  const view = present(state, ctx);
  const open = view.options.filter((o) => o.available);
  const choice = open.find((o) => o.id === 'codify') ?? open.find((o) => o.leaning === leaning) ?? open[0];
  if (choice) dispatch(state, ctx, { type: 'player:resolveDilemma', dilemmaId: view.id, optionId: choice.id });
}

/** The worst air on any level where people actually live. */
function inhabitedAir() {
  const residents = residentsByLevel(state, ctx);
  let worst = 100;
  for (const level of state.levels) {
    if ((residents[level.index] ?? 0) >= 1) worst = Math.min(worst, breathable(level));
  }
  return worst;
}

function pad(value, width) {
  return String(value).padStart(width);
}

function setTunable(config, assignment) {
  const [path, raw] = assignment.split('=');
  const keys = path.split('.');
  const last = keys.pop();
  const node = keys.reduce((n, k) => n?.[k], config);
  if (!node || !(last in node)) throw new Error(`--set: unknown tunable "${path}"`);
  node[last] = JSON.parse(raw);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith('--') ? true : (i++, next);
    out[key] = key in out ? [].concat(out[key], value) : value;
  }
  return out;
}
