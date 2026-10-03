// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

/**
 * Shared flat ESLint config for the whole monorepo.
 *
 * Type-aware rules are enabled for the backend packages (api/worker) where every
 * file is covered by a tsconfig. The web app and test files use the
 * non-type-aware recommended set so `pnpm lint` stays fast and never breaks on
 * a file that is outside a tsconfig program.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,

  // --- non-type-aware baseline for everything -------------------------------
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // --- type-aware rules for the backend packages ---------------------------
  {
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    ...tseslint.configs.recommendedTypeChecked[0],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // console.error is reserved for failures that happen before the pino
      // logger exists (env validation, top-level boot catch).
      'no-console': ['error', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
    },
  },

  // --- backend tests -------------------------------------------------------
  // Test doubles and supertest responses are deliberately loosely typed, so the
  // `no-unsafe-*` family (which only exists to catch untyped production data)
  // is switched off for `__tests__`. `no-explicit-any` is already off there.
  // `require-await` is off because `async () => value` is the idiomatic way to
  // write a stub that must satisfy a `() => Promise<T>` signature.
  {
    files: [
      'apps/api/src/**/__tests__/**/*.ts',
      'apps/api/src/**/*.test.ts',
      'apps/worker/src/**/__tests__/**/*.ts',
      'apps/worker/src/**/*.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  // --- web app -------------------------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // --- cli scripts ---------------------------------------------------------
  // A script that exists to be run from a terminal is *supposed* to print.
  {
    files: ['**/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // --- tests ---------------------------------------------------------------
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
