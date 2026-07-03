# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-token-refresh-os-aware.spec.ts >> Token refresh OS-aware >> @paridade @critico @os-lifecycle before-quit drena a sync queue
- Location: parity\specs\02-token-refresh-os-aware.spec.ts:31:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 29
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - status [ref=e9]: error
    - banner [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]:
          - img "Logo" [ref=e15] [cursor=pointer]
          - navigation [ref=e16]:
            - link "App" [ref=e17] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile":
              - /url: "#/profile"
            - link "Pricing":
              - /url: "#/prices"
            - img [ref=e19]
        - generic [ref=e21]:
          - button "filmassistant.io filmassistant.io ▼" [ref=e23] [cursor=pointer]:
            - img "filmassistant.io" [ref=e25]
            - generic: filmassistant.io
            - generic [ref=e26]: ▼
          - generic [ref=e28]:
            - generic [ref=e29]:
              - img [ref=e30]
              - generic [ref=e32]: "0"
            - generic [ref=e33]: Tokens Remaining
          - button [ref=e34]:
            - img [ref=e35]
    - generic [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - heading "Every Great Story Starts with a Single Spark" [level=1] [ref=e41]:
            - text: Every Great Story Starts
            - text: with a Single Spark
          - paragraph [ref=e42]: Turn a spark into your next project.
          - textbox "Let your creativity flow freely..." [ref=e44]: A
          - generic [ref=e45]:
            - button "Build Your Story" [ref=e46] [cursor=pointer]:
              - generic [ref=e47]: Build Your Story
            - generic [ref=e49]: or
            - button "Blank Outline" [ref=e50] [cursor=pointer]
        - button "View Your Stories" [ref=e51] [cursor=pointer]:
          - generic [ref=e52]: View Your Stories
          - img [ref=e53]
      - heading "Continue Building 0 / 5" [level=2] [ref=e57]:
        - text: Continue Building
        - generic [ref=e58]:
          - img [ref=e59]
          - text: 0 / 5
      - contentinfo [ref=e80]:
        - generic [ref=e83]:
          - paragraph [ref=e84]: © 2026 FilmAssistant Inc. All rights reserved.
          - generic [ref=e85]:
            - img [ref=e86]
            - link "accountservices@filmassistant.io" [ref=e88] [cursor=pointer]:
              - /url: mailto:accountservices@filmassistant.io
          - link "Terms of Service" [ref=e89] [cursor=pointer]:
            - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e91]:
    - img [ref=e92]
    - generic [ref=e95]: Synced
```

# Test source

```ts
  1  | // PT-002 — Token refresh OS-aware (AD-03 / BR-MIGRAR-007). Desktop-focused (lifecycle).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Token refresh OS-aware', () => {
  5  |   test.skip(({ client }) => client === 'web', 'OS lifecycle é desktop-only');
  6  | 
  7  |   test('@paridade @critico @os-lifecycle sleep+wake dispara refresh imediato', async ({ page, bridge }) => {
  8  |     await bridge.emitOs('resumed'); // wake após sleep longo (token expirado)
  9  |     // renderer fez fetchAuthSession() e novo token armazenado → save sem 401
  10 |     const ok = await page.evaluate(() => (window as any).__TEST__?.lastTokenRefreshed?.());
  11 |     expect(ok).toBeTruthy();
  12 |   });
  13 | 
  14 |   test('@paridade @critico JIT refresh se token <5min de expirar', async ({ page }) => {
  15 |     await page.evaluate(() => (window as any).__TEST__?.setTokenExpiry?.(4 * 60));
  16 |     await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('user'));
  17 |     const refreshed = await page.evaluate(() => (window as any).__TEST__?.jitRefreshHappened?.());
  18 |     expect(refreshed).toBe(true);
  19 |   });
  20 | 
  21 |   test('@paridade @critico @regressao-esperada 401 vira retry com refresh (tech-debt #17)', async ({ page }) => {
  22 |     await page.route(/\/user/, async (route, req) => {
  23 |       // primeira → 401, segunda → 200 (após refresh)
  24 |       const n = Number((req.headers()['x-test-attempt'] as string) || '0');
  25 |       route.fulfill({ status: n === 0 ? 401 : 200, body: '{}' });
  26 |     });
  27 |     const res = await page.evaluate(() => (window as any).__TEST__?.callSafeApi?.('user'));
  28 |     expect(res?.success).toBe(true); // user não vê erro
  29 |   });
  30 | 
  31 |   test('@paridade @critico @os-lifecycle before-quit drena a sync queue', async ({ bridge }) => {
  32 |     // 5 mutations pendentes → quit → flush imediato → 0 órfãs
  33 |     await bridge.emitOs('before-quit');
> 34 |     expect(await bridge.queueDepth()).toBe(0);
     |                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  35 |   });
  36 | });
  37 | 
```