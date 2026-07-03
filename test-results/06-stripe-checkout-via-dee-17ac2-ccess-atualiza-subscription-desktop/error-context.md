# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 06-stripe-checkout-via-deep-link.spec.ts >> Stripe checkout (deep link + polling) >> @paridade @critico @plataforma deep link success atualiza subscription
- Location: parity\specs\06-stripe-checkout-via-deep-link.spec.ts:17:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/current plan/i)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/current plan/i)

```

```yaml
- banner:
  - img "Logo"
  - navigation:
    - link "App":
      - /url: "#/dashboard"
    - link "Profile":
      - /url: "#/profile"
    - link "Pricing":
      - /url: "#/prices"
  - button "filmassistant.io filmassistant.io ▼":
    - img "filmassistant.io"
    - text: filmassistant.io ▼
  - img
  - text: 0 Tokens Remaining
  - button:
    - img
- heading "Choose Your Plan" [level=1]
- text: Most Popular
- heading "Member" [level=2]
- text: $8.00 /month
- list:
  - listitem:
    - img
    - text: ~750 generations per month
  - listitem:
    - img
    - text: Access to Community
  - listitem:
    - img
    - text: Participate in Weekly Contests
  - listitem:
    - img
    - text: Better Rate on Tokens
  - listitem:
    - img
    - text: Cheaper Token Refills
- button "Buy Plan"
- heading "Base Token Package" [level=2]
- text: $12.00 one-time
- list:
  - listitem:
    - img
    - text: ~750 generations
  - listitem:
    - img
    - text: Create more stories
  - listitem:
    - img
    - text: Create more summaries
  - listitem:
    - img
    - text: One time purchase
- button "Buy Tokens"
- heading "Member Token Refill" [level=2]
- text: $4.50 refill
- list:
  - listitem:
    - img
    - text: ~750 generations
  - listitem:
    - img
    - text: Member discount applied
  - listitem:
    - img
    - text: One time purchase
  - listitem:
    - img
    - text: Member access only
- button "Member Access Only" [disabled]
- contentinfo:
  - paragraph: © 2026 FilmAssistant Inc. All rights reserved.
  - img
  - link "accountservices@filmassistant.io":
    - /url: mailto:accountservices@filmassistant.io
  - link "Terms of Service":
    - /url: https://app.getterms.io/view/RRt2r/tos/en-us
- status "All changes saved locally and synced to cloud.":
  - img
  - text: Synced
```

# Test source

```ts
  1  | // PT-006 — Stripe checkout via deep link + polling (AD-04 / RISK-006 / DEV-010).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Stripe checkout (deep link + polling)', () => {
  5  |   test('@paridade @critico @plataforma Subscribe abre Stripe externo + inicia polling', async ({ page, client }) => {
  6  |     await page.goto('/?screen=pricing');
  7  |     await page.route(/\/checkout/, (route) =>
  8  |       route.fulfill({ status: 200, body: JSON.stringify({ headers: { Location: 'https://checkout.stripe.com/c/pay/cs_x' } }) }),
  9  |     );
  10 |     await page.getByRole('button', { name: /subscribe/i }).first().click();
  11 |     if (client === 'desktop') {
  12 |       const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
  13 |       expect(opened).toContain('checkout.stripe.com');
  14 |     }
  15 |   });
  16 | 
  17 |   test('@paridade @critico @plataforma deep link success atualiza subscription', async ({ page, bridge, client }) => {
  18 |     test.skip(client === 'web', 'deep link é desktop-only');
  19 |     await page.goto('/?screen=pricing');
  20 |     await bridge.emitDeepLink('filmassistant://stripe/success?session_id=cs_x');
> 21 |     await expect(page.getByText(/current plan/i)).toBeVisible(); // member card
     |                                                   ^ Error: expect(locator).toBeVisible() failed
  22 |   });
  23 | 
  24 |   test('@paridade @critico @plataforma @regressao-esperada polling fallback pega webhook', async ({ page, client }) => {
  25 |     test.skip(client === 'web');
  26 |     await page.goto('/?screen=pricing&fixture=webhook-arrived-no-deeplink');
  27 |     await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(5000)); // 2º polling tick
  28 |     await expect(page.getByText(/current plan/i)).toBeVisible();
  29 |   });
  30 | 
  31 |   test('@paridade deep link cancel não afeta subscription', async ({ page, bridge, client }) => {
  32 |     test.skip(client === 'web');
  33 |     await bridge.emitDeepLink('filmassistant://stripe/cancel');
  34 |     await expect(page.getByText(/cancelled/i)).toBeVisible();
  35 |   });
  36 | 
  37 |   test('@paridade @critico Refill gated em member', async ({ page }) => {
  38 |     await page.goto('/?screen=pricing&fixture=free');
  39 |     await expect(page.getByText(/member access only/i)).toBeVisible();
  40 |   });
  41 | 
  42 |   test('@paridade Current Plan disabled quando já member', async ({ page }) => {
  43 |     await page.goto('/?screen=pricing&fixture=member');
  44 |     await expect(page.getByRole('button', { name: /current plan/i })).toBeDisabled();
  45 |   });
  46 | 
  47 |   test('@paridade @plataforma Customer Portal abre externo', async ({ page, client }) => {
  48 |     test.skip(client === 'web');
  49 |     await page.goto('/?screen=profile&fixture=member');
  50 |     await page.getByRole('button', { name: /manage subscription/i }).click();
  51 |     const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
  52 |     expect(opened).toBeTruthy();
  53 |   });
  54 | 
  55 |   test('@paridade refill price $4.50 canônico (DEC-011)', async ({ page }) => {
  56 |     await page.goto('/?screen=pricing&fixture=member');
  57 |     await expect(page.getByText('$4.50')).toBeVisible();
  58 |     await expect(page.getByText('$5.00')).toHaveCount(0);
  59 |   });
  60 | 
  61 |   test('@paridade @consistencia-eventual header overlay +N após success', async ({ page }) => {
  62 |     await page.goto('/?fixture=cap-100');
  63 |     await page.evaluate(() => (window as any).__TEST__?.applyUser?.({ cap: 500 }));
  64 |     await expect(page.getByText('+400')).toBeVisible();
  65 |   });
  66 | });
  67 | 
```