import { z } from 'zod';
import { blankEnvToUndefined, booleanFromEnvSchema } from '@creatordna/shared';

/** Model ids are optional here too: a missing one must fail at the AI wrapper. */
const modelIdSchema = z.preprocess(blankEnvToUndefined, z.string().trim().min(1).max(200).optional());

export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromEnvSchema.default(true),

    // redis / bullmq
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
    REDIS_ENABLED: booleanFromEnvSchema.default(true),
    QUEUE_PREFIX: z.string().trim().min(1).max(64).default('creatordna'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    /** Retries per job (applies to every stage; only the failed stage re-runs). */
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    // --- render pipeline -----------------------------------------------------
    /**
     * Where the worker writes job documents, assets and scratch files when
     * Firebase is not configured. One directory, three subdirectories.
     */
    WORKER_DATA_DIR: z.string().trim().min(1).max(500).default('.data'),
    /**
     * Prefix the browser uses to load locally-written assets, e.g.
     * `/api/v1/render-assets`. The API serves this directory in development; in
     * production the Firebase store is used and the URL comes from Storage.
     */
    RENDER_ASSET_BASE_URL: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().min(1).max(500).optional(),
    ),
    /**
     * Composer to use. `auto` picks ffmpeg when the binary runs and the mock
     * otherwise; `mock` forces the mock, which is the only option that works
     * with no encoder installed.
     */
    RENDER_COMPOSER: z.enum(['auto', 'ffmpeg', 'mock']).default('auto'),
    /** Path to the ffmpeg binary, when it is not on `PATH`. */
    FFMPEG_PATH: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).max(500).optional()),

    // --- demo mode ----------------------------------------------------------
    /**
     * Serve every render stage from a pre-baked cache instead of a model.
     *
     * A demo that spends quota is not a demo. With this on, the storyboard, the
     * clips, the voice-over, the music bed and the caption timing all come from
     * `DEMO_CACHE_DIR`, so a render finishes in seconds with no API key. The
     * cache is populated by the first run and by the api `seed:demo` script.
     */
    DEMO_MODE: booleanFromEnvSchema.default(false),
    /** Where the demo cache lives. Defaults to `<WORKER_DATA_DIR>/demo-cache`. */
    DEMO_CACHE_DIR: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).max(500).optional()),

    // firebase admin (assets + job documents)
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

    // --- credentials for the media models -----------------------------------
    /**
     * Gemini API key, used by Veo and the Gemini TTS model.
     *
     * Not required: with no key the render still runs, and the assets, voice and
     * music stages fall back to their mock generators - which the boot log says
     * out loud, per slot.
     */
    GEMINI_API_KEY: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).max(500).optional()),
    /** Prebuilt TTS voice name (a speaker such as `Kore`, not a model id). */
    TTS_VOICE_NAME: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().min(1).max(64).optional(),
    ),
    /**
     * `Authorization` header value for Lyria, e.g. `Bearer ya29....`.
     *
     * Lyria 2 is a Vertex AI model and authenticates with OAuth rather than an
     * API key, so this is a token a deployment mints from its service account
     * (or `gcloud auth print-access-token` locally). It is a header value rather
     * than a credential this process knows how to refresh.
     */
    LYRIA_AUTHORIZATION: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().min(1).max(4000).optional(),
    ),
    /** Vertex AI base URL for Lyria, e.g. `https://us-central1-aiplatform.googleapis.com/v1`. */
    LYRIA_BASE_URL: z.preprocess(
      blankEnvToUndefined,
      z.string().trim().url().max(300).optional(),
    ),

    // --- media model timing -------------------------------------------------
    /** How often to poll a Veo long-running operation. */
    MEDIA_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
    /**
     * How long to keep waiting for one media call before failing the stage.
     *
     * Keep this under the BullMQ lock duration (300s in `render.worker.ts`): a
     * render that outlives its own lock is a render another worker starts again.
     */
    MEDIA_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(240_000),

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
      if (env.DEMO_MODE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEMO_MODE'],
          message:
            'DEMO_MODE must be false in production - a cached render served to a real creator is a silent lie about what the product does.',
        });
      }
      if (env.FIREBASE_PROJECT_ID === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FIREBASE_PROJECT_ID'],
          message: 'FIREBASE_PROJECT_ID is required in production (the worker writes assets and job documents).',
        });
      }
      if (env.FIREBASE_CLIENT_EMAIL === undefined || env.FIREBASE_PRIVATE_KEY === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FIREBASE_PRIVATE_KEY'],
          message:
            'Production requires FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (or GOOGLE_APPLICATION_CREDENTIALS).',
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
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/** Parses and validates the environment, throwing a readable error at boot. */
export function parseWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(formatZodIssues(result.error));
  }
  return result.data;
}
