// Async character refresh (BC-05 / AD-05 / BR-MIGRAR-022). Corrige o spinner-forever
// (tech-debt #3): POST /story event=refresh_character_database → 202 → espera WS push
// com WATCHDOG de 5min; requestId tracking ignora respostas tardias; OFFLINE enfileira
// e re-tenta no reconnect.
import { safeApiCall } from '../../../models/apiHelpers';
import { enqueueMutation } from '../../../data/sync-queue';
import { newRequestId, CHARACTER_REFRESH_TIMEOUT_MS } from '../../../data/sync-agent/idempotency';
import { clock, TimerHandle } from '../../../lib/clock';
import { recordActiveRefresh } from '../../../lib/wsTestChannel';
import type { Character } from '../../../models/character';

export type RefreshStatus = 'completed' | 'timeout' | 'failed' | 'queued';

export interface RefreshResult {
  status: RefreshStatus;
  requestId: string;
  characters?: Character[];
  error?: string;
}

export interface RefreshEvents {
  onRequested?: (storyId: string, requestId: string) => void;
  onCompleted?: (storyId: string, requestId: string) => void;
  onTimeout?: (storyId: string, requestId: string) => void;
  onFailed?: (storyId: string, requestId: string, reason: string) => void;
}

export interface RefreshDeps {
  getToken: () => string | Promise<string>;
  isOnline?: () => boolean;
  events?: RefreshEvents;
}

interface Pending {
  storyId: string;
  resolve: (r: RefreshResult) => void;
  timer: TimerHandle;
}

export interface CharacterRefreshController {
  refresh: (storyId: string) => Promise<RefreshResult>;
  /** Chamado pelo useCharacterWsBridge quando chega um WS push com requestId. */
  notifyWsResult: (requestId: string, characters: Character[]) => void;
  hasPending: () => boolean;
}

export function createCharacterRefresh(deps: RefreshDeps): CharacterRefreshController {
  const pending = new Map<string, Pending>();
  const isOnline = () => deps.isOnline?.() ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);

  async function refresh(storyId: string): Promise<RefreshResult> {
    const requestId = newRequestId();
    recordActiveRefresh(requestId); // parity spec 05: emitWsRefresh() sem arg casa este id (inerte em prod)
    deps.events?.onRequested?.(storyId, requestId);

    // Offline: enfileira o refresh; o push-worker re-tenta no reconnect (AD-05).
    if (!isOnline()) {
      await enqueueMutation({
        entityType: 'character_refresh',
        entityId: storyId,
        operation: 'custom',
        payload: { storyId, requestId, trigger: 'manual_refresh' },
      });
      return { status: 'queued', requestId };
    }

    const token = await deps.getToken();
    const res = await safeApiCall(
      'story',
      { event: 'refresh_character_database', storyId, requestId },
      token,
      { idempotencyKey: requestId },
    );
    if (!res.success) {
      const error = res.error ?? 'refresh failed';
      deps.events?.onFailed?.(storyId, requestId, error);
      return { status: 'failed', requestId, error };
    }

    // 202 aceito → espera WS push com watchdog 5min (fix tech-debt #3).
    return new Promise<RefreshResult>((resolve) => {
      const timer = clock.setTimeout(() => {
        pending.delete(requestId);
        deps.events?.onTimeout?.(storyId, requestId);
        resolve({ status: 'timeout', requestId }); // UI oferece retry
      }, CHARACTER_REFRESH_TIMEOUT_MS);
      pending.set(requestId, { storyId, resolve, timer });
    });
  }

  function notifyWsResult(requestId: string, characters: Character[]): void {
    const p = pending.get(requestId);
    if (!p) return; // requestId desconhecido/stale → ignora (AD-05)
    clock.clearTimeout(p.timer);
    pending.delete(requestId);
    deps.events?.onCompleted?.(p.storyId, requestId);
    p.resolve({ status: 'completed', requestId, characters });
  }

  return { refresh, notifyWsResult, hasPending: () => pending.size > 0 };
}
