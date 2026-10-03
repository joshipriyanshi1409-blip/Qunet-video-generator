import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, fetchHealth } from '../api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const validHealth = {
  status: 'ok',
  service: 'creatordna-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 1,
  timestamp: '2026-10-02T10:00:00.000Z',
  checks: { redis: 'ok' },
};

describe('fetchHealth', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(validHealth)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates the response against the shared schema', async () => {
    const health = await fetchHealth();
    expect(health.service).toBe('creatordna-api');
    expect(health.checks.redis).toBe('ok');
  });

  it('calls the relative /health path so the dev proxy can route it', async () => {
    await fetchHealth();
    expect(fetch).toHaveBeenCalledWith('/health', expect.objectContaining({ method: 'GET' }));
  });

  it('throws an ApiError with the API error code on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'unauthorized', message: 'Missing Bearer token' } }, 401),
      ),
    );

    await expect(fetchHealth()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthorized',
      message: 'Missing Bearer token',
    });
  });

  it('rejects a response that does not match the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'ok', service: 'api' })),
    );

    const error = await fetchHealth().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_response');
  });

  it('survives a non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway error</html>', { status: 502 })),
    );

    const error = await fetchHealth().catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).code).toBe('unknown_error');
  });
});

describe('ApiError', () => {
  it('carries status, code and details', () => {
    const error = new ApiError(422, 'validation_failed', 'Bad input', [{ path: 'email' }]);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(422);
    expect(error.details).toEqual([{ path: 'email' }]);
  });
});
