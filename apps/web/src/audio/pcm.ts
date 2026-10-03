import { LIVE_AUDIO_FORMAT } from '@creatordna/shared';

/**
 * Pure PCM helpers for the Live Voice Coach.
 *
 * Kept free of the Web Audio API on purpose: resampling and 16-bit packing are
 * the parts that decide whether the coach hears anything at all, so they are
 * unit-testable without a microphone, an AudioContext or a browser.
 *
 * The format is fixed by the shared contract (`LIVE_AUDIO_FORMAT`): mono,
 * 16 kHz, signed 16-bit little-endian PCM, which is what the Live API documents
 * for realtime audio input.
 */

/** The sample rate every coaching session runs at, whatever the mic runs at. */
export const PCM_TARGET_SAMPLE_RATE = LIVE_AUDIO_FORMAT.sampleRate;

/** Full-scale value for signed 16-bit PCM. */
const PCM_PEAK = 32_767;

/**
 * Resamples mono float audio to 16 kHz.
 *
 * Linear interpolation, with one sample of history carried across frames so a
 * frame boundary never produces a click. Good enough for speech: the whole
 * band above 8 kHz is discarded anyway.
 *
 * The input buffer is trimmed after every frame, so memory stays flat over a
 * five-minute session instead of growing with the take.
 */
export class PcmResampler {
  private samples: number[] = [];
  private readIndex = 0;

  constructor(
    private readonly inputSampleRate: number,
    private readonly targetSampleRate: number = PCM_TARGET_SAMPLE_RATE,
  ) {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new RangeError(`inputSampleRate must be positive, got ${String(inputSampleRate)}`);
    }
    if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
      throw new RangeError(`targetSampleRate must be positive, got ${String(targetSampleRate)}`);
    }
  }

  /** Input samples consumed per output sample produced. */
  get ratio(): number {
    return this.inputSampleRate / this.targetSampleRate;
  }

  /** Output samples produced by `frame.length` input samples. */
  get outputLength(): number {
    return Math.max(0, Math.floor(this.samples.length / this.ratio));
  }

  /** Adds one frame of input and returns the 16 kHz samples it completed. */
  process(frame: Float32Array): Float32Array {
    for (let index = 0; index < frame.length; index += 1) {
      this.samples.push(frame[index] ?? 0);
    }

    const ratio = this.ratio;
    const output: number[] = [];

    // The upper neighbour is clamped to the last sample, so a frame is drained
    // exactly rather than losing a sample of output at every boundary. Without
    // this an upsampling microphone drifts audibly over a long take.
    while (this.readIndex < this.samples.length) {
      const base = Math.floor(this.readIndex);
      const fraction = this.readIndex - base;
      const from = this.samples[base] ?? 0;
      const to = this.samples[Math.min(base + 1, this.samples.length - 1)] ?? 0;
      output.push(from + (to - from) * fraction);
      this.readIndex += ratio;
    }

    const consumed = Math.floor(this.readIndex);
    if (consumed > 1) {
      this.samples = this.samples.slice(consumed - 1);
      this.readIndex -= consumed - 1;
    }

    return Float32Array.from(output);
  }
}

/**
 * Packs float samples (-1..1) into signed 16-bit PCM.
 *
 * Values outside the range are clamped rather than wrapped: an overdriven mic
 * must click, not turn into a loud positive blip.
 */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const packed = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    // 32767, not 32768: the negative peak has to stay representable.
    packed[index] = Math.round(clamped * PCM_PEAK);
  }
  return packed;
}

/**
 * Base64-encodes PCM bytes for the WebSocket.
 *
 * Chunked on purpose: `String.fromCharCode(...bytes)` overflows the call stack
 * somewhere around 100k arguments, and one chunk of microphone audio can be
 * bigger than that.
 */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/** Root-mean-square level of a frame, 0..1. Drives the live waveform. */
export function rmsLevel(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const sample = frame[index] ?? 0;
    total += sample * sample;
  }
  return Math.min(1, Math.sqrt(total / frame.length));
}

/** Formats seconds as `m:ss`, the way a session timer should read. */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
