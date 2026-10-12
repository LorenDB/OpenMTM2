/*
  Starting without a server (docs/ARCHITECTURE.md, "Without a server").

  The game's data is in the browser's own storage from the day it is installed; what still came
  from a server at every start was the app itself. This keeps a copy of the app in the browser
  too, so that the same address opens it with no server and no network: a headset that was on
  a cable once (docs/VR.md, "Running it on a headset"), or any browser gone offline.

  Two parts. The service worker (sw.js, at the site's root) answers from the copy when the
  network fails, and only then. This module makes the copy: at each start it walks the app's
  files from the page (shared/app-files.js), fetches every one from the server, and stores them
  in a new cache; only when all are in does it point the worker at that cache and drop the one
  before. So the copy is always one complete set of files as a server gave them, and a start
  that fails halfway (the server stopped, the page was closed) leaves the last one in place.

  The app's own files are fetched past the worker (the header below) and past the browser's
  cache, so the copy is the server's word. Files from another site (three.js from its CDN) keep
  their version in their address: when that site cannot be reached, the ones already kept are
  carried over.
*/
import { crawl, kindOf } from "../shared/app-files.js";

/** The header on the requests that make the copy; sw.js leaves those alone. */
export const COPYING = "x-openmtm2-offline";

/**
 * The names the copy goes by, for the app at `root` (its page's folder, ending in "/"): the
 * cache and address where the pointer to the complete copy is, and what every copy's cache
 * name begins with. sw.js has the first two.
 */
export function offlineNames(root) {
  return { pointerCache: `openmtm2-offline|${root}`, pointerUrl: `${root}__offline__`, copyPrefix: `openmtm2-app|${root}|` };
}

/** The copy now kept: `{ cache, files, savedAt }`, or null. */
export async function offlineCopy(root, cacheStorage = globalThis.caches) {
  const names = offlineNames(root);
  const pointer = await cacheStorage.match(names.pointerUrl, { cacheName: names.pointerCache });
  if (!pointer) return null;
  try {
    const copy = await pointer.json();
    return typeof copy?.cache === "string" && (await cacheStorage.has(copy.cache)) ? copy : null;
  } catch {
    return null;
  }
}

/**
 * Make a new copy of the app and, once it is complete, make it the one that is kept.
 * Rejects, leaving the copy before it untouched, when the app's server cannot be reached.
 * @param {{ root: string, fetchFn?: typeof fetch, cacheStorage?: CacheStorage, id?: string }} options
 *   `id` names the new copy's cache; two copies never share one
 * @returns {Promise<{ cache: string, files: number, savedAt: string }>}
 */
export async function saveOfflineCopy({ root, fetchFn = globalThis.fetch, cacheStorage = globalThis.caches, id = Date.now().toString(36) }) {
  const names = offlineNames(root);
  const before = await offlineCopy(root, cacheStorage);
  const name = `${names.copyPrefix}${id}`;
  if (before?.cache === name) throw new Error("A copy by that name is already kept.");
  await cacheStorage.delete(name);
  const cache = await cacheStorage.open(name);
  let files;
  try {
    files = await crawl(root, async (url) => {
      const own = url.startsWith(root);
      let response;
      try {
        response = await fetchFn(url, own ? { headers: { [COPYING]: "1" }, cache: "no-cache" } : undefined);
      } catch (error) {
        // Another site's file, kept before: its address carries its version, so it is still right.
        response = own || !before ? undefined : await cacheStorage.match(url, { cacheName: before.cache, ignoreVary: true });
        if (!response) throw error;
      }
      // A file that is not there is not part of the app; the page itself has to be.
      if (!response.ok) {
        if (url === root) throw new Error(`${url} answered ${response.status}.`);
        return null;
      }
      const text = kindOf(url, root) === "other" ? "" : await response.clone().text();
      await cache.put(url, response);
      return text;
    });
  } catch (error) {
    await cacheStorage.delete(name);
    throw error;
  }
  const copy = { cache: name, files: files.length, savedAt: new Date().toISOString() };
  const pointer = await cacheStorage.open(names.pointerCache);
  await pointer.put(names.pointerUrl, new Response(JSON.stringify(copy), { headers: { "content-type": "application/json" } }));
  for (const key of await cacheStorage.keys()) {
    if (key.startsWith(names.copyPrefix) && key !== name) await cacheStorage.delete(key);
  }
  return copy;
}

