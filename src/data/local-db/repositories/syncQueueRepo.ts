// syncQueueRepo (BC-08). Persiste/consulta mutations pendentes (AGG-LocalSync).
import { all, get, run } from '../db';
import type { SyncQueueRow } from '../rows';

export async function enqueue(entry: SyncQueueRow): Promise<void> {
  await run(
    `INSERT INTO sync_queue
       (id, request_id, entity_type, entity_id, operation, payload, attempts,
        last_attempt_at, next_attempt_at, status, failure_reason, conflict_metadata, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      entry.id, entry.request_id, entry.entity_type, entry.entity_id, entry.operation,
      entry.payload, entry.attempts, entry.last_attempt_at, entry.next_attempt_at,
      entry.status, entry.failure_reason, entry.conflict_metadata, entry.created_at,
    ],
  );
}

/** Próximas entries processáveis (pending/failed com next_attempt_at <= now), FIFO. */
export async function listProcessable(now: string, limit = 10): Promise<SyncQueueRow[]> {
  return all<SyncQueueRow>(
    `SELECT * FROM sync_queue
       WHERE status IN ('pending','failed')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`,
    [now, limit],
  );
}

export async function markInFlight(id: string, at: string): Promise<void> {
  await run("UPDATE sync_queue SET status='in_flight', last_attempt_at=? WHERE id=?", [at, id]);
}

/** Sucesso: entry é removida (não acumula histórico — domain model). */
export async function markSucceeded(id: string): Promise<void> {
  await run('DELETE FROM sync_queue WHERE id=?', [id]);
}

export async function markFailed(
  id: string,
  attempts: number,
  nextAttemptAt: string | null,
  reason: string,
  status: 'pending' | 'failed',
): Promise<void> {
  await run(
    'UPDATE sync_queue SET status=?, attempts=?, next_attempt_at=?, failure_reason=? WHERE id=?',
    [status, attempts, nextAttemptAt, reason, id],
  );
}

export async function markConflict(id: string, metadata: string): Promise<void> {
  await run("UPDATE sync_queue SET status='conflict', conflict_metadata=? WHERE id=?", [metadata, id]);
}

export async function findByRequestId(requestId: string): Promise<SyncQueueRow | null> {
  return get<SyncQueueRow>('SELECT * FROM sync_queue WHERE request_id=?', [requestId]);
}

/** Profundidade da fila (entries ainda não resolvidas) — sync-status-bar. */
export async function depth(): Promise<number> {
  const row = await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue WHERE status != 'succeeded'",
  );
  return row?.n ?? 0;
}

/**
 * Re-arma entries que DESISTIRAM (status='failed', next_attempt_at=NULL — que o
 * listProcessable ignora, pois `NULL <= now` é falso) para reprocessamento
 * imediato: volta a 'pending' com next_attempt_at=now e zera attempts. Usado só
 * pelo "Retry sync" manual — o backoff automático não ressuscita gave-ups, mas o
 * usuário pode forçar (ex.: depois que a conectividade/CORS foi corrigida).
 */
export async function rearmFailed(now: string): Promise<void> {
  await run(
    "UPDATE sync_queue SET status='pending', attempts=0, next_attempt_at=?, failure_reason=NULL WHERE status='failed'",
    [now],
  );
}

/**
 * Recupera entries ÓRFÃS em 'in_flight'. markInFlight é um LEASE sem dono: se o
 * processo morre entre ele e o veredito (app fechado no meio do POST, reload do
 * renderer, exceção antes do markFailed), a entry fica 'in_flight' para sempre —
 * listProcessable só olha 'pending'/'failed' e nem o "Retry sync" (rearmFailed)
 * a ressuscita. Consequência real: a story nunca chega ao /works, e o backend do
 * freeform passa a negar suas escritas com "Not authorized for this story".
 *
 * `leaseMs` protege quem está genuinamente em voo: só entries cujo last_attempt_at
 * é mais velho que o lease voltam para 'pending'. No boot use 0 — nada pode estar
 * em voo antes do worker existir. `attempts` NÃO é incrementado: a tentativa
 * nunca teve veredito, então não deve contar para o give-up.
 */
export async function reclaimStaleInFlight(now: string, leaseMs = 0): Promise<number> {
  const cutoff = new Date((Date.parse(now) || Date.now()) - leaseMs).toISOString();
  const res = await run(
    `UPDATE sync_queue
        SET status='pending', next_attempt_at=?
      WHERE status='in_flight'
        AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`,
    [now, cutoff],
  );
  return res?.changes ?? 0;
}

export async function clear(): Promise<void> {
  await run('DELETE FROM sync_queue', []);
}
