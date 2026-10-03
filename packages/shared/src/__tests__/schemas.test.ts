import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AI_PREDICTION_DISCLAIMER,
  apiEnvelopeSchema,
  audienceMirrorResultSchema,
  blankEnvToUndefined,
  creatorDnaOnboardingSchema,
  creatorDnaSchema,
  creatorDnaUpsertSchema,
  healthResponseSchema,
  HOOK_STYLE_LABELS,
  hookSetSchema,
  INTEREST_LEVELS,
  INTEREST_TO_REACTION,
  improveRequestSchema,
  projectSchema,
  renderJobPayloadSchema,
  hookStyleSchema,
  hookLabRequestSchema,
  jobStateSchema,
  meResponseSchema,
  pingJobPayloadSchema,
  renderJobSchema,
  rankedTrendSchema,
  trendRemixRequestSchema,
  trendRemixSchema,
  trendSchema,
} from '../schemas/index.js';

const validDna = {
  niche: 'DSA interview prep',
  tone: ['direct', 'encouraging'],
  audience: ['Students', 'Working professionals'],
  style: 'Fast cuts, whiteboard, plain English',
  personality: ['blunt', 'patient'],
  format: 'whiteboard' as const,
  vocabulary: ['amortized', 'off-by-one'],
  catchphrases: ['Let that sink in'],
  dos: ['show the dry run'],
  donts: ['no jargon dumps'],
  samplePosts: [{ text: 'Binary search in 30 seconds' }],
};

