/**
 * Phase 3 live smoke test.
 *
 * Boots the *real* Express app (routes -> middleware -> controllers -> services
 * -> repository) over HTTP and drives the acceptance flow end to end:
 *
 *   1. `POST /dna/extract` with the onboarding answers  -> 200 + full profile
 *   2. `GET  /dna`                                      -> 200, same version
 *   3. `PUT  /dna`                                      -> 200, dnaVersion bumps
 *   4. `GET  /dna/context`                             -> 200, < 500 tokens
 *   5. a brand-new repository on the same directory     -> profile survived
 *
 * Only the model is faked (`StubTextModelClient` and `createStubLiveProvider`).
 * Everything else - the `x-dev-uid` auth bypass, zod validation, the AI wrapper's
 * retry/fallback logic, the sync score and the context builder, and the coaching
 * WebSocket's auth, PCM relay and summary write - is the production code path.
 *
 * Phase 6 adds the Live Voice Coach checks, including the real upgrade routing,
 * because a coaching failure must never take another feature down with it.
 * Phase 7 adds the render routes: mounted, authenticated, validated, and honest
 * about the queue being off (Redis is not running in this sandbox).
 *
 * TODO(phase-4): delete once a real model id is configured, or keep it as the
 * contract test for the /dna endpoints.
 *
 * Run with:  pnpm --filter @creatordna/api smoke
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { pino, type Logger } from 'pino';
import { createApp } from '../src/app.js';
import { createConfig } from '../src/config/index.js';
import { parseApiEnv } from '../src/config/env.js';
import { createLocalFileDnaRepository } from '../src/lib/dnaRepository.js';
import { createDnaService } from '../src/services/dna.service.js';
import { createTrendService } from '../src/services/trend.service.js';
import { createSeedTrendRepository } from '../src/lib/trendRepository.js';
import { createCache } from '../src/lib/cache.js';
import { createSessionRegistry } from '../src/voiceCoach/registry.js';
import { createVoiceCoachService } from '../src/voiceCoach/service.js';
import { createRenderJobService } from '../src/services/renderJob.service.js';
import { createMemoryRenderJobRepository } from '../src/lib/renderJobRepository.js';
import { createVoiceCoachSocketHandler } from '../src/voiceCoach/wsHandler.js';
import { createStubLiveProvider } from '../src/voiceCoach/stubLive.js';
import { createUpgradeRouter } from '../src/ws/upgradeRouter.js';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createStubTextModelClient,
  createTextModelService,
  type TextModelClient,
  type TextModelRequest,
  type TextModelResponse,
} from '../src/services/ai/index.js';

const UID = 'smoke-creator';
const PORT = 4319;
/** The coaching socket's own path, matching the API default. */
const COACH_WS_PATH = '/ws/voice-coach';
/**
 * A third server for the coaching checks, so they run against a live port no
 * matter what the persistence checks above have opened and closed.
 */
const COACH_PORT = 4321;
/** Second server uses another port so the HTTP keep-alive pool cannot reuse a
 *  socket that the first server just closed. */
const RELOAD_PORT = 4320;

/** A model that always answers with a valid, sample-consistent DNA payload. */
class StubTextModelClient implements TextModelClient {
  readonly name = 'stub';

  /**
   * The shared stub answers the three Phase 4 prompts from the prompt itself,
   * which is what makes the demo output change with the DNA. This smoke drives
   * DNA extraction by hand, so it keeps its own payload for that one prompt.
   */
  private readonly phase4 = createStubTextModelClient();

  async generate(model: string, request: TextModelRequest): Promise<TextModelResponse> {
    // Phase 4 prompts are recognised by their first line; everything else is the
    // onboarding extraction below.
    const firstLine = (request.user.split('\n', 1)[0] ?? '').trim();
    const isPhase4 =
      firstLine.startsWith('IDEA:') ||
      firstLine.startsWith('TREND FORMAT:') ||
      (firstLine.startsWith('CREATOR DNA') && request.user.includes('TRENDING FORMATS'));

    if (isPhase4) {
      return this.phase4.generate(model, request);
    }

    if (!request.user.includes('DSA interview prep')) {
      throw new Error(`stub model did not recognise the prompt: ${request.user.slice(0, 80)}`);
    }
    return {
      text: JSON.stringify({
        niche: 'DSA interview prep for career switchers',
        tone: ['direct', 'playful'],
        audience: ['professionals'],
        style: 'Short sentences, whiteboard, fast cuts',
        personality: ['blunt', 'encouraging'],
        format: 'whiteboard',
        vocabulary: ['amortized'],
        catchphrases: ['Binary search in 30 seconds'],
        dos: ['dry run the code'],
        donts: ['jargon dumps'],
        samplePosts: [{ text: 'Binary search in 30 seconds. Amortized analysis matters.' }],
      }),
      promptTokens: 480,
      completionTokens: 210,
      model: 'stub-model',
    };
  }
}

