import { describe, expect, it } from 'vitest';
import { LIVE_AUDIO_FORMAT } from '@creatordna/shared';
import { PcmResampler, floatToPcm16, formatDuration, pcmToBase64, rmsLevel } from '../../audio/pcm';
import { pcmToWav } from '../../audio/playback';
import { parseServerMessage } from '../voiceCoachClient';

/**
 * The coach's audio path, end to end at the unit level.
 *
 * These are the numbers that decide whether the coach hears anything: a resampler
 * that drifts makes the model hear chipmunk or slow-motion speech, and a wrong
 * WAV header makes the coach's spoken feedback silent. Neither shows up as an
 * error anywhere - the session just quietly does not work.
 */

describe('PcmResampler', () => {
  it('produces 16 kHz output for a 48 kHz microphone', () => {
    const resampler = new PcmResampler(48_000);
    const frame = new Float32Array(480); // 10 ms at 48 kHz

    const output = resampler.process(frame);

    expect(output.length).toBe(160); // 10 ms at 16 kHz
    expect(resampler.ratio).toBe(3);
  });

  it('passes a constant signal through unchanged', () => {
    const resampler = new PcmResampler(48_000);
    const frame = new Float32Array(4800).fill(0.5);

    const output = resampler.process(frame);

    expect(output.length).toBe(1600);
    for (const sample of output) {
      expect(sample).toBeCloseTo(0.5, 5);
    }
  });

  it('reproduces a sine wave at the target rate', () => {
    const inputRate = 48_000;
    const targetRate = LIVE_AUDIO_FORMAT.sampleRate;
    const frequency = 440;
    const resampler = new PcmResampler(inputRate, targetRate);

    const frame = new Float32Array(inputRate);
    for (let index = 0; index < frame.length; index += 1) {
      frame[index] = Math.sin((2 * Math.PI * frequency * index) / inputRate);
    }

    const output = resampler.process(frame);

    expect(output.length).toBe(targetRate);
    for (let index = 0; index < output.length; index += 1) {
      const expected = Math.sin((2 * Math.PI * frequency * index) / targetRate);
      expect(output[index]).toBeCloseTo(expected, 2);
    }
  });

  it('loses no samples across frame boundaries', () => {
    const resampler = new PcmResampler(48_000);
    const frames = 10;
    const frameSize = 480;

    let total = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const input = new Float32Array(frameSize);
      for (let index = 0; index < frameSize; index += 1) {
        input[index] = frame * frameSize + index;
      }
      total += resampler.process(input).length;
    }

    // Ten frames of 480 at 48 kHz is 0.1 s of audio, which is 1_600 samples
    // at 16 kHz. The count is exact only if nothing is lost or duplicated at a
    // frame boundary.
    expect(total).toBe(1_600);
  });

  it('carries the previous frame across the boundary', () => {
    const resampler = new PcmResampler(48_000);

    // A step from silence to a constant. If the boundary dropped history, the
    // first sample of the second frame would read as 0 instead of the step.
    resampler.process(new Float32Array(480));
    const output = resampler.process(new Float32Array(480).fill(0.5));

    expect(output[0]).toBeCloseTo(0.5, 5);
    expect(output.length).toBe(160);
  });

  it('does not grow its buffer over a long session', () => {
    const resampler = new PcmResampler(48_000);
    const frame = new Float32Array(128);

    for (let index = 0; index < 2000; index += 1) {
      resampler.process(frame);
    }

    expect(resampler.outputLength).toBeLessThan(200);
  });

  it('rejects an impossible sample rate', () => {
    expect(() => new PcmResampler(0)).toThrow(RangeError);
    expect(() => new PcmResampler(Number.NaN)).toThrow(RangeError);
  });

  it('upsamples when the microphone is slower than 16 kHz', () => {
    const resampler = new PcmResampler(8000, LIVE_AUDIO_FORMAT.sampleRate);
    const output = resampler.process(new Float32Array(800).fill(0.5));

    expect(output.length).toBe(1600);
  });
});

