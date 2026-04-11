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
  },
  // ── Architecture: services, actions, pages, workers, jobs must not import db ──
  // All DB access must go through repositories (services → repositories → db).
  //
  // Excluded paths (ignores):
  //   - *.repository.ts            — repositories ARE the layer that owns db
  //   - src/server/lib/audit.ts    — owns the AuditLog table (acts as a repo
  //                                  for an append-only table; mirrors the
  //                                  repository contract for audit writes)
  //   - src/server/lib/cronLogger.ts — owns the CronLog table (same pattern)
  //   - src/server/lib/requireUser.ts — bootstraps auth state with a fresh
  //                                  DB lookup; runs before any repository
  //                                  layer is meaningful
  //   - src/server/services/health.service.ts — uses $queryRaw for liveness
  //                                  probes; cannot meaningfully be wrapped
  //                                  in a typed repository
  //
  // src/app/** is included so that page/route/component files cannot bypass the
  // layered architecture by calling db directly — they must go via server actions
  // or data-fetching helpers that use repositories.
  {
    files: [
      'src/modules/**/*.ts',
      'src/server/actions/**/*.ts',
      'src/server/workers/**/*.ts',
      'src/server/jobs/**/*.ts',
      'src/server/services/**/*.ts',
      'src/server/lib/**/*.ts',
      'src/app/**/*.ts',
      'src/app/**/*.tsx',
    ],
    ignores: [
      'src/modules/**/*.repository.ts',
      'src/server/lib/audit.ts',
      'src/server/lib/cronLogger.ts',
      'src/server/lib/requireUser.ts',
      'src/server/services/health.service.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/db',
              message:
                'Services and actions must not import db directly. Use a repository instead.',
            },
          ],
        },
      ],
    },
  },
);
