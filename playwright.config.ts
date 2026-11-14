import { defineConfig } from '@playwright/test';
import { APPS } from './src/shell/apps.ts';

// One project per app of the suite: tests/e2e/<app>/ runs against dist/<app>/ (`--project writer`),
// and tests/e2e/startcenter/ against the Start Center at the suite's root.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'startcenter', testDir: './tests/e2e/startcenter', use: { baseURL: 'http://localhost:4173/' } },
    ...APPS.map((a) => ({ name: a.id, testDir: `./tests/e2e/${a.id}`, use: { baseURL: `http://localhost:4173/${a.id}/` } })),
  ],
  // Tests run against the production bundle: that is what a static host serves.
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true },
});