describe('floatToPcm16', () => {
  it('maps full scale to the 16-bit peaks', () => {
    const packed = floatToPcm16(Float32Array.from([-1, 1, 0]));

    expect(packed[0]).toBe(-32_767);
    expect(packed[1]).toBe(32_767);
    expect(packed[2]).toBe(0);
  });

  it('clamps instead of wrapping', () => {
    const packed = floatToPcm16(Float32Array.from([-4, 4]));

    expect(packed[0]).toBe(-32_767);
    expect(packed[1]).toBe(32_767);
  });
});

describe('pcmToBase64', () => {
  it('round-trips through the browser decoder', () => {
    const pcm = Int16Array.from([0, 1, -1, 32_767, -32_767]);
    const decoded = atob(pcmToBase64(pcm));

    expect(decoded.length).toBe(pcm.byteLength);
    const bytes = new Uint8Array(pcm.buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      expect(decoded.charCodeAt(index)).toBe(bytes[index]);
    }
  });

  it('handles a chunk large enough to overflow the call stack', () => {
    // 200k samples is well past the ~100k argument limit of a spread call.
    const pcm = new Int16Array(200_000);
    expect(pcmToBase64(pcm).length).toBeGreaterThan(0);
  });
});

describe('rmsLevel', () => {
  it('is zero for silence and near one for full scale', () => {
    expect(rmsLevel(new Float32Array(128))).toBe(0);
    expect(rmsLevel(new Float32Array(128).fill(1))).toBeCloseTo(1, 5);
  });

  it('never leaves the 0..1 range the waveform assumes', () => {
    expect(rmsLevel(new Float32Array(64).fill(8))).toBe(1);
  });
});

describe('pcmToWav', () => {
  it('writes a header the audio element can read', () => {
    const pcm = new Uint8Array(32);
    const wav = pcmToWav(pcm);
    const view = new DataView(wav.buffer);
    const text = (offset: number, length: number): string =>
      String.fromCharCode(...wav.subarray(offset, offset + length));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(LIVE_AUDIO_FORMAT.channels);
    expect(view.getUint32(24, true)).toBe(LIVE_AUDIO_FORMAT.sampleRate);
    expect(view.getUint16(34, true)).toBe(LIVE_AUDIO_FORMAT.bitDepth);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(32);
    expect(wav.length).toBe(44 + 32);
  });

  it('declares a byte rate that matches the format', () => {
    const wav = pcmToWav(new Uint8Array(16));
    const view = new DataView(wav.buffer);

    const expected = LIVE_AUDIO_FORMAT.sampleRate * LIVE_AUDIO_FORMAT.channels * 2;
    expect(view.getUint32(28, true)).toBe(expected);
  });
});

describe('parseServerMessage', () => {
  it('accepts every message kind the API is allowed to send', () => {
    const messages = [
      { type: 'ready', sessionId: 's1', maxSeconds: 300 },
      { type: 'tip', tip: { kind: 'pace', severity: 'info', message: 'Slow down.' } },
      { type: 'transcript', text: 'hello', final: false },
      { type: 'audio', data: 'AAAA', mimeType: LIVE_AUDIO_FORMAT.mimeType },
      { type: 'warning', message: 'Audio chunk too large; dropped.' },
      {
        type: 'ended',
        summary: { strengths: [], issues: [], tips: ['Again.'], durationSeconds: 12, linesRead: 3 },
      },
      { type: 'error', error: { code: 'invalid_message', message: 'Unrecognised message.' } },
    ];

    for (const message of messages) {
      expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    }
  });

  it('drops a malformed message instead of throwing', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage({ type: 'tip', tip: { kind: 'nope', severity: 'info', message: 'x' } })).toBeNull();
    expect(parseServerMessage(null)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('reads like a session timer', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(300)).toBe('5:00');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});
