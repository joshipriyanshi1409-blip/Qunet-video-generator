import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { creatorDnaSchema, type CreatorDna } from '@creatordna/shared';
import { createLogger } from '@creatordna/shared/logger';
import { createApp } from '../app.js';
import { createLocalFileDnaLearningRepository } from '../lib/dnaLearningRepository.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import { createDnaLearningService, type DnaLearningService } from '../services/dnaLearning.service.js';
import { createTextModelService, type TextModelClient, type TextModelResponse } from '../services/ai/index.js';
import { testConfig, testLogger } from './helpers.js';

/**
 * The learning loop over HTTP.
 *
 * This is the layer the frontend actually talks to, so it is where the rules
 * become observable: a signal is 201, an unauthenticated read is 401, a bad kind
 * is 400, a generate with nothing new to learn from never reaches the model, and
 * **only accept writes the profile**.
 */

const logger = createLogger({ level: 'silent' });

const devHeaders = { 'x-dev-uid': 'creator-a' };

/** A profile the suggestions can be accepted into. */
const existingDna: CreatorDna = creatorDnaSchema.parse({
  niche: 'DSA interview prep',
  tone: ['direct'],
  audience: ['Career switchers'],
  style: 'Whiteboard, fast cuts',
  personality: ['blunt'],
  format: 'whiteboard',
  vocabulary: ['bisect'],
  catchphrases: ['Binary search in 30 seconds'],
  dos: ['dry run the code'],
  donts: ['jargon dumps'],
  samplePosts: [],
});

/** What the model returns for a run. */
const suggestionSet = JSON.stringify({
  suggestions: [
    {
      field: 'vocabulary',
      action: 'add',
      value: ['amortized'],
      rationale: 'You said it twice and it stuck.',
      evidence: ['sig_1'],
    },
  ],
});

function stubClient(response: () => TextModelResponse): TextModelClient {
  return { name: 'stub', generate: async () => response() };
}

/** In-memory profile store, so no test touches the filesystem for DNA. */
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
      return { id: 'h1', kind: 'feedback', createdAt: new Date().toISOString(), summary: 'x' };
    },
    async listHistory() {
      return [];
    },
  };
}

let directory: string;
let dna: DnaRepository;

function buildApp(options: { aiLimit?: number; aiWindowMs?: number; withDna?: boolean } = {}) {
  const ai = createTextModelService({
    client: stubClient(() => ({
      text: suggestionSet,
      promptTokens: 400,
      completionTokens: 120,
      model: 'test-model',
    })),
    logger,
    primaryModel: 'test-model',
    sleep: async () => undefined,
  });

  const service: DnaLearningService = createDnaLearningService({
    learning: createLocalFileDnaLearningRepository(directory),
    dna,
    ai,
    logger: testLogger(),
    signalLimit: 30,
    maxSuggestions: 6,
  });

  if (options.withDna !== false) {
    void dna.save('creator-a', existingDna);
  }

  return createApp({
    config: testConfig({ DEV_AUTH_BYPASS: 'true' }),
    logger: testLogger(),
    redis: null,
    queues: null,
    dnaRepository: dna,
    ai,
    dnaLearningService: service,
    aiRateLimit: options.aiLimit ?? 20,
    aiRateLimitWindowMs: options.aiWindowMs ?? 60_000,
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dna-routes-'));
  dna = memoryDnaRepository();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('POST /api/v1/dna/signals', () => {
  it('records a signal and returns it with a minted id', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'Binary search is 8 lines.', source: 'hook-lab' })
      .expect(201);

    const signal = response.body.data;
    expect(signal.kind).toBe('hook_chosen');
    expect(signal.label).toBe('Binary search is 8 lines.');
    expect(signal.id).toBeTruthy();
  });

  it('accepts every signal kind the loop learns from', async () => {
    const app = buildApp();

    for (const kind of ['hook_chosen', 'remix_approved', 'remix_rejected', 'audience_tip_applied']) {
      await request(app)
        .post('/api/v1/dna/signals')
        .set(devHeaders)
        .send({ kind, label: `a ${kind} moment`, source: 'test' })
        .expect(201);
    }

    const listed = await request(app).get('/api/v1/dna/signals').set(devHeaders).expect(200);
    expect(listed.body.data.signals).toHaveLength(4);
  });

  it('rejects a kind the loop has never heard of', async () => {
    const app = buildApp();

    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'watched_the_whole_video', label: 'x', source: 'test' })
      .expect(422);
  });

  it('rejects an empty label, because a signal with no content teaches nothing', async () => {
    const app = buildApp();

    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: '   ', source: 'test' })
      .expect(422);
  });

  it('refuses an anonymous caller', async () => {
    const app = buildApp();

    await request(app)
      .post('/api/v1/dna/signals')
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(401);
  });
});

