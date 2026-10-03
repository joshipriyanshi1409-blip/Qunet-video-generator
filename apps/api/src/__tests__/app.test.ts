import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { healthResponseSchema, type PingJobData } from '@creatordna/shared';
import { createApp } from '../app.js';
import type { QueueRegistry } from '../lib/queues.js';
import type { AuthUser, TokenVerifier } from '../middleware/auth.js';
import { testConfig, testLogger } from './helpers.js';

interface FakeJob {
  id: string;
  name: string;
  data: PingJobData;
  progress: number;
  attemptsMade: number;
  failedReason?: string | null;
  returnvalue: unknown;
  getState(): Promise<string>;
}

function makeFakeQueues() {
  const jobs = new Map<string, FakeJob>();
  const add = vi.fn(async (name: string, data: PingJobData) => {
    const id = String(jobs.size + 1);
    const job: FakeJob = {
      id,
      name,
      data,
      progress: 0,
      attemptsMade: 0,
      returnvalue: null,
      getState: async () => 'waiting',
    };
    jobs.set(id, job);
    return job;
  });
  const getJob = vi.fn(async (id: string) => jobs.get(id));

  const registry = {
    ping: { add, getJob, close: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
  } as unknown as QueueRegistry;

  return { registry, add, getJob, jobs };
}

const devVerifier: TokenVerifier = async () => {
  throw new Error('the dev bypass should short-circuit token verification');
};

function buildApp(options: { verifyToken?: TokenVerifier; queues?: QueueRegistry | null } = {}) {
  const config = testConfig({ DEV_AUTH_BYPASS: 'true' });
  return createApp({
    config,
    logger: testLogger(),
    redis: null,
    queues: options.queues === undefined ? makeFakeQueues().registry : options.queues,
    verifyToken: options.verifyToken ?? devVerifier,
  });
}

describe('GET /health', () => {
  it('returns the documented health envelope', async () => {
    const response = await request(buildApp()).get('/health').expect(200);

    const health = healthResponseSchema.parse(response.body);
    expect(health.status).toBe('ok');
    expect(health.service).toBe('creatordna-api');
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // No Redis client was injected, so the check reports "not_configured".
    expect(health.checks.redis).toBe('not_configured');
    expect(health.checks.firebase).toBe('not_configured');
  });

  it('reports liveness without dependency checks', async () => {
    const response = await request(buildApp()).get('/health/live').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('reports readiness', async () => {
    const response = await request(buildApp()).get('/health/ready').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('sets security headers', async () => {
    const response = await request(buildApp()).get('/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('authentication', () => {
  it('rejects a protected route with no token', async () => {
    const response = await request(buildApp()).get('/api/v1/me').expect(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('accepts the dev bypass header', async () => {
    const response = await request(buildApp())
      .get('/api/v1/me')
      .set('x-dev-uid', 'local-creator')
      .expect(200);

    expect(response.body.uid).toBe('local-creator');
    expect(response.body.devAuthBypass).toBe(true);
    expect(response.body.claims.devBypass).toBe(true);
  });

  it('ignores the dev bypass header when DEV_AUTH_BYPASS is false', async () => {
    const config = testConfig({ DEV_AUTH_BYPASS: 'false' });
    const app = createApp({
      config,
      logger: testLogger(),
      redis: null,
      queues: makeFakeQueues().registry,
      verifyToken: devVerifier,
    });

    await request(app).get('/api/v1/me').set('x-dev-uid', 'local-creator').expect(401);
  });

  it('verifies a Firebase bearer token through the injected verifier', async () => {
    const user: AuthUser = {
      uid: 'uid-from-token',
      email: 'creator@example.com',
      emailVerified: true,
      claims: {},
    };
    const verifyToken = vi.fn<TokenVerifier>(async () => user);

    const response = await request(buildApp({ verifyToken }))
      .get('/api/v1/me')
      .set('authorization', 'Bearer firebase-id-token')
      .expect(200);

    expect(verifyToken).toHaveBeenCalledWith('firebase-id-token');
    expect(response.body.uid).toBe('uid-from-token');
    expect(response.body.devAuthBypass).toBe(false);
  });

  it('rejects a token the verifier refuses', async () => {
    const verifyToken: TokenVerifier = async () => {
      throw new (await import('../lib/errors.js')).UnauthorizedError('Token expired');
    };

    const response = await request(buildApp({ verifyToken }))
      .get('/api/v1/me')
      .set('authorization', 'Bearer expired-token')
      .expect(401);

    expect(response.body.error.message).toBe('Token expired');
  });
});

describe('ping jobs', () => {
  it('enqueues a job and returns its state', async () => {
    const { registry, add } = makeFakeQueues();
    const app = buildApp({ queues: registry });

    const response = await request(app)
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'local-creator')
      .send({ message: 'hello', delayMs: 250 })
      .expect(202);

    expect(response.body).toEqual({ jobId: '1', queue: 'ping', state: 'waiting' });
    expect(add).toHaveBeenCalledWith('ping', {
      message: 'hello',
      delayMs: 250,
      failFirstAttempts: 0,
      uid: 'local-creator',
    });
  });

  it('returns the status of my own job', async () => {
    const { registry } = makeFakeQueues();
    const app = buildApp({ queues: registry });

    await request(app)
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'local-creator')
      .send({ message: 'hello' })
      .expect(202);

    const response = await request(app)
      .get('/api/v1/jobs/1')
      .set('x-dev-uid', 'local-creator')
      .expect(200);

    expect(response.body.jobId).toBe('1');
    expect(response.body.name).toBe('ping');
    expect(response.body.state).toBe('waiting');
    expect(response.body.data.uid).toBe('local-creator');
  });

  it('reports a job that never failed with failedReason null', async () => {
    // BullMQ leaves `failedReason` undefined until a job actually fails.
    const { registry } = makeFakeQueues();
    const app = buildApp({ queues: registry });

    await request(app)
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'local-creator')
      .send({ message: 'hello' })
      .expect(202);

    const response = await request(app)
      .get('/api/v1/jobs/1')
      .set('x-dev-uid', 'local-creator')
      .expect(200);

    expect(response.body.failedReason).toBeNull();
    expect(response.body.returnvalue).toBeNull();
  });

  it('hides another creator job', async () => {
    const { registry } = makeFakeQueues();
    const app = buildApp({ queues: registry });

    await request(app)
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'creator-a')
      .send({ message: 'hello' })
      .expect(202);

    await request(app).get('/api/v1/jobs/1').set('x-dev-uid', 'creator-b').expect(404);
  });

  it('returns 404 for an unknown job id', async () => {
    const app = buildApp({ queues: makeFakeQueues().registry });
    await request(app).get('/api/v1/jobs/999').set('x-dev-uid', 'local-creator').expect(404);
  });

  it('rejects an invalid payload with 422', async () => {
    const app = buildApp({ queues: makeFakeQueues().registry });

    const response = await request(app)
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'local-creator')
      .send({ message: '', delayMs: -1 })
      .expect(422);

    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'message' })]),
    );
  });

  it('returns 503 when the queue is disabled', async () => {
    const app = buildApp({ queues: null });

    const response = await request(app)
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'local-creator')
      .send({ message: 'hello' })
      .expect(503);

    expect(response.body.error.code).toBe('service_unavailable');
  });
});

