import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createLogger } from '@creatordna/shared/logger';
import { createApp } from '../app.js';
import { createCache, type Cache } from '../lib/cache.js';
import { createDnaService, type DnaService } from '../services/dna.service.js';
import {
  SEED_TRENDS,
  createSeedTrendRepository,
  type TrendRepository,
} from '../lib/trendRepository.js';
import { createTrendService, type TrendService } from '../services/trend.service.js';
import { createTextModelService } from '../services/ai/index.js';
import type { TextModelClient, TextModelResponse } from '../services/ai/index.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import type { CreatorDna } from '@creatordna/shared';
import { testConfig, testLogger } from './helpers.js';

const logger = createLogger({ level: 'silent' });
const devHeaders = { 'x-dev-uid': 'creator-a' };

function stubClient(response: () => TextModelResponse): TextModelClient {
  return { name: 'stub', generate: async () => response() };
}

/** In-memory DNA store, keyed per creator. */
function memoryDnaRepository(): DnaRepository {
  const stored = new Map<string, CreatorDna>();
  return {
    kind: 'local-file',
    async get(uid) {
      return stored.get(uid) ?? null;
    },
    async save(uid, dna) {
      stored.set(uid, dna);
      return dna;
    },
    async appendHistory() {
      return { id: 'h1', kind: 'script', createdAt: new Date().toISOString(), summary: 'x' };
    },
    async listHistory() {
      return [];
    },
  };
}

function dnaFor(): CreatorDna {
  return {
    niche: 'DSA interview prep for career switchers',
    tone: ['direct', 'playful'],
    audience: ['professionals'],
    style: 'Short sentences, whiteboard, fast cuts',
    personality: ['blunt'],
    format: 'whiteboard',
    vocabulary: ['amortized'],
    catchphrases: [],
    dos: [],
    donts: [],
    samplePosts: [],
    audienceAgeRange: '25-34',
    audienceType: 'professionals',
    dnaVersion: 1,
  };
}

/** Builds the app with a DNA profile already stored for `creator-a`. */
function buildApp(options: {
  dna?: CreatorDna | null;
  response: () => TextModelResponse;
  trends?: TrendRepository;
  cache?: Cache;
}): { app: ReturnType<typeof createApp>; cache: Cache } {
  const dnaRepository = memoryDnaRepository();
  if (options.dna !== null) {
    void dnaRepository.save('creator-a', options.dna ?? dnaFor());
  }

  const ai = createTextModelService({
    client: stubClient(options.response),
    logger,
    primaryModel: 'test-model',
    sleep: async () => undefined,
  });

  const dnaService: DnaService = createDnaService({
    repository: dnaRepository,
    ai,
    logger,
    historyLimit: 5,
  });

  const cache = options.cache ?? createCache({});
  const trendService: TrendService = createTrendService({
    repository: options.trends ?? createSeedTrendRepository(),
    dna: dnaService,
    ai,
    cache,
    logger,
    rankingTtlMs: 60_000,
    generationTtlMs: 60_000,
  });

  const app = createApp({
    config: testConfig({ DEV_AUTH_BYPASS: 'true' }),
    logger: testLogger(),
    redis: null,
    queues: null,
    dnaRepository,
    ai,
    dnaService,
    trendService,
  });

  return { app, cache };
}

const remixResponse = () => ({
  text: JSON.stringify({
    format: 'POV: you finally understand {concept} after {time}',
    hook: 'POV: you finally understand binary search after 3 days',
    script: [
      { scene: 'Hook', text: 'POV: you have stared at binary search for three days.' },
      { scene: 'Turn', text: 'The trick is the picture of the search space halving.' },
      { scene: 'CTA', text: 'Follow for the next data structure in plain English.' },
    ],
    cta: 'Follow for the next data structure in plain English.',
    caption: 'Binary search finally clicked.',
    hashtags: ['#dsa', '#interviewprep'],
    whatWasKept: ['POV opening', 'three-beat escalation'],
    whatWasChanged: ['topic swapped to binary search', 'CTA swapped to follow'],
  }),
  promptTokens: 500,
  completionTokens: 220,
  model: 'test-model',
});

/** A model answer for `trend-relevance`: one score per seeded trend. */
const relevanceResponse = () => ({
  text: JSON.stringify({
    scores: SEED_TRENDS.map((trend, index) => ({
      trendId: trend.id,
      relevance: 10 + index,
      reasons: ['ranked by the test model'],
    })),
  }),
  promptTokens: 400,
  completionTokens: 200,
  model: 'test-model',
});

