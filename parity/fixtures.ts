// Fixtures da suíte de paridade. Abstrai o "cliente" (web vs desktop) para que o MESMO
// spec rode contra ambos. Expõe:
//   • page          — a Page do cliente atual (web: browser; desktop: janela Electron).
//   • client        — 'web' | 'desktop'.
//   • bridge        — TestBridge: observa estado local-first (SQLite/sync_queue) e injeta
//                     eventos OS/sync em test builds. No desktop usa window.__TEST__
//                     (exposto só em builds de teste); na web é um stub.
//   • backend       — interceptação de rotas para asserts de contrato.
import { test as base, expect, _electron, Page, ElectronApplication } from '@playwright/test';

export interface TestBridge {
  /** Lê uma linha do SQLite local (desktop). Web: retorna null. */
  dbGet(sql: string, params?: unknown[]): Promise<any>;
  /** Profundidade atual da sync_queue. */
  queueDepth(): Promise<number>;
  /** Injeta um evento OS (resumed/online/offline/before-quit) — test build. */
  emitOs(event: string): Promise<void>;
  /** Injeta um deep link (Stripe/Cognito). */
  emitDeepLink(url: string): Promise<void>;
}

interface Fixtures {
  client: 'web' | 'desktop';
  page: Page;
  bridge: TestBridge;
}

let electronApp: ElectronApplication | null = null;

export const test = base.extend<Fixtures>({
  client: async ({}, use, testInfo) => {
    await use(testInfo.project.name === 'desktop' ? 'desktop' : 'web');
  },

  page: async ({ client, page: webPage, baseURL }, use) => {
    if (client === 'web') {
      await webPage.goto('/');
      await use(webPage);
      return;
    }
    // Desktop: lança o Electron (shell/dist/main.js) em modo teste. O main.ts,
    // desempacotado, cai no branch isDev → carrega ELECTRON_START_URL: apontamos para
    // o static-server (webServer :3100) que serve o build/ do renderer sobre HTTP.
    const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3100';
    electronApp = await _electron.launch({
      args: ['shell/dist/main.js'],
      env: { ...process.env, ELECTRON_IS_TEST: '1', ELECTRON_START_URL: startUrl },
    });
    const win = await electronApp.firstWindow();
    // O renderer monta window.__TEST__ no bootstrap (index.tsx → installTestBridge()),
    // ANTES do ReactDOM.render. Espera o bundle executar para não haver corrida com o
    // readyState=loading (senão os specs veem __TEST__ === undefined e falham/falsam).
    // Aguarda o TestBridge montar E o boot de fixture (seed SQLite assíncrono) concluir.
    // Sem a 2ª condição, um goto seguinte recarregaria o renderer e abortaria o seed em
    // voo → dbGet volta null (parity runtime 19). __TEST_FIXTURE_READY__ é resetado no
    // mount do App e vira true no finally de runFixtureBoot (inclusive quando não há
    // fixture na URL → resolve imediato).
    const waitBridge = async () => {
      await win.waitForFunction(() => !!(window as any).__TEST__, undefined, { timeout: 20_000 });
      await win.waitForFunction(() => (window as any).__TEST_FIXTURE_READY__ === true, undefined, {
        timeout: 20_000,
      });
    };
    await win.waitForLoadState('domcontentloaded');
    await waitBridge();
    // Janelas _electron NÃO herdam use.baseURL: resolve as URLs relativas dos specs
    // (page.goto('/?screen=…')) contra o static-server e re-espera o __TEST__ remontar
    // após cada navegação (goto recarrega o renderer).
    const base = baseURL || process.env.DESKTOP_BASE_URL || 'http://localhost:3100';
    const origGoto = win.goto.bind(win);
    (win as any).goto = async (url: string, opts?: Parameters<typeof origGoto>[1]) => {
      const abs = /^[a-z]+:\/\//i.test(url) ? url : new URL(url, base).toString();
      const res = await origGoto(abs, opts);
      await waitBridge();
      return res;
    };
    await use(win);
    await electronApp.close();
    electronApp = null;
  },

  bridge: async ({ client, page }, use) => {
    const bridge: TestBridge = {
      async dbGet(sql, params = []) {
        if (client === 'web') return null;
        return page.evaluate(
          ([s, p]) => (window as any).__TEST__?.dbGet?.(s, p) ?? null,
          [sql, params] as const,
        );
      },
      async queueDepth() {
        if (client === 'web') return 0;
        return page.evaluate(() => (window as any).__TEST__?.queueDepth?.() ?? 0);
      },
      async emitOs(event) {
        await page.evaluate((e) => (window as any).__TEST__?.emitOs?.(e), event);
      },
      async emitDeepLink(url) {
        await page.evaluate((u) => (window as any).__TEST__?.emitDeepLink?.(u), url);
      },
    };
    await use(bridge);
  },
});

export { expect };
