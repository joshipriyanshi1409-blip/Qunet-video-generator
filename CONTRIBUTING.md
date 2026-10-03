# Contributing to CreatorDNA

Thanks for your interest. This document is the contract: follow it and a review is
short.

## Ground rules

- **One phase at a time.** This repo was built phase by phase; each phase is a
  coherent slice. Keep that shape.
- **Runnable code over placeholders.** If something is not implemented, mark it
  `// TODO(phase-N)` rather than leaving a stub that looks real.
- **Never invent a method.** If you are unsure of an exact SDK signature, say so in
  the PR and check the official docs. A wrong-but-confident call is worse than a
  question.
- **Never commit secrets.** Only `.env.example` is tracked.

## Getting set up

```bash
corepack pnpm install
cp apps/api/.env.example    apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example    apps/web/.env
docker compose -f infra/docker-compose.yml up -d
corepack pnpm dev
```

Full walkthrough: [`docs/setup-local-dev.md`](docs/setup-local-dev.md).

## Verifying your change

```bash
bash verify-all.sh                              # tsc + eslint + vitest, six packages
corepack pnpm --filter @creatordna/api smoke    # 40 end-to-end checks over real HTTP
```

A PR that is not green does not get reviewed. If a test is genuinely unrelated to
your change, say so in the PR rather than skipping it.

## Code style

| Rule | Why |
| --- | --- |
| TypeScript strict, no `any` without a comment | `any` defeats the reason we use TS |
| All LLM output parsed with zod | Models return prose, not objects |
| Model ids in env/config, never hard-coded | `GEMINI_TEXT_MODEL` etc. exist so a model can be swapped without a code change |
| Layered backend: routes -> controllers -> services | Keeps the AI wrapper and Firestore out of the HTTP layer |
| One AI wrapper for every call | Retries, timeouts, token/cost logging and the fallback model live there |
| Heavy work in the worker, never the API | FFmpeg and Remotion must not sit on a request path |
| Every asset saved with its URL on the job | So a failed stage retries without redoing earlier stages |

### Tests we expect

- **Prompt builders** - the rendered text, and the variable names that produced it.
- **Zod schemas** - the valid case, the rejected case, and defaults.
- **Services** - the happy path plus one failure path.
- **Web components** - the user-visible outcome, not the internal state.

If a bug is worth fixing, it is worth a test that fails first.

### Commit messages

Conventional Commits:

```
feat(api): add learning-loop suggestion accept
fix(render): align captions against recorded audio
docs: describe the Firestore schema
chore: widen worker tsconfig to include scripts
```

## Architecture in one paragraph

The browser talks to one origin. Firebase Hosting rewrites `/api/**`, `/ws/**` and
`/health` to the Cloud Run API. The API owns the AI wrapper and every Firestore
write; the worker owns the encoder and consumes the render queue. The worker never
touches a socket - it publishes to Redis, and each API replica re-broadcasts to the
clients it holds.

Diagrams and the full request trace: [`docs/architecture.md`](docs/architecture.md).

## Adding a prompt template

1. Create `packages/prompts/src/templates/<name>.v1.ts` exporting `id`, `version`,
   `variables` and `build`.
2. Register it in `packages/prompts/src/index.ts`.
3. Update `registry.test.ts`'s hard-coded catalogue - adding a template breaks it
   on purpose, so the catalogue can never silently drift.
4. Add a test that asserts on the **rendered label**, not the variable name: the
   prompt prints `Target audience`, not `targetAudience`.

## Reporting a bug

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include the
logs. Please redact keys, tokens and emails first.

## Accessibility

Keyboard navigation, ARIA labels and colour contrast are requirements, not polish.
A PR that breaks them is a bug, even if the screenshot looks fine.

## Licence

Contributions are under the [MIT Licence](LICENSE).
