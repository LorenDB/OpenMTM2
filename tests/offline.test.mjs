import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  COPYING, createOffline, offlineCopy, offlineNames, offlineStatusText, removeOfflineCopy, saveOfflineCopy,
} from "../src/app/offline.js";
import { fakeCaches, fakeNetwork } from "./helpers/fake-caches.mjs";

const ROOT = "http://localhost:8080/";
const CDN = "https://cdn.test/three@1/three.js";
/** A small app: a page, a stylesheet, two modules, a worker, and a library from a CDN with a file of its own. */
const app = () => ({
  [ROOT]: `<link rel="stylesheet" href="./styles/base.css">
    <script type="importmap">{ "imports": { "three": "${CDN}" } }</script>
    <script type="module" src="./src/main.js"></script>`,
  [`${ROOT}styles/base.css`]: "body { margin: 0 }",
  [`${ROOT}src/main.js`]: `import "./render.js"; const w = new Worker(new URL("./worker.js", import.meta.url));`,
  [`${ROOT}src/render.js`]: `import * as THREE from "three";`,
  [`${ROOT}src/worker.js`]: `import "./render.js";`,
  [CDN]: `import "./core.js";`,
  "https://cdn.test/three@1/core.js": "export {};",
});
const sorted = (list) => [...list].sort();

test("a copy: every file of the app, as the server gave it, and a pointer to say it is complete", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  const copy = await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "one" });
  const names = offlineNames(ROOT);
  assert.equal(copy.cache, `${names.copyPrefix}one`);
  assert.equal(copy.files, 7);
  assert.ok(!Number.isNaN(Date.parse(copy.savedAt)));
  assert.deepEqual(sorted(caches.urls(copy.cache)), sorted(Object.keys(net.files)));
  assert.equal(await (await caches.match(`${ROOT}src/render.js`, { cacheName: copy.cache })).text(), `import * as THREE from "three";`);
  assert.deepEqual(await offlineCopy(ROOT, caches), copy);
  assert.deepEqual(sorted(await caches.keys()), sorted([names.pointerCache, copy.cache]));
});

test("the copy is the server's word: its own files are fetched past the worker and past the browser's cache", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches });
  assert.equal(new Set(net.calls.map((c) => c.url)).size, net.calls.length, "each file is fetched once");
  for (const call of net.calls) {
    const own = call.url.startsWith(ROOT);
    // Another site's files carry no header of ours (it would need that site's leave) and may come from the browser's cache.
    assert.deepEqual([call.marked, call.cache], own ? [true, "no-cache"] : [false, null], call.url);
  }
  assert.equal(COPYING, "x-openmtm2-offline");
});

test("a newer copy takes the place of the one before, and only once it is complete", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  const first = await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "one" });
  net.files[`${ROOT}src/render.js`] = `import "three"; import "./new.js";`;
  net.files[`${ROOT}src/new.js`] = "export {};";
  delete net.files[`${ROOT}styles/base.css`];
  net.files[ROOT] = net.files[ROOT].replace(`<link rel="stylesheet" href="./styles/base.css">`, "");
  const second = await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "two" });
  assert.notEqual(second.cache, first.cache);
  assert.equal(await caches.has(first.cache), false, "the copy before is dropped");
  assert.deepEqual(await offlineCopy(ROOT, caches), second);
  assert.ok(caches.urls(second.cache).includes(`${ROOT}src/new.js`));
  assert.equal(caches.urls(second.cache).includes(`${ROOT}styles/base.css`), false, "a file the app no longer has is no longer kept");
  await assert.rejects(saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "two" }), /already kept/);
});

test("no server: nothing is made, and the copy before stays as it was", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  await assert.rejects(saveOfflineCopy({ root: ROOT, fetchFn: async () => { throw new TypeError("Failed to fetch"); }, cacheStorage: caches }), /Failed to fetch/);
  assert.deepEqual(await caches.keys(), [], "nothing half made is left");
  assert.equal(await offlineCopy(ROOT, caches), null);

  const first = await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "one" });
  // The server goes away partway: the page and some files are read, then no more.
  let answered = 0;
  const failing = async (url, init) => {
    if (++answered > 3) throw new TypeError("Failed to fetch");
    return net.fetch(url, init);
  };
  await assert.rejects(saveOfflineCopy({ root: ROOT, fetchFn: failing, cacheStorage: caches, id: "two" }), /Failed to fetch/);
  assert.deepEqual(await offlineCopy(ROOT, caches), first);
  assert.deepEqual(sorted(caches.urls(first.cache)), sorted(Object.keys(net.files)));
  assert.equal(await caches.has(`${offlineNames(ROOT).copyPrefix}two`), false);
});

