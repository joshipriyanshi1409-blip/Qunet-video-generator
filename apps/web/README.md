# @creatordna/web

**Purpose:** the React front end. 14 screens over one API and two WebSockets,
talking to a single origin so there is no CORS in production.

```
src/pages/       One component per route (14 screens)
src/components/  Shared UI, plus dna/, render/ and voiceCoach/ groups
src/hooks/       TanStack Query wrappers per domain
src/lib/         API client, signal emitter, one client per domain
src/store/       Zustand: auth session, UI draft idea, toasts
src/theme/       Design tokens (peach/coral), mirrored in index.css
src/test/        RTL setup, fixtures, auth helpers
```

React 19 + Vite + Tailwind CSS v4 + Motion + React Router + TanStack Query +
Zustand.

---

React 19 + Vite + Tailwind CSS v4 + Motion + React Router + TanStack Query +
Zustand front end for CreatorDNA Studio.

## Run

```bash
cp .env.example .env
pnpm --filter @creatordna/web dev        # http://localhost:5173
```

The dev server proxies `/api`, `/health` and `/ws` to `VITE_API_PROXY_TARGET`
(default `http://127.0.0.1:4000`), so the browser always talks to the same origin
it loaded from - no `localhost` URLs in client code.

## Screens

| Route          | Screen            | States implemented                                    |
| -------------- | ----------------- | ----------------------------------------------------- |
| `/`            | Home              | loading / success / error (retry) / empty (trending)  |
| `/create`      | Create            | form + empty project list                             |
| `/dna`         | My DNA            | sync ring (0%), content/audience/style cards          |
| `/trends/remix`| Trend Remix       | picker + original vs your version + audit trail       |
| `/hooks`       | Hook Lab          | six style cards, select / edit / regenerate one       |
| `/audience`    | Audience          | High/Medium/Low segment cards, AI insight, disclaimer |
| `/voice-coach` | Voice Coach       | script + mic, live tips, timer, summary, fallback    |
| `/render/:id`  | Render progress   | stage stepper + ETA + retry, WS-first with polling  |
| `/render/:id/result` | Render result | player, caption/hashtags, downloads, share      |
| `/library`     | Library           | search + state filters + sort, two empty states      |
| `*`            | Not found         | empty state                                           |

## Design system

- **Tokens**: `src/theme/tokens.ts` (TypeScript) and the `@theme` block in
  `src/index.css` (Tailwind utilities). `src/__tests__/theme.test.ts` fails if the
  two drift apart.
- **Palette**: soft peach/coral on a warm canvas, `rounded-card` cards, soft
  shadows, `Inter`/system font scale.
- **Components**: `Button`, `Card`, `Chip`, `Badge` (+ `ReactionBadge`),
  `Skeleton`, `Modal`, `Toast`, `ProgressRing`, `StateViews`
  (`LoadingState` / `EmptyState` / `ErrorState` / `QueryBoundary`), plus the
  Phase 4 pieces: `CopyButton`, `RelevanceBadge` and `Disclosure` (an expandable
  section whose panel is genuinely unmounted when collapsed), and the Phase 6
  coach pieces: `Waveform`, `ScriptTeleprompter`, `FeedbackFeed`,
  `SessionTimer`. Phase 8: `ProgressBar`, `PageTransition` (opacity + lift,
  under 250 ms), `DnaRing` (count-up that jumps straight to the value under
  `prefers-reduced-motion`), `VideoPlayer` (native controls, caption track, and
  an error state with a direct MP4 link), and the render chrome under
  `src/components/render/`: `StageStepper`, `EtaBadge`, `RenderActions`.
- **Accessibility**: skip link, visible focus rings, `aria-current` on nav,
  labelled controls, `role="progressbar"` rings, `role="log"` toasts, focus trap
  + Escape in the modal, and a `prefers-reduced-motion` override.

## Data flow

`src/lib/api.ts` is the only place that talks to the API. Every response is
validated with the shared zod schema from `@creatordna/shared`, so a contract
change fails loudly instead of rendering `undefined`. TanStack Query owns
caching, retries and refetching (`src/hooks/useHealth.ts`).

The Live Voice Coach is the one screen that is not request/response, so it has
its own client (`src/lib/voiceCoachClient.ts`) and its own audio pipeline
(`src/audio/`). Both follow the same rule: the shared schemas validate every
message in both directions.

## Live Voice Coach

- `src/audio/pcm.ts` - pure resampling to 16 kHz and 16-bit packing. No Web
  Audio API in the file, so it is unit-tested without a microphone.
- `src/audio/pcmWorklet.ts` - the `AudioWorklet` that captures frames. It only
  forwards them; the DSP lives in `pcm.ts` where it can be tested.
