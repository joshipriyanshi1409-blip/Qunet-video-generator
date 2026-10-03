# API reference

REST under `/api/v1`, health at `/health`, WebSocket at `/ws` - all on one port.
Every response is a JSON envelope:

```json
{ "data": { } }              // success
{ "error": { "code": "", "message": "", "details": { } } }   // failure
```

## Authentication

Every endpoint below marked **auth** requires a Firebase ID token:

```
Authorization: Bearer <firebase-id-token>
```

The API verifies it on **every** request - there is no session cache to go stale.
The WebSocket cannot set headers on a handshake, so it takes the token as a query
parameter instead: `/ws?token=<idToken>`.

### Dev bypass

With `DEV_AUTH_BYPASS=true` and `NODE_ENV=development`, send `x-dev-uid: <uid>`
instead. The API logs a loud warning on boot, and the flag is **rejected at boot**
in production.

### Status codes

| Code | Meaning |
| --- | --- |
| 200 / 201 | Success. 201 is a new record (a signal, a job) |
| 400 | Malformed body |
| 401 | Missing or invalid token |
| 403 | Valid token, wrong owner |
| 404 | No such resource |
| 409 | Conflict - e.g. a suggestion already resolved |
| 422 | Zod validation failure |
| 429 | Rate limited |
| 503 | A dependency is unavailable (Redis off, Firebase unconfigured) |

---

## Health

No auth. These are what Cloud Run probes.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Service info + dependency checks. Unauthenticated on purpose: a broken instance should be drained, not sent traffic |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | 503 when a dependency is degraded |

```bash
curl -s localhost:4000/health
```

---

## Me

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| GET | `/api/v1/me` | yes | The verified caller. Doubles as a token-verification probe |

---

## Creator DNA

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| POST | `/api/v1/dna/extract` | yes | Onboarding answers + sample posts -> a DNA profile. Onboarding answers always win over the model's guesses |
| GET | `/api/v1/dna` | yes | The stored profile, with its score and context. 404 before onboarding |
| PUT | `/api/v1/dna` | yes | Edit the profile. Bumps `dnaVersion` only when the content actually changed |
| GET | `/api/v1/dna/context` | yes | The < 500-token block injected into prompts |

```bash
curl -s localhost:4000/api/v1/dna -H "Authorization: Bearer $TOKEN"
```

---

## Trends, remix and hooks

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| GET | `/api/v1/trends/for-me` | yes | The 20-format catalogue ranked against this creator's DNA. Cached for an hour |
| POST | `/api/v1/trends/remix` | yes | One trend (or a free-text idea) rewritten to fit the DNA, with an audit trail |
| POST | `/api/v1/trends/hooks` | yes | 5-8 hooks in distinct styles, each with why it works |
| POST | `/api/v1/trends/seed` | yes | Seeds the catalogue. Idempotent |

These three are model-backed and share a tighter per-creator rate limiter
(`AI_RATE_LIMIT_MAX` per `AI_RATE_LIMIT_WINDOW_MS`).

---

## Audience Mirror and approval

Mounted at the root of `/api/v1` (no sub-prefix), matching the screen that owns it.

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| POST | `/api/v1/audience-mirror` | yes | Per-segment reaction prediction + a tip per segment. Returns the project too |
| POST | `/api/v1/improve` | yes | Applies one audience tip to the hook or CTA |
| GET | `/api/v1/projects/:projectId` | yes | One project with every version |
| POST | `/api/v1/projects/:projectId/approve` | yes | Approves a version and enqueues the render. **Snapshots the DNA onto the job** |

---

## Render jobs

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| POST | `/api/v1/render` | yes | Accepts a script and enqueues a render |
| GET | `/api/v1/render/:id` | yes | Job state, stage, progress and every asset URL |
| POST | `/api/v1/render/:id/retry` | yes | Re-runs **only the failed stage** - cached assets are reused |

`POST /render` requires a finished script as input: `projectId`, `hook`,
`script[]` and `cta`. The API does not generate the script - that is what
`/trends/remix` and the mirror flow produce.

> **Known gap:** `startRender()` in `apps/web/src/lib/render.ts` has no caller and
> `CreatePage.tsx` is still a placeholder, so the browser cannot reach this
> endpoint yet. The endpoint itself works and is covered by the smoke test.

```bash
# a render with no script is a 422, not a 500
curl -s -X POST localhost:4000/api/v1/render \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{}'
```

---

## Learning loop

Mounted under the same `/dna` prefix as the profile: these are all operations on
one creator's DNA.

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| POST | `/api/v1/dna/signals` | yes | Record one signal. 201 - a signal is a new record |
| GET | `/api/v1/dna/signals` | yes | Recent signals. `?limit=` is clamped to `DNA_SIGNAL_LIMIT` |
| POST | `/api/v1/dna/suggestions/generate` | yes | Reasons over unseen signals. Rate limited harder - it is a model call |
| GET | `/api/v1/dna/suggestions` | yes | `?status=pending` to filter |
| POST | `/api/v1/dna/suggestions/:id/accept` | yes | **The only path that writes the DNA.** Returns the whole new profile |
| POST | `/api/v1/dna/suggestions/:id/reject` | yes | Leaves the DNA untouched |
| GET | `/api/v1/dna/versions` | yes | Version history, newest first |

Signal kinds: `hook_chosen`, `remix_approved`, `remix_rejected`,
`audience_tip_applied`.

### The two rules that matter

1. **`generate` never touches the profile.** It writes `pending` proposals and
   returns. When there is nothing new to reason over it returns
   `{skipped: true, reason: 'no-new-signals'}` **without calling the model at all** -
   the watermark is the cost guard, not the quota.
2. **A second `accept` is a 409, not a second application.** The proposal is
   already `accepted`, and the word is in the profile exactly once.

---

## Voice coach

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| GET | `/api/v1/voice-coach/quota` | yes | The daily cap and how much is left |
| POST | `/api/v1/voice-coach/feedback` | yes | Submits a session for feedback |

The live session itself is a WebSocket at `/ws/voice-coach` - see
[`websocket-events.md`](websocket-events.md).

---

## Jobs (demo)

| Method | Path | Auth | Notes |
| --- | --- | :--: | --- |
| POST | `/api/v1/jobs/ping` | yes | Enqueues the demo `ping` job |
| GET | `/api/v1/jobs/:jobId` | yes | State of one of *your* jobs |

---

## Rate limiting

Two limiters:

- A global one per IP (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`), skipped in tests.
- A tighter one per creator on every model-backed endpoint
  (`AI_RATE_LIMIT_MAX` per `AI_RATE_LIMIT_WINDOW_MS`).

429 responses carry the same error envelope, with `details: {limit, windowMs}`.

## Verifying it all

```bash
corepack pnpm --filter @creatordna/api smoke
```

40 checks over real HTTP: auth, DNA, trends, hooks, mirror, render jobs, the asset
mount, the WebSocket handshake, and the failure paths (503 when the queue is off,
401 without a token, 404 for a job that does not exist, 422 for a render with no
script).
