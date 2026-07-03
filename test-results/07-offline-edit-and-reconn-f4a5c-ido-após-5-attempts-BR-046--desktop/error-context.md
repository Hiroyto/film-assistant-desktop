# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 07-offline-edit-and-reconnect-sync.spec.ts >> Offline edit + reconnect sync >> @paridade @critico @reconnect WS reconnect estendido após 5 attempts (BR-046)
- Location: parity\specs\07-offline-edit-and-reconnect-sync.spec.ts:32:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/offline/i)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/offline/i)

```

```yaml
- img
- status "All changes saved locally and synced to cloud.":
  - img
  - text: Synced
```

# Test source

```ts
  1  | // PT-007 — Offline edit + reconnect sync (AD-01 / BR-MIGRAR-014,015,022,033,035,046).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Offline edit + reconnect sync', () => {
  5  |   test.skip(({ client }) => client === 'web', 'local-first/offline é desktop-only');
  6  | 
  7  |   test('@paridade @critico @offline desconectar não impede edits', async ({ page, bridge }) => {
  8  |     await bridge.emitOs('offline');
  9  |     await expect(page.getByText(/offline — changes saved locally/i)).toBeVisible();
  10 |     await page.goto('/?screen=outline');
  11 |     await page.getByLabel(/S5/i).fill('New text'); // edita normalmente
  12 |   });
  13 | 
  14 |   test('@paridade @critico @offline edit offline persiste SQLite + enfileira', async ({ page, bridge }) => {
  15 |     await bridge.emitOs('offline');
  16 |     await page.goto('/?screen=outline');
  17 |     await page.getByLabel(/S5/i).fill('New text');
  18 |     await page.waitForTimeout(10500);
  19 |     const row = await bridge.dbGet('SELECT segments_json FROM stories ORDER BY updated_at DESC LIMIT 1');
  20 |     expect(JSON.parse(row.segments_json).S5.S).toBe('New text');
  21 |     expect(await bridge.queueDepth()).toBeGreaterThan(0);
  22 |   });
  23 | 
  24 |   test('@paridade @critico @reconnect reconnect flush automático', async ({ page, bridge }) => {
  25 |     await page.goto('/?fixture=20-pending-offline');
  26 |     await bridge.emitOs('online');
  27 |     await expect(page.getByText(/syncing/i)).toBeVisible();
  28 |     await expect.poll(() => bridge.queueDepth()).toBe(0);
  29 |     await expect(page.getByText(/synced/i)).toBeVisible();
  30 |   });
  31 | 
  32 |   test('@paridade @critico @reconnect WS reconnect estendido após 5 attempts (BR-046)', async ({ page, bridge }) => {
  33 |     await page.goto('/?fixture=ws-exhausted');
> 34 |     await expect(page.getByText(/offline/i)).toBeVisible(); // extended backoff
     |                                              ^ Error: expect(locator).toBeVisible() failed
  35 |     await bridge.emitOs('online'); // reseta counter, reconecta
  36 |   });
  37 | 
  38 |   test('@paridade @critico @idempotencia mesma mutation retried não duplica (request_id)', async ({ page }) => {
  39 |     const seen: string[] = [];
  40 |     await page.route(/\/works/, (route, req) => {
  41 |       seen.push(req.headers()['x-request-id'] as string);
  42 |       route.fulfill({ status: 200, body: '{}' });
  43 |     });
  44 |     await page.goto('/?fixture=retry-same-request');
  45 |     // backend recebe 2x o mesmo R1 (dedup é COD-008 server-side)
  46 |     expect(new Set(seen).size).toBeLessThanOrEqual(seen.length);
  47 |   });
  48 | 
  49 |   test('@paridade @offline edit offline + web simultânea → conflict', async ({ page, bridge }) => {
  50 |     await page.goto('/?fixture=offline-edit-s5');
  51 |     await bridge.emitOs('online'); // pull detecta version skew
  52 |     await expect(page.getByText(/conflict/i)).toBeVisible();
  53 |   });
  54 | 
  55 |   test('@paridade @offline auto-save 30min funciona offline', async ({ page, bridge }) => {
  56 |     await page.goto('/?fixture=offline-dirty');
  57 |     await page.evaluate(() => (window as any).__TEST__?.advanceTimers?.(30 * 60 * 1000));
  58 |     expect(await bridge.queueDepth()).toBeGreaterThan(0);
  59 |   });
  60 | });
  61 | 
```