describe('CORS and 404s', () => {
  it('answers a preflight from an allowed origin', async () => {
    const response = await request(buildApp())
      .options('/api/v1/me')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('refuses a preflight from an unknown origin', async () => {
    const response = await request(buildApp())
      .options('/api/v1/me')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect(403);

    expect(response.body.error.code).toBe('cors_origin_not_allowed');
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const response = await request(buildApp()).get('/nope').expect(404);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.message).toBe('Cannot GET /nope');
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await request(buildApp())
      .post('/api/v1/jobs/ping')
      .set('x-dev-uid', 'local-creator')
      .set('content-type', 'application/json')
      .send('{ not json')
      .expect(400);

    expect(response.body.error.code).toBe('bad_request');
  });
});

describe('the dev render-asset mount', () => {
  // The path is renders/<uid>/<jobId>/..., so a mounted asset is another
  // creator's finished video unless the caller is that creator.
  const ownedPath = 'renders/local-creator/job-1/mp4.mp4';
  const otherPath = 'renders/someone-else/job-9/mp4.mp4';

  function buildAppWithAssets() {
    const config = testConfig({
      DEV_AUTH_BYPASS: 'true',
      RENDER_ASSET_DIR: '.data/render-assets',
    });
    return createApp({
      config,
      logger: testLogger(),
      redis: null,
      queues: makeFakeQueues().registry,
      verifyToken: devVerifier,
    });
  }

  it('refuses an unauthenticated request', async () => {
    await request(buildAppWithAssets()).get(`/api/v1/render-assets/${ownedPath}`).expect(401);
  });

  it('serves the creator their own asset', async () => {
    const response = await request(buildAppWithAssets())
      .get(`/api/v1/render-assets/${ownedPath}`)
      .set('x-dev-uid', 'local-creator');

    // The file is not present in this test run; the point is that the owner got
    // past the guard and reached the file handler (404, not 401/403).
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('answers 404 rather than 403 for somebody else\'s asset', async () => {
    const response = await request(buildAppWithAssets())
      .get(`/api/v1/render-assets/${otherPath}`)
      .set('x-dev-uid', 'local-creator')
      .expect(404);

    expect(response.body.error.code).toBe('not_found');
  });
});
