import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { isZipName, podsInZip } from "../src/shared/zip.js";

/** A ZIP of `entries` ({ name, data, deflate }), written by hand: local headers, the directory, its end. */
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data, deflate = false } of entries) {
    const body = deflate ? new Uint8Array(deflateRawSync(data)) : data, nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, body.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length), dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(10, deflate ? 8 : 0, true);
    dv.setUint32(20, body.length, true); dv.setUint32(24, data.length, true); dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    parts.push(local, body);
    central.push(dir);
    offset += local.length + body.length;
  }
  const dirSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

test("every POD in a ZIP, stored or deflated, without its folders; a readme is left alone", async () => {
  const a = new Uint8Array(1000).map((_, i) => i % 7), b = new Uint8Array(5000).fill(42);
  const pods = await podsInZip(zip([
    { name: "pack/ONE.POD", data: a }, { name: "readme.txt", data: new Uint8Array([1, 2, 3]), deflate: true }, { name: "two.pod", data: b, deflate: true },
  ]));
  assert.deepEqual(pods.map((p) => p.name), ["ONE.POD", "two.pod"]);
  assert.deepEqual(pods[0].bytes, a);
  assert.deepEqual(pods[1].bytes, b);
  assert.ok(isZipName("Pack.ZIP") && !isZipName("pack.pod"));
  await assert.rejects(podsInZip(new Uint8Array(100)), /not a ZIP/);
});
