# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 10-ai-three-handoff-pipeline.spec.ts >> AI three-handoff pipeline >> @paridade one AI in flight bloqueia inline AI
- Location: parity\specs\10-ai-three-handoff-pipeline.spec.ts:61:7

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator: getByRole('button', { name: /improve|guided/i }).first()
Expected: disabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeDisabled" with timeout 5000ms
  - waiting for getByRole('button', { name: /improve|guided/i }).first()

```

```yaml
- status: error
- banner:
  - img "Logo"
  - navigation:
    - link "App":
      - /url: "#/dashboard"
    - link "Profile":
      - /url: "#/profile"
    - link "Pricing":
      - /url: "#/prices"
    - img
  - button "filmassistant.io filmassistant.io ▼":
    - img "filmassistant.io"
    - text: filmassistant.io ▼
  - img
  - text: 0 Tokens Remaining
  - button:
    - img
- button "Collapse sidebar" [expanded]:
  - img
- text: Story Workflow
- navigation:
  - link "Outline":
    - /url: "#/home"
    - text: Outline
    - img
  - button "Story Brainstorming"
  - button "Story Foundation"
  - button "Synopsis"
  - link "Scenes":
    - /url: "#/scenes"
    - text: Scenes
    - img
  - button "Scenes"
  - link "Script":
    - /url: "#/scripts"
    - text: Script
    - img
  - button "Scripts"
  - text: Script Structure Act 1
  - button "S1 Introduction and Stasis 0"
  - button "S2 Inciting Incident 0"
  - button "S3 Commitment 0"
  - text: Act 2
  - button "S4 First Pinch Point 0"
  - button "S5 Midpoint 0"
  - button "S6 Second Pinch Point 0"
  - text: Act 3
  - button "S7 Second Plot Point 0"
  - button "S8 Climax 0"
  - button "S9 Resolution 0"
- main:
  - text: Saved slugline action character dialogue parenthetical transition ⌘K
  - img
  - img
  - img
  - text: "1"
  - paragraph
  - button "Hide tools":
    - img
    - img
  - button:
    - img
  - button:
    - img
  - button:
    - img
  - button:
    - img
  - button:
    - img
- status "All changes saved locally and synced to cloud.":
  - img
  - text: Synced
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
  49 |     await page.getByRole('button', { name: /generate full scene/i }).click();
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
> 63 |     await expect(page.getByRole('button', { name: /improve|guided/i }).first()).toBeDisabled();
     |                                                                                 ^ Error: expect(locator).toBeDisabled() failed
  64 |   });
  65 | });
  66 | 
```