describe('GET /api/v1/dna/signals', () => {
  it('returns the creator signals and not another creator', async () => {
    const app = buildApp();

    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'mine', source: 'test' })
      .expect(201);
    await request(app)
      .post('/api/v1/dna/signals')
      .set({ 'x-dev-uid': 'creator-b' })
      .send({ kind: 'remix_approved', label: 'theirs', source: 'test' })
      .expect(201);

    const response = await request(app).get('/api/v1/dna/signals').set(devHeaders).expect(200);

    expect(response.body.data.signals).toHaveLength(1);
    expect(response.body.data.signals[0].label).toBe('mine');
  });

  it('clamps an absurd limit to the configured signal budget', async () => {
    // Without this a `?limit=100000` would page the whole history into memory.
    const app = buildApp();
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);

    const response = await request(app)
      .get('/api/v1/dna/signals?limit=100000')
      .set(devHeaders)
      .expect(200);

    // Only one signal exists, but the request is accepted and capped, not
    // rejected - a UI asking for "everything" still gets a usable answer.
    expect(response.body.data.signals).toHaveLength(1);
  });

  it('falls back to the default when the limit is not a number', async () => {
    const app = buildApp();

    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);

    await request(app).get('/api/v1/dna/signals?limit=lots').set(devHeaders).expect(200);
  });

  it('refuses an anonymous caller', async () => {
    await request(buildApp()).get('/api/v1/dna/signals').expect(401);
  });
});

describe('POST /api/v1/dna/suggestions/generate', () => {
  it('proposes from the new signals and stores them as pending', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'Binary search is 8 lines.', source: 'hook-lab' })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);

    const suggestions = response.body.data.suggestions;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].field).toBe('vocabulary');
    // Stored, not applied.
    expect(suggestions[0].status).toBe('pending');
    expect(suggestions[0].promptId).toBe('dna-learn');

    const listed = await request(app).get('/api/v1/dna/suggestions').set(devHeaders).expect(200);
    expect(listed.body.data.suggestions).toHaveLength(1);
  });

  it('does not touch the DNA: proposing is not applying', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'Binary search is 8 lines.', source: 'hook-lab' })
      .expect(201);

    await request(app).post('/api/v1/dna/suggestions/generate').set(devHeaders).expect(200);

    const profile = await request(app).get('/api/v1/dna').set(devHeaders).expect(200);
    expect(profile.body.data.dna.vocabulary).toEqual(['bisect']);
    expect(profile.body.data.dna.dnaVersion).toBe(existingDna.dnaVersion);
  });

  it('skips without calling the model when there is nothing new', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);

    expect(response.body.data.skipped).toBe(true);
    expect(response.body.data.reason).toBe('no-new-signals');
    expect(response.body.data.suggestions).toEqual([]);
  });

  it('skips without calling the model when the creator has no profile yet', async () => {
    const app = buildApp({ withDna: false });
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);

    expect(response.body.data.reason).toBe('no-profile');
  });

  it('proposes nothing new on a second run over the same signals', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);

    await request(app).post('/api/v1/dna/suggestions/generate').set(devHeaders).expect(200);
    const second = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);

    expect(second.body.data.skipped).toBe(true);
    expect(second.body.data.reason).toBe('no-new-signals');
  });

  it('rate limits the model-backed endpoint', async () => {
    const app = buildApp({ aiLimit: 2, aiWindowMs: 60_000 });
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);

    await request(app).post('/api/v1/dna/suggestions/generate').set(devHeaders).expect(200);
    // The third is the one that trips the limiter: the second is still inside it.
    await request(app).post('/api/v1/dna/suggestions/generate').set(devHeaders).expect(200);
    await request(app).post('/api/v1/dna/suggestions/generate').set(devHeaders).expect(429);
  });

  it('refuses an anonymous caller', async () => {
    await request(buildApp()).post('/api/v1/dna/suggestions/generate').expect(401);
  });
});

describe('GET /api/v1/dna/suggestions', () => {
  it('filters by status', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);

    const generated = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);
    const id = generated.body.data.suggestions[0].id as string;

    await request(app).post(`/api/v1/dna/suggestions/${id}/reject`).set(devHeaders).expect(200);

    const pending = await request(app)
      .get('/api/v1/dna/suggestions?status=pending')
      .set(devHeaders)
      .expect(200);
    expect(pending.body.data.suggestions).toEqual([]);

    const rejected = await request(app)
      .get('/api/v1/dna/suggestions?status=rejected')
      .set(devHeaders)
      .expect(200);
    expect(rejected.body.data.suggestions).toHaveLength(1);
  });
});

