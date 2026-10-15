/*
  The PODs inside a ZIP, for the POD manager: a track or truck pack is often shipped zipped, sometimes several PODs to a
  ZIP (as JSTrackViewer opens them). Only what is needed is read: the central directory, then each `.POD` or `.EPD`
  entry, stored or deflated (the browser's own DecompressionStream inflates it). Other entries (a readme, pictures) are
  never inflated. Encrypted entries and ZIP64 archives are not read. Pure, apart from DecompressionStream, so it runs
  under Node too.
*/

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** Whether a name is an archive the POD manager mounts. */
export const isPodName = (name) => /\.(pod|epd)$/i.test(String(name ?? "").trim());
/** Whether a name is a ZIP. */
export const isZipName = (name) => /\.zip$/i.test(String(name ?? "").trim());

/** An entry's name: UTF-8 when the entry says so (flag bit 11), else the old DOS code page read byte for byte. */
function entryName(bytes, flags) {
  return flags & 0x800 ? new TextDecoder("utf-8").decode(bytes) : String.fromCharCode(...bytes);
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * `[{ name, bytes }]` for every POD (or EPD) in the ZIP `bytes`, in the order its directory lists them, `name` being the
 * entry's file name without its folders. Throws when `bytes` is not a ZIP it can read.
 */
export async function podsInZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) { end = at; break; }
  }
  if (end < 0) throw new Error("not a ZIP file");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  if (at === 0xffffffff || size === 0xffffffff) throw new Error("a ZIP64 archive, which is not read");
  const out = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error("a damaged ZIP directory");
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const full = entryName(bytes.subarray(at + 46, at + 46 + nameLength), flags);
    at += 46 + nameLength + extraLength + commentLength;
    const name = full.replace(/\\/g, "/").split("/").pop();
    if (!name || !isPodName(name) || flags & 1) continue;
    if (view.getUint32(local, true) !== LOCAL) throw new Error(`a damaged ZIP entry, ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packed);
    if (method === 0) out.push({ name, bytes: data.slice() });
    else if (method === 8) out.push({ name, bytes: await inflateRaw(data) });
  }
  return out;
}
