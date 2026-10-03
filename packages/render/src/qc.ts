import { COST_LIMITS, type RenderAsset, type Storyboard } from '@creatordna/shared';
import { readMp4Summary } from './media/mp4.js';

/**
 * QC: the last stage before a render is allowed to call itself finished.
 *
 * The point of QC is that a job which says `completed` is one a creator can
 * watch. So it checks the things that would make it unwatchable, in the order
 * they would bite: no MP4, an MP4 of zero bytes, the wrong aspect ratio, a
 * runtime outside the product's window, or a missing voice-over.
 *
 * A failure here is a **stage failure**, not a job failure: it records
 * `error.stage = 'qc'`, which is retryable, so the creator presses retry and the
 * compose stage runs again rather than the whole render.
 */

export type QcSeverity = 'error' | 'warning';

export interface QcFinding {
  severity: QcSeverity;
  code: string;
  /** One sentence a creator can read. */
  message: string;
}

export interface QcInput {
  mp4: RenderAsset | undefined;
  mp4Bytes: Buffer | undefined;
  storyboard: Storyboard;
  voice: RenderAsset | undefined;
  /** 9:16 is the product. Everything else is a different video. */
  width?: number;
  height?: number;
}

export interface QcReport {
  ok: boolean;
  findings: QcFinding[];
  /** Notes worth keeping on the job even when QC passes. */
  notes: string[];
  durationSeconds: number | undefined;
}

/** True when a finding should stop the job. */
export function isBlocking(finding: QcFinding): boolean {
  return finding.severity === 'error';
}

/**
 * Runs every check and collects the findings.
 *
 * It never throws for a bad video: a QC stage that crashes reports a stack trace
 * the creator cannot act on, where "the file is empty" is something they can.
 */
export function runQc(input: QcInput): QcReport {
  const findings: QcFinding[] = [];
  const notes: string[] = [];

  if (input.mp4 === undefined) {
    findings.push({
      severity: 'error',
      code: 'no_mp4',
      message: 'The compose stage did not record an MP4 on the job.',
    });
    return { ok: false, findings, notes, durationSeconds: undefined };
  }

  if (input.mp4Bytes === undefined || input.mp4Bytes.length === 0) {
    findings.push({
      severity: 'error',
      code: 'empty_mp4',
      message: 'The MP4 on the job is empty, so there is nothing to play.',
    });
    return { ok: false, findings, notes, durationSeconds: undefined };
  }

  const width = input.width ?? 1080;
  const height = input.height ?? 1920;

  let summary;
  try {
    summary = readMp4Summary(input.mp4Bytes);
  } catch (error) {
    findings.push({
      severity: 'error',
      code: 'unreadable_mp4',
      message: `The MP4 could not be read as a video container: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { ok: false, findings, notes, durationSeconds: undefined };
  }

  if (summary.width !== width || summary.height !== height) {
    findings.push({
      severity: 'error',
      code: 'wrong_dimensions',
      message: `The video is ${summary.width}x${summary.height}; a CreatorDNA short has to be ${width}x${height}.`,
    });
  }

  const duration = summary.durationSeconds;
  if (duration < COST_LIMITS.minDurationSeconds || duration > COST_LIMITS.maxDurationSeconds) {
    findings.push({
      severity: 'error',
      code: 'duration_out_of_window',
      message:
        `The video runs ${duration.toFixed(1)}s; the product window is ` +
        `${COST_LIMITS.minDurationSeconds}-${COST_LIMITS.maxDurationSeconds}s.`,
    });
  }

  if (input.voice === undefined) {
    findings.push({
      severity: 'warning',
      code: 'no_voice',
      message: 'No voice-over was recorded on the job, so the short is silent.',
    });
  }

  // The storyboard's own runtime and the container's must agree: a mismatch
  // means the compose stage trimmed or padded something it should not have.
  const storyboardSeconds = input.storyboard.scenes.reduce((total, scene) => total + scene.duration, 0);
  if (Math.abs(storyboardSeconds - duration) > 1) {
    findings.push({
      severity: 'warning',
      code: 'duration_mismatch',
      message:
        `The video runs ${duration.toFixed(1)}s but the storyboard asks for ` +
        `${storyboardSeconds.toFixed(1)}s. The captions may drift.`,
    });
  }

  return {
    ok: findings.every((finding) => !isBlocking(finding)),
    findings,
    notes,
    durationSeconds: duration,
  };
}

/** A one-line summary for the job document. */
export function summariseQc(report: QcReport): string {
  if (report.ok === true) {
    const warnings = report.findings.filter((finding) => finding.severity === 'warning');
    return warnings.length === 0
      ? `QC passed (${report.durationSeconds?.toFixed(1) ?? '?'}s).`
      : `QC passed with ${warnings.length} warning(s): ${warnings.map((w) => w.code).join(', ')}.`;
  }
  const first = report.findings.find(isBlocking);
  return `QC failed: ${first?.message ?? 'unknown'}`;
}