test("the CDN out of reach but the server there: its files are carried over from the copy before", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  // With no copy before there is nothing to carry over.
  net.down.add("cdn");
  await assert.rejects(saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "zero" }), /Failed to fetch/);
  net.down.clear();
  await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "one" });
  net.down.add("cdn");
  net.files[`${ROOT}src/worker.js`] = `import "./render.js"; // changed`;
  const second = await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches, id: "two" });
  assert.equal(second.files, 7);
  assert.equal(await (await caches.match(CDN, { cacheName: second.cache })).text(), `import "./core.js";`);
  assert.equal(await (await caches.match("https://cdn.test/three@1/core.js", { cacheName: second.cache })).text(), "export {};");
  assert.equal(await (await caches.match(`${ROOT}src/worker.js`, { cacheName: second.cache })).text(), `import "./render.js"; // changed`);
});

test("a file the app names that is not there is passed over; the page itself has to be there", async () => {
  const caches = fakeCaches(), files = app();
  files[`${ROOT}src/main.js`] += ` import "./gone.js";`;
  const copy = await saveOfflineCopy({ root: ROOT, fetchFn: fakeNetwork(files, ROOT).fetch, cacheStorage: caches, id: "one" });
  assert.equal(copy.files, 7);
  assert.equal(caches.urls(copy.cache).includes(`${ROOT}src/gone.js`), false);
  files[ROOT] = 503;
  await assert.rejects(saveOfflineCopy({ root: ROOT, fetchFn: fakeNetwork(files, ROOT).fetch, cacheStorage: caches, id: "two" }), /answered 503/);
  assert.deepEqual(await offlineCopy(ROOT, caches), copy);
});

/** A Web Locks stand-in shared by every tab it is given: one holder at a time. */
function fakeLocks() {
  let chain = Promise.resolve();
  return {
    request(_name, callback) {
      const run = chain.then(() => callback());
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
}

test("two saves in one page wait their turn, with Web Locks and without", async () => {
  for (const locks of [fakeLocks(), null]) {
    const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
    // Every answer takes a moment, so two copies made at once would be made side by side.
    const slow = async (url, init) => { await new Promise((resolve) => setTimeout(resolve, 1)); return net.fetch(url, init); };
    const [, second] = await Promise.all(["a", "b"].map((id) => saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id, locks })));
    assert.deepEqual(await offlineCopy(ROOT, caches), second, String(locks));
    assert.deepEqual(sorted(await caches.keys()), sorted([offlineNames(ROOT).pointerCache, second.cache]));
    // A removal asked for meanwhile waits for the copy being made, and then takes it.
    const saving = saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id: "c", locks });
    await removeOfflineCopy(ROOT, caches, locks);
    await saving;
    assert.deepEqual(await caches.keys(), []);
  }
});

test("while a copy is being filled it carries a mark, and the mark is gone once that copy is kept", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  const names = offlineNames(ROOT);
  let note, proceed;
  const seen = new Promise((resolve) => { note = resolve; });
  const go = new Promise((resolve) => { proceed = resolve; });
  let marked = null;
  const slow = async (url, init) => {
    if (url === ROOT) {
      marked = (await caches.keys()).filter((key) => key.startsWith(names.buildingPrefix));
      note();
      await go;
    }
    return net.fetch(url, init);
  };
  const saving = saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id: "a", locks: null });
  await seen;
  assert.deepEqual(marked, [`${names.buildingPrefix}a`]);
  assert.equal(await offlineCopy(ROOT, caches), null, "the pointer moves only when the copy is complete");
  proceed();
  const copy = await saving;
  assert.equal(await caches.has(`${names.buildingPrefix}a`), false);
  assert.deepEqual(sorted(await caches.keys()), sorted([names.pointerCache, copy.cache]));
});

