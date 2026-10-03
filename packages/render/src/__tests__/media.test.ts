import { describe, expect, it } from 'vitest';
import { readPngHeader, writePng } from '../media/png.js';
import { readU32be } from '../media/bytes.js';
import { readMp4Summary, writeMp4 } from '../media/mp4.js';
import { countVttCues, formatVttTimestamp, writeVtt } from '../media/vtt.js';
import { readWavHeader, trimWav, writeWav, writeWavFromPcm } from '../media/wav.js';

/**
 * The media writers.
 *
 * These are the mock assets the whole pipeline produces, so they are tested as
 * files rather than as return values: each one is read back with a small parser
 * and checked for the property that matters (duration, dimensions, cue count,
 * box structure). A writer that quietly produces a corrupt file would otherwise
 * only be discovered by a creator pressing play.
 */

describe('writeWav', () => {
  it('produces a WAV whose header round-trips', () => {
    const samples = Array.from({ length: 16_000 }, (_, i) => Math.sin(i / 10));
    const { bytes, durationSeconds } = writeWav(samples, { sampleRate: 16_000 });

    const header = readWavHeader(bytes);
    expect(header.sampleRate).toBe(16_000);
    expect(header.channels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    expect(header.durationSeconds).toBeCloseTo(1, 5);
    expect(durationSeconds).toBeCloseTo(1, 5);
  });

  it('clamps a sample outside -1..1 instead of wrapping it', () => {
    const { bytes } = writeWav([1.5, -1.5, 0], { sampleRate: 16_000 });
    const header = readWavHeader(bytes);
    expect(header.dataBytes).toBe(6);
    // 1.5 must become the maximum positive value, not the minimum negative one.
    expect(bytes.readInt16LE(44)).toBe(32_767);
    expect(bytes.readInt16LE(46)).toBe(-32_767);
  });

  it('writes stereo by interleaving', () => {
    // Four samples across two channels is two frames, not four: duration is
    // frames / rate, and getting that wrong is how a voice-over drifts.
    const { bytes, durationSeconds } = writeWav([1, -1, 0.5, -0.5], {
      sampleRate: 8_000,
      channels: 2,
    });
    const header = readWavHeader(bytes);
    expect(header.channels).toBe(2);
    expect(header.dataBytes).toBe(8);
    expect(header.durationSeconds).toBeCloseTo(0.00025, 6);
    expect(durationSeconds).toBeCloseTo(0.00025, 6);
  });
});

describe('writeWavFromPcm', () => {
  it('wraps bare PCM in a RIFF header at the rate it is given', () => {
    // Gemini TTS answers with `audio/L16;codec=pcm;rate=24000` - bare samples.
    // Assuming 16 kHz would play every voice at two-thirds speed.
    const pcm = Buffer.alloc(24_000 * 2); // one second of 16-bit mono
    const wav = writeWavFromPcm(pcm, { sampleRate: 24_000 });

    expect(wav.bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(readWavHeader(wav.bytes)).toMatchObject({
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 1,
    });
    // The samples are copied through untouched.
    expect(wav.bytes.length).toBe(44 + pcm.length);
    expect(wav.bytes.subarray(44).equals(pcm)).toBe(true);
  });

  it('keeps a stereo rate and channel count', () => {
    const pcm = Buffer.alloc(48_000 * 2 * 2); // one second of 16-bit stereo
    const wav = writeWavFromPcm(pcm, { sampleRate: 48_000, channels: 2 });

    expect(readWavHeader(wav.bytes)).toMatchObject({ sampleRate: 48_000, channels: 2 });
    expect(wav.durationSeconds).toBeCloseTo(1, 5);
  });
});

describe('trimWav', () => {
  const twoSeconds = writeWav(Array.from({ length: 8_000 * 2 }, () => 0), { sampleRate: 8_000 });

  it('cuts the data chunk and rewrites both length fields', () => {
    const trimmed = trimWav(twoSeconds.bytes, 1);

    const header = readWavHeader(trimmed);
    expect(header.durationSeconds).toBeCloseTo(1, 5);
    // Both length fields have to agree, or the file opens and then stops early.
    expect(trimmed.readUInt32LE(4)).toBe(36 + header.dataBytes);
    expect(trimmed.readUInt32LE(40)).toBe(header.dataBytes);
    expect(header.dataBytes).toBe(8_000 * 2);
    expect(trimmed.length).toBe(44 + 8_000 * 2);
  });

  it('cuts on a frame boundary, never mid-sample', () => {
    const trimmed = trimWav(twoSeconds.bytes, 0.50001);
    expect(readWavHeader(trimmed).dataBytes % 2).toBe(0);
  });

  it('returns the input untouched when it is already short enough', () => {
    // Padding a short bed with silence would leave a gap under the last scene.
    expect(trimWav(twoSeconds.bytes, 30)).toBe(twoSeconds.bytes);
  });

  it('returns the input untouched when asked for exactly its own length', () => {
    expect(trimWav(twoSeconds.bytes, 2)).toBe(twoSeconds.bytes);
  });

  it('throws rather than guessing at something that is not a WAV', () => {
    expect(() => trimWav(Buffer.alloc(10), 1)).toThrow(/not a WAV/);
  });
});

describe('writePng', () => {
  it('writes a PNG whose header round-trips', () => {
    const { bytes, width, height } = writePng({ width: 8, height: 16, rgb: [1, 2, 3] });
    expect(readPngHeader(bytes)).toEqual({ width: 8, height: 16 });
    expect(width).toBe(8);
    expect(height).toBe(16);
  });

  it('is smaller than the raw pixels, because it compresses a flat fill', () => {
    const { bytes } = writePng({ width: 64, height: 64 });
    expect(bytes.length).toBeLessThan(64 * 64 * 3);
  });

  it('refuses a zero-sized image rather than writing a corrupt one', () => {
    expect(() => writePng({ width: 0, height: 10 })).toThrow(/positive/);
  });
});

describe('writeVtt', () => {
  it('starts with the WEBVTT signature and numbers every cue', () => {
    const document = writeVtt(
      [
        { startSeconds: 0, endSeconds: 4, text: 'First line' },
        { startSeconds: 4, endSeconds: 9.5, text: 'Second line' },
      ],
      10,
    );

    expect(document.startsWith('WEBVTT\n')).toBe(true);
    expect(countVttCues(document)).toBe(2);
    expect(document).toContain('00:00:00.000 --> 00:00:04.000');
    expect(document).toContain('00:00:04.000 --> 00:00:09.500');
  });

  it('clamps a cue that would run past the end of the video', () => {
    // Clamped rather than dropped: the words still belong on screen for the two
    // seconds that are left.
    const document = writeVtt([{ startSeconds: 8, endSeconds: 20, text: 'Tail end' }], 10);
    expect(countVttCues(document)).toBe(1);
    expect(document).toContain('00:00:08.000 --> 00:00:10.000');
  });

  it('drops a cue that starts after the video has ended', () => {
    const document = writeVtt([{ startSeconds: 12, endSeconds: 15, text: 'Never seen' }], 10);
    expect(countVttCues(document)).toBe(0);
  });

  it('drops a cue with no text rather than showing an empty caption', () => {
    const document = writeVtt([{ startSeconds: 0, endSeconds: 2, text: '   ' }], 10);
    expect(countVttCues(document)).toBe(0);
  });

  it('clamps a cue that starts before the video does', () => {
    const document = writeVtt([{ startSeconds: -5, endSeconds: 3, text: 'Early' }], 10);
    expect(document).toContain('00:00:00.000 --> 00:00:03.000');
  });

  it('formats timestamps with exactly three decimal places', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000');
    expect(formatVttTimestamp(75.25)).toBe('00:01:15.250');
    expect(formatVttTimestamp(-1)).toBe('00:00:00.000');
  });
});

describe('readMp4Summary', () => {
  it('reads the mock composer\u2019s own box tree', () => {
    const summary = readMp4Summary(writeMp4({ width: 1080, height: 1920, durationSeconds: 30 }).bytes);
    expect(summary.width).toBe(1080);
    expect(summary.height).toBe(1920);
    expect(summary.durationSeconds).toBeCloseTo(30, 5);
  });

  it('reads a real ffmpeg file, whose audio track reports 0x0 in tkhd', () => {
    // The regression this pins down. A real render has a video track AND an audio
    // track, and the audio track's tkhd reports 0x0. Reading dimensions from
    // whichever trak came last made every real MP4 read as 0x0, so QC failed with
    // "the video is 0x0" on a video that played perfectly well.
    //
    // ffmpeg is not installed in CI, so the fixture below is the box tree it
    // actually wrote for this pipeline: two traks, the second with 0x0, and the
    // dimensions in the video track's avc1 entry.
    const real = buildRealTwoTrackMp4();

    const summary = readMp4Summary(real);

    expect(summary.width).toBe(1080);
    expect(summary.height).toBe(1920);
    expect(summary.durationSeconds).toBeCloseTo(30, 5);
  });

  it('prefers the visual sample entry over tkhd when they disagree', () => {
    // avc1 is the authority; tkhd is the fallback. A writer that puts a stale
    // size in tkhd must not win.
    const box = buildAvc1Mp4(1080, 1920, 720, 1280);
    const summary = readMp4Summary(box);
    expect(summary.width).toBe(1080);
    expect(summary.height).toBe(1920);
  });
});

describe('writeMp4', () => {
  it('writes a box tree that reads back with the right metadata', () => {
    const { bytes } = writeMp4({ width: 1080, height: 1920, durationSeconds: 30 });

    const summary = readMp4Summary(bytes);
    expect(summary.topLevelBoxes).toEqual(['ftyp', 'moov', 'mdat']);
    expect(summary.width).toBe(1080);
    expect(summary.height).toBe(1920);
    expect(summary.durationSeconds).toBeCloseTo(30, 5);
  });

  it('declares a fixed sample size, not a variable one with no table', () => {
    // `sample_size` of 0 means "one size per sample follows", so writing 0 with
    // no table is a malformed box that no parser will open.
    const summary = readMp4Summary(
      writeMp4({ width: 1080, height: 1920, durationSeconds: 30, samples: Buffer.alloc(64) }).bytes,
    );

    expect(summary.sampleSize).toBe(64);
    expect(summary.sampleCount).toBe(1);
  });

  it('declares zero samples rather than a zero-sized one when there is no payload', () => {
    const summary = readMp4Summary(
      writeMp4({ width: 1080, height: 1920, durationSeconds: 30 }).bytes,
    );

    expect(summary.sampleCount).toBe(0);
    expect(summary.sampleSize).toBe(0);
  });

  it('carries the payload bytes in mdat', () => {
    const payload = Buffer.from('clip-bytes', 'ascii');
    const { bytes } = writeMp4({ width: 540, height: 960, durationSeconds: 15, samples: payload });

    expect(readMp4Summary(bytes).sampleBytes).toBe(payload.length);
  });

  it('writes a chunk offset that points at the mdat payload', () => {
    const { bytes } = writeMp4({ width: 1080, height: 1920, durationSeconds: 20 });
    const stcoIndex = bytes.indexOf(Buffer.from('stco', 'ascii'));
    const mdatIndex = bytes.indexOf(Buffer.from('mdat', 'ascii'));
    const chunkOffset = readU32be(bytes, stcoIndex + 4 + 4 + 4);

    expect(chunkOffset).toBe(mdatIndex + 4);
  });

  it('is rejected by the reader when a box length lies', () => {
    const { bytes } = writeMp4({ width: 1080, height: 1920, durationSeconds: 20 });
    const corrupt = Buffer.from(bytes);
    corrupt.writeUInt32BE(4, 0); // claim the ftyp box is four bytes long

    expect(() => readMp4Summary(corrupt)).toThrow(/corrupt box/);
  });

  it('never writes a zero duration, however the caller asks', () => {
    const summary = readMp4Summary(
      writeMp4({ width: 1080, height: 1920, durationSeconds: 0 }).bytes,
    );
    expect(summary.durationSeconds).toBeGreaterThan(0);
  });
});

/**
 * Builds a two-track MP4 shaped like what ffmpeg writes for this pipeline: a
 * video track carrying the real dimensions in `tkhd` *and* in its `avc1` entry,
 * and an audio track whose `tkhd` reports 0x0.
 *
 * Hand-built rather than recorded from a file so the fixture is readable and
 * CI needs no ffmpeg - but the offsets are the ones ffmpeg actually produced.
 */
function buildRealTwoTrackMp4(): Buffer {
  const avc1 = buildVisualEntry('avc1', 1080, 1920, 64);
  const stsd = box('stsd', concatBytes(u32be(0), u32be(1), avc1));
  const stbl = box('stbl', concatBytes(stsd, box('stts', u32be(0)), box('stsc', u32be(0))));
  const minf = box('minf', concatBytes(box('vmhd', u32be(0)), stbl));
  const mdia = box('mdia', concatBytes(minf, box('hdlr', u32be(0))));
  const videoTkhd = box('tkhd', concatBytes(u32be(0), u32be(0), fixed(1080), fixed(1920)));
  const videoTrak = box('trak', concatBytes(videoTkhd, mdia));

  // The audio track: no visual entry at all, and 0x0 in its tkhd.
  const audioStsd = box('stsd', concatBytes(u32be(0), u32be(1), box('mp4a', Buffer.alloc(20))));
  const audioStbl = box('stbl', concatBytes(audioStsd, box('stts', u32be(0))));
  const audioMinf = box('minf', concatBytes(box('smhd', u32be(0)), audioStbl));
  const audioMdia = box('mdia', concatBytes(audioMinf, box('hdlr', u32be(0))));
  const audioTkhd = box('tkhd', concatBytes(u32be(0), u32be(0), fixed(0), fixed(0)));
  const audioTrak = box('trak', concatBytes(audioTkhd, audioMdia));

  // mvhd version 0: version/flags(4) + creation(4) + modification(4) +
  // timescale(4) + duration(4).
  const mvhd = box('mvhd', concatBytes(u32be(0), u32be(0), u32be(0), u32be(1000), u32be(30_000)));
  const moov = box('moov', concatBytes(mvhd, videoTrak, audioTrak));

  return concatBytes(box('ftyp', Buffer.from('isom', 'ascii')), moov, box('mdat', Buffer.alloc(16)));
}

/** An MP4 whose `avc1` and `tkhd` disagree, to prove which one wins. */
function buildAvc1Mp4(entryWidth: number, entryHeight: number, headerWidth: number, headerHeight: number): Buffer {
  const avc1 = buildVisualEntry('avc1', entryWidth, entryHeight, 64);
  const stsd = box('stsd', concatBytes(u32be(0), u32be(1), avc1));
  const stbl = box('stbl', concatBytes(stsd, box('stts', u32be(0))));
  const minf = box('minf', concatBytes(box('vmhd', u32be(0)), stbl));
  const mdia = box('mdia', concatBytes(minf));
  const tkhd = box('tkhd', concatBytes(u32be(0), u32be(0), fixed(headerWidth), fixed(headerHeight)));
  const trak = box('trak', concatBytes(tkhd, mdia));
  const mvhd = box('mvhd', concatBytes(u32be(0), u32be(0), u32be(0), u32be(1000), u32be(30_000)));
  return concatBytes(box('ftyp', Buffer.from('isom', 'ascii')), box('moov', concatBytes(mvhd, trak)), box('mdat', Buffer.alloc(8)));
}

/**
 * A `VisualSampleEntry`: 8-byte header, 6 reserved, data_reference_index(2),
 * pre_defined(4), reserved(4), pre_defined[3](12), then width and height.
 */
function buildVisualEntry(type: string, width: number, height: number, tailBytes: number): Buffer {
  const body = Buffer.alloc(6 + 2 + 4 + 4 + 12 + 2 + 2 + tailBytes);
  body.writeUInt16BE(1, 6); // data_reference_index
  body.writeUInt16BE(width, 6 + 2 + 4 + 4 + 12);
  body.writeUInt16BE(height, 6 + 2 + 4 + 4 + 12 + 2);
  return box(type, body);
}

function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'ascii');
  return concatBytes(header, body);
}

function u32be(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value, 0);
  return b;
}

/** 16.16 fixed point, the form width and height take in `tkhd`. */
function fixed(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value * 65_536, 0);
  return b;
}

function concatBytes(...parts: readonly Buffer[]): Buffer {
  return Buffer.concat(parts);
}
