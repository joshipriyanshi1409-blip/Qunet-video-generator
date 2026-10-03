# Local development setup

From nothing to a running stack, including the no-keys path.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node | `20` (see `.nvmrc`) | The runtime |
| pnpm | >= 10 | The workspace package manager |
| Docker | any recent | Redis, via `infra/docker-compose.yml` |

Optional, for real renders: `ffmpeg` on `PATH` (or set `FFMPEG_PATH`). Without it
the composer falls back to a mock that produces a valid MP4 container with no
encoded video, and the boot log says so.

## 1. Clone and install

```bash
git clone https://github.com/<username>/<repo-name>.git
cd <repo-name>
corepack pnpm install
```

> In some sandboxes `pnpm` is not on `PATH` and only `corepack pnpm` works. If
> `pnpm build` fails with `sh: 1: pnpm: not found`, the nested `pnpm -r` call in
> the root script cannot find the binary - put a `pnpm` shim on `PATH` or use a
> shell where corepack has linked it.

## 2. Configure the environment

```bash
cp apps/api/.env.example    apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example    apps/web/.env
```

**The defaults run the whole stack with no Firebase project and no AI key.** That
is deliberate:

- `DEV_AUTH_BYPASS=true` authenticates via an `x-dev-uid` header instead of a
  Firebase ID token.
- Every AI slot that has no model id falls back to a mock generator, and the boot
  log names the slot that degraded.

> 🔑 **Never commit `.env`.** It is git-ignored; only `.env.example` is tracked.

## 3. Start Redis

```bash
docker compose -f infra/docker-compose.yml up -d
```

Optional queue inspector:

```bash
docker compose -f infra/docker-compose.yml --profile tools up -d   # :8081
```

## 4. Run everything

```bash
corepack pnpm dev
```

| App | URL | Notes |
| --- | --- | --- |
| web | http://localhost:5173 | Vite dev server, proxies `/api`, `/health`, `/ws` |
| api | http://localhost:4000 | `GET /health`, REST under `/api/v1`, WS at `/ws` |
| worker | - | BullMQ worker, logs to stdout |

The dev server proxies to `VITE_API_PROXY_TARGET` (default
`http://127.0.0.1:4000`), so the browser always talks to the same origin it
loaded from. No `localhost` URLs in client code.

## 5. Walk the product

1. Open http://localhost:5173. `/login` shows the **local development bypass** -
   click it. The session uid is written to `localStorage` under
   `creatordna.dev-uid`.
2. **Onboarding** - five steps: niche, audience, tone, format, sample posts.
   Submit calls `POST /api/v1/dna/extract`.
3. **My DNA** - the animated sync ring, the Content / Audience / Style cards, and
   your sample posts. Reload: it is still there, from `GET /api/v1/dna`.
4. **Trends** - pick one, **Remix this trend**, then **Use this**.
5. **Audience Mirror** - run it, apply a tip.
6. **Hook Lab** - write hooks, pick one, send it to Create.
7. **Create** - render. Watch eight stages progress over the WebSocket.

## 6. Seed the demo

The fastest path to a full-looking account:

```bash
corepack pnpm --filter @creatordna/api seed:demo
```

This writes a demo creator (`demo-creator`) with a complete DNA profile, warms the
render cache, and runs one render through the **real** pipeline to produce the
golden video. It is idempotent.

Then make renders instant and free:

```bash
echo "DEMO_MODE=true" >> apps/worker/.env
```

To reset between demos:

```bash
rm -rf apps/api/.data
corepack pnpm --filter @creatordna/api seed:demo
```

## Verifying the setup

```bash
bash verify-all.sh                              # tsc + eslint + vitest, six packages
corepack pnpm --filter @creatordna/api smoke    # 40 end-to-end checks over real HTTP
```

The smoke test needs the API running. It is the fastest signal that the
environment is wired correctly, because it exercises auth, Redis, the AI wrapper
and the asset mount together.

---

## Optional: real Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable Auth (Google + email/password), Firestore and Storage.
3. Generate a service-account key, then set in `apps/api/.env` and
   `apps/worker/.env`:

```bash
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=...@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
```

Keep the literal `\n` escapes - the app converts them at boot. Or point at a file
with `GOOGLE_APPLICATION_CREDENTIALS`.

4. Copy the web config into `apps/web/.env`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

5. Deploy rules and indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project your-project
```

6. Set `DEV_AUTH_BYPASS=false` and restart the API.

## Optional: real models

Model ids are **never hard-coded** - they arrive through the environment, and a
missing one fails loudly at the AI wrapper rather than falling back to a default
that may not exist in your account.

```bash
# apps/api/.env
GEMINI_TEXT_MODEL=<the text/JSON model you have confirmed is available>
GEMINI_LIVE_MODEL=<the Live API model>
AI_FALLBACK_MODEL=<used when the primary is unavailable>

# apps/worker/.env
GEMINI_API_KEY=<one key covers Veo clips and TTS>
VEO_MODEL=...
TTS_MODEL=...
TTS_VOICE_NAME=Kore            # a speaker name, not a model id
TRANSCRIBE_MODEL=...
LYRIA_MODEL=...
LYRIA_AUTHORIZATION="Bearer ya29...."   # Lyria is Vertex-only: OAuth, not an API key
LYRIA_BASE_URL=https://us-central1-aiplatform.googleapis.com/v1
```

Check the official Google docs for the exact current model names before setting
them. `LYRIA_AUTHORIZATION` is the one credential with a short lifetime - it is a
token this process does not refresh, so a deployment that outlives it needs to
re-mint.

## Optional: the Firebase emulators

```bash
firebase emulators:start --project demo-project
```

Auth on `:9099`, Firestore on `:8080`, Storage on `:9199`, Hosting on `:5000`, UI
on `:4001`. Configured in `infra/firebase/firebase.json`.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `sh: 1: pnpm: not found` | `pnpm` is not on `PATH`; use `corepack pnpm` or add a shim |
| `npx tsc` prints "This is not the tsc command" | `node_modules` is missing - run `corepack pnpm install` |
| API boots but every queue call logs `ECONNREFUSED` | Redis is not running |
| `Invalid environment configuration` at boot | Read the formatted list - the validator names every offending variable |
| Renders complete but progress never moves | `REDIS_ENABLED=false` - see [`websocket-events.md`](websocket-events.md) |
| The video is a tiny file with no picture | No ffmpeg; the mock composer is in use. The boot log says which |
| `DEMO_MODE` is rejected at boot | `NODE_ENV=production` refuses it by design |

## Full variable reference

[`ENVIRONMENT.md`](ENVIRONMENT.md) - every variable, which process reads it, and
where each secret lives in production.
