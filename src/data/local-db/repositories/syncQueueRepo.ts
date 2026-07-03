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

export async function clear(): Promise<void> {
  await run('DELETE FROM sync_queue', []);
}
