import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CONTENT_FORMAT_MAP,
  COST_LIMITS,
  RENDER_STAGE_PLAN,
  storyboardSchema,
  type ContentFormatRecipe,
  type RenderAsset,
  type RenderCreateRequest,
  type RenderJob,
  type RenderStage,
  type Storyboard,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import { colourFor, mockCaptions, type RenderAi } from './ai.js';
import type { Composer } from './composers.js';
import { writePng } from './media/png.js';
import { writeVtt } from './media/vtt.js';
import { StageFailure } from './pipeline.js';
import { runQc, summariseQc } from './qc.js';
import type { AssetStore } from './storage.js';

/**
 * The eight render stages.
 *
 * Each one is a small, honest unit: it takes the job and the assets produced so
 * far, writes files, and hands back the assets to record. Nothing here knows
 * about BullMQ, Redis or HTTP - the pipeline (`pipeline.ts`) owns that, which is
 * why every stage is testable with a memory store and no queue at all.
 *
 * Two rules the stages share:
 *
 * 1. **A stage that has already produced its asset does nothing.** That is what
 *    makes a retry cheap: re-running `voice` after a compose failure must not
 *    regenerate the clips.
 * 2. **A stage reports progress as it works**, through `report(fraction)`, so
 *    the browser sees a bar that moves inside a stage rather than jumping
 *    between them.
 */

/** The stages that do work, in order. */
export type WorkStage = Exclude<RenderStage, 'queued' | 'completed' | 'failed'>;

export type StageReporter = (fraction: number, message?: string) => Promise<void>;

export interface WorkArea {
  /** Scratch directory for this job. */
  readonly dir: string;
  path(fileName: string): string;
  write(fileName: string, bytes: Buffer): Promise<string>;
}

export interface StageContext {
  job: RenderJob;
  payload: RenderCreateRequest;
  /** The storyboard, when an earlier stage produced one. */
  storyboard: Storyboard | null;
  /** Assets already on the job. */
  assets: readonly RenderAsset[];
  work: WorkArea;
  /** Reads an earlier stage's bytes back out of the store. */
  readAsset(asset: RenderAsset): Promise<Buffer | null>;
}

export interface StageOutcome {
  /** Assets to append to the job document. */
  assets: RenderAsset[];
  /** Set by the storyboard stage, for the stages after it. */
  storyboard?: Storyboard;
  /** Set when the stage short-circuited because its work already existed. */
  skippedReason?: string;
}

export interface StageRunner {
  readonly stage: WorkStage;
  /** Percentage points this stage is worth, from the shared plan. */
  readonly weight: number;
  /** True when this stage's output is already on the job. */
  alreadyDone(assets: readonly RenderAsset[]): boolean;
  run(context: StageContext, report: StageReporter): Promise<StageOutcome>;
}

export interface StageDeps {
  store: AssetStore;
  ai: RenderAi;
  composer: Composer;
  logger: Logger;
  /** Present when the AI was built with a caption model; used only for logging. */
  captionModel?: string;
  /** Output frame. 9:16 is the product. */
  width?: number;
  height?: number;
}

/** Creates the scratch area a job works in. */
export function createWorkArea(dir: string): WorkArea {
  return {
    dir,
    path: (fileName) => join(dir, fileName),
    async write(fileName, bytes) {
      const path = join(dir, fileName);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      return path;
    },
  };
}

/**
 * Delivery direction for the voice-over, taken from the DNA snapshot.
 *
 * The DNA profile is the whole product, and the voice is where a creator notices
 * its absence most sharply: the same script read in a different voice is a
 * different video. When there is no profile the direction is left off rather
 * than guessed, so the model speaks in its own default rather than an invented one.
 */
