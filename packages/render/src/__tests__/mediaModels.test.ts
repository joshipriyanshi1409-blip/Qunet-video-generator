import { describe, expect, it, vi } from 'vitest';
import {
  captionSegmentsSchema,
  createGeminiTranscribeClient,
  createGeminiTtsClient,
  createLyriaMusicClient,
  createVeoClipClient,
  MediaModelError,
} from '../mediaModels.js';
import { readWavHeader } from '../media/wav.js';

/**
 * The three media model clients.
 *
 * None of these has been called against the live API - there is no key in this
 * repository - so what is being pinned down here is the *contract with Google*:
 * the URL, the auth header, the request body shape, and the paths the response
 * is read out of. A fake `fetch` that answers with the documented response is
 * the only way to check that without spending credits.
 */

const CLIP_REQUEST = {
  sceneIndex: 1,
  visualPrompt: 'A desk at dawn. Vertical 9:16.',
  narration: 'Then I drew the array on paper.',
  durationSeconds: 10,
  width: 1080,
  height: 1920,
};

/** A `fetch` that returns queued responses in order, recording what it was sent. */
function fakeFetch(responses: readonly { status?: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let index = 0;

  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    // Past the end of the queue, the last response is repeated - so a test that
    // polls twice gets the same "not done yet" answer rather than `undefined`.
    const next = responses[Math.min(index, responses.length - 1)] ?? { status: 200 };
    index += 1;
    const status = next.status ?? 200;
    const body =
      next.body === undefined
        ? '{}'
        : typeof next.body === 'string'
          ? next.body
          : JSON.stringify(next.body);

    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  });

  return { impl: impl as unknown as typeof fetch, calls };
}

describe('createVeoClipClient', () => {
  const started = { name: 'operations/veo-123' };

  function operationDone(videoUri = 'https://example.com/clip.mp4') {
    return {
      body: {
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: videoUri } }] } },
      },
    };
  }

  it('starts a long-running operation with the 9:16 aspect ratio', async () => {
    const fetch = fakeFetch([{ body: started }]);
    // A tiny timeout makes the poll loop give up after one poll rather than
    // after four minutes, which is all this test needs to inspect the start call.
    const client = createVeoClipClient({
      apiKey: 'test-key',
      fetchImpl: fetch.impl,
      pollIntervalMs: 1,
      timeoutMs: 1,
    });

    await expect(client.generateClip('veo-x', CLIP_REQUEST)).rejects.toThrow(MediaModelError);

    const [first] = fetch.calls;
    expect(first?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/veo-x:predictLongRunning',
    );

    const headers = first?.init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-key');

    const body = JSON.parse(String(first?.init?.body)) as {
      instances: { prompt: string }[];
      parameters: Record<string, unknown>;
    };
    expect(body.instances[0]?.prompt).toContain('A desk at dawn');
    // The narration reaches the model, so the shot does not contradict the line.
    expect(body.instances[0]?.prompt).toContain('Then I drew the array on paper');
    expect(body.parameters).toMatchObject({ aspectRatio: '9:16', durationSeconds: 10, sampleCount: 1 });
  });

  it('polls the operation, then downloads the video with the API key', async () => {
    const fetch = fakeFetch([{ body: started }, operationDone(), { body: 'BINARY-MP4-BYTES' }]);
    const client = createVeoClipClient({ apiKey: 'test-key', fetchImpl: fetch.impl, pollIntervalMs: 1 });

    const media = await client.generateClip('veo-x', CLIP_REQUEST);

    expect(media.extension).toBe('mp4');
    expect(media.mimeType).toBe('video/mp4');
    expect(media.bytes.toString('utf8')).toBe('BINARY-MP4-BYTES');

    // Three round trips: start, poll, download.
    expect(fetch.calls).toHaveLength(3);
    expect(fetch.calls[1]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/operations/veo-123',
    );
    expect(fetch.calls[2]?.url).toBe('https://example.com/clip.mp4');
    expect((fetch.calls[2]?.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });

  it('fails the stage, not the job, when the operation reports an error', async () => {
    // A blocked generation is a prompt problem: rephrasing fixes it, re-running
    // the same prompt does not. That is what `retryable: false` records.
    const fetch = fakeFetch([{ body: started }, { body: { done: true, error: { message: 'blocked' } } }]);
    const client = createVeoClipClient({ apiKey: 'test-key', fetchImpl: fetch.impl, pollIntervalMs: 1 });

    const error = await client.generateClip('veo-x', CLIP_REQUEST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaModelError);
    expect((error as MediaModelError).message).toContain('blocked');
    expect((error as MediaModelError).retryable).toBe(false);
  });

  it('treats a 429 from the start call as worth another attempt', async () => {
    const fetch = fakeFetch([{ status: 429, body: { error: 'rate limited' } }]);
    const client = createVeoClipClient({ apiKey: 'test-key', fetchImpl: fetch.impl, pollIntervalMs: 1 });

    const error = await client.generateClip('veo-x', CLIP_REQUEST).catch((caught: unknown) => caught);

    expect((error as MediaModelError).message).toContain('429');
    expect((error as MediaModelError).retryable).toBe(true);
  });

  it('refuses to hand back an empty clip', async () => {
    const fetch = fakeFetch([{ body: started }, operationDone(), { body: '' }]);
    const client = createVeoClipClient({ apiKey: 'test-key', fetchImpl: fetch.impl, pollIntervalMs: 1 });

    await expect(client.generateClip('veo-x', CLIP_REQUEST)).rejects.toThrow(/empty clip/);
  });
});

