import { MissingVariableError, UnknownVariableError } from './errors.js';

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Names of every `{{variable}}` used by a template, in order of first use. */
export function extractVariables(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Strict `{{variable}}` interpolation.
 *
 * - A missing value throws (a silent empty string would quietly break a prompt).
 * - An unused value throws too, which catches renamed Creator DNA fields early.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  const used = new Set<string>();

  const rendered = template.replace(VARIABLE_PATTERN, (_match, rawName: string) => {
    const name = rawName.trim();
    used.add(name);
    const value = variables[name];
    if (value === undefined) {
      throw new MissingVariableError(name);
    }
    return value;
  });

  const unused = Object.keys(variables).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new UnknownVariableError(unused);
  }

  return rendered;
}
