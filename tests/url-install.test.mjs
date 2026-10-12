import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasServedGame, installEntry, mayServeGame, urlSource } from "../src/install/url-source.js";
import { inspectSource } from "../src/install/inspect-source.js";
import { downloadInto } from "../src/worker/install-store.js";
import { fileFor, parseArgs, resolveUnder } from "../tools/serve.mjs";

/** A server that knows these paths exactly (case matters), as a plain file server does. */
function fakeFetch(files) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    const body = files[new URL(url).pathname];
    if (body === undefined) return { ok: false, status: 404, headers: { get: () => null } };
    return { ok: true, status: 200, headers: { get: (name) => (name === "content-length" ? String(body.length) : null) }, text: async () => body };
  };
  return { fetchFn, calls };
}

test("a served folder: files are found as written, then in upper and lower case", async () => {
  const { fetchFn, calls } = fakeFetch({ "/game/POD.INI": "1\r\nstartup.pod\r\n", "/game/STARTUP.POD": "abcdef" });
  const source = urlSource("http://localhost:8080/game", fetchFn);
  const ini = await source.getFile("pod.ini");
  assert.equal(ini.url, "http://localhost:8080/game/POD.INI");
  assert.equal(await ini.text(), "1\r\nstartup.pod\r\n");
  const pod = await source.getFile("startup.pod");
  assert.deepEqual([pod.url, pod.size], ["http://localhost:8080/game/STARTUP.POD", 6]);
  assert.equal(await source.getFile("missing.pod"), null);
  assert.ok(calls.every((c) => c.startsWith("HEAD ") || c === "GET http://localhost:8080/game/POD.INI"), "only POD.INI is downloaded by the page");
});

test("a served folder goes through the same check as a picked one", async () => {
  const { fetchFn } = fakeFetch({
    "/game/": "", "/game/SYSTEM/POD.INI": "2\r\nc:\\mtm2\\startup.pod\r\nui.pod\r\n", "/game/STARTUP.POD": "x".repeat(10), "/game/SYSTEM/UI.POD": "y".repeat(4),
  });
  assert.equal(await hasServedGame("http://h/game/", fetchFn), true);
  const result = await inspectSource(urlSource("http://h/game/", fetchFn));
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.map((f) => f.name), ["STARTUP.POD", "SYSTEM/UI.POD"]);
  assert.equal(result.totalBytes, 14);
  // What goes to the worker is plain data: the address and the size.
  assert.deepEqual(result.files.map((f) => installEntry(f.file)), [
    { url: "http://h/game/STARTUP.POD", size: 10 }, { url: "http://h/game/SYSTEM/UI.POD", size: 4 },
  ]);
  const picked = { name: "x.pod", size: 3 };
  assert.equal(installEntry(picked), picked);
});

test("no served folder: the check says so with one request, and never throws", async () => {
  const none = fakeFetch({});
  assert.equal(await hasServedGame("http://h/game", none.fetchFn), false);
  assert.deepEqual(none.calls, ["HEAD http://h/game/"]);
  assert.equal(await hasServedGame("http://h/game/", async () => { throw new Error("offline"); }), false);
  // A folder that answers but holds no POD.INI is no game.
  assert.equal(await hasServedGame("http://h/game/", fakeFetch({ "/game/": "", "/game/README.TXT": "x" }).fetchFn), false);
});

test("only a server on the player's own machine or network is asked for a game folder", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "::1", "192.168.1.20", "10.0.0.5", "172.16.4.1", "172.31.255.1", "169.254.3.3", "100.101.102.103",
    "quest-pc", "tower.local", "nas.lan", "dev.localhost", "box.home.arpa", "fd12:3456::1", "fe80::1"]) {
    assert.equal(mayServeGame(host), true, host);
  }
  for (const host of ["lorendb.github.io", "example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "100.63.0.1", "100.128.0.1",
    "2606:4700::1111", "localhost.example.com", "", undefined]) {
    assert.equal(mayServeGame(host), false, String(host));
  }
});

test("path parts are encoded, so a name cannot leave the folder's address", async () => {
  const { fetchFn, calls } = fakeFetch({});
  await urlSource("http://h/game/", fetchFn).getFile("a b\\..\\c#d.pod");
  assert.equal(calls[0], "HEAD http://h/game/a%20b/c%23d.pod");
});

