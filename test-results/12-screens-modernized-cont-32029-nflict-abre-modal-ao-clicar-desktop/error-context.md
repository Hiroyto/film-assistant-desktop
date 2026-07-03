# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 12-screens-modernized-contract-parity.spec.ts >> @paridade-comportamental telas modernizadas (4) >> @paridade-comportamental @critico status bar "Conflict" abre modal ao clicar
- Location: parity\specs\12-screens-modernized-contract-parity.spec.ts:48:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByText(/conflict — click to resolve/i)
    - locator resolved to <span class="text-semanticError">Conflict — click to resolve</span>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div role="dialog" aria-modal="true" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">…</div> intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div role="dialog" aria-modal="true" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">…</div> intercepts pointer events
    - retrying click action
      - waiting 100ms
    21 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div role="dialog" aria-modal="true" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">…</div> intercepts pointer events
     - retrying click action
       - waiting 500ms

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
          - textbox "Let your creativity flow freely..." [ref=e38]: A chef inherits a restaurant with a magical
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
  - status "Sync detected conflicting versions. Click to review." [ref=e85]:
    - img [ref=e86]
    - generic [ref=e88]: Conflict — click to resolve
    - button "Resolve" [ref=e89] [cursor=pointer]
  - dialog [ref=e90]:
    - generic [ref=e91]:
      - heading "Sync Conflict — story" [level=2] [ref=e92]
      - paragraph [ref=e93]: Your changes to this story conflict with changes made on another device.
      - group [ref=e94]:
        - generic [ref=e95]:
          - radio "Keep my version" [checked] [ref=e96]
          - text: Keep my version
        - generic [ref=e97]:
          - radio "Use other device's version" [ref=e98]
          - text: Use other device's version
        - generic [ref=e99]:
          - radio "Keep both (create duplicate)" [ref=e100]
          - text: Keep both (create duplicate)
      - generic [ref=e101]:
        - button "Cancel" [ref=e102] [cursor=pointer]
        - button "Apply" [ref=e103] [cursor=pointer]
