import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], include: ['test/**/*.test.{ts,tsx}'], globals: true },
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': resolve(__dirname, '.') } },
});
