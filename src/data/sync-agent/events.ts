// Barramento de eventos de sync (in-memory) — AGG-LocalSync events (domain model).
// Eventos são locais ao desktop (não atravessam o backend). A sync-status-bar e
// outras views se inscrevem aqui.

export type SyncState = 'online' | 'syncing' | 'offline' | 'conflict';

export interface SyncEvents {
  'sync.state': { state: SyncState };
  'sync.queue.depth': { n: number };
  'sync.entry.in_flight': { entryId: string; entityType: string };
  'sync.entry.succeeded': { entryId: string; entityType: string };
  'sync.entry.failed': { entryId: string; reason: string; attempts: number };
  'sync.conflict': { entityType: string; entityId: string; snapshotId?: string };
  'sync.conflict.resolved': { entityType: string; entityId: string };
  'sync.applied': { entityType: string; entityId: string };
  'sync.initial_pull.completed': { userId: string };
}

type Handler<T> = (payload: T) => void;

// Map evita a variância do mapped-type indexado por K genérico (handlers são any-cast).
const listeners = new Map<keyof SyncEvents, Set<(payload: any) => void>>();

export function on<K extends keyof SyncEvents>(event: K, handler: Handler<SyncEvents[K]>): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as (payload: any) => void);
  return () => listeners.get(event)?.delete(handler as (payload: any) => void);
}

export function emit<K extends keyof SyncEvents>(event: K, payload: SyncEvents[K]): void {
  listeners.get(event)?.forEach((h) => {
    try {
      h(payload);
    } catch (err) {
      console.error(`[sync events] handler de ${String(event)} lançou`, err);
    }
  });
}
