import { defineConfig } from '@playwright/test';

// E2E de la app de escritorio: lanza el ejecutable compilado y se conecta por CDP a WebView2.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
});
