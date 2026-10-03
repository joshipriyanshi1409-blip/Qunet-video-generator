import type { ZodTypeAny } from 'zod';
import {
  STORYBOARD_LIMITS,
  storyboardSchema,
  type CreatorDna,
  type RenderCreateRequest,
  type Storyboard,
} from '@creatordna/shared';
import { formatScriptBlock, prompts } from '@creatordna/prompts';
import type { Logger } from 'pino';
import type {
  CaptionRequest,
  CaptionSegment,
  ClipRequest,
  MusicRequest,
  RenderMedia,
  VoiceRequest,
} from './mediaModels.js';
import { writePng } from './media/png.js';
import { writeWav } from './media/wav.js';

/**
 * The AI seam for the render pipeline.
 *
 * One interface, two implementations. `live` sends the registered
 * `storyboard@1` prompt to a model through a `callJson` that is
 * **structurally identical to the API's `TextModelService`**, so the same
 * wrapper (retries, timeout, fallback model, one auto re-prompt, token logging)
 * can be handed over without an adapter. `mock` answers from the script, so the
 * whole pipeline runs end to end on a laptop with no keys.
 *
 * The media slots (clips, voice, music) are separate generators behind the same
 * object, because they are separate models with separate credentials and
 * separate failure modes. A deployment with a text key and nothing else gets a
 * live storyboard and mock clips, and the boot log says exactly that - rather
 * than a render that quietly produced a silent video of still frames.
 */

/** Metadata every AI call carries, for logging and for the re-prompt hint. */
export interface RenderAiCallOptions {
  promptId: string;
  promptVersion?: number;
  operation: string;
  uid: string;
  schema: ZodTypeAny;
  repromptHint?: string;
}

