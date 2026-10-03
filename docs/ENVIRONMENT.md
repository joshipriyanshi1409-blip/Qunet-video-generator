# Environment variables

Every variable the three processes read, in one place. Nothing here is a secret
value — only the *names* — and nothing in this repository holds a real one.

The rule the codebase enforces: **model ids are never hard-coded.** They arrive
through the environment and a missing one fails loudly at the AI wrapper rather
than falling back to a default that may not exist in your account.

## Where each variable is read

| Variable | api | worker | web (build) |
| --- | :--: | :--: | :--: |
| `NODE_ENV` | ✅ | ✅ | |
| `HOST`, `PORT` | ✅ | | |
| `LOG_LEVEL`, `LOG_PRETTY` | ✅ | ✅ | |
| `REDIS_URL`, `REDIS_ENABLED`, `QUEUE_PREFIX` | ✅ | ✅ | |
| `CORS_ORIGINS` | ✅ | | |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_STORAGE_BUCKET` | ✅ | ✅ | |
| `GEMINI_API_KEY`, `TTS_VOICE_NAME`, `LYRIA_AUTHORIZATION`, `LYRIA_BASE_URL` | | ✅ | |
| `GEMINI_TEXT_MODEL`, `GEMINI_LIVE_MODEL`, `VEO_MODEL`, `LYRIA_MODEL`, `TTS_MODEL`, `TRANSCRIBE_MODEL`, `AI_FALLBACK_MODEL` | ✅ | ✅ | |
| `VITE_API_URL` | | | ✅ |
| `DEMO_MODE`, `DEMO_CACHE_DIR` | ✅ | ✅ | |

`.env.example` in each app is the annotated source of truth; this file is the
index.

---

## Shared

### `NODE_ENV`
`development` | `test` | `production`. Two things change with it: the env
validator refuses `DEV_AUTH_BYPASS`, `AI_STUB_CLIENT` and `DEMO_MODE` in
production, and `LOG_PRETTY` is ignored above `development`.

### `LOG_LEVEL`, `LOG_PRETTY`
`fatal` | `error` | `warn` | `info` | `debug` | `trace` | `silent`.
Keep `LOG_PRETTY=false` in production: pretty logs are for humans and Cloud
Logging parses JSON fields, not coloured text.

### `REDIS_URL`
Defaults to `redis://127.0.0.1:6379`. On Cloud Run, point this at Memorystore.
Because Memorystore is not reachable from outside its VPC, the API and worker
need **Direct VPC egress** (or a Serverless VPC Access connector) — without it
they will boot and then log `ECONNREFUSED` for every queue operation.

### `REDIS_ENABLED`
Default `true`. Setting it `false` disables BullMQ *and* the render progress
pub/sub, which means **live progress stops working** — the API has no other way
to learn what the worker did. The web app falls back to polling, so renders still
complete; they just do not update in real time. There is no production
configuration in which this should be `true`→`false`.

### `QUEUE_PREFIX`
Default `creatordna`. Keeps CreatorDNA's BullMQ keys separate in a shared Redis.

---

## API

### `CORS_ORIGINS`
Comma-separated allowlist. **Only needed when the web app is on a different
origin from the API.** The deployed setup puts both behind Firebase Hosting, so
the browser sees one origin and this list can stay empty. It matters for local
development, where Vite serves `:5173` and the API serves `:4000`.

### `FIREBASE_*`
Required in production. The env validator refuses to boot the API in production
without `FIREBASE_PROJECT_ID` plus a credential, because token verification is
not optional in production.

