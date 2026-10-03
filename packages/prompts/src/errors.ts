/** Thrown when a template uses `{{name}}` but no value was supplied. */
export class MissingVariableError extends Error {
  readonly code = 'missing_variable';
  constructor(readonly variable: string) {
    super(`Missing value for template variable "${variable}"`);
    this.name = 'MissingVariableError';
  }
}

/** Thrown when a value was supplied that the template never references. */
export class UnknownVariableError extends Error {
  readonly code = 'unknown_variable';
  constructor(readonly variables: readonly string[]) {
    super(`Template does not use variable(s): ${variables.join(', ')}`);
    this.name = 'UnknownVariableError';
  }
}

/** Thrown when a prompt id was never registered. */
export class PromptNotFoundError extends Error {
  readonly code = 'prompt_not_found';
  constructor(readonly promptId: string) {
    super(`No prompt registered with id "${promptId}"`);
    this.name = 'PromptNotFoundError';
  }
}

/** Thrown when a prompt id exists but not at the requested version. */
export class PromptVersionNotFoundError extends Error {
  readonly code = 'prompt_version_not_found';
  constructor(
    readonly promptId: string,
    readonly version: number,
    readonly availableVersions: readonly number[],
  ) {
    super(
      `Prompt "${promptId}" has no version ${version} (available: ${
        availableVersions.join(', ') || 'none'
      })`,
    );
    this.name = 'PromptVersionNotFoundError';
  }
}
