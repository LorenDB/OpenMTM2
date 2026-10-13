import { test } from "node:test";
import assert from "node:assert/strict";
import { createXr, vrSupported } from "../src/app/xr.js";

/** A renderer host that only keeps count (render/xr/xr-host.js is the real one). */
function fakeHost() {
  const handlers = {};
  return {
    presenting: false, board: undefined, entered: 0,
    on(name, fn) { (handlers[name] ??= []).push(fn); },
    setBoard(menu) { this.board = menu; },
    async enter() { this.entered++; this.presenting = true; for (const fn of handlers.start ?? []) fn(); },
    async exit() { this.presenting = false; for (const fn of handlers.end ?? []) fn(); },
  };
}
const navWith = (answer) => ({ xr: { isSessionSupported: async (mode) => (mode === "immersive-vr" ? answer : false) } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("whether there is a headset: asked of the browser, and never an error", async () => {
  assert.equal(await vrSupported(navWith(true)), true);
  assert.equal(await vrSupported(navWith(false)), false);
  assert.equal(await vrSupported({}), false);
  assert.equal(await vrSupported(undefined), false);
  assert.equal(await vrSupported({ xr: { isSessionSupported: async () => { throw new Error("blocked by policy"); } } }), false);
});

test("without a headset the renderer host is made on first use only", async () => {
  let made = 0;
  const xr = createXr({}, { nav: navWith(false), loadHost: async () => { made++; return fakeHost(); } });
  assert.equal(await xr.supported, false);
  await settle();
  assert.equal(made, 0);
  assert.equal(xr.presenting, false);
  await xr.exit();   // nothing to leave
  const host = await xr.host();
  assert.equal(await xr.host(), host);
  assert.equal(made, 1);
});

test("with a headset the host is loaded ahead, so the click that enters VR finds it ready", async () => {
  let made = 0;
  const host = fakeHost();
  const xr = createXr({}, { nav: navWith(true), loadHost: async () => { made++; return host; } });
  assert.equal(await xr.supported, true);
  await settle();
  assert.equal(made, 1);
  const heard = [];
  const stop = xr.onChange((presenting) => heard.push(presenting));
  await xr.enter();
  assert.equal(xr.presenting, true);
  await xr.exit();
  assert.equal(xr.presenting, false);
  assert.deepEqual(heard, [true, false]);
  stop();
  await xr.enter();
  assert.deepEqual(heard, [true, false], "a removed listener hears nothing more");
  assert.equal(host.entered, 2);
});

test("the board for between races is kept until there is a host to show it", async () => {
  const host = fakeHost();
  const xr = createXr({}, { nav: navWith(false), loadHost: async () => host });
  const lobby = { title: "Lobby" };
  xr.setBoard(lobby);
  assert.equal(xr.board, lobby);
  await xr.host();
  assert.equal(host.board, lobby);
  xr.setBoard(null);
  assert.equal(host.board, null);
});

test("the lobby shows when no screen has a board, made afresh each time it comes up", async () => {
  const host = fakeHost();
  const xr = createXr({}, { nav: navWith(false), loadHost: async () => host });
  let made = 0;
  xr.setLobby(async () => ({ title: `Lobby ${++made}` }));
  await xr.host();
  await settle();
  assert.equal(made, 0, "nothing is made while no headset shows it");
  assert.equal(host.board, null);
  await xr.enter();
  await settle();
  assert.deepEqual(host.board, { title: "Lobby 1" });
  // A screen's own board (a race loading, the Winner's Circle) takes its place.
  const results = { title: "Winner's Circle" };
  xr.setBoard(results);
  assert.equal(host.board, results);
  await settle();
  assert.equal(made, 1);
  // The screen goes: the lobby as it was at once, then as things now stand.
  xr.setBoard(null);
  assert.deepEqual(host.board, { title: "Lobby 1" });
  await settle();
  assert.deepEqual(host.board, { title: "Lobby 2" });
});

test("a lobby that cannot be made leaves the host's default, and a slow one never replaces a newer", async () => {
  const host = fakeHost();
  const xr = createXr({}, { nav: navWith(false), loadHost: async () => host });
  await xr.host();
  await xr.enter();
  xr.setLobby(async () => { throw new Error("No game install yet."); });
  await settle();
  assert.equal(host.board, null);
  xr.setLobby(() => null);
  await settle();
  assert.equal(host.board, null);
  // Two requests in flight: the first to be asked for answers last.
  const waiting = [];
  xr.setLobby(() => new Promise((resolve) => waiting.push(resolve)));
  xr.setBoard({ title: "Loading" });
  xr.setBoard(null);
  assert.equal(waiting.length, 2);
  waiting[1]({ title: "newer" });
  await settle();
  waiting[0]({ title: "older" });
  await settle();
  assert.deepEqual(host.board, { title: "newer" });
});

test("a host that cannot be made: entering VR says so, and the app goes on", async () => {
  const xr = createXr({}, { nav: navWith(true), loadHost: async () => { throw new Error("no WebGL"); } });
  await xr.supported;
  await settle();   // the load ahead fails quietly
  await assert.rejects(xr.enter(), /no WebGL/);
});
