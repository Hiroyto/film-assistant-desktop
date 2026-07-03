# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 09-save-on-sign-out-local-first.spec.ts >> Save-on-sign-out (local-first) >> @paridade @critico @os-lifecycle Cmd+Q dispara mesma proteção
- Location: parity\specs\09-save-on-sign-out-local-first.spec.ts:24:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 57

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - banner [ref=e5]:
      - generic [ref=e6]:
        - generic [ref=e7]:
          - img "Logo" [ref=e9] [cursor=pointer]
          - navigation [ref=e10]:
            - link "App" [ref=e11] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile":
              - /url: "#/profile"
            - link "Pricing":
              - /url: "#/prices"
            - img [ref=e13]
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
      - generic [ref=e33]:
        - generic [ref=e34]:
          - heading "Every Great Story Starts with a Single Spark" [level=1] [ref=e35]:
            - text: Every Great Story Starts
            - text: with a Single Spark
          - paragraph [ref=e36]: Turn a spark into your next project.
          - textbox "Let your creativity flow freely..." [ref=e38]: A detective discovers their partner is the serial killer they've been hunting...
          - generic [ref=e39]:
            - button "Build Your Story" [ref=e40] [cursor=pointer]:
              - generic [ref=e41]: Build Your Story
            - generic [ref=e43]: or
            - button "Blank Outline" [ref=e44] [cursor=pointer]
        - button "View Your Stories" [ref=e45] [cursor=pointer]:
          - generic [ref=e46]: View Your Stories
          - img [ref=e47]
      - heading "Continue Building 0 / 5" [level=2] [ref=e51]:
        - text: Continue Building
        - generic [ref=e52]:
          - img [ref=e53]
          - text: 0 / 5
      - contentinfo [ref=e74]:
        - generic [ref=e77]:
          - paragraph [ref=e78]: © 2026 FilmAssistant Inc. All rights reserved.
          - generic [ref=e79]:
            - img [ref=e80]
            - link "accountservices@filmassistant.io" [ref=e82] [cursor=pointer]:
              - /url: mailto:accountservices@filmassistant.io
          - link "Terms of Service" [ref=e83] [cursor=pointer]:
            - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e85]:
    - img [ref=e86]
    - generic [ref=e89]: Synced
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
  17 |     await page.getByRole('button', { name: /sign out/i }).click();
  18 |     await expect(page.getByText(/sign out anyway/i)).toBeVisible();
  19 |     await page.getByRole('button', { name: /sign out anyway/i }).click();
  20 |     // token invalidado MAS sync_queue + SQLite preservados
  21 |     expect(await bridge.queueDepth()).toBeGreaterThan(0);
  22 |   });
  23 | 
  24 |   test('@paridade @critico @os-lifecycle Cmd+Q dispara mesma proteção', async ({ bridge, client }) => {
  25 |     test.skip(client === 'web');
  26 |     await bridge.emitOs('before-quit');
> 27 |     await expect.poll(() => bridge.queueDepth()).toBe(0);
     |                                                  ^ Error: expect(received).toBe(expected) // Object.is equality
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