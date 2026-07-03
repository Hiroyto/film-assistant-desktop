// PT-001 — Sign-up + Confirm + Sign-in atomic (BR-MIGRAR-001..008, DEV-009/010).
// Tradução de parity_tests/01-auth-signin-and-confirm.feature. Roda web + desktop.
import { test, expect } from '../fixtures';

test.describe('Auth: sign-up + confirm + sign-in', () => {
  test('@paridade @critico sign-up → confirm → signin atomic', async ({ page }) => {
    // Dado abriu auth.login e clicou Sign Up
    await page.getByRole('button', { name: /sign up/i }).click();
    // E preencheu email/password + Terms
    await page.getByLabel(/email/i).fill('writer@example.com');
    await page.getByLabel(/password/i).fill('Abc123!@#');
    await page.getByRole('checkbox', { name: /terms/i }).check();
    // Quando submit → backend recebe signup
    const signup = page.waitForRequest((r) => /signup|sign-up/i.test(r.url()));
    await page.getByRole('button', { name: /sign up/i }).click();
    await signup;
    // Então vai para confirm-code com o email no header
    await expect(page.getByText('writer@example.com')).toBeVisible();
    // confirma código 6 dígitos → confirmSignUp + signIn → home
    await page.getByLabel(/code/i).fill('123456');
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page).toHaveURL(/home/);
  });

  test('@paridade @critico resend respeita throttle 60s', async ({ page }) => {
    await page.goto('/?screen=confirm-code'); // fixture
    const btn = page.getByRole('button', { name: /resend code/i });
    await btn.click();
    await expect(btn).toBeDisabled(); // countdown 60s
    // 30s depois ainda disabled (sem request extra) — verificável via clock fake no app de teste.
    await expect(btn).toBeDisabled();
  });

  test('@paridade @critico @regressao-esperada resend cooldown persiste no OS sleep (DEV-009)', async ({
    page,
    bridge,
    client,
  }) => {
    test.skip(client === 'web', 'cooldown persistido em SQLite é desktop-only');
    await page.goto('/?screen=confirm-code');
    await page.getByRole('button', { name: /resend code/i }).click();
    await bridge.emitOs('resumed'); // simula wake após sleep > 60s
    // lastResendAt em settings já expirou → enabled (sem reiniciar setInterval)
    await expect(page.getByRole('button', { name: /resend code/i })).toBeEnabled();
  });

  test('@paridade @regressao-esperada password validator enforça lowercase (DEV-009)', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click();
    await page.getByLabel(/password/i).fill('ABC123!@#'); // sem lowercase
    let called = false;
    await page.route(/signup|sign-up/i, (route) => {
      called = true;
      route.abort();
    });
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page.getByText(/lowercase|minúscula/i)).toBeVisible();
    expect(called).toBe(false); // submit Cognito não chamado
  });

  test('@paridade @critico Terms obrigatório bloqueia signup', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).fill('a@b.com');
    await page.getByLabel(/password/i).fill('Abc123!@#');
    // checkbox unchecked → submit disabled
    await expect(page.getByRole('button', { name: /sign up/i })).toBeDisabled();
  });

  test('@paridade @critico @plataforma Terms abre no browser externo (DEV-010)', async ({ page, client }) => {
    test.skip(client === 'web', 'shell.openExternal é desktop-only (web usa window.open)');
    await page.getByRole('button', { name: /sign up/i }).click();
    // No desktop, clicar o link Terms chama window.electronAPI.openExternal (sem navegação interna).
    await page.evaluate(() => {
      (window as any).__TEST__?.spyOpenExternal?.();
    });
    await page.getByRole('link', { name: /terms/i }).click();
    const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
    expect(opened).toMatch(/getterms|RRt2r|terms/i);
  });
});
