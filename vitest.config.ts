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
      thresholds: {
        lines: 39,
        functions: 32,
        branches: 30,
        statements: 39,
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
