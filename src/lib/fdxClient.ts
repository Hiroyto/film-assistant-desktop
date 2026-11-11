// fdxClient — acesso do renderer ao cowork de roteiro do shell (SOMENTE LEITURA):
// um .fdx ou um .fountain observado no disco.
// Degrada na web (sem shell): openFdx retorna null, onFdxChanged é no-op.
// FdxPayload/FdxScene são tipos globais (src/electron.d.ts).
//
// É aqui que um .fountain vira cenas: o shell manda o texto cru e o parser
// Fountain vive só no renderer (hydrateFountainPayload). Quem consome o cliente
// (o motor lib/fdxSync, o FdxCoworkPanel) recebe sempre o payload completo.
import { isDesktop } from './ipcClient';
import { hydrateFountainPayload } from './fountainCowork';

/** Abre o seletor de roteiro (.fdx / .fountain) e começa a observá-lo. Retorna
 *  o snapshot inicial (ou null). */
export function openFdx(): Promise<FdxPayload | null> {
  if (isDesktop() && window.electronAPI?.openFdx) return window.electronAPI.openFdx().then(hydrateFountainPayload);
  return Promise.resolve(null);
}

/** Volta a observar um arquivo conhecido, sem seletor (reconexão do cowork ao
 *  reabrir o app). null = o arquivo não está mais lá — ou não há shell. */
export function watchFdx(path: string): Promise<FdxPayload | null> {
  if (isDesktop() && window.electronAPI?.watchFdx) return window.electronAPI.watchFdx(path).then(hydrateFountainPayload);
  return Promise.resolve(null);
}

/** Para de observar o arquivo atual. */
export function closeFdx(): Promise<void> {
  if (isDesktop() && window.electronAPI?.closeFdx) return window.electronAPI.closeFdx();
  return Promise.resolve();
}

/** Inscreve um handler para mudanças do arquivo observado. Retorna unsubscribe. */
export function onFdxChanged(handler: (payload: FdxPayload) => void): () => void {
  if (isDesktop() && window.electronAPI?.onFdxChanged) {
    return window.electronAPI.onFdxChanged((payload) => handler(hydrateFountainPayload(payload)));
  }
  return () => {};
}
