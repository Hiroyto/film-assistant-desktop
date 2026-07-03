// sync-queue — API de alto nível do AGG-LocalSync (enqueue de mutations).
// Toda mutation local que precisa ir ao backend passa por aqui. O push-worker
// (sync-agent/push-queue) consome a fila.
import { syncQueueRepo } from './local-db/repositories';
import { newRequestId } from './sync-agent/idempotency';
import { emit } from './sync-agent/events';
import type { SyncEntityType, SyncOperation, SyncQueueRow } from './local-db/rows';

export interface EnqueueInput {
  entityType: SyncEntityType;
  /** Chave composta serializada, ex: "<story_id>" ou "<story_id>:<character_name>". */
  entityId: string;
  operation: SyncOperation;
  /** Delta a enviar (será JSON.stringify). */
  payload: unknown;
}

/** Enfileira uma mutation. Gera id + request_id (idempotência). Acorda o worker via evento. */
export async function enqueueMutation(input: EnqueueInput): Promise<SyncQueueRow> {
  const now = new Date().toISOString();
  const entry: SyncQueueRow = {
    id: newRequestId(),
    request_id: newRequestId(),
    entity_type: input.entityType,
    entity_id: input.entityId,
    operation: input.operation,
    payload: JSON.stringify(input.payload),
    attempts: 0,
    last_attempt_at: null,
    next_attempt_at: now, // processável imediatamente
    status: 'pending',
    failure_reason: null,
    conflict_metadata: null,
    created_at: now,
  };
  await syncQueueRepo.enqueue(entry);
  await emitDepth();
  return entry;
}

export async function emitDepth(): Promise<void> {
  emit('sync.queue.depth', { n: await syncQueueRepo.depth() });
}
