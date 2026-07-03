// snapshotRepo (BC-08). Backup pré-sync para conflict resolution / undo (AD-02,
// RISK-003). TTL local ~30 dias (settings.snapshotTTLDays).
import { get, run } from '../db';
import type { SnapshotRow } from '../rows';

export async function create(entry: SnapshotRow): Promise<void> {
  await run(
    `INSERT INTO snapshots
       (id, entity_type, entity_id, before_state, snapshot_at, reason, related_sync_queue_id, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      entry.id, entry.entity_type, entry.entity_id, entry.before_state, entry.snapshot_at,
      entry.reason, entry.related_sync_queue_id, entry.expires_at,
    ],
  );
}

export async function getLatest(entityType: string, entityId: string): Promise<SnapshotRow | null> {
  return get<SnapshotRow>(
    'SELECT * FROM snapshots WHERE entity_type=? AND entity_id=? ORDER BY snapshot_at DESC LIMIT 1',
    [entityType, entityId],
  );
}

/** Remove snapshots expirados (chamado periodicamente). */
export async function pruneExpired(now: string): Promise<void> {
  await run('DELETE FROM snapshots WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
}
