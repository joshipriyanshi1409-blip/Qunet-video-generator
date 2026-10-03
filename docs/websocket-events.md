# WebSocket events

Two WebSocket endpoints on the same port as REST:

| Path | Purpose |
| --- | --- |
| `/ws` | Live render progress |
| `/ws/voice-coach` | The Gemini Live coaching session |

Both authenticate **on connect** (engineering rule: verify the token on every REST
request *and* on WebSocket connect). Neither trusts a message body to establish
identity.

## Connecting

A browser cannot set headers on a WebSocket handshake, so the Firebase ID token
travels as a query parameter:

```js
const socket = new WebSocket(`wss://host/ws?token=${idToken}`);
```

With `DEV_AUTH_BYPASS=true` in development, `?dev_uid=<uid>` is accepted instead.

On success the server sends:

```json
{ "type": "hello", "at": "2026-10-03T10:00:00.000Z", "uid": "creator-a", "devBypass": false }
```

## Close codes

| Code | Meaning |
| --- | --- |
| `4401` | Missing or invalid token (`WS_CLOSE_CODES.unauthorized`) |
| `4403` | Subscribing to a channel you do not own (`WS_CLOSE_CODES.forbidden`) |
| `1001` | The server is shutting down |

Application-level codes live in the 4000-4999 range so they are distinguishable
from protocol-level ones.

---

## `/ws` - render progress

### Subscribing

Two spellings of the same intent, so the browser never has to know that a render
channel is `render:<jobId>`:

```json
{ "type": "render.subscribe", "jobId": "job_1" }
{ "type": "subscribe", "channel": "render:job_1" }
```

Both are acknowledged in the shape the caller used - a client that sent
`render.subscribe` is not handed a `subscribe` it has to decode.

### Authorization is checked against the job document

A render channel is `render:<jobId>`, and it is the one subscription that must be
refused when it is not the caller's own job. The channel name is not trusted from
the client: the server looks up the job and compares `job.uid` to the socket's
uid. A mismatch is a `4403`.

```json
{ "type": "error", "error": { "code": "forbidden", "message": "You can only follow your own renders." } }
```

### Progress events

```json
{
  "type": "render.progress",
  "jobId": "job_1",
  "stage": "voice",
  "progress": 71,
  "state": "active",
  "assets": [],
  "at": "2026-10-03T10:00:04.000Z"
}
```

`stage` is one of `queued`, `script`, `storyboard`, `assets`, `voice`, `music`,
`captions`, `compose`, `qc`, `completed`, `failed`. `progress` is 0-100 and is
derived from `RENDER_STAGE_PLAN` in `packages/shared`, so the browser's bar and
the worker's report cannot drift.

### Message types

| Type | Direction | Meaning |
| --- | --- | --- |
| `hello` | server -> client | Connection accepted |
| `ping` / `pong` | both | Keepalive |
| `subscribe` / `unsubscribe` | client -> server | Generic channel form |
| `render.subscribe` / `render.unsubscribe` | client -> server | By job id |
| `render.progress` | server -> client | Progress |
| `error` | server -> client | `invalid_json`, `invalid_message`, `invalid_channel`, `forbidden`, `unknown_message_type` |

### How progress actually travels

```
worker publishes ──▶ Redis pub/sub ──▶ every API replica ──▶ its own local sockets
```

The worker never talks to a socket. It publishes to Redis, and each API replica
subscribes and re-broadcasts to the clients *it* holds. This is why multiple API
instances work without session affinity.

**The corollary:** `REDIS_ENABLED=false` disables live progress entirely. There is
no fallback path for the API to learn what the worker did. Renders still complete;
the UI just polls instead.

---

## `/ws/voice-coach` - live coaching

A Gemini Live session. Same auth, same upgrade router, a separate
`WebSocketServer` on its own path - so a coaching failure can never take the
job-progress channel down with it.

### Client -> server

| Type | Payload | Meaning |
| --- | --- | --- |
| `start` | `{script}` | Opens a session. Answered with `ready` |
| `audio` | `{data: base64, mimeType}` | A chunk of 16 kHz 16-bit mono PCM |
| `audio-stream-end` | | Finished speaking |
| `line` | `{index}` | Jump to a script line |
| `end` | | Close the session. Answered with `ended` |

### Server -> client

| Type | Payload | Meaning |
| --- | --- | --- |
| `ready` | `{sessionId, maxSeconds}` | Session open, with the cap |
| `tip` | `{tip}` | A coaching tip |
| `transcript` | `{text, final}` | What was heard |
| `audio` | `{data, mimeType}` | The model's spoken reply |
| `warning` | `{message}` | Non-fatal - e.g. approaching the cap |
| `ended` | `{summary}` | Session closed, with the summary |
| `error` | `{code, message}` | Fatal for this session |

Audio in and out is raw PCM. The Gemini Live API returns
`audio/L16;codec=pcm;rate=24000`, and the client sends 16 kHz mono - the browser
records at 16 kHz, so there is no resampling on the way in.

### Quota

A daily cap per creator, enforced in `apps/api/src/voiceCoach/` and readable at
`GET /api/v1/voice-coach/quota`. The cap is part of the cost guards, not a
nice-to-have: a live session is the most expensive thing a creator can start.

---

## Testing a socket

jsdom has no usable WebSocket, so the component tests never open one. The
handshake itself is covered by `apps/api/src/__tests__/ws.test.ts` and
`voiceCoachSocket.test.ts`, which drive the real `ws` server over a real socket.

```bash
corepack pnpm --filter @creatordna/api test ws
```
