import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontScale, palette, radius, shadow } from '../theme/tokens';

// Vitest runs with the package root as cwd.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').toLowerCase();

function assertInCss(token: string, value: string): void {
  expect(css).toContain(`${token}: ${value};`);
}

describe('design tokens', () => {
  it('exports a soft peach/coral palette', () => {
    expect(palette.peach[500]).toBe('#FF7F55');
    expect(palette.coral[500]).toBe('#FF7A66');
    expect(palette.canvas).toBe('#FFF9F5');
  });

  it('uses rounded card radii and soft shadows', () => {
    expect(radius.card).toBe('1.5rem');
    expect(shadow.card).toContain('rgba(42, 27, 22');
  });

  it('defines a readable font scale', () => {
    expect(fontScale.body).toBe('0.9375rem');
    expect(fontScale.display).toBe('1.875rem');
  });

  describe('index.css stays in sync with tokens.ts', () => {
    it('declares every surface color', () => {
      assertInCss('--color-canvas', palette.canvas.toLowerCase());
      assertInCss('--color-surface', palette.surface.toLowerCase());
      assertInCss('--color-surface-muted', palette.surfaceMuted.toLowerCase());
      assertInCss('--color-line', palette.border.toLowerCase());
    });

    it('declares every peach step', () => {
      for (const [step, value] of Object.entries(palette.peach)) {
        assertInCss(`--color-peach-${step}`, value.toLowerCase());
      }
    });

    it('declares every ink step', () => {
      for (const [step, value] of Object.entries(palette.ink)) {
        assertInCss(`--color-ink-${step}`, value.toLowerCase());
      }
    });

    it('declares the semantic colors', () => {
      assertInCss('--color-success', palette.success.base.toLowerCase());
      assertInCss('--color-warning', palette.warning.base.toLowerCase());
      assertInCss('--color-danger', palette.danger.base.toLowerCase());
      assertInCss('--color-info', palette.info.base.toLowerCase());
      assertInCss('--color-success-soft', palette.success.soft.toLowerCase());
      assertInCss('--color-danger-soft', palette.danger.soft.toLowerCase());
    });

    it('declares the radii', () => {
      assertInCss('--radius-card', radius.card);
      assertInCss('--radius-pill', radius.pill);
    });

    it('declares the shadows', () => {
      assertInCss('--shadow-card', shadow.card.toLowerCase());
      assertInCss('--shadow-popover', shadow.popover.toLowerCase());
    });

    it('declares the font scale', () => {
      assertInCss('--text-body', fontScale.body);
      assertInCss('--text-display', fontScale.display);
      assertInCss('--text-caption', fontScale.caption);
    });
  });
});
