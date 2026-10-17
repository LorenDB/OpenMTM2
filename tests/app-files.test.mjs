import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crawl, kindOf, resolveImport, resolveUrl, scanCss, scanHtml, scanJs } from "../src/shared/app-files.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("a module's references: every way the app names another file", () => {
  const found = scanJs(`
    import { a } from "./a.js";
    import * as b from '../b.js';
    import c, {
      d,
      e,
    } from "./multi/line.js";
    import "./side-effect.js";
    export { f } from "./re-export.js";
    export * from "three";
    const screens = { race: () => import("../ui/screens/race.js"), other: () => import( './spaced.js' ) };
    const worker = new Worker(new URL("../worker/sim-worker.js", import.meta.url), { type: "module" });
    /** @param {ReturnType<import("./types.js").make>} x a type named in a comment is followed too */
  `);
  assert.deepEqual(found.imports, ["./a.js", "../b.js", "./multi/line.js", "./re-export.js", "three", "./side-effect.js", "../ui/screens/race.js", "./spaced.js", "./types.js"]);
  assert.deepEqual(found.urls, ["../worker/sim-worker.js"]);
});

test("a module's references: what is not one", () => {
  const found = scanJs(`
    const served = new URL("game/", document.baseURI).href;      // not beside the module
    loader.import("./not-a-module.js");                          // a method that happens to be called import
    const x = await import(name);                                // not a plain string: cannot be followed
    export const from = "elsewhere";                             // a quote before any from
    export function load() { return read("disk"); }
    const text = "nothing here is imported";
  `);
  assert.deepEqual(found, { imports: [], urls: [] });
});

test("a stylesheet's and a page's references, and the page's import map", () => {
  assert.deepEqual(scanCss(`@import "./a.css"; @import url(b.css); .x { background: url("img/c.png"); src: url(d.woff2) }`), ["./a.css", "b.css", "img/c.png", "d.woff2"]);
  const page = scanHtml(`<!doctype html><html><head>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">
    <link rel="stylesheet" href="./styles/base.css">
    <LINK rel=stylesheet href=styles/screens.css>
    <script type="importmap">{ "imports": { "three": "https://cdn.test/three.js", "three/addons/": "https://cdn.test/jsm/" } }</script>
    </head><body>
    <script type="module" src="./src/app/main.js"></script>
    <script type="module">import "./src/inline.js"; const w = new URL("./w.js", import.meta.url);</script>
    <script>var classic = "import './not-scanned.js'";</script>
  </body></html>`);
  assert.deepEqual(page.urls, ["data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E", "./styles/base.css", "styles/screens.css", "./src/app/main.js", "./w.js"]);
  assert.deepEqual(page.imports, ["./src/inline.js"]);
  assert.deepEqual(page.importMap, { imports: { three: "https://cdn.test/three.js", "three/addons/": "https://cdn.test/jsm/" } });
  assert.equal(scanHtml("<p>no scripts</p>").importMap, null);
  assert.equal(scanHtml(`<script type="importmap">{ not json</script>`).importMap, null);
});

test("names become addresses: relative ones against the file, bare ones through the import map", () => {
  const map = { imports: { three: "https://cdn.test/three@1/three.js", "three/addons/": "https://cdn.test/three@1/jsm/", "three/addons/csm/": "https://other.test/csm/" } };
  const base = "http://h/app/src/render/x.js";
  assert.equal(resolveImport("./y.js", base, map), "http://h/app/src/render/y.js");
  assert.equal(resolveImport("../shared/z.js", base, map), "http://h/app/src/shared/z.js");
  assert.equal(resolveImport("/root.js", base, map), "http://h/root.js");
  assert.equal(resolveImport("https://else.test/m.js#frag", base, map), "https://else.test/m.js");
  assert.equal(resolveImport("three", base, map), "https://cdn.test/three@1/three.js");
  assert.equal(resolveImport("three/addons/utils/A.js", base, map), "https://cdn.test/three@1/jsm/utils/A.js");
  // The longest entry that fits is the one used.
  assert.equal(resolveImport("three/addons/csm/CSM.js", base, map), "https://other.test/csm/CSM.js");
  // A bare name the map does not have, with or without a map.
  assert.equal(resolveImport("lodash", base, map), null);
  assert.equal(resolveImport("three", base, null), null);
  // Inside the CDN's own files a relative name stays on the CDN.
  assert.equal(resolveImport("./CSMShader.js", "https://cdn.test/three@1/jsm/csm/CSM.js", map), "https://cdn.test/three@1/jsm/csm/CSMShader.js");
  // Only what a server can give.
  assert.equal(resolveUrl("data:text/plain,x", base), null);
  assert.equal(resolveUrl("blob:http://h/1", base), null);
  assert.equal(resolveUrl("styles/a.css?v=2#top", "http://h/app/"), "http://h/app/styles/a.css?v=2");
  assert.deepEqual(["http://h/app/", "http://h/app/a.JS", "http://h/app/a.mjs", "http://h/app/a.css", "http://h/app/b.html", "http://h/app/c.png"].map((u) => kindOf(u, "http://h/app/")), ["html", "js", "js", "css", "html", "other"]);
});