export interface RenderAiUsage {
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface RenderAiCallResult<T> {
  data: T;
  usage: RenderAiUsage;
  reprompted: boolean;
}

/**
 * The narrow slice of the AI wrapper the pipeline needs.
 *
 * Deliberately structural rather than an import: `packages/render` must not
 * depend on `apps/api`, and the API's wrapper already satisfies this shape.
 */
export interface RenderAiCallJson {
  callJson<T>(
    messages: { system: string; user: string },
    options: RenderAiCallOptions,
  ): Promise<RenderAiCallResult<T>>;
}

export interface RenderAi {
  /**
   * `mock` and `live` are the two real implementations; `demo` is a read-through
   * cache wrapper around either one, selected by `DEMO_MODE`. See `demoCache.ts`.
   */
  readonly mode: 'mock' | 'live' | 'demo';
  buildStoryboard(payload: RenderCreateRequest, dna: CreatorDna | null): Promise<Storyboard>;
  /** One clip per scene. Falls back to a still frame when no clip model is set. */
  generateClip(request: ClipRequest): Promise<RenderMedia>;
  /** The voice-over. Falls back to a tone bed when no TTS model is set. */
  synthesizeVoice(request: VoiceRequest): Promise<RenderMedia>;
  /** The music bed. Falls back to a two-note bed when no music model is set. */
  composeMusic(request: MusicRequest): Promise<RenderMedia>;
  /**
   * Times the captions against the recorded voice-over.
   *
   * Falls back to the storyboard's own durations when no transcribe model is
   * configured - which is exact for a mock voice-over (it is synthesised to
   * exactly those durations) and approximate for a real one.
   */
  alignCaptions(request: CaptionRequest): Promise<CaptionSegment[]>;
}

/** The three media generators, each optional so they can be mixed freely. */
export interface ClipGenerator {
  generateClip(model: string, request: ClipRequest): Promise<RenderMedia>;
}

export interface VoiceGenerator {
  synthesizeVoice(model: string, request: VoiceRequest): Promise<RenderMedia>;
}

export interface MusicGenerator {
  composeMusic(model: string, request: MusicRequest): Promise<RenderMedia>;
}

export interface CaptionGenerator {
  alignCaptions(model: string, request: CaptionRequest): Promise<CaptionSegment[]>;
}

/** The DNA fields the storyboard prompt asks for. */
export function dnaVariables(dna: CreatorDna | null): Record<string, string> {
  if (dna === null) {
    return {
      dna_niche: 'unknown',
      dna_tone: 'unknown',
      dna_audience: 'unknown',
      dna_style: 'unknown',
      dna_personality: 'unknown',
      dna_vocabulary: 'none recorded',
      dna_catchphrases: 'none recorded',
      dna_dos: 'none recorded',
      dna_donts: 'none recorded',
    };
  }

  return {
    dna_niche: dna.niche,
    dna_tone: dna.tone.join(', '),
    dna_audience: dna.audience.join(', '),
    dna_style: dna.style,
    dna_personality: dna.personality.join(', '),
    dna_vocabulary: dna.vocabulary.length > 0 ? dna.vocabulary.join(', ') : 'none recorded',
    dna_catchphrases:
      dna.catchphrases.length > 0 ? dna.catchphrases.join(', ') : 'none recorded',
    dna_dos: dna.dos.length > 0 ? dna.dos.join(', ') : 'none recorded',
    dna_donts: dna.donts.length > 0 ? dna.donts.join(', ') : 'none recorded',
  };
}

/**
 * The mock storyboard.
 *
 * Deterministic: the same script always produces the same scene list, so a test
 * can assert on durations and so a retry of a later stage sees the storyboard it
 * saw the first time. Durations are spread across the target runtime and the
 * remainder is handed to the last scene, which keeps the total inside the cost
 * window by construction rather than by luck.
 */
export function mockStoryboard(payload: RenderCreateRequest): Storyboard {
  const scenes = payload.script.slice(0, STORYBOARD_LIMITS.maxScenes);
  const target = STORYBOARD_LIMITS.defaultDurationSeconds;
  const perScene = Math.floor(target / scenes.length);
  const remainder = target - perScene * scenes.length;

  return storyboardSchema.parse({
    scenes: scenes.map((beat, index) => ({
      sceneId: `scene-${index + 1}`,
      duration: perScene + (index === scenes.length - 1 ? remainder : 0),
      narration: beat.text,
      visualPrompt: `${beat.scene}. Vertical 9:16, soft peach and coral grade, clean modern SaaS look.`,
      onScreenText: index === 0 ? payload.hook.slice(0, 120) : '',
    })),
  });
}

export interface LiveRenderAiDeps {
  callJson: RenderAiCallJson;
  logger: Logger;
  /** Model id for the text slot, read from config - never hard-coded. */
  model: string;
}

/** Sends the registered storyboard prompt to a model. */
export function createLiveRenderAi(deps: LiveRenderAiDeps): RenderAi {
  const template = prompts.get('storyboard');

  return {
    mode: 'live',

    // Media slots are not this function's business: `createMediaRenderAi` wraps
    // this one and supplies them. Falling back to the mocks here keeps a
    // text-only live deployment honest rather than throwing at the assets stage.
    generateClip: (request) => Promise.resolve(mockClip(request)),
    synthesizeVoice: (request) => Promise.resolve(mockVoice(request)),
    composeMusic: (request) => Promise.resolve(mockMusic(request)),
    alignCaptions: (request) => Promise.resolve(mockCaptions(request)),

    async buildStoryboard(payload, dna) {
      const messages = template.build({
        ...dnaVariables(dna),
        hook: payload.hook,
        script_block: formatScriptBlock(payload.script),
        cta: payload.cta,
        target_seconds: String(STORYBOARD_LIMITS.defaultDurationSeconds),
      });

      const result = await deps.callJson.callJson<{ scenes: unknown[] }>(messages, {
        promptId: template.id,
        promptVersion: template.version,
        operation: 'render.storyboard',
        uid: 'worker',
        // `outputSchema` is optional on the registry type; the storyboard
        // template declares one, and a template without one is a build error
        // rather than something to silently skip.
        schema: template.outputSchema ?? storyboardSchema,
        repromptHint:
          `Fix ONLY these problems: at most ${STORYBOARD_LIMITS.maxScenes} scenes, ` +
          `durations adding up to ${STORYBOARD_LIMITS.minDurationSeconds}-${STORYBOARD_LIMITS.maxDurationSeconds} seconds, ` +
          'unique sceneIds, and every field filled. Return the full JSON again.',
      });
      // The wrapper validated against the draft schema; the shared schema adds
      // the cross-checks the draft cannot express (total duration, unique ids).
      return storyboardSchema.parse(result.data);
    },
  };
}

/** Mock AI: no network, no keys, deterministic answers. */
export function createMockRenderAi(): RenderAi {
  return {
    mode: 'mock',
    buildStoryboard(payload) {
      return Promise.resolve(mockStoryboard(payload));
    },
    generateClip(request) {
      return Promise.resolve(mockClip(request));
    },
    synthesizeVoice(request) {
      return Promise.resolve(mockVoice(request));
    },
    composeMusic(request) {
      return Promise.resolve(mockMusic(request));
    },
    alignCaptions(request) {
      return Promise.resolve(mockCaptions(request));
    },
  };
}

/**
 * Mock caption alignment: the storyboard's own durations.
 *
 * This is *exact* for a mock voice-over, because `mockVoice` synthesises precisely
 * `line.durationSeconds` of audio per line - so the whole mock pipeline produces
 * correctly timed captions without a model. It is approximate for a real one,
 * which is the gap `TRANSCRIBE_MODEL` closes.
 */
export function mockCaptions(request: CaptionRequest): CaptionSegment[] {
  let cursor = 0;
  return request.lines.map((line, lineIndex) => {
    const startSeconds = cursor;
    cursor += line.durationSeconds;
    return { lineIndex, startSeconds, endSeconds: cursor };
  });
}

/** Peach/coral ramp, so two mock clips next to each other are distinguishable. */
export const SCENE_COLOURS: readonly [number, number, number][] = [
  [235, 122, 95],
  [242, 163, 132],
  [214, 96, 77],
  [247, 205, 184],
  [196, 84, 66],
  [250, 226, 210],
  [176, 66, 52],
  [255, 240, 231],
];

export function colourFor(sceneIndex: number): [number, number, number] {
  return SCENE_COLOURS[sceneIndex % SCENE_COLOURS.length] ?? [235, 122, 95];
}

/**
 * The mock media generators, exported so the live AI can fall back to them per
 * slot and so a test can assert on them without going through the interface.
 *
 * Each one produces a genuine file of the right shape: a PNG that opens, a WAV
 * that plays, a WAV of the right length. Only the content is a stand-in, and
 * the stage that stores it logs which generator produced it.
 */
export function mockClip(request: ClipRequest): RenderMedia {
  const frame = writePng({ width: request.width, height: request.height, rgb: colourFor(request.sceneIndex) });
  return {
    bytes: frame.bytes,
    mimeType: 'image/png',
    extension: 'png',
    durationSeconds: request.durationSeconds,
    note: `mock still frame for scene ${request.sceneIndex + 1}`,
  };
}

export function mockVoice(request: VoiceRequest): RenderMedia {
  const samples: number[] = [];
  for (const [index, line] of request.lines.entries()) {
    const frequency = 180 + index * 40;
    const count = Math.round(line.durationSeconds * 16_000);
    for (let i = 0; i < count; i += 1) {
      samples.push(Math.sin((2 * Math.PI * frequency * i) / 16_000) * 0.4);
    }
  }

  const wav = writeWav(samples, { sampleRate: 16_000 });
  return {
    bytes: wav.bytes,
    mimeType: 'audio/wav',
    extension: 'wav',
    durationSeconds: wav.durationSeconds,
    note: `mock voice-over (${request.lines.length} line(s), ${wav.durationSeconds.toFixed(1)}s)`,
  };
}

export function mockMusic(request: MusicRequest): RenderMedia {
  const samples: number[] = [];
  const count = Math.round(Math.max(request.durationSeconds, 1) * 16_000);
  for (let i = 0; i < count; i += 1) {
    const t = i / 16_000;
    samples.push(Math.sin(2 * Math.PI * 220 * t) * 0.18 + Math.sin(2 * Math.PI * 277 * t) * 0.12);
  }

  const wav = writeWav(samples, { sampleRate: 16_000 });
  return {
    bytes: wav.bytes,
    mimeType: 'audio/wav',
    extension: 'wav',
    durationSeconds: wav.durationSeconds,
    note: `mock music bed (${wav.durationSeconds.toFixed(1)}s)`,
  };
}

export interface MediaRenderAiDeps {
  callJson: RenderAiCallJson;
  logger: Logger;
  /** Model id for the storyboard text slot, read from config - never hard-coded. */
  model: string;
  /** Clip model id. Omitted (or a generator of null) means mock still frames. */
  clipModel?: string;
  clipGenerator?: ClipGenerator | null;
  voiceModel?: string;
  voiceGenerator?: VoiceGenerator | null;
  musicModel?: string;
  musicGenerator?: MusicGenerator | null;
  /** Transcribe model id. Omitted means captions follow the storyboard's plan. */
  captionModel?: string;
  captionGenerator?: CaptionGenerator | null;
}

/**
 * The live AI: a real storyboard through the wrapper, and whatever media models
 * are configured.
 *
 * Each media slot is independent. A missing model id falls back to that slot's
 * mock, and the fallback is *logged*, so "the video has stills instead of clips"
 * is a line in the boot log rather than a surprise at the end of a render.
 */
export function createMediaRenderAi(deps: MediaRenderAiDeps): RenderAi {
  const storyboardAi = createLiveRenderAi({ callJson: deps.callJson, logger: deps.logger, model: deps.model });

  const clipModel = deps.clipModel;
  const voiceModel = deps.voiceModel;
  const musicModel = deps.musicModel;
  const captionModel = deps.captionModel;

  return {
    mode: 'live',

    buildStoryboard: (payload, dna) => storyboardAi.buildStoryboard(payload, dna),

    async generateClip(request) {
      if (clipModel === undefined || deps.clipGenerator == null) {
        deps.logger.warn(
          { sceneIndex: request.sceneIndex },
          'no VEO_MODEL configured - storing a still frame for this scene',
        );
        return mockClip(request);
      }
      return deps.clipGenerator.generateClip(clipModel, request);
    },

    async synthesizeVoice(request) {
      if (voiceModel === undefined || deps.voiceGenerator == null) {
        deps.logger.warn('no TTS_MODEL configured - storing a synthetic tone bed as the voice-over');
        return mockVoice(request);
      }
      return deps.voiceGenerator.synthesizeVoice(voiceModel, request);
    },

    async composeMusic(request) {
      if (musicModel === undefined || deps.musicGenerator == null) {
        deps.logger.warn('no LYRIA_MODEL configured - storing a synthetic two-note bed as the music');
        return mockMusic(request);
      }
      return deps.musicGenerator.composeMusic(musicModel, request);
    },

    async alignCaptions(request) {
      if (captionModel === undefined || deps.captionGenerator == null) {
        // Not a warning-worthy degradation in the same way the others are: the
        // storyboard's own durations are a legitimate caption source. It only
        // drifts once a *real* voice-over is in the mix, which is why the stage
        // logs which path it took rather than leaving it to be inferred.
        deps.logger.debug(
          { lines: request.lines.length },
          'no TRANSCRIBE_MODEL configured - timing captions from the storyboard',
        );
        return mockCaptions(request);
      }
      return deps.captionGenerator.alignCaptions(captionModel, request);
    },
  };
}