test("two tabs and no Web Locks: each page has its own queue, and neither drops the cache the other is filling", async () => {
  // A second import is a second page. The queue lives in the module, so the two do not share it.
  const [tabA, tabB] = await Promise.all([
    import("../src/app/offline.js?tab=a"),
    import("../src/app/offline.js?tab=b"),
  ]);
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  const names = offlineNames(ROOT);
  let running = 0, inRoot = 0, release;
  const both = new Promise((resolve) => { release = resolve; });
  const droppedEarly = [];
  const origDelete = caches.delete.bind(caches);
  caches.delete = async (key) => {
    const copy = String(key).startsWith(names.copyPrefix) && caches.stores.has(key) && caches.urls(key).length < 7;
    const mark = String(key).startsWith(names.buildingPrefix) && caches.stores.has(`${names.copyPrefix}${key.slice(names.buildingPrefix.length)}`)
      && caches.urls(`${names.copyPrefix}${key.slice(names.buildingPrefix.length)}`).length < 7;
    if (running === 2 && (copy || mark)) droppedEarly.push(key);
    return origDelete(key);
  };
  const slow = async (url, init) => {
    if (url === ROOT) {
      if (++inRoot === 2) release();
      await both;
    }
    return net.fetch(url, init);
  };
  const run = (tab, id) => {
    running += 1;
    return tab.saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id, locks: null }).finally(() => { running -= 1; });
  };
  await Promise.all([run(tabA, "a"), run(tabB, "b")]);
  assert.equal(inRoot, 2, "the two copies were filled side by side");
  assert.deepEqual(droppedEarly, [], "neither drops a cache the other is still filling");
  const kept = await tabA.offlineCopy(ROOT, caches);
  assert.ok(kept, "a complete copy is kept");
  assert.ok([`${names.copyPrefix}a`, `${names.copyPrefix}b`].includes(kept.cache));
  assert.equal(caches.urls(kept.cache).length, 7);
  assert.deepEqual(sorted(await caches.keys()), sorted([names.pointerCache, kept.cache]));
});

test("two tabs sharing Web Locks make one copy at a time, and the last one made is the one kept", async () => {
  const [tabA, tabB] = await Promise.all([
    import("../src/app/offline.js?tab=lock-a"),
    import("../src/app/offline.js?tab=lock-b"),
  ]);
  const locks = fakeLocks();
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  let active = 0, max = 0;
  const slow = async (url, init) => {
    if (url === ROOT) {
      active += 1;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }
    return net.fetch(url, init);
  };
  const [, second] = await Promise.all([
    tabA.saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id: "a", locks }),
    tabB.saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id: "b", locks }),
  ]);
  assert.equal(max, 1, "one copy is made at a time");
  assert.deepEqual(await tabA.offlineCopy(ROOT, caches), second);
  assert.deepEqual(sorted(await caches.keys()), sorted([offlineNames(ROOT).pointerCache, second.cache]));
});

test("a removal in another tab, with no Web Locks, does not leave the pointer naming a cache that is gone", async () => {
  const [tabA, tabB] = await Promise.all([
    import("../src/app/offline.js?tab=remove-a"),
    import("../src/app/offline.js?tab=remove-b"),
  ]);
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  let enteredResolve, release;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = async (url, init) => {
    if (url === ROOT) {
      enteredResolve();
      await gate;
    }
    return net.fetch(url, init);
  };
  const saving = tabA.saveOfflineCopy({ root: ROOT, fetchFn: slow, cacheStorage: caches, id: "a", locks: null });
  await entered;
  await tabB.removeOfflineCopy(ROOT, caches, null);
  release();
  assert.equal(await saving, null);
  assert.equal(await tabA.offlineCopy(ROOT, caches), null);
  assert.deepEqual(await caches.keys(), []);
});

test("two apps on one site keep their copies apart, and removing one leaves the other", async () => {
  const caches = fakeCaches();
  const other = "http://localhost:8080/other/";
  await saveOfflineCopy({ root: ROOT, fetchFn: fakeNetwork(app(), ROOT).fetch, cacheStorage: caches, id: "one" });
  const second = await saveOfflineCopy({ root: other, fetchFn: fakeNetwork({ [other]: "<p>other</p>" }, other).fetch, cacheStorage: caches, id: "one" });
  assert.equal((await caches.keys()).length, 4);
  await removeOfflineCopy(ROOT, caches);
  assert.equal(await offlineCopy(ROOT, caches), null);
  assert.deepEqual(await offlineCopy(other, caches), second);
  assert.deepEqual(sorted(await caches.keys()), sorted([offlineNames(other).pointerCache, second.cache]));
  // A pointer whose cache is gone points at nothing.
  await caches.delete(second.cache);
  assert.equal(await offlineCopy(other, caches), null);
});

