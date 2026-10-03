# @creatordna/shared

**Purpose:** the types, schemas and constants both sides of the wire agree on.
It is the only place a shape is allowed to be defined.

```
schemas/    zod schemas - dna, trend, hook, audience, renderJob,
            storyboard, health, api, voiceCoach, common
types/      the TypeScript types the schemas infer
constants/  PIPELINE_STAGES, RENDER_STAGE_PLAN, COST_LIMITS, WS_EVENTS,
            QUEUE_NAMES, MODEL_ENV_VARS, the enums
lib/        dnaCompleteness, dnaSyncScore, dnaContext, trendRelevance,
            liveCoachLimits, renderProgress
logger.ts   the structured logger both processes use
```

---

The types, schemas and constants both sides of the wire agree on. It is the
package the API, the worker, the render package and the web app all import, and
the only place a shape is allowed to be defined.

```
schemas/    zod schemas - dna, trend, hook, audience, renderJob,
            storyboard, health, api, voiceCoach, common
types/      the TypeScript types the schemas infer
constants/  PIPELINE_STAGES, RENDER_STAGE_PLAN, COST_LIMITS, the enums
lib/        dnaCompleteness, dnaSyncScore, dnaContext, trendRelevance,
            liveCoachLimits, renderProgress
logger.ts   the structured logger both processes use
```

Nothing in here imports Express, BullMQ, React or Firebase. If a schema needs to
know about HTTP, it does not belong here - put that on the side that owns the
transport.

## Why schemas live here

Every LLM output is parsed with one of these schemas, and every API response is
built from one. Two consumers of the same job document cannot disagree about what
a stage is called, what `progress` means, or which fields are optional, because
they read the same file. `renderJob.schema.ts` is the contract between the worker
that runs a render and the browser that watches it.

## Run

```bash
pnpm --filter @creatordna/shared test
```

`tsconfig.json` is `noEmit: true`; to build `dist/` for an app that consumes it
from build output, use `npx tsc -p tsconfig.build.json`.

## The files that carry weight

**`constants/PIPELINE_STAGES`** is the eight work stages, in order. It does not
include `queued`, `completed` or `failed` - those are job states, not stages, and
the render runner needs the distinction to know where to resume from.

**`lib/renderProgress.ts`** turns `stage` + `sceneIndex` into the percentage the
progress bar shows, so the UI and the worker cannot drift on what "60% done"
means.

**`lib/dnaCompleteness.ts`** and **`lib/dnaSyncScore.ts`** score how much of a
creator's DNA is filled in and how recently it was refreshed. Both feed the same
number the web app shows, which is why neither is computed in the front end.

**`lib/dnaContext.ts`** compresses a DNA profile into the block of text that gets
injected into every prompt. This is the product: the same writer's voice, every
time, whatever model answered.

**`lib/trendRelevance.ts`** ranks a trend against a profile. **`lib/liveCoachLimits.ts`**
holds the Live coach's turn and session caps.

## Changing a schema

Run the full suite afterwards, not just this package's. `apps/api` and `apps/web`
import the sources directly, so a widening change typechecks in one and breaks
the other at runtime. A field that becomes required is a migration, not an edit.