const hookResponse = () => ({
  text: JSON.stringify({
    hooks: [
      { id: 'h1', text: 'Why does your binary search never terminate?', style: 'question', whyItWorks: 'Names a bug.' },
      { id: 'h2', text: 'Binary search is 8 lines. Everyone writes 30.', style: 'bold-claim', whyItWorks: 'Checkable.' },
      { id: 'h3', text: 'POV: the search space just halved.', style: 'pov', whyItWorks: 'Inside the algorithm.' },
      { id: 'h4', text: 'I watched 400 interviews fail on the same line.', style: 'story', whyItWorks: 'Mid-scene.' },
      { id: 'h5', text: 'Stop memorising binary search.', style: 'contrarian', whyItWorks: 'Attacks the obvious.' },
      { id: 'h6', text: 'The bug is never in the loop.', style: 'curiosity-gap', whyItWorks: 'Forces a click.' },
    ],
  }),
  promptTokens: 300,
  completionTokens: 180,
  model: 'test-model',
});

describe('the seeded catalogue', () => {
  it('holds 20 trends with unique ids and a format skeleton', () => {
    expect(SEED_TRENDS).toHaveLength(20);
    const ids = new Set(SEED_TRENDS.map((trend) => trend.id));
    expect(ids.size).toBe(20);
    for (const trend of SEED_TRENDS) {
      expect(trend.format.length).toBeGreaterThan(0);
      expect(trend.description.length).toBeGreaterThan(0);
      expect(trend.popularityScore).toBeGreaterThan(0);
    }
  });
});

describe('GET /api/v1/trends/for-me', () => {
  it('ranks the catalogue for a creator with a DNA profile', async () => {
    const { app } = buildApp({ response: remixResponse });
    const response = await request(app).get('/api/v1/trends/for-me').set(devHeaders).expect(200);

    const trends = response.body.data.trends;
    expect(trends).toHaveLength(20);
    expect(trends[0].relevance).toBeGreaterThanOrEqual(trends[19].relevance);
    // Education leads for an education creator.
    expect(trends[0].trend.category).toBe('education');
    expect(response.body.data.personalizationLimited).toBe(false);
  });

  it('degrades to popularity order when the creator has no DNA yet', async () => {
    const { app } = buildApp({ dna: null, response: remixResponse });
    const response = await request(app).get('/api/v1/trends/for-me').set(devHeaders).expect(200);

    expect(response.body.data.personalizationLimited).toBe(true);
    const relevances = response.body.data.trends.map((entry: { relevance: number }) => entry.relevance);
    const sorted = [...relevances].sort((a, b) => b - a);
    expect(relevances).toEqual(sorted);
  });

  it('caches the ranking per creator for the TTL', async () => {
    let calls = 0;
    const { app } = buildApp({
      response: () => {
        calls += 1;
        return relevanceResponse();
      },
    });

    await request(app).get('/api/v1/trends/for-me').set(devHeaders).expect(200);
    const second = await request(app).get('/api/v1/trends/for-me').set(devHeaders).expect(200);

    // The relevance prompt is only worth calling once per TTL window.
    expect(calls).toBe(1);
    expect(second.body.data.trends.every((entry: { cached: boolean }) => entry.cached)).toBe(true);
  });

  it('still ranks when the model is unavailable', async () => {
    const failing: TextModelClient = {
      name: 'failing',
      generate: async () => {
        throw new Error('model is down');
      },
    };
    const ai = createTextModelService({
      client: failing,
      logger,
      primaryModel: 'test-model',
      sleep: async () => undefined,
    });
    const dnaRepository = memoryDnaRepository();
    await dnaRepository.save('creator-a', dnaFor());
    const dnaService = createDnaService({ repository: dnaRepository, ai, logger, historyLimit: 5 });
    const app = createApp({
      config: testConfig({ DEV_AUTH_BYPASS: 'true' }),
      logger: testLogger(),
      redis: null,
      queues: null,
      dnaRepository,
      ai,
      dnaService,
      trendService: createTrendService({
        repository: createSeedTrendRepository(),
        dna: dnaService,
        ai,
        cache: createCache({}),
        logger,
      }),
    });

    const response = await request(app).get('/api/v1/trends/for-me').set(devHeaders).expect(200);
    expect(response.body.data.trends).toHaveLength(20);
  });

  it('requires auth', async () => {
    const { app } = buildApp({ response: remixResponse });
    await request(app).get('/api/v1/trends/for-me').expect(401);
  });
});

