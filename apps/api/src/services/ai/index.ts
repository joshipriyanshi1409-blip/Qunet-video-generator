export { createGeminiRestClient, buildBody, parseResponse } from './geminiRestClient.js';
export type { GeminiRestClientOptions } from './geminiRestClient.js';
export { createTextModelService, parseJson } from './wrapper.js';
export { createStubTextModelClient } from './stubClient.js';
export type { StubTextModelClientOptions } from './stubClient.js';
export type { AiWrapperOptions, TextModelService } from './wrapper.js';
export {
  AiClientError,
  AiValidationError,
  formatZodIssues,
  type AiCallOptions,
  type AiCallResult,
  type AiUsage,
  type TextModelClient,
  type TextModelRequest,
  type TextModelResponse,
  type ZodLike,
} from './types.js';
