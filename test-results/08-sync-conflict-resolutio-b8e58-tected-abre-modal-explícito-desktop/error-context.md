# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 08-sync-conflict-resolution.spec.ts >> Sync conflict resolution >> @paridade @critico @conflito conflict detected abre modal explícito
- Location: parity\specs\08-sync-conflict-resolution.spec.ts:7:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('dialog')

```

```yaml
- img
- status "All changes saved locally and synced to cloud.":
  - img
  - text: Synced
```

# Test source

```ts
  1  | // PT-008 — Sync conflict resolution (AD-02 / RISK-003 / SCR-0030).
  2  | import { test, expect } from '../fixtures';
  3  | 
  4  | test.describe('Sync conflict resolution', () => {
  5  |   test.skip(({ client }) => client === 'web', 'conflict resolution é desktop-only');
  6  | 
  7  |   test('@paridade @critico @conflito conflict detected abre modal explícito', async ({ page, bridge }) => {
  8  |     await page.goto('/?fixture=conflict-v6-local-v7-remote');
  9  |     await bridge.emitOs('online'); // pull detecta DDB.v7 > local.synced=5
> 10 |     await expect(page.getByRole('dialog')).toBeVisible();
     |                                            ^ Error: expect(locator).toBeVisible() failed
  11 |     await expect(page.getByText(/sync conflict/i)).toBeVisible();
  12 |     await expect(page.getByRole('radio', { name: /keep my version/i })).toBeChecked(); // default
  13 |   });
  14 | 
  15 |   test('@paridade @critico @conflito Keep mine preserva versão local + snapshot', async ({ page, bridge }) => {
  16 |     await page.goto('/?fixture=conflict-open');
  17 |     await page.getByRole('radio', { name: /keep my version/i }).check();
  18 |     await page.getByRole('button', { name: /apply/i }).click();
  19 |     const snap = await bridge.dbGet("SELECT reason FROM snapshots WHERE reason='pre_conflict_resolution' LIMIT 1");
  20 |     expect(snap?.reason).toBe('pre_conflict_resolution');
  21 |   });
  22 | 
  23 |   test('@paridade @critico @conflito Use other sobrescreve com remoto', async ({ page, bridge }) => {
  24 |     await page.goto('/?fixture=conflict-open');
  25 |     await page.getByRole('radio', { name: /other device/i }).check();
  26 |     await page.getByRole('button', { name: /apply/i }).click();
  27 |     const row = await bridge.dbGet('SELECT version FROM stories ORDER BY updated_at DESC LIMIT 1');
  28 |     expect(row?.version).toBe(7); // alinhado com DDB; sem push
  29 |   });
  30 | 
  31 |   test('@paridade @critico @conflito Keep both cria duplicata', async ({ page, bridge }) => {
  32 |     await page.goto('/?fixture=conflict-open');
  33 |     await page.getByRole('radio', { name: /keep both/i }).check();
  34 |     await page.getByRole('button', { name: /apply/i }).click();
  35 |     const n = await bridge.dbGet('SELECT COUNT(*) AS c FROM stories');
  36 |     expect(n?.c).toBeGreaterThanOrEqual(2);
  37 |   });
  38 | 
  39 |   test('@paridade @conflito Cancel mantém conflict pending', async ({ page }) => {
  40 |     await page.goto('/?fixture=conflict-open');
  41 |     await page.getByRole('button', { name: /cancel/i }).click();
  42 |     await expect(page.getByText(/conflict — click to resolve/i)).toBeVisible(); // status bar
  43 |   });
  44 | 
  45 |   test('@paridade @consistencia-eventual @conflito snapshot permite recovery', async ({ page, bridge }) => {
  46 |     await page.goto('/?fixture=conflict-resolved-keep-mine');
  47 |     const snap = await bridge.dbGet('SELECT before_state, expires_at FROM snapshots ORDER BY snapshot_at DESC LIMIT 1');
  48 |     expect(snap?.before_state).toBeTruthy();
  49 |     expect(snap?.expires_at).toBeTruthy(); // ~30 dias
  50 |   });
  51 | });
  52 | 
```