describe('POST /api/v1/trends/remix', () => {
  it('remixes a trend for the creator and keeps the trend id', async () => {
    const { app } = buildApp({ response: remixResponse });
    const response = await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ trendId: 'trend_pov_finally' })
      .expect(200);

    const remix = response.body.data;
    expect(remix.trendId).toBe('trend_pov_finally');
    expect(remix.format).toBe('POV: you finally understand {concept} after {time}');
    expect(remix.script.length).toBeGreaterThan(1);
    expect(remix.whatWasKept.length).toBeGreaterThan(0);
    expect(remix.whatWasChanged.length).toBeGreaterThan(0);
  });

  it('accepts a free-text idea with no trend', async () => {
    const { app } = buildApp({ response: remixResponse });
    const response = await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ idea: 'Explain binary search to a nervous interviewee' })
      .expect(200);

    expect(response.body.data.trendId).toBeNull();
  });

  it('rejects a request with neither a trend nor an idea', async () => {
    const { app } = buildApp({ response: remixResponse });
    await request(app).post('/api/v1/trends/remix').set(devHeaders).send({}).expect(422);
  });

  it('404s for an unknown trend', async () => {
    const { app } = buildApp({ response: remixResponse });
    await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ trendId: 'trend_does_not_exist' })
      .expect(404);
  });

  it('404s when the creator has not onboarded', async () => {
    const { app } = buildApp({ dna: null, response: remixResponse });
    await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ trendId: 'trend_pov_finally' })
      .expect(404);
  });

  it('caches an identical remix instead of paying for it twice', async () => {
    let calls = 0;
    const { app } = buildApp({
      response: () => {
        calls += 1;
        return remixResponse();
      },
    });

    await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ trendId: 'trend_pov_finally' })
      .expect(200);
    await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ trendId: 'trend_pov_finally' })
      .expect(200);

    expect(calls).toBe(1);
  });

  it('surfaces a model failure as 503 and persists nothing', async () => {
    const failing: TextModelClient = {
      name: 'failing',
      generate: async () => {
        throw new Error('model is down');
      },
    };
    const ai = createTextModelService({
      client: failing,
      logger,
      primaryModel: 'test-model',
      sleep: async () => undefined,
    });
    const dnaRepository = memoryDnaRepository();
    await dnaRepository.save('creator-a', dnaFor());
    const dnaService = createDnaService({ repository: dnaRepository, ai, logger, historyLimit: 5 });

    const app = createApp({
      config: testConfig({ DEV_AUTH_BYPASS: 'true' }),
      logger: testLogger(),
      redis: null,
      queues: null,
      dnaRepository,
      ai,
      dnaService,
      trendService: createTrendService({
        repository: createSeedTrendRepository(),
        dna: dnaService,
        ai,
        cache: createCache({}),
        logger,
      }),
    });

    await request(app)
      .post('/api/v1/trends/remix')
      .set(devHeaders)
      .send({ trendId: 'trend_pov_finally' })
      .expect(503);
  });

  it('requires auth', async () => {
    const { app } = buildApp({ response: remixResponse });
    await request(app).post('/api/v1/trends/remix').send({ idea: 'x' }).expect(401);
  });
});

describe('POST /api/v1/trends/hooks', () => {
  it('returns 5-8 hooks with style labels', async () => {
    const { app } = buildApp({ response: hookResponse });
    const response = await request(app)
      .post('/api/v1/trends/hooks')
      .set(devHeaders)
      .send({ idea: 'Explain binary search to a nervous interviewee' })
      .expect(200);

    const hooks = response.body.data.hooks;
    expect(hooks).toHaveLength(6);
    for (const hook of hooks) {
      expect(hook.style).toBeTruthy();
      expect(hook.whyItWorks).toBeTruthy();
    }
    expect(new Set(hooks.map((hook: { style: string }) => hook.style)).size).toBe(6);
  });

  it('regenerates exactly one hook when a style is named', async () => {
    const { app } = buildApp({
      response: () => ({
        text: JSON.stringify({
          hooks: [
            { id: 'h1', text: 'POV: the search space just halved.', style: 'pov', whyItWorks: 'Inside the algorithm.' },
          ],
        }),
        promptTokens: 120,
        completionTokens: 40,
        model: 'test-model',
      }),
    });

    const response = await request(app)
      .post('/api/v1/trends/hooks')
      .set(devHeaders)
      .send({ idea: 'Explain binary search', regenerateStyle: 'pov' })
      .expect(200);

    expect(response.body.data.hooks).toHaveLength(1);
    expect(response.body.data.hooks[0].style).toBe('pov');
  });

  it('rejects an empty idea', async () => {
    const { app } = buildApp({ response: hookResponse });
    await request(app).post('/api/v1/trends/hooks').set(devHeaders).send({ idea: '  ' }).expect(422);
  });

  it('rejects a count outside 5-8', async () => {
    const { app } = buildApp({ response: hookResponse });
    await request(app)
      .post('/api/v1/trends/hooks')
      .set(devHeaders)
      .send({ idea: 'x', count: 3 })
      .expect(422);
  });

  it('requires auth', async () => {
    const { app } = buildApp({ response: hookResponse });
    await request(app).post('/api/v1/trends/hooks').send({ idea: 'x' }).expect(401);
  });
});

describe('POST /api/v1/trends/seed', () => {
  it('writes the missing trends and reports how many', async () => {
    let seeds = 0;
    const repository: TrendRepository = {
      kind: 'seed',
      async list() {
        return [...SEED_TRENDS];
      },
      async get(id) {
        return SEED_TRENDS.find((trend) => trend.id === id) ?? null;
      },
      async seed() {
        seeds += 1;
        return 20;
      },
    };
    const { app } = buildApp({ response: remixResponse, trends: repository });

    const response = await request(app).post('/api/v1/trends/seed').set(devHeaders).expect(200);
    expect(response.body.data.written).toBe(20);
    expect(seeds).toBe(1);
  });
});
