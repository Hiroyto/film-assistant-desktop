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
import { initialPullRepos as defaultRepos, storyRepo, characterRepo } from './local-db/repositories';
import {
  rearmFailed as defaultRearmFailed,
  reclaimStaleInFlight as defaultReclaimStaleInFlight,
} from './local-db/repositories/syncQueueRepo';
import { mapStoryToRow, normalizeCharacters } from './sync-agent/transforms';
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
  /** Recupera entries presas em 'in_flight'. @see syncQueueRepo.reclaimStaleInFlight */
  reclaimInFlightQueue: (now: string, leaseMs?: number) => Promise<number>;
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
  reclaimInFlightQueue: defaultReclaimStaleInFlight,
  repos: defaultRepos,
};

// Lease do markInFlight: uma entry parada em 'in_flight' há mais tempo que isto
// não tem mais dono (o processo que a pegou morreu) e volta para a fila. Curto
// o bastante para o flush pré-import do .fdx não esperar, longo o bastante para
// não roubar um POST realmente em voo (o backend deduplica por requestId).
const IN_FLIGHT_LEASE_MS = 120_000;

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

// Resolução 'remote' de conflito (AD-02): força a versão do backend no SQLite
// local. Singleton como o activeSyncNow, para a UI de conflito disparar sem
// prop-drilling.
let activeApplyRemote: ((storyId: string) => Promise<boolean>) | null = null;

/** Força a versão do backend de uma story no SQLite local (aceitar 'remote' num
 *  conflito). Retorna false se não há ciclo ativo ou a story não veio do backend. */
export async function applyRemoteStory(storyId: string): Promise<boolean> {
  return activeApplyRemote ? activeApplyRemote(storyId) : false;
}

// Flush só-push da fila (sem pull). Usado antes de escrever no backend do
// freeform: garante que a story recém-criada já esteja registrada no /works
// (ownership), senão o freeform nega com "Not authorized for this story".
let activeFlush: (() => Promise<void>) | null = null;

/** Drena a fila de push agora (registra mutações pendentes no backend). No-op se
 *  não houver ciclo ativo. */
export async function flushPushNow(): Promise<void> {
  if (activeFlush) await activeFlush();
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

  const reclaimInFlight = async (leaseMs: number): Promise<void> => {
    try {
      const n = await deps.reclaimInFlightQueue(new Date().toISOString(), leaseMs);
      if (n > 0) console.warn(`[desktop-lifecycle] ${n} mutação(ões) presas em in_flight devolvidas à fila`);
    } catch (e) {
      console.error('[desktop-lifecycle] reclaim in_flight falhou', e);
    }
  };

  const flushAll = async (): Promise<void> => {
    try {
      // Antes de drenar: devolve à fila o que ficou preso em 'in_flight' de um
      // ciclo morto. Sem isto o flush é um no-op justamente para a story cuja
      // entry travou — e é dela que o freeform precisa a ownership.
      await reclaimInFlight(IN_FLIGHT_LEASE_MS);
      await deps.processQueue({ getToken });
    } catch (e) {
      console.error('[desktop-lifecycle] flushAll falhou', e);
    }
  };
  activeFlush = flushAll;

  // Pull + push manual (Retry sync). Re-arma primeiro as entries que desistiram
  // (o "Retry" do usuário é um pedido explícito de reprocessar tudo, inclusive
  // gave-ups que o backoff automático não ressuscita — ex.: depois que a
  // conectividade/CORS foi corrigida). Depois pull (deltas do backend) e push.
  // Não-destrutivo.
  const syncNow = async (): Promise<void> => {
    try {
      await deps.rearmFailedQueue(new Date().toISOString());
      await reclaimInFlight(IN_FLIGHT_LEASE_MS);
      await deps.runPull({ userId, getWorks: getWorksOngoing, since: null, onConflict: opts.onConflict });
      await deps.processQueue({ getToken });
    } catch (e) {
      console.error('[desktop-lifecycle] syncNow falhou', e);
    }
  };
  activeSyncNow = syncNow;

  // Aceitar 'remote' num conflito: FORÇA a story do backend no SQLite local,
  // pulando o isPullConflict (que, no ciclo normal, só re-emitiria o conflito e
  // daria `continue` sem aplicar). Sem isto, o mesmo conflito reaparece a cada
  // boot mesmo "resolvido". upsertStory grava synced_at=now + version=remoto, o
  // que zera a condição (hasLocalPendingEdit=false, remote.version==local).
  const applyRemoteFn = async (targetStoryId: string): Promise<boolean> => {
    try {
      const works = await getWorksOngoing();
      const at = new Date().toISOString();
      for (const raw of works) {
        let row;
        try {
          row = mapStoryToRow(raw, { userId, now: at });
        } catch {
          continue; // story malformada
        }
        if (row.story_id !== targetStoryId) continue;
        await storyRepo.upsertStory(row);
        const { rows } = normalizeCharacters(raw.characters, row.story_id, at);
        await characterRepo.replaceCharactersForStory(row.story_id, rows);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[desktop-lifecycle] applyRemoteStory falhou', e);
      return false;
    }
  };
  activeApplyRemote = applyRemoteFn;

  // (1) Sessão OS-aware: configura JIT refresh no safeApiCall + flush on quit.
  const stopSession = deps.startSession({ onToken: opts.onToken, flush: flushAll });

  let stopScheduler: (() => void) | null = null;

  // (2) Initial pull (1º login) -> (3) scheduler. O scheduler liga MESMO se o
  // initial pull falhar (resiliência: o pull periódico se recupera depois).
  const ready: Promise<void> = (async () => {
    // Boot: nada pode estar legitimamente em voo antes do worker existir, então
    // TODA entry em 'in_flight' é órfã de um ciclo anterior (app fechado no meio
    // do POST, reload do renderer) — lease 0.
    await reclaimInFlight(0);
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
    if (activeApplyRemote === applyRemoteFn) activeApplyRemote = null;
    if (activeFlush === flushAll) activeFlush = null;
  };

  return { stop, flushAll, syncNow, ready };
}
