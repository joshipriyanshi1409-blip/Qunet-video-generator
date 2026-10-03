import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { CreatorDna } from '@creatordna/shared';
import { createApp } from '../app.js';
import { createDnaService, type DnaService } from '../services/dna.service.js';
import { createMemoryProjectRepository, type ProjectRepository } from '../lib/projectRepository.js';
import { createAudienceService, type AudienceService } from '../services/audience.service.js';
import { createRenderJobService, type RenderJobService } from '../services/renderJob.service.js';
import { createMemoryRenderJobRepository } from '../lib/renderJobRepository.js';
import type { RenderJobAccepted } from '@creatordna/shared';
import { createTextModelService } from '../services/ai/index.js';
import type { TextModelClient, TextModelResponse } from '../services/ai/index.js';
import type { DnaRepository } from '../lib/dnaRepository.js';
import { testConfig } from './helpers.js';
import { createLogger } from '@creatordna/shared/logger';

const logger = createLogger({ level: "debug" });
const devHeaders = { 'x-dev-uid': 'creator-a' };

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
    audience: ['Career switchers', 'Students'],
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

/**
 * Records the first line of every *user* prompt it is asked for, then answers by
 * prefix - `REWRITE TARGET: hook` and `REWRITE TARGET: cta` are the same prompt
 * with a different target. Keying off the user prompt (not the system prompt)
 * keeps the fixture honest if the system copy is reworded.
 */
function recordingClient(responses: Record<string, TextModelResponse>): {
  client: TextModelClient;
  seen: string[];
} {
  const seen: string[] = [];
  const markers = Object.keys(responses);
  return {
    seen,
    client: {
      name: 'recording',
      generate: async (_model, request) => {
        const first = (request.user.split('\n')[0] ?? '').trim();
        const marker = markers.find((candidate) => first.startsWith(candidate));
        if (marker === undefined) {
          throw new Error(`unexpected prompt: ${first}`);
        }
        seen.push(marker);
        const response = responses[marker];
        if (response === undefined) {
          throw new Error(`unexpected prompt: ${marker}`);
        }
        return response;
      },
    },
  };
}

const mirrorResponse = (): TextModelResponse => ({
  text: JSON.stringify({
    predictions: [
      {
        segmentName: 'Career switchers',
        interest: 'High',
        reason: 'They are interviewing this month, so the shortcut lands immediately.',
        tip: 'Name the time saved in the first line.',
      },
      {
        segmentName: 'Students',
        interest: 'Low',
        reason: 'The POV framing hides which algorithm is being explained.',
        tip: 'Say the name of the algorithm once, before the reveal.',
      },
    ],
    overallInsight: 'Switchers want the shortcut; students want the name.',
    improvedCta: 'Follow for the next data structure in plain English.',
  }),
  promptTokens: 300,
  completionTokens: 180,
  model: 'test-model',
});

const improveResponse = (): TextModelResponse => ({
  text: JSON.stringify({
    hook: 'POV: 3 days to 20 minutes on binary search',
    cta: 'Follow for the next data structure in plain English.',
    changedWhat: 'Named the time saved in the hook, per the switchers tip.',
  }),
  promptTokens: 280,
  completionTokens: 90,
  model: 'test-model',
});

interface BuildResult {
  app: ReturnType<typeof createApp>;
  repository: ProjectRepository;
  seen: string[];
}

