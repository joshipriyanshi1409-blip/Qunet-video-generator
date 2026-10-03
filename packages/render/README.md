# @creatordna/render

**Purpose:** the render pipeline, shared by the API (which creates jobs) and the
worker (which runs them). Eight stages, each producing an asset the next one
reads, so a failed stage retries without redoing earlier work.

```
src/media/          WAV / PNG / WebVTT / MP4 readers and writers
src/mediaModels.ts  Veo, Gemini TTS, Lyria, Gemini-transcribe REST clients
src/ai.ts           The RenderAi seam: mock | live | demo
src/stages.ts       The eight stage runners
src/composers.ts    ffmpeg | mock composers
src/qc.ts           Post-render checks on the finished file
src/repository.ts   Job document store (Firestore | local file | memory)
src/storage.ts      Asset store (Firebase Storage | local disk | memory)
src/events.ts       Redis pub/sub for progress events
src/demoCache.ts    Read-through cache for DEMO_MODE
src/pipeline.ts     runRenderPipeline - the orchestrator
```

---

The render pipeline: the job document store, asset storage, the eight stages, the
composers and QC.

It is a **package rather than part of the worker** because two processes write the
same data. The API creates a render job and re-queues a failed stage; the worker
consumes it and reports every stage as it runs. Both need the same store, the
same event shape and the same asset layout, so they are defined once here and
neither can drift from the other.

```
repository.ts   job documents: Firestore / local JSON / memory
events.ts       progress events over Redis pub/sub (worker -> API -> browser)
storage.ts      assets: Firebase Storage / local disk / memory
ai.ts           the storyboard model call, plus a deterministic mock
stages.ts       the eight stages
composers.ts    ffmpeg / mock, behind one interface
qc.ts           the checks a render must pass before it says "completed"
pipeline.ts     the runner: resume, progress, failure recording
media/          real writers: WAV, PNG, WebVTT, MP4 box tree
```

## Run

```bash
pnpm --filter @creatordna/render test
```

## The pipeline

```
script -> storyboard -> assets -> voice -> music -> captions -> compose -> qc
```

Each stage writes files and hands back the assets to record on the job document.
Nothing in `stages.ts` knows about BullMQ, Redis or HTTP.

**Resume is the whole design.** The API re-queues a failed job with `stage` set to
the stage that failed; the runner starts there. Each stage *additionally* skips
itself when its asset is already on the job, so a retry that lands mid-pipeline
does not spend the creator's money twice. `mergeAssets` replaces by
`kind` + `sceneIndex` rather than appending, so a re-run cannot leave two clips
for scene 3 on the document.

**A stage failure is a recorded outcome, not an exception.** The processor returns
a result, because BullMQ re-runs a job whose processor throws - which for a
render would mean regenerating clips the creator already paid for. The document
records `error.stage`, `error.attempts` and `error.retryable`, and the creator
retries from the UI.

`retryable` is set by the stage, not guessed from the message: a model timing out
is worth another attempt, a script that breaks the eight-scene cap is not.

## Assets are the durable state

The job document holds *pointers*, and the store holds the bytes. A render that
resumes from `voice` reads the storyboard and the clips back out of storage - so
`AssetStore` has a `read` as well as a `put`, and a retry three days later still
knows what it was rendering.

## What is real and what is a stand-in

| Stage | Mock | Real |
| ----- | ---- | ---- |
| `script` | validates the cost limits | identical |
| `storyboard` | deterministic scene list from the script | `storyboard@1` prompt through `RenderAi` |
| `assets` | one PNG frame per scene + a thumbnail | `VEO_MODEL` |
| `voice` | a real WAV, one tone per scene | `TTS_MODEL` |
| `music` | a real WAV, a two-note bed | `LYRIA_MODEL` |
| `captions` | a real WebVTT timed from the storyboard | `TRANSCRIBE_MODEL`, aligned against the recorded voice-over |
| `compose` | a valid MP4 container, **no encoded video** | `ffmpeg`, or Remotion |
| `qc` | identical | identical |

**`compose` is the one stage that is still a stand-in when ffmpeg is absent.**
The mock assets are genuine files: a WAV opens in an audio player, a WebVTT
attaches to a `<track>`, a PNG opens in a browser. Only the composed MP4 is a
stand-in without an encoder, and the composer says so in the note it leaves on
the job rather than letting the UI pretend.

## The media models

`mediaModels.ts` holds the three REST clients. No SDK: the shapes are small
enough to read, a fake `fetch` makes them testable without a key, and there is no
dependency to go stale when Google renames a field.

| Client | Endpoint | Auth | Shape |
| ------ | -------- | ---- | ----- |
| `createVeoClipClient` | `models/{model}:predictLongRunning`, then poll `GET /{operation}`, then download the returned URI | `x-goog-api-key` | long-running: start returns an operation *name*, the video arrives later at a URI |
| `createGeminiTtsClient` | `models/{model}:generateContent` with `responseModalities:["AUDIO"]` | `x-goog-api-key` | `candidates[0].content.parts[0].inlineData` is **bare PCM**, `audio/L16;codec=pcm;rate=24000` |
| `createLyriaMusicClient` | Vertex `models/{model}:predict` | `Authorization: Bearer ...` | `predictions[0].audioContent` is a base64 WAV, fixed length |

Three things worth knowing before you touch them:

