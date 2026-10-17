import { defineConfig, devices } from '@playwright/test';

// PLAYWRIGHT_CHANNEL=msedge (o chrome) usa el navegador instalado en vez de descargar Chromium.
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5181', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm build && pnpm preview', url: 'http://localhost:5181', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}), viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
  ],
});
