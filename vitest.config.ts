import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/cli.ts',
        'src/mcp-server.ts',
        'src/mcp/server.ts',
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 30000,
    benchmark: {
      include: ['tests/benchmarks/**/*.ts'],
    },
  },
});
