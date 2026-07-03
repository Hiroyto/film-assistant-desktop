# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 11-screens-literal-visual-parity.spec.ts >> @paridade-visual telas literal (26) >> @paridade-visual @critico SCR-0022 pricing.3-plans-page DEV-010
- Location: parity\specs\11-screens-literal-visual-parity.spec.ts:47:9

# Error details

```
Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\pricing-3-plans-page-desktop-win32.png, writing actual.
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
    - generic [ref=e33]:
      - heading "Choose Your Plan" [level=1] [ref=e34]
      - generic [ref=e35]:
        - generic [ref=e36]:
          - generic [ref=e37]: Most Popular
          - generic [ref=e38]:
            - heading "Member" [level=2] [ref=e39]
            - generic [ref=e40]:
              - text: $8.00
              - generic [ref=e41]: /month
          - list [ref=e42]:
            - listitem [ref=e43]:
              - img [ref=e44]
              - text: ~750 generations per month
            - listitem [ref=e46]:
              - img [ref=e47]
              - text: Access to Community
            - listitem [ref=e49]:
              - img [ref=e50]
              - text: Participate in Weekly Contests
            - listitem [ref=e52]:
              - img [ref=e53]
              - text: Better Rate on Tokens
            - listitem [ref=e55]:
              - img [ref=e56]
              - text: Cheaper Token Refills
          - button "Buy Plan" [ref=e58] [cursor=pointer]
        - generic [ref=e59]:
          - generic [ref=e60]:
            - heading "Base Token Package" [level=2] [ref=e61]
            - generic [ref=e62]:
              - text: $12.00
              - generic [ref=e63]: one-time
          - list [ref=e64]:
            - listitem [ref=e65]:
              - img [ref=e66]
              - text: ~750 generations
            - listitem [ref=e68]:
              - img [ref=e69]
              - text: Create more stories
            - listitem [ref=e71]:
              - img [ref=e72]
              - text: Create more summaries
            - listitem [ref=e74]:
              - img [ref=e75]
              - text: One time purchase
          - button "Buy Tokens" [ref=e77] [cursor=pointer]
        - generic [ref=e78]:
          - generic [ref=e79]:
            - heading "Member Token Refill" [level=2] [ref=e80]
            - generic [ref=e81]:
              - text: $4.50
              - generic [ref=e82]: refill
          - list [ref=e83]:
            - listitem [ref=e84]:
              - img [ref=e85]
              - text: ~750 generations
            - listitem [ref=e87]:
              - img [ref=e88]
              - text: Member discount applied
            - listitem [ref=e90]:
              - img [ref=e91]
              - text: One time purchase
            - listitem [ref=e93]:
              - img [ref=e94]
              - text: Member access only
          - button "Member Access Only" [disabled] [ref=e96]
    - contentinfo [ref=e97]:
      - generic [ref=e100]:
        - paragraph [ref=e101]: © 2026 FilmAssistant Inc. All rights reserved.
        - generic [ref=e102]:
          - img [ref=e103]
          - link "accountservices@filmassistant.io" [ref=e105] [cursor=pointer]:
            - /url: mailto:accountservices@filmassistant.io
        - link "Terms of Service" [ref=e106] [cursor=pointer]:
          - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e108]:
    - img [ref=e109]
    - generic [ref=e112]: Synced
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
     |   ^ Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\pricing-3-plans-page-desktop-win32.png, writing actual.
  20 | }
  21 | 
  22 | /** Comparação de HTML normalizado (golden-file textual) entre cliente e baseline. */
  23 | export async function captureNormalizedHtml(page: Page, selector = 'body'): Promise<string> {
  24 |   const html = await page.locator(selector).innerHTML();
  25 |   return normalizeHtml(html);
  26 | }
  27 | 
```