/**
 * The port every AI call goes through.
 *
 * The API never talks to a model SDK directly: `TextModelClient` is the single
 * seam, so the wrapper (retries, timeout, fallback, validation, logging) is
 * testable with a fake and the adapter can be swapped without touching callers.
 */

export interface TextModelRequest {
  /** System instruction. */
  system: string;
  /** User turn. */
  user: string;
  /** Ask the model for strict JSON. */
  json: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TextModelResponse {
  /** Raw model text (JSON when `request.json` was true). */
  text: string;
  promptTokens: number;
  completionTokens: number;
  /** The model that actually answered. */
  model: string;
}

export interface TextModelClient {
  /** Adapter name, logged with every call (`gemini-rest`, `fake`, ...). */
  readonly name: string;
  generate(
    model: string,
    request: TextModelRequest,
    signal?: AbortSignal,
  ): Promise<TextModelResponse>;
}

/** Thrown when the model answered but the answer is unusable. */
export class AiClientError extends Error {
  /** Whether another attempt could plausibly succeed. */
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AiClientError';
    this.retryable = retryable;
  }
}

/** Thrown when the response never validates, even after the re-prompt. */
export class AiValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'AiValidationError';
  }
}

/** Everything logged per call, so spend is attributable to a creator + prompt. */
export interface AiUsageMeta {
  /** Prompt template id, e.g. `dna-extract`. */
  promptId: string;
  promptVersion: number;
  /** Creator the call was made for. */
  uid: string;
  /** Free-form label for the feature that made the call. */
  operation: string;
}

export interface AiCallOptions {
  /** Schema the parsed JSON must satisfy. */
  schema: ZodLike;
  promptId: string;
  promptVersion: number;
  uid: string;
  operation: string;
  /** Extra context appended to the user turn when re-prompting. */
  repromptHint?: string;
}

export interface AiCallResult<T> {
  data: T;
  usage: AiUsage;
  /** True when the first response failed validation and was re-prompted. */
  reprompted: boolean;
}

/** Minimal structural type so callers can pass any zod schema. */
export interface ZodLike {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: Issues };
}

export interface Issues {
  issues: readonly { path: ReadonlyArray<string | number>; message: string }[];
}

/** Token/cost accounting for one AI call, logged for every extraction. */
export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Model that actually produced the response (may be the fallback). */
  model: string;
  /** True when the fallback model had to be used. */
  usedFallback: boolean;
  /** Milliseconds spent on the winning attempt. */
  durationMs: number;
  /** Estimated USD cost, when prices are configured. */
  estimatedCostUsd?: number;
}

/** Formats zod issues into short strings for logs and re-prompts. */
export function formatZodIssues(error: Issues): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}
