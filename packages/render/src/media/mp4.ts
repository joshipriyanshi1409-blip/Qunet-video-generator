import { box, concat, fourcc, fullBox, readU32be, u16be, u32be } from './bytes.js';

/**
 * A minimal but structurally complete MP4 (ISO-BMFF) writer.
 *
 * **What this is, and what it is not.** It writes a valid box tree - `ftyp`,
 * `moov` with a video track carrying the right duration, dimensions and sample
 * table, and an `mdat` holding the bytes - so the file parses, has correct
 * metadata, and can be probed. It does **not** encode video: there is no H.264
 * encoder here, and pretending otherwise would be a lie.
 *
 * That is the right trade for the mock path. The `Composer` interface
 * (`composers.ts`) is the seam: when `ffmpeg` or Remotion is available the real
 * composer writes a decodable file, and this writer is what stands in when they
 * are not. Both produce a file the job document can point a URL at.
 */

/** 16.16 fixed-point, the form every MP4 rate and resolution field uses. */
function fixed16_16(value: number): Buffer {
  return u32be(Math.round(value * 65_536));
}

/** 32-bit seconds since 1904, the MP4 epoch. */
function mp4Epoch(seconds: number): Buffer {
  return u32be(Math.round(seconds) + 2_082_844_800);
}

/** The unity matrix every track declares, so players do not scale it oddly. */
const UNITY_MATRIX = concat(
  u32be(0x00010000),
  u32be(0),
  u32be(0),
  u32be(0),
  u32be(0x00010000),
  u32be(0),
  u32be(0),
  u32be(0),
  u32be(0x40000000),
);

/** Language 'und' packed the way `mdhd` wants it. */
const UND_LANGUAGE = u16be(0x55c4);

export interface Mp4TrackOptions {
  /** Display width in pixels. */
  width: number;
  /** Display height in pixels. */
  height: number;
  /** Seconds the track lasts. */
  durationSeconds: number;
  /** Clock ticks per second for this track. */
  timescale?: number;
}

export interface Mp4Result {
  bytes: Buffer;
  width: number;
  height: number;
  durationSeconds: number;
  /** Bytes of payload handed to `mdat`. */
  sampleBytes: number;
}

/** Assembles an MP4 with one video track around the given payload bytes. */
export function writeMp4(options: Mp4TrackOptions & { samples?: Buffer }): Mp4Result {
  const timescale = options.timescale ?? 1_000;
  const duration = Math.max(1, Math.round(options.durationSeconds * timescale));
  const samples = options.samples ?? Buffer.alloc(0);
  const sampleCount = samples.length === 0 ? 0 : 1;
  const sampleDuration = duration;

  const ftyp = box(
    'ftyp',
    fourcc('isom'),
    u32be(0),
    fourcc('isom'),
    fourcc('iso2'),
    fourcc('mp41'),
  );

  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    mp4Epoch(0), // creation
    mp4Epoch(0), // modification
    u32be(timescale),
    u32be(duration),
    fixed16_16(1), // rate
    fixed16_16(1), // volume, as a 16.16 (players read the low half)
    u32be(0),
    u32be(0),
    UNITY_MATRIX,
    u32be(0), // pre_defined[6]
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(2), // next_track_ID
  );

  const tkhd = fullBox(
    'tkhd',
    0,
    3, // enabled + in movie
    mp4Epoch(0),
    mp4Epoch(0),
    u32be(1), // track id
    u32be(0), // reserved
    u32be(duration),
    u32be(0),
    u32be(0),
    u16be(0), // layer
    u16be(0), // alternate group
    u16be(0), // volume: a video track is silent
    u16be(0),
    UNITY_MATRIX,
    fixed16_16(options.width),
    fixed16_16(options.height),
  );

  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    mp4Epoch(0),
    mp4Epoch(0),
    u32be(timescale),
    u32be(duration),
    UND_LANGUAGE,
    u16be(0), // pre_defined
  );

  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    u32be(0), // pre_defined
    fourcc('vide'),
    u32be(0),
    u32be(0),
    u32be(0),
    Buffer.from('VideoHandler\0', 'ascii'),
  );

  const vmhd = fullBox('vmhd', 0, 1, u16be(0), u16be(0), u16be(0), u16be(0));

  // `url` with flag 1 means "the data is in this file", which is what an mdat is.
  const dref = fullBox('dref', 0, 0, u32be(1), fullBox('url ', 0, 1));

  const compressor = Buffer.from('CreatorDNA\0', 'ascii');
  const compressorName = Buffer.alloc(32);
  compressor.copy(compressorName, 0, 0, Math.min(compressor.length, 32));
  const visualEntry = concat(
    Buffer.alloc(6), // reserved
    u16be(1), // data_reference_index
    u16be(0), // pre_defined
    u16be(0), // reserved
    u32be(0),
    u32be(0),
    u32be(0), // pre_defined[3]
    u16be(options.width),
    u16be(options.height),
    fixed16_16(72), // horizontal resolution
    fixed16_16(72), // vertical resolution
    u32be(0), // reserved
    u16be(1), // frame count
    compressorName,
    u16be(24), // depth
    u16be(0xffff), // pre_defined
  );
  const stsd = fullBox('stsd', 0, 0, u32be(1), box('mp4v', visualEntry));

  const stts = fullBox('stts', 0, 0, u32be(1), u32be(sampleCount), u32be(sampleDuration));
  const stsc = fullBox('stsc', 0, 0, u32be(1), u32be(1), u32be(sampleCount), u32be(1));
  // `sample_size` is the actual byte length of the one sample, and
  // `sample_count` is 1. Declaring `sample_size = 0` would mean "sizes follow,
  // one per sample", which would need `sample_count` entries after it - a
  // mismatch that makes the whole box tree unparseable.
  const stsz =
    sampleCount === 0
      ? fullBox('stsz', 0, 0, u32be(0), u32be(0))
      : fullBox('stsz', 0, 0, u32be(samples.length), u32be(sampleCount));
  const stco = fullBox('stco', 0, 0, u32be(1), u32be(0)); // patched below

  const moov = box(
    'moov',
    mvhd,
    box(
      'trak',
      tkhd,
      box('mdia', mdhd, hdlr, box('minf', vmhd, box('dinf', dref), box('stbl', stsd, stts, stsc, stsz, stco))),
    ),
  );

  const header = concat(ftyp, moov);
  // The chunk offset is where `mdat`'s payload lands: after every header byte
  // plus the eight-byte mdat box header. Only known once the header is counted.
  const patched = patchChunkOffset(header, header.length + 8);
  const mdat = box('mdat', samples);

  return {
    bytes: concat(patched, mdat),
    width: options.width,
    height: options.height,
    durationSeconds: options.durationSeconds,
    sampleBytes: samples.length,
  };
}

