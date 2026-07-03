// Playwright config da suíte de PARIDADE (Tarefa 17 / parity_specs.md).
// Dois projetos: 'web' (oráculo, web SPA em localhost:3000) e 'desktop' (Electron).
// Os mesmos specs rodam nos dois; cenários @paridade comparam comportamento; cenários
// @paridade-visual capturam golden; @paridade-comportamental validam contrato (só desktop).
import { defineConfig } from '@playwright/test';

const DESKTOP_BASE_URL = process.env.DESKTOP_BASE_URL || 'http://localhost:3100';

export default defineConfig({
  testDir: './specs',
  // O projeto 'desktop' lança um Electron por teste, todos compartilhando o MESMO
  // static-server (:3100), o MESMO user-data dir e o MESMO arquivo SQLite local.
  // Rodar em paralelo faz dois `_electron.launch` colidirem ("Target page/browser has
  // been closed" no launch). Electron+SQLite é serial aqui → 1 worker, sem paralelismo
  // intra-arquivo. (Runtime 19: remove os crashes de concorrência do tally.)
  workers: 1,
  fullyParallel: false,
  // Tolerância de pixel ≤1% (parity_specs §paridade visual).
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  use: { trace: 'on-first-retry' },
  // Serve o build/ do renderer sobre HTTP p/ o projeto 'desktop' (ELECTRON_START_URL +
  // baseURL). O oráculo 'web' (:3000) roda separado via `npm start`.
  webServer: {
    // cwd do webServer = diretório deste config (parity/); o script resolve build/ via __dirname.
    command: 'node static-server.js',
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'web', // oráculo: web SPA local
      use: { baseURL: process.env.WEB_BASE_URL || 'http://localhost:3000' },
    },
    {
      name: 'desktop', // Electron (launched via fixtures com _electron)
      use: { baseURL: DESKTOP_BASE_URL },
    },
  ],
});