function voiceDirection(dna: RenderJob['dna']): string | undefined {
  if (dna === null) return undefined;
  const parts = [dna.tone.join(', '), dna.personality.join(', ')].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * What the music bed should feel like.
 *
 * Built from the profile, the hook, and the content format rather than from
 * a fixed adjective list, because "upbeat corporate" under a deadpan finance
 * creator is worse than no music at all.
 */
function musicBrief(
  dna: RenderJob['dna'],
  hook: string,
  format?: ContentFormatRecipe | null,
): string {
  const mood =
    dna === null
      ? 'clean, modern, unobtrusive'
      : [dna.tone.join(', '), dna.style].filter((part) => part.length > 0).join(', ');

  const intensity = format?.musicIntensity ?? 0.5;
  const intensityLabel =
    intensity >= 0.7 ? 'energetic and driving' :
    intensity >= 0.4 ? 'moderate and supportive' :
    'subtle and ambient';

  const formatContext = format
    ? ` Format: ${format.name} (${format.category}).`
    : '';

  return `Instrumental background bed for a short vertical video. Mood: ${mood}. ` +
    `Energy level: ${intensityLabel} (${(intensity * 100).toFixed(0)}% intensity).` +
    `It sits under a voice-over about: ${hook}.${formatContext} No vocals, no lyrics, no sudden drops.`;
}

/** File extension for an asset whose mime type did not name one. */
function extensionOf(asset: RenderAsset): string {
  const fromMime = asset.mimeType?.split('/')[1];
  return fromMime === undefined || fromMime.length === 0 ? 'bin' : fromMime;
}

/** True when the AI was built with a caption model, so the log can say which. */
function hasCaptionModel(deps: StageDeps): boolean {
  return 'captionModel' in deps && deps.captionModel !== undefined;
}

/** Every stage, keyed by name, in pipeline order. */
export function createStages(deps: StageDeps): Record<WorkStage, StageRunner> {
  const width = deps.width ?? 1080;
  const height = deps.height ?? 1920;

  const script: StageRunner = {
    stage: 'script',
    weight: weightOf('script'),

    // The script was approved before the job was accepted, so this stage only
    // re-checks the cost guards. It produces no asset, which is why a retry from
    // a later stage never re-runs it.
    alreadyDone: () => false,

    async run(context, report) {
      await report(0.1, 'Checking the approved script');

      const scenes = context.payload.script.length;
      if (scenes > COST_LIMITS.maxScenesPerVideo) {
        // Not retryable: the same script will break the same cap every time, so
        // offering a retry would just spend the creator's patience.
        throw new StageFailure(
          'script',
          `The script has ${scenes} scenes; a CreatorDNA short is capped at ${COST_LIMITS.maxScenesPerVideo}.`,
          { retryable: false },
        );
      }
      if (scenes === 0) {
        throw new StageFailure('script', 'The script has no scenes to render.', {
          retryable: false,
        });
      }

      deps.logger.debug({ jobId: context.job.jobId, scenes }, 'script stage validated the beats');
      await report(1, 'Script is within the cost limits');
      return { assets: [] };
    },
  };

  const storyboard: StageRunner = {
    stage: 'storyboard',
    weight: weightOf('storyboard'),

    alreadyDone: (assets) => assets.some((asset) => asset.kind === 'storyboard'),

    async run(context, report) {
      const existing = context.assets.find((asset) => asset.kind === 'storyboard');
      if (existing !== undefined) {
        const bytes = await context.readAsset(existing);
        if (bytes !== null) {
          return {
            assets: [],
            storyboard: storyboardSchema.parse(JSON.parse(bytes.toString('utf8'))),
            skippedReason: 'the storyboard is already on the job',
          };
        }
      }

      await report(0.2, 'Planning the scenes');

      // Resolve the content format from the render request, when one was specified.
      // The format drives the narrative structure, visual style, pacing and
      // scene durations in the storyboard prompt.
      const formatId = context.payload.contentFormatId;
      const format: ContentFormatRecipe | null =
        formatId !== undefined ? (CONTENT_FORMAT_MAP.get(formatId) ?? null) : null;

      // The DNA snapshotted on the job is what gets injected here. Passing
      // `null` would make every storyboard read as "unknown niche, unknown
      // tone" - the profile is the product, so it has to reach the prompt.
      const built = await deps.ai.buildStoryboard(context.payload, context.job.dna ?? null, format);

      const body = Buffer.from(JSON.stringify(built, null, 2), 'utf8');
      const asset = await deps.store.put({
        uid: context.job.uid,
        jobId: context.job.jobId,
        kind: 'storyboard',
        extension: 'json',
        mimeType: 'application/json',
        body,
      });

      await report(1, `${built.scenes.length} scenes planned`);
      return { assets: [asset], storyboard: built };
    },
  };

  const assets: StageRunner = {
    stage: 'assets',
    weight: weightOf('assets'),

    alreadyDone: (existing) => {
      const clips = existing.filter((asset) => asset.kind === 'clip');
      return clips.length > 0 && clips.every((clip) => clip.sceneIndex !== undefined);
    },

    async run(context, report) {
      const storyboardScenes = context.storyboard?.scenes ?? [];
      if (storyboardScenes.length === 0) {
        throw new Error('the assets stage needs a storyboard; the storyboard stage did not produce one');
      }

      const produced: RenderAsset[] = [];
      for (const [index, scene] of storyboardScenes.entries()) {
        const existing = context.assets.find(
          (asset) => asset.kind === 'clip' && asset.sceneIndex === index,
        );
        if (existing !== undefined) {
          produced.push(existing);
          await report((index + 1) / storyboardScenes.length, `scene ${index + 1} already generated`);
          continue;
        }

        // The clip generator decides what a scene looks like: a still frame in
        // mock mode, a Veo MP4 when a clip model is configured. The asset shape
        // is identical either way, so the compose stage reads either one without
        // knowing which ran - and a retry of `assets` re-runs only the scenes
        // that have no clip yet.
        const generated = await deps.ai.generateClip({
          sceneIndex: index,
          visualPrompt: scene.visualPrompt,
          narration: scene.narration,
          durationSeconds: scene.duration,
          width,
          height,
        });

        const clip = await deps.store.put({
          uid: context.job.uid,
          jobId: context.job.jobId,
          kind: 'clip',
          extension: generated.extension,
          mimeType: generated.mimeType,
          body: generated.bytes,
          sceneIndex: index,
        });
        produced.push(clip);

        await report(
          (index + 1) / storyboardScenes.length,
          `generated scene ${index + 1} of ${storyboardScenes.length}`,
        );
      }

      // The thumbnail is the first scene's frame: it is what a library card
      // shows, and deriving it rather than generating it saves a whole call.
      const hasThumbnail = context.assets.some((asset) => asset.kind === 'thumbnail');
      if (hasThumbnail === false) {
        // Half the frame: a library card shows a thumbnail, not a poster.
        const first = writePng({
          width: Math.round(width / 2),
          height: Math.round(height / 2),
          rgb: colourFor(0),
        });
        produced.push(
          await deps.store.put({
            uid: context.job.uid,
            jobId: context.job.jobId,
            kind: 'thumbnail',
            extension: 'png',
            mimeType: 'image/png',
            body: first.bytes,
          }),
        );
      }

      return { assets: produced };
    },
  };

  const voice: StageRunner = {
    stage: 'voice',
    weight: weightOf('voice'),

    alreadyDone: (existing) => existing.some((asset) => asset.kind === 'voice'),

    async run(context, report) {
      const scenes = context.storyboard?.scenes ?? [];
      if (scenes.length === 0) {
        throw new Error('the voice stage needs a storyboard; the storyboard stage did not produce one');
      }

      await report(0.1, 'recording the voice-over');

      // One generator, one call per scene. The generator is a real TTS model when
      // one is configured and a synthetic tone bed when it is not; either way the
      // stage stores whatever it is handed and logs which one ran.
      const spoken = await deps.ai.synthesizeVoice({
        lines: scenes.map((scene) => ({
          narration: scene.narration,
          durationSeconds: scene.duration,
        })),
        direction: voiceDirection(context.job.dna),
      });

      await context.work.write(`voice.${spoken.extension}`, spoken.bytes);

      const asset = await deps.store.put({
        uid: context.job.uid,
        jobId: context.job.jobId,
        kind: 'voice',
        extension: spoken.extension,
        mimeType: spoken.mimeType,
        body: spoken.bytes,
      });

      deps.logger.info(
        { jobId: context.job.jobId, note: spoken.note, bytes: spoken.bytes.length },
        'voice stage stored the voice-over',
      );

      await report(1, `voice-over recorded (${(spoken.durationSeconds ?? 0).toFixed(1)}s)`);
      return { assets: [asset] };
    },
  };

  const music: StageRunner = {
    stage: 'music',
    weight: weightOf('music'),

    alreadyDone: (existing) => existing.some((asset) => asset.kind === 'music'),

    async run(context, report) {
      const scenes = context.storyboard?.scenes ?? [];
      if (scenes.length === 0) {
        throw new Error('the music stage needs a storyboard; the storyboard stage did not produce one');
      }
      const duration = scenes.reduce((total, scene) => total + scene.duration, 0);

      await report(0.1, 'scoring the music bed');

      // Resolve format for music intensity
      const formatId = context.payload.contentFormatId;
      const format: ContentFormatRecipe | null =
        formatId !== undefined ? (CONTENT_FORMAT_MAP.get(formatId) ?? null) : null;

      const scored = await deps.ai.composeMusic({
        brief: musicBrief(context.job.dna, context.payload.hook, format),
        durationSeconds: duration,
      });

      await context.work.write(`music.${scored.extension}`, scored.bytes);

      const asset = await deps.store.put({
        uid: context.job.uid,
        jobId: context.job.jobId,
        kind: 'music',
        extension: scored.extension,
        mimeType: scored.mimeType,
        body: scored.bytes,
      });

      deps.logger.info(
        { jobId: context.job.jobId, note: scored.note, bytes: scored.bytes.length },
        'music stage stored the bed',
      );

      await report(1, `music scored (${(scored.durationSeconds ?? 0).toFixed(1)}s)`);
      return { assets: [asset] };
    },
  };

  const captions: StageRunner = {
    stage: 'captions',
    weight: weightOf('captions'),

    alreadyDone: (existing) => existing.some((asset) => asset.kind === 'captions'),

    async run(context, report) {
      const scenes = context.storyboard?.scenes ?? [];
      if (scenes.length === 0) {
        throw new Error('the captions stage needs a storyboard; the storyboard stage did not produce one');
      }

      await report(0.2, 'timing the captions');

      const lines = scenes.map((scene) => ({
        narration: [scene.narration, scene.onScreenText].filter((part) => part.length > 0).join(' '),
        durationSeconds: scene.duration,
      }));
      const durationSeconds = scenes.reduce((total, scene) => total + scene.duration, 0);

      // Time the captions against the voice-over that was actually recorded, not
      // against the plan. The two agree by construction for a mock voice-over
      // (it is synthesised to exactly the scene durations) and diverge for a real
      // one, where the model speaks at its own pace - and a caption that drifts
      // away from the words on screen is worse than no caption at all.
      const voiceAsset = context.assets.find((entry) => entry.kind === 'voice');
      const voice = voiceAsset === undefined ? null : await context.readAsset(voiceAsset);

      let segments;
      let source: 'recorded audio' | 'the storyboard plan';
      if (voice === null || voice.length === 0) {
        // Nothing to align: a silent short still gets captions, timed from the plan.
        segments = mockCaptions({ voice: Buffer.alloc(0), lines, durationSeconds });
        source = 'the storyboard plan';
      } else {
        segments = await deps.ai.alignCaptions({ voice, lines, durationSeconds });
        source = deps.ai.mode === 'live' && hasCaptionModel(deps) ? 'recorded audio' : 'the storyboard plan';
      }

      const cues = segments
        .map((segment) => ({
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          text: lines[segment.lineIndex]?.narration ?? '',
        }))
        // A model that reports the same line twice, or reports them out of order,
        // would produce overlapping cues; sorting and letting `writeVtt` clamp is
        // enough, because a duplicate line is visible to the creator and a
        // silently dropped one is not.
        .sort((left, right) => left.startSeconds - right.startSeconds);

      const vtt = writeVtt(cues, durationSeconds);
      const body = Buffer.from(vtt, 'utf8');
      await context.work.write('captions.vtt', body);

      const asset = await deps.store.put({
        uid: context.job.uid,
        jobId: context.job.jobId,
        kind: 'captions',
        extension: 'vtt',
        mimeType: 'text/vtt',
        body,
      });

      deps.logger.info(
        { jobId: context.job.jobId, source, cues: cues.length },
        'captions stage timed the captions',
      );

      await report(1, `${cues.length} captions timed from ${source}`);
      return { assets: [asset] };
    },
  };

  const compose: StageRunner = {
    stage: 'compose',
    weight: weightOf('compose'),

    alreadyDone: (existing) => existing.some((asset) => asset.kind === 'mp4'),

    async run(context, report) {
      const scenes = context.storyboard?.scenes ?? [];
      if (scenes.length === 0) {
        throw new Error('the compose stage needs a storyboard; the storyboard stage did not produce one');
      }

      const clips: { sceneIndex: number; path: string }[] = [];
      for (let index = 0; index < scenes.length; index += 1) {
        const asset = context.assets.find((entry) => entry.kind === 'clip' && entry.sceneIndex === index);
        if (asset === undefined) {
          throw new Error(`scene ${index + 1} has no clip on the job; the assets stage did not finish`);
        }
        const bytes = await context.readAsset(asset);
        if (bytes === null) {
          throw new Error(`scene ${index + 1}'s clip could not be read back from storage`);
        }
        const path = await context.work.write(`clip-${index}.png`, bytes);
        clips.push({ sceneIndex: index, path });
      }

      const voiceAsset = context.assets.find((entry) => entry.kind === 'voice');
      const musicAsset = context.assets.find((entry) => entry.kind === 'music');
      // A missing *reference* is fine (a silent short is a QC warning); an asset
      // that is on the job but unreadable is not. Writing a zero-byte file would
      // hand the composer something it can only report as a cryptic decode error.
      // The extension comes off the recorded asset, not from a constant: a real
      // TTS store and a mock one can disagree, and ffmpeg sniffs the input by
      // content anyway.
      const voicePath =
        voiceAsset === undefined
          ? undefined
          : await context.work.write(
              `voice.${voiceAsset.mimeType === 'audio/wav' ? 'wav' : extensionOf(voiceAsset)}`,
              await readable(context, voiceAsset, 'voice-over'),
            );
      const musicPath =
        musicAsset === undefined
          ? undefined
          : await context.work.write(
              `music.${musicAsset.mimeType === 'audio/wav' ? 'wav' : extensionOf(musicAsset)}`,
              await readable(context, musicAsset, 'music bed'),
            );

      await report(0.2, 'composing the video');

      const duration = scenes.reduce((total, scene) => total + scene.duration, 0);
      const outputPath = context.work.path('output.mp4');
      const result = await deps.composer.compose({
        clips,
        voicePath,
        musicPath,
        outputPath,
        width,
        height,
        durationSeconds: duration,
      });

      const body = await readFile(result.outputPath);

      const asset = await deps.store.put({
        uid: context.job.uid,
        jobId: context.job.jobId,
        kind: 'mp4',
        extension: 'mp4',
        mimeType: 'video/mp4',
        body,
      });

      deps.logger.info(
        { jobId: context.job.jobId, composer: result.composer, bytes: result.bytes },
        result.note,
      );

      await report(1, result.note);
      return { assets: [asset] };
    },
  };

  const qc: StageRunner = {
    stage: 'qc',
    weight: weightOf('qc'),

    // QC is a check, not a producer: re-running it is cheap and always current.
    alreadyDone: () => false,

    async run(context, report) {
      await report(0.3, 'checking the output');

      const mp4Asset = context.assets.find((entry) => entry.kind === 'mp4');
      const mp4Bytes = mp4Asset === undefined ? null : await context.readAsset(mp4Asset);
      const voiceAsset = context.assets.find((entry) => entry.kind === 'voice');

      if (context.storyboard === null) {
        throw new Error('the qc stage needs a storyboard; the storyboard stage did not produce one');
      }

      const qcReport = runQc({
        mp4: mp4Asset,
        mp4Bytes: mp4Bytes ?? undefined,
        storyboard: context.storyboard,
        voice: voiceAsset,
        width,
        height,
      });

      const summary = summariseQc(qcReport);
      deps.logger.info(
        { jobId: context.job.jobId, ok: qcReport.ok, findings: qcReport.findings.map((f) => f.code) },
        summary,
      );

      if (qcReport.ok === false) {
        // A stage failure, not a job failure: `error.stage` is `qc`, which the
        // API lets the creator retry, and the retry re-runs compose.
        throw new Error(summary);
      }

      await report(1, summary);
      return { assets: [] };
    },
  };

  return { script, storyboard, assets, voice, music, captions, compose, qc };
}

/** Weight from the shared plan, so a stage cannot claim more than it is worth. */
function weightOf(stage: WorkStage): number {
  return RENDER_STAGE_PLAN.find((entry) => entry.stage === stage)?.weight ?? 0;
}

/**
 * Reads an asset that the job says exists, or fails the stage saying which one.
 *
 * `compose` is the only stage that reads another stage's output, and "scene 2's
 * clip could not be read back from storage" is the difference between a retry
 * that fixes something and a stack trace nobody can act on.
 */
async function readable(
  context: StageContext,
  asset: RenderAsset,
  label: string,
): Promise<Buffer> {
  const bytes = await context.readAsset(asset);
  if (bytes === null || bytes.length === 0) {
    throw new StageFailure(
      'compose',
      `The ${label} is recorded on the job but could not be read back from storage.`,
      { retryable: true },
    );
  }
  return bytes;
}
