# Firestore schema

Every path the product reads or writes, and the rule that guards it.

Rules live in [`infra/firebase/firestore.rules`](../infra/firebase/firestore.rules).
Composite indexes live in
[`infra/firebase/firestore.indexes.json`](../infra/firebase/firestore.indexes.json).

## Layout

```
users/{uid}/
├── dna/profile                    one document - the Creator DNA
├── history/{itemId}               append-only DNA change log
├── signals/{signalId}             learning-loop evidence (create-only)
├── suggestions/{suggestionId}     learning-loop proposals (status transitions only)
├── versions/{version}             DNA snapshots (read-only to clients)
├── learning/state                 the learning loop's watermark (read-only)
├── ideas/{ideaId}                 TODO(phase-N): not yet implemented
├── trends/{trendId}               TODO(phase-N): not yet implemented
├── jobs/{jobId}                   TODO(phase-N): superseded by top-level renderJobs
└── assets/{assetId}               TODO(phase-N): assets live in Storage, not here

renderJobs/{jobId}                 top-level - the render job document
projects/{projectId}               top-level - the remix -> mirror -> approve loop
```

## `users/{uid}/dna/profile`

One document per creator. Written by onboarding, by the Edit-DNA modal, and by
`acceptSuggestion` - which is the only learning-loop method allowed to write it.

| Field | Type | Notes |
| --- | --- | --- |
| `niche` | string | What the creator makes content about |
| `tone` | string[] | 1-6 tags |
| `audience` | string[] | 1-8 segments |
| `style` | string | Free text, up to 600 chars |
| `personality` | string[] | 1-8 tags |
| `format` | enum | `whiteboard`, `talking-head`, ... |
| `vocabulary` | string[] | Words this creator actually uses |
| `catchphrases` | string[] | Their running jokes |
| `dos` / `donts` | string[] | Explicit style rules |
| `samplePosts` | object[] | Up to 10, each `{text}` |
| `audienceAgeRange` | enum | `13-17` ... `55+` |
| `audienceType` | enum | From onboarding |
| `dnaVersion` | number | Bumps only when content changed |
| `updatedAt` | ISO string | |

`buildDnaContext(uid)` compresses this into a **< 500-token** block that is
injected into every prompt. The token budget is enforced in the API and tested.

## `users/{uid}/signals/{signalId}`

The learning loop's evidence. **Create-only from a client** - `createdFields` is
locked, so a signal cannot be edited after the fact.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Minted by the server |
| `kind` | enum | `hook_chosen`, `remix_approved`, `remix_rejected`, `audience_tip_applied` |
| `label` | string | The hook text / tip text - human-readable, so the loop can reason from it |
| `source` | string | Which screen emitted it (`hook-lab`, `trend-remix`, `audience-mirror`) |
| `createdAt` | ISO string | |

Signals are appended from four screens and are **fire-and-forget**: the client
swallows every failure, including a zod rejection, because a lost signal must
never interrupt the action it is attached to.

## `users/{uid}/suggestions/{suggestionId}`

Proposals from the learning loop. Clients may only transition `status`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Minted by the service |
| `field` | enum | `vocabulary`, `catchphrases`, `tone`, `personality`, `dos`, `donts`, `audience`, `style` |
| `action` | enum | `add` or `replace` - `replace` only for tone/personality/audience/style |
| `value` | string[] | 1-8 entries |
| `rationale` | string | Shown verbatim next to the accept button |
| `evidence` | string[] | Signal ids this was reasoned from; empty means "from the profile alone" |
| `status` | enum | `pending` -> `accepted` or `rejected` |
| `resolvedAt` | ISO string or null | |
| `promptId` / `promptVersion` / `model` | | Which prompt and model produced it |

**Nothing is applied automatically.** `generateSuggestions` writes `pending`; only
`acceptSuggestion` touches the profile, and it is the only method that does.

## `users/{uid}/versions/{version}`

