import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import type { RedisOptions } from 'ioredis';
import {
  createFirebaseStorageAssetStore,
  createFirestoreRenderJobRepository,
  createGeminiTtsClient,
  createLocalDiskAssetStore,
  createLocalFileRenderJobRepository,
  createGeminiTranscribeClient,
  createLyriaMusicClient,
  createMediaRenderAi,
  createDemoAssetCache,
  createMockRenderAi,
  createRenderEventBus,
  createVeoClipClient,
  resolveComposer,
  withDemoCache,
  type AssetStore,
  type Composer,
  type RenderAi,
  type RenderEventPublisher,
  type RenderJobRepository,
} from '@creatordna/render';
import type { Logger } from 'pino';
// Used only for the shape of `callJson`, which the render AI depends on.
import type { createLiveRenderAi } from '@creatordna/render';
import type { WorkerConfig } from '../config/index.js';

/**
 * Wiring for the render pipeline.
 *
 * Every fallback here is deliberate and logged. No Firestore means a local JSON
 * file; no Storage means local files; no model id means mock assets. None of them
 * is a silent degradation - each one is a line in the boot log a developer can
 * read, and each one keeps the whole pipeline running so the UI can be exercised
 * end to end without a Firebase project or an API key.
 */

export interface RenderJobDeps {
  repository: RenderJobRepository;
  store: AssetStore;
  ai: RenderAi;
  /** Passed to the stages so their logs can say where the captions came from. */
  captionModel?: string;
  composer: Composer;
  events: RenderEventPublisher | null;
  workRoot: string;
  width: number;
  height: number;
  logger: Logger;
}

export interface CreateRenderDepsOptions {
  config: WorkerConfig;
  logger: Logger;
  /** Firestore, or null when no Firebase project is configured. */
  firestore: Firestore | null;
  /** Firebase Storage service, or null when none is configured. */
  storage: Storage | null;
  /** Redis connection options, already parsed from `REDIS_URL`. */
  redis: RedisOptions;
  /** The AI wrapper's `callJson`. Omitted in mock mode. */
  callJson?: Parameters<typeof createLiveRenderAi>[0]['callJson'];
}

/** 9:16, the product's frame. Not configurable: it is what a CreatorDNA short is. */
const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;

