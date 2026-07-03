# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 06-stripe-checkout-via-deep-link.spec.ts >> Stripe checkout (deep link + polling) >> @paridade @plataforma Customer Portal abre externo
- Location: parity\specs\06-stripe-checkout-via-deep-link.spec.ts:47:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: /manage subscription/i })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - banner [ref=e6]:
      - generic [ref=e7]:
        - generic [ref=e8]:
          - img "Logo" [ref=e10] [cursor=pointer]
          - navigation [ref=e11]:
            - link "App" [ref=e12] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile" [ref=e13] [cursor=pointer]:
              - /url: "#/profile"
            - link "Pricing" [ref=e14] [cursor=pointer]:
              - /url: "#/prices"
        - generic [ref=e15]:
          - button "filmassistant.io filmassistant.io ▼" [ref=e17] [cursor=pointer]:
            - img "filmassistant.io" [ref=e19]
            - generic: filmassistant.io
            - generic [ref=e20]: ▼
          - generic [ref=e22]:
            - generic [ref=e23]:
              - img [ref=e24]
              - generic [ref=e26]: "250"
            - generic [ref=e27]: Tokens Remaining
          - button [ref=e28]:
            - img [ref=e29]
    - generic [ref=e32]:
      - heading "Profile" [level=1] [ref=e33]
      - generic [ref=e34]:
        - generic [ref=e35]:
          - generic [ref=e36]:
            - generic [ref=e37]:
              - heading [level=2]
              - paragraph [ref=e38]: Member since Invalid Date
            - generic [ref=e39]:
              - button "Manage Membership" [ref=e40] [cursor=pointer]:
                - img [ref=e41]
                - text: Manage Membership
              - button "Privacy Settings" [ref=e43] [cursor=pointer]:
                - img [ref=e44]
                - text: Privacy Settings
          - generic [ref=e47]:
            - generic [ref=e48]:
              - generic [ref=e49]: Email
              - generic [ref=e50]: "-"
            - generic [ref=e51]:
              - generic [ref=e52]: Tokens
              - generic [ref=e53]: "250"
            - generic [ref=e54]:
              - generic [ref=e55]: Subscription
              - generic [ref=e56]: member
            - generic [ref=e57]:
              - generic [ref=e58]: Sign Up Date
              - generic [ref=e59]: "-"
        - heading "My Stories" [level=3] [ref=e62]
    - contentinfo [ref=e63]:
      - generic [ref=e66]:
        - paragraph [ref=e67]: © 2026 FilmAssistant Inc. All rights reserved.
        - generic [ref=e68]:
          - img [ref=e69]
          - link "accountservices@filmassistant.io" [ref=e71] [cursor=pointer]:
            - /url: mailto:accountservices@filmassistant.io
        - link "Terms of Service" [ref=e72] [cursor=pointer]:
          - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e74]:
    - img [ref=e75]
    - generic [ref=e78]: Synced
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
  21 |     await expect(page.getByText(/current plan/i)).toBeVisible(); // member card
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
> 50 |     await page.getByRole('button', { name: /manage subscription/i }).click();
     |                                                                      ^ Error: locator.click: Target page, context or browser has been closed
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