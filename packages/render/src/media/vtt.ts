/**
 * A WebVTT writer.
 *
 * Captions are the asset a creator actually reads back to check the edit, so
 * they are real WebVTT with real timestamps rather than a placeholder. The
 * `<track>` element in the result page consumes exactly this file.
 */

export interface VttCue {
  /** Seconds from the start of the video. */
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/** `HH:MM:SS.mmm`, the only timestamp form WebVTT accepts. */
export function formatVttTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Renders cues as a WebVTT document.
 *
 * Cues are clamped so a cue can never end before it starts or run past the end
 * of the video: a caption that appears after the video is over is worse than no
 * caption, because it looks like a bug in the render.
 */
export function writeVtt(cues: readonly VttCue[], durationSeconds: number): string {
  const lines: string[] = ['WEBVTT', ''];

  cues.forEach((cue, index) => {
    const start = Math.min(Math.max(0, cue.startSeconds), durationSeconds);
    const end = Math.min(Math.max(start, cue.endSeconds), durationSeconds);
    if (end <= start) return;

    const text = cue.text.trim();
    if (text.length === 0) return;

    lines.push(String(index + 1));
    lines.push(`${formatVttTimestamp(start)} --> ${formatVttTimestamp(end)}`);
    lines.push(text);
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Counts the cues a document declares, for a test that wants a number. */
export function countVttCues(document: string): number {
  return document
    .split('\n')
    .filter((line) => line.includes(' --> '))
    .length;
}
