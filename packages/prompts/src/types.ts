import type { z } from 'zod';

/** One `{{variable}}` a template expects. */
export interface PromptVariable {
  name: string;
  description: string;
  required?: boolean;
}

/** The two messages handed to the model. */
export interface PromptMessages {
  readonly system: string;
  readonly user: string;
}

/**
 * A single versioned prompt.
 *
 * `outputSchema` is the zod schema the model response is validated against, so a
 * template and its contract can never drift apart.
 */
export interface PromptTemplate<TOutput extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly variables: readonly PromptVariable[];
  readonly outputSchema?: TOutput;
  build(variables: Record<string, string>): PromptMessages;
}

/** Lightweight descriptor returned by `PromptRegistry.list()`. */
export interface PromptDescriptor {
  id: string;
  version: number;
  description: string;
  variables: readonly PromptVariable[];
}
