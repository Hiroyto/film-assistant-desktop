// PT-009 — Save-on-sign-out local-first (BR-MIGRAR-008).
import { test, expect } from '../fixtures';

test.describe('Save-on-sign-out (local-first)', () => {
  test('@paridade @critico sign-out aguarda flush completo da queue', async ({ page, bridge, client }) => {
    await page.goto('/?screen=profile&fixture=3-pending');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page.getByText(/syncing changes before sign out/i)).toBeVisible();
    if (client === 'desktop') await expect.poll(() => bridge.queueDepth()).toBe(0);
    await expect(page).toHaveURL(/login/);
  });

  test('@paridade @critico @regressao-esperada sign-out offline preserva SQLite', async ({ page, bridge, client }) => {
    test.skip(client === 'web');
    await bridge.emitOs('offline');
    await page.goto('/?screen=profile&fixture=3-pending');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page.getByText(/sign out anyway/i)).toBeVisible();
    await page.getByRole('button', { name: /sign out anyway/i }).click();
    // token invalidado MAS sync_queue + SQLite preservados
    expect(await bridge.queueDepth()).toBeGreaterThan(0);
  });

  test('@paridade @critico @os-lifecycle Cmd+Q dispara mesma proteção', async ({ bridge, client }) => {
    test.skip(client === 'web');
    await bridge.emitOs('before-quit');
    await expect.poll(() => bridge.queueDepth()).toBe(0);
  });

  test('@paridade @critico sign-out web simultâneo não afeta desktop (coexistência)', async ({ page, client }) => {
    test.skip(client === 'web');
    // desktop tem sessão própria; push segue aceito com seu bearer
    const res = await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('works'));
    expect(res?.success).toBe(true);
  });
});
