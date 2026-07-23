// push-queue — worker que drena a sync_queue para o backend AWS (data_migration_plan
// §Ongoing push). Idempotência (COD-008) via `requestId` no BODY (não no header
// X-Request-Id — ver nota de CORS abaixo) e política de backoff (idempotency.ts).
// 409 -> conflict; 5xx/network -> backoff; sucesso -> remove.
import { syncQueueRepo } from '../local-db/repositories';
import { safeApiCall } from '../../models/apiHelpers';
import { nextAttemptAt, shouldGiveUp } from './idempotency';
import { emit } from './events';
import { recordPush } from './pushRecorder';
import type { SyncEntityType, SyncQueueRow } from '../local-db/rows';

export interface PushDeps {
  /** Token Cognito atual (a auth wira na Tarefa 08). */
  getToken: () => string | Promise<string>;
  /** Resolve o endpoint REST para uma entry (override do default). */
  resolveEndpoint?: (row: SyncQueueRow) => string;
  now?: () => string;
}

// Endpoints default por entity_type (data_migration_plan §Ongoing push).
const DEFAULT_ENDPOINTS: Record<SyncEntityType, string> = {
  story: 'works',
  screenplay: 'works',
  character: 'works',
  user: 'user',
  subscription: 'user',
  character_refresh: 'story',
};

/** Processa um lote (~10) de entries pendentes. Reentrante; chamar em loop/intervalo. */
export async function processQueue(deps: PushDeps): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const rows = await syncQueueRepo.listProcessable(now());
  if (rows.length === 0) {
    await refreshState();
    return;
  }

  emit('sync.state', { state: 'syncing' });

  for (const row of rows) {
    await syncQueueRepo.markInFlight(row.id, now());
    emit('sync.entry.in_flight', { entryId: row.id, entityType: row.entity_type });

    const token = await deps.getToken();
    const endpoint = deps.resolveEndpoint?.(row) ?? DEFAULT_ENDPOINTS[row.entity_type] ?? 'works';
    let body: unknown = {};
    try {
      body = JSON.parse(row.payload);
    } catch {
      /* payload inválido tratado como erro permanente abaixo */
    }
    // COD-008: o request_id viaja no BODY (campo `requestId`) — a Lambda /works roda
    // em integração non-proxy e lê a idempotência daqui, não do header X-Request-Id.
    if (body && typeof body === 'object') {
      (body as Record<string, unknown>).requestId = row.request_id;
    }

    // Ordem em que o backend recebe a mutation (spec 03 @ordem). No-op fora de teste.
    recordPush(row.request_id);
    // CORS (desktop): NÃO enviamos o header X-Request-Id. Ele obrigaria o preflight a
    // exigir `x-request-id` em Access-Control-Allow-Headers, que a API Gateway não
    // libera para a origem do desktop (file://null / localhost) — o POST virava
    // "CORS error" (enquanto chamadas sem esse header, como o delete, passam). A
    // idempotência não depende do header: o request_id já vai no BODY (acima).
    // noRetry: o retry é controlado pela FILA (backoff persistente), não pelo safeApiCall.
    const res = await safeApiCall(endpoint, body, token, {
      noRetry: true,
    });

    if (res.success) {
      await syncQueueRepo.markSucceeded(row.id);
      emit('sync.entry.succeeded', { entryId: row.id, entityType: row.entity_type });
      continue;
    }

    const status: number | undefined = res.originalError?.response?.status;
    if (status === 409) {
      // Conflito server-side (version mismatch) -> UI prompt (AD-02).
      await syncQueueRepo.markConflict(row.id, JSON.stringify(res.originalError?.response?.data ?? {}));
      emit('sync.conflict', { entityType: row.entity_type, entityId: row.entity_id });
      continue;
    }

    const attempts = row.attempts + 1;
    const giveUp = shouldGiveUp(attempts);
    await syncQueueRepo.markFailed(
      row.id,
      attempts,
      giveUp ? null : nextAttemptAt(attempts, Date.parse(now()) || undefined),
      res.error ?? 'unknown',
      giveUp ? 'failed' : 'pending',
    );
    emit('sync.entry.failed', { entryId: row.id, reason: res.error ?? 'unknown', attempts });
  }

  await refreshState();
}

async function refreshState(): Promise<void> {
  const n = await syncQueueRepo.depth();
  emit('sync.queue.depth', { n });
  emit('sync.state', { state: n > 0 ? 'offline' : 'online' });
}
