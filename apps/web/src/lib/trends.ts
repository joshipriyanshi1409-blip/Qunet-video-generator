import {
  hookResponseSchema,
  trendListResponseSchema,
  trendRemixRequestSchema,
  trendRemixSchema,
  type Hook,
  type HookStyle,
  type TrendListResponse,
  type TrendRemix,
  type TrendRemixRequest,
} from '@creatordna/shared';
import { request } from './api';

/**
 * Trend Remix + Hook Lab endpoints.
 *
 * Every response is validated with the shared zod schema so a backend change
 * that breaks the contract fails loudly in the browser instead of rendering
 * `undefined` into a script the creator is about to record.
 */

/** `GET /trends/for-me` - the catalogue ranked against this creator's DNA. */
export function fetchTrendsForMe(): Promise<TrendListResponse> {
  return request('/api/v1/trends/for-me', trendListResponseSchema);
}

/**
 * `POST /trends/remix` - one trend (or a free-text idea) rewritten to fit the
 * creator's DNA, with the audit trail of what survived the rewrite.
 */
export function remixTrend(input: TrendRemixRequest): Promise<TrendRemix> {
  return request('/api/v1/trends/remix', trendRemixSchema, {
    method: 'POST',
    body: trendRemixRequestSchema.parse(input),
  });
}

/** `POST /trends/hooks` - a spread of hooks in distinct styles. */
export function fetchHooks(input: {
  idea: string;
  trendId?: string;
  count?: number;
  /** Regenerate exactly one style instead of the whole set. */
  regenerateStyle?: HookStyle;
}): Promise<Hook[]> {
  return request('/api/v1/trends/hooks', hookResponseSchema, {
    method: 'POST',
    body: input,
  }).then((data) => data.hooks);
}