/** Rewrites the single `stco` entry to point at `mdat`'s payload. */
function patchChunkOffset(header: Buffer, payloadOffset: number): Buffer {
  const patched = Buffer.from(header);
  const stcoIndex = patched.indexOf(Buffer.from('stco', 'ascii'));
  if (stcoIndex < 0) throw new Error('stco box not found');
  // version+flags (4) + entry_count (4) then the first chunk offset.
  patched.writeUInt32BE(payloadOffset, stcoIndex + 4 + 4 + 4);
  return patched;
}

/**
 * Walks the box tree just far enough to read back what was written.
 *
 * This is the test's proof that the container is sound: a writer that gets a
 * length field wrong produces a file that no parser will open, and reading it
 * back here catches that without needing ffmpeg.
 */
export interface Mp4Summary {
  width: number;
  height: number;
  durationSeconds: number;
  timescale: number;
  sampleBytes: number;
  /** Declared size of the single sample, 0 when there are no samples. */
  sampleSize: number;
  sampleCount: number;
  topLevelBoxes: string[];
}

export function readMp4Summary(bytes: Buffer): Mp4Summary {
  const topLevelBoxes: string[] = [];
  let offset = 0;

  let timescale = 0;
  let duration = 0;
  let width = 0;
  let height = 0;
  let sampleBytes = 0;

  while (offset + 8 <= bytes.length) {
    const size = readU32be(bytes, offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size < 8 || offset + size > bytes.length) {
      throw new Error(`corrupt box at ${offset}: size ${size}`);
    }
    topLevelBoxes.push(type);

    if (type === 'moov') {
      const parsed = readMoov(bytes.subarray(offset + 8, offset + size));
      timescale = parsed.timescale;
      duration = parsed.duration;
      width = parsed.width;
      height = parsed.height;
    }
    if (type === 'mdat') {
      sampleBytes = size - 8;
    }
    offset += size;
  }

  const stsz = readStsz(bytes);
  return {
    width,
    height,
    durationSeconds: timescale === 0 ? 0 : duration / timescale,
    timescale,
    sampleBytes,
    sampleSize: stsz.sampleSize,
    sampleCount: stsz.sampleCount,
    topLevelBoxes,
  };
}

