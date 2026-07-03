// Platform — abertura de URLs externas (shell.openExternal). Usado pelo Stripe
// deep link (AD-04) e por qualquer link que deva sair para o browser do OS.
import { shell } from 'electron';
import { IS_TEST, recordExternal } from '../test/testState';

/**
 * Abre uma URL no browser externo do OS. Por segurança, só permite http(s)
 * (evita abrir esquemas arbitrários a partir do renderer).
 */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn('[platform] openExternal: URL inválida', url);
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.warn('[platform] openExternal: esquema bloqueado', parsed.protocol);
    return;
  }
  recordExternal(url); // no-op fora do modo teste
  // Em teste não abrimos o browser real; o spec observa via window.__TEST__.lastOpenExternal().
  if (IS_TEST) return;
  await shell.openExternal(url);
}
