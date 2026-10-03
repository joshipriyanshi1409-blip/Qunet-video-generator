/**
 * Byte-level helpers for the media writers.
 *
 * Every format in `media/` is big-endian on the wire, and every one of them is a
 * length-prefixed sequence of chunks, so the same two primitives cover all of
 * them. Kept separate so the writers stay readable and so the tests can assert
 * on exact bytes rather than on a decoded result.
 */

/** Writes an unsigned 32-bit big-endian integer. */
export function u32be(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

/** Writes an unsigned 16-bit big-endian integer. */
export function u16be(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value & 0xffff, 0);
  return buffer;
}

/** Writes an unsigned 32-bit **little**-endian integer. */
export function u32le(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

/** Writes an unsigned 16-bit little-endian integer. */
export function u16le(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

/** Concatenates buffers. */
export function concat(...parts: readonly Buffer[]): Buffer {
  return Buffer.concat(parts);
}

/** An ASCII four-character code, the unit every box name is written in. */
export function fourcc(code: string): Buffer {
  if (code.length !== 4) {
    throw new Error(`fourcc must be exactly four characters, got "${code}"`);
  }
  return Buffer.from(code, 'ascii');
}

/**
 * Reads an unsigned 32-bit big-endian integer.
 *
 * Used by the tests to check what a writer produced without needing a decoder:
 * a box whose length field disagrees with its contents is corrupt even if the
 * payload happens to be right.
 */
export function readU32be(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

/**
 * A four-byte-aligned box: `[size:u32][type:4cc][payload]`.
 *
 * `size` counts the header, which is what every MP4 parser expects and the
 * single easiest thing to get wrong when writing one by hand.
 */
export function box(type: string, ...payload: readonly Buffer[]): Buffer {
  const body = concat(...payload);
  return concat(u32be(8 + body.length), fourcc(type), body);
}

/** A full box, carrying a version and 24 bits of flags after the type. */
export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: readonly Buffer[]
): Buffer {
  const head = Buffer.alloc(4);
  head[0] = version & 0xff;
  head[1] = (flags >>> 16) & 0xff;
  head[2] = (flags >>> 8) & 0xff;
  head[3] = flags & 0xff;
  return box(type, head, ...payload);
}