/** Silent logger: the smoke test prints its own readable summary. */
const logger: Logger = pino({ level: 'silent' });

const SAMPLE_POST = 'Binary search in 30 seconds. Amortized analysis matters.';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail.length > 0 ? ` - ${detail}` : ''}`);
}

async function call(
  path: string,
  init: RequestInit = {},
  port: number = PORT,
  /** Shorthand: a JSON body implies POST. */
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    ...(body === undefined
      ? {}
      : { method: init.method ?? 'POST', body: JSON.stringify(body) }),
    headers: {
      'content-type': 'application/json',
      'x-dev-uid': UID,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const parsed: unknown = text.length === 0 ? null : JSON.parse(text);
  return { status: response.status, body: parsed as Record<string, unknown> };
}

async function listen(app: ReturnType<typeof createApp>, port: number): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return server;
}

function close(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Keep-alive sockets from `fetch` and upgraded WebSocket connections both
    // hold a server open; `closeIdleConnections` alone leaves the rest waiting.
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

async function main(): Promise<void> {
  const storeDir = mkdtempSync(join(tmpdir(), 'creatordna-dna-'));
  const env = parseApiEnv({
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    API_PREFIX: '/api/v1',
    CORS_ORIGINS: 'http://localhost:5173',
    DEV_AUTH_BYPASS: 'true',
    DNA_STORE_DIR: storeDir,
    REDIS_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    LOG_PRETTY: 'false',
  });
  const config = createConfig(env);

  const ai = createTextModelService({
    client: new StubTextModelClient(),
    logger,
    primaryModel: 'stub-model',
    fallbackModel: 'stub-fallback',
    maxAttempts: 2,
    timeoutMs: 5_000,
  });

  const repository = createLocalFileDnaRepository(storeDir);
  const dnaService = createDnaService({ repository, ai, logger, historyLimit: 5 });
  const trendCache = createCache({ logger, prefix: 'creatordna:cache' });
  // The coach is built before the app so the app can mount its REST routes;
  // the socket handler is attached further down, next to the HTTP server it
  // shares. Same wiring order as `src/index.ts`.
  const coachRegistry = createSessionRegistry({ logger });
  const coachService = createVoiceCoachService({
    provider: createStubLiveProvider(),
    dnaRepository: repository,
    logger,
    model: 'stub-live-model',
    registry: coachRegistry,
    async saveSummary() {
      // History writes are the DNA repository's job in production; the smoke
      // only needs the summary to reach the browser.
    },
  });

  // The render routes mount only when a render service exists. Redis is off
  // here, so `create` and `retry` answer 503 - which is the behaviour the checks
  // below assert. The job document itself is the same local-file store the DNA
  // uses, so nothing extra is seeded.
  const renderJobService = createRenderJobService({
    queues: null,
    logger,
    repository: createMemoryRenderJobRepository(),
  });

  const app = createApp({
    config,
    logger,
    redis: null,
    queues: null,
    verifyToken: async () => ({ uid: UID, emailVerified: false, claims: {} }),
    dnaRepository: repository,
    ai,
    voiceCoachService: coachService,
    dnaService,
    renderJobService,
    trendService: createTrendService({
      repository: createSeedTrendRepository(),
      dna: dnaService,
      ai,
      cache: trendCache,
      logger,
      rankingTtlMs: 60_000,
      generationTtlMs: 60_000,
    }),
  });

  const coachSocket = createVoiceCoachSocketHandler({
    logger,
    verifyToken: async () => ({ uid: UID, emailVerified: false, claims: {} }),
    devAuthBypass: true,
    service: coachService,
    registry: coachRegistry,
  });

  const server = await listen(app, PORT);
  const coachServer = await listen(app, COACH_PORT);
  const coachWss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  coachWss.on('connection', (socket, request) => {
    void coachSocket.connection(socket, request);
  });
  createUpgradeRouter({ server: coachServer, routes: [{ path: COACH_WS_PATH, wss: coachWss }], logger });

  try {
    console.log('\nCreatorDNA Studio - Phase 3 + 4 + 6 + 7 live smoke\n');

    // 0 - health is public and does not need auth.
    const health = await call('/health');
    check('GET /health returns 200', health.status === 200, `status ${health.status}`);

    // 1 - onboarding -> extraction.
    const extracted = await call('/api/v1/dna/extract', {
      method: 'POST',
      body: JSON.stringify({
        niche: 'DSA interview prep',
        audienceAgeRange: '25-34',
        audienceType: 'professionals',
        tone: ['direct', 'playful'],
        format: 'whiteboard',
        samplePosts: [{ text: SAMPLE_POST }],
      }),
    });
    const data = (extracted.body.data ?? {}) as Record<string, unknown>;
    const score = (data.score ?? {}) as Record<string, unknown>;
    check('POST /dna/extract returns 200', extracted.status === 200, `status ${extracted.status}`);
    check(
      'extraction returns a validated profile',
      typeof data.dna === 'object' && data.dna !== null,
      `promptId=${String(data.promptId)} v${String(data.promptVersion)}`,
    );
    check(
      'sync score is computed',
      score.score === 100 && score.completeness === 100 && score.consistency === 100,
      `score=${String(score.score)} completeness=${String(score.completeness)} consistency=${String(score.consistency)}`,
    );
    check(
      'extraction logs token usage',
      typeof (data.usage as Record<string, unknown> | undefined)?.totalTokens === 'number',
      `totalTokens=${String((data.usage as Record<string, unknown>).totalTokens)}`,
    );

    const versionAfterExtract = (data.dna as Record<string, unknown>).dnaVersion;

    // 2 - read it back (the "reload persists it" half).
    const profile = await call('/api/v1/dna');
    const profileData = (profile.body.data ?? {}) as Record<string, unknown>;
    check('GET /dna returns 200', profile.status === 200, `status ${profile.status}`);
    check(
      'GET /dna returns the same profile',
      JSON.stringify(profileData.dna) === JSON.stringify(data.dna),
      `dnaVersion=${String((profileData.dna as Record<string, unknown>).dnaVersion)}`,
    );

    // 3 - edit bumps the version.
    const updated = await call('/api/v1/dna', {
      method: 'PUT',
      body: JSON.stringify({ tone: ['direct', 'playful', 'wry'] }),
    });
    const updatedData = (updated.body.data ?? {}) as Record<string, unknown>;
    check('PUT /dna returns 200', updated.status === 200, `status ${updated.status}`);
    check(
      'PUT /dna bumps dnaVersion',
      (updatedData.dna as Record<string, unknown>).dnaVersion !== versionAfterExtract,
      `${String(versionAfterExtract)} -> ${String((updatedData.dna as Record<string, unknown>).dnaVersion)}`,
    );

    // 4 - the injected context block.
    const context = await call('/api/v1/dna/context');
    const contextData = (context.body.data ?? {}) as Record<string, unknown>;
    const tokens = Number(contextData.tokens);
    check('GET /dna/context returns 200', context.status === 200, `status ${context.status}`);
    check('context stays under ~500 tokens', tokens > 0 && tokens < 500, `${tokens} tokens`);
    check(
      'context mentions the niche and tone',
      String(contextData.context).includes('DSA interview prep') &&
        String(contextData.context).includes('direct'),
      'niche + tone present',
    );

    // 5 - persistence: a brand-new repository over the same directory.
    const reloadedRepository = createLocalFileDnaRepository(storeDir);
    const reloadedTrendCache = createCache({ logger, prefix: 'creatordna:cache' });
    const reloadedDnaService = createDnaService({
      repository: reloadedRepository,
      ai,
      logger,
      historyLimit: 5,
    });
    const reloadedApp = createApp({
      config,
      logger,
      redis: null,
      queues: null,
      verifyToken: async () => ({ uid: UID, emailVerified: false, claims: {} }),
      dnaRepository: reloadedRepository,
      ai,
      dnaService: reloadedDnaService,
      trendService: createTrendService({
        repository: createSeedTrendRepository(),
        dna: reloadedDnaService,
        ai,
        cache: reloadedTrendCache,
        logger,
      }),
    });
    await close(server);
    const reloadedServer = await listen(reloadedApp, RELOAD_PORT);
    try {
      const persisted = await call('/api/v1/dna', {}, RELOAD_PORT);
      check(
        'profile survives a restart',
        persisted.status === 200 &&
          JSON.stringify((persisted.body.data as Record<string, unknown>).dna) ===
            JSON.stringify(updatedData.dna),
        `status ${persisted.status}`,
      );

      // 6 - auth is still enforced: a missing uid is not silently accepted.
      const noAuth = await fetch(`http://127.0.0.1:${RELOAD_PORT}/api/v1/dna`);
      check(
        'a request without x-dev-uid is rejected',
        noAuth.status === 401 || noAuth.status === 503,
        `status ${noAuth.status}`,
      );

        // --- Phase 4: trends, remix, hook lab --------------------------------
      // These run on the reloaded server: same profile, same catalogue, and the
      // ranking is computed from the DNA that was just re-saved.

      // 7 - the context builder agrees with what the endpoint returned.
      const direct = await dnaService.buildContext(UID);
      check(
        'buildDnaContext agrees with the endpoint',
        direct.tokens === tokens && direct.text === contextData.context,
        `${direct.tokens} tokens`,
      );

      // 8 - the ranking is personalised to the DNA.
      const forMe = await call('/api/v1/trends/for-me', {}, RELOAD_PORT);
      const forMeData = (forMe.body.data ?? {}) as Record<string, unknown>;
      const ranked = (forMeData.trends ?? []) as { relevance: number; trend: { id: string; category: string } }[];
      check('GET /trends/for-me returns 200', forMe.status === 200, `status ${forMe.status}`);
      check('the catalogue is ranked', ranked.length === 20, `${ranked.length} trends`);
      check(
        'an education creator sees education trends first',
        ranked[0]?.trend.category === 'education',
        `top category: ${ranked[0]?.trend.category ?? 'none'} (${ranked[0]?.trend.id ?? 'none'})`,
      );
      check(
        'relevance is monotonically non-increasing',
        ranked.every((entry, index) => index === 0 || ranked[index - 1]!.relevance >= entry.relevance),
        `${ranked[0]?.relevance ?? 0} -> ${ranked.at(-1)?.relevance ?? 0}`,
      );

      // 9 - the remix keeps the trend's structure and swaps the topic.
      const remixed = await call('/api/v1/trends/remix', {}, RELOAD_PORT, {
        trendId: ranked[0]?.trend.id ?? 'trend_pov_finally',
      });
      const remixData = (remixed.body.data ?? {}) as Record<string, unknown>;
      check('POST /trends/remix returns 200', remixed.status === 200,`status ${remixed.status}`);
      check(
        'the remix carries the format and the audit trail',
        typeof remixData.format === 'string' &&
          (remixData.format as string).length > 0 &&
          Array.isArray(remixData.whatWasKept) &&
          (remixData.whatWasKept as unknown[]).length > 0 &&
          Array.isArray(remixData.whatWasChanged) &&
          (remixData.whatWasChanged as unknown[]).length > 0,
        `format: ${String(remixData.format)}`,
      );
      check(
        'the remix script is a beat list',
        Array.isArray(remixData.script) && (remixData.script as unknown[]).length >= 3,
        `${(remixData.script as unknown[] | undefined)?.length ?? 0} beats`,
      );

      // 10 - hook lab.
      const hooked = await call('/api/v1/trends/hooks', {}, RELOAD_PORT, {
        idea: 'Explain binary search to a nervous interviewee',
      });
      const hooks = ((hooked.body.data ?? {}) as { hooks?: { style: string }[] }).hooks ?? [];
      check('POST /trends/hooks returns 200', hooked.status === 200,`status ${hooked.status}`);
      check(
        'hooks are 5-8 in distinct styles',
        hooks.length >= 5 &&
          hooks.length <= 8 &&
          new Set(hooks.map((hook) => hook.style)).size === hooks.length,
        `${hooks.length} hooks: ${[...new Set(hooks.map((hook) => hook.style))].join(', ')}`,
      );

      // 11 - the acceptance criterion: changing the DNA changes the ranking.
      // A different niche re-sorts the same catalogue, so the personalisation is
      // real rather than a fixed order.
      const rerolled = await call(
        '/api/v1/dna',
        { method: 'PUT' },
        RELOAD_PORT,
        {
          ...(updatedData.dna as Record<string, unknown>),
          niche: 'Retro game reviews',
          audience: ['hobbyists'],
          audienceType: 'hobbyists',
        },
      );
      const rerolledDna = (rerolled.body.data ?? {}) as { dna?: Record<string, unknown> };
      // Drop the cached ranking so the next call re-ranks against the new DNA.
      await reloadedTrendCache.invalidate(`trends:for-me:${UID}`);

      const reranked = await call('/api/v1/trends/for-me', {}, RELOAD_PORT);
      const rerankedData = ((reranked.body.data ?? {}) as { trends?: { trend: { category: string } }[] })
        .trends ?? [];
      check(
        'changing the DNA changes the top trend',
        rerankedData[0]?.trend.category !== ranked[0]?.trend.category,
        `${ranked[0]?.trend.category} -> ${rerankedData[0]?.trend.category} (v${String(rerolledDna.dna?.dnaVersion)})`,
      );

    } finally {
      await close(reloadedServer);
    }

    // --- Phase 6: the Live Voice Coach -------------------------------------
    await checkVoiceCoach({ call, PORT: COACH_PORT });

    // --- Phase 7: the render pipeline --------------------------------------
    // Its own listener: the main server is closed and re-opened above for the
    // restart check, so a fixed port here would be a coin toss.
    const renderServer = await listen(app, 0);
    try {
      await checkRender({
        call,
        PORT: (renderServer.address() as { port: number }).port,
      });
    } finally {
      await close(renderServer);
    }

  } finally {
    // End every live session before closing the sockets: a session left running
    // keeps the provider's timers alive and the script never exits.
    await coachSocket.shutdown().catch(() => undefined);
    // A `noServer` WebSocketServer does not terminate its clients on `close()` -
    // it only detaches from the HTTP server. Left open, they keep the HTTP
    // server's `close()` from ever completing.
    for (const client of coachWss.clients) client.terminate();
    coachWss.close();
    await close(coachServer).catch(() => undefined);
    await close(server).catch(() => undefined);
    rmSync(storeDir, { recursive: true, force: true });
  }


  const failures = checks.filter((entry) => !entry.pass);
  console.log(
    `\n${checks.length - failures.length}/${checks.length} checks passed${failures.length > 0 ? ' - FAILED' : ''}\n`,
  );

  // Exit explicitly. Every server is closed above, but the upgraded coaching
  // sockets and `ws`'s own close-handshake timers outlive `server.close()`, so a
  // script that waited for the loop to drain would hang after reporting. The
  // checks are the output; leaving the loop to them is not.
  process.exit(failures.length > 0 ? 1 : 0);
}