export async function createRenderDeps(options: CreateRenderDepsOptions): Promise<RenderJobDeps> {
  const { config, logger } = options;
  const env = config.env;
  const dataDir = env.WORKER_DATA_DIR;

  const repository =
    options.firestore === null
      ? createLocalFileRenderJobRepository(`${dataDir}/render-jobs.json`)
      : createFirestoreRenderJobRepository(options.firestore);
  logger.info(
    { kind: repository.kind, path: `${dataDir}/render-jobs.json` },
    'render job store ready',
  );

  const store =
    options.storage === null
      ? createLocalDiskAssetStore({
          root: `${dataDir}/assets`,
          // The API serves this directory in development; in production the
          // Firebase store is used and the URL comes from Storage instead.
          publicBaseUrl: env.RENDER_ASSET_BASE_URL,
        })
      : createFirebaseStorageAssetStore(options.storage);
  logger.info({ kind: store.kind, root: `${dataDir}/assets` }, 'render asset store ready');

  const textModel = config.models.geminiText;
  const apiKey = env.GEMINI_API_KEY;

  // Each media slot is wired independently, and a slot with no model id falls
  // back to its mock. The log line below is what an operator reads to find out
  // why a video came back with stills instead of clips.
  const clipGenerator =
    apiKey === undefined || config.models.veo === undefined
      ? null
      : createVeoClipClient({
          apiKey,
          logger,
          pollIntervalMs: env.MEDIA_POLL_INTERVAL_MS,
          timeoutMs: env.MEDIA_TIMEOUT_MS,
        });
  const voiceGenerator =
    apiKey === undefined || config.models.tts === undefined
      ? null
      : createGeminiTtsClient({ apiKey, logger, voiceName: env.TTS_VOICE_NAME });
  const musicGenerator =
    env.LYRIA_AUTHORIZATION === undefined ||
    env.LYRIA_BASE_URL === undefined ||
    config.models.lyria === undefined
      ? null
      : createLyriaMusicClient({
          authorization: env.LYRIA_AUTHORIZATION,
          baseUrl: env.LYRIA_BASE_URL,
          logger,
        });
  // Caption alignment is a multimodal text call, not a speech service: the same
  // `generateContent` endpoint with the voice-over passed as `inlineData`.
  const captionGenerator =
    apiKey === undefined || config.models.transcribe === undefined
      ? null
      : createGeminiTranscribeClient({ apiKey, logger });

  const ai =
    options.callJson === undefined || textModel === undefined
      ? createMockRenderAi()
      : createMediaRenderAi({
          callJson: options.callJson,
          logger,
          model: textModel,
          clipModel: config.models.veo,
          clipGenerator,
          voiceModel: config.models.tts,
          voiceGenerator,
          musicModel: config.models.lyria,
          musicGenerator,
          captionModel: config.models.transcribe,
          captionGenerator,
        });

  // Demo mode is a cache in front of the AI chosen above, not a replacement for
  // it: a cold cache still renders, it just renders once and remembers.
  const demoCache =
    env.DEMO_MODE === true
      ? createDemoAssetCache({
          dir: env.DEMO_CACHE_DIR ?? `${dataDir}/demo-cache`,
          logger,
        })
      : null;
  const effectiveAi = demoCache === null ? ai : withDemoCache(ai, demoCache);

  logger.info(
    {
      mode: effectiveAi.mode,
      storyboardModel: effectiveAi.mode === 'live' ? textModel : undefined,
      clips: clipGenerator === null ? 'mock' : config.models.veo,
      voice: voiceGenerator === null ? 'mock' : config.models.tts,
      music: musicGenerator === null ? 'mock' : config.models.lyria,
      captions: captionGenerator === null ? 'storyboard plan' : config.models.transcribe,
    },
    'render ai ready',
  );

  if (demoCache !== null) {
    logger.info(
      { dir: demoCache.dir },
      'demo mode on: every stage is served from the cache, no model is called once it is warm',
    );
  }

  if (config.models.veo !== undefined && clipGenerator === null) {
    logger.warn('VEO_MODEL is set but GEMINI_API_KEY is not - scenes will render as still frames.');
  }
  if (config.models.tts !== undefined && voiceGenerator === null) {
    logger.warn('TTS_MODEL is set but GEMINI_API_KEY is not - the voice-over will be a synthetic tone bed.');
  }
  if (config.models.lyria !== undefined && musicGenerator === null) {
    logger.warn(
      'LYRIA_MODEL is set but LYRIA_AUTHORIZATION or LYRIA_BASE_URL is not - the music bed will be synthetic.',
    );
  }
  if (config.models.transcribe !== undefined && captionGenerator === null) {
    logger.warn(
      'TRANSCRIBE_MODEL is set but GEMINI_API_KEY is not - captions will follow the storyboard plan and drift from a real voice-over.',
    );
  }

  // One bus for the process, not one per publish: a subscriber connection that
  // connects and disconnects per event is a connection storm.
  const bus = createRenderEventBus({
    redis: options.redis,
    logger,
    enabled: env.REDIS_ENABLED,
  });

  const composer = await resolveComposer({ mode: env.RENDER_COMPOSER, binary: env.FFMPEG_PATH });
  logger.info({ composer: composer.kind }, 'render composer ready');

  return {
    repository,
    store,
    ai: effectiveAi,
    captionModel: config.models.transcribe,
    composer,
    events: bus?.publisher ?? null,
    workRoot: `${dataDir}/work`,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    logger,
  };
}
