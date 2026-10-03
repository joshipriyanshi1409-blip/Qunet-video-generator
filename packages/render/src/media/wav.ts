import { concat, u16le, u32le } from './bytes.js';

/**
 * A real 16-bit PCM WAV writer.
 *
 * The mock voice-over and the mock music track are WAVs rather than placeholders
 * on purpose: they are genuinely playable, they are byte-exact (so a test can
 * assert on them), and a downstream composer can read them without sniffing.
 * 44 bytes of header is a small price for an asset that is actually a file.
 */
export interface WavOptions {
  /** Samples per second. 16 kHz matches the voice-coach pipeline's rate. */
  sampleRate?: number;
  channels?: number;
  /** Bits per sample. 16 is what the coach records and what TTS returns. */
  bitsPerSample?: number;
}

export interface WavResult {
  bytes: Buffer;
  /** Seconds of audio, derived from the sample count rather than trusted. */
  durationSeconds: number;
  sampleCount: number;
}

/** Encodes mono/stereo float samples in -1..1 as a 16-bit PCM WAV. */
export function writeWav(samples: readonly number[], options: WavOptions = {}): WavResult {
  const sampleRate = options.sampleRate ?? 16_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const bytesPerSample = bitsPerSample / 8;

  if (Number.isInteger(bytesPerSample) === false || bytesPerSample < 1) {
    throw new Error(`bitsPerSample must be a multiple of 8, got ${bitsPerSample}`);
  }

  // Interleave, clamping each sample: a float a hair outside -1..1 must wrap or
  // click, never silently become a louder value than the format can hold.
  const frames = Math.ceil(samples.length / channels);
  const data = Buffer.alloc(frames * channels * bytesPerSample);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.min(1, Math.max(-1, samples[index] ?? 0));
    // Symmetric scaling, not `clamped * 32768`: that maps 1.0 to an overflow.
    const quantised = Math.round(clamped * 32_767);
    data.writeInt16LE(quantised, index * bytesPerSample);
  }

  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;

  const header = concat(
    Buffer.from('RIFF', 'ascii'),
    u32le(36 + data.length),
    Buffer.from('WAVE', 'ascii'),
    Buffer.from('fmt ', 'ascii'),
    u32le(16),
    u16le(1), // PCM
    u16le(channels),
    u32le(sampleRate),
    u32le(byteRate),
    u16le(blockAlign),
    u16le(bitsPerSample),
    Buffer.from('data', 'ascii'),
    u32le(data.length),
  );

  return {
    bytes: concat(header, data),
    durationSeconds: frames / sampleRate,
    sampleCount: frames,
  };
}

/**
 * Reads the header back.
 *
 * Not a general WAV parser - it exists so a test can prove the writer produced
 * the duration and sample rate it was asked for, rather than trusting that the
 * arithmetic was right.
 */
export function readWavHeader(bytes: Buffer): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
} {
  if (bytes.length < 44) throw new Error('not a WAV file: too short');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a WAV file: missing RIFF');
  if (bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file: missing WAVE');

  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitsPerSample = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  const frames = dataBytes / (channels * (bitsPerSample / 8));

  return { sampleRate, channels, bitsPerSample, dataBytes, durationSeconds: frames / sampleRate };
}

/**
 * Wraps raw PCM in a RIFF/WAVE header.
 *
 * Gemini TTS answers with `inlineData` whose `mimeType` is
 * `audio/L16;codec=pcm;rate=24000` - bare little-endian samples, no container.
 * Everything downstream of the voice stage (`compose`, QC, the `<audio>` in the
 * UI) expects a file it can identify by its first four bytes, so the header is
 * added here rather than being guessed at later.
 *
 * The sample rate and channel count come from the *response*, not from this
 * function: they are whatever the model said it produced, and a mismatch would
 * play the voice at the wrong speed.
 */
export function writeWavFromPcm(
  pcm: Buffer,
  options: { sampleRate: number; channels?: number; bitsPerSample?: number },
): WavResult {
  // Reassigned below to the frame-aligned prefix, so it is not `const`.
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;

  // Truncate to whole frames. `readWavHeader` divides `dataBytes` by
  // `blockAlign`, so a chunk that is a byte or two short of a frame would make
  // the header claim a fractional duration - and a player would report a runtime
  // the file does not have. A model that returns whole samples never hits this;
  // a truncated response does, and then the file is still honest.
  const frames = Math.floor(pcm.length / blockAlign);
  pcm = pcm.subarray(0, frames * blockAlign);

  const header = concat(
    Buffer.from('RIFF', 'ascii'),
    u32le(36 + pcm.length),
    Buffer.from('WAVE', 'ascii'),
    Buffer.from('fmt ', 'ascii'),
    u32le(16),
    u16le(1), // PCM
    u16le(channels),
    u32le(options.sampleRate),
    u32le(options.sampleRate * blockAlign),
    u16le(blockAlign),
    u16le(bitsPerSample),
    Buffer.from('data', 'ascii'),
    u32le(pcm.length),
  );

  return {
    bytes: concat(header, pcm),
    durationSeconds: frames / options.sampleRate,
    sampleCount: frames,
  };
}

/**
 * Cuts a WAV to `seconds`, losslessly.
 *
 * The music stage needs this because Lyria returns a fixed-length track and the
 * storyboard asks for a specific runtime. Cutting the `data` chunk and fixing
 * the two length fields is exact: no resampling, no re-quantisation, and the
 * output still opens in any player. Anything longer than the file is returned
 * unchanged rather than padded with silence, so a short bed stays short and QC
 * can see it.
 */
export function trimWav(bytes: Buffer, seconds: number): Buffer {
  const header = readWavHeader(bytes);
  const blockAlign = header.channels * (header.bitsPerSample / 8);
  const keepFrames = Math.min(header.dataBytes / blockAlign, Math.floor(seconds * header.sampleRate));
  const keepBytes = Math.max(0, Math.floor(keepFrames) * blockAlign);

  if (keepBytes === header.dataBytes) return bytes;

  // Rebuild the header rather than patching in place: `RIFF` size is a u32 at
  // offset 4 and `data` size is a u32 at offset 40, and getting either wrong
  // produces a file that opens and then stops early.
  const rebuilt = Buffer.from(bytes);
  rebuilt.writeUInt32LE(36 + keepBytes, 4);
  rebuilt.writeUInt32LE(keepBytes, 40);
  return rebuilt.subarray(0, 44 + keepBytes);
}
