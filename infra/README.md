# Infrastructure

**Purpose:** everything needed to run CreatorDNA Studio somewhere other than a
laptop - containers, Cloud Run service specs, Firebase Hosting, and the CD that
moves them.

```
cloudrun/    4 service specs: api/worker x staging/production
firebase/    Firestore + Storage rules, indexes, Hosting config, .firebaserc
docker-compose.yml   Local Redis + an optional queue inspector
```

---

Everything needed to run CreatorDNA Studio somewhere other than a laptop:
containers, Cloud Run service definitions, Firebase Hosting, and the CD that
moves them.

```
infra/
  cloudrun/
    api.staging.yaml        API service spec (staging)
    api.production.yaml     API service spec (production)
    worker.staging.yaml     Worker service spec (staging)
    worker.production.yaml  Worker service spec (production)
  firebase/
    firebase.json           Firestore + Storage rules, Hosting, emulators
    .firebaserc             Project aliases (staging / production)
    firestore.rules
    firestore.indexes.json
    storage.rules
  docker-compose.yml        Local Redis + optional queue UI
```

---

## The shape of a deployment

```
                 ┌─────────────────────────────┐
   browser ──────▶  Firebase Hosting (web SPA)  │
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

Two things about that diagram are worth stating out loud, because they are the
decisions most likely to be second-guessed later:

**The API holds the WebSocket and the AI wrapper; the worker holds the encoder.**
That split is why the API is small and scales on latency while the worker is
large and scales on backlog. It is also why the learning loop's sweep is a timer
in the API rather than a BullMQ job — see `apps/api/src/lib/dnaLearningScheduler.ts`.

**The browser talks to one origin.** Hosting rewrites `/api/**` to Cloud Run, so
there is no CORS configuration in production and the WebSocket is same-origin.
`VITE_API_URL` stays empty on purpose.

---

## Local infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
# optional queue inspector:
docker compose -f infra/docker-compose.yml --profile tools up -d
```

Redis is the only external dependency for local development. Firestore, Storage
and the AI models are remote, and every one of them degrades to a local file or a
mock with a line in the boot log saying so.

---

## Building the images

Always from the repository root — the Dockerfiles need the whole monorepo,
because the workspace packages are consumed from their built `dist`:

```bash
docker build -f apps/api/Dockerfile   -t creatordna-api .
docker build -f apps/worker/Dockerfile -t creatordna-worker .
```

The root `.dockerignore` is load-bearing, not tidiness: `pnpm deploy` copies a
package directory into the image, and that directory holds a developer's real
`.env`. Without the ignore rule, local credentials end up baked into a production
image and `DEV_AUTH_BYPASS=true` can silently ship.

Both images run as a non-root user and use `dumb-init` as PID 1 so SIGTERM
reaches the app and its graceful shutdown actually runs.

### What the worker image carries

`ffmpeg` (the encoder behind `RENDER_COMPOSER=ffmpeg`), `chromium`, and
`fonts-liberation`. Chromium is not used by the pipeline today — `packages/render`
composes with ffmpeg — but Remotion is the intended production composer and will
need it, so it is installed now to make that a config change rather than a
rebuild. The font matters more than it sounds: without one, text drawn by ffmpeg
renders as boxes, and a caption track with no glyphs looks like a codec bug.

---

## Deploying

```bash
# Staging, on demand
gh workflow run cd.yml -f environment=staging

# Production, by pushing a tag
git tag v1.0.0 && git push origin v1.0.0
```

The workflow builds both images, pushes them to Artifact Registry, replaces the
Cloud Run services, deploys the web app to Hosting, and then verifies through
**Hosting rather than the Cloud Run URL** — because the rewrite is the part most
likely to be wrong and the part a direct probe never exercises.

### Prerequisites, once per project

```bash
# Artifact Registry
gcloud artifacts repositories create creatordna \
  --repository-format=docker --location=us-central1

# Memorystore (Redis). Note the network: the Cloud Run services need Direct VPC
# egress or a Serverless VPC Access connector to reach it.
gcloud redis instances create creatordna \
  --size=1 --region=us-central1 --redis-version=redis_7_0 \
  --network=projects/PROJECT_ID/global/networks/default

# A bucket for the worker's scratch files
gcloud storage buckets create gs://creatordna-worker-scratch \
  --location=us-central1

# Workload Identity Federation, so no service-account key is ever stored
# (see .github/workflows/cd.yml)
```

Then, as repository secrets: `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`,
`GCP_PROJECT_STAGING`, `GCP_PROJECT_PRODUCTION`, `FIREBASE_SERVICE_ACCOUNT_STAGING`.

---

## Autoscaling the worker

Cloud Run scales on request volume. A BullMQ worker has none, so the platform
cannot size this service on its own.

The policy lives in `apps/worker/src/lib/queueScaling.ts` and is a pure, tested
function. The runner is `apps/worker/scripts/scaleWorker.ts`; schedule it with
Cloud Scheduler (every 30s is enough, because a render takes minutes and the
steps are coarse).

```
render queue depth 20: 3 -> 5 instances (scaled, capacity 20 concurrent renders)
```

It reads `wait` and `active` from Redis and expresses "run N instances" as
`minScale = maxScale = N`, because those annotations are the only lever the Cloud
Run API exposes. It calls the API only when the decided count actually changed.

The policy is a **step function**, not `ceil(depth / concurrency)`. A render is
minutes long, so dividing by concurrency sizes the fleet for the queue as it is
right now — which lags a burst by exactly as long as a render takes, then
over-provisions while the queue drains. Steps grow ahead of the queue and hold
while it empties.

One subtlety worth keeping: `active` is not subtracted from the depth. BullMQ
reports waiting and active separately, so a waiting job is never also an active
one. `active` instead keeps the floor high enough to finish renders already in
flight — the queue emptying is the one moment a render must not be cut out from
under.

---

## Demo mode

`DEMO_MODE=true` makes every render stage read from a pre-baked cache, so a demo
render finishes in seconds with no API key and no quota. The cache is warmed by:

```bash
pnpm --filter @creatordna/api seed:demo
```

which also writes the demo creator's DNA and runs one render through the **real**
pipeline to produce the golden video.

Two rules, both enforced:

- `DEMO_CACHE_DIR` must be the same value in the API (which writes the cache) and
  the worker (which reads it), or the worker will not find what was warmed.
- `DEMO_MODE` is **refused in production** by the env validator. A cached render
  served to a real creator is a silent lie about what the product does.

---

## Firestore rules and indexes

`firestore.rules` covers `users/{uid}/{dna,jobs,assets,ideas,trends,signals,
suggestions,versions,learning}`, the top-level `renderJobs/{jobId}` and
`projects/{projectId}`, with a deny-all catch-all. The learning loop's
collections are create-only (`signals`), status-transition-only (`suggestions`),
and read-only to clients (`versions`, `learning`) — a client that could write a
version could rewrite its own history.

`firestore.indexes.json` carries the composite index the collection-group signal
query needs. Without it, the learning sweep fails at runtime rather than at
deploy, which is the worst time to find out.

```bash
firebase deploy --only firestore:rules,firestore:indexes --project creatordna-staging
```

---

## What is not here

- **No Terraform.** The Cloud Run specs are `gcloud run services replace`
  manifests; the project, Memorystore, Artifact Registry and IAM are assumed to
  exist. Turning this into Terraform is a reasonable next step and is deliberately
  not half-done.
- **No custom domain or TLS config.** Firebase Hosting and Cloud Run both
  terminate TLS; the wiring is in the console.
- **No alerting policies.** The signals to alert on are named in the root README;
  the policies themselves are not written.
