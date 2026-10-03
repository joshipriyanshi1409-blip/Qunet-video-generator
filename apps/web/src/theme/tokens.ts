/**
 * Design tokens (single source of truth for anything Tailwind utilities cannot
 * express: inline SVG colors, chart values, Motion transitions).
 *
 * Keep in sync with `src/index.css` - `src/__tests__/theme.test.ts` fails when
 * the two drift apart.
 */
export const palette = {
  canvas: '#FFF9F5',
  surface: '#FFFFFF',
  surfaceMuted: '#FFF3EC',
  border: '#F6E3D8',

  peach: {
    50: '#FFF7F2',
    100: '#FFEDE3',
    200: '#FFD9C7',
    300: '#FFBFA3',
    400: '#FF9E78',
    500: '#FF7F55',
    600: '#F2643A',
    700: '#CB4A25',
    800: '#9C3A20',
    900: '#7A311F',
  },
  coral: {
    100: '#FFE7E4',
    300: '#FFB3A8',
    500: '#FF7A66',
    700: '#D94838',
  },
  ink: {
    900: '#2A1B16',
    700: '#5B463F',
    500: '#8A736B',
    300: '#C4B3AB',
    100: '#EFE4DE',
  },
  success: { soft: '#E7F6EC', base: '#2E9E63', strong: '#1F7A4B' },
  warning: { soft: '#FFF3DA', base: '#D9911F', strong: '#A96C0D' },
  danger: { soft: '#FFE9E6', base: '#DE5B4B', strong: '#B23A2C' },
  info: { soft: '#E9F1FF', base: '#3B7DD8', strong: '#2A5CA8' },
} as const;

export const radius = {
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  card: '1.5rem',
  pill: '9999px',
} as const;

export const shadow = {
  card: '0 1px 2px rgba(42, 27, 22, 0.04), 0 10px 30px rgba(42, 27, 22, 0.06)',
  cardHover: '0 2px 4px rgba(42, 27, 22, 0.05), 0 16px 40px rgba(42, 27, 22, 0.10)',
  popover: '0 12px 48px rgba(42, 27, 22, 0.16)',
  focus: '0 0 0 4px rgba(255, 127, 85, 0.22)',
} as const;

export const fontScale = {
  tiny: '0.75rem',
  caption: '0.8125rem',
  body: '0.9375rem',
  bodyLg: '1.0625rem',
  title: '1.375rem',
  display: '1.875rem',
} as const;

export const motionTokens = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
  ease: [0.22, 1, 0.36, 1] as const,
} as const;

/** Reaction level -> badge tone, shared by Hook Lab and Audience Mirror. */
export const reactionTone = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
} as const;

export const theme = { palette, radius, shadow, fontScale, motionTokens, reactionTone };
export default theme;
