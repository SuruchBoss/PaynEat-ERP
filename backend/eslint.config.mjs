// @ts-check
// Adapted from Cwork (backend/eslint.config.mjs), see NOTICE.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-member-accessibility': ['off'],
      // Everything the API says goes through the telemetry logger (docs/TELEMETRY.md):
      // a stray console line is a log line with no severity, labels or correlation id.
      'no-console': 'error',
    },
  },
  {
    // Command-line entry points: stdout is the interface there.
    files: ['scripts/**/*.ts', 'prisma/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
