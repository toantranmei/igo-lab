import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = Object.fromEntries(
  ['contract', 'example', 'pipeline', 'agents', 'registry', 'bundle', 'ingest', 'db'].map((p) => [
    `@cl/${p}`,
    path.resolve(__dirname, `packages/${p}/src`),
  ]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['packages/*/src/**/*.test.ts', 'tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
