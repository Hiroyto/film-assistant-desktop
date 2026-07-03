// Telemetria mínima (AD-10) — pré-requisito de go/no-go do cutover. Crash reporting
// via Sentry (Electron) + métricas locais (install, conflict count, max queue depth)
// derivadas do barramento de eventos de sync. Tudo é OPCIONAL: sem DSN, só métricas
// locais; Sentry é importado dinamicamente (não quebra build se ausente).
import { on } from '../data/sync-agent/events';
import { getSetting, setSetting } from '../data/local-db/repositories/settingsRepo';
import { isDesktop } from './ipcClient';

export interface TelemetryMetrics {
  installRecordedAt: string | null;
  conflictCount: number;
  maxQueueDepth: number;
  lastSyncCompletedAt: string | null;
}

const metrics: TelemetryMetrics = {
  installRecordedAt: null,
  conflictCount: 0,
  maxQueueDepth: 0,
  lastSyncCompletedAt: null,
};

let unsubscribers: Array<() => void> = [];

export interface TelemetryOptions {
  /** DSN do Sentry. Sem ele, crash reporting é desabilitado (só métricas locais). */
  sentryDsn?: string;
  release?: string; // ex: 'film-assistant-desktop@1.0.0'
  environment?: 'beta' | 'production' | 'development';
}

/** Inicializa a telemetria. Idempotente. Retorna stop(). */
export async function initTelemetry(opts: TelemetryOptions = {}): Promise<() => void> {
  // Crash reporting (Sentry) — dinâmico para não acoplar o build.
  if (opts.sentryDsn) {
    try {
      // @ts-ignore — @sentry/electron só existe no build desktop (package.electron.json),
      // não no build web. Import dinâmico opcional; ausência cai no catch.
      const Sentry = await import('@sentry/electron/renderer');
      Sentry.init({ dsn: opts.sentryDsn, release: opts.release, environment: opts.environment });
    } catch (err) {
      console.warn('[telemetry] Sentry indisponível — seguindo só com métricas locais', err);
    }
  }

  // Registra o install uma única vez.
  if (isDesktop()) {
    const recorded = await getSetting<string>('installRecordedAt');
    if (recorded) {
      metrics.installRecordedAt = recorded;
    } else {
      const now = new Date().toISOString();
      metrics.installRecordedAt = now;
      await setSetting('installRecordedAt', now);
    }
  }

  // Métricas locais a partir dos eventos de sync (AD-10).
  unsubscribers = [
    on('sync.conflict', () => {
      metrics.conflictCount += 1;
    }),
    on('sync.queue.depth', ({ n }) => {
      if (n > metrics.maxQueueDepth) metrics.maxQueueDepth = n;
    }),
    on('sync.state', ({ state }) => {
      if (state === 'online') metrics.lastSyncCompletedAt = new Date().toISOString();
    }),
  ];

  return stopTelemetry;
}

export function stopTelemetry(): void {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
}

/** Snapshot das métricas locais — alimenta o painel de go/no-go do cutover. */
export function getMetrics(): TelemetryMetrics {
  return { ...metrics };
}
