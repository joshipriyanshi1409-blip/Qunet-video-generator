import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  creatorDnaSchema,
  type CreatorDna,
  type DnaHistoryItem,
  type DnaOnboardingInput,
} from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';
import { createApp } from '../app.js';
import { createDnaService, type DnaService } from '../services/dna.service.js';
import { createLocalFileDnaRepository, type DnaRepository } from '../lib/dnaRepository.js';
import { createTextModelService } from '../services/ai/index.js';
import type { TextModelClient, TextModelResponse } from '../services/ai/index.js';
import { testConfig, testLogger } from './helpers.js';

const logger = createLogger({ level: 'silent' });

/** A model that returns whatever the test tells it to. */
function stubClient(response: () => TextModelResponse): TextModelClient {
  return {
    name: 'stub',
    generate: async () => response(),
  };
}

const validDnaJson = JSON.stringify({
  niche: 'DSA interview prep',
  tone: ['direct', 'practical'],
  audience: ['Career switchers'],
  style: 'Short sentences, whiteboard, fast cuts',
  personality: ['blunt', 'encouraging'],
  format: 'whiteboard',
  vocabulary: ['amortized'],
  catchphrases: ['Binary search in 30 seconds'],
  dos: ['dry run the code'],
  donts: ['jargon dumps'],
  samplePosts: [],
});

const onboarding: DnaOnboardingInput = {
  niche: 'DSA interview prep for career switchers',
  audienceAgeRange: '25-34',
  audienceType: 'professionals',
  audienceDescription: 'Engineers who freeze in interviews',
  tone: ['direct', 'practical'],
  format: 'whiteboard',
  samplePosts: [{ text: 'Binary search in 30 seconds. Amortized analysis matters.' }],
};

/** In-memory repository so tests never touch the filesystem. */
function memoryRepository(): DnaRepository & { history: Map<string, DnaHistoryItem[]> } {
  const stored = new Map<string, CreatorDna>();
  const history = new Map<string, DnaHistoryItem[]>();
  let counter = 0;

  return {
    kind: 'local-file',
    history,
    async get(uid) {
      return stored.get(uid) ?? null;
    },
    async save(uid, dna) {
      stored.set(uid, dna);
      return dna;
    },
    async appendHistory(uid, kind, summary) {
      counter += 1;
      const item: DnaHistoryItem = {
        id: `h${counter}`,
        kind,
        createdAt: new Date().toISOString(),
        summary,
      };
      history.set(uid, [item, ...(history.get(uid) ?? [])]);
      return item;
    },
    async listHistory(uid, limit) {
      return (history.get(uid) ?? []).slice(0, limit);
    },
  };
}

function buildApp(repository: DnaRepository, response: () => TextModelResponse) {
  const ai = createTextModelService({
    client: stubClient(response),
    logger,
    primaryModel: 'test-model',
    sleep: async () => undefined,
  });

  return createApp({
    config: testConfig({ DEV_AUTH_BYPASS: 'true' }),
    logger: testLogger(),
    redis: null,
    queues: null,
    dnaRepository: repository,
    ai,
  });
}

const devHeaders = { 'x-dev-uid': 'creator-a' };

describe('POST /api/v1/dna/extract', () => {
  it('extracts, saves and returns the DNA with its score and context', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 420,
      completionTokens: 180,
      model: 'test-model',
    }));

    const response = await request(app)
      .post('/api/v1/dna/extract')
      .set(devHeaders)
      .send(onboarding)
      .expect(200);

    const body = response.body.data;
    expect(body.dna.dnaVersion).toBe(1);
    expect(body.dna.niche).toBe('DSA interview prep for career switchers');
    // Onboarding answers always win over the model's guesses.
    expect(body.dna.audienceAgeRange).toBe('25-34');
    expect(body.dna.audienceType).toBe('professionals');
    expect(body.dna.format).toBe('whiteboard');
    // Sample posts come from the creator, not the model.
    expect(body.dna.samplePosts).toEqual(onboarding.samplePosts);
    expect(body.score.completeness).toBe(100);
    expect(body.context).toContain('CREATOR DNA (uid: creator-a, version 1)');
    expect(body.context).toContain('niche: DSA interview prep for career switchers');
    expect(body.contextTokens).toBeGreaterThan(0);
    expect(body.contextTokens).toBeLessThanOrEqual(500);
    expect(body.usage.totalTokens).toBe(600);
    expect(body.reprompted).toBe(false);
    expect(body.promptId).toBe('dna-extract');
  });

  it('persists the profile so a reload sees it', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 10,
      completionTokens: 5,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);

    const reloaded = await request(app).get('/api/v1/dna').set(devHeaders).expect(200);
    expect(reloaded.body.data.dna.niche).toBe('DSA interview prep for career switchers');
    expect(reloaded.body.data.dna.dnaVersion).toBe(1);
    expect(reloaded.body.data.score.score).toBe(100);
  });

  it('bumps dnaVersion when the content actually changes', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 10,
      completionTokens: 5,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);

    const second = await request(app)
      .post('/api/v1/dna/extract')
      .set(devHeaders)
      .send({ ...onboarding, niche: 'System design interviews' })
      .expect(200);

    expect(second.body.data.dna.dnaVersion).toBe(2);
    expect(second.body.data.dna.niche).toBe('System design interviews');
  });

  it('keeps dnaVersion when the content is identical', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 10,
      completionTokens: 5,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);
    const again = await request(app)
      .post('/api/v1/dna/extract')
      .set(devHeaders)
      .send(onboarding)
      .expect(200);

    expect(again.body.data.dna.dnaVersion).toBe(1);
  });

  it('re-prompts once when the first answer is invalid, then succeeds', async () => {
    const repository = memoryRepository();
    const answers = [
      { text: '{"niche":"DSA"}', promptTokens: 1, completionTokens: 1, model: 'test-model' },
      { text: validDnaJson, promptTokens: 1, completionTokens: 1, model: 'test-model' },
    ];
    let index = 0;
    const app = buildApp(repository, () => {
      const next = answers[index];
      index += 1;
      if (next === undefined) throw new Error('no more answers');
      return next;
    });

    const response = await request(app)
      .post('/api/v1/dna/extract')
      .set(devHeaders)
      .send(onboarding)
      .expect(200);

    expect(response.body.data.reprompted).toBe(true);
    expect(index).toBe(2);
  });

  it('fails with 503 when the model never returns valid JSON', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: 'not json',
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    const response = await request(app)
      .post('/api/v1/dna/extract')
      .set(devHeaders)
      .send(onboarding)
      .expect(503);

    expect(response.body.error.code).toBe('ai_response_invalid');
    // Nothing was stored.
    expect(await repository.get('creator-a')).toBeNull();
  });

  it('rejects a request without auth', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').send(onboarding).expect(401);
  });

  it('rejects an incomplete onboarding payload with 422', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    const response = await request(app)
      .post('/api/v1/dna/extract')
      .set(devHeaders)
      .send({ niche: 'DSA' })
      .expect(422);

    expect(response.body.error.code).toBe('validation_failed');
  });

  it('never leaks another creator profile', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);

    await request(app).get('/api/v1/dna').set({ 'x-dev-uid': 'creator-b' }).expect(404);
  });
});

