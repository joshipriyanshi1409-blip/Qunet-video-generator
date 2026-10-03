import type { Logger } from 'pino';
import {
  AiClientError,
  AiValidationError,
  formatZodIssues,
  type AiCallOptions,
  type AiCallResult,
  type AiUsage,
  type TextModelClient,
  type TextModelRequest,
  type TextModelResponse,
} from './types.js';

/**
 * The single wrapper every AI call goes through (engineering rule 2).
 *
 * Guarantees:
 * - **retries** with exponential backoff on transient failures
 * - **timeout** per attempt, enforced with an AbortController
 * - **fallback model** when the primary is unavailable
 * - **JSON mode** requested from the model, then **zod validated**
 * - **one auto re-prompt** with the validation error appended, then a graceful
 *   failure - never a silent bad object
 * - **token/cost logging** on every call, attributed to a creator and a prompt
 */

export interface AiWrapperOptions {
  client: TextModelClient;
  logger: Logger;
  /** Model id for the slot in use. Never hard-coded - read from config. */
  primaryModel: string;
  /** Used when the primary keeps failing. Optional. */
  fallbackModel?: string;
  /** Attempts per model (the first one plus retries). Default 2. */
  maxAttempts?: number;
  /** Backoff before the first retry, doubling each time. Default 250ms. */
  backoffMs?: number;
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** USD per 1k tokens, for the cost estimate in the logs. Optional. */
  inputPricePer1k?: number;
  outputPricePer1k?: number;
  /** Injectable sleep, so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock, so duration maths is deterministic in tests. */
  now?: () => number;
}

/** The two rendered messages a prompt produces. */
export interface PromptMessages {
  system: string;
  user: string;
}

export interface TextModelService {
  /**
   * Sends already-rendered messages and returns schema-validated JSON.
   * The caller (a service) owns prompt rendering; this wrapper owns everything
   * that happens between the render and the validated result.
   */
  callJson<T>(
    messages: PromptMessages,
    options: AiCallOptions,
  ): Promise<AiCallResult<T>>;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REPROMPTS = 1;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTextModelService(options: AiWrapperOptions): TextModelService {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());

  const models: string[] = [options.primaryModel];
  if (options.fallbackModel !== undefined && options.fallbackModel !== options.primaryModel) {
    models.push(options.fallbackModel);
  }

  function buildRequest(user: string, system: string): TextModelRequest {
    return {
      system,
      user,
      json: true,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    };
  }

  async function runOnce(model: string, request: TextModelRequest): Promise<TextModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await options.client.generate(model, request, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Tries `model` up to `maxAttempts` times. Retries only on retryable errors,
   * so a bad request fails fast instead of burning quota.
   */
  async function callWithRetries(
    model: string,
    request: TextModelRequest,
    meta: AiCallOptions,
  ): Promise<TextModelResponse> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await runOnce(model, request);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof AiClientError ? error.retryable : false;
        if (!retryable || attempt === maxAttempts) break;

        const delay = backoffMs * 2 ** (attempt - 1);
        options.logger.warn(
          {
            err: error,
            model,
            attempt,
            maxAttempts,
            retryInMs: delay,
            promptId: meta.promptId,
            uid: meta.uid,
          },
          'ai call failed - retrying',
        );
        await sleep(delay);
      }
    }

    throw normalizeModelError(lastError);
  }

  /**
   * An adapter that throws something unexpected - a `TypeError`, a socket
   * error, a bug - must still surface as `ai_unavailable` (503), never as a
   * generic 500. `AiClientError` and `AiValidationError` pass through untouched
   * so their codes survive.
   */
  function normalizeModelError(error: unknown): Error {
    if (error instanceof AiClientError || error instanceof AiValidationError) {
      return error;
    }
    if (error instanceof Error) {
      return new AiClientError(error.message, false, error);
    }
    return new AiClientError(String(error), false);
  }

  function estimateCost(usage: Pick<AiUsage, 'promptTokens' | 'completionTokens'>): number | undefined {
    const inPrice = options.inputPricePer1k;
    const outPrice = options.outputPricePer1k;
    if (inPrice === undefined && outPrice === undefined) return undefined;
    const input = ((usage.promptTokens / 1000) * (inPrice ?? 0)).toFixed(6);
    const output = ((usage.completionTokens / 1000) * (outPrice ?? 0)).toFixed(6);
    return Number(input) + Number(output);
  }

  function logUsage(usage: AiUsage, meta: AiCallOptions): void {
    options.logger.info(
      {
        ai: {
          ...usage,
          estimatedCostUsd: estimateCost(usage),
          adapter: options.client.name,
          promptId: meta.promptId,
          promptVersion: meta.promptVersion,
          operation: meta.operation,
          uid: meta.uid,
        },
      },
      'ai call complete',
    );
  }

  return {
    async callJson<T>(messages: PromptMessages, meta: AiCallOptions): Promise<AiCallResult<T>> {
      const startedAt = now();
      let reprompted = false;
      let validationIssues: readonly string[] = [];

      // --- attempt loop: first try, then at most one re-prompt --------------
      for (let reprompt = 0; reprompt <= MAX_REPROMPTS; reprompt += 1) {
        let user = messages.user;
        if (reprompt > 0) {
          reprompted = true;
          user = `${messages.user}\n\nYour previous answer was rejected. Fix ONLY these problems and return the full JSON again:\n- ${validationIssues.join('\n- ')}\n\n${meta.repromptHint ?? ''}`.trim();
        }

        // --- model loop: primary, then fallback -----------------------------
        let response: TextModelResponse | undefined;
        let usedFallback = false;

        for (let index = 0; index < models.length; index += 1) {
          const model = models[index];
          if (model === undefined) continue;
          try {
            response = await callWithRetries(model, buildRequest(user, messages.system), meta);
            usedFallback = index > 0;
            break;
          } catch (error) {
            const isLast = index === models.length - 1;
            options.logger.error(
              {
                err: error,
                model,
                isLast,
                promptId: meta.promptId,
                uid: meta.uid,
              },
              isLast ? 'ai call failed on every model' : 'ai call failed - trying fallback model',
            );
            if (isLast) throw error;
          }
        }

        if (response === undefined) {
          // Unreachable: the loop either breaks with a response or throws.
          throw new AiClientError('no model produced a response', false);
        }

        // --- validate ------------------------------------------------------
        const parsed = meta.schema.safeParse(parseJson(response.text));
        if (parsed.success) {
          const durationMs = Math.max(0, now() - startedAt);
          const usage: AiUsage = {
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            totalTokens: response.promptTokens + response.completionTokens,
            model: response.model,
            usedFallback,
            durationMs,
          };
          const withCost = estimateCost(usage);
          const finalUsage: AiUsage =
            withCost === undefined ? usage : { ...usage, estimatedCostUsd: withCost };

          logUsage(finalUsage, meta);

          return { data: parsed.data as T, usage: finalUsage, reprompted };
        }

        validationIssues = formatZodIssues(parsed.error);
        options.logger.warn(
          {
            promptId: meta.promptId,
            promptVersion: meta.promptVersion,
            uid: meta.uid,
            issues: validationIssues,
            reprompt,
          },
          'ai response failed schema validation',
        );
      }

      throw new AiValidationError(
        `The model response for "${meta.promptId}" did not match the schema after ${MAX_REPROMPTS} re-prompt(s).`,
        validationIssues,
      );
    },
  };
}

/** Parses model text as JSON, tolerating stray code fences. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    return { __unparsable__: withoutFence.slice(0, 2000) };
  }
}
