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
export {
  createModelRouter,
  AI_CAPABILITIES,
  type AiCapability,
  type ProviderStatus,
  type ProviderInfo,
  type ModelSelectionCriteria,
  type ProviderAdapter,
  type TextProvider,
  type ImageProvider,
  type VideoProvider,
  type TtsProvider,
  type MusicProvider,
  type TextGenerationRequest,
  type TextGenerationResponse,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
  type VideoGenerationRequest,
  type VideoGenerationResponse,
  type TtsRequest,
  type TtsResponse,
  type MusicGenerationRequest,
  type MusicGenerationResponse,
  type ModelRouter,
  type ModelRouterDeps,
} from './modelRouter.js';