describe('creatorDnaSchema', () => {
  it('accepts a complete profile and defaults dnaVersion to 1', () => {
    const parsed = creatorDnaSchema.parse(validDna);
    expect(parsed.dnaVersion).toBe(1);
    expect(parsed.audience).toEqual(['Students', 'Working professionals']);
  });

  it('applies array defaults when optional fields are omitted', () => {
    const parsed = creatorDnaSchema.parse({
      niche: 'Cooking',
      tone: ['warm'],
      audience: ['Parents'],
      style: 'Hands only, overhead shots',
      personality: ['calm'],
      format: 'b-roll-voiceover',
    });
    expect(parsed.vocabulary).toEqual([]);
    expect(parsed.catchphrases).toEqual([]);
    expect(parsed.dos).toEqual([]);
    expect(parsed.donts).toEqual([]);
    expect(parsed.samplePosts).toEqual([]);
  });

  it('requires niche, tone, audience, style, personality and format', () => {
    const result = creatorDnaSchema.safeParse({ niche: 'Cooking' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining(['tone', 'audience', 'style', 'personality', 'format']),
      );
    }
  });

  it('rejects an empty tone array and an unknown format', () => {
    expect(
      creatorDnaSchema.safeParse({ ...validDna, tone: [] }).success,
    ).toBe(false);
    expect(
      creatorDnaSchema.safeParse({ ...validDna, format: 'vlog' }).success,
    ).toBe(false);
  });

  it('treats dnaVersion/updatedAt as optional on upsert', () => {
    const parsed = creatorDnaUpsertSchema.parse(validDna);
    expect(parsed.dnaVersion).toBeUndefined();
    expect(parsed.updatedAt).toBeUndefined();
    // defaults still apply on upsert
    expect(parsed.dos).toEqual(['show the dry run']);
  });

  it('rejects unknown keys during onboarding (strict)', () => {
    const result = creatorDnaOnboardingSchema.safeParse({
      niche: 'Cooking',
      nope: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a partial onboarding answer set', () => {
    expect(creatorDnaOnboardingSchema.parse({ niche: 'Cooking' }).niche).toBe('Cooking');
  });
});

describe('trendSchema / trendRemixSchema', () => {
  it('parses a trend document', () => {
    const trend = trendSchema.parse({
      id: 'trend_pov_finally',
      title: 'POV: You finally ...',
      format: 'POV: You finally {achievement}',
      description: 'Creator narrates the moment a concept clicks.',
      category: 'education',
      popularityScore: 91,
    });
    expect(trend.category).toBe('education');
  });

  it('keeps the trend format but swaps topic, examples and CTA', () => {
    const remix = trendRemixSchema.parse({
      trendId: 'trend_pov_finally',
      format: 'POV: You finally {achievement}',
      hook: 'POV: You finally understand Binary Search after 3 days',
      script: [
        { scene: 'Hook', text: 'POV: ...' },
        { scene: 'Payoff', text: 'Here is the diagram.' },
      ],
      cta: 'Follow for the next data structure in plain English',
      caption: 'Binary search finally clicked.',
      hashtags: ['#dsa', '#interviewprep'],
      whatWasKept: ['POV opening', 'Three-beat escalation'],
      whatWasChanged: ['Topic swapped to binary search', 'CTA swapped to follow'],
    });
    expect(remix.format).toBe('POV: You finally {achievement}');
    expect(remix.hook).toContain('Binary Search');
    expect(remix.script).toHaveLength(2);
    expect(remix.hashtags).toEqual(['#dsa', '#interviewprep']);
    expect(remix.whatWasKept).toHaveLength(2);
  });

  it('defaults hashtags to an empty list and trendId to null', () => {
    const remix = trendRemixSchema.parse({
      format: 'f',
      hook: 'h',
      script: [{ scene: 'Hook', text: 'text' }],
      cta: 'c',
      caption: 'cap',
      whatWasKept: ['kept'],
      whatWasChanged: ['changed'],
    });
    expect(remix.hashtags).toEqual([]);
    expect(remix.trendId).toBeNull();
  });

  it('rejects a remix with an empty script', () => {
    expect(
      trendRemixSchema.safeParse({
        format: 'f',
        hook: 'h',
        script: [],
        cta: 'c',
        caption: 'cap',
        whatWasKept: ['kept'],
        whatWasChanged: ['changed'],
      }).success,
    ).toBe(false);
  });

  it('rejects a remix that cannot say what was kept or changed', () => {
    const base = {
      format: 'f',
      hook: 'h',
      script: [{ scene: 'Hook', text: 'text' }],
      cta: 'c',
      caption: 'cap',
    };
    expect(trendRemixSchema.safeParse({ ...base, whatWasKept: [], whatWasChanged: ['x'] }).success).toBe(false);
    expect(trendRemixSchema.safeParse({ ...base, whatWasKept: ['x'], whatWasChanged: [] }).success).toBe(false);
  });

  it('requires a trendId or a free-text idea, but not both', () => {
    expect(trendRemixRequestSchema.safeParse({ trendId: 't1' }).success).toBe(true);
    expect(trendRemixRequestSchema.safeParse({ idea: 'explain binary search' }).success).toBe(true);
    expect(trendRemixRequestSchema.safeParse({}).success).toBe(false);
  });

  it('parses a ranked trend with reasons', () => {
    const ranked = rankedTrendSchema.parse({
      trend: {
        id: 't1',
        title: 'A trend',
        format: 'Do the thing',
        description: 'A description.',
        category: 'education',
      },
      relevance: 87,
      reasons: ['matches your niche'],
    });
    expect(ranked.relevance).toBe(87);
    expect(ranked.cached).toBe(false);
  });
});

describe('hookSetSchema', () => {
  const hooks = Array.from({ length: 6 }, (_, index) => ({
    id: `h${index + 1}`,
    text: `Hook number ${index + 1}`,
    style: 'question' as const,
    whyItWorks: 'Open loop',
  }));

  it('accepts 5-8 hooks', () => {
    expect(hookSetSchema.parse({ hooks }).hooks).toHaveLength(6);
  });

  it('rejects fewer than 5 and more than 8 hooks', () => {
    expect(hookSetSchema.safeParse({ hooks: hooks.slice(0, 4) }).success).toBe(false);
    expect(
      hookSetSchema.safeParse({ hooks: [...hooks, ...hooks.slice(0, 3)] }).success,
    ).toBe(false);
  });

  it('accepts every style the brief names', () => {
    for (const style of ['question', 'bold-claim', 'pov', 'story', 'contrarian', 'curiosity-gap']) {
      expect(hookStyleSchema.safeParse(style).success).toBe(true);
    }
    expect(hookStyleSchema.safeParse('listicle').success).toBe(false);
  });

  it('labels every style for the UI', () => {
    for (const style of hookStyleSchema.options) {
      expect(HOOK_STYLE_LABELS[style]).toBeTruthy();
    }
  });

  it('defaults the hook count to 6 and allows a single-style regeneration', () => {
    const request = hookLabRequestSchema.parse({ idea: 'binary search' });
    expect(request.count).toBe(6);
    expect(hookLabRequestSchema.parse({ idea: 'x', regenerateStyle: 'pov' }).regenerateStyle).toBe('pov');
  });

  it('rejects an empty idea', () => {
    expect(hookLabRequestSchema.safeParse({ idea: '   ' }).success).toBe(false);
  });
});

describe('audienceMirrorResultSchema', () => {
  const valid = {
    predictions: [
      { segmentName: 'Students', interest: 'High', reason: 'Matches their goal', tip: 'Name the time saved' },
    ],
    overallInsight: 'Students are the whole audience here.',
    improvedCta: 'Follow for the next one.',
  };

  it('attaches the mandatory AI disclaimer by default', () => {
    const mirror = audienceMirrorResultSchema.parse(valid);
    expect(mirror.disclaimer).toBe(AI_PREDICTION_DISCLAIMER);
    expect(mirror.predictions[0]?.interest).toBe('High');
    expect(mirror.predictions[0]?.segmentName).toBe('Students');
  });

  it('rejects an interest level outside High / Medium / Low', () => {
    expect(
      audienceMirrorResultSchema.safeParse({
        ...valid,
        predictions: [{ ...valid.predictions[0], interest: 'huge' }],
      }).success,
    ).toBe(false);
  });

  it('requires an insight and an improved CTA', () => {
    const { overallInsight: _insight, ...withoutInsight } = valid;
    expect(audienceMirrorResultSchema.safeParse(withoutInsight).success).toBe(false);
  });

  it('maps every wire interest level onto the shared reaction vocabulary', () => {
    expect(INTEREST_TO_REACTION).toEqual({ High: 'high', Medium: 'medium', Low: 'low' });
    for (const level of INTEREST_LEVELS) {
      expect(INTEREST_TO_REACTION[level]).toBeDefined();
    }
  });
});

describe('projectSchema', () => {
  const version = {
    version: 1,
    kind: 'mirror' as const,
    hook: 'POV: you finally get binary search',
    cta: 'Follow for more',
    content: 'POV: you finally get binary search',
    createdAt: '2026-10-02T10:00:00.000Z',
  };

  const valid = {
    id: 'proj_1',
    uid: 'uid_1',
    idea: 'Explain binary search',
    versions: [version],
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };

  it('defaults a new project to draft with no approval and no render job', () => {
    const project = projectSchema.parse(valid);
    expect(project.status).toBe('draft');
    expect(project.approvedVersion).toBeNull();
    expect(project.renderJobId).toBeNull();
    expect(project.trendId).toBeNull();
  });

  it('accepts a mirror attached to a version', () => {
    const project = projectSchema.parse({
      ...valid,
      versions: [
        {
          ...version,
          mirror: {
            predictions: [
              { segmentName: 'Students', interest: 'Medium', reason: 'r', tip: 't' },
            ],
            overallInsight: 'i',
            improvedCta: 'c',
          },
          feedback: ['Name the time saved'],
        },
      ],
    });
    expect(project.versions[0]?.mirror?.predictions[0]?.interest).toBe('Medium');
    expect(project.versions[0]?.feedback).toEqual(['Name the time saved']);
  });

  it('rejects an unknown status', () => {
    expect(projectSchema.safeParse({ ...valid, status: 'shipped' }).success).toBe(false);
  });

  it('rejects a version with no version number', () => {
    const { version: _version, ...withoutNumber } = version;
    expect(projectSchema.safeParse({ ...valid, versions: [withoutNumber] }).success).toBe(false);
  });
});

describe('improveRequestSchema', () => {
  it('defaults feedback to empty and recheck to true', () => {
    const parsed = improveRequestSchema.parse({ projectId: 'p1', target: 'cta' });
    expect(parsed.feedback).toEqual([]);
    expect(parsed.recheck).toBe(true);
  });

  it('rejects a target other than hook or cta', () => {
    expect(improveRequestSchema.safeParse({ projectId: 'p1', target: 'caption' }).success).toBe(
      false,
    );
  });
});

describe('renderJobPayloadSchema', () => {
  it('stamps nothing but what the client sent, and defaults hashtags', () => {
    const payload = renderJobPayloadSchema.parse({
      projectId: 'proj_1',
      hook: 'POV: you finally get binary search',
      script: [{ scene: 'Hook', text: 'POV: you stared at it for three days.' }],
      cta: 'Follow for more',
    });
    expect(payload.hashtags).toEqual([]);
    expect(payload).not.toHaveProperty('uid');
  });

  it('requires at least one script beat', () => {
    expect(
      renderJobPayloadSchema.safeParse({
        projectId: 'proj_1',
        hook: 'h',
        script: [],
        cta: 'c',
      }).success,
    ).toBe(false);
  });
});

describe('renderJobSchema', () => {
  it('parses a queued job with no assets', () => {
    const job = renderJobSchema.parse({
      jobId: '1',
      uid: 'uid_1',
      queue: 'render',
      state: 'waiting',
      stage: 'queued',
      progress: 0,
      payload: { projectId: 'proj_1', hook: 'a hook', script: [], cta: 'a cta' },
    });
    expect(job.assets).toEqual([]);
    expect(job.error).toBeNull();
    expect(job.attemptsMade).toBe(0);
  });

  it('records cached assets so a failed stage can retry without redoing work', () => {
    const job = renderJobSchema.parse({
      jobId: '2',
      uid: 'uid_1',
      queue: 'render',
      state: 'failed',
      stage: 'voice',
      progress: 45,
      attemptsMade: 1,
      assets: [
        { kind: 'clip', storagePath: 'renders/uid_1/2/scene-0.mp4', sceneIndex: 0 },
        { kind: 'music', storagePath: 'renders/uid_1/2/music.mp3' },
      ],
      error: {
        stage: 'voice',
        message: 'TTS timeout',
        attempts: 1,
        retryable: true,
      },
      payload: {
        projectId: 'proj_1',
        hook: 'a hook',
        script: [],
        cta: 'a cta',
      },
    });
    expect(job.assets.map((asset) => asset.kind)).toEqual(['clip', 'music']);
    expect(job.error?.retryable).toBe(true);
  });

  it('rejects progress outside 0-100', () => {
    expect(
      renderJobSchema.safeParse({
        jobId: '3',
        uid: 'uid_1',
        queue: 'render',
        state: 'waiting',
        stage: 'queued',
        progress: 120,
      }).success,
    ).toBe(false);
  });
});

describe('api schemas', () => {
  it('parses the health envelope', () => {
    const health = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
      environment: 'development',
      uptimeSeconds: 12.5,
      timestamp: new Date().toISOString(),
      checks: { redis: 'ok' },
    });
    expect(health.checks.redis).toBe('ok');
  });

  it('coerces ping payload strings coming from a query string', () => {
    const payload = pingJobPayloadSchema.parse({
      message: 'hi',
      delayMs: '250',
      failFirstAttempts: '1',
    });
    expect(payload.delayMs).toBe(250);
    expect(payload.failFirstAttempts).toBe(1);
  });

  it('defaults the ping message', () => {
    expect(pingJobPayloadSchema.parse({}).message).toBe('ping');
  });

  it('parses the /me response shape', () => {
    const me = meResponseSchema.parse({
      uid: 'uid_1',
      email: 'creator@example.com',
      emailVerified: true,
      devAuthBypass: false,
      claims: {},
    });
    expect(me.uid).toBe('uid_1');
  });

  it('wraps arbitrary data in the success envelope', () => {
    const schema = apiEnvelopeSchema(z.object({ ok: z.boolean() }));
    expect(schema.parse({ data: { ok: true } })).toEqual({ data: { ok: true } });
  });

  it('knows every BullMQ job state', () => {
    expect(jobStateSchema.options).toContain('waiting-children');
  });

  describe('blankEnvToUndefined', () => {
    it('treats a blank .env value as unset', () => {
      expect(blankEnvToUndefined('')).toBeUndefined();
      expect(blankEnvToUndefined('   ')).toBeUndefined();
    });

    it('leaves real values and non-strings alone', () => {
      expect(blankEnvToUndefined('gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(blankEnvToUndefined(undefined)).toBeUndefined();
      expect(blankEnvToUndefined(42)).toBe(42);
    });

    it('lets a copied .env.example boot: blank optional env vars parse', () => {
      const schema = z.preprocess(
        blankEnvToUndefined,
        z
          .object({
            FIREBASE_PROJECT_ID: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).optional()),
            GEMINI_TEXT_MODEL: z.preprocess(blankEnvToUndefined, z.string().trim().min(1).optional()),
          })
          .default({}),
      );

      expect(schema.parse({})).toEqual({});
      expect(schema.parse({ FIREBASE_PROJECT_ID: '', GEMINI_TEXT_MODEL: '' })).toEqual({});
      expect(schema.parse({ GEMINI_TEXT_MODEL: 'a-model' })).toEqual({ GEMINI_TEXT_MODEL: 'a-model' });
    });
  });
});