/**
 * Reads the `stsz` box back.
 *
 * `sample_size` of 0 means "the sizes follow, one per sample", so the reader has
 * to honour that or it would read the count field as a size. This is the check
 * that catches a writer declaring a variable sample size without writing the
 * table - which is exactly the bug it was added for.
 */
function readStsz(bytes: Buffer): { sampleSize: number; sampleCount: number } {
  const index = bytes.indexOf(Buffer.from('stsz', 'ascii'));
  if (index < 0) return { sampleSize: 0, sampleCount: 0 };
  // box header(8) + version/flags(4), then sample_size and sample_count.
  return {
    sampleSize: readU32be(bytes, index + 4 + 4),
    sampleCount: readU32be(bytes, index + 4 + 4 + 4),
  };
}

/**
 * Iterates the direct child boxes of a container box.
 *
 * `body` is the box's contents, i.e. everything after its 8-byte header, so a
 * child's own header starts at offset 0 of what it is handed.
 */
function eachBox(body: Buffer, visit: (type: string, child: Buffer) => void): void {
  let offset = 0;
  while (offset + 8 <= body.length) {
    const size = readU32be(body, offset);
    const type = body.toString('ascii', offset + 4, offset + 8);
    if (size < 8 || offset + size > body.length) break;
    visit(type, body.subarray(offset + 8, offset + size));
    offset += size;
  }
}

/** The visual sample entry types that carry a width and a height. */
const VISUAL_ENTRIES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'mp4v', 'vp09', 'av01']);

/**
 * Reads a track's frame size.
 *
 * The **visual sample entry** is the authority: `moov > trak > mdia > minf >
 * stbl > stsd > avc1`, where width and height sit after the fixed
 * `VisualSampleEntry` preamble. `tkhd` also carries them, but it is the fallback,
 * not the source - and a track that has no video reports 0x0 there.
 */
function readTrackSize(trak: Buffer): { width: number; height: number } {
  let fromEntry = { width: 0, height: 0 };
  let fromHeader = { width: 0, height: 0 };
  let entrySeen = false;

  eachBox(trak, (type, body) => {
    if (type === 'tkhd') {
      // width and height are the last two 16.16 fixed-point fields.
      fromHeader = {
        width: body.readUInt32BE(body.length - 8) >>> 16,
        height: body.readUInt32BE(body.length - 4) >>> 16,
      };
    }

    if (type === 'mdia') {
      eachBox(body, (mdiaType, mdiaBody) => {
        if (mdiaType !== 'minf') return;
        eachBox(mdiaBody, (minfType, minfBody) => {
          if (minfType !== 'stbl') return;
          eachBox(minfBody, (stblType, stblBody) => {
            if (stblType !== 'stsd' || entrySeen) return;
            // stsd is a full box: version/flags(4) + entry_count(4), then the
            // entries. `stblBody` already skipped the box header.
            const entries = stblBody.subarray(8);
            eachBox(entries, (entryType, entryBody) => {
              if (VISUAL_ENTRIES.has(entryType) === false || entrySeen) return;
              // 6 reserved + data_reference_index(2) + pre_defined(4) +
              // reserved(4) + pre_defined[3](12) = 28, then width, then height.
              fromEntry = {
                width: entryBody.readUInt16BE(28),
                height: entryBody.readUInt16BE(30),
              };
              entrySeen = true;
            });
          });
        });
      });
    }
  });

  return fromEntry.width > 0 && fromEntry.height > 0 ? fromEntry : fromHeader;
}

function readMoov(moov: Buffer): {
  timescale: number;
  duration: number;
  width: number;
  height: number;
} {
  let timescale = 0;
  let duration = 0;
  let width = 0;
  let height = 0;

  eachBox(moov, (type, body) => {
    if (type === 'mvhd') {
      // A full box, so version/flags come first. Version 1 widens creation,
      // modification and duration to 64 bits - ffmpeg writes version 0 today,
      // but a version 1 movie header would otherwise be read as garbage.
      const version = body[0];
      const isV1 = version === 1;
      const fields = 4 + (isV1 ? 8 + 8 : 4 + 4);
      timescale = readU32be(body, fields);
      duration = isV1 ? Number(body.readBigUInt64BE(fields + 4)) : readU32be(body, fields + 4);
    }

    if (type === 'trak') {
      const size = readTrackSize(body);
      // A track with no video reports 0x0, and letting it overwrite the video
      // track's size would make every real MP4 read as 0x0 - which is exactly
      // what it did, because a render has both a video and an audio track.
      if (size.width > 0 && size.height > 0) {
        width = size.width;
        height = size.height;
      }
    }
  });

  return { timescale, duration, width, height };
}
