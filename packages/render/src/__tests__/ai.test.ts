import { describe, expect, it, vi } from 'vitest';
import { renderCreateRequestSchema } from '@creatordna/shared';
import {
  createLiveRenderAi,
  createMediaRenderAi,
  createMockRenderAi,
  mockCaptions,
  mockClip,
  mockStoryboard,
} from '../ai.js';
import { decodeRenderEvent, encodeRenderEvent, RENDER_EVENTS_CHANNEL } from '../events.js';

/**
 * The AI seam and the event codec.
 *
 * The mock storyboard is the asset the whole mock pipeline runs on, so its
 * determinism and its cost-limit compliance are worth pinning down. The live
 * path is checked with a fake `callJson`, which is the shape the API's wrapper
 * already satisfies.
 */

const PAYLOAD = renderCreateRequestSchema.parse({
  projectId: 'proj_1',
  hook: 'POV: binary search finally clicks',
  script: [
    { scene: 'The bug', text: 'I wrote the same loop nine times.' },
    { scene: 'The fix', text: 'Then I drew the array on paper.' },
  ],
  cta: 'Follow for part two',
});

describe('mockStoryboard', () => {
  it('is deterministic, so a retry sees the scene list it saw first time', () => {
    expect(mockStoryboard(PAYLOAD)).toEqual(mockStoryboard(PAYLOAD));
  });

  it('spreads the target runtime across the scenes and lands inside the window', () => {
    const storyboard = mockStoryboard(PAYLOAD);
    const total = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);

    expect(total).toBe(30);
    expect(total).toBeGreaterThanOrEqual(15);
    expect(total).toBeLessThanOrEqual(45);
  });

  it('gives the remainder to the last scene rather than losing a second', () => {
    // Three scenes into 30s is 10s each with nothing left over; five into 30 is
    // 6s each with nothing over either, so use a case that does divide unevenly.
    const uneven = renderCreateRequestSchema.parse({
      ...PAYLOAD,
      script: Array.from({ length: 7 }, (_, index) => ({
        scene: `Scene ${index + 1}`,
        text: `Line ${index + 1}.`,
      })),
    });

    const scenes = mockStoryboard(uneven).scenes;
    expect(scenes.slice(0, 6).every((scene) => scene.duration === 4)).toBe(true);
    expect(scenes[6]?.duration).toBe(6); // 4 + the 2-second remainder
  });

  it('carries the hook as the first scene\u2019s on-screen text', () => {
    const scenes = mockStoryboard(PAYLOAD).scenes;
    expect(scenes[0]?.onScreenText).toBe(PAYLOAD.hook);
    expect(scenes[1]?.onScreenText).toBe('');
  });

  it('caps the scene count at the cost limit', () => {
    const tooMany = renderCreateRequestSchema.parse({
      ...PAYLOAD,
      script: Array.from({ length: 12 }, (_, index) => ({
        scene: `Scene ${index + 1}`,
        text: `Line ${index + 1}.`,
      })),
    });

    expect(mockStoryboard(tooMany).scenes).toHaveLength(8);
  });
});

describe('createMockRenderAi', () => {
  it('says it is a mock, so the boot log can too', async () => {
    const ai = createMockRenderAi();
    expect(ai.mode).toBe('mock');
    await expect(ai.buildStoryboard(PAYLOAD, null)).resolves.toEqual(mockStoryboard(PAYLOAD));
  });
});

describe('createLiveRenderAi', () => {
  it('sends the registered prompt and returns the validated storyboard', async () => {
    const callJson = vi.fn().mockResolvedValue({
      data: {
        scenes: [
          { sceneId: 'scene-1', duration: 15, narration: 'One', visualPrompt: 'A', onScreenText: '' },
          { sceneId: 'scene-2', duration: 20, narration: 'Two', visualPrompt: 'B', onScreenText: '' },
        ],
      },
      usage: { promptTokens: 100, completionTokens: 50, model: 'a-model' },
      reprompted: false,
    });

    const ai = createLiveRenderAi({
      // The dependency is an object with a `callJson` method, which is the shape
      // the API's `TextModelService` already has.
      callJson: { callJson } as never,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
      model: 'a-model',
    });

    const storyboard = await ai.buildStoryboard(PAYLOAD, null);

    expect(ai.mode).toBe('live');
    expect(storyboard.scenes).toHaveLength(2);
    expect(callJson).toHaveBeenCalledTimes(1);

    const [messages, options] = callJson.mock.calls[0] as [{ system: string; user: string }, { promptId: string }];
    expect(options.promptId).toBe('storyboard');
    // The prompt carries the approved script, not a re-read of the project.
    expect(messages.user).toContain('I wrote the same loop nine times.');
    expect(messages.user).toContain(PAYLOAD.hook);
  });

  it('rejects a storyboard that breaks the shared cross-checks', async () => {
    // Valid against the draft schema (each scene 1-45s) but the total is 90s,
    // which the shared schema rejects.
    const callJson = vi.fn().mockResolvedValue({
      data: {
        scenes: [
          { sceneId: 'scene-1', duration: 45, narration: 'One', visualPrompt: 'A', onScreenText: '' },
          { sceneId: 'scene-2', duration: 45, narration: 'Two', visualPrompt: 'B', onScreenText: '' },
        ],
      },
      usage: { promptTokens: 1, completionTokens: 1, model: 'a-model' },
      reprompted: false,
    });

    const ai = createLiveRenderAi({
      callJson: { callJson } as never,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
      model: 'a-model',
    });

    await expect(ai.buildStoryboard(PAYLOAD, null)).rejects.toThrow();
  });
});

