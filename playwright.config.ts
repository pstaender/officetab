import { defineConfig } from '@playwright/test';
import { APPS } from './src/shell/apps.ts';

// One project per app of the suite: tests/e2e/<app>/ runs against dist/<app>/ (`--project writer`),
// and tests/e2e/startcenter/ against the Start Center at the suite's root.
//
// The preview server's port is E2E_PORT (4173 by default). A server already on the port is reused,
// so parallel checkouts (worktrees) each need a port of their own: `E2E_PORT=4181 npm run test:e2e`.
const PORT = Number(process.env.E2E_PORT) || 4173;
const BASE = `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'startcenter', testDir: './tests/e2e/startcenter', use: { baseURL: BASE } },
    ...APPS.map((a) => ({ name: a.id, testDir: `./tests/e2e/${a.id}`, use: { baseURL: `${BASE}${a.id}/` } })),
  ],
  // Tests run against the production bundle: that is what a static host serves.
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: true },
});