/**
 * Drives the coaching socket the way the browser does.
 *
 * A real handshake over a real upgrade, real PCM frames, a real `end` - because
 * the parts of the coach that can break silently are exactly the ones a unit
 * test would fake away: the upgrade routing, auth on connect, and whether the
 * summary actually comes back.
 */
/**
 * Phase 7: the render job routes.
 *
 * Redis is off in this sandbox, so a render cannot actually be queued - which is
 * exactly what these checks are for. They prove the route is mounted, that auth
 * is enforced, and that the failure is a legible 503 rather than a 500. The
 * pipeline itself is exercised by the worker's own tests.
 */
async function checkRender(options: {
  call: typeof call;
  PORT: number;
}): Promise<void> {
  const { call, PORT } = options;

  const create = await call(
    '/api/v1/render',
    {
      method: 'POST',
      headers: { 'x-dev-uid': UID },
      body: JSON.stringify({
        projectId: 'proj_smoke',
        hook: 'POV: you finally understand binary search',
        script: [{ scene: 'Hook', text: 'POV: three days of staring at this.' }],
        cta: 'Follow for the next data structure.',
        hashtags: ['#dsa'],
      }),
    },
    PORT,
  );
  check(
    'POST /render answers 503 with a legible message when the queue is off',
    create.status === 503 && String(errorCode(create.body)).length > 0,
    `status ${create.status}, code ${String(errorCode(create.body)) || 'none'}`,
  );

  // The dev bypass is on for every other check, so the caller has to opt out of
  // it explicitly to prove auth is still enforced.
  const anon = await call(
    '/api/v1/render',
    {
      method: 'POST',
      headers: { 'x-dev-uid': '' },
      body: JSON.stringify({
        projectId: 'proj_smoke',
        hook: 'x',
        script: [{ scene: 'Hook', text: 'y' }],
        cta: 'z',
      }),
    },
    PORT,
  );
  check('POST /render requires authentication', anon.status === 401, `status ${anon.status}`);

  const missing = await call('/api/v1/render/job_missing', { method: 'GET' }, PORT);
  check(
    'GET /render/:id 404s for a job that does not exist',
    missing.status === 404,
    `status ${missing.status}`,
  );

  const badRetry = await call(
    '/api/v1/render/job_missing/retry',
    { method: 'POST', body: JSON.stringify({}) },
    PORT,
  );
  check(
    'POST /render/:id/retry 404s for a job that does not exist',
    badRetry.status === 404,
    `status ${badRetry.status}`,
  );

  // A body that is not a render request must be rejected by the route's own
  // schema, before anything reaches the queue.
  const invalid = await call(
    '/api/v1/render',
    {
      method: 'POST',
      body: JSON.stringify({ projectId: 'proj_smoke', hook: 'x' }),
    },
    PORT,
  );
  check(
    'POST /render rejects a payload with no script',
    invalid.status === 422,
    `status ${invalid.status}`,
  );
}