describe('POST /api/v1/dna/suggestions/:id/accept', () => {
  async function generateOne(app: ReturnType<typeof buildApp>): Promise<string> {
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);
    const generated = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);
    return generated.body.data.suggestions[0].id as string;
  }

  it('applies the proposal, bumps the version and snapshots it', async () => {
    const app = buildApp();
    const id = await generateOne(app);

    const response = await request(app)
      .post(`/api/v1/dna/suggestions/${id}/accept`)
      .set(devHeaders)
      .expect(200);

    const dnaBody = response.body.data.dna;
    expect(dnaBody.vocabulary).toContain('amortized');
    expect(dnaBody.dnaVersion).toBe(existingDna.dnaVersion + 1);
    // The score comes back recomputed, so the UI needs no second round trip.
    expect(response.body.data.score.score).toBeGreaterThan(0);

    // Two snapshots, on purpose: the profile as it stood *before* the change and
    // the accepted result. A history that only kept the new state could not show
    // what was actually given up.
    const versions = await request(app).get('/api/v1/dna/versions').set(devHeaders).expect(200);
    expect(versions.body.data.versions).toHaveLength(2);
    expect(versions.body.data.versions.map((v: { version: number }) => v.version)).toEqual([
      existingDna.dnaVersion + 1,
      existingDna.dnaVersion,
    ]);
    expect(versions.body.data.versions[0].summary).toBe('Added to vocabulary: amortized');
  });

  it('marks the suggestion accepted so it is not offered twice', async () => {
    const app = buildApp();
    const id = await generateOne(app);

    await request(app).post(`/api/v1/dna/suggestions/${id}/accept`).set(devHeaders).expect(200);

    const listed = await request(app).get('/api/v1/dna/suggestions').set(devHeaders).expect(200);
    expect(listed.body.data.suggestions[0].status).toBe('accepted');
  });

  it('refuses a second accept instead of applying the proposal twice', async () => {
    const app = buildApp();
    const id = await generateOne(app);

    await request(app).post(`/api/v1/dna/suggestions/${id}/accept`).set(devHeaders).expect(200);

    const again = await request(app)
      .post(`/api/v1/dna/suggestions/${id}/accept`)
      .set(devHeaders)
      .expect(409);

    expect(again.body.error.message).toContain('already accepted');

    // The word is there exactly once, and the version did not move again.
    const profile = await request(app).get('/api/v1/dna').set(devHeaders).expect(200);
    expect(profile.body.data.dna.vocabulary).toEqual(['bisect', 'amortized']);
    expect(profile.body.data.dna.dnaVersion).toBe(existingDna.dnaVersion + 1);
  });

  it('404s for a suggestion that was never generated', async () => {
    await request(buildApp())
      .post('/api/v1/dna/suggestions/sug_missing/accept')
      .set(devHeaders)
      .expect(404);
  });

  it('rejects another creator accepting someone else suggestion', async () => {
    const app = buildApp();
    const id = await generateOne(app);

    await request(app)
      .post(`/api/v1/dna/suggestions/${id}/accept`)
      .set({ 'x-dev-uid': 'creator-b' })
      .expect(404);

    // And the original is still pending, so creator-a can still decide.
    const listed = await request(app).get('/api/v1/dna/suggestions').set(devHeaders).expect(200);
    expect(listed.body.data.suggestions[0].status).toBe('pending');
  });

  it('rejects an id longer than the schema allows', async () => {
    await request(buildApp())
      .post(`/api/v1/dna/suggestions/${'x'.repeat(200)}/accept`)
      .set(devHeaders)
      .expect(422);
  });
});

describe('POST /api/v1/dna/suggestions/:id/reject', () => {
  it('leaves the DNA exactly as it was', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/dna/signals')
      .set(devHeaders)
      .send({ kind: 'hook_chosen', label: 'x', source: 'test' })
      .expect(201);
    const generated = await request(app)
      .post('/api/v1/dna/suggestions/generate')
      .set(devHeaders)
      .expect(200);
    const id = generated.body.data.suggestions[0].id as string;

    const response = await request(app)
      .post(`/api/v1/dna/suggestions/${id}/reject`)
      .set(devHeaders)
      .expect(200);

    expect(response.body.data.status).toBe('rejected');

    const profile = await request(app).get('/api/v1/dna').set(devHeaders).expect(200);
    expect(profile.body.data.dna.vocabulary).toEqual(['bisect']);
    expect(profile.body.data.dna.dnaVersion).toBe(existingDna.dnaVersion);

    // Nothing was snapshotted, because nothing changed.
    const versions = await request(app).get('/api/v1/dna/versions').set(devHeaders).expect(200);
    expect(versions.body.data.versions).toEqual([]);
  });
});

describe('GET /api/v1/dna/versions', () => {
  it('refuses an anonymous caller', async () => {
    await request(buildApp()).get('/api/v1/dna/versions').expect(401);
  });
});