`FIREBASE_PRIVATE_KEY` keeps its literal `\n` escapes — the app converts them at
boot. `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON is the
alternative, and is the one to prefer on Cloud Run: the platform attaches the
service account for you and no key is ever written anywhere.

### `DEV_AUTH_BYPASS`
`true` makes protected endpoints trust the `x-dev-uid` header instead of a
Firebase ID token. **Refused in production.** This is the single most dangerous
flag in the repo: with it on, anyone who can reach the port can be anyone.

### `AI_STUB_CLIENT`
`true` makes DNA extraction use a fake client so the whole `/dna` flow demos
without a key. **Refused in production.** It is a development affordance, not a
fallback — a production render with no key degrades per-slot and says so in the
boot log, which is a different and honest thing.

### `RENDER_ASSET_DIR`, `RENDER_ASSET_MOUNT`
Development only. The worker writes assets to a local directory and the API
serves it read-only at `RENDER_ASSET_MOUNT`. In production the worker uploads to
Firebase Storage and this mount is unused.

### `RENDER_COMPOSER`, `FFMPEG_PATH`
`auto` | `ffmpeg` | `mock`. Used by the **demo seed script**, which composes a
golden video in the API process. The API itself never renders.

### `DEMO_CACHE_DIR`
Where the demo render cache lives, default `.data/demo-cache`. Must be the same
value in the API (which writes it via `seed:demo`) and the worker (which reads it
when `DEMO_MODE=true`), or the worker will not find what was warmed.

### `DNA_LEARN_*`
`DNA_SIGNAL_LIMIT` (30), `DNA_MAX_SUGGESTIONS` (6), `DNA_LEARN_INTERVAL_MS`
(6h), `DNA_LEARN_BATCH_SIZE` (25), `DNA_LEARN_ENABLED` (true). The learning
loop's sweep runs as a timer **in the API process**, because the API owns the
single `TextModelService` wrapper and a worker job would need a second one.

### Model ids
`GEMINI_TEXT_MODEL` and `GEMINI_LIVE_MODEL` are read by the API. `VEO_MODEL`,
`LYRIA_MODEL`, `TTS_MODEL` and `TRANSCRIBE_MODEL` are read by the **worker**,
which is where the render pipeline runs — set them there, not here. A missing id
fails at call time rather than falling back.

---

## Worker

### `WORKER_CONCURRENCY`
Default 4. Renders one instance handles at once. This is also the number the
autoscaler divides by when it sizes the fleet.

### `JOB_MAX_ATTEMPTS`
Default 3. Only the failed stage re-runs; assets already written are reused.

### `WORKER_DATA_DIR`
Default `.data`. Holds job documents, the local asset store and per-job scratch
files when Firebase is not configured. On Cloud Run this is a Cloud Storage
bucket mounted with `gcsfuse`, so a retry can re-read an earlier stage's output.

### `RENDER_COMPOSER`, `FFMPEG_PATH`
`auto` uses ffmpeg when the binary runs and the mock otherwise. In the deployed
worker image ffmpeg is installed from Debian and is on `PATH`, so `FFMPEG_PATH`
is unnecessary there. `RENDER_COMPOSER=ffmpeg` is what production sets: it fails
at boot rather than discovering halfway through a render that there is no
encoder.

### `GEMINI_API_KEY`
Used by Veo (clips) and the Gemini TTS model (voice-over). Optional: with no key
the render still runs and those slots fall back to mock generators, and the boot
log says which slot degraded.

### `TTS_VOICE_NAME`
A prebuilt **speaker** name (for example `Kore`), not a model id. This is the one
place a "voice" is a name rather than a slot.

### `LYRIA_AUTHORIZATION`, `LYRIA_BASE_URL`
Lyria 2 is a Vertex AI model and authenticates with OAuth, not an API key. Supply
a full header value, e.g. `Bearer ya29....`, minted from a service account. This
process does not refresh it — a deployment that outlives the token needs to
re-mint. That is the one credential in the stack with a short lifetime, and it is
worth knowing before a long render fails on it.

### `MEDIA_POLL_INTERVAL_MS`, `MEDIA_TIMEOUT_MS`
How often to poll a Veo long-running operation, and how long to wait for one
media call. Keep `MEDIA_TIMEOUT_MS` **under the BullMQ lock duration (300s)**: a
render that outlives its own lock is a render another worker starts again from
the beginning.

### `DEMO_MODE`, `DEMO_CACHE_DIR`
`DEMO_MODE=true` serves every render stage from the pre-baked cache: a demo
render finishes in seconds with no API key. **Refused in production** — a cached
render served to a real creator is a silent lie about what the product does.

---

## Web (build time)

### `VITE_API_URL`
**Empty by default, and empty is correct for the deployed app.** The web app
calls `/api/...` on its own origin and Firebase Hosting rewrites that to Cloud
Run. Setting this would put a second origin in the browser's CORS set for no
benefit, and would make the WebSocket path a cross-origin one.

Set it only when the API genuinely lives on another origin — local development
against a remote API, for instance.

---

## Secrets, and where they live

| Secret | Where it lives in production |
| --- | --- |
| Firebase service account | The Cloud Run service account's attached identity. No key file. |
| `GEMINI_API_KEY` | Secret Manager, injected via `envFrom.secretRef` |
| `LYRIA_AUTHORIZATION` | Secret Manager. Short-lived — see above. |
| `REDIS_URL` | Secret Manager (it contains no credential on Memorystore with AUTH, but treat it as one) |
| `DEMO_*` | Not secrets. Plain env vars. |

GitHub Actions authenticates to GCP with **Workload Identity Federation**, so no
service-account JSON is ever stored as a repository secret. The workflow asks for
`id-token: write` and exchanges it for a short-lived token.

### What to set for a first staging deploy

```
NODE_ENV=production
LOG_LEVEL=info
LOG_PRETTY=false
REDIS_URL=redis://<memorystore-host>:6379
CORS_ORIGINS=            # empty: Hosting proxies same-origin
FIREBASE_PROJECT_ID=…
GOOGLE_APPLICATION_CREDENTIALS=   # or leave unset and use the attached SA
DEMO_MODE=false
DNA_LEARN_INTERVAL_MS=21600000
```

Plus, on the worker: `RENDER_COMPOSER=ffmpeg`, `WORKER_CONCURRENCY=4`, and the
model ids you have actually confirmed exist in your account.
