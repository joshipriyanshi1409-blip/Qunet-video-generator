# @creatordna/api

**Purpose:** the REST + WebSocket server. It owns every AI call, the Creator DNA
read path, job *creation*, and the learning loop's sweep. It never renders.

```
src/routes/       URL -> controller mapping, one router per domain
src/controllers/  Thin translation: request shape -> service call -> response
src/services/     Business logic; services/ai/ holds the ONE AI wrapper
src/lib/          Repositories, redis, firebase-admin, logger, errors, queues
src/middleware/   auth (Firebase token), validate (zod), rateLimit
src/voiceCoach/   Gemini Live session handler, registry, system instruction
src/ws/           The /ws server and the single upgrade router
src/config/       zod-validated environment, parsed once at boot
scripts/          smoke.ts (40 checks), seedTrends.ts, seedDemo.ts
```

Layering is **routes -> controllers -> services**; cross-cutting concerns live in
`src/middleware` and `src/lib`.

---

Express + `ws` API for CreatorDNA Studio: REST under `/api/v1`, health at
`/health`, WebSocket at `/ws` on the same HTTP server.

Layering is **routes -> controllers -> services**; cross-cutting concerns
(Firebase auth, zod validation, rate limiting, error handling) live in
`src/middleware` and `src/lib`.

## Run

```bash
cp .env.example .env
pnpm --filter @creatordna/api dev        # tsx watch
# or, after `pnpm build`:
pnpm --filter @creatordna/api start
```

## Endpoints

| Method | Path                       | Auth | Notes                                        |
| ------ | -------------------------- | ---- | -------------------------------------------- |
| GET    | `/health`                  | -    | Service info + dependency checks             |
| GET    | `/health/live`             | -    | Process liveness                             |
| GET    | `/health/ready`            | -    | 503 when a dependency is degraded            |
| GET    | `/api/v1/me`               | yes  | The verified caller (token-verification probe)|
| POST   | `/api/v1/jobs/ping`        | yes  | Enqueues the demo `ping` job                 |
| GET    | `/api/v1/jobs/:jobId`      | yes  | State of one of *your* jobs                  |
| POST   | `/api/v1/dna/extract`      | yes  | Onboarding answers + samples -> a DNA profile|
| GET    | `/api/v1/dna`              | yes  | The stored profile (404 before onboarding)   |
| PUT    | `/api/v1/dna`              | yes  | Partial edit; bumps `dnaVersion`             |
| GET    | `/api/v1/dna/context`      | yes  | The block injected into every prompt         |
| GET    | `/api/v1/trends/for-me`    | yes  | The trend catalogue ranked against your DNA  |
| POST   | `/api/v1/trends/remix`     | yes  | One trend/idea rewritten to fit your DNA     |
| POST   | `/api/v1/trends/hooks`     | yes  | 5-8 hooks in distinct styles (or one style)  |
| POST   | `/api/v1/trends/seed`      | yes  | Idempotent catalogue seeding                 |
| WS     | `/ws?token=<idToken>`      | yes  | Verified on connect (close code `4401`)      |
| POST   | `/api/v1/voice-coach/feedback` | yes  | Coach a take after the fact (fallback mode) |
| GET    | `/api/v1/voice-coach/quota` | yes  | Sessions left today, and the session budget |
| WS     | `/ws/voice-coach?token=<idToken>` | yes | Live coaching; verified on connect |
| POST   | `/api/v1/render`                  | yes  | Start the video pipeline (202)          |
| GET    | `/api/v1/render/:id`              | yes  | Stage, progress and assets of one job    |
| POST   | `/api/v1/render/:id/retry`        | yes  | Re-run one stage, keeping earlier assets|

Auth is a Firebase ID token in `Authorization: Bearer <token>`. The token is
verified on **every** REST request and on WebSocket connect. See
`DEV_AUTH_BYPASS` in `.env.example` for local development without a Firebase
project.

### `/api/v1/dna`

- `POST /extract` renders the versioned `dna-extract` v1 prompt from
  `@creatordna/prompts`, calls the AI wrapper, validates the answer against the
  shared `creatorDnaSchema`, and **re-prompts once** with the zod errors if the
  first answer does not validate. It is an upsert keyed on the creator, so it
  always returns `200`. `dnaVersion` only moves when the profile content
  actually changes. Nothing is persisted unless the answer validates.
