import { deflateSync } from "node:zlib";

/** Synthetic framing only; payloads are never executed or claimed as decompiled code. */
export const FLASH_ABC_BYTES = Buffer.from([16, 0, 46, 0, 1, 1, 1, 1]);
export const flashTag = (
  code: number,
  payload = Buffer.alloc(0),
  long = false,
): Buffer => {
  const extended = long || payload.length >= 63;
  const header = Buffer.alloc(extended ? 6 : 2);
  header.writeUInt16LE((code << 6) | (extended ? 63 : payload.length));
  if (extended) header.writeUInt32LE(payload.length, 2);
  return Buffer.concat([header, payload]);
};
export const flashAbcTag = (name: string): Buffer =>
  flashTag(
    82,
    Buffer.concat([Buffer.alloc(4), Buffer.from(`${name}\0`), FLASH_ABC_BYTES]),
  );
export const flashSprite = (tags: readonly Buffer[], id = 7): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id);
  header.writeUInt16LE(1, 2);
  return flashTag(39, Buffer.concat([header, ...tags, flashTag(0)]));
};
export const flashMovie = (
  tags: readonly Buffer[] = [
    flashAbcTag("one"),
    flashSprite([flashAbcTag("two")]),
    flashTag(87, Buffer.from([9, 0, 0, 0, 0, 0, 70, 87, 83])),
    flashTag(1),
  ],
  compressed = false,
): Buffer => {
  let bits = "01100";
  for (const value of [0, 2000, 0, 1000])
    bits += value.toString(2).padStart(12, "0");
  bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
  const rect = Buffer.from(
    bits.match(/.{8}/gu)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const frame = Buffer.from([0, 24, 1, 0]);
  const body = Buffer.concat([rect, frame, ...tags, flashTag(0)]);
  const header = Buffer.alloc(8);
  header.write(compressed ? "CWS" : "FWS");
  header[3] = 19;
  header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, compressed ? deflateSync(body) : body]);
};