async function checkVoiceCoach(options: {
  call: typeof call;
  PORT: number;
}): Promise<void> {
  const { call, PORT } = options;

  // 1. The quota endpoint is public to the caller and reports the budget.
  const quota = await call('/api/v1/voice-coach/quota', { method: 'GET' }, PORT);
  const quotaData = (quota.body.data ?? {}) as { dailyCap?: number; maxSessionSeconds?: number };
  check('GET /voice-coach/quota returns 200', quota.status === 200, `status ${quota.status}`);
  check(
    'the quota reports the server-side limits',
    quotaData.dailyCap === 10 && quotaData.maxSessionSeconds === 300,
    `cap ${String(quotaData.dailyCap)}, session ${String(quotaData.maxSessionSeconds)}s`,
  );

  // 2. A socket with no token is refused on connect, before any model call.
  const unauthenticated = handshake(PORT, COACH_WS_PATH, '');
  const refusedCode = await unauthenticated.waitClose();
  unauthenticated.close();
  check(
    'the coaching socket refuses a connection with no token',
    refusedCode === 4401,
    `close code ${String(refusedCode)}`,
  );

  // 3. A full session: start, stream PCM, end, and read the summary back.
  const script = ['POV: you finally understand binary search', 'The trick is the halving picture'];
  const session = handshake(PORT, COACH_WS_PATH, `dev_uid=${UID}`);
  await session.waitOpen();
  session.send(JSON.stringify({ type: 'start', script }));

  const sawReady = await session.next((message) => message['type'] === 'ready');
  check('the coaching socket answers the start with ready', sawReady !== null, 'no ready message');

  if (sawReady !== null) {
    // Three chunks of 16 kHz 16-bit mono PCM, the format the browser sends.
    for (let index = 0; index < 3; index += 1) {
      session.send(
        JSON.stringify({
          type: 'audio',
          data: Buffer.alloc(3200, index + 1).toString('base64'),
        }),
      );
    }
    session.send(JSON.stringify({ type: 'line', index: 1 }));
    session.send(JSON.stringify({ type: 'end' }));

    const ended = await session.next((message) => message['type'] === 'ended');
    check('ending the session returns a summary', ended !== null, 'no ended message');
    check(
      'the summary is shaped like a summary',
      ended !== null && Array.isArray((ended['summary'] as { tips?: unknown })?.tips),
      JSON.stringify(ended?.['summary'] ?? null).slice(0, 120),
    );
  }

  // 4. The fallback path works without a socket at all.
  const take = Buffer.alloc(16_000 * 2 * 2, 5); // two seconds of PCM
  const feedback = await call(
    '/api/v1/voice-coach/feedback',
    {
      method: 'POST',
      body: JSON.stringify({
        script,
        audio: take.toString('base64'),
        durationSeconds: 2,
      }),
    },
    PORT,
  );
  const feedbackData = (feedback.body.data ?? {}) as { fallback?: boolean; summary?: { tips?: unknown[] } };
  check('POST /voice-coach/feedback returns 200', feedback.status === 200, `status ${feedback.status}`);
  check(
    'the fallback marks itself as a fallback',
    feedbackData.fallback === true,
    `fallback=${String(feedbackData.fallback)}`,
  );
  check(
    'the fallback returns a summary with tips',
    Array.isArray(feedbackData.summary?.tips) && feedbackData.summary.tips.length > 0,
    `${String(feedbackData.summary?.tips?.length ?? 0)} tips`,
  );

  // 5. One session was counted against the daily cap.
  const after = await call('/api/v1/voice-coach/quota', { method: 'GET' }, PORT);
  const afterData = (after.body.data ?? {}) as { usedToday?: number };
  check('a coaching session counts against the daily cap', afterData.usedToday === 1, `used ${String(afterData.usedToday)}`);

  session.close();
}

