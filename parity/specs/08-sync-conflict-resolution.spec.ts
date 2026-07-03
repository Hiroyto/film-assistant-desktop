// PT-008 — Sync conflict resolution (AD-02 / RISK-003 / SCR-0030).
import { test, expect } from '../fixtures';

test.describe('Sync conflict resolution', () => {
  test.skip(({ client }) => client === 'web', 'conflict resolution é desktop-only');

  test('@paridade @critico @conflito conflict detected abre modal explícito', async ({ page, bridge }) => {
    await page.goto('/?fixture=conflict-v6-local-v7-remote');
    await bridge.emitOs('online'); // pull detecta DDB.v7 > local.synced=5
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/sync conflict/i)).toBeVisible();
    await expect(page.getByRole('radio', { name: /keep my version/i })).toBeChecked(); // default
  });

  test('@paridade @critico @conflito Keep mine preserva versão local + snapshot', async ({ page, bridge }) => {
    await page.goto('/?fixture=conflict-open');
    await page.getByRole('radio', { name: /keep my version/i }).check();
    await page.getByRole('button', { name: /apply/i }).click();
    const snap = await bridge.dbGet("SELECT reason FROM snapshots WHERE reason='pre_conflict_resolution' LIMIT 1");
    expect(snap?.reason).toBe('pre_conflict_resolution');
  });

  test('@paridade @critico @conflito Use other sobrescreve com remoto', async ({ page, bridge }) => {
    await page.goto('/?fixture=conflict-open');
    await page.getByRole('radio', { name: /other device/i }).check();
    await page.getByRole('button', { name: /apply/i }).click();
    const row = await bridge.dbGet('SELECT version FROM stories ORDER BY updated_at DESC LIMIT 1');
    expect(row?.version).toBe(7); // alinhado com DDB; sem push
  });

  test('@paridade @critico @conflito Keep both cria duplicata', async ({ page, bridge }) => {
    await page.goto('/?fixture=conflict-open');
    await page.getByRole('radio', { name: /keep both/i }).check();
    await page.getByRole('button', { name: /apply/i }).click();
    const n = await bridge.dbGet('SELECT COUNT(*) AS c FROM stories');
    expect(n?.c).toBeGreaterThanOrEqual(2);
  });

  test('@paridade @conflito Cancel mantém conflict pending', async ({ page }) => {
    await page.goto('/?fixture=conflict-open');
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/conflict — click to resolve/i)).toBeVisible(); // status bar
  });

  test('@paridade @consistencia-eventual @conflito snapshot permite recovery', async ({ page, bridge }) => {
    await page.goto('/?fixture=conflict-resolved-keep-mine');
    const snap = await bridge.dbGet('SELECT before_state, expires_at FROM snapshots ORDER BY snapshot_at DESC LIMIT 1');
    expect(snap?.before_state).toBeTruthy();
    expect(snap?.expires_at).toBeTruthy(); // ~30 dias
  });
});
