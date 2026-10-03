import { renderStageSchema } from '../schemas/renderJob.schema.js';
import type { RenderStage } from '../types/index.js';

/** REST API version prefix. */
export const API_VERSION = 'v1';

/**
 * Model slots. Values are ALWAYS read from env vars
 * (`GEMINI_TEXT_MODEL`, `GEMINI_LIVE_MODEL`, `VEO_MODEL`, `LYRIA_MODEL`,
 * `TTS_MODEL`, `TRANSCRIBE_MODEL`, `AI_FALLBACK_MODEL`) - never hard-coded.
 * `undefined` means "not configured" and must fail loudly at the AI wrapper.
 */
export const MODEL_KEYS = [
  'geminiText',
  'geminiLive',
  'veo',
  'lyria',
  'tts',
  'transcribe',
  'fallback',
] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

/** Maps a model slot to the environment variable that configures it. */
export const MODEL_ENV_VARS: Readonly<Record<ModelKey, string>> = {
  geminiText: 'GEMINI_TEXT_MODEL',
  geminiLive: 'GEMINI_LIVE_MODEL',
  veo: 'VEO_MODEL',
  lyria: 'LYRIA_MODEL',
  tts: 'TTS_MODEL',
  transcribe: 'TRANSCRIBE_MODEL',
  fallback: 'AI_FALLBACK_MODEL',
};

/**
 * BullMQ queue names. One queue per kind of work.
 *
 * There is deliberately no `dnaLearn` queue: the learning loop's LLM call runs
 * in the API process, which already owns the single `TextModelService` wrapper,
 * so a queue would need a second one. See `apps/api/src/lib/dnaLearningScheduler.ts`
 * for the reasoning and the `TODO(phase-10)` to move it once that wrapper is a
 * shared package.
 */
export const QUEUE_NAMES = {
  ping: 'ping',
  render: 'render',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Job (task) names inside each queue. */
export const JOB_NAMES = {
  ping: 'ping',
  renderVideo: 'render-video',
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * Happy-path pipeline order (derived from the schema so the two can never drift).
 * `failed` is a terminal error state, not a stage.
 */
export const PIPELINE_STAGES = renderStageSchema.options.filter(
  (stage): stage is Exclude<RenderStage, 'failed'> => stage !== 'failed',
);

/**
 * Cost guards (engineering rule 7). Enforced in the worker before any billable
 * AI call, and mirrored in the API when a job is accepted.
 */
export const COST_LIMITS = {
  maxScenesPerVideo: 8,
  minDurationSeconds: 15,
  maxDurationSeconds: 45,
  defaultDurationSeconds: 30,
  maxDailyRendersPerUser: 10,
  maxDailyAiCallsPerUser: 200,
  /** Hard ceiling on a single generated clip / voice-over / music asset. */
  maxAssetBytes: 200 * 1024 * 1024,
} as const;
export type CostLimits = typeof COST_LIMITS;

/** Suggested audience segments offered during onboarding. */
export const AUDIENCE_SEGMENT_PRESETS = [
  'Gen Z',
  'Millennials',
  'Working professionals',
  'Founders',
  'Parents',
  'Students',
  'Fellow creators',
  'General audience',
] as const;

/** Hook angles Hook Lab draws from. */
export const HOOK_ANGLES = [
  'curiosity',
  'contrarian',
  'story',
  'listicle',
  'mistake',
  'authority',
  'question',
] as const;

/** WebSocket message types (single contract shared by api + web). */
export const WS_EVENTS = {
  hello: 'hello',
  ping: 'ping',
  pong: 'pong',
  subscribe: 'subscribe',
  unsubscribe: 'unsubscribe',
  /** Subscribe to one render by job id, without knowing the channel name. */
  renderSubscribe: 'render.subscribe',
  renderUnsubscribe: 'render.unsubscribe',
  renderProgress: 'render.progress',
  error: 'error',
} as const;
export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/**
 * Application-level WebSocket close codes (4000-4999 range).
 * 4401 is sent when the Firebase ID token is missing/invalid on connect.
 */
export const WS_CLOSE_CODES = {
  unauthorized: 4401,
  forbidden: 4403,
} as const;

/** Header used by the dev-only auth bypass. Never honoured in production. */
export const DEV_AUTH_UID_HEADER = 'x-dev-uid';
