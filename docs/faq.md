# FAQ

## Setup

**`pnpm: not found` when I run `pnpm build`.**
The root script calls bare `pnpm -r` inside `corepack pnpm build`. If `pnpm` is not
on `PATH`, install it or add a shim (`/home/user/bin/pnpm` exec'ing
`corepack pnpm` works). CI installs pnpm via `pnpm/action-setup`, so it is fine
there.

**`npx tsc` says "This is not the tsc command".**
You are running the `tsc` npm *package* shim, not the TypeScript compiler. Your
`node_modules` is missing: `corepack pnpm install`.

**The API boots and immediately exits with `Invalid environment configuration`.**
The zod validator prints the offending variables before it throws. Copy the missing
ones from `apps/api/.env.example`.

**It boots, but the log says "auth bypass enabled".**
`DEV_AUTH_BYPASS=true` with `NODE_ENV=development`. Send `x-dev-uid: <uid>` on
REST and `?dev_uid=` on WebSocket.

## Rendering

**Progress never moves; the bar sits at 0.**
The worker publishes to Redis and each API replica re-broadcasts to its own
sockets. With `REDIS_ENABLED=false` there is no such path, so the UI polls instead.
Start Redis (`infra/docker-compose.yml`).

**The video downloads but has no picture.**
No ffmpeg on the worker; the mock composer produces a valid container with a black
track. The boot log names the composer in use. Install ffmpeg or set
`FFMPEG_PATH`.

**A render fails at one stage and the retry redoes everything.**
It should not. Every stage writes its asset to Storage and records the URL on the
job document, and a retry re-runs **only the failed stage** - cached assets are
reused. If you see a full re-run, the asset store was reset between attempts.

**Why does the job document hold a `dna` field?**
Because the DNA is snapshotted at accept time, not read live. A retry next month
must reproduce the same storyboard, and "why did this sound unlike me?" needs the
profile that was actually injected.

**Why is the render job top-level and not under my uid?**
So the worker can find it without knowing whose it is. The security rules still
restrict reads to the owner.

**`DEMO_MODE=true` is refused at boot.**
Deliberate: it fails when `NODE_ENV=production`, so a demo cache can never silently
serve a paying creator.

**The cache is stale after I change a prompt.**
Slots, not content hashes - `clip:<sceneIndex>` reuses a cached clip regardless of
the prompt text. Clear `DEMO_CACHE_DIR` after a prompt change. This is also why
`DEMO_CACHE_DIR` must match between the API (which writes) and the worker (which
reads).

## Models and cost

**Where do I set the model names?**
Nowhere in code. `GEMINI_TEXT_MODEL`, `GEMINI_LIVE_MODEL`, `VEO_MODEL`,
`LYRIA_MODEL`, `TTS_MODEL`, `TRANSCRIBE_MODEL` and `AI_FALLBACK_MODEL` are env
vars, and the AI wrapper resolves them at call time. Check the official Google
docs for the current names.

**What happens if a model id is wrong?**
The call fails and the wrapper retries once with `AI_FALLBACK_MODEL`, then fails
gracefully. Nothing falls back to a hard-coded default.

**The output is not valid JSON.**
Every model output is parsed with zod. On failure the wrapper re-prompts once with
the validation error, then gives up with a structured error. A second failure is
reported, not retried.

**Lyria says 401.**
Lyria 2 is Vertex-only and authenticates with a GCP bearer token, not an API key.
`LYRIA_AUTHORIZATION` must be `Bearer <token>` and is short-lived - the process
does not refresh it.

**How much does a session cost me?**
Every AI call logs tokens and a cost estimate through the wrapper's logger. The
`usage` line is per model, so you can attribute spend per stage.

**What stops a runaway?**
Max scenes per video, a 15-45s duration window, a per-creator daily quota, a
rate limiter on every model-backed endpoint, and a render cap on the queue.

## The learning loop

**Does the app edit my DNA on its own?**
No. `generateSuggestions` writes `pending` proposals with their evidence and
returns. Only `POST /dna/suggestions/:id/accept` touches the profile, and the
modal shows the rationale next to the button.

**Why is `GET /dna/versions` read-only?**
Because a client that could write a version could rewrite its own history. The
service writes versions; clients read them.

**Why does the history recompute the score from the snapshot?**
So the history ring can never drift from the ring on My DNA - both are derived
from the same data.

**What is `learning/state` for?**
A watermark (`lastRunAt`) that keeps the sweep affordable: signals newer than it
are "unseen". When a run legitimately proposes nothing, it returns
`{skipped: true, reason: 'no-new-signals'}` **without calling the model**. The
watermark is the cost guard.

**If I accept the same suggestion twice?**
The second call is a `409`, not a second application.

**I have more than 50 suggestions and one 404s on accept.**
Known: the lookup path lists suggestions and finds by id, so >50 stored proposals
can miss. Fix is to look the suggestion up by id directly. Not yet done.

## Web and browser

**Why does the dev server proxy `/api`?**
So the browser talks to one origin. `VITE_API_PROXY_TARGET` points at the API;
client code never contains `localhost` URLs.

**Why is `VITE_API_URL` empty in production?**
Firebase Hosting rewrites `/api/**`, `/ws/**` and `/health` to Cloud Run on the
same origin, so there is nothing to point at. Set it only to target a different
backend.

**My signal never shows up in the learning loop.**
The loop skips suggestions when `evidences` is empty *and* the profile has no
incomplete fields. Otherwise signals are batched - a fresh signal waits for the
next run.

**The app is broken for keyboard users.**
Please file an issue. Accessibility is a standing requirement - keyboard nav, ARIA
labels and contrast - and regressions are treated as bugs.

## Deployment

**My GitHub Pages site is a blank page.**
Pages was never enabled: **Settings -> Pages -> Source -> GitHub Actions**. The
workflow cannot do that for you.

**How do I deploy without pushing?**
`gh workflow run deploy.yml` from a terminal, or **Actions -> Run workflow** in the
browser. GitHub Pages has no "deploy now" button of its own.

**The worker is not scaling with the queue.**
Right - the policy is tested but the Cloud Scheduler job that invokes
`scale:worker` every ~30s is not written yet. Until then the spec's
`minScale = maxScale` is a pin, not a scale.

**Nothing can connect to Redis in production.**
`REDIS_URL` and `REDIS_PREFIX` must match between the API and the worker, and both
need the same `REDIS_ENABLED`.

## Testing

**Why are there no WebSocket tests in jsdom?**
jsdom has no usable WebSocket. The handshake is tested in
`apps/api/src/__tests__/ws.test.ts` against a real `ws` server instead.

**How do I check the whole stack at once?**
`bash verify-all.sh` runs tsc, eslint and vitest across all six packages.

**The API smoke test fails immediately.**
It needs the API running (`pnpm --filter @creatordna/api dev`). It also refuses to
run against a live external API - it is deliberately hermetic.
