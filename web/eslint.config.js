// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (web/eslint.config.js), see NOTICE.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-demo', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      // The backend's code is not the console's to import (ADR-0021): only the demo may.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@backend/*'], message: 'Only src/demo imports backend code.' }] },
      ],
    },
  },
  {
    // The public demo runs the backend's own rules (ADR-0021): its pure domain/ functions, the
    // permission map and the demo data, nothing that needs a server. totp.ts signs with Node's
    // crypto, so only a test may import it.
    files: ['src/demo/**/*.{ts,tsx}'],
    ignores: ['src/demo/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^@backend/(?!(src/(core|modules)/[\\w-]+/domain/[\\w-]+|src/core/security/permissions|prisma/demo-data)$)',
              message:
                'The demo imports only the backend’s pure domain/ rules, its permissions and its demo data (ADR-0021).',
            },
            {
              regex: '^@backend/src/modules/auth/domain/totp$',
              message: 'totp.ts signs with Node’s crypto; the demo has its own (src/demo/totp.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/demo/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
