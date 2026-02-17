import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['plugins/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@clawsquare/security-pipeline': path.resolve(
        import.meta.dirname,
        '../packages/core/src/index.ts',
      ),
    },
  },
});
