// push-queue — worker que drena a sync_queue para o backend AWS (data_migration_plan
// §Ongoing push). Idempotência (COD-008) via `requestId` no BODY (não no header
// X-Request-Id — ver nota de CORS abaixo) e política de backoff (idempotency.ts).
// 409 -> conflict; 5xx/network -> backoff; sucesso -> remove + write-back de
// synced_at/version na story local (recordStorySynced — é o que o pull lê).
import { storyRepo, syncQueueRepo } from '../local-db/repositories';
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

    try {
      await pushOne(row, deps, now);
    } catch (e) {
      // markInFlight é um lease sem dono: uma exceção aqui (getToken com sessão
      // expirada, safeApiCall lançando em vez de devolver {success:false}) deixaria
      // a entry presa em 'in_flight' PARA SEMPRE — listProcessable só olha
      // 'pending'/'failed'. Trata como falha normal, com backoff.
      const attempts = row.attempts + 1;
      const giveUp = shouldGiveUp(attempts);
      const reason = (e as Error)?.message ?? 'unknown';
      await syncQueueRepo.markFailed(
        row.id,
        attempts,
        giveUp ? null : nextAttemptAt(attempts, Date.parse(now()) || undefined),
        reason,
        giveUp ? 'failed' : 'pending',
      );
      emit('sync.entry.failed', { entryId: row.id, reason, attempts });
    }
  }

  await refreshState();
}

/** Uma entry: POST + veredito (sucesso/conflito/falha). Pode lançar — o caller trata. */
async function pushOne(
  row: SyncQueueRow,
  deps: PushDeps,
  now: () => string,
): Promise<void> {
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
    await recordStorySynced(row, res.data, now);
    emit('sync.entry.succeeded', { entryId: row.id, entityType: row.entity_type });
    return;
  }

  const status: number | undefined = res.originalError?.response?.status;
  if (status === 409) {
    // Conflito server-side (version mismatch) -> UI prompt (AD-02).
    await syncQueueRepo.markConflict(row.id, JSON.stringify(res.originalError?.response?.data ?? {}));
    emit('sync.conflict', { entityType: row.entity_type, entityId: row.entity_id });
    return;
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

// --- Write-back do sync na story -------------------------------------------
// O pull acusa conflito por (updated_at > synced_at) E (remote.version >
// local.version). O backend incrementa `version` em TODO save (também em
// update-characters e save-screenplay). Sem gravar synced_at/version de volta
// depois do push, toda story já salva ficava "pendente" para sempre e uma
// version atrás — e o pull de cada boot acusava o mesmo conflito sem nada novo.

/** Entries que tocam uma story: 'story' (id puro ou "<storyId>:<segment>", do save-scenes), characters e screenplay (keyed pelo storyId). */
const STORY_SCOPED: ReadonlySet<SyncEntityType> = new Set(['story', 'character', 'screenplay']);

export function storyIdOfEntry(row: Pick<SyncQueueRow, 'entity_type' | 'entity_id'>): string | null {
  if (!STORY_SCOPED.has(row.entity_type)) return null;
  const id = String(row.entity_id ?? '').split(':')[0].trim();
  return id || null;
}

/**
 * `works[storyId].version` da resposta do /works (toda operação devolve o mapa
 * `works` inteiro). Tolerante ao envelope da API Gateway: `{ body: "<json>" }`,
 * `{ body: {...} }` ou o próprio body. null quando não dá para saber.
 */
export function versionFromWorksResponse(data: unknown, storyId: string): number | null {
  let body: unknown = data;
  if (body && typeof body === 'object' && 'body' in (body as Record<string, unknown>)) {
    body = (body as Record<string, unknown>).body;
  }
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return null;
  const works = (body as Record<string, unknown>).works;
  const story = works && typeof works === 'object' ? (works as Record<string, unknown>)[storyId] : undefined;
  const raw = story && typeof story === 'object' ? (story as Record<string, unknown>).version : undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Após um push bem-sucedido, grava na story local o que o backend passou a ter:
 *   - 'story' (save / save-scenes): synced_at = created_at da entry (o momento em
 *     que o payload foi capturado — um save local posterior continua pendente) e
 *     version = a devolvida pelo backend;
 *   - 'character' / 'screenplay': só a version (o conteúdo da story não mudou).
 * Sem a version na resposta, aplica a regra da Lambda: local + 1. Falha aqui NÃO
 * re-enfileira (o backend já tem a mutation): no pior caso o pull seguinte vê um
 * conflito a mais.
 */
async function recordStorySynced(row: SyncQueueRow, data: unknown, now: () => string): Promise<void> {
  if (row.operation === 'delete') return;
  const storyId = storyIdOfEntry(row);
  if (!storyId) return;
  try {
    let version = versionFromWorksResponse(data, storyId);
    if (version == null) {
      const local = await storyRepo.getStory(storyId);
      if (!local) return;
      version = local.version + 1;
    }
    if (row.entity_type === 'story') {
      const at = Number.isFinite(Date.parse(row.created_at)) ? row.created_at : now();
      await storyRepo.markSynced(storyId, at, version);
    } else {
      await storyRepo.setVersion(storyId, version);
    }
  } catch (e) {
    console.warn('[push-queue] write-back de synced_at/version falhou', { storyId, entityType: row.entity_type }, e);
  }
}

async function refreshState(): Promise<void> {
  const n = await syncQueueRepo.depth();
  emit('sync.queue.depth', { n });
  emit('sync.state', { state: n > 0 ? 'offline' : 'online' });
}
