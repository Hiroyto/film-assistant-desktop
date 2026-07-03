// PT-012 — Paridade comportamental das 4 telas modernizadas (DEV-001..004). Desktop-only
// (não há baseline web). Valida contrato: componentes, eventos, estados.
import { test, expect } from '../fixtures';

test.describe('@paridade-comportamental telas modernizadas (4)', () => {
  test.skip(({ client }) => client === 'web', 'telas do shell são desktop-only');

  // SCR-0027 os-menu-bar
  test('@paridade-comportamental @critico menu OS tem todos os items', async ({ page }) => {
    const menu = await page.evaluate(() => (window as any).__TEST__?.menuStructure?.());
    expect(menu?.map((m: any) => m.label)).toEqual(['File', 'Edit', 'View', 'Help']);
    expect(menu?.find((m: any) => m.label === 'File')?.items).toEqual(
      expect.arrayContaining(['New Story', 'Save', 'Settings…', 'Quit']),
    );
  });

  test('@paridade-comportamental @critico File>Save disabled sem story ativa', async ({ page }) => {
    await page.goto('/?screen=login');
    expect(await page.evaluate(() => (window as any).__TEST__?.menuItemEnabled?.('menu-save'))).toBe(false);
    await page.goto('/?screen=outline&fixture=active-story');
    expect(await page.evaluate(() => (window as any).__TEST__?.menuItemEnabled?.('menu-save'))).toBe(true);
  });

  test('@paridade-comportamental View>Command Palette dispara commands.cmdk.open', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.clickMenu?.('commands.cmdk.open'));
    await expect(page.getByRole('dialog', { name: /command/i })).toBeVisible();
  });

  test('@paridade-comportamental Help>Open GitHub usa openExternal', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.clickMenuLabel?.('Open GitHub'));
    const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
    expect(opened).toContain('github.com');
  });

  // SCR-0028 sync-status-bar
  test('@paridade-comportamental @critico status bar "Synced" online + queue vazia', async ({ page, bridge }) => {
    await bridge.emitOs('online');
    await expect(page.getByText('Synced')).toBeVisible();
  });
  test('@paridade-comportamental @critico status bar "Syncing N" durante push', async ({ page }) => {
    await page.goto('/?fixture=3-pending');
    await expect(page.getByText(/syncing 3 change/i)).toBeVisible();
  });
  test('@paridade-comportamental @critico status bar "Offline"', async ({ page, bridge }) => {
    await bridge.emitOs('offline');
    await expect(page.getByText(/offline — changes saved locally/i)).toBeVisible();
  });
  test('@paridade-comportamental @critico status bar "Conflict" abre modal ao clicar', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.emitConflict?.());
    await page.getByText(/conflict — click to resolve/i).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  // SCR-0029 update-available-modal
  test('@paridade-comportamental @critico update modal abre em update.downloaded', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
    await expect(page.getByText('Update Available')).toBeVisible();
    await expect(page.getByText(/1\.0\.1/)).toBeVisible();
  });
  test('@paridade-comportamental Restart Now → restarting + installUpdate', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
    await page.getByRole('button', { name: /restart now/i }).click();
    await expect(page.getByText(/restarting/i)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__TEST__?.installRequested?.())).toBe(true);
  });
  test('@paridade-comportamental Later grava timestamp e não re-prompt <24h', async ({ page, bridge }) => {
    await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
    await page.getByRole('button', { name: /later/i }).click();
    const row = await bridge.dbGet("SELECT value FROM settings WHERE key='lastUpdatePromptSkippedAt'");
    expect(row?.value).toBeTruthy();
    await page.evaluate(() => (window as any).__TEST__?.emitUpdate?.('downloaded', '1.0.1'));
    await expect(page.getByText('Update Available')).toHaveCount(0); // 24h cooldown
  });

  // SCR-0030 conflict-resolution-modal
  test('@paridade-comportamental @critico @conflito modal renderiza diff + 3 opções', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.emitConflict?.('story', 's1'));
    await expect(page.getByText(/sync conflict/i)).toBeVisible();
    await expect(page.getByRole('radio', { name: /keep my version/i })).toBeChecked();
    await expect(page.getByRole('radio', { name: /other device/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /keep both/i })).toBeVisible();
  });
  test('@paridade-comportamental @critico @conflito Apply publica sync.conflict.resolved', async ({ page }) => {
    await page.evaluate(() => (window as any).__TEST__?.emitConflict?.('story', 's1'));
    await page.getByRole('radio', { name: /keep both/i }).check();
    await page.getByRole('button', { name: /apply/i }).click();
    await expect(page.getByText(/applying/i)).toBeVisible();
    const resolved = await page.evaluate(() => (window as any).__TEST__?.lastResolved?.());
    expect(resolved?.resolution).toMatch(/both|manual_merge/);
  });
  test('@paridade-comportamental @critico snapshot pré-resolução existe', async ({ page, bridge }) => {
    await page.goto('/?fixture=conflict-resolved-keep-mine');
    const snap = await bridge.dbGet("SELECT reason, expires_at FROM snapshots WHERE reason='pre_conflict_resolution' LIMIT 1");
    expect(snap?.reason).toBe('pre_conflict_resolution');
    expect(snap?.expires_at).toBeTruthy();
  });

  // IPC contract integrity
  test('@paridade-comportamental @ipc todos os events shell→renderer chegam com schema válido', async ({ page }) => {
    for (const ev of ['os.resumed', 'os.offline', 'os.online', 'os.before-quit', 'deep-link.received', 'update.available', 'update.downloaded']) {
      const received = await page.evaluate((e) => (window as any).__TEST__?.assertIpcDelivered?.(e), ev);
      expect(received).toBe(true);
    }
  });
});
