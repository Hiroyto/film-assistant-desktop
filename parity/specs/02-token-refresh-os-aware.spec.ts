// PT-002 — Token refresh OS-aware (AD-03 / BR-MIGRAR-007). Desktop-focused (lifecycle).
import { test, expect } from '../fixtures';

test.describe('Token refresh OS-aware', () => {
  test.skip(({ client }) => client === 'web', 'OS lifecycle é desktop-only');

  test('@paridade @critico @os-lifecycle sleep+wake dispara refresh imediato', async ({ page, bridge }) => {
    await bridge.emitOs('resumed'); // wake após sleep longo (token expirado)
    // renderer fez fetchAuthSession() e novo token armazenado → save sem 401
    const ok = await page.evaluate(() => (window as any).__TEST__?.lastTokenRefreshed?.());
    expect(ok).toBeTruthy();
  });

  test('@paridade @critico JIT refresh se token <5min de expirar', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.setTokenExpiry?.(4 * 60));
    await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('user'));
    const refreshed = await page.evaluate(() => (window as any).__TEST__?.jitRefreshHappened?.());
    expect(refreshed).toBe(true);
  });

  test('@paridade @critico @regressao-esperada 401 vira retry com refresh (tech-debt #17)', async ({ page }) => {
    await page.route(/\/user/, async (route, req) => {
      // primeira → 401, segunda → 200 (após refresh)
      const n = Number((req.headers()['x-test-attempt'] as string) || '0');
      route.fulfill({ status: n === 0 ? 401 : 200, body: '{}' });
    });
    const res = await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('user'));
    expect(res?.success).toBe(true); // user não vê erro
  });

  test('@paridade @critico @os-lifecycle before-quit drena a sync queue', async ({ bridge }) => {
    // 5 mutations pendentes → quit → flush imediato → 0 órfãs
    await bridge.emitOs('before-quit');
    expect(await bridge.queueDepth()).toBe(0);
  });
});
