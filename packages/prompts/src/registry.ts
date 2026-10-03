import { PromptNotFoundError, PromptVersionNotFoundError } from './errors.js';
import type { PromptDescriptor, PromptMessages, PromptTemplate } from './types.js';

/**
 * Versioned prompt registry.
 *
 * Registering a second version of an existing id keeps the old version callable,
 * so a rollback is a one-word change and every prompt change is auditable.
 */
export class PromptRegistry {
  readonly #templates = new Map<string, PromptTemplate[]>();

  register<TOutput extends PromptTemplate>(template: TOutput): TOutput {
    const existing = this.#templates.get(template.id) ?? [];
    if (existing.some((candidate) => candidate.version === template.version)) {
      throw new Error(
        `Prompt "${template.id}" version ${template.version} is already registered`,
      );
    }
    existing.push(template);
    existing.sort((a, b) => a.version - b.version);
    this.#templates.set(template.id, existing);
    return template;
  }

  /** Latest version when `version` is omitted. */
  get(id: string, version?: number): PromptTemplate {
    const versions = this.#templates.get(id);
    if (!versions || versions.length === 0) {
      throw new PromptNotFoundError(id);
    }
    if (version === undefined) {
      const latest = versions.at(-1);
      if (latest === undefined) {
        throw new PromptNotFoundError(id);
      }
      return latest;
    }
    const match = versions.find((candidate) => candidate.version === version);
    if (match === undefined) {
      throw new PromptVersionNotFoundError(
        id,
        version,
        versions.map((candidate) => candidate.version),
      );
    }
    return match;
  }

  latestVersion(id: string): number {
    return this.get(id).version;
  }

  list(): PromptDescriptor[] {
    const descriptors: PromptDescriptor[] = [];
    for (const versions of this.#templates.values()) {
      for (const template of versions) {
        descriptors.push({
          id: template.id,
          version: template.version,
          description: template.description,
          variables: template.variables,
        });
      }
    }
    return descriptors.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  }

  /** Renders the system + user messages for the requested prompt version. */
  render(id: string, variables: Record<string, string>, version?: number): PromptMessages {
    const template = this.get(id, version);
    return template.build(variables);
  }

  clear(): void {
    this.#templates.clear();
  }
}