test("a served archive is written as it arrives, and a short download is an error", async () => {
  const pieces = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
  const serve = (status = 200) => async (url, init) => {
    assert.deepEqual([url, init.cache], ["http://h/game/A.POD", "no-store"]);
    return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(p); c.close(); } }), { status });
  };
  const written = [];
  const write = (chunk, at) => written.push([at, ...chunk]);
  assert.equal(await downloadInto({ url: "http://h/game/A.POD", size: 6 }, write, serve()), 6);
  assert.deepEqual(written.flatMap(([, ...bytes]) => bytes), [1, 2, 3, 4, 5, 6]);
  // Each piece lands where the one before it ended.
  let end = 0;
  for (const [at, ...bytes] of written) { assert.equal(at, end); end += bytes.length; }
  // A size the server did not announce (0) is not checked.
  assert.equal(await downloadInto({ url: "http://h/game/A.POD", size: 0 }, () => {}, serve()), 6);
  await assert.rejects(downloadInto({ url: "http://h/game/A.POD", size: 9 }, () => {}, serve()), /sent 6 of 9 bytes/);
  await assert.rejects(downloadInto({ url: "http://h/game/A.POD", size: 6 }, () => {}, serve(404)), /answered 404/);
  // A response without a stream to read is taken whole.
  const whole = async () => ({ ok: true, status: 200, body: null, arrayBuffer: async () => new Uint8Array([7, 8]).buffer });
  const got = [];
  assert.equal(await downloadInto({ url: "http://h/game/B.POD", size: 2 }, (chunk, at) => got.push(at, ...chunk), whole), 2);
  assert.deepEqual(got, [0, 7, 8]);
});

test("the development server: arguments", () => {
  assert.deepEqual(parseArgs([]), { port: 8080, lan: false, https: false, http: false, game: null, cert: null, key: null, help: false });
  const lan = parseArgs(["--lan", "--port", "9000", "--game", "/tmp/mtm2"]);
  assert.deepEqual([lan.port, lan.lan, lan.https, lan.game], [9000, true, true, "/tmp/mtm2"]);
  // The network gets HTTPS unless plain HTTP is asked for.
  assert.equal(parseArgs(["--lan", "--http"]).https, false);
  assert.equal(parseArgs(["--https"]).https, true);
  assert.throws(() => parseArgs(["--http", "--https"]), /does not go with/);
  assert.throws(() => parseArgs(["--http", "--cert", "a.pem", "--key", "b.pem"]), /does not go with/);
  assert.throws(() => parseArgs(["--port", "x"]), /port/);
  assert.throws(() => parseArgs(["--cert", "a.pem"]), /go together/);
  assert.throws(() => parseArgs(["--game"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});

test("the development server: only the app's files and the game folder, names of the game matched without case", () => {
  const dir = mkdtempSync(join(tmpdir(), "openmtm2-serve-"));
  try {
    const root = join(dir, "repo"), game = join(dir, "MTM2");
    mkdirSync(join(root, "src", "app"), { recursive: true });
    mkdirSync(join(root, "re"), { recursive: true });
    mkdirSync(join(game, "SYSTEM"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    writeFileSync(join(root, "sw.js"), "");
    writeFileSync(join(root, "src", "app", "main.js"), "");
    writeFileSync(join(root, "re", "decomp.c"), "secret");
    writeFileSync(join(root, "AGENTS.md"), "");
    writeFileSync(join(game, "POD.INI"), "0");
    writeFileSync(join(game, "SYSTEM", "TRUCK2.POD"), "");
    writeFileSync(join(dir, "outside.txt"), "");
    const at = (path) => fileFor(path, { root, game });
    assert.equal(at("/"), join(root, "index.html"));
    assert.equal(at("/sw.js"), join(root, "sw.js"), "the service worker is served from the root, where its reach is the whole app");
    assert.equal(at("/src/app/main.js"), join(root, "src", "app", "main.js"));
    assert.equal(at("/src/app/MAIN.JS"), null, "the app's own paths are exact");
    assert.equal(at("/re/decomp.c"), null, "the reverse-engineering workspace is never served");
    assert.equal(at("/AGENTS.md"), null);
    assert.equal(at("/game/pod.ini"), join(game, "POD.INI"));
    assert.equal(at("/game/system/truck2.pod"), join(game, "SYSTEM", "TRUCK2.POD"));
    assert.equal(at("/game/../outside.txt"), null);
    assert.equal(at("/game/%2e%2e/outside.txt"), null);
    assert.equal(at("/src/../../outside.txt"), null);
    assert.equal(at("/game/SYSTEM"), null, "folders are not listed");
    assert.equal(fileFor("/game/pod.ini", { root }), null, "no game folder unless one is given");
    assert.equal(at("/%E0%A4%A"), null, "a malformed address is not found");
    assert.equal(resolveUnder(game, "system/TRUCK2.pod", false), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
