import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      // Allow tests to import from src/ without paths blowing up.
      vscode: new URL('./test/mocks/vscode.ts', import.meta.url).pathname,
    },
  },
});
