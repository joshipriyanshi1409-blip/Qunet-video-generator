/**
 * `@creatordna/render` - the render pipeline both processes share.
 *
 * The API produces render jobs and owns the job document's creation and retry;
 * the worker consumes them and owns everything that happens in between. Both
 * need the same store, the same event shape and the same asset layout, so they
 * are defined once, here.
 */
export {
  RENDER_JOB_COLLECTION,
  createFirestoreRenderJobRepository,
  createLocalFileRenderJobRepository,
  createMemoryRenderJobRepository,
  defaultLocalRenderJobPath,
  type RenderJobRepository,
} from './repository.js';

export {
  RENDER_EVENTS_CHANNEL,
  createRenderEventBus,
  decodeRenderEvent,
  encodeRenderEvent,
  type RenderEventBusOptions,
  type RenderEventPublisher,
  type RenderEventSubscriber,
} from './events.js';

export {
  assetFileName,
  assetStoragePath,
  createFirebaseStorageAssetStore,
  createLocalDiskAssetStore,
  createMemoryAssetStore,
  type AssetStore,
  type PutAssetInput,
} from './storage.js';

export {
  colourFor,
  createLiveRenderAi,
  createMediaRenderAi,
  createMockRenderAi,
  dnaVariables,
  mockCaptions,
  mockClip,
  mockMusic,
  mockStoryboard,
  mockVoice,
  SCENE_COLOURS,
  type CaptionGenerator,
  type ClipGenerator,
  type MediaRenderAiDeps,
  type MusicGenerator,
  type RenderAi,
  type RenderAiCallJson,
  type RenderAiCallOptions,
  type RenderAiCallResult,
  type RenderAiUsage,
  type VoiceGenerator,
} from './ai.js';

export {
  captionSegmentsSchema,
  createGeminiTranscribeClient,
  createGeminiTtsClient,
  createLyriaMusicClient,
  createVeoClipClient,
  MediaModelError,
  type CaptionRequest,
  type CaptionSegment,
  type ClipRequest,
  type GeminiTranscribeClientOptions,
  type GeminiTtsClientOptions,
  type HttpClientOptions,
  type LyriaMusicClientOptions,
  type MusicRequest,
  type RenderMedia,
  type VeoClipClientOptions,
  type VoiceLine,
  type VoiceRequest,
} from './mediaModels.js';

export {
  createFfmpegComposer,
  createMockComposer,
  ffmpegAvailable,
  resolveComposer,
  type ComposerMode,
  type ComposeInput,
  type ComposeResult,
  type Composer,
  type FfmpegComposerOptions,
} from './composers.js';

export {
  createDemoAssetCache,
  demoKey,
  withDemoCache,
  type DemoAssetCache,
  type DemoAssetCacheOptions,
} from './demoCache.js';
export { isBlocking, runQc, summariseQc, type QcFinding, type QcInput, type QcReport } from './qc.js';

export {
  createStages,
  createWorkArea,
  type StageContext,
  type StageDeps,
  type StageOutcome,
  type StageReporter,
  type StageRunner,
  type WorkArea,
  type WorkStage,
} from './stages.js';

export {
  StageFailure,
  mergeAssets,
  runRenderPipeline,
  type PipelineDeps,
  type PipelineResult,
} from './pipeline.js';

export {
  readPngHeader,
  writePng,
  type PngOptions,
  type PngResult,
} from './media/png.js';
export {
  readWavHeader,
  trimWav,
  writeWav,
  writeWavFromPcm,
  type WavOptions,
  type WavResult,
} from './media/wav.js';
export { countVttCues, formatVttTimestamp, writeVtt, type VttCue } from './media/vtt.js';
export { readMp4Summary, writeMp4, type Mp4Result, type Mp4Summary } from './media/mp4.js';
