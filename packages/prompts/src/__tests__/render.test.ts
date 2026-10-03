import { describe, expect, it } from 'vitest';
import {
  extractVariables,
  renderTemplate,
} from '../render.js';
import { MissingVariableError, UnknownVariableError } from '../errors.js';

describe('extractVariables', () => {
  it('lists every variable once, in order of first use', () => {
    expect(extractVariables('a {{one}} b {{two}} c {{one}}')).toEqual(['one', 'two']);
  });

  it('tolerates padded braces and ignores text without variables', () => {
    expect(extractVariables('no vars here')).toEqual([]);
    expect(extractVariables('{{  spaced  }}')).toEqual(['spaced']);
  });

  it('ignores malformed placeholders', () => {
    expect(extractVariables('{{ not-valid }} {{ok}}')).toEqual(['ok']);
  });
});

describe('renderTemplate', () => {
  it('substitutes every variable', () => {
    expect(renderTemplate('Hello {{name}}, welcome to {{product}}', {
      name: 'Ada',
      product: 'CreatorDNA',
    })).toBe('Hello Ada, welcome to CreatorDNA');
  });

  it('replaces repeated occurrences', () => {
    expect(renderTemplate('{{x}}-{{x}}', { x: '1' })).toBe('1-1');
  });

  it('throws when a variable has no value', () => {
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow(MissingVariableError);
  });

  it('throws when a supplied value is unused (catches renamed DNA fields)', () => {
    expect(() => renderTemplate('Hi {{name}}', { name: 'Ada', stale: 'x' })).toThrow(
      UnknownVariableError,
    );
  });

  it('does not mutate the input template', () => {
    const template = 'Hi {{name}}';
    renderTemplate(template, { name: 'Ada' });
    expect(template).toBe('Hi {{name}}');
  });
});
