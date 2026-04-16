import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "**/node_modules/**", "**/.claude/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/modules/**/*.ts",
        "src/server/lib/**/*.ts",
        "src/server/actions/**/*.ts",
        "src/server/jobs/**/*.ts",
        "src/shared/**/*.ts",
        "src/lib/**/*.ts",
      ],
      exclude: [
        "**/*.types.ts",
        "**/*.d.ts",
        "**/index.ts",
        "src/test/**",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "prisma/**",
        "src/app/api/docs/**",
        "src/infrastructure/config/**",
      ],
      // ── Coverage thresholds ──────────────────────────────────────────────
      // Set just below actually-achieved numbers so any regression fails CI.
      // Achieved at the time of raising (audit-fixes-3):
      //   All files:        statements 49.13 / branches 39.38 / functions 42.54 / lines 48.70
      //   modules/payments: statements 85.99 / branches 80.00 / functions 77.27 / lines 83.48
      //   modules/orders:   statements 80.38 / branches 75.18 / functions 68.25 / lines 80.59
      //   distributedLock:  statements 83.09 / branches 80.00 / functions 85.71 / lines 80.82
      // Each floor is achieved − ~1.5 to absorb test ordering noise.
      // Never raise above achieved — inflating thresholds is dishonest.
      thresholds: {
        // Global baseline
        lines: 48,
        functions: 42,
        branches: 39,
        statements: 48,

        // Critical modules — financial-grade code, higher standards.
        // Thresholds measured against glob-level achieved, not directory display.
        //
        // NOTE: the display row "modules/orders" (80.59%/75.18%) covers only
        // top-level files. The per-glob "src/modules/orders/**" also includes the
        // workflows/ subdirectory (~25% coverage), giving a combined per-glob of:
        //   stmts 66.14 / branches 53.69 / funcs 64.82 / lines 66.72
        // Thresholds below are per-glob achieved − 1.5.
        //
        // Achieved (per-glob): payments stmts 83.48 / orders stmts 66.14
        //                      orders lines 66.72 / orders branches 53.69
        //                      distributedLock stmts 83.09
        "src/modules/payments/**": {
          lines: 82,
          functions: 75,
          branches: 77,
          statements: 82,
        },
        "src/modules/orders/**": {
          lines: 65,
          functions: 63,
          branches: 52,
          statements: 64,
        },
        "src/server/lib/distributedLock.ts": {
          lines: 79,
          functions: 84,
          branches: 78,
          statements: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(
        __dirname,
        "src/test/__mocks__/server-only.ts",
      ),
    },
  },
});
