# Deployment

Two hosting paths, both automated:

| App | Host | Trigger |
| --- | --- | --- |
| web | GitHub Pages | every push to `main` (`.github/workflows/deploy.yml`) |
| api, ws | Cloud Run | `.github/workflows/cd.yml` |
| worker | Cloud Run | `.github/workflows/cd.yml` |

---

## GitHub Pages (web)

`deploy.yml` builds `apps/web` and publishes `apps/web/dist` to GitHub Pages.

```
push to main ──▶ build ──▶ configure-pages ──▶ upload-pages-artifact ──▶ deploy-pages
```

| Step | What it does |
| --- | --- |
| `build` | pnpm install (frozen lockfile) + `pnpm --filter @creatordna/web build` + upload artifact |
| `configure-pages` | Runs once, declares the Pages source (GitHub Actions) |
| `upload-pages-artifact` | Uploads `apps/web/dist` |
| `deploy-pages` | Publishes it |

### First-time setup (do this once)

The workflow **cannot** enable Pages for you - that is a repository setting:

1. Push `main` once.
2. Go to **Settings -> Pages**.
3. Under *Build and deployment*, set **Source** to **GitHub Actions**.
4. Save. The push's run then finishes, and every later push deploys on its own.

The URL will be:

```
https://<username>.github.io/<repo-name>/
```

### Triggering it manually

GitHub Pages does not expose a "deploy" button, so trigger the workflow instead:

```bash
gh workflow run deploy.yml --repo <username>/<repo-name>
```

Or in the browser: **Actions -> Deploy web to GitHub Pages -> Run workflow -> Run**,
then **Actions -> the running run -> Re-run jobs** if you want it again.

> This is a *static* build. In production `VITE_API_URL` is empty and the browser
> calls `/api`, `/health` and `/ws` on the **same origin** - so a Pages deployment
> alone talks to nothing. Point the API at Cloud Run separately (below), or leave
> the URL as the staging API.

---

## Cloud Run (api + worker)

`.github/workflows/cd.yml`:

```
plan ──▶ build ──▶ deploy-api ──▶ deploy-worker ──▶ deploy-web ──▶ verify
```

| Trigger | Environment |
| --- | --- |
| tag `v*` | production |
| `workflow_dispatch` (`staging` or `production`) | that environment |

`build` is a matrix over `api` and `worker`; the two `deploy-*` jobs both depend
on it, so one broken image blocks neither deploy alone.

### Authentication - no long-lived keys

`cd.yml` uses **Workload Identity Federation**:

```yaml
permissions:
  contents: read
  id-token: write
```

Google's `auth` action exchanges a GitHub OIDC token for a short-lived GCP
credential. Nothing to rotate and nothing to leak.

### What the deploy does

| Job | Steps |
| --- | --- |
| `deploy-api` | `gcloud auth` -> `docker build` `apps/api/Dockerfile` -> push Artifact Registry -> `gcloud run deploy` with the env/secret set -> verify |
| `deploy-worker` | same, plus a wait on the service revision to become ready |
| `deploy-web` | `firebase deploy --only hosting:live` |
| `verify` | `GET /health` **through Firebase Hosting**, so it checks the rewrites too |

### Prerequisites (one-time, per project)

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com cloudresourcemanager.googleapis.com

gcloud artifacts repositories create creatordna \
  --repository-format=docker --location=us-central1

# A pool + provider so GitHub can mint GCP tokens (OIDC, no service-account key)
gcloud iam workload-identity-pools create github-pool --location=global
gcloud iam workload-identity-pools providers create github-provider \
  --location=global --workload-identity-pool=github-pool \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"
```

Then grant the pool's principal `roles/run.admin`, `roles/artifactregistry.writer`,
`roles/iam.serviceAccountUser` and `roles/storage.admin` (the last only if the web
deploy writes Storage).

### Autoscaling the worker

Cloud Run has no BullMQ trigger, so depth is a queue-depth policy rather than a
request-count one:

```bash
corepack pnpm --filter @creatordna/worker scale:worker
```

Reads `<prefix>:render:wait` and `<prefix>:render:active` from Redis, then PATCHes
`autoscaling.knative.dev.{min,max}Scale` on the Cloud Run service. Step policy -
not `ceil(depth/concurrency)`, because renders are minutes long and concurrency
overshoot is the expensive mistake.

**Still missing: a Cloud Scheduler job to invoke it every ~30s.** Without a
scheduler this is a script, not an autoscaler. Until then the production spec's
`minScale = maxScale` is a **pin**, and a real autoscaler is the follow-up.

### Redis

Both processes need the same `REDIS_URL` and `REDIS_PREFIX` (production uses
Memorystore). Setting `REDIS_ENABLED=false` works but turns render progress into
polling - see [`websocket-events.md`](websocket-events.md).

---

## Environment and secrets

Full variable index: [`ENVIRONMENT.md`](ENVIRONMENT.md). Runbook, image contents
and Cloud Run specifics: [`../infra/README.md`](../infra/README.md).

Secrets come from Google Secret Manager via `secretRef` in the Cloud Run specs -
never from workflow env blocks.

```bash
echo -n "$(openssl rand -hex 32)" | gcloud secrets create api-session-secret --data-file=-
```

### Flags that refuse to run in production

| Variable | Behaviour |
| --- | --- |
| `DEV_AUTH_BYPASS=true` | Boot fails when `NODE_ENV=production` |
| `DEMO_MODE=true` | Boot fails when `NODE_ENV=production` |

---

## The GitHub Pages demo

The live link in the root README is:

```
https://<username>.github.io/<repo-name>/
```

To point it at real data instead of the default API, set `VITE_API_URL` as a
repository variable (Settings -> Secrets and variables -> Actions -> Variables) -
the `build` job reads it, so it does not need a rebuild locally.

To run a **demo with no network at all**, see
[`setup-local-dev.md`](setup-local-dev.md) step 6: `seed:demo` + `DEMO_MODE=true`
gives a golden video with no API key and no ffmpeg.