- `GET /` returns `{ dna, score, context, contextTokens }`.
- `PUT /` takes a partial patch and rejects an empty `tone`.
- `GET /context` returns the compact block every future prompt is prefixed with.

The store is Firestore when Firebase is configured, otherwise a local JSON file
under `DNA_STORE_DIR` (development only, logged loudly on boot). See
`src/lib/dnaRepository.ts`.

### `/api/v1/trends` (Trend Remix + Hook Lab)

Every call loads the creator's DNA first, so a creator who has not onboarded
gets a clear `404` instead of generic output that merely looks personal.

- `GET /for-me` ranks the catalogue by relevance % to the DNA: a heuristic
  (`computeTrendRelevance` in `@creatordna/shared`, five weighted signals) then
  an optional model refinement (`trend-relevance` v1) blended at
  `TREND_MODEL_WEIGHT`. The result is cached **per creator for one hour**
  (`TRENDS_CACHE_TTL_MS`). Without a DNA it degrades to popularity order and
  returns `personalizationLimited: true` rather than failing.
- `POST /remix` takes `{ trendId }` or `{ idea }`. It renders `trend-remix` v1
  with the DNA and the trend's format skeleton, and returns
  `{ hook, script[{scene,text}], cta, caption, hashtags, whatWasKept, whatWasChanged }`.
  `trendId` and `format` are forced server-side - they are never the model's to
  invent. Cached per creator per trend for 30 minutes (`TREND_CACHE_TTL_MS`).
- `POST /hooks` renders `hook-lab` v1 and returns 5-8 hooks, each with a style
  label. `regenerateStyle` reuses the same prompt with a one-hook response shape,
  so "just the POV one again" costs a single short call.
- All three are zod-validated, rate-limited (their own tighter limiter on top of
  the global one) and logged.

Seed the catalogue with:

```bash
pnpm --filter @creatordna/api seed:trends
```

It is idempotent: only missing ids are written. The store is Firestore when
Firebase is configured, otherwise the local JSON file at `TRENDS_STORE_PATH`.
With neither available the app falls back to the in-memory seed catalogue
(`createSeedTrendRepository`), which is what the tests and the smoke script use.

### The AI wrapper

`src/services/ai/` is the single seam every model call goes through:
`TextModelClient` (the adapter) -> `createTextModelService` (retries, timeout,
fallback model, JSON mode, zod validation with one auto re-prompt, token/cost
logging). `AiClientError` surfaces as `503 ai_unavailable` and
`AiValidationError` as `503 ai_response_invalid`. `AI_STUB_CLIENT=true` swaps in
the dev fake so the flow runs without a key (refused in production).

## Layout

```
src/
  config/     env.ts (zod, validated at boot) + derived config + model slots
  lib/        errors, logger, firebase-admin, redis, bullmq queues, asyncHandler,
              cache (redis or in-memory), dnaRepository, trendRepository,
              projectRepository, renderJobRepository (Firestore or local file),
              renderEvents (redis pub/sub, worker -> API)
  middleware/ auth (Firebase token), validate (zod), rateLimit
  routes/     route -> controller wiring (health, me, jobs, dna, trends, render)
  controllers/ request/response shaping only
  services/   business logic (health checks, job enqueue/status, dna, trends,
              audience, storyboard, ai/)
  ws/         WebSocket server mounted on the HTTP server, upgrade-routed
  voiceCoach/ live coaching: provider port, gemini adapter, stub, registry,
              service, socket handler, system instruction
  app.ts      createApp(): helmet -> pino-http -> cors -> json -> routes -> errors
  index.ts    boot: env validation -> firebase -> redis -> listen -> graceful shutdown
```

## Tests

```bash
pnpm --filter @creatordna/api test
```

200 unit/integration tests, no Redis and no network required: env validation,
the error middleware, zod request validation, auth (dev bypass + injected token
verifier), health, job enqueue/status, CORS, 404s, and the WebSocket handshake
(including rejection of an invalid token), and that a job which never failed
reports `failedReason: null` instead of a validation error.

Phase 3 adds 30 of those: the AI wrapper (retry on a retryable error, timeout via
`AbortSignal`, fallback model after the primary is exhausted, zod failure ->
one re-prompt -> `AiValidationError`, per-call usage logging) and the DNA service
(extract upsert, `dnaVersion` bumping only on a content change, partial update,
context building, and 404/503 behaviour).

