# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-token-refresh-os-aware.spec.ts >> Token refresh OS-aware >> @paridade @critico @regressao-esperada 401 vira retry com refresh (tech-debt #17)
- Location: parity\specs\02-token-refresh-os-aware.spec.ts:21:7

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
          - textbox "Let your creativity flow freely..." [ref=e50]: A d
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
> 28 |     expect(res?.success).toBe(true); // user não vê erro
     |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  29 |   });
  30 | 
  31 |   test('@paridade @critico @os-lifecycle before-quit drena a sync queue', async ({ bridge }) => {
  32 |     // 5 mutations pendentes → quit → flush imediato → 0 órfãs
  33 |     await bridge.emitOs('before-quit');
  34 |     expect(await bridge.queueDepth()).toBe(0);
  35 |   });
  36 | });
  37 | 
```