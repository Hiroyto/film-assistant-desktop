// Session controller — token refresh OS-aware (AD-03 / BR-MIGRAR-007) + flush
// on-quit (BR-MIGRAR-008). Wira o JIT refresh no safeApiCall (configureApi).
//
// Mecanismos paralelos e idempotentes (AD-03):
//   (1) JIT refresh em cada chamada (via configureApi → safeApiCall).
//   (2) setInterval 20min (preserva o comportamento legado).
//   (3) listener OS `resumed` → refresh imediato (cobre sleep do laptop).
//   (4) `before-quit` (desktop) / `beforeunload` (web) → flush local + sync queue.
import { configureApi } from '../../../models/apiHelpers';
import { getFreshToken, forceRefreshToken } from '../api/cognito';
import { onOsEvent } from '../../../lib/ipcClient';

export const TOKEN_REFRESH_INTERVAL_MS = 1_200_000; // 20 min (BR-MIGRAR-007)

export interface SessionHandlers {
  /** Recebe o token atualizado (App.setToken). */
  onToken?: (token: string | null) => void;
  /** Disparado ao acordar o OS — útil para um pull de sync (Tarefa 10+). */
  onResume?: () => void;
  /** Flush local-db + sync queue antes de encerrar (BR-MIGRAR-008). */
  flush?: () => Promise<void> | void;
}

/** Inicia a sessão OS-aware. Retorna `stop()` para limpar listeners/intervalos. */
export function startSession(handlers: SessionHandlers = {}): () => void {
  // (1) JIT refresh em toda chamada autenticada.
  configureApi({ getFreshToken });

  // (2) refresh periódico 20min.
  const interval = setInterval(async () => {
    try {
      handlers.onToken?.(await getFreshToken());
    } catch (e) {
      console.error('[session] refresh interval falhou', e);
    }
  }, TOKEN_REFRESH_INTERVAL_MS);

  // (3) OS resume → refresh imediato + hook de pull.
  const offResume = onOsEvent('resumed', async () => {
    try {
      handlers.onToken?.(await forceRefreshToken());
    } catch (e) {
      console.error('[session] refresh on resume falhou', e);
    }
    handlers.onResume?.();
  });

  // (4) flush antes de fechar — desktop (before-quit) + web (beforeunload).
  const offQuit = onOsEvent('before-quit', () => {
    void handlers.flush?.();
  });
  const onBeforeUnload = () => {
    void handlers.flush?.();
  };
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    clearInterval(interval);
    offResume();
    offQuit();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload);
    configureApi({ getFreshToken: null });
  };
}