describe('createGeminiTtsClient', () => {
  const pcm = Buffer.alloc(48_000); // 1 second of 16-bit mono at 24 kHz
  const audioPart = {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }],
        },
      },
    ],
  };

  it('asks for AUDIO and wraps the raw PCM in a WAV at the rate it was given', async () => {
    const fetch = fakeFetch([{ body: audioPart }]);
    const client = createGeminiTtsClient({ apiKey: 'test-key', fetchImpl: fetch.impl, voiceName: 'Kore' });

    const media = await client.synthesizeVoice('tts-x', {
      lines: [{ narration: 'Then I drew the array on paper.', durationSeconds: 10 }],
      direction: 'warm, brisk',
    });

    expect(media.extension).toBe('wav');
    expect(media.mimeType).toBe('audio/wav');

    // The rate came out of the mime type, not out of an assumption. Assuming
    // 16 kHz here would play every voice at two-thirds speed.
    const header = readWavHeader(media.bytes);
    expect(header.sampleRate).toBe(24_000);
    expect(header.channels).toBe(1);
    expect(header.durationSeconds).toBeCloseTo(1, 5);

    const body = JSON.parse(String(fetch.calls[0]?.init?.body)) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.generationConfig['responseModalities']).toEqual(['AUDIO']);
    expect(
      (body.generationConfig['speechConfig'] as { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } })
        .voiceConfig.prebuiltVoiceConfig.voiceName,
    ).toBe('Kore');
    expect(body.contents[0]?.parts[0]?.text).toContain('warm, brisk');
  });

  it('makes one call per line and concatenates the audio in order', async () => {
    const short = Buffer.alloc(2_400); // 0.05s at 24 kHz
    const long = Buffer.alloc(4_800); // 0.1s
    const fetch = fakeFetch([
      {
        body: {
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: short.toString('base64') } }] } },
          ],
        },
      },
      {
        body: {
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: long.toString('base64') } }] } },
          ],
        },
      },
    ]);
    const client = createGeminiTtsClient({ apiKey: 'test-key', fetchImpl: fetch.impl });

    const media = await client.synthesizeVoice('tts-x', {
      lines: [
        { narration: 'One.', durationSeconds: 10 },
        { narration: 'Two.', durationSeconds: 10 },
      ],
    });

    expect(fetch.calls).toHaveLength(2);
    expect(readWavHeader(media.bytes).durationSeconds).toBeCloseTo(0.15, 5);
  });

  it('reports a safety block as not retryable', async () => {
    const fetch = fakeFetch([{ body: { promptFeedback: { blockReason: 'SAFETY' } } }]);
    const client = createGeminiTtsClient({ apiKey: 'test-key', fetchImpl: fetch.impl });

    await expect(
      client.synthesizeVoice('tts-x', { lines: [{ narration: 'x', durationSeconds: 1 }] }),
    ).rejects.toThrow(/SAFETY/);
  });
});

