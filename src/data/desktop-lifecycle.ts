// Desktop data lifecycle (BC-08 wiring — Fase de Integração, Tarefas 9-13).
//
// Plugs the previously-orphaned local-first engine into the running app. On a
// desktop login it:
//   (1) starts the OS-aware session — wires JIT token refresh into safeApiCall
//       (configureApi), 20-min refresh, OS resume refresh, flush-on-quit;
//   (2) runs the initial pull (backend -> SQLite) on the FIRST desktop login;
//   (3) starts the sync scheduler (periodic pull + sync_queue push).
//
// SAFETY (Strangler Fig): this only READS the backend (POST /user) and WRITES
// the LOCAL SQLite. It NEVER double-writes to the backend — the push-queue only
// sends entries that the legacy UI enqueues, and no live path enqueues yet (the
// legacy DynamoDB save stays the sole writer until the Phase 3 feature cutover).
// Desktop-only: callers MUST guard with isDesktop() (db proxy throws on web).
//
// Every collaborator is injectable (opts.deps) so the orchestration is unit
// testable without Electron, a backend, or aws-amplify.

import { safeApiCall as defaultSafeApiCall } from '../models/apiHelpers';
import {
  getFreshToken as defaultGetFreshToken,
  getMfaState as defaultGetMfaState,
} from '../features/auth/api/cognito';
import { startSession as defaultStartSession } from '../features/auth/model/session';
import {
  runInitialPull as defaultRunInitialPull,
  needsInitialPull as defaultNeedsInitialPull,
} from './sync-agent/initial-pull';
import type {
  InitialPullHttp,
  InitialPullRepos,
  InitialPullReport,
} from './sync-agent/initial-pull';
import { startSyncScheduler as defaultStartScheduler } from './sync-agent/scheduler';
import { processQueue as defaultProcessQueue } from './sync-agent/push-queue';
import { runPull as defaultRunPull } from './sync-agent/pull-strategy';
import { initialPullRepos as defaultRepos } from './local-db/repositories';
import { rearmFailed as defaultRearmFailed } from './local-db/repositories/syncQueueRepo';
import type { RawStory, RawUser } from './sync-agent/transforms';

// --- Injectable collaborators ------------------------------------------------

export interface LifecycleDeps {
  safeApiCall: typeof defaultSafeApiCall;
  getFreshToken: typeof defaultGetFreshToken;
  getMfaState: typeof defaultGetMfaState;
  startSession: typeof defaultStartSession;
  runInitialPull: typeof defaultRunInitialPull;
  needsInitialPull: typeof defaultNeedsInitialPull;
  startSyncScheduler: typeof defaultStartScheduler;
  processQueue: typeof defaultProcessQueue;
  runPull: typeof defaultRunPull;
  /** Re-arma gave-ups da fila (Retry sync manual). @see syncQueueRepo.rearmFailed */
  rearmFailedQueue: (now: string) => Promise<void>;
  repos: InitialPullRepos;
}

const PROD_DEPS: LifecycleDeps = {
  safeApiCall: defaultSafeApiCall,
  getFreshToken: defaultGetFreshToken,
  getMfaState: defaultGetMfaState,
  startSession: defaultStartSession,
  runInitialPull: defaultRunInitialPull,
  needsInitialPull: defaultNeedsInitialPull,
  startSyncScheduler: defaultStartScheduler,
  processQueue: defaultProcessQueue,
  runPull: defaultRunPull,
  rearmFailedQueue: defaultRearmFailed,
  repos: defaultRepos,
};

export interface DesktopLifecycleOptions {
  userId: string;
  /** Email do token (mapUserToRow). */
  getEmail?: () => string | undefined;
  /** Recebe o token atualizado pelo refresh OS-aware (default: ignorado). */
  onToken?: (token: string | null) => void;
  /** Conflito de sync multi-device (AD-02) — abre o modal de resolução. */
  onConflict?: (storyId: string) => void;
  /** Relatório do initial pull (unlock da UI / telemetria). */
  onInitialPull?: (report: InitialPullReport) => void;
  /** Injeção para testes. */
  deps?: Partial<LifecycleDeps>;
}

export interface DesktopLifecycleHandle {
  /** Para sessão + scheduler (cleanup do useEffect). */
  stop: () => void;
  /** Empurra a sync_queue ao backend (flush antes de quit / sign-out — BR-MIGRAR-008). */
  flushAll: () => Promise<void>;
  /** Pull + push manual (botão "Retry sync" da sync-status-bar). */
  syncNow: () => Promise<void>;
  /** Resolve quando o initial pull (se necessário) terminou e o scheduler ligou. */
  ready: Promise<void>;
}

// Singleton do ciclo ativo: permite que UIs (sync-status-bar "Retry sync") disparem
// um sync manual sem prop-drilling do handle pelo componente.
let activeSyncNow: (() => Promise<void>) | null = null;

/** Dispara um pull+push manual no ciclo desktop ativo (no-op se não houver). */
export async function requestSyncNow(): Promise<void> {
  await activeSyncNow?.();
}

// --- Backend contract (legado): tudo vem de POST /user -----------------------
// res.data.body = { cap, subscription, sign_up_date, works, privacy }
// works = { [storyId]: storyData }  (mapa). userId = cognito:username.

