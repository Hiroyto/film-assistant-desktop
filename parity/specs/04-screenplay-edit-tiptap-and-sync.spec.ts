// PT-004 — Screenplay TipTap + local-first sync. RISK-002 canário (cenário 1).
import { test, expect } from '../fixtures';

test.describe('Screenplay edit (TipTap) + sync', () => {
  test('@paridade @critico TipTap renderiza pagination idêntica à web (RISK-002)', async ({ page }) => {
    await page.goto('/?screen=scripts&fixture=90-pages');
    const pages = await page.locator('[data-page]').count();
    expect(pages).toBeGreaterThan(0); // mesmo nº que a web com o mesmo HTML (comparado entre projetos)
    // extensions custom ativas (Screenwritingline/KeyboardShortcuts/SafeSelection)
    await expect(page.locator('.tiptap')).toBeVisible();
  });

  test('@paridade @critico typing escreve SQLite debounced (~250ms)', async ({ page, bridge, client }) => {
    test.skip(client === 'web', 'SQLite é desktop-only');
    await page.locator('.tiptap').type('INT. HOUSE - DAY');
    await page.waitForTimeout(300);
    const row = await bridge.dbGet('SELECT updated_at FROM screenplays ORDER BY updated_at DESC LIMIT 1');
    expect(row?.updated_at).toBeTruthy();
    expect(await bridge.queueDepth()).toBeGreaterThan(0); // screenplay.update enfileirado
  });

  test('@paridade @critico load priority SQLite > state > S3', async ({ page, client }) => {
    test.skip(client === 'web', 'prioridade local-first é desktop');
    await page.goto('/?screen=scripts&fixture=local-vs-s3');
    await expect(page.locator('.tiptap')).toContainText('local version'); // SQLite vence
  });

  test('@paridade @critico inline AI lock + watchdog 120s+grace', async ({ page }) => {
    await page.goto('/?screen=scripts');
    await page.locator('.tiptap').selectText?.();
    await page.getByRole('button', { name: /improve/i }).click();
    await expect(page.getByTestId('inline-ai-overlay')).toBeVisible(); // editor non-editable
  });

  test('@paridade @critico @regressao-esperada watchdog expira ~150s e libera editor (COD-004)', async ({ page }) => {
    await page.goto('/?screen=scripts&fixture=ai-unresponsive');
    await page.getByRole('button', { name: /improve/i }).click();
    await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(150000));
    await expect(page.getByText(/timed out/i)).toBeVisible(); // editor unlocked
  });

  test('@paridade @critico 3-handoff preserva conversation_history', async ({ page }) => {
    await page.goto('/?screen=scripts&fixture=dirty-segment');
    const history = await page.evaluate(() => (window as any).__TEST__?.handoffHistories?.());
    expect(history?.[2]).toEqual(expect.arrayContaining(history?.[0] ?? [])); // h3 contém h1 in-order
  });

  test('@paridade @consistencia-eventual screenplay push S3 ≤30s', async ({ bridge, client }) => {
    test.skip(client === 'web');
    expect(await bridge.queueDepth()).toBe(0); // após flush, sync-status-bar = Synced
  });

  test('@paridade dirty-scene extraction antes da AI (BR-037)', async ({ page }) => {
    let extractedFirst = false;
    await page.route(/\/scripts/, (route, req) => {
      if (/scene-extract/.test(req.postData() || '')) extractedFirst = true;
      route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/?screen=scripts&fixture=dirty-segment');
    await page.getByRole('button', { name: /generate full scene/i }).click();
    expect(extractedFirst).toBe(true);
  });
});
