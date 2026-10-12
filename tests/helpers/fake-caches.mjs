/*
  A CacheStorage that lives in memory, for the tests of the offline copy (src/app/offline.js) and
  of the service worker (sw.js): as much of the real one as those two use.
*/
const urlOf = (request) => (typeof request === "string" ? request : request.url);
const bare = (url) => { const u = new URL(url); u.search = ""; return u.href; };

export function fakeCaches() {
  /** Cache name to (address to Response). */
  const stores = new Map();
  const find = (store, request, { ignoreSearch = false } = {}) => {
    const url = urlOf(request);
    if (store.has(url)) return store.get(url);
    if (!ignoreSearch) return undefined;
    for (const [key, response] of store) if (bare(key) === bare(url)) return response;
    return undefined;
  };
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(request, response) { store.set(urlOf(request), response); },
        async match(request, options) { return find(store, request, options)?.clone(); },
      };
    },
    async has(name) { return stores.has(name); },
    async delete(name) { return stores.delete(name); },
    async keys() { return [...stores.keys()]; },
    /** Like the real one with `cacheName`: no cache by that name is no answer, and none is made. */
    async match(request, options = {}) {
      const store = stores.get(options.cacheName);
      return store ? find(store, request, options)?.clone() : undefined;
    },
    /** The addresses one cache holds. */
    urls(name) { return [...(stores.get(name)?.keys() ?? [])]; },
  };
}

/**
 * A server and a CDN that know these files (address to text; a number is a status with no body).
 * `down` names the sites that cannot be reached: "own", "cdn" or both.
 */
export function fakeNetwork(files, root) {
  const net = {
    files, calls: [], down: new Set(),
    fetch: async (request, init = {}) => {
      const url = urlOf(request);
      const headers = new Headers(init.headers ?? request.headers ?? {});
      net.calls.push({ url, marked: headers.has("x-openmtm2-offline"), cache: init.cache ?? null });
      if (net.down.has(url.startsWith(root) ? "own" : "cdn")) throw new TypeError("Failed to fetch");
      const body = net.files[url];
      if (body === undefined) return new Response("Not found.", { status: 404 });
      return typeof body === "number" ? new Response(null, { status: body }) : new Response(body, { status: 200 });
    },
  };
  return net;
}
