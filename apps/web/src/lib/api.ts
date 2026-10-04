import type { z, ZodType } from 'zod';
import { healthResponseSchema, type HealthResponse } from '@creatordna/shared';
import { getIdToken } from './firebase';
import { useAuthStore } from '../store/useAuthStore';
import { handleDemoFallback } from './demoBackend';

/**
 * API base URL.
 *
 * Empty by default so the browser talks to the same origin it loaded from and
 * the Vite dev server proxies `/api`, `/health` and `/ws` to the API. Set
 * `VITE_API_URL` only when the API lives on another origin.
 */
const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

/** Error thrown for a non-2xx response, carrying the API's error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Skip the automatic auth headers. Only for public endpoints such as
   * `/health`, which the Home screen polls before anyone signs in.
   */
  anonymous?: boolean;
}

/**
 * Auth headers for the current session: a Firebase ID token when one exists,
 * otherwise the dev bypass header when the user signed in as a local creator.
 */
export async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  try {
    const token = await getIdToken();
    if (token !== null) {
      headers.authorization = `Bearer ${token}`;
      return headers;
    }
  } catch {
    // A stale/expired token must not break the request; fall through to dev.
  }

  const user = useAuthStore.getState().user;
  if (user?.devBypass === true) {
    headers['x-dev-uid'] = user.uid;
  }

  return headers;
}

/**
 * Every response is validated with the shared zod schema, so a backend change
 * that breaks the contract fails loudly in the browser instead of silently
 * rendering `undefined`.
 */
export async function request<TSchema extends ZodType>(
  path: string,
  schema: TSchema,
  options: RequestOptions = {},
): Promise<z.infer<TSchema>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.anonymous !== true) Object.assign(headers, await buildAuthHeaders());

  const isTestMode = import.meta.env.MODE === 'test';
  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (networkError) {
    if (!isTestMode) {
      const fallback = handleDemoFallback(path, method, options.body);
      if (fallback !== null) {
        const parsedFallback = schema.safeParse(fallback);
        if (parsedFallback.success) return parsedFallback.data as z.infer<TSchema>;
      }
    }
    throw networkError;
  }

  const text = await response.text();
  const payload: unknown = text.length === 0 ? null : safeJsonParse(text);

  if (!response.ok) {
    if (!isTestMode) {
      const fallback = handleDemoFallback(path, method, options.body);
      if (fallback !== null) {
        const parsedFallback = schema.safeParse(fallback);
        if (parsedFallback.success) return parsedFallback.data as z.infer<TSchema>;
      }
    }
    const error = extractError(payload);
    throw new ApiError(response.status, error.code, error.message, error.details);
  }

  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data as z.infer<TSchema>;
  }

  // The API's standard success envelope is `{ data, meta? }`, but a few routes
  // (health, job status) return the payload bare. Rather than making every
  // caller know which style a route uses, accept either: validate the body
  // directly first, then retry against `body.data`.
  const inner = envelopeData(payload);
  if (inner !== undefined) {
    const retried = schema.safeParse(inner);
    if (retried.success) {
      return retried.data as z.infer<TSchema>;
    }
  }

  if (!isTestMode) {
    const fallback = handleDemoFallback(path, method, options.body);
    if (fallback !== null) {
      const parsedFallback = schema.safeParse(fallback);
      if (parsedFallback.success) return parsedFallback.data as z.infer<TSchema>;
    }
  }

  throw new ApiError(
    response.status,
    'invalid_response',
    `The API returned an unexpected shape for ${path}.`,
    parsed.error.issues,
  );
}

/** `payload.data` when the body is the standard envelope, else `undefined`. */
function envelopeData(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  return (payload as { data?: unknown }).data;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractError(payload: unknown): { code: string; message: string; details?: unknown } {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const record = error as Record<string, unknown>;
      return {
        code: typeof record.code === 'string' ? record.code : 'unknown_error',
        message: typeof record.message === 'string' ? record.message : 'Request failed',
        details: record.details,
      };
    }
  }
  return { code: 'unknown_error', message: 'Request failed' };
}

/** `GET /health` - the API's own status, shown on the Home screen. */
export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  // Public endpoint: never send auth headers for it.
  return request('/health', healthResponseSchema, { signal, anonymous: true });
}
