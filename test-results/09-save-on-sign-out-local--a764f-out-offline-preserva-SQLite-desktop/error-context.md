# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 09-save-on-sign-out-local-first.spec.ts >> Save-on-sign-out (local-first) >> @paridade @critico @regressao-esperada sign-out offline preserva SQLite
- Location: parity\specs\09-save-on-sign-out-local-first.spec.ts:13:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: /sign out/i })

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
              - generic [ref=e26]: "0"
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
              - generic [ref=e53]: "-"
            - generic [ref=e54]:
              - generic [ref=e55]: Subscription
              - generic [ref=e56]: "-"
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
  - status "Pending mutations being pushed to cloud." [ref=e74]:
    - img [ref=e75]
    - generic [ref=e80]: Syncing 3 changes…
    - button "Retry sync" [ref=e81] [cursor=pointer]
```

# Test source

```ts
  1  | // PT-009 — Save-on-sign-out local-first (BR-MIGRAR-008).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Save-on-sign-out (local-first)', () => {
  5  |   test('@paridade @critico sign-out aguarda flush completo da queue', async ({ page, bridge, client }) => {
  6  |     await page.goto('/?screen=profile&fixture=3-pending');
  7  |     await page.getByRole('button', { name: /sign out/i }).click();
  8  |     await expect(page.getByText(/syncing changes before sign out/i)).toBeVisible();
  9  |     if (client === 'desktop') await expect.poll(() => bridge.queueDepth()).toBe(0);
  10 |     await expect(page).toHaveURL(/login/);
  11 |   });
  12 | 
  13 |   test('@paridade @critico @regressao-esperada sign-out offline preserva SQLite', async ({ page, bridge, client }) => {
  14 |     test.skip(client === 'web');
  15 |     await bridge.emitOs('offline');
  16 |     await page.goto('/?screen=profile&fixture=3-pending');
> 17 |     await page.getByRole('button', { name: /sign out/i }).click();
     |                                                           ^ Error: locator.click: Target page, context or browser has been closed
  18 |     await expect(page.getByText(/sign out anyway/i)).toBeVisible();
  19 |     await page.getByRole('button', { name: /sign out anyway/i }).click();
  20 |     // token invalidado MAS sync_queue + SQLite preservados
  21 |     expect(await bridge.queueDepth()).toBeGreaterThan(0);
  22 |   });
  23 | 
  24 |   test('@paridade @critico @os-lifecycle Cmd+Q dispara mesma proteção', async ({ bridge, client }) => {
  25 |     test.skip(client === 'web');
  26 |     await bridge.emitOs('before-quit');
  27 |     await expect.poll(() => bridge.queueDepth()).toBe(0);
  28 |   });
  29 | 
  30 |   test('@paridade @critico sign-out web simultâneo não afeta desktop (coexistência)', async ({ page, client }) => {
  31 |     test.skip(client === 'web');
  32 |     // desktop tem sessão própria; push segue aceito com seu bearer
  33 |     const res = await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('works'));
  34 |     expect(res?.success).toBe(true);
  35 |   });
  36 | });
  37 | 
```