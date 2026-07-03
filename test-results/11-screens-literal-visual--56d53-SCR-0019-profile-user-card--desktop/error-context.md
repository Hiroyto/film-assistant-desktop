# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 11-screens-literal-visual-parity.spec.ts >> @paridade-visual telas literal (26) >> @paridade-visual @critico SCR-0019 profile.user-card 
- Location: parity\specs\11-screens-literal-visual-parity.spec.ts:47:9

# Error details

```
Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\profile-user-card-desktop-win32.png, writing actual.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - banner [ref=e6]:
      - generic [ref=e7]:
        - generic [ref=e8]:
          - img "Logo" [ref=e10] [cursor=pointer]
          - navigation [ref=e11]:
            - link "App" [ref=e12] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile" [ref=e13] [cursor=pointer]:
              - /url: "#/profile"
            - link "Pricing" [ref=e14] [cursor=pointer]:
              - /url: "#/prices"
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
      - heading "Profile" [level=1] [ref=e33]
      - generic [ref=e34]:
        - generic [ref=e35]:
          - generic [ref=e36]:
            - generic [ref=e37]:
              - heading [level=2]
              - paragraph [ref=e38]: Member since Invalid Date
            - generic [ref=e39]:
              - button "Manage Membership" [ref=e40] [cursor=pointer]:
                - img [ref=e41]
                - text: Manage Membership
              - button "Privacy Settings" [ref=e43] [cursor=pointer]:
                - img [ref=e44]
                - text: Privacy Settings
          - generic [ref=e47]:
            - generic [ref=e48]:
              - generic [ref=e49]: Email
              - generic [ref=e50]: "-"
            - generic [ref=e51]:
              - generic [ref=e52]: Tokens
              - generic [ref=e53]: "-"
            - generic [ref=e54]:
              - generic [ref=e55]: Subscription
              - generic [ref=e56]: "-"
            - generic [ref=e57]:
              - generic [ref=e58]: Sign Up Date
              - generic [ref=e59]: "-"
        - heading "My Stories" [level=3] [ref=e62]
    - contentinfo [ref=e63]:
      - generic [ref=e66]:
        - paragraph [ref=e67]: © 2026 FilmAssistant Inc. All rights reserved.
        - generic [ref=e68]:
          - img [ref=e69]
          - link "accountservices@filmassistant.io" [ref=e71] [cursor=pointer]:
            - /url: mailto:accountservices@filmassistant.io
        - link "Terms of Service" [ref=e72] [cursor=pointer]:
          - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e74]:
    - img [ref=e75]
    - generic [ref=e78]: Synced
```

# Test source

```ts
  1  | // Golden file comparison (modo literal — parity_specs §paridade visual). Captura
  2  | // snapshot HTML+CSS sob normalizationRules e compara com tolerância de pixel ≤1%.
  3  | // As 26 telas literal usam isto; é o oráculo = web SPA rodando local.
  4  | import { Page, expect } from '@playwright/test';
  5  | 
  6  | /** normalizationRules de screens/golden/manifest.yaml (line endings, tokens, etc). */
  7  | export function normalizeHtml(html: string): string {
  8  |   return html
  9  |     .replace(/\r\n/g, '\n')
  10 |     .replace(/\s+$/gm, '')
  11 |     .replace(/data-reactid="[^"]*"/g, '') // ids voláteis
  12 |     .trim();
  13 | }
  14 | 
  15 | /** Snapshot visual (pixel) da tela — nome estável por tela. */
  16 | export async function expectVisualParity(page: Page, screenName: string): Promise<void> {
  17 |   // Aguarda idle (sem animações in-flight) antes do snapshot.
  18 |   await page.waitForLoadState('networkidle');
> 19 |   await expect(page).toHaveScreenshot(`${screenName}.png`, { animations: 'disabled' });
     |   ^ Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\profile-user-card-desktop-win32.png, writing actual.
  20 | }
  21 | 
  22 | /** Comparação de HTML normalizado (golden-file textual) entre cliente e baseline. */
  23 | export async function captureNormalizedHtml(page: Page, selector = 'body'): Promise<string> {
  24 |   const html = await page.locator(selector).innerHTML();
  25 |   return normalizeHtml(html);
  26 | }
  27 | 
```