/** A browser's side of things, as far as the copy needs it. */
function fakeBrowser() {
  const browser = {
    registered: [], unregistered: 0,
    nav: {
      serviceWorker: {
        register: async (url, options) => { browser.registered.push([url, options.scope]); },
        getRegistration: async () => (browser.registered.length ? { unregister: async () => { browser.unregistered++; } } : undefined),
      },
    },
  };
  return browser;
}

test("at the start: the worker is registered at the app's root, then the copy is made once the page is idle", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT), browser = fakeBrowser();
  let idled = 0;
  const offline = createOffline({ settings: {} }, { nav: browser.nav, cacheStorage: caches, secure: true, fetchFn: net.fetch, root: ROOT, idle: async () => { idled++; assert.equal(net.calls.length, 0, "nothing is fetched before then"); } });
  const heard = [];
  offline.onChange((status) => heard.push([status.saving, status.copy?.files ?? null]));
  assert.deepEqual(offline.status, { supported: true, enabled: true, saving: false, copy: null, error: null });
  await offline.start();
  assert.deepEqual(browser.registered, [[`${ROOT}sw.js`, ROOT]]);
  assert.equal(idled, 1);
  assert.equal(offline.status.copy.files, 7);
  assert.deepEqual(heard, [[false, null], [true, null], [false, 7]]);
  // Starting again (the next visit) finds the copy at once, and renews it.
  const again = createOffline({ settings: {} }, { nav: browser.nav, cacheStorage: caches, secure: true, fetchFn: net.fetch, root: ROOT, idle: async () => {} });
  const seen = [];
  again.onChange((status) => seen.push(status.copy?.cache ?? null));
  await again.start();
  assert.equal(seen[0], offline.status.copy.cache);
});

test("without the server the start leaves the copy alone and says why nothing new was made", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT), browser = fakeBrowser();
  const env = { nav: browser.nav, cacheStorage: caches, secure: true, fetchFn: net.fetch, root: ROOT, idle: async () => {} };
  const first = createOffline({ settings: {} }, env);
  await first.start();
  net.down.add("own");
  const offline = createOffline({ settings: {} }, env);
  await offline.start();
  assert.deepEqual(offline.status.copy, first.status.copy);
  assert.match(offline.status.error, /Failed to fetch/);
  assert.match(offlineStatusText(offline.status), /^Saved .*7 files\.$/);
});

test("where a browser cannot do it, and switched off", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  const base = { cacheStorage: caches, fetchFn: net.fetch, root: ROOT, idle: async () => {} };
  // No service workers, no caches, or a page that is not secure: nothing is tried.
  for (const env of [{ ...base, nav: {}, secure: true }, { ...base, nav: fakeBrowser().nav, cacheStorage: undefined, secure: true }, { ...base, nav: fakeBrowser().nav, secure: false }]) {
    const offline = createOffline({ settings: {} }, env);
    await offline.start();
    await offline.save();
    await offline.remove();
    assert.equal(offline.status.supported, false);
    assert.match(offlineStatusText(offline.status), /^Not possible here: the page has to come from localhost/);
  }
  assert.equal(net.calls.length, 0);
  // A browser that refuses the worker (a certificate it does not trust): said once, and left at that.
  const refused = fakeBrowser();
  refused.nav.serviceWorker.register = async () => { throw new Error("An SSL certificate error occurred"); };
  const offline = createOffline({ settings: {} }, { ...base, nav: refused.nav, secure: true });
  await offline.start();
  assert.equal(offline.status.supported, false);
  assert.equal(offlineStatusText(offline.status), "Not possible here: An SSL certificate error occurred");
  assert.equal(net.calls.length, 0);

  // Switched off in the settings: a start takes away what an earlier visit left.
  const browser = fakeBrowser();
  const settings = {};
  const on = createOffline({ settings }, { ...base, nav: browser.nav, secure: true });
  await on.start();
  assert.equal((await caches.keys()).length, 2);
  await on.setEnabled(false);
  assert.equal(settings.offline, false);
  assert.deepEqual([await caches.keys(), browser.unregistered, on.status.copy, on.status.enabled], [[], 1, null, false]);
  assert.match(offlineStatusText(on.status), /^Off/);
  const calls = net.calls.length;
  await on.save();
  await createOffline({ settings }, { ...base, nav: browser.nav, secure: true }).start();
  assert.equal(net.calls.length, calls, "switched off, nothing is fetched");
  // And on again.
  await on.setEnabled(true);
  assert.equal(on.status.copy.files, 7);
});