/** A storyboard the stub wrapper answers with: two scenes, 30s total. */
const storyboardAnswer = {
  data: {
    scenes: [
      { sceneId: 'scene-1', duration: 15, narration: 'One', visualPrompt: 'A', onScreenText: '' },
      { sceneId: 'scene-2', duration: 15, narration: 'Two', visualPrompt: 'B', onScreenText: '' },
    ],
  },
  usage: { promptTokens: 10, completionTokens: 5, model: 'a-model' },
  reprompted: false,
};

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

/**
 * Builds a media AI with a stubbed storyboard call.
 *
 * Shared by the storyboard, media and caption tests: they all exercise the same
 * object and differ only in which slots they configure.
 */
function build(overrides: Partial<Parameters<typeof createMediaRenderAi>[0]> = {}) {
  const callJson = vi.fn().mockResolvedValue(storyboardAnswer);
  const ai = createMediaRenderAi({
    callJson: { callJson } as never,
    logger,
    model: 'text-model',
    ...overrides,
  });
  return { ai, callJson };
}

describe('createMediaRenderAi', () => {
  const clipRequest = {
    sceneIndex: 0,
    visualPrompt: 'A desk at dawn',
    narration: 'One.',
    durationSeconds: 15,
    width: 1080,
    height: 1920,
  };

  it('says it is live and still routes the storyboard through the wrapper', async () => {
    const { ai, callJson } = build();

    expect(ai.mode).toBe('live');
    const storyboard = await ai.buildStoryboard(PAYLOAD, null);
    expect(storyboard.scenes).toHaveLength(2);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it('injects the DNA snapshot into the storyboard prompt', async () => {
    // The DNA is the product: a storyboard built without it reads as "unknown
    // niche, unknown tone" for every creator, which is a different product.
    const { ai, callJson } = build();
    const dna = {
      dnaVersion: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
      niche: 'deadpan finance explainers',
      tone: ['dry', 'brisk'],
      audience: ['junior devs'],
      style: 'screen recordings with a red pen',
      personality: ['sardonic'],
      vocabulary: ['amortised'],
      catchphrases: ['and that is the trick'],
      dos: ['open on the number'],
      donts: ['no hype words'],
    };

    await ai.buildStoryboard(PAYLOAD, dna as never);

    const [messages] = callJson.mock.calls[0] as [{ system: string; user: string }];
    const rendered = `${messages.system}\n${messages.user}`;
    expect(rendered).toContain('deadpan finance explainers');
    expect(rendered).toContain('dry, brisk');
    expect(rendered).toContain('sardonic');
    expect(rendered).toContain('and that is the trick');
  });

  it('falls back to a still frame per slot with no model id, and says so', async () => {
    const { ai } = build();

    const clip = await ai.generateClip(clipRequest);
    // Same bytes as the mock, so the rest of the pipeline cannot tell them apart.
    expect(clip.bytes.equals(mockClip(clipRequest).bytes)).toBe(true);
    expect(clip.extension).toBe('png');
  });

  it('uses the clip generator when both a model id and a client are configured', async () => {
    const clipGenerator = {
      generateClip: vi.fn().mockResolvedValue({
        bytes: Buffer.from('an mp4'),
        mimeType: 'video/mp4',
        extension: 'mp4',
        durationSeconds: 15,
      }),
    };
    const { ai } = build({ clipModel: 'veo-x', clipGenerator });

    const clip = await ai.generateClip(clipRequest);

    expect(clip.extension).toBe('mp4');
    expect(clipGenerator.generateClip).toHaveBeenCalledWith('veo-x', clipRequest);
    // The frame reaches the generator: a still sized differently from the video
    // would be invisible, because qc checks the MP4 and ffmpeg rescales.
    expect(clipGenerator.generateClip.mock.calls[0]?.[1]).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it('does not call a generator whose model id is missing, even if one is wired', async () => {
    // A client with no model id is a misconfiguration, and the honest response is
    // the mock plus a warning - not a call that will 404.
    const clipGenerator = { generateClip: vi.fn() };
    const { ai } = build({ clipGenerator });

    await ai.generateClip(clipRequest);
    expect(clipGenerator.generateClip).not.toHaveBeenCalled();
  });

  it('wires the voice and music slots independently of the clip slot', async () => {
    const voiceGenerator = { synthesizeVoice: vi.fn().mockResolvedValue({ bytes: Buffer.alloc(8), mimeType: 'audio/wav', extension: 'wav' }) };
    const musicGenerator = { composeMusic: vi.fn().mockResolvedValue({ bytes: Buffer.alloc(8), mimeType: 'audio/wav', extension: 'wav' }) };
    const { ai } = build({ voiceModel: 'tts-x', voiceGenerator, musicModel: 'lyria-x', musicGenerator });

    const voice = await ai.synthesizeVoice({ lines: [{ narration: 'One.', durationSeconds: 15 }] });
    const music = await ai.composeMusic({ brief: 'warm', durationSeconds: 30 });

    expect(voiceGenerator.synthesizeVoice).toHaveBeenCalledWith('tts-x', expect.anything());
    expect(musicGenerator.composeMusic).toHaveBeenCalledWith('lyria-x', expect.anything());
    // Clips were left alone: no VEO_MODEL, so they stay mock stills.
    expect((await ai.generateClip(clipRequest)).extension).toBe('png');
    expect(voice.bytes.length).toBe(8);
    expect(music.bytes.length).toBe(8);
  });
});

describe('caption alignment', () => {
  const CAPTION_REQUEST = {
    voice: Buffer.alloc(64),
    lines: [
      { narration: 'I wrote the same loop nine times.', durationSeconds: 15 },
      { narration: 'Then I drew the array on paper.', durationSeconds: 15 },
    ],
    durationSeconds: 30,
  };

  it('the mock times captions from the storyboard, which is exact for a mock voice', () => {
    // `mockVoice` synthesises precisely `line.durationSeconds` per line, so the
    // storyboard's own plan IS the truth here - not an approximation.
    expect(mockCaptions(CAPTION_REQUEST)).toEqual([
      { lineIndex: 0, startSeconds: 0, endSeconds: 15 },
      { lineIndex: 1, startSeconds: 15, endSeconds: 30 },
    ]);
  });

  it('uses the caption generator when both a model id and a client are configured', async () => {
    const captionGenerator = {
      alignCaptions: vi.fn().mockResolvedValue([
        { lineIndex: 0, startSeconds: 0.3, endSeconds: 6.2 },
        { lineIndex: 1, startSeconds: 6.5, endSeconds: 12.8 },
      ]),
    };
    const { ai } = build({ captionModel: 'transcribe-x', captionGenerator });

    const segments = await ai.alignCaptions(CAPTION_REQUEST);

    expect(captionGenerator.alignCaptions).toHaveBeenCalledWith('transcribe-x', CAPTION_REQUEST);
    expect(segments[0]).toEqual({ lineIndex: 0, startSeconds: 0.3, endSeconds: 6.2 });
  });

  it('falls back to the storyboard plan with no model id, and says so at debug level', async () => {
    // Deliberately not a warning: the plan is a legitimate caption source. It
    // only drifts once a *real* voice-over is in the mix.
    const { ai } = build();
    const segments = await ai.alignCaptions(CAPTION_REQUEST);

    expect(segments).toEqual(mockCaptions(CAPTION_REQUEST));
  });

  it('does not call a generator whose model id is missing', async () => {
    const captionGenerator = { alignCaptions: vi.fn() };
    const { ai } = build({ captionGenerator });

    await ai.alignCaptions(CAPTION_REQUEST);
    expect(captionGenerator.alignCaptions).not.toHaveBeenCalled();
  });
});

describe('the render event codec', () => {
  it('round-trips a progress event', () => {
    const event = {
      type: 'render.progress' as const,
      jobId: 'job_1',
      stage: 'assets' as const,
      progress: 62,
      message: 'generated scene 2 of 3',
    };

    expect(decodeRenderEvent(encodeRenderEvent(event))).toEqual(event);
  });

  it('drops a payload that is not a render event', () => {
    expect(decodeRenderEvent('not json')).toBeNull();
    expect(decodeRenderEvent(JSON.stringify({ type: 'something.else' }))).toBeNull();
    expect(decodeRenderEvent(JSON.stringify({ type: 'render.progress', jobId: 'x', stage: 'nope', progress: 5 }))).toBeNull();
  });

  it('keeps the channel name in one place', () => {
    expect(RENDER_EVENTS_CHANNEL).toBe('creatordna:render:events');
  });
});
