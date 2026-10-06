// src/lib/zipRead.ts
//
// Read ONE named file out of a zip, no dependency: walk the central
// directory, then inflate the entry with the platform's DecompressionStream
// ('deflate-raw'). Enough for document containers like Fade In's .fadein
// (a zip holding document.xml); not a general zip library (no zip64, no
// encryption).

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

export const inflateRawStream: InflateRaw = async (data) => {
  // In every current browser (Safari 16.4+), but newer than this TS lib.
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) throw new Error('this browser cannot unpack the file; export it as .fdx instead');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** The bytes of `name` (matched case-insensitively, at any depth), or null
 *  when the archive has no such entry. Throws on a file that is not a zip. */
export async function readZipEntry(
  buf: ArrayBuffer,
  name: string,
  inflate: InflateRaw = inflateRawStream,
): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // End of central directory: signature 0x06054b50, within the last 64KB + 22.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const want = name.toLowerCase();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const entry = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)).toLowerCase();
    p += 46 + nameLen + extraLen + commentLen;
    if (entry !== want && !entry.endsWith('/' + want)) continue;
    // The local header repeats name/extra with its own lengths.
    const lName = view.getUint16(localOff + 26, true);
    const lExtra = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lName + lExtra;
    const data = bytes.subarray(start, start + compSize);
    if (method === 0) return data.slice();
    if (method === 8) return inflate(data);
    throw new Error(`unsupported zip compression (${method})`);
  }
  return null;
}
