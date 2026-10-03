import { z } from 'zod';
import type { Logger } from 'pino';
import { trimWav, writeWavFromPcm } from './media/wav.js';

/**
 * REST clients for the three media models.
 *
 * These are the adapters behind the `assets`, `voice` and `music` stages. Each
 * one is a plain function over `fetch` with no SDK, for three reasons: the
 * shapes are small enough to read, a fake `fetch` makes them testable without a
 * key, and there is no dependency to go stale when Google renames a field.
 *
 * **Every shape here was taken from the official reference pages, and none of it
 * has been exercised against the live API** (no key in this repository). The
 * two that are most likely to need a touch-up before going live are called out
 * in comments on the function that uses them.
 *
 * Auth: Veo and Gemini TTS take the Gemini API key in `x-goog-api-key`. **Lyria
 * 2 is a Vertex AI model** and takes an OAuth bearer token instead - there is no
 * API-key path to it, which is why `createLyriaMusicClient` asks for a header
 * value rather than a key.
 */

/** A media file a model produced, ready to hand to the asset store. */
export interface RenderMedia {
  bytes: Buffer;
  mimeType: string;
  /** File extension to store it under (`mp4`, `wav`, ...). */
  extension: string;
  /** Seconds of media, when the model told us. */
  durationSeconds?: number;
  /** One line for the log: which model, how long, how big. */
  note?: string;
}

/** A scene the clip generator is asked to shoot. */
export interface ClipRequest {
  sceneIndex: number;
  /** The scene description from the storyboard, DNA already folded in. */
  visualPrompt: string;
  /** What is being said over the shot, so the clip can match the beat. */
  narration: string;
  durationSeconds: number;
  /**
   * The frame the render is producing.
   *
   * Passed in rather than defaulted here so a still-frame mock and a real Veo
   * clip agree on the output size. `createStages` takes the same pair, and the
   * two drifting apart would be invisible: `qc` checks the *MP4's* dimensions,
   * not the clips', and ffmpeg would quietly rescale a wrong-sized still.
   */
  width: number;
  height: number;
}

/** A line of narration to speak. */
export interface VoiceLine {
  narration: string;
  durationSeconds: number;
}

/**
 * What the caption aligner is asked to do.
 *
 * Note the shape: the **text is already known**. The creator approved the script,
 * so the only unknown is *when* each line is spoken. That makes this a forced
 * alignment rather than a transcription, and it matters for two reasons - an ASR
 * error would put words the creator never wrote into a creator-facing asset, and
 * aligning to a known script is far more reliable than recognising an unknown one.
 */
export interface CaptionRequest {
  /** The recorded voice-over, as WAV bytes. */
  voice: Buffer;
  /** The approved lines with their planned durations, in scene order. */
  lines: readonly VoiceLine[];
  /** Total runtime the captions must fit inside. */
  durationSeconds: number;
}

/** One timed line, as the model reports it. */
export interface CaptionSegment {
  /** Index into `CaptionRequest.lines`. */
  lineIndex: number;
  startSeconds: number;
  endSeconds: number;
}

/**
 * The shape the caption aligner must answer in.
 *
 * Validated with zod like every other LLM output in this codebase. The
 * `lineIndex` is what ties a timing back to the approved line, so a response
 * without it is unusable rather than merely imprecise.
 */
export const captionSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        lineIndex: z.number().int().nonnegative(),
        startSeconds: z.number().nonnegative(),
        endSeconds: z.number().nonnegative(),
      }),
    )
    .min(1),
});

export interface VoiceRequest {
  lines: readonly VoiceLine[];
  /** Delivery direction from the DNA profile ("warm, brisk, wry"). */
  direction?: string;
}

export interface MusicRequest {
  /** What the bed should feel like, built from the DNA + the hook. */
  brief: string;
  durationSeconds: number;
}

/** Thrown when a media model answered with something unusable. */
export class MediaModelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly model: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MediaModelError';
  }
}

export interface HttpClientOptions {
  /** Injectable so tests can answer without a network. */
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads a response body as JSON, or throws a legible model error. */
async function readJson(response: Response, model: string): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new MediaModelError(
      `model ${model} responded ${response.status} with a body that is not JSON: ${text.slice(0, 200)}`,
      response.status === 429 || response.status >= 500,
      model,
    );
  }
  return payload;
}

/**
 * Pulls `a.b.c` out of an unknown object, or undefined.
 *
 * The path is all strings, including array indices: `['generatedSamples', '0',
 * 'video', 'uri']`. Indexing a parsed JSON array with the string `'0'` is what
 * the wire format gives us, and coercing here keeps every call site readable.
 */
