# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 11-screens-literal-visual-parity.spec.ts >> @paridade-visual telas literal (26) >> @paridade-visual @critico SCR-0013 scenes.cards-per-segment 
- Location: parity\specs\11-screens-literal-visual-parity.spec.ts:47:9

# Error details

```
Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\scenes-cards-per-segment-desktop-win32.png, writing actual.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - img [ref=e4]
  - status "All changes saved locally and synced to cloud." [ref=e9]:
    - img [ref=e10]
    - generic [ref=e13]: Synced
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
     |   ^ Error: A snapshot doesn't exist at C:\Otavio\filmassistantai-electron\filmassistant-desktop\parity\specs\11-screens-literal-visual-parity.spec.ts-snapshots\scenes-cards-per-segment-desktop-win32.png, writing actual.
  20 | }
  21 | 
  22 | /** Comparação de HTML normalizado (golden-file textual) entre cliente e baseline. */
  23 | export async function captureNormalizedHtml(page: Page, selector = 'body'): Promise<string> {
  24 |   const html = await page.locator(selector).innerHTML();
  25 |   return normalizeHtml(html);
  26 | }
  27 | 
```