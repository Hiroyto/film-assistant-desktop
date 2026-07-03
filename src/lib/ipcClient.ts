// ipcClient — ponto único de acesso do renderer ao shell (BC-10 / borda AD-07).
//
// Degrada graciosamente na web: quando `window.electronAPI` é ausente, os helpers
// retornam valores neutros. A superfície de IPC cresce na Tarefa 06 (shell/ipc) e
// Tarefa 07 (db.query). Use SEMPRE através deste módulo — não acesse window.electronAPI
// espalhado pelo código.

/** True quando rodando dentro do shell Electron (desktop). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.isDesktop;
}

/** Plataforma do OS quando no desktop; null na web. */
export function getPlatform(): string | null {
  return (typeof window !== 'undefined' && window.electronAPI?.platform) || null;
}

/**
 * Abre uma URL no browser externo do OS no desktop; na web faz fallback para
 * navegação na mesma aba (comportamento legado). Base do Stripe deep link (AD-04).
 */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop() && window.electronAPI?.openExternal) {
    await window.electronAPI.openExternal(url);
    return;
  }
  // Web (Strangler Fig): comportamento legado window.open(url, '_self').
  if (typeof window !== 'undefined') window.open(url, '_self');
}

/**
 * Inscreve um handler para deep links filmassistant:// (Stripe/Cognito callbacks).
 * Retorna função de unsubscribe. No-op na web (retorna unsubscribe vazio).
 */
export function onDeepLink(handler: (payload: DeepLinkPayload) => void): () => void {
  if (isDesktop() && window.electronAPI?.onDeepLink) {
    return window.electronAPI.onDeepLink(handler);
  }
  return () => {};
}

/**
 * Inscreve handler de eventos OS lifecycle (resume / before-quit / online / offline)
 * — AD-03/Implicação 5. No-op na web.
 */
export function onOsEvent(
  event: 'resumed' | 'before-quit' | 'online' | 'offline',
  handler: () => void,
): () => void {
  if (isDesktop() && window.electronAPI?.onOsEvent) {
    return window.electronAPI.onOsEvent(event, handler);
  }
  return () => {};
}