Phase 6 adds 40 of those: the live coach (system instruction carries the DNA
and the script, tip extraction from free text, registry quota/expiry/shutdown,
summary building, service start/pump/audio/summary/quota/unavailable,
post-recording feedback, the stub provider) and an end-to-end WebSocket harness
over a real HTTP server - auth on connect, token rejection, a bad first message,
an unknown message type, PCM relay, `end` -> saved summary, an abrupt drop
freeing the model session, and the daily cap closing the socket.

Phase 4 adds 21 of those: the trend ranking (personalised, popularity-only
fallback, per-user caching, model-failure fallback), the remix (trend id forced
server-side, free-text ideas, unknown trend -> 404, no DNA -> 404, caching, 503
on a model failure, auth required) and hook lab (5-8 distinct styles, single-style
regeneration, count bounds, auth required), plus the AI wrapper normalising an
unexpected adapter error into `ai_unavailable` rather than a 500.

Phase 7 adds 30 of those: the render job service (document creation, the payload
kept on the document so a retry days later still works, stage/asset reporting,
queue-state precedence, ownership, progress publication, completion, and every
retry path - failed stage, explicit earlier stage, the old queue entry being
replaced, and a non-retryable stage refused), the render routes over a real HTTP
server, and the render progress channel end to end (own job acked, events
delivered, one render's events never reaching a socket watching another, another
creator's job refused, an unknown job refused, a plain channel still working,
unsubscribe, and an empty channel rejected). Plus the storyboard service and the
`storyboard` schema: the prompt states the cost limits as hard numbers, the DNA
and the approved script reach the model, a storyboard that breaks the duration or
scene-count guard fails the stage rather than being clamped, and it still runs
with no profile at all.

### `/api/v1/voice-coach` (Live Voice Coach)

The live path is a **WebSocket**, not REST: a session is a stream, and polling
for tips the browser already missed is how a coach becomes useless.

`/ws/voice-coach?token=<idToken>` (or `?dev_uid=` in development) is verified on
connect, then:

1. the browser sends `{ script: [...], projectId? }` - the session start;
2. the API opens a provider session (`src/voiceCoach/geminiLive.ts`), builds a
   system instruction carrying the creator's DNA **and the script**, and tells
   the model to coach on pace, clarity, filler words, energy and tone match in
   short tips;
3. the browser streams 16 kHz mono 16-bit PCM as base64 `{ type: 'audio' }`,
   marks the line it is on with `{ type: 'line', index }`, and ends with
   `{ type: 'end' }`;
4. the API relays `tip`, `transcript` and `audio` (spoken feedback) back, and
   saves a summary - strengths, issues, tips - to history on `ended`.

Every value crossing the socket is validated with the shared
`liveServerMessageSchema` / `liveClientMessageSchema`, so a malformed tip is
dropped rather than rendered.

**Limits** (both enforced server-side, both in `@creatordna/shared`):
300 seconds per session (`4001` on the wire) and 10 sessions per creator per UTC
day (`4029`). Sessions are cleaned up on disconnect, on error and on shutdown.

**Fallback mode.** `POST /api/v1/voice-coach/feedback` takes the whole recorded
take as base64 PCM and returns the same summary plus tips. It is a first-class
path, not an error handler: it runs when the Live API is unavailable (the socket
closes `4503`) and some creators prefer it outright.

The provider is a port (`LiveSessionProvider`) with two implementations -
`geminiLive.ts` and `stubLive.ts` - chosen in `src/index.ts`. `AI_STUB_CLIENT=true`
selects the stub, so the whole flow runs without a key. `GEMINI_LIVE_MODEL`,
`GEMINI_LIVE_API_VERSION` and `GEMINI_LIVE_BASE_URL` are all env-driven; a
missing model id degrades to the fallback path with a naming error rather than
failing the boot.

> The exact Gemini Live wire protocol in `geminiLive.ts` is written from the
> official docs. Before trusting a live session, check
> https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket and
> https://ai.google.dev/api/live - the setup frame, `realtimeInput.audio` and
> `serverContent` shapes are the parts most likely to have moved.

### `/api/v1/render` (render pipeline - Phase 7)