function buildApp(options: {
  dna?: CreatorDna | null;
  responses: Record<string, TextModelResponse>;
  renderJobs?: RenderJobService;
}): BuildResult {
  const dnaRepository = memoryDnaRepository();
  if (options.dna !== null) {
    void dnaRepository.save('creator-a', options.dna ?? dnaFor());
  }

  const { client, seen } = recordingClient(options.responses);
  const ai = createTextModelService({
    client,
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

  const repository = createMemoryProjectRepository();

  const audienceService: AudienceService = createAudienceService({
    repository,
    dna: dnaService,
    ai,
    logger,
  });

  const app = createApp({
    config: testConfig({ DEV_AUTH_BYPASS: 'true' }),
    logger,
    redis: null,
    queues: null,
    dnaRepository,
    ai,
    dnaService,
    audienceService,
    renderJobService:
      options.renderJobs ??
      createRenderJobService({
        queues: null,
        logger,
        repository: createMemoryRenderJobRepository(),
      }),
  });

  return { app, repository, seen };
}

const body = {
  content: 'POV: you finally understand binary search after 3 days',
  hook: 'POV: you finally understand binary search',
  cta: 'Follow for more.',
};

/** The markers the recording client routes on. */
const MIRROR_KEY = 'CONTENT UNDER TEST';
const IMPROVE_KEY = 'REWRITE TARGET';

describe('POST /api/v1/audience-mirror', () => {
  it('returns one prediction per DNA segment, in order', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });
    const response = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);

    const { mirror, project } = response.body.data;
    expect(mirror.predictions).toHaveLength(2);
    expect(mirror.predictions.map((p: { segmentName: string }) => p.segmentName)).toEqual([
      'Career switchers',
      'Students',
    ]);
    expect(mirror.predictions[0].interest).toBe('High');
    expect(mirror.predictions[1].interest).toBe('Low');
    expect(mirror.disclaimer).toBe('AI analysis, not a guaranteed prediction.');
    expect(project.id).toMatch(/^proj_/);
    expect(project.status).toBe('awaiting-approval');
  });

  it('creates a project on the first mirror and reuses it afterwards', async () => {
    const { app, repository } = buildApp({
      responses: { [MIRROR_KEY]: mirrorResponse() },
    });

    const first = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);

    const projectId = first.body.data.project.id as string;
    expect(await repository.get(projectId, 'creator-a')).not.toBeNull();

    const second = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send({ ...body, projectId })
      .expect(200);

    // Same project, a second version - the loop is tracked, not overwritten.
    expect(second.body.data.project.id).toBe(projectId);
    expect(second.body.data.project.versions).toHaveLength(2);
  });

  it('rejects a request with no hook or no cta', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });

    await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send({ content: 'x', cta: 'y' })
      .expect(422);

    await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send({ content: 'x', hook: 'y' })
      .expect(422);
  });

  it('asks the creator to finish onboarding when there is no DNA', async () => {
    const { app } = buildApp({
      dna: null,
      responses: { [MIRROR_KEY]: mirrorResponse() },
    });

    const response = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(404);

    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.message).toContain('onboarding');
  });

  it('requires a signed-in creator', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });
    await request(app).post('/api/v1/audience-mirror').send(body).expect(401);
  });
});

describe('POST /api/v1/improve', () => {
  it('rewrites the requested target and re-runs the mirror', async () => {
    const { app, seen } = buildApp({
      responses: {
        [MIRROR_KEY]: mirrorResponse(),
        [IMPROVE_KEY]: improveResponse(),
      },
    });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);

    const projectId = mirrored.body.data.project.id as string;
    const response = await request(app)
      .post('/api/v1/improve')
      .set(devHeaders)
      .send({
        projectId,
        target: 'hook',
        feedback: ['Name the time saved in the first line.'],
      })
      .expect(200);

    const { improved, project, mirror } = response.body.data;
    // Only the hook moved; the CTA is the one the creator already had.
    expect(improved.hook).toBe('POV: 3 days to 20 minutes on binary search');
    expect(improved.cta).toBe('Follow for more.');
    expect(mirror).toBeDefined();
    expect(mirror.predictions[0].interest).toBe('High');

    // The original mirror, the improve, then the re-checked mirror: three
    // versions, so the creator can see what changed at each step.
    expect(project.versions).toHaveLength(3);
    expect(project.versions.map((version: { kind: string }) => version.kind)).toEqual([
      'mirror',
      'improve',
      'mirror',
    ]);
    // The feedback that drove the improve is carried on the improve version.
    expect(project.versions[1]?.feedback).toEqual(['Name the time saved in the first line.']);

    // Both prompts were called, and the mirror twice.
    // Both prompts were called, and the mirror twice.
    expect(seen[0]).toBe(MIRROR_KEY);
    expect(seen[1]).toBe(IMPROVE_KEY);
    expect(seen[2]).toBe(MIRROR_KEY);
  });

  it('leaves the hook untouched when the target is the CTA', async () => {
    const { app } = buildApp({
      responses: {
        [MIRROR_KEY]: mirrorResponse(),
        [IMPROVE_KEY]: improveResponse(),
      },
    });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    const response = await request(app)
      .post('/api/v1/improve')
      .set(devHeaders)
      .send({ projectId, target: 'cta', feedback: [] })
      .expect(200);

    const { improved } = response.body.data;
    expect(improved.hook).toBe(body.hook);
    expect(improved.cta).toBe('Follow for the next data structure in plain English.');
  });

  it('can skip the re-check when the creator asks for recheck: false', async () => {
    const { app, seen } = buildApp({
      responses: {
        [MIRROR_KEY]: mirrorResponse(),
        [IMPROVE_KEY]: improveResponse(),
      },
    });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    const response = await request(app)
      .post('/api/v1/improve')
      .set(devHeaders)
      .send({ projectId, target: 'cta', feedback: [], recheck: false })
      .expect(200);

    expect(response.body.data.mirror).toBeUndefined();
    expect(response.body.data.project.versions).toHaveLength(2);
    expect(seen[0]).toBe(MIRROR_KEY);
    expect(seen[1]).toBe(IMPROVE_KEY);
    expect(seen).toHaveLength(2);
  });

  it('refuses a project that has not been mirrored yet', async () => {
    const { app } = buildApp({
      responses: {
        [MIRROR_KEY]: mirrorResponse(),
        [IMPROVE_KEY]: improveResponse(),
      },
    });

    const response = await request(app)
      .post('/api/v1/improve')
      .set(devHeaders)
      .send({ projectId: 'proj_does_not_exist', target: 'hook', feedback: [] })
      .expect(404);

    expect(response.body.error.code).toBe('not_found');
  });

  it('does not leak another creator\'s project', async () => {
    const { app } = buildApp({
      responses: {
        [MIRROR_KEY]: mirrorResponse(),
        [IMPROVE_KEY]: improveResponse(),
      },
    });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    await request(app)
      .post('/api/v1/improve')
      .set({ 'x-dev-uid': 'creator-b' })
      .send({ projectId, target: 'hook', feedback: [] })
      .expect(404);
  });
});

