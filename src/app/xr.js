/*
  The headset, as the app sees it (docs/VR.md): whether there is one, entering and leaving, and
  what it shows between races. The renderer host behind it (render/xr/xr-host.js) loads three.js,
  so it is made on first use; a browser that can do VR starts loading it at once, so that the
  click that enters VR finds it ready (a browser grants a session only shortly after a click).
*/

/** Whether this browser can open an immersive VR session. Never rejects. */
export async function vrSupported(nav = globalThis.navigator) {
  try {
    return !!(await nav?.xr?.isSessionSupported?.("immersive-vr"));
  } catch {
    return false;
  }
}

/**
 * @param {object} context the app's context (`settings`, `assets`)
 * @param {{ nav?: object, loadHost?: () => Promise<object> }} [options] for tests
 */
export function createXr(context, { nav = globalThis.navigator, loadHost = defaultLoadHost } = {}) {
  let hostPromise = null, host = null, board = null;
  /** What makes the lobby's board, the last one it made, and the count of its requests. */
  let lobby = null, lobbyBoard = null, asked = 0;
  const listeners = new Set();
  const changed = () => { for (const fn of [...listeners]) fn(xr.presenting); };
  const show = () => host?.setBoard(board ?? lobbyBoard);
  /** Make the lobby's board afresh, when it is what the headset would show. */
  async function refreshLobby() {
    if (!lobby || board || !xr.presenting) return;
    const ask = ++asked;
    let made = null;
    try { made = (await lobby()) ?? null; } catch { made = null; }
    // A later request has the newer state of things.
    if (ask !== asked) return;
    lobbyBoard = made;
    show();
  }
  const xr = {
    supported: vrSupported(nav),
    get presenting() { return !!host?.presenting; },
    /** The renderer host, made on first use. Every race draws with it, headset or not. */
    host() {
      hostPromise ??= loadHost(context).then((made) => {
        host = made;
        show();
        host.on("start", () => { changed(); refreshLobby(); });
        host.on("end", changed);
        return host;
      });
      return hostPromise;
    },
    /** Enter VR. Call it straight from a click or a key press. */
    async enter() {
      await (await xr.host()).enter();
    },
    async exit() {
      await host?.exit();
    },
    /**
     * What the headset shows while no race is drawn: a menu (game/vr/menu.js) the current screen
     * sets, or null for the lobby.
     */
    setBoard(menu) {
      board = menu;
      show();
      if (!menu) refreshLobby();
    },
    get board() { return board; },
    /**
     * The lobby: what the headset shows when no screen has set a board. `make()` returns its
     * menu (or a promise of it, or null when there is nothing to offer); it is called afresh
     * each time the lobby comes up, so the board starts from the choices as they then stand.
     */
    setLobby(make) {
      lobby = make;
      lobbyBoard = null;
      show();
      refreshLobby();
    },
    /** Hear of a session starting or ending, with whether one is now running. Returns the remover. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  xr.supported.then((yes) => { if (yes) xr.host().catch(() => {}); });
  return xr;
}

async function defaultLoadHost(context) {
  const { createXrHost } = await import("../render/xr/xr-host.js");
  return createXrHost(context);
}
