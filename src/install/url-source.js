/*
  The player's MTM2 folder served over HTTP, as an install source (docs/VR.md, "Running it on a
  headset"). A headset's browser has no good way to pick a folder of the player's PC, so the
  development server (tools/serve.mjs --game) serves that folder beside the app, at `game/`, and
  the Install screen copies it from there.

  Like the folder picker's source (picker.js) this hands out files by path, but as
  `{ url, size, text() }`: the asset worker fetches each archive itself and streams it into
  storage (worker/install-store.js), so nothing passes through the page.

  Names are tried as written, then in upper and lower case: POD.INI lists lowercase names for
  uppercase files, and a plain file server tells them apart.
*/

/** A path as the end of an address: each part encoded, and none that would climb out of the folder. */
const encodePath = (path) => String(path).replace(/\\/g, "/").split("/")
  .filter((part) => part && part !== "." && part !== "..").map(encodeURIComponent).join("/");

/**
 * @param {string} base the folder's address, absolute (it is used as given, with a trailing slash)
 * @param {typeof fetch} [fetchFn]
 */
export function urlSource(base, fetchFn = globalThis.fetch) {
  const root = base.endsWith("/") ? base : `${base}/`;
  const head = async (path) => {
    const url = root + encodePath(path);
    try {
      const response = await fetchFn(url, { method: "HEAD", cache: "no-store" });
      if (!response.ok) return null;
      const size = Number(response.headers.get("content-length"));
      return {
        name: path, url, size: Number.isFinite(size) && size > 0 ? size : 0,
        async text() {
          const body = await fetchFn(url, { cache: "no-store" });
          if (!body.ok) throw new Error(`${url} answered ${body.status}.`);
          return body.text();
        },
      };
    } catch {
      return null;
    }
  };
  return {
    name: root,
    async getFile(path) {
      const tries = [...new Set([path, path.toUpperCase(), path.toLowerCase()])];
      for (const candidate of tries) {
        const file = await head(candidate);
        if (file) return file;
      }
      return null;
    },
  };
}

/**
 * Whether a page at `hostname` could have the player's game folder beside it. Only a server on
 * the player's own machine or network does (tools/serve.mjs); a public host is not asked, which
 * would only put failed requests in every visitor's console.
 */
export function mayServeGame(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host.includes(":")) return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    // Loopback, the private ranges, link-local, and the shared range overlay networks use.
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  // This machine, a bare machine name, or a name of the local network.
  return host === "localhost" || !host.includes(".") || /\.(localhost|local|lan|home|internal|home\.arpa)$/.test(host);
}

/**
 * Whether a game folder is served at `base`: the folder's own address answers (tools/serve.mjs
 * does, and so does a server that lists folders), and it has a POD.INI, there or in SYSTEM. The
 * folder is asked first, so a server without one costs a single request.
 */
export async function hasServedGame(base, fetchFn = globalThis.fetch) {
  const root = base.endsWith("/") ? base : `${base}/`;
  try {
    if (!(await fetchFn(root, { method: "HEAD", cache: "no-store" })).ok) return false;
  } catch {
    return false;
  }
  const source = urlSource(root, fetchFn);
  return !!((await source.getFile("POD.INI")) ?? (await source.getFile("SYSTEM/POD.INI")));
}

/**
 * What the asset worker's `install` takes for a file an install source handed out: a picked
 * File as it is, a served one as `{ url, size }` (a message to a worker cannot carry methods).
 */
export function installEntry(file) {
  return typeof file?.url === "string" ? { url: file.url, size: file.size } : file;
}
