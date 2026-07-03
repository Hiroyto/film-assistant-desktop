// PT-005 — Characters CRUD + async refresh (AD-05 / BR-MIGRAR-018..025,045,046).
import { test, expect } from '../fixtures';

test.describe('Characters CRUD + async refresh', () => {
  test('@paridade @critico add usa name como PK + default minor', async ({ page, bridge, client }) => {
    await page.goto('/?screen=characters');
    await page.getByRole('button', { name: /add character/i }).click();
    await page.getByLabel(/name/i).fill('Alice');
    await page.getByRole('button', { name: /save/i }).click();
    if (client === 'desktop') {
      const row = await bridge.dbGet("SELECT importance, arc_growth FROM characters WHERE name='Alice'");
      expect(row?.importance).toBe('minor');
      expect(row?.arc_growth).toBe('static');
    }
    // adicionar "Alice" de novo → rejeitado (PK)
    await page.getByRole('button', { name: /add character/i }).click();
    await page.getByLabel(/name/i).fill('Alice');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/already exists|rename/i)).toBeVisible();
  });

  test('@paridade @critico locked imune a WS merge', async ({ page }) => {
    await page.goto('/?screen=characters&fixture=alice-locked-bob');
    await page.evaluate(() => (window as any).__TEST__?.emitWsCharacters?.(['Bob', 'Carol'])); // Alice omitida
    await expect(page.getByText('Alice')).toBeVisible(); // preservada
    await expect(page.getByText('Carol')).toBeVisible(); // is_new
  });

  test('@paridade @critico async refresh sucede ≤5min via WS', async ({ page }) => {
    await page.goto('/?screen=characters');
    await page.getByRole('button', { name: /refresh characters/i }).click();
    await expect(page.getByText(/syncing characters/i)).toBeVisible();
    await page.evaluate(() => (window as any).__TEST__?.emitWsRefresh?.()); // requestId matching
    await expect(page.getByText(/synced/i)).toBeVisible();
  });

  test('@paridade @critico @regressao-esperada refresh timeout 5min libera UI (fix #3)', async ({ page }) => {
    await page.goto('/?screen=characters');
    await page.getByRole('button', { name: /refresh characters/i }).click();
    await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(5 * 60 * 1000 + 1));
    await expect(page.getByText(/timed out/i)).toBeVisible(); // não fica spinner forever
  });

  test('@paridade @critico @offline refresh offline enfileira + retry no reconnect', async ({ page, bridge, client }) => {
    test.skip(client === 'web');
    await bridge.emitOs('offline');
    await page.goto('/?screen=characters');
    await page.getByRole('button', { name: /refresh characters/i }).click();
    expect(await bridge.queueDepth()).toBeGreaterThan(0); // character_refresh pending
    await bridge.emitOs('online'); // processa
  });

  test('@paridade @idempotencia WS tardio com requestId stale é ignorado', async ({ page }) => {
    await page.goto('/?screen=characters');
    const before = await page.evaluate(() => (window as any).__TEST__?.characterCount?.());
    await page.evaluate(() => (window as any).__TEST__?.emitWsRefresh?.('STALE_REQ')); // não-ativo
    const after = await page.evaluate(() => (window as any).__TEST__?.characterCount?.());
    expect(after).toBe(before);
  });

  test('@paridade @critico WS batch suprime toasts locais', async ({ page }) => {
    await page.goto('/?screen=characters&fixture=ws-updating');
    await expect(page.getByText('Character added')).toHaveCount(0); // suprimido durante batch
  });
});
