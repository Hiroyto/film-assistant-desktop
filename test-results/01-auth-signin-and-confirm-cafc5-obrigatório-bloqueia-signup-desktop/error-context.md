# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-auth-signin-and-confirm.spec.ts >> Auth: sign-up + confirm + sign-in >> @paridade @critico Terms obrigatório bloqueia signup
- Location: parity\specs\01-auth-signin-and-confirm.spec.ts:60:7

# Error details

```
Test timeout of 12000ms exceeded.
```

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: /sign up/i })

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
          - textbox "Let your creativity flow freely..." [ref=e38]: A chef inherits a restaurant with a magica
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
  - status "All changes saved locally and synced to cloud." [ref=e85]:
    - img [ref=e86]
    - generic [ref=e89]: Synced
```

# Test source

```ts
  1  | // PT-001 — Sign-up + Confirm + Sign-in atomic (BR-MIGRAR-001..008, DEV-009/010).
  2  | // Tradução de parity_tests/01-auth-signin-and-confirm.feature. Roda web + desktop.
  3  | import { test, expect } from '../fixtures';
  4  | 
  5  | test.describe('Auth: sign-up + confirm + sign-in', () => {
  6  |   test('@paridade @critico sign-up → confirm → signin atomic', async ({ page }) => {
  7  |     // Dado abriu auth.login e clicou Sign Up
  8  |     await page.getByRole('button', { name: /sign up/i }).click();
  9  |     // E preencheu email/password + Terms
  10 |     await page.getByLabel(/email/i).fill('writer@example.com');
  11 |     await page.getByLabel(/password/i).fill('Abc123!@#');
  12 |     await page.getByRole('checkbox', { name: /terms/i }).check();
  13 |     // Quando submit → backend recebe signup
  14 |     const signup = page.waitForRequest((r) => /signup|sign-up/i.test(r.url()));
  15 |     await page.getByRole('button', { name: /sign up/i }).click();
  16 |     await signup;
  17 |     // Então vai para confirm-code com o email no header
  18 |     await expect(page.getByText('writer@example.com')).toBeVisible();
  19 |     // confirma código 6 dígitos → confirmSignUp + signIn → home
  20 |     await page.getByLabel(/code/i).fill('123456');
  21 |     await page.getByRole('button', { name: /confirm/i }).click();
  22 |     await expect(page).toHaveURL(/home/);
  23 |   });
  24 | 
  25 |   test('@paridade @critico resend respeita throttle 60s', async ({ page }) => {
  26 |     await page.goto('/?screen=confirm-code'); // fixture
  27 |     const btn = page.getByRole('button', { name: /resend code/i });
  28 |     await btn.click();
  29 |     await expect(btn).toBeDisabled(); // countdown 60s
  30 |     // 30s depois ainda disabled (sem request extra) — verificável via clock fake no app de teste.
  31 |     await expect(btn).toBeDisabled();
  32 |   });
  33 | 
  34 |   test('@paridade @critico @regressao-esperada resend cooldown persiste no OS sleep (DEV-009)', async ({
  35 |     page,
  36 |     bridge,
  37 |     client,
  38 |   }) => {
  39 |     test.skip(client === 'web', 'cooldown persistido em SQLite é desktop-only');
  40 |     await page.goto('/?screen=confirm-code');
  41 |     await page.getByRole('button', { name: /resend code/i }).click();
  42 |     await bridge.emitOs('resumed'); // simula wake após sleep > 60s
  43 |     // lastResendAt em settings já expirou → enabled (sem reiniciar setInterval)
  44 |     await expect(page.getByRole('button', { name: /resend code/i })).toBeEnabled();
  45 |   });
  46 | 
  47 |   test('@paridade @regressao-esperada password validator enforça lowercase (DEV-009)', async ({ page }) => {
  48 |     await page.getByRole('button', { name: /sign up/i }).click();
  49 |     await page.getByLabel(/password/i).fill('ABC123!@#'); // sem lowercase
  50 |     let called = false;
  51 |     await page.route(/signup|sign-up/i, (route) => {
  52 |       called = true;
  53 |       route.abort();
  54 |     });
  55 |     await page.getByRole('button', { name: /sign up/i }).click();
  56 |     await expect(page.getByText(/lowercase|minúscula/i)).toBeVisible();
  57 |     expect(called).toBe(false); // submit Cognito não chamado
  58 |   });
  59 | 
  60 |   test('@paridade @critico Terms obrigatório bloqueia signup', async ({ page }) => {
> 61 |     await page.getByRole('button', { name: /sign up/i }).click();
     |                                                          ^ Error: locator.click: Target page, context or browser has been closed
  62 |     await page.getByLabel(/email/i).fill('a@b.com');
  63 |     await page.getByLabel(/password/i).fill('Abc123!@#');
  64 |     // checkbox unchecked → submit disabled
  65 |     await expect(page.getByRole('button', { name: /sign up/i })).toBeDisabled();
  66 |   });
  67 | 
  68 |   test('@paridade @critico @plataforma Terms abre no browser externo (DEV-010)', async ({ page, client }) => {
  69 |     test.skip(client === 'web', 'shell.openExternal é desktop-only (web usa window.open)');
  70 |     await page.getByRole('button', { name: /sign up/i }).click();
  71 |     // No desktop, clicar o link Terms chama window.electronAPI.openExternal (sem navegação interna).
  72 |     await page.evaluate(() => {
  73 |       (window as any).__TEST__?.spyOpenExternal?.();
  74 |     });
  75 |     await page.getByRole('link', { name: /terms/i }).click();
  76 |     const opened = await page.evaluate(() => (window as any).__TEST__?.lastOpenExternal?.());
  77 |     expect(opened).toMatch(/getterms|RRt2r|terms/i);
  78 |   });
  79 | });
  80 | 
```