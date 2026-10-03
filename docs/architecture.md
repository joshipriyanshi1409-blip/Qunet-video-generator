# Architecture

How CreatorDNA Studio fits together, and the three decisions that everything else
follows from.

## The shape

```
                     ┌─────────────────────────────┐
   browser ──────────▶  Firebase Hosting (web SPA)  │
                     └──────────────┬──────────────┘
                                    │  /api/**  /ws/**  /health
                                    ▼
                     ┌─────────────────────────────┐
                     │  Cloud Run: creatordna-api   │  session affinity, 60m timeout
                     │  REST + WebSocket            │  holds the only TextModelService
                     └───────┬─────────────┬───────┘
                             │             │
                  BullMQ     │             │  Firestore / Storage / Auth
                             ▼             ▼
                     ┌──────────────┐   ┌──────────────┐
                     │   Memorystore │   │   Firebase   │
                     │   (Redis)     │   │              │
                     └──────┬───────┘   └──────────────┘
                            │ render queue
                            ▼
                     ┌─────────────────────────────┐
                     │ Cloud Run: creatordna-worker │  ffmpeg + chromium, 2–20 instances
                     │  the only place that renders │  scaled by queue depth
                     └─────────────────────────────┘
```

## Three decisions

### 1. The API owns the AI wrapper, the worker owns the encoder

The API never renders. The worker never calls a text model.

That split is what lets the two services scale on different axes. The API is I/O
bound — it is waiting on Gemini and on Firestore — so it scales on request
latency and can be small. The worker is CPU bound and bursty — ffmpeg threads,
hundreds of MB of frames in `/tmp` — so it scales on backlog and has to be large.

It also dictates where the learning loop runs. Its sweep needs an LLM, and the
one `TextModelService` that owns retries, timeouts, token logging and the
fallback model lives in the API. A BullMQ job in the worker would need a second
wrapper, which the architecture forbids. So the sweep is a timer in the API
process, documented as such in `apps/api/src/lib/dnaLearningScheduler.ts` with a
`TODO(phase-10)` to move it once the wrapper is extracted to a shared package.

### 2. One origin in the browser

The web app calls `/api/...` on its own origin, and Firebase Hosting rewrites that
to Cloud Run. There is no CORS configuration in production and the WebSocket is
same-origin, which also means the Firebase ID token needs no cookie workaround.

`VITE_API_URL` is therefore **empty in production**. Setting it would put a second
origin in the browser's CORS set for no benefit.

### 3. Progress is fan-out, not broadcast

The worker publishes a progress event to Redis pub/sub. Every API replica
subscribes and re-broadcasts to the sockets *it* holds.

This is why multiple API instances work without session affinity. Affinity is
configured on Cloud Run anyway — but for latency, not correctness: it removes a
reconnect round trip when an instance is replaced mid-render.

The corollary is a hard requirement: **`REDIS_ENABLED=false` disables live
progress.** There is no second path for the API to learn what the worker did. The
web app falls back to polling, so renders still complete; they just do not update
in real time.

## The request path

```
browser
  │  POST /api/v1/dna/extract
  ▼
Firebase Hosting ──rewrite──▶ Cloud Run (api)
  │
  ▼
routes/index.ts          URL → router
  │
  ▼
dna.routes.ts            requireAuth (Firebase token) → validate (zod) → controller
  │
  ▼
dna.controller.ts        request → service call, response envelope
  │
  ▼
dna.service.ts           business logic; calls the AI wrapper if it must
  │
  ▼
services/ai/wrapper.ts   retries, timeout, fallback model, zod validation,
  │                      one auto re-prompt, token/cost logging
  ▼
services/ai/geminiRestClient.ts   the only place a model URL is written
```

Every AI output is structured JSON validated with zod. On validation failure the
wrapper re-prompts **once** with the error, then fails gracefully — it does not
retry forever and it does not return unvalidated data.

## The render pipeline

Eight stages, in order, each producing an asset the next one reads:

| # | Stage | Weight | What it does |
| --- | --- | --- | --- |
| 1 | `script` | 20 | The script, in the creator's voice |
| 2 | `storyboard` | 15 | Scenes with durations, visual prompts, on-screen text |
| 3 | `assets` | 25 | One clip per scene (Veo), falling back to a still frame |
| 4 | `voice` | 10 | The voice-over (Gemini TTS), falling back to a tone bed |
| 5 | `music` | 8 | The music bed (Lyria), falling back to a synthetic bed |
| 6 | `captions` | 8 | Timed against the recorded audio, not the plan |
| 7 | `compose` | 10 | ffmpeg: H.264 9:16 with an AAC mix of voice and music |
| 8 | `qc` | 4 | Duration, dimensions and decodability of the finished file |

Weights come from `RENDER_STAGE_PLAN` in `packages/shared/src/lib/renderProgress.ts`
and are shared by the API and the web app, so the progress bar cannot drift from
what the worker reports.

**Why stages, not one job:** every asset is written to Storage with its URL on the
job document. A failed stage re-runs only itself — a render that fails at `compose`
does not re-generate clips the creator already paid for.

**Why captions align against the audio:** the plan's durations are exact for a
mock voice-over and approximate for a real one. Aligning against the recording
means captions do not drift on a real TTS voice.

## Autoscaling the worker

Cloud Run scales on request volume. A BullMQ worker has none, so the platform
cannot size this service on its own.

`apps/worker/src/lib/queueScaling.ts` is the policy — a pure, tested function.
`apps/worker/scripts/scaleWorker.ts` is the runner, scheduled by Cloud Scheduler.

```
render queue depth 20: 3 -> 5 instances (scaled, capacity 20 concurrent renders)
```

The policy is a **step function**, not `ceil(depth / concurrency)`. A render is
minutes long, so dividing by concurrency sizes the fleet for the queue as it is
*right now* — which lags a burst by exactly as long as a render takes, then
over-provisions while the queue drains. Steps grow ahead of the queue and hold
while it empties.

One subtlety: `active` is not subtracted from the depth. BullMQ reports waiting
and active separately, so a waiting job is never also an active one. `active`
instead keeps the floor high enough to finish renders already in flight — the
queue emptying is the one moment a render must not be cut out from under.

## What is deliberately not here

- **No Remotion yet.** `packages/render` composes with ffmpeg; the worker image
  installs chromium so enabling Remotion is a config change, not a rebuild.
- **No Terraform.** The Cloud Run specs are `gcloud run services replace`
  manifests. The project, Memorystore, Artifact Registry and IAM are assumed.
- **No cancel endpoint.** Cancel is client-side ("stop following") only.

## Further reading

- [`firestore-schema.md`](firestore-schema.md) — every collection and its rules
- [`api-reference.md`](api-reference.md) — every REST endpoint
- [`websocket-events.md`](websocket-events.md) — the two WebSocket protocols
- [`deployment.md`](deployment.md) — how this gets to production