function dig(source: unknown, path: readonly string[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Veo - clips
// ---------------------------------------------------------------------------

export interface VeoClipClientOptions extends HttpClientOptions {
  apiKey: string;
  /** Defaults to the public Generative Language endpoint. */
  baseUrl?: string;
  /** Aspect ratio for every clip. 9:16 is the product. */
  aspectRatio?: string;
  /** How often to poll the operation, and how long to keep trying. */
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Generates one clip per scene with Veo.
 *
 * Veo is **long-running**: `:predictLongRunning` returns an operation name, not
 * a video, and the video appears at a download URI once the operation reports
 * `done`. So this is start, poll, download - three round trips per scene, which
 * is why the `assets` stage reports progress per scene rather than once.
 */
export function createVeoClipClient(options: VeoClipClientOptions) {
  const baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  const doFetch = options.fetchImpl ?? fetch;
  const aspectRatio = options.aspectRatio ?? '9:16';
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 240_000;

  return {
    kind: 'veo' as const,

    async generateClip(model: string, request: ClipRequest): Promise<RenderMedia> {
      const prompt = [
        request.visualPrompt,
        // Veo does not know what the narration is for; telling it keeps the
        // shot from contradicting the line being spoken over it.
        `This shot plays under the line: "${request.narration}"`,
      ].join('\n');

      const startResponse = await doFetch(
        `${baseUrl}/models/${encodeURIComponent(model)}:predictLongRunning`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              aspectRatio,
              durationSeconds: Math.max(1, Math.round(request.durationSeconds)),
              sampleCount: 1,
            },
          }),
        },
      );

      if (!startResponse.ok) {
        const detail = await startResponse.text().catch(() => '');
        throw new MediaModelError(
          `Veo refused to start scene ${request.sceneIndex + 1} (${startResponse.status}): ${detail.slice(0, 300)}`,
          startResponse.status === 429 || startResponse.status >= 500,
          model,
        );
      }

      const started = await readJson(startResponse, model);
      const operationName = dig(started, ['name']);
      if (typeof operationName !== 'string' || operationName.length === 0) {
        throw new MediaModelError(
          `Veo did not return an operation name for scene ${request.sceneIndex + 1}.`,
          true,
          model,
        );
      }

      const deadline = Date.now() + timeoutMs;
      let downloadUri: string | undefined;

      for (;;) {
        if (Date.now() > deadline) {
          throw new MediaModelError(
            `Veo took longer than ${Math.round(timeoutMs / 1000)}s on scene ${request.sceneIndex + 1} (operation ${operationName}).`,
            true,
            model,
          );
        }

        await sleep(pollIntervalMs);

        const pollResponse = await doFetch(`${baseUrl}/${operationName}`, {
          headers: { 'x-goog-api-key': options.apiKey },
        });
        if (!pollResponse.ok) {
          throw new MediaModelError(
            `Veo operation poll failed (${pollResponse.status}) for scene ${request.sceneIndex + 1}.`,
            pollResponse.status === 429 || pollResponse.status >= 500,
            model,
          );
        }

        const polled = await readJson(pollResponse, model);
        const error = dig(polled, ['error', 'message']);
        if (typeof error === 'string' && error.length > 0) {
          // A blocked generation is not the creator's fault and not retryable in
          // the "try again" sense - rephrasing the scene is.
          throw new MediaModelError(
            `Veo failed on scene ${request.sceneIndex + 1}: ${error}`,
            false,
            model,
          );
        }

        if (polled !== null && typeof polled === 'object' && 'done' in polled && polled.done === true) {
          const uri = dig(polled, [
            'response',
            'generateVideoResponse',
            'generatedSamples',
            '0',
            'video',
            'uri',
          ]);
          if (typeof uri === 'string' && uri.length > 0) {
            downloadUri = uri;
            break;
          }
          throw new MediaModelError(
            `Veo reported scene ${request.sceneIndex + 1} done but returned no video URI.`,
            true,
            model,
          );
        }
      }

      // The URI is fetched with the API key and follows redirects; `fetch`
      // follows them by default.
      const downloadResponse = await doFetch(downloadUri, {
        headers: { 'x-goog-api-key': options.apiKey },
      });
      if (!downloadResponse.ok) {
        throw new MediaModelError(
          `Veo clip download failed (${downloadResponse.status}) for scene ${request.sceneIndex + 1}.`,
          true,
          model,
        );
      }

      const bytes = Buffer.from(await downloadResponse.arrayBuffer());
      if (bytes.length === 0) {
        throw new MediaModelError(
          `Veo returned an empty clip for scene ${request.sceneIndex + 1}.`,
          true,
          model,
        );
      }

      return {
        bytes,
        mimeType: 'video/mp4',
        extension: 'mp4',
        durationSeconds: request.durationSeconds,
        note: `Veo clip for scene ${request.sceneIndex + 1} (${bytes.length} bytes)`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini TTS - voice-over
// ---------------------------------------------------------------------------

export interface GeminiTtsClientOptions extends HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Prebuilt voice name. Not a model id: it is a speaker, e.g. `Kore`. */
  voiceName?: string;
}

/**
 * Speaks the narration.
 *
 * One call per line rather than one for the whole script: the model's output
 * length is bounded, and a line that fails is a line that can be retried
 * without re-recording the ones before it.
 *
 * **The response is bare PCM, not a WAV.** `inlineData.mimeType` comes back as
 * `audio/L16;codec=pcm;rate=24000`, so the sample rate has to be read out of
 * that string and a RIFF header wrapped around the bytes - assuming 16 kHz
 * here would play every voice at half speed.
 */
export function createGeminiTtsClient(options: GeminiTtsClientOptions) {
  const baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  const doFetch = options.fetchImpl ?? fetch;
  const voiceName = options.voiceName ?? 'Kore';

  return {
    kind: 'gemini-tts' as const,

    async synthesizeVoice(model: string, request: VoiceRequest): Promise<RenderMedia> {
      const parts: Buffer[] = [];
      let sampleRate = 24_000;

      for (const line of request.lines) {
        const direction =
          request.direction === undefined || request.direction.length === 0
            ? ''
            : ` Read it ${request.direction}.`;

        const response = await doFetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `Say: ${line.narration}${direction}` }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new MediaModelError(
            `TTS responded ${response.status}: ${detail.slice(0, 300)}`,
            response.status === 429 || response.status >= 500,
            model,
          );
        }

        const payload = await readJson(response, model);
        const inline = dig(payload, ['candidates', '0', 'content', 'parts', '0', 'inlineData']);
        const mimeType = dig(inline, ['mimeType']);
        const data = dig(inline, ['data']);

        if (typeof mimeType !== 'string' || typeof data !== 'string' || data.length === 0) {
          const blocked = dig(payload, ['promptFeedback', 'blockReason']);
          throw new MediaModelError(
            typeof blocked === 'string'
              ? `TTS blocked the narration (${blocked}).`
              : 'TTS returned no audio part.',
            false,
            model,
          );
        }

        const rateMatch = /rate=(\d+)/.exec(mimeType);
        if (rateMatch?.[1] !== undefined) sampleRate = Number(rateMatch[1]);

        parts.push(Buffer.from(data, 'base64'));
      }

      const wav = writeWavFromPcm(Buffer.concat(parts), { sampleRate, channels: 1 });

      return {
        bytes: wav.bytes,
        mimeType: 'audio/wav',
        extension: 'wav',
        durationSeconds: wav.durationSeconds,
        note: `TTS voice-over: ${request.lines.length} line(s), ${wav.durationSeconds.toFixed(1)}s at ${sampleRate} Hz`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Lyria - music bed
// ---------------------------------------------------------------------------

export interface LyriaMusicClientOptions extends HttpClientOptions {
  /**
   * An `Authorization` header value, e.g. `Bearer ya29....`.
   *
   * Lyria 2 lives on Vertex AI, which authenticates with OAuth rather than an
   * API key. Minting that token is a deployment concern (a service account, or
   * `gcloud auth print-access-token` for a local run) - it is deliberately not
   * this client's job, and no SDK is pulled in to do it.
   */
  authorization: string;
  /** e.g. `https://us-central1-aiplatform.googleapis.com/v1`. */
  baseUrl: string;
}

/**
 * Scores the music bed.
 *
 * Lyria returns a fixed-length track, so the caller trims it to the storyboard's
 * runtime - cutting the WAV's `data` chunk, which is exact and needs no
 * resampling.
 *
 * Note the field name: the Vertex reference spells the instance field
 * `negative_prompt`, in snake_case. The REST layer accepts either spelling, but
 * this follows the reference page it was written from.
 */
export function createLyriaMusicClient(options: LyriaMusicClientOptions) {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    kind: 'lyria' as const,

    async composeMusic(model: string, request: MusicRequest): Promise<RenderMedia> {
      const response = await doFetch(`${options.baseUrl}/models/${encodeURIComponent(model)}:predict`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: options.authorization,
        },
        body: JSON.stringify({
          instances: [{ prompt: request.brief }],
          parameters: { sample_count: 1 },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new MediaModelError(
          `Lyria responded ${response.status}: ${detail.slice(0, 300)}`,
          response.status === 429 || response.status >= 500,
          model,
        );
      }

      const payload = await readJson(response, model);
      const audioContent = dig(payload, ['predictions', '0', 'audioContent']);
      if (typeof audioContent !== 'string' || audioContent.length === 0) {
        throw new MediaModelError('Lyria returned no audio prediction.', false, model);
      }

      const wav = Buffer.from(audioContent, 'base64');
      const trimmed = trimWav(wav, request.durationSeconds);

      return {
        bytes: trimmed,
        mimeType: 'audio/wav',
        extension: 'wav',
        durationSeconds: request.durationSeconds,
        note: `Lyria bed trimmed to ${request.durationSeconds.toFixed(1)}s (${trimmed.length} bytes)`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini - caption alignment
// ---------------------------------------------------------------------------

export interface GeminiTranscribeClientOptions extends HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Times the captions against the recorded voice-over.
 *
 * **There is no dedicated Gemini transcribe model.** Audio transcription runs
 * through the ordinary `generateContent` endpoint with the audio passed as
 * `inlineData`, so `TRANSCRIBE_MODEL` is a *multimodal text* model id - the same
 * kind of id as `GEMINI_TEXT_MODEL`, not a separate speech-to-text service.
 *
 * `generationConfig.audioTimestamp` is documented as required to enable
 * timestamp understanding for audio-only input. It is spelled out here rather
 * than assumed, because without it the model has no reason to return times at
 * all - and the reference page for it is a Vertex page, so whether the AI Studio
 * path honours it identically is worth checking before the first paid call.
 *
 * The audio is sent inline rather than uploaded to the Files API: a voice-over is
 * well under a megabyte, and a second round trip to upload it would double the
 * latency of a stage that already waits on a model.
 */
export function createGeminiTranscribeClient(options: GeminiTranscribeClientOptions) {
  const baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  const doFetch = options.fetchImpl ?? fetch;

  return {
    kind: 'gemini-transcribe' as const,

    async alignCaptions(model: string, request: CaptionRequest): Promise<CaptionSegment[]> {
      const numbered = request.lines
        .map((line, index) => `${index}. ${line.narration}`)
        .join('\n');

      const prompt = [
        'You are timing captions for a short vertical video.',
        'Below is the approved script, one line per index. For each line, report the',
        'moment in the audio at which that line starts and stops being spoken.',
        '',
        'Return JSON of the form {"segments":[{"lineIndex":0,"startSeconds":1.25,"endSeconds":4.5}]}.',
        'Times are seconds from the start of the audio, as decimals. One segment per',
        'line, in order. If a line is not audible in the audio, give it the timing of',
        'the nearest line rather than omitting it.',
        '',
        'SCRIPT:',
        numbered,
      ].join('\n');

      const response = await doFetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType: 'audio/wav', data: request.voice.toString('base64') } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            // Documented as required for timestamp understanding on audio input.
            audioTimestamp: true,
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new MediaModelError(
          `caption alignment responded ${response.status}: ${detail.slice(0, 300)}`,
          response.status === 429 || response.status >= 500,
          model,
        );
      }

      const payload = await readJson(response, model);
      const text = dig(payload, ['candidates', '0', 'content', 'parts', '0', 'text']);
      if (typeof text !== 'string' || text.trim().length === 0) {
        const blocked = dig(payload, ['promptFeedback', 'blockReason']);
        throw new MediaModelError(
          typeof blocked === 'string'
            ? `caption alignment blocked the request (${blocked}).`
            : 'caption alignment returned no text.',
          false,
          model,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new MediaModelError(
          `caption alignment returned text that is not JSON: ${text.slice(0, 200)}`,
          true,
          model,
        );
      }

      const result = captionSegmentsSchema.safeParse(parsed);
      if (!result.success) {
        // Same rule as every other LLM output: the failure names what was wrong
        // rather than clamping, because a mistimed caption is a broken video.
        const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
        throw new MediaModelError(
          `caption alignment returned unusable timings (${issues.join('; ')}).`,
          false,
          model,
        );
      }

      const count = request.lines.length;
      return result.data.segments
        .filter((segment) => segment.lineIndex < count)
        .map((segment) => ({
          lineIndex: segment.lineIndex,
          // Clamped here rather than downstream: a cue that starts after the video
          // ends is a caption nobody can read.
          startSeconds: Math.min(Math.max(0, segment.startSeconds), request.durationSeconds),
          endSeconds: Math.min(Math.max(0, segment.endSeconds), request.durationSeconds),
        }));
    },
  };
}
