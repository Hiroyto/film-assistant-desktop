# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 09-save-on-sign-out-local-first.spec.ts >> Save-on-sign-out (local-first) >> @paridade @critico sign-out web simultâneo não afeta desktop (coexistência)
- Location: parity\specs\09-save-on-sign-out-local-first.spec.ts:30:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - generic:
      - status [ref=e9]: Server error
      - status [ref=e15]: error
    - banner [ref=e17]:
      - generic [ref=e18]:
        - generic [ref=e19]:
          - img "Logo" [ref=e21] [cursor=pointer]
          - navigation [ref=e22]:
            - link "App" [ref=e23] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile":
              - /url: "#/profile"
            - link "Pricing":
              - /url: "#/prices"
            - img [ref=e25]
        - generic [ref=e27]:
          - button "filmassistant.io filmassistant.io ▼" [ref=e29] [cursor=pointer]:
            - img "filmassistant.io" [ref=e31]
            - generic: filmassistant.io
            - generic [ref=e32]: ▼
          - generic [ref=e34]:
            - generic [ref=e35]:
              - img [ref=e36]
              - generic [ref=e38]: "0"
            - generic [ref=e39]: Tokens Remaining
          - button [ref=e40]:
            - img [ref=e41]
    - generic [ref=e44]:
      - generic [ref=e45]:
        - generic [ref=e46]:
          - heading "Every Great Story Starts with a Single Spark" [level=1] [ref=e47]:
            - text: Every Great Story Starts
            - text: with a Single Spark
          - paragraph [ref=e48]: Turn a spark into your next project.
          - textbox "Let your creativity flow freely..." [ref=e50]: A detective discovers their partn
          - generic [ref=e51]:
            - button "Build Your Story" [ref=e52] [cursor=pointer]:
              - generic [ref=e53]: Build Your Story
            - generic [ref=e55]: or
            - button "Blank Outline" [ref=e56] [cursor=pointer]
        - button "View Your Stories" [ref=e57] [cursor=pointer]:
          - generic [ref=e58]: View Your Stories
          - img [ref=e59]
      - heading "Continue Building 0 / 5" [level=2] [ref=e63]:
        - text: Continue Building
        - generic [ref=e64]:
          - img [ref=e65]
          - text: 0 / 5
      - contentinfo [ref=e86]:
        - generic [ref=e89]:
          - paragraph [ref=e90]: © 2026 FilmAssistant Inc. All rights reserved.
          - generic [ref=e91]:
            - img [ref=e92]
            - link "accountservices@filmassistant.io" [ref=e94] [cursor=pointer]:
              - /url: mailto:accountservices@filmassistant.io
          - link "Terms of Service" [ref=e95] [cursor=pointer]:
            - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e97]:
    - img [ref=e98]
    - generic [ref=e101]: Synced
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
  27 |     await expect.poll(() => bridge.queueDepth()).toBe(0);
  28 |   });
  29 | 
  30 |   test('@paridade @critico sign-out web simultâneo não afeta desktop (coexistência)', async ({ page, client }) => {
  31 |     test.skip(client === 'web');
  32 |     // desktop tem sessão própria; push segue aceito com seu bearer
  33 |     const res = await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('works'));
> 34 |     expect(res?.success).toBe(true);
     |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  35 |   });
  36 | });
  37 | 
```