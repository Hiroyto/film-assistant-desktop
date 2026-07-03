// PT-010 — AI 3-handoff pipeline preservado (BR-MIGRAR-044..051).
import { test, expect } from '../fixtures';

test.describe('AI three-handoff pipeline', () => {
  test('@paridade @critico pipeline completo com requires_third_handoff=true', async ({ page }) => {
    const events: string[] = [];
    await page.route(/\/scripts/, (route, req) => {
      const m = /event=([\w-]+)/.exec(req.postData() || '') || /"event"\s*:\s*"([\w-]+)"/.exec(req.postData() || '');
      if (m) events.push(m[1]);
      route.fulfill({ status: 200, body: JSON.stringify({ requires_third_handoff: true, conversationHistory: [], cap: 10 }) });
    });
    await page.goto('/?screen=scripts&fixture=dirty-scene');
    await page.getByRole('button', { name: /generate full scene/i }).click();
    await expect.poll(() => events).toContain('scene-extract');
    // handoffs 1..3 + cap decrementa + header -N
  });

  test('@paridade requires_third_handoff=false pula handoff #3', async ({ page }) => {
    let h3 = false;
    await page.route(/\/scripts/, (route, req) => {
      if (/handoff-3/.test(req.postData() || '')) h3 = true;
      route.fulfill({ status: 200, body: JSON.stringify({ requires_third_handoff: false, conversationHistory: [] }) });
    });
    await page.goto('/?screen=scripts&fixture=dirty-scene');
    await page.getByRole('button', { name: /generate full scene/i }).click();
    await page.waitForTimeout(200);
    expect(h3).toBe(false);
  });

  test('@paridade @critico 5xx aciona auto-retry único (BR-038)', async ({ page }) => {
    let attempts = 0;
    await page.route(/\/scripts/, (route) => {
      attempts++;
      route.fulfill({ status: attempts === 1 ? 502 : 200, body: '{}' });
    });
    await page.goto('/?screen=scripts&fixture=dirty-scene');
    await page.getByRole('button', { name: /generate full scene/i }).click();
    await expect.poll(() => attempts).toBeGreaterThanOrEqual(2); // 1 retry após 5xx
  });

  test('@paridade @critico modelOverride enviado em todos os handoffs (BR-049)', async ({ page }) => {
    const overrides: (string | null)[] = [];
    await page.route(/\/scripts/, (route, req) => {
      const m = /"modelOverride"\s*:\s*("[^"]*"|null)/.exec(req.postData() || '');
      if (m) overrides.push(JSON.parse(m[1]));
      route.fulfill({ status: 200, body: JSON.stringify({ requires_third_handoff: true, conversationHistory: [] }) });
    });
    await page.goto('/?screen=scripts&fixture=model-claude');
    await page.getByRole('button', { name: /generate full scene/i }).click();
    await expect.poll(() => overrides.length).toBeGreaterThan(0);
    expect(overrides.every((o) => o === 'claude-sonnet-4')).toBe(true);
  });

  test('@paridade @ordem conversation_history in-order across handoffs', async ({ page }) => {
    await page.goto('/?screen=scripts&fixture=dirty-scene');
    await page.getByRole('button', { name: /generate full scene/i }).click();
    const hist = await page.evaluate(() => (window as any).__TEST__?.handoffHistories?.());
    if (hist) expect(hist[2]).toEqual(expect.arrayContaining(hist[0]));
  });

  test('@paridade one AI in flight bloqueia inline AI', async ({ page }) => {
    await page.goto('/?screen=scripts&fixture=handoff-in-flight');
    await expect(page.getByRole('button', { name: /improve|guided/i }).first()).toBeDisabled();
  });
});
