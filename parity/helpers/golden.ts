// Golden file comparison (modo literal — parity_specs §paridade visual). Captura
// snapshot HTML+CSS sob normalizationRules e compara com tolerância de pixel ≤1%.
// As 26 telas literal usam isto; é o oráculo = web SPA rodando local.
import { Page, expect } from '@playwright/test';

/** normalizationRules de screens/golden/manifest.yaml (line endings, tokens, etc). */
export function normalizeHtml(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/gm, '')
    .replace(/data-reactid="[^"]*"/g, '') // ids voláteis
    .trim();
}

/** Snapshot visual (pixel) da tela — nome estável por tela. */
export async function expectVisualParity(page: Page, screenName: string): Promise<void> {
  // Aguarda idle (sem animações in-flight) antes do snapshot.
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot(`${screenName}.png`, { animations: 'disabled' });
}

/** Comparação de HTML normalizado (golden-file textual) entre cliente e baseline. */
export async function captureNormalizedHtml(page: Page, selector = 'body'): Promise<string> {
  const html = await page.locator(selector).innerHTML();
  return normalizeHtml(html);
}