describe('GET /api/v1/projects/:projectId', () => {
  it('resumes a loop after a reload', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    const response = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set(devHeaders)
      .expect(200);

    expect(response.body.data.versions).toHaveLength(1);
    expect(response.body.data.versions[0].mirror.predictions).toHaveLength(2);
  });

  it('404s for a project belonging to somebody else', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set({ 'x-dev-uid': 'creator-b' })
      .expect(404);
  });
});

/**
 * The approval gate.
 *
 * These use a real BullMQ queue backed by an in-process Redis when one is
 * available, and are skipped otherwise - approving must be proven to enqueue a
 * real job, not merely to call a function that looks like one.
 */
describe('POST /api/v1/projects/:projectId/approve', () => {
  it('rejects a body that is not a valid render payload', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });

    await request(app)
      .post('/api/v1/projects/proj_x/approve')
      .set(devHeaders)
      .send({ projectId: 'proj_x' })
      .expect(422);
  });

  it('tells the creator the queue is unavailable when Redis is off', async () => {
    const { app } = buildApp({ responses: { [MIRROR_KEY]: mirrorResponse() } });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/approve`)
      .set(devHeaders)
      .send({
        projectId,
        hook: 'POV: you finally understand binary search',
        cta: 'Follow for the next data structure in plain English.',
        script: [{ scene: 'Hook', text: 'POV: three days of staring at this.' }],
      })
      .expect(503);

    expect(response.body.error.message).toContain('queue');
  });

  it('marks the project rendering and records the job id', async () => {
    const enqueued: { jobId: string; queue: string; state: string }[] = [];
    const renderJobs: RenderJobService = {
      async create(payload, uid) {
        expect(payload.projectId).toMatch(/^proj_/);
        expect(uid).toBe('creator-a');
        const job: RenderJobAccepted = {
          jobId: 'job_1',
          queue: 'render',
          state: 'waiting',
          stage: 'queued',
          progress: 0,
          resumedFromAssets: false,
        };
        enqueued.push(job);
        return job;
      },
      async getStatus() {
        throw new Error('not used in this test');
      },
      async retry() {
        throw new Error('not used in this test');
      },
      async reportProgress() {},
      async read() {
        return null;
      },
    };

    const { app, repository } = buildApp({
      responses: { [MIRROR_KEY]: mirrorResponse() },
      renderJobs,
    });

    const mirrored = await request(app)
      .post('/api/v1/audience-mirror')
      .set(devHeaders)
      .send(body)
      .expect(200);
    const projectId = mirrored.body.data.project.id as string;

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/approve`)
      .set(devHeaders)
      .send({
        projectId,
        hook: 'POV: you finally understand binary search',
        cta: 'Follow for the next data structure in plain English.',
        script: [{ scene: 'Hook', text: 'POV: three days of staring at this.' }],
      })
      .expect(200);

    expect(response.body.data.job.jobId).toBe('job_1');
    expect(response.body.data.project.status).toBe('rendering');
    expect(response.body.data.project.renderJobId).toBe('job_1');

    const stored = await repository.get(projectId, 'creator-a');
    expect(stored?.status).toBe('rendering');
    expect(stored?.renderJobId).toBe('job_1');
    expect(enqueued).toHaveLength(1);
  });
});
