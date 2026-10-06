// pull-strategy — ongoing pull / delta sync (data_migration_plan §Ongoing pull).
// Triggers (agendados pela Tarefa 08/feature): boot, periodic 5min, os.online, WS
// reconnect. Usa version-reconcile para decidir e transforms para normalizar.
import { mapStoryToRow, normalizeCharacters, RawStory } from './transforms';
import { decidePullAction, isPullConflict } from './version-reconcile';
import { storyRepo, characterRepo, syncQueueRepo } from '../local-db/repositories';
import { emit } from './events';
import type { StoryRow } from '../local-db/rows';

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

/**
 * Folga após o último save local dentro da qual uma mutação pode ainda não ter
 * entrado na fila (o saveStory enfileira com debounce de 10 s). Fora dela, fila
 * vazia para a story significa "tudo o que havia local já foi entregue".
 */
export const LOCAL_SETTLE_MS = 60_000;

async function isLocalDelivered(local: StoryRow, nowIso: string): Promise<boolean> {
  const age = (Date.parse(nowIso) || 0) - (Date.parse(local.updated_at) || 0);
  if (age < LOCAL_SETTLE_MS) return false;
  return (await syncQueueRepo.countOpenForStory(local.story_id)) === 0;
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
    // "Pendente" pelos timestamps (updated_at > synced_at) é só uma aproximação:
    // o push antigo nunca gravava synced_at/version de volta, então toda story
    // já salva parecia pendente para sempre e, com o backend incrementando a
    // version a cada save, o pull de cada boot acusava o mesmo conflito. A fila
    // é a resposta exata: sem entry aberta desta story (e fora da janela de
    // debounce), tudo o que havia local foi entregue e o remoto é o superconjunto —
    // aplicar é o certo, conflito não.
    if (isPullConflict(localState, remoteState) && !(local && (await isLocalDelivered(local, now())))) {
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
