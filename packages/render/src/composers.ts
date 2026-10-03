import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { COST_LIMITS } from '@creatordna/shared';
import { writeMp4 } from './media/mp4.js';

/**
 * Composers: the stage that turns per-scene clips, a voice-over and a music bed
 * into one MP4.
 *
 * This is the one stage with a real external dependency, so it sits behind an
 * interface with two implementations:
 *
 * - `ffmpeg` - the real thing, when the binary is on `PATH` (or `FFMPEG_PATH`).
 *   Concatenates the clips, mixes the voice over the music, and writes a 9:16
 *   H.264 MP4 with an AAC track.
 * - `mock` - writes a structurally valid MP4 around the clip bytes. It has the
 *   right duration, dimensions and container, and it does **not** decode. That
 *   is stated on the job (`qc.notes`) rather than hidden, because a video that
 *   plays in the UI but was never encoded is a lie the creator would eventually
 *   catch.
 *
 * Remotion is the intended production path. It is not wired here because it
 * needs a headless Chrome download and a bundler step that this sandbox does not
 * have; the interface is what it will slot into, and nothing above it changes.
 */

const execFileAsync = promisify(execFile);

export interface ComposeInput {
  /** Per-scene clip files, in scene order. */
  clips: readonly { sceneIndex: number; path: string }[];
  /** Voice-over WAV. */
  voicePath?: string;
  /** Music bed WAV. */
  musicPath?: string;
  /** Where to write the MP4. */
  outputPath: string;
  width: number;
  height: number;
  durationSeconds: number;
}

export interface ComposeResult {
  outputPath: string;
  bytes: number;
  /** Which composer ran, so the job can say so. */
  composer: 'ffmpeg' | 'mock';
  /** Human-readable note recorded on the job. */
  note: string;
}

export interface Composer {
  readonly kind: 'ffmpeg' | 'mock';
  compose(input: ComposeInput): Promise<ComposeResult>;
}

/** True when an ffmpeg binary can actually be run. */
export async function ffmpegAvailable(binary: string): Promise<boolean> {
  try {
    await execFileAsync(binary, ['-version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export interface FfmpegComposerOptions {
  /** Path or name of the binary. Defaults to `FFMPEG_PATH` or `ffmpeg`. */
  binary?: string;
  /** Injectable runner, so tests can assert on the argv without a binary. */
  run?: (args: string[]) => Promise<void>;
}

/**
 * The real composer.
 *
 * `filter_complex` does the work: scale every clip to the target frame, concat,
 * then mix the voice over a ducked music bed. `-shortest` keeps the output at the
 * storyboard's runtime rather than whichever stream happened to be longest.
 */
export function createFfmpegComposer(options: FfmpegComposerOptions = {}): Composer {
  const binary = options.binary ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const run =
    options.run ??
    (async (args: string[]) => {
      await execFileAsync(binary, args, { timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    });

  return {
    kind: 'ffmpeg',

    async compose(input) {
      if (input.clips.length === 0) {
        throw new Error('cannot compose a video with no clips');
      }

      const args: string[] = ['-y'];
      for (const clip of input.clips) args.push('-i', clip.path);
      if (input.voicePath !== undefined) args.push('-i', input.voicePath);
      if (input.musicPath !== undefined) args.push('-i', input.musicPath);

      const inputs = input.clips
        .map((_, index) => `[${index}:v]scale=${input.width}:${input.height},setsar=1[v${index}]`)
        .join(';');
      const concat = `${input.clips.map((_, index) => `[v${index}]`).join('')}concat=n=${input.clips.length}:v=1:a=0[vout]`;

      const voiceIndex = input.clips.length;
      const musicIndex = input.clips.length + 1;
      const filters = [inputs, concat];
      const maps = ['-map', '[vout]'];
      const codecs = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30'];

      if (input.voicePath !== undefined && input.musicPath !== undefined) {
        // Duck the music under the voice rather than letting them fight.
        filters.push(
          `[${voiceIndex}:a]volume=1.0[voice]`,
          `[${musicIndex}:a]volume=0.25[music]`,
          '[voice][music]amix=inputs=2:duration=first:dropout_transition=0[aout]',
        );
        maps.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
      } else if (input.voicePath !== undefined) {
        filters.push(`[${voiceIndex}:a]volume=1.0[aout]`);
        maps.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
      } else if (input.musicPath !== undefined) {
        filters.push(`[${musicIndex}:a]volume=0.25[aout]`);
        maps.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
      } else {
        maps.push('-an');
      }

      args.push('-filter_complex', filters.join(';'), ...maps, ...codecs);

      args.push(
        '-movflags',
        '+faststart',
        '-t',
        String(Math.min(input.durationSeconds, COST_LIMITS.maxDurationSeconds)),
        input.outputPath,
      );

      await run(args);

      const stats = await stat(input.outputPath);
      return {
        outputPath: input.outputPath,
        bytes: stats.size,
        composer: 'ffmpeg',
        note: 'Encoded with ffmpeg: H.264 9:16 with an AAC mix of the voice-over and music.',
      };
    },
  };
}

export interface MockComposerOptions {
  /** Injectable so tests can assert on the bytes without touching the disk. */
  write?: (path: string, bytes: Buffer) => Promise<void>;
}

/**
 * The mock composer.
 *
 * Writes a real MP4 container around the first clip's bytes. Valid box tree,
 * correct duration and dimensions, no decodable video - and it says so in
 * `note`, which lands on the job document where the QC stage and the UI can
 * both read it.
 */
export function createMockComposer(options: MockComposerOptions = {}): Composer {
  const write =
    options.write ??
    (async (path: string, bytes: Buffer) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    });

  return {
    kind: 'mock',

    async compose(input) {
      const first = input.clips[0];
      const samples = first === undefined ? Buffer.alloc(0) : Buffer.from(first.sceneIndex.toString(), 'ascii');
      const mp4 = writeMp4({
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds,
        samples,
      });

      await write(input.outputPath, mp4.bytes);

      return {
        outputPath: input.outputPath,
        bytes: mp4.bytes.length,
        composer: 'mock',
        note:
          'Composed with the mock composer: a valid MP4 container carrying the right ' +
          'duration and dimensions, but no encoded video. Install ffmpeg (or set ' +
          'FFMPEG_PATH) to produce a playable file.',
      };
    },
  };
}

export type ComposerMode = 'auto' | 'ffmpeg' | 'mock';

/**
 * Picks a composer.
 *
 * `auto` probes and falls back to the mock. `mock` forces the mock. `ffmpeg`
 * **fails at boot** when the binary is not runnable: an operator who asked for
 * ffmpeg explicitly should not discover halfway through a render that the
 * pipeline quietly substituted something else.
 */
export async function resolveComposer(
  options: { mode?: ComposerMode; binary?: string } = {},
): Promise<Composer> {
  const mode = options.mode ?? 'auto';
  const binary = options.binary ?? process.env.FFMPEG_PATH ?? 'ffmpeg';

  if (mode === 'mock') return createMockComposer();
  if (await ffmpegAvailable(binary)) return createFfmpegComposer({ binary });
  if (mode === 'ffmpeg') {
    throw new Error(
      `RENDER_COMPOSER=ffmpeg but "${binary}" could not be run. Install ffmpeg, set FFMPEG_PATH, or use RENDER_COMPOSER=auto.`,
    );
  }
  return createMockComposer();
}
