# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-characters-crud-and-async-refresh.spec.ts >> Characters CRUD + async refresh >> @paridade @critico @offline refresh offline enfileira + retry no reconnect
- Location: parity\specs\05-characters-crud-and-async-refresh.spec.ts:44:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: /refresh characters/i })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - img [ref=e4]
  - status "All changes saved locally and synced to cloud." [ref=e9]:
    - img [ref=e10]
    - generic [ref=e13]: Synced
```

# Test source

```ts
  1  | // PT-005 — Characters CRUD + async refresh (AD-05 / BR-MIGRAR-018..025,045,046).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Characters CRUD + async refresh', () => {
  5  |   test('@paridade @critico add usa name como PK + default minor', async ({ page, bridge, client }) => {
  6  |     await page.goto('/?screen=characters');
  7  |     await page.getByRole('button', { name: /add character/i }).click();
  8  |     await page.getByLabel(/name/i).fill('Alice');
  9  |     await page.getByRole('button', { name: /save/i }).click();
  10 |     if (client === 'desktop') {
  11 |       const row = await bridge.dbGet("SELECT importance, arc_growth FROM characters WHERE name='Alice'");
  12 |       expect(row?.importance).toBe('minor');
  13 |       expect(row?.arc_growth).toBe('static');
  14 |     }
  15 |     // adicionar "Alice" de novo → rejeitado (PK)
  16 |     await page.getByRole('button', { name: /add character/i }).click();
  17 |     await page.getByLabel(/name/i).fill('Alice');
  18 |     await page.getByRole('button', { name: /save/i }).click();
  19 |     await expect(page.getByText(/already exists|rename/i)).toBeVisible();
  20 |   });
  21 | 
  22 |   test('@paridade @critico locked imune a WS merge', async ({ page }) => {
  23 |     await page.goto('/?screen=characters&fixture=alice-locked-bob');
  24 |     await page.evaluate(() => (window as any).__TEST__?.emitWsCharacters?.(['Bob', 'Carol'])); // Alice omitida
  25 |     await expect(page.getByText('Alice')).toBeVisible(); // preservada
  26 |     await expect(page.getByText('Carol')).toBeVisible(); // is_new
  27 |   });
  28 | 
  29 |   test('@paridade @critico async refresh sucede ≤5min via WS', async ({ page }) => {
  30 |     await page.goto('/?screen=characters');
  31 |     await page.getByRole('button', { name: /refresh characters/i }).click();
  32 |     await expect(page.getByText(/syncing characters/i)).toBeVisible();
  33 |     await page.evaluate(() => (window as any).__TEST__?.emitWsRefresh?.()); // requestId matching
  34 |     await expect(page.getByText(/synced/i)).toBeVisible();
  35 |   });
  36 | 
  37 |   test('@paridade @critico @regressao-esperada refresh timeout 5min libera UI (fix #3)', async ({ page }) => {
  38 |     await page.goto('/?screen=characters');
  39 |     await page.getByRole('button', { name: /refresh characters/i }).click();
  40 |     await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(5 * 60 * 1000 + 1));
  41 |     await expect(page.getByText(/timed out/i)).toBeVisible(); // não fica spinner forever
  42 |   });
  43 | 
  44 |   test('@paridade @critico @offline refresh offline enfileira + retry no reconnect', async ({ page, bridge, client }) => {
  45 |     test.skip(client === 'web');
  46 |     await bridge.emitOs('offline');
  47 |     await page.goto('/?screen=characters');
> 48 |     await page.getByRole('button', { name: /refresh characters/i }).click();
     |                                                                     ^ Error: locator.click: Target page, context or browser has been closed
  49 |     expect(await bridge.queueDepth()).toBeGreaterThan(0); // character_refresh pending
  50 |     await bridge.emitOs('online'); // processa
  51 |   });
  52 | 
  53 |   test('@paridade @idempotencia WS tardio com requestId stale é ignorado', async ({ page }) => {
  54 |     await page.goto('/?screen=characters');
  55 |     const before = await page.evaluate(() => (window as any).__TEST__?.characterCount?.());
  56 |     await page.evaluate(() => (window as any).__TEST__?.emitWsRefresh?.('STALE_REQ')); // não-ativo
  57 |     const after = await page.evaluate(() => (window as any).__TEST__?.characterCount?.());
  58 |     expect(after).toBe(before);
  59 |   });
  60 | 
  61 |   test('@paridade @critico WS batch suprime toasts locais', async ({ page }) => {
  62 |     await page.goto('/?screen=characters&fixture=ws-updating');
  63 |     await expect(page.getByText('Character added')).toHaveCount(0); // suprimido durante batch
  64 |   });
  65 | });
  66 | 
```