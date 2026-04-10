import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
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
      // ── Coverage thresholds (Testing Sprint D) ──────────────────────────
      // Set just below actually-achieved numbers so any regression fails CI.
      // Achieved at the time of raising: statements 46.19 / branches 36.33
      //                                  functions 41.91 / lines 46.40
      // Each floor is achieved − ~0.2 to absorb test ordering noise.
      // Never raise above achieved — inflating thresholds is dishonest.
      thresholds: {
        lines: 46,
        functions: 41,
        branches: 36,
        statements: 46,
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
