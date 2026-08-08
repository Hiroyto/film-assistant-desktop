// fdxClient — acesso do renderer ao protótipo de coworking .fdx (SOMENTE LEITURA).
// Degrada na web (sem shell): openFdx retorna null, onFdxChanged é no-op.
// FdxPayload/FdxScene são tipos globais (src/electron.d.ts).
import { isDesktop } from './ipcClient';

/** Abre o seletor de .fdx e começa a observá-lo. Retorna o snapshot inicial (ou null). */
export function openFdx(): Promise<FdxPayload | null> {
  if (isDesktop() && window.electronAPI?.openFdx) return window.electronAPI.openFdx();
  return Promise.resolve(null);
}

/** Para de observar o .fdx atual. */
export function closeFdx(): Promise<void> {
  if (isDesktop() && window.electronAPI?.closeFdx) return window.electronAPI.closeFdx();
  return Promise.resolve();
}

/** Inscreve um handler para mudanças do .fdx observado. Retorna unsubscribe. */
export function onFdxChanged(handler: (payload: FdxPayload) => void): () => void {
  if (isDesktop() && window.electronAPI?.onFdxChanged) return window.electronAPI.onFdxChanged(handler);
  return () => {};
}