describe('createGeminiTranscribeClient', () => {
  const REQUEST = {
    // A 44-byte canonical WAV header is enough: the client base64s whatever it is
    // given and never parses it.
    voice: buildWav(32),
    lines: [
      { narration: 'I wrote the same loop nine times.', durationSeconds: 15 },
      { narration: 'Then I drew the array on paper.', durationSeconds: 15 },
    ],
    durationSeconds: 30,
  };

  function answer(segments: unknown) {
    return {
      body: {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ segments }) }] } }],
      },
    };
  }

  it('sends the audio inline with audioTimestamp enabled', async () => {
    const fetch = fakeFetch([
      answer([
        { lineIndex: 0, startSeconds: 0.4, endSeconds: 6.1 },
        { lineIndex: 1, startSeconds: 6.4, endSeconds: 12.9 },
      ]),
    ]);
    const client = createGeminiTranscribeClient({ apiKey: 'test-key', fetchImpl: fetch.impl });

    const segments = await client.alignCaptions('transcribe-x', REQUEST);

    expect(segments).toEqual([
      { lineIndex: 0, startSeconds: 0.4, endSeconds: 6.1 },
      { lineIndex: 1, startSeconds: 6.4, endSeconds: 12.9 },
    ]);

    const body = JSON.parse(String(fetch.calls[0]?.init?.body)) as {
      contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
      generationConfig: Record<string, unknown>;
    };
    const parts = body.contents[0]?.parts ?? [];
    // Both parts in ONE content entry: the audio and the instruction that goes
    // with it are a single turn, not two.
    expect(parts).toHaveLength(2);
    expect(parts[1]?.inlineData?.mimeType).toBe('audio/wav');
    expect(Buffer.from(parts[1]?.inlineData?.data ?? '', 'base64').equals(REQUEST.voice)).toBe(true);
    expect(body.generationConfig['responseMimeType']).toBe('application/json');
    // Documented as required for timestamp understanding on audio-only input.
    expect(body.generationConfig['audioTimestamp']).toBe(true);
    expect(parts[0]?.text).toContain('I wrote the same loop nine times.');
  });

  it('clamps a cue that runs past the end of the video', async () => {
    const fetch = fakeFetch([
      answer([
        { lineIndex: 0, startSeconds: 0, endSeconds: 400 },
        { lineIndex: 1, startSeconds: 12, endSeconds: 999 },
      ]),
    ]);
    const client = createGeminiTranscribeClient({ apiKey: 'k', fetchImpl: fetch.impl });

    const segments = await client.alignCaptions('transcribe-x', REQUEST);

    expect(segments.map((segment) => segment.endSeconds)).toEqual([30, 30]);
  });

  it('drops a segment for a line that does not exist', async () => {
    // A model that invents a third line when the script has two would otherwise
    // produce a caption with no text behind it.
    const fetch = fakeFetch([
      answer([
        { lineIndex: 0, startSeconds: 0, endSeconds: 5 },
        { lineIndex: 7, startSeconds: 5, endSeconds: 9 },
      ]),
    ]);
    const client = createGeminiTranscribeClient({ apiKey: 'k', fetchImpl: fetch.impl });

    const segments = await client.alignCaptions('transcribe-x', REQUEST);
    expect(segments).toEqual([{ lineIndex: 0, startSeconds: 0, endSeconds: 5 }]);
  });

  it('reports unusable timings as a validation failure, not a clamp', async () => {
    const fetch = fakeFetch([{ body: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] } }]);
    const client = createGeminiTranscribeClient({ apiKey: 'k', fetchImpl: fetch.impl });

    await expect(client.alignCaptions('transcribe-x', REQUEST)).rejects.toThrow(/not JSON/);
  });

  it('rejects a response that is valid JSON but not the agreed shape', async () => {
    const fetch = fakeFetch([answer([{ start: 1, end: 2 }])]);
    const client = createGeminiTranscribeClient({ apiKey: 'k', fetchImpl: fetch.impl });

    await expect(client.alignCaptions('transcribe-x', REQUEST)).rejects.toThrow(/unusable timings/);
  });

  it('names a safety block rather than blaming the audio', async () => {
    const fetch = fakeFetch([{ body: { promptFeedback: { blockReason: 'SAFETY' } } }]);
    const client = createGeminiTranscribeClient({ apiKey: 'k', fetchImpl: fetch.impl });

    await expect(client.alignCaptions('transcribe-x', REQUEST)).rejects.toThrow(/SAFETY/);
  });
});

