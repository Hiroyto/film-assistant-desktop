// pull-strategy — ongoing pull / delta sync (data_migration_plan §Ongoing pull).
// Triggers (agendados pela Tarefa 08/feature): boot, periodic 5min, os.online, WS
// reconnect. Usa version-reconcile para decidir e transforms para normalizar.
import { mapStoryToRow, normalizeCharacters, RawStory } from './transforms';
import { decidePullAction, isPullConflict } from './version-reconcile';
import { storyRepo, characterRepo } from '../local-db/repositories';
import { emit } from './events';

export interface PullDeps {
  userId: string;
  /** GET /works (com ?since= se suportado — COD-009; senão full). */
  getWorks: (since?: string) => Promise<RawStory[]>;
  /** synced_at do último pull (para delta). null = full pull. */
  since?: string | null;
  now?: () => string;
  /** Chamado quando um conflito de edição multi-device é detectado (AD-02). */
  onConflict?: (storyId: string) => void;
}

export interface PullReport {
  applied: number;
  skipped: number;
  conflicts: number;
}

/** Executa um ciclo de pull. Aplica deltas; encaminha conflitos para resolução. */
export async function runPull(deps: PullDeps): Promise<PullReport> {
  const now = deps.now ?? (() => new Date().toISOString());
  emit('sync.state', { state: 'syncing' });

  const works = await deps.getWorks(deps.since ?? undefined);
  let applied = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const raw of works) {
    let remoteRow;
    try {
      remoteRow = mapStoryToRow(raw, { userId: deps.userId, now: now() });
    } catch {
      continue; // story malformada — pula sem abortar o ciclo
    }

    const local = await storyRepo.getStory(remoteRow.story_id);
    const localState = local
      ? { version: local.version, updated_at: local.updated_at, synced_at: local.synced_at }
      : null;
    const remoteState = {
      version: remoteRow.version,
      updated_at: remoteRow.updated_at,
      synced_at: remoteRow.synced_at,
    };

    // Conflito multi-device: edição local pendente + remoto avançou (AD-02).
    if (isPullConflict(localState, remoteState)) {
      conflicts++;
      emit('sync.conflict', { entityType: 'story', entityId: remoteRow.story_id });
      deps.onConflict?.(remoteRow.story_id);
      continue;
    }

    const action = decidePullAction(localState, remoteState);
    if (action === 'apply_remote' || action === 'lww_remote') {
      await storyRepo.upsertStory(remoteRow);
      const { rows } = normalizeCharacters(raw.characters, remoteRow.story_id, now());
      await characterRepo.replaceCharactersForStory(remoteRow.story_id, rows);
      applied++;
      emit('sync.applied', { entityType: 'story', entityId: remoteRow.story_id });
    } else {
      skipped++;
    }
  }

  emit('sync.state', { state: 'online' });
  return { applied, skipped, conflicts };
}
