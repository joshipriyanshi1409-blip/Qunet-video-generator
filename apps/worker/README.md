# @creatordna/worker

**Purpose:** the only process that renders. It consumes the BullMQ `render`
queue, runs the eight-stage pipeline in `@creatordna/render`, and is the only
place with an encoder installed.

```
src/jobs/       One handler per queue task (ping, render)
src/workers/    The BullMQ Worker instances
src/lib/        renderDeps (wiring), queueScaling (the autoscaling policy)
src/queues/     Queue definitions
src/config/     zod-validated environment, parsed once at boot
scripts/        scaleWorker.ts - sizes the fleet from queue depth
```

---

BullMQ worker for CreatorDNA Studio. This process owns **all heavy work** —
storyboarding, asset generation, composing, QC — so the API process stays
responsive.

## Run

```bash
cp .env.example .env
# Redis must be reachable
pnpm --filter @creatordna/worker dev        # tsx watch
# or, after `pnpm build`:
pnpm --filter @creatordna/worker start
```

With `REDIS_ENABLED=false` the process logs a warning and exits cleanly — useful
for CI and for running the API without a queue.

### Running without Firebase or model ids

All of these are optional in development, and the worker says which ones it is
running without in its boot log:

| Missing | What happens |
| ------- | ------------ |
| Firebase credentials | job documents go to `<WORKER_DATA_DIR>/render-jobs.json`, assets to `<WORKER_DATA_DIR>/assets/` |
| `GEMINI_TEXT_MODEL` | the whole pipeline runs on mock assets |
| `GEMINI_API_KEY` (or `VEO_MODEL`) | scenes render as still frames instead of clips |
| `GEMINI_API_KEY` (or `TTS_MODEL`) | the voice-over is a synthetic tone bed |
| `LYRIA_AUTHORIZATION` / `LYRIA_BASE_URL` (or `LYRIA_MODEL`) | the music bed is a synthetic two-note bed |
| `GEMINI_API_KEY` (or `TRANSCRIBE_MODEL`) | captions follow the storyboard's plan and drift from a real voice-over |
| `ffmpeg` | the mock composer writes a valid MP4 container with no encoded video |

The three media slots are wired **independently**, so a deployment with a text
key and nothing else gets a live storyboard and mock media — and the boot log
says exactly that, per slot. A model id with no credential beside it produces a
warning too, because that is a misconfiguration rather than a choice.

Set `RENDER_COMPOSER=ffmpeg` to make a missing encoder a boot failure instead of
a silent substitution.

### Media model credentials

`GEMINI_API_KEY` covers Veo (clips), the Gemini TTS model (voice-over) and caption
alignment, all through the public Generative Language API. Caption alignment is
not a separate speech service: it is an ordinary `generateContent` call with the
recorded voice-over passed inline, so `TRANSCRIBE_MODEL` is a multimodal text
model id like `GEMINI_TEXT_MODEL`.

**Lyria 2 is a Vertex AI model** and takes OAuth instead: set `LYRIA_AUTHORIZATION`
to a full header value (`Bearer ya29....`) and `LYRIA_BASE_URL` to your Vertex base
URL. This process does not refresh the token, so a long-lived deployment has to
re-mint it.

`MEDIA_TIMEOUT_MS` bounds one media call. Keep it under the BullMQ lock duration
(300s): a render that outlives its own lock is a render another worker starts
again from the beginning.

## Queues

| Queue    | Purpose                                        | Phase |
| -------- | ---------------------------------------------- | ----- |
| `ping`   | Demo job: sleeps `delayMs`, reports progress   | 2     |
| `render` | Approved script -> finished 9:16 MP4           | 7     |

Queue defaults live in `apps/api/src/lib/queues.ts`: 3 attempts, exponential
backoff starting at 1s, `removeOnComplete` after 1h/1000 jobs, `removeOnFail`
after 24h, and a `QUEUE_PREFIX` so CreatorDNA keys stay separate in a shared
Redis.

## The render worker

`src/workers/render.worker.ts` consumes the `render` queue. Two of its settings
are deliberate:

- **Concurrency is capped at 2** whatever `WORKER_CONCURRENCY` says. A render is
  minutes of CPU and hundreds of megabytes of scratch space; four at once because
  the ping worker can is how a laptop dies.
- **The lock duration is five minutes.** BullMQ's 30-second default would mark a
  render as stalled and hand it to another worker, which is the double-spend the
  `assets` array exists to prevent.

### Stage failure vs job failure

The processor **never throws for a stage failure**. It returns a
`RenderJobResult` with `stage: 'failed'`, because BullMQ re-runs a job whose
processor throws — and for a render that means regenerating clips the creator
already paid for. BullMQ's own attempts are reserved for a worker that died
before writing anything at all.

A stage failure lands on the job document as
`{ stage, message, attempts, retryable }`. `retryable` is set by the stage: a
model timeout is worth another attempt, a script over the eight-scene cap is not.

## Layout

```
src/
  config/     env.ts (zod, validated at boot) + derived config + model slots
  lib/        logger (pino, same shape as the api)
              renderDeps.ts - the pipeline's wiring, every fallback logged
  queues/     createWorkers(): ping + render, shared Redis connection
  workers/    ping.worker.ts, render.worker.ts - Worker wiring
  jobs/       ping.job.ts, render.job.ts - the processors
  index.ts    boot: env validation -> firebase (optional) -> workers -> shutdown
```

The pipeline itself lives in **`@creatordna/render`** — see that package's
README for the stages, the resume rules and the media writers.

## Tests

```bash
pnpm --filter @creatordna/worker test
```

26 tests, no Redis and no network required: env validation (including the
model-slot and render-pipeline variables), the ping processor, the render
processor (a completed run, a stage failure that resolves rather than throws, and
job data that fails the schema), and that both workers are constructed with the
producer's `QUEUE_PREFIX` and the render worker's concurrency and lock duration
are what they should be.

## Progress reaches the browser

The worker publishes `render.progress` events over Redis pub/sub. The API
subscribes and re-broadcasts them on `/ws` to whoever subscribed to
`render:<jobId>`. With `REDIS_ENABLED=false` there is no bus, and the browser
falls back to polling `GET /api/v1/render/:id` — which is why the job document,
not the event, is the source of truth.
