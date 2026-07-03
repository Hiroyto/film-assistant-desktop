# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 10-ai-three-handoff-pipeline.spec.ts >> AI three-handoff pipeline >> @paridade @critico modelOverride enviado em todos os handoffs (BR-049)
- Location: parity\specs\10-ai-three-handoff-pipeline.spec.ts:41:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: /generate full scene/i })

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
    - generic [ref=e33]:
      - generic [ref=e35]:
        - generic [ref=e36]:
          - button "Collapse sidebar" [expanded] [ref=e37] [cursor=pointer]:
            - img [ref=e38]
          - generic [ref=e41]: Story Workflow
        - navigation [ref=e42]:
          - generic [ref=e43]:
            - link "Outline" [ref=e44] [cursor=pointer]:
              - /url: "#/home"
              - generic [ref=e45]: Outline
              - img [ref=e46]
            - generic [ref=e48]:
              - button "Story Brainstorming" [ref=e49] [cursor=pointer]:
                - generic [ref=e50]:
                  - img [ref=e52]
                  - generic [ref=e54]: Story Brainstorming
              - button "Story Foundation" [ref=e55] [cursor=pointer]:
                - generic [ref=e56]:
                  - img [ref=e58]
                  - generic [ref=e60]: Story Foundation
              - button "Synopsis" [ref=e61] [cursor=pointer]:
                - generic [ref=e62]:
                  - img [ref=e64]
                  - generic [ref=e66]: Synopsis
          - generic [ref=e67]:
            - link "Scenes" [ref=e68] [cursor=pointer]:
              - /url: "#/scenes"
              - generic [ref=e69]: Scenes
              - img [ref=e70]
            - button "Scenes" [ref=e73] [cursor=pointer]:
              - generic [ref=e74]:
                - img [ref=e76]
                - generic [ref=e78]: Scenes
          - generic [ref=e79]:
            - link "Script" [ref=e80] [cursor=pointer]:
              - /url: "#/scripts"
              - generic [ref=e81]: Script
              - img [ref=e82]
            - button "Scripts" [ref=e86] [cursor=pointer]:
              - generic [ref=e87]:
                - img [ref=e89]
                - generic [ref=e91]: Scripts
          - generic [ref=e92]:
            - generic [ref=e93]: Script Structure
            - generic [ref=e94]:
              - generic [ref=e95]:
                - generic [ref=e97]: Act 1
                - generic [ref=e99]:
                  - button "S1 Introduction and Stasis 0" [ref=e103] [cursor=pointer]:
                    - generic [ref=e104]: S1
                    - generic [ref=e105]: Introduction and Stasis
                    - generic [ref=e106]: "0"
                    - img [ref=e107]
                  - button "S2 Inciting Incident 0" [ref=e111] [cursor=pointer]:
                    - generic [ref=e112]: S2
                    - generic [ref=e113]: Inciting Incident
                    - generic [ref=e114]: "0"
                    - img [ref=e115]
                  - button "S3 Commitment 0" [ref=e119] [cursor=pointer]:
                    - generic [ref=e120]: S3
                    - generic [ref=e121]: Commitment
                    - generic [ref=e122]: "0"
                    - img [ref=e123]
              - generic [ref=e125]:
                - generic [ref=e127]: Act 2
                - generic [ref=e129]:
                  - button "S4 First Pinch Point 0" [ref=e133] [cursor=pointer]:
                    - generic [ref=e134]: S4
                    - generic [ref=e135]: First Pinch Point
                    - generic [ref=e136]: "0"
                    - img [ref=e137]
                  - button "S5 Midpoint 0" [ref=e141] [cursor=pointer]:
                    - generic [ref=e142]: S5
                    - generic [ref=e143]: Midpoint
                    - generic [ref=e144]: "0"
                    - img [ref=e145]
                  - button "S6 Second Pinch Point 0" [ref=e149] [cursor=pointer]:
                    - generic [ref=e150]: S6
                    - generic [ref=e151]: Second Pinch Point
                    - generic [ref=e152]: "0"
                    - img [ref=e153]
              - generic [ref=e155]:
                - generic [ref=e157]: Act 3
                - generic [ref=e159]:
                  - button "S7 Second Plot Point 0" [ref=e163] [cursor=pointer]:
                    - generic [ref=e164]: S7
                    - generic [ref=e165]: Second Plot Point
                    - generic [ref=e166]: "0"
                    - img [ref=e167]
                  - button "S8 Climax 0" [ref=e171] [cursor=pointer]:
                    - generic [ref=e172]: S8
                    - generic [ref=e173]: Climax
                    - generic [ref=e174]: "0"
                    - img [ref=e175]
                  - button "S9 Resolution 0" [ref=e179] [cursor=pointer]:
                    - generic [ref=e180]: S9
                    - generic [ref=e181]: Resolution
                    - generic [ref=e182]: "0"
                    - img [ref=e183]
      - main [ref=e185]:
        - generic [ref=e188]:
          - generic: Saved
          - generic [ref=e193]:
            - generic [ref=e194]:
              - generic [ref=e197]:
                - generic [ref=e198]:
                  - generic "slugline (Ctrl+K, 1)" [ref=e199] [cursor=pointer]:
                    - generic [ref=e200]: slugline
                  - generic "action (Ctrl+K, 2)" [ref=e201] [cursor=pointer]:
                    - generic [ref=e202]: action
                  - generic "character (Ctrl+K, 3)" [ref=e203] [cursor=pointer]:
                    - generic [ref=e204]: character
                  - generic "dialogue (Ctrl+K, 4)" [ref=e205] [cursor=pointer]:
                    - generic [ref=e206]: dialogue
                  - generic "parenthetical (Ctrl+K, 5)" [ref=e207] [cursor=pointer]:
                    - generic [ref=e208]: parenthetical
                  - generic "transition (Ctrl+K, 6)" [ref=e209] [cursor=pointer]:
                    - generic [ref=e210]: transition
                  - generic "Format palette (Ctrl+K)" [ref=e211] [cursor=pointer]:
                    - generic [ref=e212]: ⌘K
                - generic [ref=e213]:
                  - generic "Switch to Light Theme" [ref=e214] [cursor=pointer]:
                    - img [ref=e215]
                  - generic "Enter Fullscreen" [ref=e221] [cursor=pointer]:
                    - img [ref=e222]
                  - generic "Save Script (Ctrl+S)" [ref=e227] [cursor=pointer]:
                    - img [ref=e228]
              - generic [ref=e234]:
                - generic: "1"
                - paragraph [ref=e237]
            - generic [ref=e239]:
              - button "Hide tools" [ref=e241] [cursor=pointer]:
                - img [ref=e242]
                - img [ref=e244]
              - generic [ref=e247]:
                - button [ref=e250] [cursor=pointer]:
                  - img [ref=e251]
                - button [ref=e257] [cursor=pointer]:
                  - img [ref=e258]
                - button [ref=e264] [cursor=pointer]:
                  - img [ref=e265]
                - button [ref=e270] [cursor=pointer]:
                  - img [ref=e271]
                - button [ref=e278] [cursor=pointer]:
                  - img [ref=e279]
  - status "All changes saved locally and synced to cloud." [ref=e283]:
    - img [ref=e284]
    - generic [ref=e287]: Synced
