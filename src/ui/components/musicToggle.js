/**
 * The background music, and a topbar button to turn it off and on.
 *
 * Browsers refuse to play audio until the page has been clicked or typed on,
 * so the score starts on the first such gesture anywhere. The choice to turn
 * it off is remembered in this browser (localStorage), as a per-player
 * preference rather than anything a run records. The music also stops while
 * the tab is hidden, and picks up again when it comes back.
 */

const PREF = 'silo.music';

function readPref() {
  try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; }
}

function writePref(on) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* private window: forget it */ }
}

/**
 * @param {HTMLElement} root  the topbar
 * @param {ReturnType<import('../audio/music.js').createMusic>} music
 */
export function mount(root, music) {
  let wanted = readPref();
  let unlocked = false; // a gesture has happened, so the browser will let audio start

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'music-toggle';
  button.textContent = '♪';
  root.appendChild(button);

  const render = () => {
    button.setAttribute('aria-pressed', String(wanted));
    button.title = wanted ? 'Music on (click to turn off)' : 'Music off (click to turn on)';
    button.setAttribute('aria-label', wanted ? 'Turn music off' : 'Turn music on');
  };

  const sync = () => {
    const play = wanted && !document.hidden;
    (play ? music.start() : music.pause()).catch((err) => console.warn('Music:', err));
  };

  button.addEventListener('click', () => {
    // Before any gesture the button reads "on" while nothing plays yet; a
    // click then means "start", not "turn off".
    const first = !unlocked;
    unlocked = true;
    if (first && wanted) { sync(); return; }
    wanted = !wanted;
    writePref(wanted);
    render();
    sync();
  });

  // The first gesture anywhere else starts the music, if the player wants it.
  const unlock = (event) => {
    if (button.contains(event.target)) return;
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    unlocked = true;
    if (wanted) sync();
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  document.addEventListener('visibilitychange', () => {
    if (unlocked) sync();
  });

  render();
}
