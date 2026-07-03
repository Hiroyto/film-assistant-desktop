# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-story-create-edit-save-local-first.spec.ts >> Story create + edit + save (local-first) >> @paridade @critico criar story persiste em SQLite imediatamente
- Location: parity\specs\03-story-create-edit-save-local-first.spec.ts:6:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.fill: Target page, context or browser has been closed
Call log:
  - waiting for getByLabel(/brainstorm/i)

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
  1  | // PT-003 — Story create/edit/save local-first (AD-01 / BR-MIGRAR-009..017,053).
  2  | // RISK-011: preservação de scenes no switch de página é o cenário crítico.
  3  | import { test, expect } from '../fixtures';
  4  | 
  5  | test.describe('Story create + edit + save (local-first)', () => {
  6  |   test('@paridade @critico criar story persiste em SQLite imediatamente', async ({ page, bridge, client }) => {
> 7  |     await page.getByLabel(/brainstorm/i).fill('x'.repeat(60));
     |                                          ^ Error: locator.fill: Target page, context or browser has been closed
  8  |     await page.getByRole('button', { name: /build your story/i }).click();
  9  |     if (client === 'desktop') {
  10 |       const row = await bridge.dbGet('SELECT story_id, synced_at FROM stories ORDER BY created_at DESC LIMIT 1');
  11 |       expect(row?.story_id).toMatch(/^story_\d+_[a-z0-9]{6}$/);
  12 |       expect(row?.synced_at).toBeNull(); // ainda não sincronizado
  13 |       expect(await bridge.queueDepth()).toBeGreaterThan(0); // entry story.create enfileirada
  14 |     }
  15 |     await expect(page).toHaveURL(/foundation/);
  16 |   });
  17 | 
  18 |   test('@paridade @critico editar foundation → debounce 10s + write local', async ({ page, bridge, client }) => {
  19 |     await page.getByLabel(/genre/i).fill('Drama'); // React state imediato
  20 |     if (client === 'desktop') {
  21 |       // após 10s sem digitar, stories.genre = Drama
  22 |       await page.waitForTimeout(10500);
  23 |       const row = await bridge.dbGet('SELECT genre FROM stories ORDER BY updated_at DESC LIMIT 1');
  24 |       expect(row?.genre).toBe('Drama');
  25 |     }
  26 |   });
  27 | 
  28 |   test('@paridade @critico AI response força immediate save', async ({ page, bridge, client }) => {
  29 |     await page.getByRole('button', { name: /generate synopsis/i }).click();
  30 |     // backend retorna SUM → force=true grava SQLite e flush imediato
  31 |     if (client === 'desktop') {
  32 |       const row = await bridge.dbGet('SELECT synopsis FROM stories ORDER BY updated_at DESC LIMIT 1');
  33 |       expect(row?.synopsis).toBeTruthy();
  34 |     }
  35 |   });
  36 | 
  37 |   test('@paridade @critico @regressao-esperada switch de página preserva scenes (fix tech-debt #1)', async ({
  38 |     page,
  39 |     bridge,
  40 |     client,
  41 |   }) => {
  42 |     test.skip(client === 'web', 'observa segments_json via SQLite');
  43 |     // S5 tem { S, scenes:[scene1,scene2] }; navega Profile e volta → scenes intactas
  44 |     await page.goto('/?screen=scenes&segment=S5&fixture=two-scenes');
  45 |     await page.goto('/?screen=profile');
  46 |     await page.goto('/?screen=outline');
  47 |     const row = await bridge.dbGet('SELECT segments_json FROM stories ORDER BY updated_at DESC LIMIT 1');
  48 |     const segs = JSON.parse(row.segments_json);
  49 |     expect(segs.S5.scenes).toHaveLength(2); // nenhum save reduziu a scalar
  50 |   });
  51 | 
  52 |   test('@paridade @critico STORIES_LIMIT 5 bloqueia criação (DEC-009)', async ({ page }) => {
  53 |     await page.goto('/?fixture=five-stories');
  54 |     await page.getByLabel(/brainstorm/i).fill('x'.repeat(60));
  55 |     await page.getByRole('button', { name: /build your story/i }).click();
  56 |     await expect(page.getByText(/storage limit reached|limit/i)).toBeVisible();
  57 |   });
  58 | 
  59 |   test('@paridade @critico one AI in flight bloqueia geração concorrente', async ({ page }) => {
  60 |     await page.goto('/?fixture=generating');
  61 |     await expect(page.getByRole('button', { name: /generate/i }).first()).toBeDisabled();
  62 |   });
  63 | 
  64 |   test('@paridade @ordem ordem de mutations preservada por entidade', async ({ page, bridge, client }) => {
  65 |     test.skip(client === 'web', 'ordem observada no backend mock');
  66 |     // brainstorm < G < S1 em sequência rápida → backend recebe nessa ordem
  67 |     const order: string[] = await page.evaluate(() => (window as any).__TEST__?.capturedPushOrder?.() ?? []);
  68 |     expect(order).toEqual([...order].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  69 |   });
  70 | });
  71 | 
```