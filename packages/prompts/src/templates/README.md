# Prompt templates

One file per prompt, one file per version. Register every template in
`../index.ts`:

```ts
import { prompts } from '../index.js';
import { trendRemixV1 } from './templates/trend-remix.v1.js';

prompts.register(trendRemixV1);
```

## Registered templates

| id               | version | Output                                     |
| ---------------- | ------- | ------------------------------------------ |
| `dna-extract`     | 1       | `creatorDnaSchema`                         |
| `trend-remix`     | 1       | `trendRemixSchema`                         |
| `hook-lab`        | 1       | `hookSetSchema`                            |
| `trend-relevance` | 1       | `trendRelevanceSchema`                     |
| `audience-mirror` | 1       | `audienceMirrorResultSchema`               |
| `improve-copy`    | 1       | `improvedCopySchema` (local, narrowed by the service) |
| `storyboard`      | 1       | `storyboardDraftSchema`                    |

## Rules

1. **Never hard-code a model id in a template.** Model ids come from env vars
   (`GEMINI_TEXT_MODEL`, `GEMINI_LIVE_MODEL`, `VEO_MODEL`, `LYRIA_MODEL`,
   `TTS_MODEL`, `TRANSCRIBE_MODEL`) and are read through the AI wrapper service.
2. **Every template declares an `outputSchema`.** All LLM output is structured
   JSON validated with zod; on failure the wrapper re-prompts once with the
   validation error, then fails gracefully.
3. **Bump, never edit.** To change wording, add `trend-remix.v2.ts` and register
   it. Old versions stay callable for rollback and for reproducing old renders.
4. **Variables are `{{snake_case}}`.** Interpolation is strict: a missing value or
   an unused value throws instead of silently producing a broken prompt.
5. **Creator DNA is injected, never assumed.** Templates receive the DNA fields
   as variables (`{{dna_niche}}`, `{{dna_tone}}`, ...) so the same prompt works for
   every creator.

See `trend-remix.v1.ts` for the shape (registered in Phase 4) and
`audience-mirror.v1.ts` for the per-segment prediction shape.
