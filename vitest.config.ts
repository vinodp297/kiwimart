import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/modules/**/*.ts',
        'src/server/lib/**/*.ts',
        'src/server/actions/**/*.ts',
        'src/server/jobs/**/*.ts',
        'src/shared/**/*.ts',
        'src/lib/**/*.ts',
      ],
      exclude: [
        '**/*.types.ts',
        '**/*.d.ts',
        '**/index.ts',
        'src/test/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