test("switched off while a copy is being made: the copy does not stay", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT), browser = fakeBrowser();
  const settings = {};
  let release;
  const slow = async (url, init) => { if (url === ROOT) await new Promise((resolve) => { release = resolve; }); return net.fetch(url, init); };
  const offline = createOffline({ settings }, { nav: browser.nav, cacheStorage: caches, secure: true, fetchFn: slow, root: ROOT, idle: async () => {} });
  const saving = offline.save();
  assert.equal(offline.save(), saving, "one copy is made at a time");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const off = offline.setEnabled(false);
  release();
  await Promise.all([saving, off]);
  assert.deepEqual([await caches.keys(), offline.status.copy], [[], null]);
});

test("the Options switch is part of the draft: put to use by Apply, Save or Close, and taken back with it", () => {
  const panel = readFileSync(new URL("../src/ui/options-panel.js", import.meta.url), "utf8");
  assert.match(panel, /onchange: \(event\) => \{ settings\.offline = event\.target\.checked; save\(\); \}/);
  assert.doesNotMatch(panel, /setEnabled/, "the switch itself changes nothing until the draft is used");
  // use() is what Apply, Save and Close (keeping or discarding) all go through.
  const use = panel.slice(panel.indexOf("const use = (next) =>"), panel.indexOf("const apply = ()"));
  assert.match(use, /if \(\(before\.offline !== false\) !== \(live\.offline !== false\)\) context\.offline\?\.start\(\);/);
});

test("what the player is told", () => {
  const base = { supported: true, enabled: true, saving: false, copy: null, error: null };
  assert.equal(offlineStatusText(base), "Not saved yet.");
  assert.equal(offlineStatusText({ ...base, saving: true }), "Saving...");
  assert.equal(offlineStatusText({ ...base, error: "Failed to fetch" }), "Not saved: Failed to fetch");
  const copy = { cache: "c", files: 201, savedAt: "2026-10-08T14:02:00.000Z" };
  assert.match(offlineStatusText({ ...base, copy }), /^Saved .+, 201 files\.$/);
  assert.match(offlineStatusText({ ...base, copy, saving: true }), /^Saved .+, 201 files; checking for a newer one\.\.\.$/);
  assert.equal(offlineStatusText({ ...base, copy: { ...copy, savedAt: "?" } }), "Saved, 201 files.");
});

/** sw.js run as a browser would run it, with this scope, these caches and this network. */
function startWorker({ scope = ROOT, caches, fetch }) {
  const listeners = {}, did = { skipWaiting: 0, claim: 0 };
  const self = {
    registration: { scope },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { did.skipWaiting++; },
    clients: { claim: async () => { did.claim++; } },
  };
  vm.runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), { self, caches, fetch, Response, Headers, URL, console });
  return {
    did, listeners,
    /** The worker's answer to a request, or "left alone" when it does not take it. */
    async ask(url, { method = "GET", mode = "cors", destination = "script", headers = {} } = {}) {
      let answer = "left alone";
      listeners.fetch({ request: { url, method, mode, destination, headers: new Headers(headers) }, respondWith: (promise) => { answer = promise; } });
      return answer;
    },
  };
}
const page = { mode: "navigate", destination: "document" };

test("the worker: while the network answers, its answer is the one given", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches });
  net.files[`${ROOT}src/render.js`] = "// newer on the server";
  const worker = startWorker({ caches, fetch: net.fetch });
  assert.equal(await (await worker.ask(`${ROOT}src/render.js`)).text(), "// newer on the server");
  assert.equal((await worker.ask(`${ROOT}src/nowhere.js`)).status, 404, "a file the server does not have is the server's 404");
  assert.match(await (await worker.ask(ROOT, page)).text(), /importmap/);
});

test("the worker: with no network it answers from the copy the page made", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches });
  net.down.add("own").add("cdn");
  const worker = startWorker({ caches, fetch: net.fetch });
  for (const url of Object.keys(net.files)) {
    assert.equal(await (await worker.ask(url, url === ROOT ? page : undefined)).text(), net.files[url], url);
  }
  // The app is one page: its address with a query, index.html, or any path of its own opens it.
  for (const url of [`${ROOT}?race=1`, `${ROOT}index.html`, `${ROOT}some/where`]) {
    assert.equal(await (await worker.ask(url, page)).text(), net.files[ROOT], url);
  }
  // A script is matched by its exact address, and one the copy lacks fails as the network did.
  await assert.rejects(worker.ask(`${ROOT}src/render.js?v=2`), /Failed to fetch/);
  await assert.rejects(worker.ask(`${ROOT}src/nowhere.js`), /Failed to fetch/);
});

