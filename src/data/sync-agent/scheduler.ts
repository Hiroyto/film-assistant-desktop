// Sync scheduler — wira os workers (push-queue/pull-strategy) aos triggers
// (data_migration_plan §Ongoing pull): boot, periodic 5min, OS resume, online,
// before-quit. Composição dos workers da Tarefa 07 (não os modifica).
import { processQueue } from './push-queue';
import { runPull } from './pull-strategy';
import type { RawStory } from './transforms';
import { onOsEvent } from '../../lib/ipcClient';

export const PULL_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export interface SchedulerDeps {
  getToken: () => string | Promise<string>;
  userId: string;
  getWorks: (since?: string) => Promise<RawStory[]>;
  /** synced_at do último pull, para delta (?since=). null = full pull. */
  getSince?: () => string | null;
  onConflict?: (storyId: string) => void;
}

/** Inicia o agendamento de sync. Retorna `stop()`. */
export function startSyncScheduler(deps: SchedulerDeps): () => void {
  const push = () => processQueue({ getToken: deps.getToken });
  const pull = () =>
    runPull({
      userId: deps.userId,
      getWorks: deps.getWorks,
      since: deps.getSince?.() ?? null,
      onConflict: deps.onConflict,
    });
  const cycle = async () => {
    try {
      await pull();
      await push();
    } catch (e) {
      console.error('[sync scheduler] ciclo falhou', e);
    }
  };

  void cycle(); // boot

  const interval = setInterval(() => void cycle(), PULL_INTERVAL_MS);
  const offResume = onOsEvent('resumed', () => void cycle());
  const offQuit = onOsEvent('before-quit', () => void push()); // flush final
  const onOnline = () => void cycle();
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  return () => {
    clearInterval(interval);
    offResume();
    offQuit();
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}
