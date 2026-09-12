import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'node server.ts',
    url: 'http://127.0.0.1:3100/api/state',
    env: { PORT: '3100', SCOPE_RECORDINGS_DIR: './tmp/browser-recordings' },
    reuseExistingServer: false,
    timeout: 60000,
  },
});
