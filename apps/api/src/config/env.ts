import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { blankEnvToUndefined, booleanFromEnvSchema } from '@creatordna/shared';

/**
 * Every model id is configuration, never a literal in code.
 * `.optional()` on purpose: a missing id must fail loudly at the AI wrapper with
 * "model not configured", not silently fall back to a hard-coded default.
 */
const modelIdSchema = z.preprocess(blankEnvToUndefined, z.string().trim().min(1).max(200).optional());

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    API_PREFIX: z.string().min(1).default('/api/v1'),

    // CORS
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),

    // logging
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromEnvSchema.default(true),

    // redis / bullmq
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
    REDIS_ENABLED: booleanFromEnvSchema.default(true),
    /** BullMQ key prefix - keeps CreatorDNA keys separate in a shared Redis. */
    QUEUE_PREFIX: z.string().trim().min(1).max(64).default('creatordna'),

    // http
    BODY_LIMIT: z.string().min(1).default('256kb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

    // firebase admin
    FIREBASE_PROJECT_ID: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().min(1).optional(),
    ),
    FIREBASE_CLIENT_EMAIL: z.preprocess(blankEnvToUndefined, z.string().email().optional()),
    FIREBASE_PRIVATE_KEY: z.preprocess(blankEnvToUndefined, z.string().min(1).optional()),
    FIREBASE_STORAGE_BUCKET: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().min(1).optional(),
    ),
    GOOGLE_APPLICATION_CREDENTIALS: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().min(1).optional(),
    ),

    // dev-only escape hatch (see README)
    DEV_AUTH_BYPASS: booleanFromEnvSchema.default(false),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    // --- ai wrapper --------------------------------------------------------
    // Blank means "no model configured": the API boots and DNA extraction
    // returns a clear 503 instead of calling a hard-coded default.
    GEMINI_API_KEY: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).optional()),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /** Attempts per model: the first try plus retries. */
    AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.4),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),
    /** Optional, for the cost estimate in the logs. USD per 1k tokens. */
    AI_COST_PER_1K_INPUT_TOKENS: z.coerce.number().nonnegative().optional(),
    AI_COST_PER_1K_OUTPUT_TOKENS: z.coerce.number().nonnegative().optional(),

    /**
     * DEV ONLY - swap the real model client for the stub in
     * `services/ai/stubClient.ts`, so the /dna flow can be demoed without a
     * Gemini API key. Refused in production.
     */
    AI_STUB_CLIENT: booleanFromEnvSchema.default(false),

    // --- creator dna -------------------------------------------------------
    /** How many recent generations are folded into the injected context. */
    DNA_HISTORY_LIMIT: z.coerce.number().int().min(0).max(50).default(5),
    /** Dev-only fallback store when Firebase is not configured. */
    DNA_STORE_DIR: z.string().trim().min(1).default('.data/dna'),
    /**
     * How many recent signals one learning run reasons over. Bounded because the
     * prompt carries every signal verbatim - an unbounded list is a prompt that
     * grows until the model starts ignoring the beginning of it.
     */
    DNA_SIGNAL_LIMIT: z.coerce.number().int().min(1).max(100).default(30),
    /** Ceiling on proposals per run, independent of what the model returns. */
    DNA_MAX_SUGGESTIONS: z.coerce.number().int().min(1).max(20).default(6),
    /**
     * How often the learning loop sweeps for creators with unseen signals.
     * Default 6 hours: proposals are a nudge, not a feed, and every sweep that
     * finds nothing new costs nothing because the service short-circuits.
     */
    DNA_LEARN_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
    /** Creators one sweep touches before the next one picks up the rest. */
    DNA_LEARN_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
    /** Set false to run the loop only when a creator asks (tests, CI). */
    DNA_LEARN_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    // --- phase 4: trends, remix, hook lab ---------------------------------
    /** How long one creator's trend ranking stays fresh. Default 1 hour. */
    TRENDS_CACHE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
    /** How long one remix / hook set stays fresh. */
    TREND_CACHE_TTL_MS: z.coerce.number().int().positive().default(1_800_000),
    /** Requests per window for the model-backed trend endpoints. */
    AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    /** How much of a blended relevance score the model owns (0-1). */
    TREND_MODEL_WEIGHT: z.coerce.number().min(0).max(1).default(0.5),
    /** Dev-only catalogue file when Firebase is not configured. */
    TRENDS_STORE_PATH: z.string().trim().min(1).default('.data/trends.json'),
    /** Dev-only project file when Firebase is not configured. */
    PROJECTS_STORE_PATH: z.string().trim().min(1).default('.data/projects.json'),

    // --- phase 7: render pipeline ------------------------------------------
    /**
     * Directory the worker writes render assets into when Firebase Storage is
     * not configured. The API serves it read-only at `RENDER_ASSET_MOUNT`, so a
     * development render is playable in the browser without a bucket.
     */
    RENDER_ASSET_DIR: z.string().trim().min(1).default('.data/assets'),
    /** Path the dev asset directory is served from. Empty disables the mount. */
    RENDER_ASSET_MOUNT: z.string().trim().min(1).max(100).default('/api/v1/render-assets'),
    /**
     * Where the demo render cache lives.
     *
     * Written by `pnpm --filter @creatordna/api seed:demo` and read by the worker
     * when `DEMO_MODE=true`. It has to be the same value in both processes or the
     * worker will not find what the seed script warmed. Deliberately outside
     * `RENDER_ASSET_DIR`: the cache is not an asset the browser should fetch.
     */
    DEMO_CACHE_DIR: z.string().trim().min(1).max(500).default('.data/demo-cache'),
    /**
     * Composer for the demo seed script's golden render. Same three values as the
     * worker's: `auto` uses ffmpeg when it runs, `mock` always fakes it, `ffmpeg`
     * demands the real one and fails at boot if it cannot run.
     */
    RENDER_COMPOSER: z.enum(['auto', 'ffmpeg', 'mock']).default('auto'),
    /**
     * Path to the ffmpeg binary, for the demo seed script's composer.
     *
     * The API itself never renders - that is the worker's job, and the worker has
     * its own `FFMPEG_PATH`. This one exists so `seed:demo` can produce a real
     * golden video on a machine that has ffmpeg somewhere off `PATH`.
     */
    FFMPEG_PATH: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).max(500).optional()),

    // --- phase 6: live voice coach ----------------------------------------
    /** Path the coaching WebSocket is mounted on. */
    VOICE_COACH_WS_PATH: z.string().trim().min(1).max(100).default('/ws/voice-coach'),
    /**
     * The Live API version in the WebSocket path. Docs have shown both `v1alpha`
     * and `v1beta`; see the note at the top of `voiceCoach/geminiLive.ts`.
     */
    GEMINI_LIVE_API_VERSION: z.string().trim().min(1).max(20).default('v1beta'),
    /** Override for tests and for a proxy. Defaults to Google's endpoint. */
    GEMINI_LIVE_BASE_URL: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().url().max(300).optional(),
    ),

    // --- model ids (see .env.example) ---
    GEMINI_TEXT_MODEL: modelIdSchema,
    GEMINI_LIVE_MODEL: modelIdSchema,
    VEO_MODEL: modelIdSchema,
    LYRIA_MODEL: modelIdSchema,
    TTS_MODEL: modelIdSchema,
    TRANSCRIBE_MODEL: modelIdSchema,
    AI_FALLBACK_MODEL: modelIdSchema,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.DEV_AUTH_BYPASS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEV_AUTH_BYPASS'],
          message: 'DEV_AUTH_BYPASS must be false in production.',
        });
      }
      if (env.AI_STUB_CLIENT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_STUB_CLIENT'],
          message: 'AI_STUB_CLIENT must be false in production.',
        });
      }
      if (env.FIREBASE_PROJECT_ID === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FIREBASE_PROJECT_ID'],
          message: 'FIREBASE_PROJECT_ID is required in production.',
        });
      }
      const hasServiceAccount =
        env.FIREBASE_CLIENT_EMAIL !== undefined && env.FIREBASE_PRIVATE_KEY !== undefined;
      if (!hasServiceAccount && env.GOOGLE_APPLICATION_CREDENTIALS === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FIREBASE_PRIVATE_KEY'],
          message:
            'Production requires FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY or GOOGLE_APPLICATION_CREDENTIALS.',
        });
      }
    }

    if (env.FIREBASE_PRIVATE_KEY !== undefined && !env.FIREBASE_PRIVATE_KEY.includes('BEGIN')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_PRIVATE_KEY'],
        message: 'FIREBASE_PRIVATE_KEY must be a PEM key (it should contain "BEGIN PRIVATE KEY").',
      });
    }

    if (env.FIREBASE_CLIENT_EMAIL !== undefined && env.FIREBASE_PRIVATE_KEY === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_PRIVATE_KEY'],
        message: 'FIREBASE_PRIVATE_KEY is required when FIREBASE_CLIENT_EMAIL is set.',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * If GOOGLE_APPLICATION_CREDENTIALS points at a service-account JSON, lift the
 * project id / client email / private key out of it so the rest of the app can
 * treat env vars as the single source of truth.
 */
function enrichFromGoogleApplicationCredentials(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const path = source.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path || source.FIREBASE_PROJECT_ID) return source;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : undefined;
    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : undefined;
    const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : undefined;
    if (!projectId) return source;
    return {
      ...source,
      FIREBASE_PROJECT_ID: projectId,
      FIREBASE_CLIENT_EMAIL: source.FIREBASE_CLIENT_EMAIL ?? clientEmail,
      FIREBASE_PRIVATE_KEY: source.FIREBASE_PRIVATE_KEY ?? privateKey,
    };
  } catch {
    // A missing/unreadable file is reported by the schema instead of crashing here.
    return source;
  }
}

/** Parses and validates the environment, throwing a readable error at boot. */
export function parseApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const result = apiEnvSchema.safeParse(enrichFromGoogleApplicationCredentials(source));
  if (!result.success) {
    throw new EnvValidationError(formatZodIssues(result.error));
  }
  return result.data;
}