/** Mapa de works { storyId: story } | array -> RawStory[] (storyId injetado na chave). */
export function worksToRawStories(works: unknown): RawStory[] {
  if (!works) return [];
  if (Array.isArray(works)) return works as RawStory[];
  if (typeof works === 'object') {
    return Object.entries(works as Record<string, unknown>).map(([storyId, v]) => ({
      storyId,
      ...(v && typeof v === 'object' ? (v as Record<string, unknown>) : {}),
    })) as RawStory[];
  }
  return [];
}

function createBackendHttp(opts: {
  userId: string;
  getEmail?: () => string | undefined;
  deps: LifecycleDeps;
}): {
  http: InitialPullHttp;
  getWorksOngoing: (since?: string) => Promise<RawStory[]>;
  getToken: () => Promise<string>;
} {
  const { userId, getEmail, deps } = opts;
  const email = () => getEmail?.();
  const getToken = async (): Promise<string> => (await deps.getFreshToken()) ?? '';

  async function fetchUserBody(): Promise<Record<string, any>> {
    const res = await deps.safeApiCall('user', { email: email(), userId }, await getToken());
    if (!res.success) throw new Error(res.error || '[desktop-lifecycle] POST /user falhou');
    // Envelope do API Gateway (lambda proxy): { body: {...} }. Tolerante a ausência.
    return (res.data?.body ?? res.data ?? {}) as Record<string, any>;
  }

  // Memo só para o initial pull: getUser + getWorks compartilham UM POST /user.
  let initialBody: Promise<Record<string, any>> | null = null;
  function initialUserBody(): Promise<Record<string, any>> {
    if (!initialBody) initialBody = fetchUserBody();
    return initialBody;
  }

  const http: InitialPullHttp = {
    async getUser(): Promise<RawUser> {
      const body = await initialUserBody();
      // email não vem no body — vem do token (mapUserToRow lê raw.email).
      return { ...body, email: email() } as RawUser;
    },
    async getWorks(): Promise<RawStory[]> {
      const body = await initialUserBody();
      return worksToRawStories(body.works);
    },
    getMfaState: deps.getMfaState,
  };

  // Ongoing pull: fetch fresh a cada ciclo (sem memo) para enxergar deltas.
  // `since` é ignorado por ora: o backend não suporta ?since (COD-009) e POST
  // /user já devolve todas as works; version-reconcile decide apply/skip local.
  const getWorksOngoing = async (_since?: string): Promise<RawStory[]> => {
    try {
      const body = await fetchUserBody();
      return worksToRawStories(body.works);
    } catch (e) {
      console.error('[desktop-lifecycle] ongoing getWorks falhou', e);
      return [];
    }
  };

  return { http, getWorksOngoing, getToken };
}

/**
 * Inicia o ciclo de vida de dados local-first no desktop. Idempotente por user
 * (o initial pull só roda no primeiro login). Retorna um handle com stop()/flushAll().
 */
export function startDesktopDataLifecycle(opts: DesktopLifecycleOptions): DesktopLifecycleHandle {
  const deps: LifecycleDeps = { ...PROD_DEPS, ...(opts.deps ?? {}) };
  const { userId } = opts;
  const { http, getWorksOngoing, getToken } = createBackendHttp({
    userId,
    getEmail: opts.getEmail,
    deps,
  });

  const flushAll = async (): Promise<void> => {
    try {
      await deps.processQueue({ getToken });
    } catch (e) {
      console.error('[desktop-lifecycle] flushAll falhou', e);
    }
  };

  // Pull + push manual (Retry sync). Re-arma primeiro as entries que desistiram
  // (o "Retry" do usuário é um pedido explícito de reprocessar tudo, inclusive
  // gave-ups que o backoff automático não ressuscita — ex.: depois que a
  // conectividade/CORS foi corrigida). Depois pull (deltas do backend) e push.
  // Não-destrutivo.
  const syncNow = async (): Promise<void> => {
    try {
      await deps.rearmFailedQueue(new Date().toISOString());
      await deps.runPull({ userId, getWorks: getWorksOngoing, since: null, onConflict: opts.onConflict });
      await deps.processQueue({ getToken });
    } catch (e) {
      console.error('[desktop-lifecycle] syncNow falhou', e);
    }
  };
  activeSyncNow = syncNow;

  // (1) Sessão OS-aware: configura JIT refresh no safeApiCall + flush on quit.
  const stopSession = deps.startSession({ onToken: opts.onToken, flush: flushAll });

  let stopScheduler: (() => void) | null = null;

  // (2) Initial pull (1º login) -> (3) scheduler. O scheduler liga MESMO se o
  // initial pull falhar (resiliência: o pull periódico se recupera depois).
  const ready: Promise<void> = (async () => {
    try {
      if (await deps.needsInitialPull(userId, deps.repos)) {
        await deps.runInitialPull(userId, http, deps.repos, {
          onCompleted: opts.onInitialPull,
          warn: (m) => console.warn(m),
        });
      }
    } catch (e) {
      console.error('[desktop-lifecycle] initial pull falhou', e);
    } finally {
      stopScheduler = deps.startSyncScheduler({
        getToken,
        userId,
        getWorks: getWorksOngoing,
        getSince: () => null, // full pull (COD-009 ?since pendente no backend)
        onConflict: opts.onConflict,
      });
    }
  })();

  const stop = (): void => {
    stopSession();
    stopScheduler?.();
    if (activeSyncNow === syncNow) activeSyncNow = null;
  };

  return { stop, flushAll, syncNow, ready };
}