Snapshots of the whole DNA, one per version. **Read-only to clients** - a client
that could write a version could rewrite its own history.

`acceptSuggestion` writes **two** snapshots: the profile as it stood *before* the
change, and the accepted result. A history that only kept the new state could not
show what was actually given up.

| Field | Type | Notes |
| --- | --- | --- |
| `version` | number | Document id, so a re-run replaces rather than duplicates |
| `savedAt` | ISO string | |
| `summary` | string | e.g. `Added to vocabulary: amortized` |
| `dna` | object | The full profile at that version |

The DNA history page recomputes the score **from the snapshot** rather than
storing it, so the history cannot drift from the ring on My DNA.

## `users/{uid}/learning/state`

A single document holding `lastRunAt` - the watermark that makes the sweep
affordable. **Read-only to clients.**

Signals newer than this are "unseen". It is *stored* rather than derived from the
newest suggestion because a run that legitimately proposes nothing still consumed
those signals; deriving it would re-run the model over the same evidence forever.

`setLastRunAt` is written **only on a successful run**, so a failure re-tries the
same batch.

## `renderJobs/{jobId}`

Top-level, not under a uid, so the worker can find it without knowing whose it is.
Read is still restricted to the owner by the rules.

| Field | Type | Notes |
| --- | --- | --- |
| `jobId` | string | |
| `uid` | string | The owner |
| `queue` | string | `render` |
| `state` | enum | BullMQ state: `waiting`, `active`, `completed`, `failed`, ... |
| `stage` | enum | Pipeline stage: `queued`, `script`, ... `completed`, `failed` |
| `progress` | number | 0-100, derived from `RENDER_STAGE_PLAN` |
| `assets` | object[] | Every asset with its Storage URL |
| `error` | object or null | |
| `attemptsMade` | number | |
| `payload` | object | The script, kept on the document so a retry needs no queue |
| `dna` | object or null | **The DNA snapshotted at accept time** |
| `createdAt` / `updatedAt` | ISO string | |

`dna` is snapshotted rather than read live for two reasons: a job retried next
month must produce the same storyboard it would have today, and when a creator
asks why a video sounded unlike them, the answer is the exact profile that was
injected.

## `projects/{projectId}`

The remix -> mirror -> improve -> approve loop, including every version.

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `uid` | string | |
| `idea` | string | The original idea |
| `trendId` | string or null | |
| `status` | enum | `awaiting-approval`, `rendering`, ... |
| `versions` | object[] | Each with `kind`, `hook`, `cta`, `content`, `mirror`, `feedback` |
| `approvedVersion` | number or null | |
| `renderJobId` | string or null | |
| `createdAt` / `updatedAt` | ISO string | |

## Access rules

The catch-all is **deny**. Specifically:

- A creator can read and write only their own `users/{uid}/**` data.
- `signals` are create-only; `createdFields` is locked.
- `suggestions` allow a status-only transition, `pending` -> `accepted`/`rejected`.
- `versions` and `learning` are read-only to clients.
- `renderJobs/{jobId}` and `projects/{projectId}` are readable only by their owner.
- `trends` and `assets` are read-only for clients and written by the worker via
  the Admin SDK.

## Indexes

The learning sweep is a collection-group query across every creator's `signals`,
ordered `createdAt` descending. Firestore requires a composite index for that, and
without it the sweep fails **at runtime** rather than at deploy - which is the
worst time to find out.

```bash
firebase deploy --only firestore:rules,firestore:indexes --project creatordna-staging
```

## Local development

With no `FIREBASE_PROJECT_ID`, both processes fall back to local JSON files under
`.data/`, and the boot log says which store is in use. The paths are configured by
`DNA_STORE_DIR`, `TRENDS_STORE_PATH`, `PROJECTS_STORE_PATH`, `RENDER_ASSET_DIR` and
`WORKER_DATA_DIR` - see [`ENVIRONMENT.md`](ENVIRONMENT.md).
