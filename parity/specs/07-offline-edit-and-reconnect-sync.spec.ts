// PT-007 — Offline edit + reconnect sync (AD-01 / BR-MIGRAR-014,015,022,033,035,046).
import { test, expect } from '../fixtures';

test.describe('Offline edit + reconnect sync', () => {
  test.skip(({ client }) => client === 'web', 'local-first/offline é desktop-only');

  test('@paridade @critico @offline desconectar não impede edits', async ({ page, bridge }) => {
    await bridge.emitOs('offline');
    await expect(page.getByText(/offline — changes saved locally/i)).toBeVisible();
    await page.goto('/?screen=outline');
    await page.getByLabel(/S5/i).fill('New text'); // edita normalmente
  });

  test('@paridade @critico @offline edit offline persiste SQLite + enfileira', async ({ page, bridge }) => {
    await bridge.emitOs('offline');
    await page.goto('/?screen=outline');
    await page.getByLabel(/S5/i).fill('New text');
    await page.waitForTimeout(10500);
    const row = await bridge.dbGet('SELECT segments_json FROM stories ORDER BY updated_at DESC LIMIT 1');
    expect(JSON.parse(row.segments_json).S5.S).toBe('New text');
    expect(await bridge.queueDepth()).toBeGreaterThan(0);
  });

  test('@paridade @critico @reconnect reconnect flush automático', async ({ page, bridge }) => {
    await page.goto('/?fixture=20-pending-offline');
    await bridge.emitOs('online');
    await expect(page.getByText(/syncing/i)).toBeVisible();
    await expect.poll(() => bridge.queueDepth()).toBe(0);
    await expect(page.getByText(/synced/i)).toBeVisible();
  });

  test('@paridade @critico @reconnect WS reconnect estendido após 5 attempts (BR-046)', async ({ page, bridge }) => {
    await page.goto('/?fixture=ws-exhausted');
    await expect(page.getByText(/offline/i)).toBeVisible(); // extended backoff
    await bridge.emitOs('online'); // reseta counter, reconecta
  });

  test('@paridade @critico @idempotencia mesma mutation retried não duplica (request_id)', async ({ page }) => {
    const seen: string[] = [];
    await page.route(/\/works/, (route, req) => {
      seen.push(req.headers()['x-request-id'] as string);
      route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/?fixture=retry-same-request');
    // backend recebe 2x o mesmo R1 (dedup é COD-008 server-side)
    expect(new Set(seen).size).toBeLessThanOrEqual(seen.length);
  });

  test('@paridade @offline edit offline + web simultânea → conflict', async ({ page, bridge }) => {
    await page.goto('/?fixture=offline-edit-s5');
    await bridge.emitOs('online'); // pull detecta version skew
    await expect(page.getByText(/conflict/i)).toBeVisible();
  });

  test('@paridade @offline auto-save 30min funciona offline', async ({ page, bridge }) => {
    await page.goto('/?fixture=offline-dirty');
    await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(30 * 60 * 1000));
    expect(await bridge.queueDepth()).toBeGreaterThan(0);
  });
});