One-click video. The API is a producer, never a renderer: engineering rule 5 puts
Remotion and FFmpeg in the worker, so all this process does is create the queue
job, keep the job document, and push progress to the browser.

| Route | What it does |
| --- | --- |
| `POST /render` | Creates the BullMQ job **and** the Firestore `renderJobs/{jobId}` document. `202`. |
| `GET /render/:id` | The document: `stage`, `progress`, `assets`, `error`. The document is authoritative; the queue is only asked for `state`. |
| `POST /render/:id/retry` | Re-runs one stage, keeping every asset already on the job. `202` with `resumedFromAssets`. |

The document carries the job `payload` as well as its state, because BullMQ evicts
finished jobs and a retry three days later must still know what it was rendering.

**Stages and progress** live in `@creatordna/shared` (`lib/renderProgress.ts`):
`script 20 / storyboard 15 / assets 25 / voice 10 / music 8 / captions 8 / compose
10 / qc 4 = 100`. `queued`, `completed` and `failed` are states, not stages, and
are deliberately absent from the plan. `isRetryableStage` is what stops a retry
from re-running a stage that already produced an asset.

**Live progress is a WebSocket concern.** On `/ws`, send
`{ type: 'subscribe', channel: 'render:<jobId>' }` and receive
`{ type: 'render.progress', jobId, stage, progress, message? }`. The channel name
is a job id, so the server resolves the job's owner from the document and refuses
a subscription to somebody else's render (`forbidden`) - it is never taken on
trust from the client. Worker to API is Redis pub/sub
(`lib/renderEvents.ts`); when `REDIS_ENABLED=false` the bus is skipped and the
browser falls back to polling `GET /render/:id`.

`renderJobOwner` is the one seam the upgrade needs: pass it and the channel is
protected, omit it and every render subscription is refused. `src/index.ts` wires
it to the same repository the routes use.

**The store and the event bus moved to `@creatordna/render` in Phase 7.3.** The
API creates jobs and re-queues failed stages; the worker reports every stage as it
runs. Both write the same document and both need the same pub/sub contract, so
`lib/renderJobRepository.ts` and `lib/renderEvents.ts` are now re-export shims and
the implementations live beside the pipeline. Every import path above them is
unchanged.

**Serving the worker's assets in development.** With no Firebase project, the
worker writes assets to `RENDER_ASSET_DIR` (default `.data/assets`) and this
process serves that directory read-only at `RENDER_ASSET_MOUNT` (default
`/api/v1/render-assets`), so a development render is playable in the browser
without a bucket. In production the worker uploads to Storage and the mount is
unused.

## Smoke test

```bash
pnpm --filter @creatordna/api smoke
```

`scripts/smoke.ts` boots the real Express app over HTTP with a stub model and
checks the Phase 3, Phase 4, Phase 6 **and Phase 7** flows, including that a
profile written by one process is still readable by a brand-new one, that
changing the DNA re-sorts the same catalogue, a real coaching session over a real
WebSocket upgrade, and the render routes' auth, validation and queue-off
behaviour. 40 checks, exits non-zero on any failure.

## Where Phase 7 stands

7.1 (job infrastructure) and 7.2 (script + storyboard) are built and tested:

- **7.1** - job document, queue producer, `POST /render`, `GET /render/:id`,
  `POST /render/:id/retry`, the WebSocket progress channel with per-job
  ownership, and the Redis pub/sub bridge worker -> API.
- **7.2** - `storyboardSchema` (timed scenes, 15-45 s, at most
  `COST_LIMITS.maxScenesPerVideo` scenes, unique scene ids) and
  `services/storyboard.service.ts`, which renders the `storyboard` v1 prompt
  through the same AI wrapper as everything else - so it inherits retries, the
  fallback model, token logging and the one-time validation re-prompt.

**Not chained yet:** the worker's render consumer is still `// TODO(phase-5)`, so
nothing runs the stages. The job document, the progress channel and the
storyboard contract are all in place and independently tested; 7.3 (assets), 7.4
(composition), 7.5 (QC) and 7.6 (output) build on them.

## Next (Phase 7+)

7.3 asset generation in the worker: one Veo clip per scene, TTS per scene with
the voice chosen from DNA tone, a Lyria background track, word-level caption
timing from the voice-over transcription, every asset written to Storage and
recorded on the job document as soon as it exists, and the fallback ladder
(still image + Ken Burns when a clip fails).
