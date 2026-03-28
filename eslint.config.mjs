import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'prisma/migrations/**',
      'scripts/**',
      '*.config.{js,mjs,ts}',
      'next.config.ts',
      'vitest.config.ts',
      'postcss.config.mjs',
      'tailwind.config.ts',
    ],
  },
  {
    // Suppress errors from inline eslint-disable comments referencing
    // plugins that are not installed (e.g. @next/next, react-hooks).
    // These comments are harmless — they were added when next lint existed.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Allow unused vars prefixed with _ (common pattern)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow explicit any in specific cases (Prisma types, etc.)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty catch blocks with a comment
      '@typescript-eslint/no-empty-function': 'off',
      // Allow require() imports (needed for dynamic imports in some contexts)
      '@typescript-eslint/no-require-imports': 'off',
      // Downgrade to warn — existing code has this pattern in image processing
      'no-useless-assignment': 'warn',
    },
  }
);