**Veo is three round trips per scene.** `predictLongRunning` hands back an
operation name; you poll until `done`; then you download from the URI it names.
That is why the `assets` stage reports progress per scene rather than once, and
why `MEDIA_TIMEOUT_MS` has to stay under the BullMQ lock duration.

**Gemini TTS does not return a WAV.** It returns raw little-endian PCM and tells
you the sample rate in the mime type (`rate=24000`). `writeWavFromPcm` wraps it
in a RIFF header using *that* rate - hard-coding 16 kHz would play every voice at
two-thirds speed.

**Lyria 2 is a Vertex AI model, not a Gemini API model.** It authenticates with
OAuth, so `createLyriaMusicClient` takes an `Authorization` header value
(`LYRIA_AUTHORIZATION`) and a Vertex base URL (`LYRIA_BASE_URL`) rather than an
API key. Minting that token is a deployment concern; this client deliberately
does not try.

Each slot is wired independently in `createMediaRenderAi`. A missing model id
falls back to that slot's mock **and logs a warning**, so "the video came back
with stills instead of clips" is a line in the boot log rather than a discovery
at the end of a render.

### Captions: forced alignment, not transcription

`createGeminiTranscribeClient` is the odd one out, and deliberately so. **There is
no dedicated Gemini transcribe model** - audio transcription runs through the
ordinary `generateContent` endpoint with the audio as `inlineData`, so
`TRANSCRIBE_MODEL` is a *multimodal text* model id, the same kind as
`GEMINI_TEXT_MODEL`.

More importantly, it is asked to **align a known script**, not to recognise an
unknown one. The creator approved the script, so the only unknown is *when* each
line is spoken. That matters because an ASR error would put words the creator
never wrote into a creator-facing asset - and because aligning to a known script
is far more reliable than transcribing an unknown one.

The request carries the numbered script plus the audio, and asks for
`{"segments":[{"lineIndex":0,"startSeconds":1.25,"endSeconds":4.5}]}`. The
`lineIndex` is what ties a timing back to the approved line, so a response
without it is unusable rather than merely imprecise - and it is validated with
zod like every other LLM output here.

`generationConfig.audioTimestamp` is documented as required to enable timestamp
understanding on audio-only input, so it is sent explicitly. Note that the
reference page for it is a **Vertex** page; whether the AI Studio path honours it
identically is worth checking before the first paid call.

**Why this stage changed:** it used to build its WebVTT from the storyboard's
declared scene durations. That was exact for a mock voice-over (synthesised to
precisely those lengths) and *wrong* for a real one, where the model speaks at its
own pace - so wiring real TTS without this would have produced captions that
drift away from the words on screen. When there is no voice-over to align, the
stage still falls back to the plan rather than failing, because a silent short is
a QC warning and not a reason to lose the render.

None of these has been called against the live API - there is no key in this
repository. What the tests pin down is the contract with Google: URL, auth
header, request body, and the paths the response is read from. Check the current
reference pages before the first paid call:

- <https://ai.google.dev/gemini-api/docs/veo>
- <https://ai.google.dev/gemini-api/docs/text-to-speech>
- <https://ai.google.dev/gemini-api/docs/generate-content/audio>
- <https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/lyria-music-generation>

## Creator DNA reaches the storyboard

The job document snapshots the profile it was started against (`dna`), and the
`storyboard` stage passes it to `buildStoryboard`. It is snapshotted at accept
time rather than read live for two reasons: a retry next month has to produce the
same video it would have produced today, and when a creator asks why a video
sounded unlike them the answer is the exact profile that was injected.

`dnaVariables` turns that profile into the `{{dna_*}}` values the prompt asks
for. With no profile the prompt says `unknown` for each field rather than
inventing a voice. The `voice` and `music` stages use the same snapshot for
delivery direction and mood.

### The MP4 writer

`media/mp4.ts` writes a valid ISO-BMFF box tree - `ftyp`, `moov` with a video
track carrying the right duration, dimensions and sample table, and an `mdat`.
It parses, it has correct metadata, and `readMp4Summary` proves it in the tests.
It does not encode video, because there is no H.264 encoder here. That is the
boundary between the mock composer and a real one, and it is drawn explicitly.

**A real ffmpeg file broke `readMp4Summary`, and it is worth knowing why.** The
reader took its dimensions from `tkhd` and let each `trak` overwrite the last. A
real render has *two* tracks - video and audio - and the audio track's `tkhd`
reports `0x0`, so every real MP4 read as 0x0 and QC failed with "the video is 0x0"
on a file that played perfectly well.

The fix reads the frame size from the **visual sample entry**
(`moov > trak > mdia > minf > stbl > stsd > avc1`), which is the authority, and
treats `tkhd` as a fallback - never letting a track with no video overwrite one
that has it. `mvhd` version 1 (64-bit durations) is handled too. The lesson is
the one this codebase keeps relearning: a parser tested only against its own
writer's output is not tested.

**Verified end to end.** With `ffmpeg` on `PATH` (or `FFMPEG_PATH`) the pipeline
produces a real 9:16 H.264 MP4 with an AAC mix: `readMp4Summary` reports
`1080x1920` at `30.0s`, QC passes, and the file decodes with no errors.

## Cost guards

`COST_LIMITS` from `@creatordna/shared` is enforced in the `script` stage and
mirrored by the API when a job is accepted: at most eight scenes, 15-45 seconds,
and a per-asset byte ceiling.