```

# Test source

```ts
  1   | // PT-012 — Paridade comportamental das 4 telas modernizadas (DEV-001..004). Desktop-only
  2   | // (não há baseline web). Valida contrato: componentes, eventos, estados.
  3   | import { test, expect } from '../fixtures';
  4   | 
  5   | test.describe('@paridade-comportamental telas modernizadas (4)', () => {
  6   |   test.skip(({ client }) => client === 'web', 'telas do shell são desktop-only');
  7   | 
  8   |   // SCR-0027 os-menu-bar
  9   |   test('@paridade-comportamental @critico menu OS tem todos os items', async ({ page }) => {
  10  |     const menu = await page.evaluate(() => (window as any).__TEST__?.menuStructure?.());
  11  |     expect(menu?.map((m: any) => m.label)).toEqual(['File', 'Edit', 'View', 'Help']);
  12  |     expect(menu?.find((m: any) => m.label === 'File')?.items).toEqual(
  13  |       expect.arrayContaining(['New Story', 'Save', 'Settings…', 'Quit']),
  14  |     );
  15  |   });
  16  | 
  17  |   test('@paridade-comportamental @critico File>Save disabled sem story ativa', async ({ page }) => {
  18  |     await page.goto('/?screen=login');
  19  |     expect(await page.evaluate(() => (window as any).__TEST__?.menuItemEnabled?.('menu-save'))).toBe(false);
  20  |     await page.goto('/?screen=outline&fixture=active-story');
  21  |     expect(await page.evaluate(() => (window as any).__TEST__?.menuItemEnabled?.('menu-save'))).toBe(true);
  22  |   });
  23  | 
  24  |   test('@paridade-comportamental View>Command Palette dispara commands.cmdk.open', async ({ page }) => {
  25  |     await page.evaluate(() => (window as any).__TEST__?.clickMenu?.('commands.cmdk.open'));
  26  |     await expect(page.getByRole('dialog', { name: /command/i })).toBeVisible();
  27  |   });
  28  | 
  29  |   test('@paridade-comportamental Help>Open GitHub usa openExternal', async ({ page }) => {
  30  |     await page.evaluate(() => (window as any).__TEST__?.clickMenuLabel?.('Open GitHub'));
  31  |     const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
  32  |     expect(opened).toContain('github.com');
  33  |   });
  34  | 
  35  |   // SCR-0028 sync-status-bar
  36  |   test('@paridade-comportamental @critico status bar "Synced" online + queue vazia', async ({ page, bridge }) => {
  37  |     await bridge.emitOs('online');
  38  |     await expect(page.getByText('Synced')).toBeVisible();
  39  |   });
  40  |   test('@paridade-comportamental @critico status bar "Syncing N" durante push', async ({ page }) => {
  41  |     await page.goto('/?fixture=3-pending');
  42  |     await expect(page.getByText(/syncing 3 change/i)).toBeVisible();
  43  |   });
  44  |   test('@paridade-comportamental @critico status bar "Offline"', async ({ page, bridge }) => {
  45  |     await bridge.emitOs('offline');
  46  |     await expect(page.getByText(/offline — changes saved locally/i)).toBeVisible();
  47  |   });
  48  |   test('@paridade-comportamental @critico status bar "Conflict" abre modal ao clicar', async ({ page }) => {
  49  |     await page.evaluate(() => (window as any).__TEST__?.emitConflict?.());
> 50  |     await page.getByText(/conflict — click to resolve/i).click();
      |                                                          ^ Error: locator.click: Target page, context or browser has been closed
  51  |     await expect(page.getByRole('dialog')).toBeVisible();
  52  |   });
  53  | 
  54  |   // SCR-0029 update-available-modal
  55  |   test('@paridade-comportamental @critico update modal abre em update.downloaded', async ({ page }) => {
  56  |     await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
  57  |     await expect(page.getByText('Update Available')).toBeVisible();
  58  |     await expect(page.getByText(/1\.0\.1/)).toBeVisible();
  59  |   });
  60  |   test('@paridade-comportamental Restart Now → restarting + installUpdate', async ({ page }) => {
  61  |     await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
  62  |     await page.getByRole('button', { name: /restart now/i }).click();
  63  |     await expect(page.getByText(/restarting/i)).toBeVisible();
  64  |     expect(await page.evaluate(() => (window as any).__TEST__?.installRequested?.())).toBe(true);
  65  |   });
  66  |   test('@paridade-comportamental Later grava timestamp e não re-prompt <24h', async ({ page, bridge }) => {
  67  |     await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
  68  |     await page.getByRole('button', { name: /later/i }).click();
  69  |     const row = await bridge.dbGet("SELECT value FROM settings WHERE key='lastUpdatePromptSkippedAt'");
  70  |     expect(row?.value).toBeTruthy();
  71  |     await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
  72  |     await expect(page.getByText('Update Available')).toHaveCount(0); // 24h cooldown
  73  |   });
  74  | 
  75  |   // SCR-0030 conflict-resolution-modal
  76  |   test('@paridade-comportamental @critico @conflito modal renderiza diff + 3 opções', async ({ page }) => {
  77  |     await page.evaluate(() => (window as any).__TEST__?.emitConflict?.('story', 's1'));
  78  |     await expect(page.getByText(/sync conflict/i)).toBeVisible();
  79  |     await expect(page.getByRole('radio', { name: /keep my version/i })).toBeChecked();
  80  |     await expect(page.getByRole('radio', { name: /other device/i })).toBeVisible();
  81  |     await expect(page.getByRole('radio', { name: /keep both/i })).toBeVisible();
  82  |   });
  83  |   test('@paridade-comportamental @critico @conflito Apply publica sync.conflict.resolved', async ({ page }) => {
  84  |     await page.evaluate(() => (window as any).__TEST__?.emitConflict?.('story', 's1'));
  85  |     await page.getByRole('radio', { name: /keep both/i }).check();
  86  |     await page.getByRole('button', { name: /apply/i }).click();
  87  |     await expect(page.getByText(/applying/i)).toBeVisible();
  88  |     const resolved = await page.evaluate(() => (window as any).__TEST__?.lastResolved?.());
  89  |     expect(resolved?.resolution).toMatch(/both|manual_merge/);
  90  |   });
  91  |   test('@paridade-comportamental @critico snapshot pré-resolução existe', async ({ page, bridge }) => {
  92  |     await page.goto('/?fixture=conflict-resolved-keep-mine');
  93  |     const snap = await bridge.dbGet("SELECT reason, expires_at FROM snapshots WHERE reason='pre_conflict_resolution' LIMIT 1");
  94  |     expect(snap?.reason).toBe('pre_conflict_resolution');
  95  |     expect(snap?.expires_at).toBeTruthy();
  96  |   });
  97  | 
  98  |   // IPC contract integrity
  99  |   test('@paridade-comportamental @ipc todos os events shell→renderer chegam com schema válido', async ({ page }) => {
  100 |     for (const ev of ['os.resumed', 'os.offline', 'os.online', 'os.before-quit', 'deep-link.received', 'update.available', 'update.downloaded']) {
  101 |       const received = await page.evaluate((e) => (window as any).__TEST__?.assertIpcDelivered?.(e), ev);
  102 |       expect(received).toBe(true);
  103 |     }
  104 |   });
  105 | });
  106 | 
```