describe('captionSegmentsSchema', () => {
  it('accepts the documented shape and rejects a missing index', () => {
    expect(
      captionSegmentsSchema.safeParse({ segments: [{ lineIndex: 0, startSeconds: 0, endSeconds: 1 }] }).success,
    ).toBe(true);
    expect(captionSegmentsSchema.safeParse({ segments: [{ startSeconds: 0, endSeconds: 1 }] }).success).toBe(
      false,
    );
    // An empty list is unusable: there would be nothing to time.
    expect(captionSegmentsSchema.safeParse({ segments: [] }).success).toBe(false);
  });
});

describe('createLyriaMusicClient', () => {
  it('posts to the Vertex predict endpoint with a bearer token and trims to the storyboard', async () => {
    const wav = buildWav(48_000); // 2 seconds at 8 kHz
    const fetch = fakeFetch([
      { body: { predictions: [{ audioContent: wav.toString('base64'), mimeType: 'audio/wav' }] } },
    ]);
    const client = createLyriaMusicClient({
      authorization: 'Bearer ya29.test',
      baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
      fetchImpl: fetch.impl,
    });

    const media = await client.composeMusic('lyria-x', { brief: 'warm and brisk', durationSeconds: 1 });

    expect(fetch.calls[0]?.url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/models/lyria-x:predict',
    );
    const headers = fetch.calls[0]?.init?.headers as Record<string, string>;
    // OAuth, not an API key: Lyria 2 has no API-key path.
    expect(headers['authorization']).toBe('Bearer ya29.test');

    const body = JSON.parse(String(fetch.calls[0]?.init?.body)) as {
      instances: Record<string, unknown>[];
      parameters: Record<string, unknown>;
    };
    expect(body.instances[0]?.['prompt']).toBe('warm and brisk');
    expect(body.parameters).toEqual({ sample_count: 1 });

    // Trimmed to the storyboard's runtime, not left at the model's fixed length.
    expect(readWavHeader(media.bytes).durationSeconds).toBeCloseTo(1, 5);
  });

  it('leaves a bed that is already short enough alone', async () => {
    // Asking for 30s of a 1s track must not pad it with silence: a silent gap
    // under the last scene is worse than a bed that simply ends.
    const wav = buildWav(8_000);
    const fetch = fakeFetch([{ body: { predictions: [{ audioContent: wav.toString('base64') }] } }]);
    const client = createLyriaMusicClient({
      authorization: 'Bearer t',
      baseUrl: 'https://example.com/v1',
      fetchImpl: fetch.impl,
    });

    const media = await client.composeMusic('lyria-x', { brief: 'calm', durationSeconds: 30 });

    expect(readWavHeader(media.bytes).durationSeconds).toBeCloseTo(1, 5);
    expect(media.bytes.length).toBe(wav.length);
  });

  it('fails legibly when there is no prediction', async () => {
    const fetch = fakeFetch([{ body: { predictions: [] } }]);
    const client = createLyriaMusicClient({
      authorization: 'Bearer t',
      baseUrl: 'https://example.com/v1',
      fetchImpl: fetch.impl,
    });

    await expect(client.composeMusic('lyria-x', { brief: 'calm', durationSeconds: 10 })).rejects.toThrow(
      /no audio prediction/,
    );
  });
});

/** A canonical 16-bit mono WAV at 8 kHz, `frames` samples long. */
function buildWav(frames: number): Buffer {
  const data = Buffer.alloc(frames * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8_000, 24);
  header.writeUInt32LE(16_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