test("the worker: with no copy, no network is no answer", async () => {
  const net = fakeNetwork(app(), ROOT);
  net.down.add("own");
  const worker = startWorker({ caches: fakeCaches(), fetch: net.fetch });
  await assert.rejects(worker.ask(ROOT, page), /Failed to fetch/);
  await assert.rejects(worker.ask(`${ROOT}src/main.js`), /Failed to fetch/);
});

test("the worker: a server in trouble opens the copy's page; other answers are passed on", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches });
  const kept = net.files[ROOT];
  const worker = startWorker({ caches, fetch: net.fetch });
  net.files[ROOT] = 503;
  assert.equal(await (await worker.ask(ROOT, page)).text(), kept);
  net.files[ROOT] = 404;
  assert.equal((await worker.ask(ROOT, page)).status, 404);
  net.files[`${ROOT}src/main.js`] = 503;
  assert.equal((await worker.ask(`${ROOT}src/main.js`)).status, 503, "only the page is helped out");
  // With no copy a 503 is all there is.
  net.files[ROOT] = 503;
  assert.equal((await startWorker({ caches: fakeCaches(), fetch: net.fetch }).ask(ROOT, page)).status, 503);
});

test("the worker: what it leaves alone", async () => {
  const caches = fakeCaches(), net = fakeNetwork(app(), ROOT);
  await saveOfflineCopy({ root: ROOT, fetchFn: net.fetch, cacheStorage: caches });
  net.down.add("own").add("cdn");
  const worker = startWorker({ caches, fetch: net.fetch });
  const before = net.calls.length;
  assert.equal(await worker.ask(`${ROOT}src/main.js`, { method: "POST" }), "left alone");
  assert.equal(await worker.ask(`${ROOT}src/main.js`, { method: "HEAD" }), "left alone");
  // What the page fetches to make a copy must come from the server or fail.
  assert.equal(await worker.ask(`${ROOT}src/main.js`, { headers: { [COPYING]: "1" } }), "left alone");
  // The game folder a development server offers, whoever asks and however.
  assert.equal(await worker.ask(`${ROOT}game/POD.INI`, { destination: "" }), "left alone");
  assert.equal(await worker.ask(`${ROOT}game/SYSTEM/TRUCK2.POD`), "left alone");
  // Another site's data that a script fetches for itself; its scripts are another matter.
  assert.equal(await worker.ask("https://api.test/data.json", { destination: "" }), "left alone");
  assert.equal(await (await worker.ask(CDN)).text(), net.files[CDN]);
  // The app's own data fetched by a script is answered like any other file of its own.
  assert.equal(await (await worker.ask(`${ROOT}styles/base.css`, { destination: "" })).text(), net.files[`${ROOT}styles/base.css`]);
  assert.equal(net.calls.length, before + 2, "what is left alone is not fetched by the worker");
});

test("the worker: an app in a folder of a site minds only that folder's game, and its own copy", async () => {
  const root = "https://example.test/OpenMTM2/";
  const files = { [root]: `<p>app</p><script type="module" src="./src/a.js"></script>`, [`${root}src/a.js`]: "a" };
  const caches = fakeCaches(), net = fakeNetwork(files, root);
  await saveOfflineCopy({ root, fetchFn: net.fetch, cacheStorage: caches });
  await saveOfflineCopy({ root: ROOT, fetchFn: fakeNetwork(app(), ROOT).fetch, cacheStorage: caches });
  net.down.add("own").add("cdn");
  const worker = startWorker({ scope: root, caches, fetch: net.fetch });
  assert.equal(await (await worker.ask(`${root}src/a.js`)).text(), "a");
  assert.equal(await (await worker.ask(`${root}deep/link`, page)).text(), files[root]);
  assert.equal(await worker.ask(`${root}game/POD.INI`), "left alone");
  // Another app's copy on the same site is not this worker's to answer from.
  await assert.rejects(worker.ask(`${ROOT}src/main.js`), /Failed to fetch/);
});

test("the worker: a new version takes over at once", async () => {
  const worker = startWorker({ caches: fakeCaches(), fetch: async () => new Response("") });
  worker.listeners.install({});
  let waited = null;
  worker.listeners.activate({ waitUntil: (promise) => { waited = promise; } });
  await waited;
  assert.deepEqual(worker.did, { skipWaiting: 1, claim: 1 });
});
