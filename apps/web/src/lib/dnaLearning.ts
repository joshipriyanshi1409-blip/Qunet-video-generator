import { z } from 'zod';
import {
  dnaSignalAppendSchema,
  dnaSignalSchema,
  dnaSignalsResponseSchema,
  dnaSuggestionSchema,
  dnaSuggestionsResponseSchema,
  dnaVersionsResponseSchema,
  dnaProfileResponseSchema,
  type DnaProfileResponse,
  type DnaSignal,
  type DnaSignalAppend,
  type DnaSignalKind,
  type DnaSuggestion,
  type DnaSuggestionStatus,
  type DnaSignalsResponse,
  type DnaVersionsResponse,
} from '@creatordna/shared';
import { request } from './api';

/**
 * The learning loop's endpoints.
 *
 * Same contract discipline as every other client here: the response is parsed
 * with the shared schema before it reaches a component, so a backend change
 * that breaks the shape fails loudly instead of rendering `undefined` into a
 * card the creator is about to accept.
 */

/** `POST /dna/signals` answers with the stored signal. */
export function recordSignal(input: DnaSignalAppend): Promise<DnaSignal> {
  return request('/api/v1/dna/signals', dnaSignalSchema, {
    method: 'POST',
    body: dnaSignalAppendSchema.parse(input),
  });
}

/** `GET /dna/signals` - the recent evidence, newest first. */
export function fetchSignals(limit?: number): Promise<DnaSignalsResponse> {
  const query = limit === undefined ? '' : `?limit=${limit}`;
  return request(`/api/v1/dna/signals${query}`, dnaSignalsResponseSchema);
}

/**
 * `POST /dna/suggestions/generate` - ask the model to reason over unseen signals.
 *
 * Answers `skipped: true` without a model call when there is nothing new, which
 * is the normal case. The UI treats that as "all caught up", not as an error.
 */
const generateResultSchema = z.object({
  suggestions: z.array(dnaSuggestionSchema),
  skipped: z.boolean(),
  reason: z.enum(['no-profile', 'no-new-signals']).nullable(),
});

export function generateSuggestions(): Promise<z.infer<typeof generateResultSchema>> {
  return request('/api/v1/dna/suggestions/generate', generateResultSchema, { method: 'POST' });
}

/** `GET /dna/suggestions` - proposals, optionally filtered by status. */
export function fetchSuggestions(status?: DnaSuggestionStatus): Promise<DnaSuggestion[]> {
  const query = status === undefined ? '' : `?status=${status}`;
  return request(`/api/v1/dna/suggestions${query}`, dnaSuggestionsResponseSchema).then(
    (response) => response.suggestions,
  );
}

/**
 * `POST /dna/suggestions/:id/accept` - the only call that writes to the DNA.
 *
 * Returns the whole refreshed profile so the ring and the injected context
 * update without a second round trip.
 */
export function acceptSuggestion(id: string): Promise<DnaProfileResponse> {
  return request(
    `/api/v1/dna/suggestions/${encodeURIComponent(id)}/accept`,
    dnaProfileResponseSchema,
    { method: 'POST' },
  );
}

/** `POST /dna/suggestions/:id/reject` - dismisses a proposal, changes nothing. */
export function rejectSuggestion(id: string): Promise<DnaSuggestion> {
  return request(`/api/v1/dna/suggestions/${encodeURIComponent(id)}/reject`, dnaSuggestionSchema, {
    method: 'POST',
  });
}

/** `GET /dna/versions` - the version history plus the live version number. */
export function fetchVersions(limit?: number): Promise<DnaVersionsResponse> {
  const query = limit === undefined ? '' : `?limit=${limit}`;
  return request(`/api/v1/dna/versions${query}`, dnaVersionsResponseSchema);
}

/**
 * Fire-and-forget signal recording.
 *
 * Deliberately swallows every failure: a signal is evidence, and losing one -
 * to a network error, a 500, or a label that does not validate - must never
 * interrupt the thing the creator was actually doing. The caller gets a promise
 * it may safely ignore.
 */
export function trackSignal(input: {
  kind: DnaSignalKind;
  label: string;
  source: string;
}): Promise<void> {
  // Validated here rather than thrown: `safeParse` keeps a malformed label from
  // reaching the network *and* from rejecting the caller's promise.
  const parsed = dnaSignalAppendSchema.safeParse(input);
  if (parsed.success === false) return Promise.resolve();

  return recordSignal(parsed.data)
    .then(() => undefined)
    .catch(() => undefined);
}
