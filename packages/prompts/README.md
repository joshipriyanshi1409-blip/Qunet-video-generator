# @creatordna/prompts

**Purpose:** the versioned prompt registry. Every LLM call in the product goes
through a registered template, so a prompt change is a version bump rather than a
silent behaviour change.

```
src/templates/   One file per prompt, named <id>.v<N>.ts
src/index.ts     The registry: register + render, strict interpolation
```

Templates registered today:

| id | version | Used by |
| --- | --- | --- |
| `dna-extract` | 1 | Onboarding -> a Creator DNA profile |
| `dna-learn` | 1 | The learning loop's proposals |
| `trend-relevance` | 1 | Ranking the catalogue against a DNA |
| `trend-remix` | 1 | Remixing one trend into the creator's voice |
| `hook-lab` | 1 | A spread of hooks in distinct styles |
| `audience-mirror` | 1 | Per-segment reaction prediction |
| `improve-copy` | 1 | Applying one audience tip |
| `storyboard` | 1 | The render pipeline's scene breakdown |

---

Every prompt the studio sends, versioned. A template is a string with
`{{snake_case}}` variables, an `outputSchema`, and a version number - nothing
else. It does not know which model will answer it.

```
src/templates/     one file per prompt per version (+ a README for authors)
src/registry.ts    the id -> template lookup
src/render.ts      strict {{variable}} interpolation
src/errors.ts      the template errors
src/index.ts       the `prompts` registry, with everything registered
```

## Run

```bash
pnpm --filter @creatordna/prompts test
```

## Registered templates

| id               | version | Output                                 |
| ---------------- | ------- | -------------------------------------- |
| `dna-extract`     | 1       | `creatorDnaSchema`                     |
| `trend-remix`     | 1       | `trendRemixSchema`                     |
| `hook-lab`        | 1       | `hookSetSchema`                        |
| `trend-relevance` | 1       | `trendRelevanceSchema`                 |
| `audience-mirror` | 1       | `audienceMirrorResultSchema`           |
| `improve-copy`    | 1       | `improvedCopySchema` (narrowed by the service) |
| `storyboard`      | 1       | `storyboardSchema`                     |

`storyboard.v1` is the one the render pipeline uses: it turns a script into the
scene list that drives clips, captions and duration.

## How a template is used

```ts
import { prompts } from '@creatordna/prompts';

const template = prompts.get('storyboard', 1);
const { text } = await textModel.callJson({
  system: template.system,
  prompt: prompts.render(template, { dna_niche, dna_tone, script_text }),
  outputSchema: template.outputSchema,
});
```

The service owns the model, the retries and the cost logging; the template owns
the words. A service never builds a prompt by string concatenation.

## Authoring rules

Full guide in [`src/templates/README.md`](src/templates/README.md). The short
version:

1. **No model ids in a template.** They come from env vars through the AI
   wrapper.
2. **Declare an `outputSchema`.** All LLM output is validated JSON, with one
   automatic re-prompt on validation failure.
3. **Bump, never edit.** New wording is a new file and a new version; the old one
   stays callable so a render can be reproduced.
4. **Interpolation is strict.** A missing or unused variable throws rather than
   quietly shipping a broken prompt.
5. **Creator DNA is injected as variables**, so one prompt serves every creator.
