# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04-screenplay-edit-tiptap-and-sync.spec.ts >> Screenplay edit (TipTap) + sync >> @paridade @critico TipTap renderiza pagination idêntica à web (RISK-002)
- Location: parity\specs\04-screenplay-edit-tiptap-and-sync.spec.ts:5:7

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
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
    - generic [ref=e39]:
      - generic [ref=e41]:
        - generic [ref=e42]:
          - button "Collapse sidebar" [expanded] [ref=e43] [cursor=pointer]:
            - img [ref=e44]
          - generic [ref=e47]: Story Workflow
        - navigation [ref=e48]:
          - generic [ref=e49]:
            - link "Outline" [ref=e50] [cursor=pointer]:
              - /url: "#/home"
              - generic [ref=e51]: Outline
              - img [ref=e52]
            - generic [ref=e54]:
              - button "Story Brainstorming" [ref=e55] [cursor=pointer]:
                - generic [ref=e56]:
                  - img [ref=e58]
                  - generic [ref=e60]: Story Brainstorming
              - button "Story Foundation" [ref=e61] [cursor=pointer]:
                - generic [ref=e62]:
                  - img [ref=e64]
                  - generic [ref=e66]: Story Foundation
              - button "Synopsis" [ref=e67] [cursor=pointer]:
                - generic [ref=e68]:
                  - img [ref=e70]
                  - generic [ref=e72]: Synopsis
          - generic [ref=e73]:
            - link "Scenes" [ref=e74] [cursor=pointer]:
              - /url: "#/scenes"
              - generic [ref=e75]: Scenes
              - img [ref=e76]
            - button "Scenes" [ref=e79] [cursor=pointer]:
              - generic [ref=e80]:
                - img [ref=e82]
                - generic [ref=e84]: Scenes
          - generic [ref=e85]:
            - link "Script" [ref=e86] [cursor=pointer]:
              - /url: "#/scripts"
              - generic [ref=e87]: Script
              - img [ref=e88]
            - button "Scripts" [ref=e92] [cursor=pointer]:
              - generic [ref=e93]:
                - img [ref=e95]
                - generic [ref=e97]: Scripts
          - generic [ref=e98]:
            - generic [ref=e99]: Script Structure
            - generic [ref=e100]:
              - generic [ref=e101]:
                - generic [ref=e103]: Act 1
                - generic [ref=e105]:
                  - button "S1 Introduction and Stasis 0" [ref=e109] [cursor=pointer]:
                    - generic [ref=e110]: S1
                    - generic [ref=e111]: Introduction and Stasis
                    - generic [ref=e112]: "0"
                    - img [ref=e113]
                  - button "S2 Inciting Incident 0" [ref=e117] [cursor=pointer]:
                    - generic [ref=e118]: S2
                    - generic [ref=e119]: Inciting Incident
                    - generic [ref=e120]: "0"
                    - img [ref=e121]
                  - button "S3 Commitment 0" [ref=e125] [cursor=pointer]:
                    - generic [ref=e126]: S3
                    - generic [ref=e127]: Commitment
                    - generic [ref=e128]: "0"
                    - img [ref=e129]
              - generic [ref=e131]:
                - generic [ref=e133]: Act 2
                - generic [ref=e135]:
                  - button "S4 First Pinch Point 0" [ref=e139] [cursor=pointer]:
                    - generic [ref=e140]: S4
                    - generic [ref=e141]: First Pinch Point
                    - generic [ref=e142]: "0"
                    - img [ref=e143]
                  - button "S5 Midpoint 0" [ref=e147] [cursor=pointer]:
                    - generic [ref=e148]: S5
                    - generic [ref=e149]: Midpoint
                    - generic [ref=e150]: "0"
                    - img [ref=e151]
                  - button "S6 Second Pinch Point 0" [ref=e155] [cursor=pointer]:
                    - generic [ref=e156]: S6
                    - generic [ref=e157]: Second Pinch Point
                    - generic [ref=e158]: "0"
                    - img [ref=e159]
              - generic [ref=e161]:
                - generic [ref=e163]: Act 3
                - generic [ref=e165]:
                  - button "S7 Second Plot Point 0" [ref=e169] [cursor=pointer]:
                    - generic [ref=e170]: S7
                    - generic [ref=e171]: Second Plot Point
                    - generic [ref=e172]: "0"
                    - img [ref=e173]
                  - button "S8 Climax 0" [ref=e177] [cursor=pointer]:
                    - generic [ref=e178]: S8
                    - generic [ref=e179]: Climax
                    - generic [ref=e180]: "0"
                    - img [ref=e181]
                  - button "S9 Resolution 0" [ref=e185] [cursor=pointer]:
                    - generic [ref=e186]: S9
                    - generic [ref=e187]: Resolution
                    - generic [ref=e188]: "0"
                    - img [ref=e189]
      - main [ref=e191]:
        - generic [ref=e194]:
          - generic: Saved
          - generic [ref=e199]:
            - generic [ref=e200]:
              - generic [ref=e203]:
                - generic [ref=e204]:
                  - generic "slugline (Ctrl+K, 1)" [ref=e205] [cursor=pointer]:
                    - generic [ref=e206]: slugline
                  - generic "action (Ctrl+K, 2)" [ref=e207] [cursor=pointer]:
                    - generic [ref=e208]: action
                  - generic "character (Ctrl+K, 3)" [ref=e209] [cursor=pointer]:
                    - generic [ref=e210]: character
                  - generic "dialogue (Ctrl+K, 4)" [ref=e211] [cursor=pointer]:
                    - generic [ref=e212]: dialogue
                  - generic "parenthetical (Ctrl+K, 5)" [ref=e213] [cursor=pointer]:
                    - generic [ref=e214]: parenthetical
                  - generic "transition (Ctrl+K, 6)" [ref=e215] [cursor=pointer]:
                    - generic [ref=e216]: transition
                  - generic "Format palette (Ctrl+K)" [ref=e217] [cursor=pointer]:
                    - generic [ref=e218]: ⌘K
                - generic [ref=e219]:
                  - generic "Switch to Light Theme" [ref=e220] [cursor=pointer]:
                    - img [ref=e221]
                  - generic "Enter Fullscreen" [ref=e227] [cursor=pointer]:
                    - img [ref=e228]
                  - generic "Save Script (Ctrl+S)" [ref=e233] [cursor=pointer]:
                    - img [ref=e234]
              - generic [ref=e240]:
                - generic: "1"
                - paragraph [ref=e243]
            - generic [ref=e245]:
              - button "Hide tools" [ref=e247] [cursor=pointer]:
                - img [ref=e248]
                - img [ref=e250]
              - generic [ref=e253]:
                - button [ref=e256] [cursor=pointer]:
                  - img [ref=e257]
                - button [ref=e263] [cursor=pointer]:
                  - img [ref=e264]
                - button [ref=e270] [cursor=pointer]:
                  - img [ref=e271]
                - button [ref=e276] [cursor=pointer]:
                  - img [ref=e277]
                - button [ref=e284] [cursor=pointer]:
                  - img [ref=e285]
  - status "All changes saved locally and synced to cloud." [ref=e289]:
    - img [ref=e290]
    - generic [ref=e293]: Synced
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
> 8  |     expect(pages).toBeGreaterThan(0); // mesmo nº que a web com o mesmo HTML (comparado entre projetos)
     |                   ^ Error: expect(received).toBeGreaterThan(expected)
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