describe('GET /api/v1/dna', () => {
  it('404s before onboarding', async () => {
    const app = buildApp(memoryRepository(), () => {
      throw new Error('should not call the model');
    });

    const response = await request(app).get('/api/v1/dna').set(devHeaders).expect(404);
    expect(response.body.error.code).toBe('not_found');
  });
});

describe('PUT /api/v1/dna', () => {
  it('merges a partial edit and bumps dnaVersion', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);

    const response = await request(app)
      .put('/api/v1/dna')
      .set(devHeaders)
      .send({ tone: ['direct', 'playful'], catchphrases: ['Here is the trick'] })
      .expect(200);

    expect(response.body.data.dna.dnaVersion).toBe(2);
    expect(response.body.data.dna.tone).toEqual(['direct', 'playful']);
    expect(response.body.data.dna.catchphrases).toEqual(['Here is the trick']);
    // Untouched fields survive the merge.
    expect(response.body.data.dna.niche).toBe('DSA interview prep for career switchers');
    expect(response.body.data.dna.format).toBe('whiteboard');
  });

  it('rejects an empty edit with 422', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);

    await request(app).put('/api/v1/dna').set(devHeaders).send({ tone: [] }).expect(422);
  });
});

describe('GET /api/v1/dna/context', () => {
  it('returns the exact block injected into prompts', async () => {
    const repository = memoryRepository();
    const app = buildApp(repository, () => ({
      text: validDnaJson,
      promptTokens: 1,
      completionTokens: 1,
      model: 'test-model',
    }));

    await request(app).post('/api/v1/dna/extract').set(devHeaders).send(onboarding).expect(200);

    const response = await request(app).get('/api/v1/dna/context').set(devHeaders).expect(200);

    expect(response.body.data.context).toContain('CREATOR DNA (uid: creator-a');
    expect(response.body.data.tokens).toBeLessThanOrEqual(500);
    // Extraction appends one history item.
    expect(response.body.data.historyItemsUsed).toBe(1);
  });
});

describe('createLocalFileDnaRepository', () => {
  it('round-trips a profile through a temp directory', async () => {
    const directory = `.data/test-dna-${Date.now()}`;
    const repository = createLocalFileDnaRepository(directory);
    const dna = creatorDnaSchema.parse({
      niche: 'Cooking',
      tone: ['warm'],
      audience: ['Parents'],
      style: 'Overhead shots',
      personality: ['calm'],
      format: 'b-roll-voiceover',
    });

    await repository.save('uid-1', dna);
    const loaded = await repository.get('uid-1');
    expect(loaded?.niche).toBe('Cooking');

    const item = await repository.appendHistory('uid-1', 'script', 'Made a 30s reel.');
    expect(item.kind).toBe('script');
    expect(await repository.listHistory('uid-1', 5)).toHaveLength(1);

    // A different creator sees nothing.
    expect(await repository.get('uid-2')).toBeNull();
  });
});

describe('createDnaService', () => {
  it('builds the context for a creator with no history', async () => {
    const repository = memoryRepository();
    const service: DnaService = createDnaService({
      repository,
      ai: createTextModelService({
        client: stubClient(() => ({
          text: validDnaJson,
          promptTokens: 1,
          completionTokens: 1,
          model: 'test-model',
        })),
        logger,
        primaryModel: 'test-model',
        sleep: async () => undefined,
      }),
      logger,
      historyLimit: 5,
    });

    await service.extract('creator-a', onboarding);
    const context = await service.buildContext('creator-a');

    expect(context.text).toContain('RECENT WORK');
    expect(context.tokens).toBeLessThanOrEqual(500);
  });
});