/** Drop the copy of the app at `root`, and anything half made. */
export async function removeOfflineCopy(root, cacheStorage = globalThis.caches) {
  const names = offlineNames(root);
  for (const key of await cacheStorage.keys()) {
    if (key === names.pointerCache || key.startsWith(names.copyPrefix)) await cacheStorage.delete(key);
  }
}

/** Once the page has nothing more pressing to do, or after five seconds. */
function whenIdle() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(() => resolve(), { timeout: 5000 });
    else setTimeout(resolve, 1500);
  });
}

/**
 * What a player is told about the copy, in a line.
 * @param {{ supported: boolean, enabled: boolean, saving: boolean, copy: object|null, error: string|null }} status
 */
export function offlineStatusText(status) {
  if (!status.supported) return status.error ? `Not possible here: ${status.error}` : "Not possible here: the page has to come from localhost, or over HTTPS with a certificate the browser trusts.";
  if (!status.enabled) return "Off: the game needs its server at every start.";
  if (status.copy) {
    const when = new Date(status.copy.savedAt);
    const time = Number.isNaN(when.getTime()) ? "" : ` ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    return `Saved${time}, ${status.copy.files} files${status.saving ? "; checking for a newer one..." : "."}`;
  }
  if (status.saving) return "Saving...";
  return status.error ? `Not saved: ${status.error}` : "Not saved yet.";
}

/**
 * The copy, as the app works with it.
 * @param {{ settings: object }} context `settings.offline === false` switches it off
 * @param {{ nav?: object, cacheStorage?: object, secure?: boolean, fetchFn?: typeof fetch, root?: string, idle?: () => Promise<void> }} [env] for tests
 */
export function createOffline(context, {
  nav = globalThis.navigator, cacheStorage = globalThis.caches, secure = globalThis.isSecureContext,
  fetchFn = globalThis.fetch?.bind(globalThis), root = new URL("../../", import.meta.url).href, idle = whenIdle,
} = {}) {
  const state = { supported: !!(nav?.serviceWorker && cacheStorage) && secure !== false, saving: false, copy: null, error: null };
  const listeners = new Set();
  const changed = () => { for (const fn of [...listeners]) fn(offline.status); };
  let saving = null;

  const offline = {
    root,
    /** `{ supported, enabled, saving, copy, error }`: `copy` is what is kept (`{ files, savedAt }`), `error` why the last attempt failed. */
    get status() { return { ...state, enabled: context.settings.offline !== false }; },
    /** Hear of every change of the status. Returns the remover. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /**
     * At the app's start: register the worker and bring the copy up to date, once the page is
     * idle; or, switched off, take both away. Never rejects: the game runs the same without it.
     */
    async start() {
      if (!state.supported) return;
      if (context.settings.offline === false) return offline.remove();
      try {
        await nav.serviceWorker.register(new URL("sw.js", root).href, { scope: root });
      } catch (error) {
        // A page behind a certificate the browser does not trust, for one.
        state.supported = false;
        state.error = error?.message ?? String(error);
        changed();
        return;
      }
      state.copy = await offlineCopy(root, cacheStorage).catch(() => null);
      changed();
      await idle();
      await offline.save();
    },
    /** Make a new copy now. Resolves when done, whether it worked or not (see `status`). */
    save() {
      if (!state.supported || context.settings.offline === false) return Promise.resolve();
      saving ??= (async () => {
        state.saving = true;
        state.error = null;
        changed();
        try {
          state.copy = await saveOfflineCopy({ root, fetchFn, cacheStorage });
          // Switched off while it was being made.
          if (context.settings.offline === false) {
            await removeOfflineCopy(root, cacheStorage);
            state.copy = null;
          }
        } catch (error) {
          state.error = error?.message ?? String(error);
        }
        state.saving = false;
        saving = null;
        changed();
      })();
      return saving;
    },
    /** Take the worker and the copy away. */
    async remove() {
      if (!state.supported) return;
      try {
        // The copy first: without it the worker has nothing to answer from, however long it takes to go.
        await removeOfflineCopy(root, cacheStorage);
        const registration = await nav.serviceWorker.getRegistration(root);
        await registration?.unregister();
      } catch (error) {
        state.error = error?.message ?? String(error);
      }
      state.copy = null;
      changed();
    },
    /** Switch the copy on or off (the caller stores the settings). */
    async setEnabled(on) {
      context.settings.offline = !!on;
      changed();
      if (on) await offline.start();
      else await offline.remove();
    },
  };
  return offline;
}