```

# Test source

```ts
  1  | // PT-010 — AI 3-handoff pipeline preservado (BR-MIGRAR-044..051).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('AI three-handoff pipeline', () => {
  5  |   test('@paridade @critico pipeline completo com requires_third_handoff=true', async ({ page }) => {
  6  |     const events: string[] = [];
  7  |     await page.route(/\/scripts/, (route, req) => {
  8  |       const m = /event=([\w-]+)/.exec(req.postData() || '') || /"event"\s*:\s*"([\w-]+)"/.exec(req.postData() || '');
  9  |       if (m) events.push(m[1]);
  10 |       route.fulfill({ status: 200, body: JSON.stringify({ requires_third_handoff: true, conversationHistory: [], cap: 10 }) });
  11 |     });
  12 |     await page.goto('/?screen=scripts&fixture=dirty-scene');
  13 |     await page.getByRole('button', { name: /generate full scene/i }).click();
  14 |     await expect.poll(() => events).toContain('scene-extract');
  15 |     // handoffs 1..3 + cap decrementa + header -N
  16 |   });
  17 | 
  18 |   test('@paridade requires_third_handoff=false pula handoff #3', async ({ page }) => {
  19 |     let h3 = false;
  20 |     await page.route(/\/scripts/, (route, req) => {
  21 |       if (/handoff-3/.test(req.postData() || '')) h3 = true;
  22 |       route.fulfill({ status: 200, body: JSON.stringify({ requires_third_handoff: false, conversationHistory: [] }) });
  23 |     });
  24 |     await page.goto('/?screen=scripts&fixture=dirty-scene');
  25 |     await page.getByRole('button', { name: /generate full scene/i }).click();
  26 |     await page.waitForTimeout(200);
  27 |     expect(h3).toBe(false);
  28 |   });
  29 | 
  30 |   test('@paridade @critico 5xx aciona auto-retry único (BR-038)', async ({ page }) => {
  31 |     let attempts = 0;
  32 |     await page.route(/\/scripts/, (route) => {
  33 |       attempts++;
  34 |       route.fulfill({ status: attempts === 1 ? 502 : 200, body: '{}' });
  35 |     });
  36 |     await page.goto('/?screen=scripts&fixture=dirty-scene');
  37 |     await page.getByRole('button', { name: /generate full scene/i }).click();
  38 |     await expect.poll(() => attempts).toBeGreaterThanOrEqual(2); // 1 retry após 5xx
  39 |   });
  40 | 
  41 |   test('@paridade @critico modelOverride enviado em todos os handoffs (BR-049)', async ({ page }) => {
  42 |     const overrides: (string | null)[] = [];
  43 |     await page.route(/\/scripts/, (route, req) => {
  44 |       const m = /"modelOverride"\s*:\s*("[^"]*"|null)/.exec(req.postData() || '');
  45 |       if (m) overrides.push(JSON.parse(m[1]));
  46 |       route.fulfill({ status: 200, body: JSON.stringify({ requires_third_handoff: true, conversationHistory: [] }) });
  47 |     });
  48 |     await page.goto('/?screen=scripts&fixture=model-claude');
> 49 |     await page.getByRole('button', { name: /generate full scene/i }).click();
     |                                                                      ^ Error: locator.click: Target page, context or browser has been closed
  50 |     await expect.poll(() => overrides.length).toBeGreaterThan(0);
  51 |     expect(overrides.every((o) => o === 'claude-sonnet-4')).toBe(true);
  52 |   });
  53 | 
  54 |   test('@paridade @ordem conversation_history in-order across handoffs', async ({ page }) => {
  55 |     await page.goto('/?screen=scripts&fixture=dirty-scene');
  56 |     await page.getByRole('button', { name: /generate full scene/i }).click();
  57 |     const hist = await page.evaluate(() => (window as any).__TEST__?.handoffHistories?.());
  58 |     if (hist) expect(hist[2]).toEqual(expect.arrayContaining(hist[0]));
  59 |   });
  60 | 
  61 |   test('@paridade one AI in flight bloqueia inline AI', async ({ page }) => {
  62 |     await page.goto('/?screen=scripts&fixture=handoff-in-flight');
  63 |     await expect(page.getByRole('button', { name: /improve|guided/i }).first()).toBeDisabled();
  64 |   });
  65 | });
  66 | 
```