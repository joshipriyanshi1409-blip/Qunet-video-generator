import { deflateSync } from 'node:zlib';
import { concat, u32be } from './bytes.js';

/**
 * A real PNG writer.
 *
 * The thumbnail and the mock scene clips are PNGs, not empty files with a `.png`
 * name: they open in a browser, they have a size a test can assert on, and the
 * only dependency is `node:zlib`, which is already in the runtime.
 *
 * Encoding is deliberately the simplest correct form - 8-bit RGB, filter 0 on
 * every scanline, no interlacing. Nobody looks at a mock thumbnail closely
 * enough for Adam7, and a simple encoder is a testable one.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ (buffer[index] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = u32be(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return concat(length, typed, u32be(crc32(typed)));
}

export interface PngOptions {
  width: number;
  height: number;
  /** RGB, three bytes per pixel. Defaults to a flat fill. */
  rgb?: readonly [number, number, number];
}

export interface PngResult {
  bytes: Buffer;
  width: number;
  height: number;
}

/** Encodes a flat-colour RGB PNG. Enough for a thumbnail, and fully valid. */
export function writePng(options: PngOptions): PngResult {
  const { width, height } = options;
  const rgb = options.rgb ?? [235, 122, 95];

  if (width < 1 || height < 1) {
    throw new Error(`PNG dimensions must be positive, got ${width}x${height}`);
  }
  if (Number.isInteger(width) === false || Number.isInteger(height) === false) {
    throw new Error(`PNG dimensions must be integers, got ${width}x${height}`);
  }

  // One filter byte per scanline, then the raw RGB triplets.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = rgb[0];
      raw[pixel + 1] = rgb[1];
      raw[pixel + 2] = rgb[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const bytes = concat(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  );

  return { bytes, width, height };
}

/** Reads back the IHDR, so a test can prove the dimensions survived. */
export function readPngHeader(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.subarray(0, 8).equals(signature) === false) {
    throw new Error('not a PNG: bad signature');
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG: first chunk is not IHDR');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
