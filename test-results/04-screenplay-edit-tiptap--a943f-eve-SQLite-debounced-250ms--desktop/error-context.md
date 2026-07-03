# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04-screenplay-edit-tiptap-and-sync.spec.ts >> Screenplay edit (TipTap) + sync >> @paridade @critico typing escreve SQLite debounced (~250ms)
- Location: parity\specs\04-screenplay-edit-tiptap-and-sync.spec.ts:13:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.type: Target page, context or browser has been closed
Call log:
  - waiting for locator('.tiptap')

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
          - textbox "Let your creativity flow freely..." [ref=e38]: A chef inherits a restaurant with a magica
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
> 15 |     await page.locator('.tiptap').type('INT. HOUSE - DAY');
     |                                   ^ Error: locator.type: Target page, context or browser has been closed
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
  50 |     expect(await bridge.queueDepth()).toBe(0); // após flush, sync-status-bar = Synced
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