import {
  dnaExtractionResponseSchema,
  dnaProfileResponseSchema,
  type DnaExtractionResponse,
  type DnaOnboardingInput,
  type DnaProfileResponse,
  type DnaUpdateRequest,
} from '@creatordna/shared';
import { request } from './api';

/**
 * Creator DNA endpoints.
 *
 * Every response is validated with the shared zod schema, so a backend change
 * that breaks the contract fails loudly instead of rendering `undefined`.
 */

export function extractDna(input: DnaOnboardingInput): Promise<DnaExtractionResponse> {
  return request('/api/v1/dna/extract', dnaExtractionResponseSchema, {
    method: 'POST',
    body: input,
  });
}

export function fetchDna(): Promise<DnaProfileResponse> {
  return request('/api/v1/dna', dnaProfileResponseSchema);
}

export function updateDna(patch: DnaUpdateRequest): Promise<DnaProfileResponse> {
  return request('/api/v1/dna', dnaProfileResponseSchema, { method: 'PUT', body: patch });
}