- `src/audio/recorder.ts` - `getUserMedia` -> `AudioWorklet` -> PCM chunks, with
  every browser failure mapped to a sentence a creator can act on (permission
  denied, no microphone, insecure context, no worklet support).
- `src/audio/playback.ts` - wraps the coach's spoken feedback in a WAV header so
  an `<audio>` element can play raw PCM back.
- `src/hooks/useVoiceCoachSession.ts` - the state machine: mic, socket, tips,
  clock, summary, and the record-and-review fallback.
- `src/lib/voiceCoachClient.ts` - the socket, with exponential-backoff reconnect
  for network drops and **no** reconnect on a policy close (daily cap, session
  limit, live unavailable), because those are answers rather than accidents.

The fallback is offered up front as "Record a take instead" and appears
automatically when the live path is unavailable, so the feature never becomes a
dead end.

## The render journey

`GET /api/v1/render/:id` is the source of truth for a job. The screen is
WebSocket-first and polls as a fallback, because `REDIS_ENABLED=false` means
there is no pub/sub bridge to carry `render.progress` events: the socket still
connects and still verifies the Firebase ID token, it just goes quiet, so the
poll is what actually moves the bar.

- `src/lib/renderStages.ts` - the pipeline's eight stages folded into the seven
  the creator sees (`script` and `storyboard` are one "Script" step). Every step
  carries a text label, so the state survives colour-blind reading.
- `src/lib/eta.ts` - a rate-based estimate that says "still warming up" below 2%
  and 10 s rather than inventing a number, and reads a stalled rate as a clip
  rendering rather than an error.
- `src/lib/renderSocket.ts` - the `/ws` `render:<jobId>` channel, with backoff.
- `src/lib/library.ts` - the per-user library. Client-side **on purpose**: the
  API owns `renderJobs/{jobId}` but has no listing endpoint yet, so the page says
  so instead of pretending to be server state.
- `src/lib/qoneqt.ts` - `ShareAdapter` plus a mock implementation. The Qoneqt
  contract is not final, so the UI is built and tested against the real shape of
  the operation (validate, post, get an id and URL back, handle a rejection) and
  the only adapter says in plain words that nothing is published.
- `src/lib/download.ts` - blob downloads named after the hook, with a fallback
  that opens the MP4 directly when CORS blocks the fetch.

**Cancel is honest about what it does.** There is no cancel endpoint on the API
and no worker consuming the queue, so "Stop following" stops the browser
following the job and says, beside the button, that the worker keeps going. It
does not pretend to cancel anything.

## Tests

```bash
pnpm --filter @creatordna/web test
```

Covers the component library, the theme/token contract, the API client, and the
app shell (navigation, 404, Home loading/success/error/empty states, idea
hand-off into Create), plus the Phase 4 screens, the render journey, and the
tools navigation.

Phase 4 coverage: the trending carousel (badges, personalisation flag, hand-off
into the remix screen), the remix screen (ranked picker, original vs your
version, expandable Hook/Script/CTA/audit sections, regenerate, free-text ideas,
model failure with retry, "no DNA yet" onboarding prompt) and Hook Lab (six
distinct styles, select, inline edit, single-style regeneration, model failure,
and refusing to generate without an idea).

Phase 6 coverage: the resampler (rate conversion, sine fidelity, no drift or
sample loss across frame boundaries, constant signals, upsampling, bad rates),
16-bit packing and clamping, base64 round-trip including a chunk large enough to
overflow the call stack, the WAV header the coach's audio depends on, the socket
message validator (every accepted shape, and dropping a malformed one), the
session timer formatting, and the four coach components (current-line marking and
line jumping, newest-tip-first ordering with live regions, the countdown and its
progress value, and the waveform's live/off announcement).

Phase 8 coverage: the ETA (warming up vs stalled vs done, monotonic clocks,
nonsense input, formatting), the stage mapping (weights, step state, per-step
fraction, no step for a terminal state), the render client's narrowing of an open
job document (missing stage, object progress, missing payload fields, terminal
states, MP4 lookup) and the download filename, the library store (replace by
`jobId`, ceiling trimming, corrupt and hostile storage, every filter and sort
combination), the share adapter (validation, success, a one-shot failure so the
UI's error path is testable, and the "nothing is published" notice), and the
screens: the stepper's `aria-current` and text state labels, the progress bar's
value, the ETA badge's two explanations, the retry/finished/cancelled action
sets, the progress screen (live job, failure naming the stage, finished with an
MP4, finished without one, skeleton while loading, 503, no job selected), the
result screen (player with captions track, per-hashtag copy buttons, the
auto-save into the library, the MP4 filename, the mock share's wording,
still-rendering, no MP4), and the library page (newest-first, state counts,
state filter, search across title/caption/hashtag, the two different empty
states, clear-filters, result vs progress links, remove).
