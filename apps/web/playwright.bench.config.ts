import { defineConfig, devices } from '@playwright/test';

// Benchmarks de escala (`pnpm bench`): mismo build de producción que los e2e, un solo worker.
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './bench',
  testMatch: '*.bench.ts',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5181', trace: 'off' },
  webServer: { command: 'pnpm build && pnpm preview', url: 'http://localhost:5181', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}), viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
  ],
});
