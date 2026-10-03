import { AiClientError, type TextModelClient, type TextModelRequest, type TextModelResponse } from './types.js';

/**
 * Gemini adapter over the public Generative Language REST API.
 *
 * IMPORTANT - verify before relying on it: this request/response shape follows
 * the documented `models.generateContent` endpoint, but Google changes field
 * names and adds new model families regularly. Before going live, check the
 * current official docs for your model id and adjust `buildBody` /
 * `parseResponse` in one place. Everything else in the app talks to the
 * `TextModelClient` port, so this is the only file that would change.
 *
 * Auth is the `x-goog-api-key` header (API key from `GEMINI_API_KEY`).
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiRestClientOptions {
  apiKey: string;
  /** Overridable for tests and for a Vertex/AI Studio proxy. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  promptFeedback?: { blockReason?: string };
}

/** Builds the request body. The one place the REST shape is spelled out. */
export function buildBody(request: TextModelRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
  };

  if (request.system.length > 0) {
    body['systemInstruction'] = { parts: [{ text: request.system }] };
  }

  const generationConfig: Record<string, unknown> = {};
  if (request.json) generationConfig['responseMimeType'] = 'application/json';
  if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
  if (request.maxOutputTokens !== undefined) {
    generationConfig['maxOutputTokens'] = request.maxOutputTokens;
  }
  if (Object.keys(generationConfig).length > 0) body['generationConfig'] = generationConfig;

  return body;
}

/** Pulls the text out of the first candidate. Throws when there is none. */
export function parseResponse(payload: unknown, model: string): TextModelResponse {
  const body = payload as GeminiGenerateContentResponse | null;

  if (body?.promptFeedback?.blockReason !== undefined) {
    throw new AiClientError(
      `model blocked the prompt (${body.promptFeedback.blockReason})`,
      false,
    );
  }

  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (text.length === 0) {
    throw new AiClientError('model returned no content', true);
  }

  const usage = body?.usageMetadata;
  const promptTokens = usage?.promptTokenCount ?? 0;
  const completionTokens = usage?.candidatesTokenCount ?? 0;

  return {
    text,
    promptTokens,
    completionTokens,
    model,
  };
}

export function createGeminiRestClient(options: GeminiRestClientOptions): TextModelClient {
  const baseUrl = options.baseUrl ?? BASE_URL;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'gemini-rest',

    async generate(model, request, signal) {
      const url = `${baseUrl}/${encodeURIComponent(model)}:generateContent`;

      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': options.apiKey,
          },
          body: JSON.stringify(buildBody(request)),
          signal,
        });
      } catch (error) {
        // AbortError is our own timeout; anything else is a network failure.
        const isAbort = error instanceof Error && error.name === 'AbortError';
        throw new AiClientError(
          isAbort ? `request to ${model} timed out` : `request to ${model} failed`,
          true,
          error,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // 429 and 5xx are worth another try; 4xx means the request is wrong.
        const retryable = response.status === 429 || response.status >= 500;
        throw new AiClientError(
          `model ${model} responded ${response.status}: ${detail.slice(0, 300)}`,
          retryable,
        );
      }

      const payload: unknown = await response.json().catch(() => null);
      return parseResponse(payload, model);
    },
  };
}
