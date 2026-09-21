/**
 * saveLoad.js
 * Serialises gameState to localStorage or a downloadable file. Saves record
 * the run seed and the resolved config hash, so a bug report reproduces.
 *
 * A save carries four things that together make a run recoverable exactly:
 *   state        the world as it stands
 *   seed         the run's random basis
 *   rngCursors   how far each stream has been drawn (see core/streams.js) —
 *                without these a reload resumes with fresh streams and
 *                silently diverges from an uninterrupted run
 *   configHash   which resolved config produced it, so a save made under
 *                different balance values is detectable rather than
 *                mysterious
 *
 * The commandLog rides along inside state, which means a save is also a
 * replayable script of the run.
 */

import { assertSerializable } from '../core/gameState.js';

const KEY_PREFIX = 'save:';
export const SAVE_VERSION = 1;

/** Storage backend, injectable so tests do not need a browser. */
let store = typeof localStorage !== 'undefined' ? localStorage : null;

export function useStore(replacement) {
  store = replacement;
}

/** Build the save envelope. Separated from writing so tests can inspect it. */
export function serialise(state) {
  assertSerializable(state);
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    seed: state.meta.seed,
    configHash: state.meta.configHash,
    chapter: state.meta.chapter,
    tick: state.clock.tick,
    rngCursors: { ...state.meta.rngCursors },
    state,
  };
}

export function save(state, slot = 'auto') {
  if (!store) throw new Error('saveLoad: no storage available');
  const envelope = serialise(state);
  store.setItem(`${KEY_PREFIX}${slot}`, JSON.stringify(envelope));
  return envelope;
}

/**
 * Read a slot. Returns the envelope, migrated forward if it is older than the
 * current version, or null if the slot is empty.
 */
export function load(slot = 'auto') {
  if (!store) throw new Error('saveLoad: no storage available');
  const raw = store.getItem(`${KEY_PREFIX}${slot}`);
  if (!raw) return null;
  return migrate(JSON.parse(raw));
}

export function listSlots() {
  if (!store) return [];
  const slots = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    try {
      const envelope = JSON.parse(store.getItem(key));
      slots.push({
        slot: key.slice(KEY_PREFIX.length),
        tick: envelope.tick,
        chapter: envelope.chapter,
        savedAt: envelope.savedAt,
        version: envelope.version,
      });
    } catch {
      // A corrupt slot is reported as such rather than crashing the list —
      // the player should be able to see and delete it.
      slots.push({ slot: key.slice(KEY_PREFIX.length), corrupt: true });
    }
  }
  return slots.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function remove(slot) {
  store?.removeItem(`${KEY_PREFIX}${slot}`);
}

/**
 * Forward-migrate an old save rather than rejecting it.
 *
 * Each step upgrades one version and is never removed once shipped: a player
 * with a v1 save must still be able to open it after v6, so these accumulate.
 */
const MIGRATIONS = {
  // 0: pre-versioned saves, before rngCursors existed.
  0: (envelope) => ({
    ...envelope,
    version: 1,
    rngCursors: envelope.rngCursors ?? {},
    state: {
      ...envelope.state,
      meta: { ...envelope.state.meta, rngCursors: envelope.rngCursors ?? {} },
      commandLog: envelope.state.commandLog ?? [],
    },
  }),
};

export function migrate(raw) {
  let envelope = raw;
  let version = envelope.version ?? 0;

  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`saveLoad: no migration from version ${version}`);
    envelope = step(envelope);
    if ((envelope.version ?? 0) <= version) {
      throw new Error(`saveLoad: migration from ${version} did not advance the version`);
    }
    version = envelope.version;
  }

  if (version > SAVE_VERSION) {
    throw new Error(`saveLoad: save version ${version} is newer than this build (${SAVE_VERSION})`);
  }
  return envelope;
}

/**
 * Restore a loaded envelope onto a freshly booted engine, so streams resume at
 * the right position rather than starting over.
 *
 * @returns {{state: object, cursors: object}} the cursors to replay streams to
 */
export function applyEnvelope(envelope) {
  if (!envelope) throw new Error('saveLoad: nothing to apply');
  return { state: envelope.state, cursors: envelope.rngCursors ?? {} };
}

/** Offer the save as a file, for bug reports. */
export function download(state, filename = null) {
  const envelope = serialise(state);
  const name = filename ?? `shaft-t${envelope.tick}-${envelope.configHash}.json`;
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
