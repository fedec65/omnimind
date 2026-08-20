import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Measure only the shipped code — without this the v8 provider sweeps
      // gui/, benchmarks/, scripts/ and coverage temp artifacts into the report.
      include: ['src/**'],
      exclude: [
        'src/cli.ts',
        'src/mcp-server.ts',
        'src/mcp/server.ts',
        // Entry point exercised by spawn-based integration tests
        // (tests/server/*.test.ts run `node dist/server.js`) — invisible
        // to in-process v8 coverage.
        'src/server.ts',
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
