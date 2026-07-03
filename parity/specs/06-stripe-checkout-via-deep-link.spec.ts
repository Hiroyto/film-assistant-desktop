// PT-006 — Stripe checkout via deep link + polling (AD-04 / RISK-006 / DEV-010).
import { test, expect } from '../fixtures';

test.describe('Stripe checkout (deep link + polling)', () => {
  test('@paridade @critico @plataforma Subscribe abre Stripe externo + inicia polling', async ({ page, client }) => {
    await page.goto('/?screen=pricing');
    await page.route(/\/checkout/, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ headers: { Location: 'https://checkout.stripe.com/c/pay/cs_x' } }) }),
    );
    await page.getByRole('button', { name: /subscribe/i }).first().click();
    if (client === 'desktop') {
      const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
      expect(opened).toContain('checkout.stripe.com');
    }
  });

  test('@paridade @critico @plataforma deep link success atualiza subscription', async ({ page, bridge, client }) => {
    test.skip(client === 'web', 'deep link é desktop-only');
    await page.goto('/?screen=pricing');
    await bridge.emitDeepLink('filmassistant://stripe/success?session_id=cs_x');
    await expect(page.getByText(/current plan/i)).toBeVisible(); // member card
  });

  test('@paridade @critico @plataforma @regressao-esperada polling fallback pega webhook', async ({ page, client }) => {
    test.skip(client === 'web');
    await page.goto('/?screen=pricing&fixture=webhook-arrived-no-deeplink');
    await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(5000)); // 2º polling tick
    await expect(page.getByText(/current plan/i)).toBeVisible();
  });

  test('@paridade deep link cancel não afeta subscription', async ({ page, bridge, client }) => {
    test.skip(client === 'web');
    await bridge.emitDeepLink('filmassistant://stripe/cancel');
    await expect(page.getByText(/cancelled/i)).toBeVisible();
  });

  test('@paridade @critico Refill gated em member', async ({ page }) => {
    await page.goto('/?screen=pricing&fixture=free');
    await expect(page.getByText(/member access only/i)).toBeVisible();
  });

  test('@paridade Current Plan disabled quando já member', async ({ page }) => {
    await page.goto('/?screen=pricing&fixture=member');
    await expect(page.getByRole('button', { name: /current plan/i })).toBeDisabled();
  });

  test('@paridade @plataforma Customer Portal abre externo', async ({ page, client }) => {
    test.skip(client === 'web');
    await page.goto('/?screen=profile&fixture=member');
    await page.getByRole('button', { name: /manage subscription/i }).click();
    const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
    expect(opened).toBeTruthy();
  });

  test('@paridade refill price $4.50 canônico (DEC-011)', async ({ page }) => {
    await page.goto('/?screen=pricing&fixture=member');
    await expect(page.getByText('$4.50')).toBeVisible();
    await expect(page.getByText('$5.00')).toHaveCount(0);
  });

  test('@paridade @consistencia-eventual header overlay +N após success', async ({ page }) => {
    await page.goto('/?fixture=cap-100');
    await page.evaluate(() => (window as any).__TEST__?.applyUser?.({ cap: 500 }));
    await expect(page.getByText('+400')).toBeVisible();
  });
});
