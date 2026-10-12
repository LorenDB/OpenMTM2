/*
  The service worker: it lets the game start when its server cannot be reached
  (docs/ARCHITECTURE.md, "Without a server").

  It stands between the app and the network and does one thing. Every request goes to the
  network first, so a server that answers always gives its own files, as if this were not
  here; only when the network fails does the answer come from the copy of the app that the page
  keeps (src/app/offline.js makes it: this file never writes to it). The copy is complete or it
  is not there at all, so a start without a server gets one consistent set of files.

  Left alone: anything that is not a GET; the game folder a development server serves at game/
  (it is copied once into the browser's own storage, not kept here); what the page fetches to
  make the copy, which must come from the server or fail (it is marked with a header); and
  other sites' data that scripts fetch for themselves.

  This is a classic script, since not every browser runs a service worker as a module; the two
  names it shares with src/app/offline.js are kept in step by tests/offline.test.mjs.
*/
const SCOPE = self.registration.scope;
/** Where the page records which cache holds the complete copy. */
const POINTER_CACHE = `openmtm2-offline|${SCOPE}`, POINTER_URL = `${SCOPE}__offline__`;
/** The header on the requests that make the copy. */
const COPYING = "x-openmtm2-offline";

// A new version of this file takes over at once: it holds no state an old page depends on.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** The copy's answer to a request, or undefined when there is no copy or it lacks the file. */
async function kept(request) {
  const pointer = await caches.match(POINTER_URL, { cacheName: POINTER_CACHE });
  if (!pointer) return undefined;
  const { cache } = await pointer.json();
  const page = request.mode === "navigate";
  const found = await caches.match(request.url, { cacheName: cache, ignoreSearch: page, ignoreVary: true });
  // The app is one page: any address of its own that is opened is that page.
  return found ?? (page ? caches.match(SCOPE, { cacheName: cache, ignoreVary: true }) : undefined);
}

async function answer(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const copy = await kept(request);
    if (copy) return copy;
    throw error;
  }
  // A server in trouble is no better than none for opening the game.
  if (request.mode === "navigate" && response.status >= 500) return (await kept(request)) ?? response;
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has(COPYING)) return;
  if (request.url.startsWith(SCOPE)) {
    if (request.url.startsWith(`${SCOPE}game/`)) return;
  } else if (request.destination === "") return;
  event.respondWith(answer(request));
});
