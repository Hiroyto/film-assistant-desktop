# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 11-screens-literal-visual-parity.spec.ts >> @paridade-visual telas literal (26) >> @paridade-visual @critico SCR-0001 auth.login 
- Location: parity\specs\11-screens-literal-visual-parity.spec.ts:47:9

# Error details

```
Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\auth-login-desktop-win32.png, writing actual.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - status [ref=e9]: error
    - banner [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]:
          - img "Logo" [ref=e15] [cursor=pointer]
          - navigation [ref=e16]:
            - link "App" [ref=e17] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile":
              - /url: "#/profile"
            - link "Pricing":
              - /url: "#/prices"
            - img [ref=e19]
        - generic [ref=e21]:
          - button "filmassistant.io filmassistant.io ▼" [ref=e23] [cursor=pointer]:
            - img "filmassistant.io" [ref=e25]
            - generic: filmassistant.io
            - generic [ref=e26]: ▼
          - generic [ref=e28]:
            - generic [ref=e29]:
              - img [ref=e30]
              - generic [ref=e32]: "0"
            - generic [ref=e33]: Tokens Remaining
          - button [ref=e34]:
            - img [ref=e35]
    - generic [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - heading "Every Great Story Starts with a Single Spark" [level=1] [ref=e41]:
            - text: Every Great Story Starts
            - text: with a Single Spark
          - paragraph [ref=e42]: Turn a spark into your next project.
          - textbox "Let your creativity flow freely..." [ref=e44]: A detective discovers their partner is the serial killer they've been hunting...
          - generic [ref=e45]:
            - button "Build Your Story" [ref=e46] [cursor=pointer]:
              - generic [ref=e47]: Build Your Story
            - generic [ref=e49]: or
            - button "Blank Outline" [ref=e50] [cursor=pointer]
        - button "View Your Stories" [ref=e51] [cursor=pointer]:
          - generic [ref=e52]: View Your Stories
          - img [ref=e53]
      - heading "Continue Building 0 / 5" [level=2] [ref=e57]:
        - text: Continue Building
        - generic [ref=e58]:
          - img [ref=e59]
          - text: 0 / 5
      - contentinfo [ref=e80]:
        - generic [ref=e83]:
          - paragraph [ref=e84]: © 2026 FilmAssistant Inc. All rights reserved.
          - generic [ref=e85]:
            - img [ref=e86]
            - link "accountservices@filmassistant.io" [ref=e88] [cursor=pointer]:
              - /url: mailto:accountservices@filmassistant.io
          - link "Terms of Service" [ref=e89] [cursor=pointer]:
            - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e91]:
    - img [ref=e92]
    - generic [ref=e95]: Synced
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
     |   ^ Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\auth-login-desktop-win32.png, writing actual.
  20 | }
  21 | 
  22 | /** Comparação de HTML normalizado (golden-file textual) entre cliente e baseline. */
  23 | export async function captureNormalizedHtml(page: Page, selector = 'body'): Promise<string> {
  24 |   const html = await page.locator(selector).innerHTML();
  25 |   return normalizeHtml(html);
  26 | }
  27 | 
```