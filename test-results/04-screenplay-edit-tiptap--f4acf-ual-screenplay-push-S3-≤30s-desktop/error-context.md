# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04-screenplay-edit-tiptap-and-sync.spec.ts >> Screenplay edit (TipTap) + sync >> @paridade @consistencia-eventual screenplay push S3 ≤30s
- Location: parity\specs\04-screenplay-edit-tiptap-and-sync.spec.ts:48:7

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
  1  | // PT-004 — Screenplay TipTap + local-first sync. RISK-002 canário (cenário 1).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Screenplay edit (TipTap) + sync', () => {
  5  |   test('@paridade @critico TipTap renderiza pagination idêntica à web (RISK-002)', async ({ page }) => {
  6  |     await page.goto('/?screen=scripts&fixture=90-pages');
  7  |     const pages = await page.locator('[data-page]').count();
  8  |     expect(pages).toBeGreaterThan(0); // mesmo nº que a web com o mesmo HTML (comparado entre projetos)
  9  |     // extensions custom ativas (Screenwritingline/KeyboardShortcuts/SafeSelection)
  10 |     await expect(page.locator('.tiptap')).toBeVisible();
  11 |   });
  12 | 
  13 |   test('@paridade @critico typing escreve SQLite debounced (~250ms)', async ({ page, bridge, client }) => {
  14 |     test.skip(client === 'web', 'SQLite é desktop-only');
  15 |     await page.locator('.tiptap').type('INT. HOUSE - DAY');
  16 |     await page.waitForTimeout(300);
  17 |     const row = await bridge.dbGet('SELECT updated_at FROM screenplays ORDER BY updated_at DESC LIMIT 1');
  18 |     expect(row?.updated_at).toBeTruthy();
  19 |     expect(await bridge.queueDepth()).toBeGreaterThan(0); // screenplay.update enfileirado
  20 |   });
  21 | 
  22 |   test('@paridade @critico load priority SQLite > state > S3', async ({ page, client }) => {
  23 |     test.skip(client === 'web', 'prioridade local-first é desktop');
  24 |     await page.goto('/?screen=scripts&fixture=local-vs-s3');
  25 |     await expect(page.locator('.tiptap')).toContainText('local version'); // SQLite vence
  26 |   });
  27 | 
  28 |   test('@paridade @critico inline AI lock + watchdog 120s+grace', async ({ page }) => {
  29 |     await page.goto('/?screen=scripts');
  30 |     await page.locator('.tiptap').selectText?.();
  31 |     await page.getByRole('button', { name: /improve/i }).click();
  32 |     await expect(page.getByTestId('inline-ai-overlay')).toBeVisible(); // editor non-editable
  33 |   });
  34 | 
  35 |   test('@paridade @critico @regressao-esperada watchdog expira ~150s e libera editor (COD-004)', async ({ page }) => {
  36 |     await page.goto('/?screen=scripts&fixture=ai-unresponsive');
  37 |     await page.getByRole('button', { name: /improve/i }).click();
  38 |     await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(150000));
  39 |     await expect(page.getByText(/timed out/i)).toBeVisible(); // editor unlocked
  40 |   });
  41 | 
  42 |   test('@paridade @critico 3-handoff preserva conversation_history', async ({ page }) => {
  43 |     await page.goto('/?screen=scripts&fixture=dirty-segment');
  44 |     const history = await page.evaluate(() => (window as any).__TEST__?.handoffHistories?.());
  45 |     expect(history?.[2]).toEqual(expect.arrayContaining(history?.[0] ?? [])); // h3 contém h1 in-order
  46 |   });
  47 | 
  48 |   test('@paridade @consistencia-eventual screenplay push S3 ≤30s', async ({ bridge, client }) => {
  49 |     test.skip(client === 'web');
> 50 |     expect(await bridge.queueDepth()).toBe(0); // após flush, sync-status-bar = Synced
     |                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  51 |   });
  52 | 
  53 |   test('@paridade dirty-scene extraction antes da AI (BR-037)', async ({ page }) => {
  54 |     let extractedFirst = false;
  55 |     await page.route(/\/scripts/, (route, req) => {
  56 |       if (/scene-extract/.test(req.postData() || '')) extractedFirst = true;
  57 |       route.fulfill({ status: 200, body: '{}' });
  58 |     });
  59 |     await page.goto('/?screen=scripts&fixture=dirty-segment');
  60 |     await page.getByRole('button', { name: /generate full scene/i }).click();
  61 |     expect(extractedFirst).toBe(true);
  62 |   });
  63 | });
  64 | 
```