test("the walk: from the page through everything it leads to, each file once", async () => {
  const root = "http://h/app/";
  const files = {
    [root]: `<link rel="stylesheet" href="./s.css"><script type="importmap">{"imports":{"lib":"https://cdn.test/lib.js"}}</script><script type="module" src="./a.js"></script>`,
    [`${root}s.css`]: `.x { background: url(pic.png) }`,
    [`${root}pic.png`]: "PNG",
    [`${root}a.js`]: `import "./b.js"; import "lib"; import "./gone.js"; const w = new URL("./w.js", import.meta.url);`,
    [`${root}b.js`]: `import "./a.js"; import "unknown-bare-name";`,
    [`${root}w.js`]: `import "./b.js";`,
    "https://cdn.test/lib.js": `import "./dep.js";`,
    "https://cdn.test/dep.js": ``,
  };
  const asked = [];
  let busy = 0, most = 0;
  const found = await crawl(root, async (url) => {
    asked.push(url);
    most = Math.max(most, ++busy);
    await new Promise((resolve) => setTimeout(resolve, 2));
    busy--;
    return files[url] ?? null;
  }, { concurrency: 3 });
  assert.equal(found[0], root, "the page first");
  assert.deepEqual([...found].sort(), Object.keys(files).sort());
  assert.equal(new Set(asked).size, asked.length, "no file is asked for twice");
  assert.ok(asked.includes(`${root}gone.js`) && !found.includes(`${root}gone.js`), "a file that is not there is passed over");
  assert.ok(most > 1 && most <= 3, `at most three at a time, was ${most}`);
  // A picture is kept but not read for references.
  assert.ok(found.includes(`${root}pic.png`));
});

test("the walk stops at the first file that cannot be had", async () => {
  const root = "http://h/";
  const files = { [root]: `<script type="module" src="./a.js"></script>`, [`${root}a.js`]: `import "./b.js"; import "./c.js";` };
  await assert.rejects(crawl(root, async (url) => {
    if (url.endsWith("b.js")) throw new TypeError("Failed to fetch");
    return files[url] ?? "";
  }), /Failed to fetch/);
  await assert.rejects(crawl(root, async () => { throw new Error("no page"); }), /no page/);
});

/** Every file under a folder of the repository, as paths from the repository's root (the Finder's .DS_Store left out). */
const filesUnder = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).filter((entry) => entry.name !== ".DS_Store")
  .flatMap((entry) => (entry.isDirectory() ? filesUnder(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));

test("the app itself: the walk from index.html reaches every script and stylesheet it has", async () => {
  const root = "http://app.test/";
  const missing = [], remote = [];
  const found = await crawl(root, async (url) => {
    if (!url.startsWith(root)) {
      // The CDN is not asked: its files' own imports are three.js's business.
      remote.push(url);
      return "";
    }
    const path = join(REPO, url === root ? "index.html" : decodeURIComponent(url.slice(root.length)));
    if (!existsSync(path) || !statSync(path).isFile()) { missing.push(url); return null; }
    return readFileSync(path, "utf8");
  });
  assert.deepEqual(missing, [], "the app names no file that is not there");
  const reached = new Set(found.filter((url) => url.startsWith(root)).map((url) => url.slice(root.length)));
  // The vendored library is generated elsewhere: what the app does not import of it is not the app's.
  const apart = (file) => file.startsWith("src/vendor/");
  const unreached = [...filesUnder("src"), ...filesUnder("styles")].filter((file) => !reached.has(file) && !apart(file));
  assert.deepEqual(unreached, [], "every file of the app is reached from its page: one that is loaded in a way the walk does not know"
    + " would be missing from the copy kept for starting without a server (teach src/shared/app-files.js), and one that nothing loads is not part of the app");
  assert.ok(reached.has("src/vendor/openphotex/index.js"), "what the app imports of the vendored library is reached like the rest");
  // The worker that answers from the copy is not in the copy.
  assert.equal(reached.has("sw.js"), false);
  // three.js and its add-ons come through the page's import map, at the version it pins.
  const map = scanHtml(readFileSync(join(REPO, "index.html"), "utf8")).importMap;
  assert.ok(remote.includes(map.imports.three));
  assert.ok(remote.length >= 2 && remote.every((url) => url.startsWith(map.imports.three) || url.startsWith(map.imports["three/addons/"])), remote.join(" "));
  assert.match(map.imports.three, /three@\d+\.\d+\.\d+\//, "the address carries the version, so a kept copy of it never goes stale");
});

test("the app names its files in plain strings only, so the walk can follow them all", () => {
  const offenders = [];
  for (const file of filesUnder("src").filter((f) => f.endsWith(".js"))) {
    const text = readFileSync(join(REPO, file), "utf8");
    // import(something that is not a quoted string), and new URL(not a string, import.meta.url)
    for (const match of text.matchAll(/(?<![.\w$])import\s*\(\s*(?!['"])[^)]*\)|\bnew\s+URL\s*\(\s*(?!['"])[^,)]*,\s*import\.meta\.url/g)) {
      offenders.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
