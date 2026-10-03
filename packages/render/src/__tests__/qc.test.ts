import { describe, expect, it } from 'vitest';
import { storyboardSchema } from '@creatordna/shared';
import { isBlocking, runQc, summariseQc } from '../qc.js';
import { writeMp4 } from '../media/mp4.js';

/**
 * QC.
 *
 * QC is the last thing between a render and a creator pressing play, so its tests
 * are about the failures it must catch - and about the one it must not: a job
 * that is fine should pass, not be held up by a warning.
 */

const storyboard = storyboardSchema.parse({
  scenes: [
    { sceneId: 'scene-1', duration: 15, narration: 'One', visualPrompt: 'A' },
    { sceneId: 'scene-2', duration: 15, narration: 'Two', visualPrompt: 'B' },
  ],
});

const MP4 = writeMp4({ width: 1080, height: 1920, durationSeconds: 30 });

function asset(kind: 'mp4' | 'voice') {
  return { kind, storagePath: `renders/u/j/${kind}` } as const;
}

describe('runQc', () => {
  it('passes a video with the right shape, duration and voice-over', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: MP4.bytes,
      storyboard,
      voice: asset('voice'),
    });

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.durationSeconds).toBeCloseTo(30, 5);
  });

  it('fails when no MP4 was recorded at all', () => {
    const report = runQc({ mp4: undefined, mp4Bytes: undefined, storyboard, voice: undefined });
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe('no_mp4');
  });

  it('fails on an empty file, because that is what a crashed compose leaves', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: Buffer.alloc(0),
      storyboard,
      voice: asset('voice'),
    });
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe('empty_mp4');
  });

  it('fails on the wrong aspect ratio, because that is a different product', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: writeMp4({ width: 1920, height: 1080, durationSeconds: 30 }).bytes,
      storyboard,
      voice: asset('voice'),
    });
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe('wrong_dimensions');
  });

  it('fails when the runtime is outside the product window', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: writeMp4({ width: 1080, height: 1920, durationSeconds: 90 }).bytes,
      storyboard,
      voice: asset('voice'),
    });
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe('duration_out_of_window');
  });

  it('fails on a file that is not a video container', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: Buffer.from('this is not an mp4'),
      storyboard,
      voice: asset('voice'),
    });
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe('unreadable_mp4');
  });

  it('warns but does not fail when the voice-over is missing', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: MP4.bytes,
      storyboard,
      voice: undefined,
    });

    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.severity).toBe('warning');
    expect(isBlocking(report.findings[0]!)).toBe(false);
  });

  it('warns when the container and the storyboard disagree about the runtime', () => {
    const report = runQc({
      mp4: asset('mp4'),
      mp4Bytes: writeMp4({ width: 1080, height: 1920, durationSeconds: 20 }).bytes,
      storyboard,
      voice: asset('voice'),
    });

    expect(report.ok).toBe(true);
    expect(report.findings.map((finding) => finding.code)).toEqual(['duration_mismatch']);
  });

  it('never throws, however bad the input', () => {
    expect(() =>
      runQc({ mp4: undefined, mp4Bytes: undefined, storyboard, voice: undefined }),
    ).not.toThrow();
  });
});

describe('summariseQc', () => {
  it('reads as a pass when there is nothing to say', () => {
    const report = runQc({ mp4: asset('mp4'), mp4Bytes: MP4.bytes, storyboard, voice: asset('voice') });
    expect(summariseQc(report)).toBe('QC passed (30.0s).');
  });

  it('names the warnings it carried', () => {
    const report = runQc({ mp4: asset('mp4'), mp4Bytes: MP4.bytes, storyboard, voice: undefined });
    expect(summariseQc(report)).toBe('QC passed with 1 warning(s): no_voice.');
  });

  it('leads with the blocking finding when it fails', () => {
    const report = runQc({ mp4: undefined, mp4Bytes: undefined, storyboard, voice: undefined });
    expect(summariseQc(report)).toContain('did not record an MP4');
  });
});