/**
 * One coaching socket, with helpers that wait rather than assume.
 *
 * The browser's connection is asynchronous in three places that matter here -
 * the handshake, each message, and the close - and a helper that reads state
 * instead of waiting for it reports "no ready message" for a session that is
 * simply not open yet.
 */
/** The client-side view of one coaching WebSocket, as `handshake` builds it. */
interface CoachSocket {
  readonly opened: boolean;
  send(payload: string): void;
  waitOpen(timeoutMs?: number): Promise<void>;
  next(
    matches: (message: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ): Promise<Record<string, unknown> | null>;
  waitClose(timeoutMs?: number): Promise<number | null>;
  close(): void;
}

/** The API's error envelope, as the smoke test reads it. */
function errorCode(body: Record<string, unknown>): unknown {
  const error = body.error as { code?: unknown } | undefined;
  return error?.code;
}

function handshake(port: number, path: string, query: string): CoachSocket {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}${query.length > 0 ? `?${query}` : ''}`);
  const queue: Record<string, unknown>[] = [];
  const wakeups: (() => void)[] = [];
  let opened = false;
  let failure: string | null = null;
  let code: number | null = null;

  socket.on('message', (raw) => {
    queue.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    wakeups.shift()?.();
  });
  socket.on('open', () => {
    opened = true;
    wakeups.shift()?.();
  });
  socket.on('close', (closeCode) => {
    code = closeCode;
    if (opened === false) failure = `closed before opening with ${closeCode}`;
    wakeups.shift()?.();
  });
  socket.on('error', (error: Error) => {
    if (opened === false) failure = error.message;
    wakeups.shift()?.();
  });

  function wake(): void {
    wakeups.shift()?.();
  }

  return {
    get opened(): boolean {
      return opened;
    },

    send(payload: string): void {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    },

    async waitOpen(timeoutMs = 10_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (opened === false) {
        if (failure !== null) throw new Error(failure);
        if (Date.now() > deadline) throw new Error('the coaching socket never opened');
        await new Promise<void>((resolve) => {
          wakeups.push(resolve);
          setTimeout(wake, 100);
        });
      }
    },

    async next(
      matches: (message: Record<string, unknown>) => boolean,
      timeoutMs = 10_000,
    ): Promise<Record<string, unknown> | null> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = queue.findIndex(matches);
        if (found >= 0) return queue.splice(found, 1)[0] ?? null;
        if (Date.now() > deadline) return null;
        await new Promise<void>((resolve) => {
          wakeups.push(resolve);
          setTimeout(wake, 100);
        });
      }
    },

    async waitClose(timeoutMs = 10_000): Promise<number | null> {
      const deadline = Date.now() + timeoutMs;
      while (code === null) {
        if (Date.now() > deadline) return null;
        await new Promise<void>((resolve) => {
          wakeups.push(resolve);
          setTimeout(wake, 100);
        });
      }
      return code;
    },

    close(): void {
      // Terminated, not closed: a half-closed client socket keeps the upgraded
      // server connection alive, and `server.close()` then never completes.
      socket.terminate();
    },
  };
}

await main();
