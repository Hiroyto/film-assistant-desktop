// Instala window.__TEST__ — a TestBridge que os parity specs consomem
// (parity/specs/*.spec.ts e parity/fixtures.ts). Idempotente e totalmente inerte
// fora do modo teste (web/produção: early-return, custo ~zero).
//
// window.__TEST__ é um Proxy AO VIVO: hooks de feature registrados DEPOIS do install
// (durante o mount dos módulos) aparecem mesmo assim. Specs usam optional chaining
// (window.__TEST__?.foo?.()), então um hook ainda-não-registrado devolve undefined e
// o passo é pulado com elegância — nada de resultados fabricados.
//
// Composição da superfície:
//   • Hooks de INFRAESTRUTURA (abaixo) — funcionais hoje, ligados a seams existentes:
//     SQLite via IPC db:query, eventos OS/deep-link/menu via __TEST_SHELL__,
//     openExternal registrado no main, conflito de sync via barramento de eventos.
//   • Hooks de FEATURE — registrados por seus módulos donos via registerTestHook
//     (relógio, safeApi, WS de personagens, pipeline de IA, billing). Ver README.
import { getRegisteredHooks, isTestMode, registerTestHook } from './registry';
import { emit as emitSyncEvent } from '../data/sync-agent/events';
import { armPushRecorder, getPushOrder } from '../data/sync-agent/pushRecorder';
import { armHandoffRecorder, getHandoffHistories } from '../features/scripts/model/handoffRecorder';
import { armAuthTestSeam } from '../features/auth/model/authTestSeam';
import { armCharacterWsTestSeam } from '../lib/characterWsTestSeam';
import { installFakeClock } from '../lib/clock';
import { armConflictRecorder, getLastResolved } from './conflictRecorder';

const QUEUE_DEPTH_SQL = "SELECT COUNT(*) AS n FROM sync_queue WHERE status != 'succeeded'";

function shell(): any {
  return (window as any).__TEST_SHELL__;
}

/** Hooks ligados a seams que JÁ existem — sempre presentes em modo teste. */
function infraHooks(): Record<string, (...a: any[]) => any> {
  const api = window.electronAPI!;
  return {
    // --- Estado local-first (SQLite via IPC db:query — mesmo caminho dos repos) ---
    dbGet: (sql: string, params: unknown[] = []) =>
      api.dbQuery!({ sql, params, mode: 'get' }),
    queueDepth: async () => {
      const row: any = await api.dbQuery!({ sql: QUEUE_DEPTH_SQL, params: [], mode: 'get' });
      return (row?.n as number) ?? 0;
    },

    // --- Eventos do shell, reemitidos pelo main idênticos à produção ---
    emitOs: (event: string) => shell().emitOs(event),
    emitDeepLink: (url: string) => shell().emitDeepLink(url),

    // --- Auto-update (SCR-0029): injeta update.downloaded/available e observa install ---
    emitUpdate: (type: string, version?: string) => shell().emitUpdate(type, version),
    installRequested: () => shell().installRequested(),

    // --- Menu nativo (introspecção/condução no main — spec 12) ---
    menuStructure: () => shell().menuStructure(),
    menuItemEnabled: (id: string) => shell().menuItemEnabled(id),
    clickMenu: (event: string) => shell().clickMenu(event),
    clickMenuLabel: (label: string) => shell().clickMenuLabel(label),

    // --- openExternal (Stripe AD-04 / menu) registrado no main ---
    // O recorder do main fica sempre armado em teste; spyOpenExternal é só semântico.
    spyOpenExternal: () => undefined,
    lastOpenExternal: () => shell().lastOpenExternal(),

    // --- Conflito de sync (AD-02) via barramento de eventos do renderer ---
    emitConflict: (entityType = 'story', entityId = 'active') =>
      emitSyncEvent('sync.conflict', { entityType, entityId }),
  };
}

let installed = false;

/** Monta window.__TEST__ se em modo teste no desktop. No-op em web/produção. */
export function installTestBridge(): void {
  if (installed || !isTestMode()) return;
  if (!window.electronAPI?.dbQuery) return; // sem camada de dados não há o que observar
  installed = true;

  // Relógio fake: substitui o seam `clock` adotado por watchdogs/polling/autosave.
  // advanceTimers avança o tempo virtual e, depois, cede ao event loop real (setTimeout
  // global NÃO é fakeado) para o trabalho assíncrono pendente (IPC/enqueue) assentar
  // antes do spec assertar.
  const fakeClock = installFakeClock();
  const flushAsync = () => new Promise<void>((r) => setTimeout(r, 0));
  registerTestHook('advanceTimers', async (ms: number) => {
    fakeClock.advance(ms);
    await flushAsync();
    await flushAsync();
  });

  // Ordem de push ao backend (spec 03 @ordem) — o push-queue grava no recorder.
  armPushRecorder();
  registerTestHook('capturedPushOrder', () => getPushOrder());

  // conversation_history dos 3 handoffs (specs 04/10) — o pipeline grava no recorder.
  armHandoffRecorder();
  registerTestHook('handoffHistories', () => getHandoffHistories());

  // Token refresh OS-aware + callSafeApi (specs 02/09) — sessão virtual + JIT real.
  armAuthTestSeam();

  // Personagens via WebSocket (spec 05) — injeção de batch/refresh + characterCount.
  armCharacterWsTestSeam();

  // Resolução de conflito aplicada (spec 12 t17) — o DesktopShell grava no recorder.
  armConflictRecorder();
  registerTestHook('lastResolved', () => getLastResolved());

  const infra = infraHooks();
  (window as any).__TEST__ = new Proxy(
    {},
    {
      get(_t, prop: string) {
        const hooks = getRegisteredHooks(); // hooks de feature têm prioridade
        if (prop in hooks) return hooks[prop];
        if (prop in infra) return (infra as any)[prop];
        return undefined;
      },
      has(_t, prop: string) {
        return prop in getRegisteredHooks() || prop in infra;
      },
    },
  );
}
