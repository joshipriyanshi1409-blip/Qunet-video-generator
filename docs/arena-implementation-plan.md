# Arena audit and implementation plan

## Repository audit (2026-10-03)

- `apps/api/src/services/ai/`: `TextModelClient`, Gemini REST adapter, stub, retry/timeout/schema-validation wrapper and a capability-based provider router. Optional OpenAI-compatible text serving configuration is now supported; no inference server is installed by default.
- `apps/api/src/services/orchestrator.ts`: project-level stages and caches; `apps/api/src/services/{dna,trend,audience,scriptCritic,renderJob}.service.ts` contain existing authoring flow. `apps/api/src/lib/` holds Firestore/local repositories, Redis cache, queues and render events.
- `apps/worker/`, `packages/render/`: BullMQ render worker and eight-stage render pipeline, media adapters, ffmpeg/mock composer, resume and per-stage assets. Media generation is separate from API text generation.
- `packages/shared/src/constants/contentFormats.ts`: 50 structured format recipes already exist; `packages/prompts/` holds versioned templates. Do not duplicate these.
- `apps/web/src/pages/CreatePage.tsx`: existing format/script form calls `startRender`; `RenderProgressPage` subscribes to render WebSocket. No Arena API/UI exists.
- `infra/firebase/`: Firestore rules/indexes and hosting rewrites. A running Arena must use the existing authentication, repository and worker infrastructure, not a second database.

## Implemented isolated foundation

`apps/api/src/services/ai/arena.ts` is a callable text Arena primitive, optionally wired to the API when model endpoints are configured. It accepts persistent `TextModelClient` adapters, selects eligible task-capable workers under declared RAM/VRAM limits, bounds concurrent candidate calls, generates valid JSON concurrently, uses one anonymous batched judge request, weights CreatorDNA/task fit, caches successful results in the existing Cache implementation, and emits callback events corresponding to actual operations. Fast mode uses one generation and no judge. Invalid/failed candidates are dropped; a failed judge fails closed. No stub response is manufactured.

## Integration plan (not implemented)

1. **Registry and backend configuration:** validate model endpoint IDs/URLs and hardware limits at startup; implement one reusable OpenAI-compatible client with restricted endpoint configuration and abortable streaming. Register only configured models. Integrate with existing wrapper for repair/retry and usage logs.
2. **Persistence:** add Firestore/local Arena battle, candidate and evaluation repositories with creator ownership and indexes; store only small text artifacts once and media in storage. Resume interrupted battles with stage checkpoints; make state transitions atomic. Cache keys must include prompt/rubric/model revisions and DNA version.
3. **Router and judges:** historical per-task/creator/format score/latency stats with decay; choose 2–3 models using availability and latency budget. Add one fourth only on low-margin results, and a second judge only when uncertain. Fail over on judge failure. Track outcomes without using Elo to decide the immediate winner.
4. **Task expansion:** connect hook/script/storyboard text tasks to existing orchestrator and format recipes; define Zod schemas and task-specific budgets/rubrics. Visual prompts can be judged before generating **one** media asset; voice samples only when requested. Keep deterministic captions and existing render stage retries.
5. **API/UI:** add server-backed status/history/selection, shared rate limits and real progress over existing WebSocket channels (or SSE); currently `/api/v1/arena/run` is synchronous and the Create page only displays winner after completion.
6. **Verification:** integration tests against configured real model endpoints and Redis/Firestore, end-to-end render test (including failure resume), resource/concurrency load tests for 1–4 models and UI tests. Do not publish latency numbers without measured hardware.

## Complexity and current limits

Current text primitive uses at most three concurrent generations plus one batch judge, i.e. O(N) generation calls and O(1) judging rounds; fast is one call. Per-model capacity is reserved during calls; coarse RAM/VRAM eligibility is static, not live GPU monitoring. Existing Redis cache can share completed results across replicas; the memory fallback is process-local. No cross-replica leases, persistent battle state, performance history, fourth-contestant adaptation, confidence verification, automatic JSON repair, fallback judge, real-time progress transport, or automated render integration yet. The authenticated hook/script route and Create-page selection now exist; selected text can be edited and submitted through the existing render form. Therefore the requested acceptance flow has **not** been run and must not be described as complete.
