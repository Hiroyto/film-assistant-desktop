# TestBridge — instrumentação da suíte de paridade

`window.__TEST__` é a superfície que os parity specs (`parity/specs/*.spec.ts`) e as
fixtures (`parity/fixtures.ts`) acionam. Os specs **são o contrato** — `parity_specs.md`
não define o TestBridge. Tudo aqui ativa **somente** sob `ELECTRON_IS_TEST=1`
(setado pelas fixtures ao lançar o Electron); em web/produção é no-op total.

## Arquitetura

```
shell/src/test/testState.ts   # flag IS_TEST + canais TEST_IPC + recorder openExternal (sem deps de electron-main)
shell/src/test/testBridge.ts  # main: registra IPC test-only (OS, deep link, menu, lastOpenExternal)
shell/src/preload.ts          # expõe window.__TEST_SHELL__ (só sob IS_TEST)
src/test-bridge/registry.ts   # registerTestHook(name, fn) — módulos de feature contribuem seus seams
src/test-bridge/install.ts    # monta window.__TEST__ (Proxy vivo: infra + hooks registrados)
src/index.tsx                 # chama installTestBridge() no boot
```

Fluxo: fixtures lançam Electron com `ELECTRON_IS_TEST=1` → preload expõe
`window.__TEST_SHELL__` → `installTestBridge()` detecta o modo e monta
`window.__TEST__` como **Proxy ao vivo**, combinando hooks de infraestrutura com os
hooks de feature registrados via `registerTestHook` (mesmo os registrados depois do
boot aparecem). Specs usam optional chaining, então hook ausente → `undefined` → passo
pulado (nunca resultado fabricado).

## Hooks de infraestrutura — ✅ funcionais agora

Ligados a seams que já existem; não exigem mudança em módulo de feature.

| Hook | Como | Specs |
|---|---|---|
| `dbGet(sql, params)` | IPC `db:query` mode `get` | 03,04,05,07,08,09 |
| `queueDepth()` | `COUNT(*) sync_queue WHERE status!='succeeded'` | 03,04,07,08 |
| `emitOs(event)` | main reemite `IPC.OS_EVENT` (idêntico ao `osLifecycle.ts`) | 02,06,07,09 |
| `emitDeepLink(url)` | main parseia+reemite `IPC.DEEP_LINK` (idêntico ao `protocol.ts`) | 06 |
| `menuStructure()` | introspecção do `Menu` nativo no main | 12 |
| `menuItemEnabled(id)` | `getMenuItemById(id).enabled` | 12 |
| `clickMenu(event)` | main reemite `IPC.MENU {event}` | 12 |
| `clickMenuLabel(label)` | acha item por label e dispara `.click()` | 12 |
| `spyOpenExternal()` / `lastOpenExternal()` | recorder no main (`openExternal` registra a URL e, em teste, não abre o browser real) | 01,06,12 |
| `emitConflict(...)` | `emit('sync.conflict', …)` no barramento de eventos | 12 |
| `advanceTimers(ms)` | relógio fake (`src/lib/clock.ts`) adotado por watchdogs/polling/autosave; avança o tempo virtual e cede ao event loop p/ o async assentar | 04,05,06,07 |
| `capturedPushOrder()` | recorder na camada de dados (`src/data/sync-agent/pushRecorder.ts`); o push-queue grava o `request_id` no envio ao backend | 03 |

### Relógio controlável (`advanceTimers`) — ✅ funcional

`src/lib/clock.ts` é o seam único de temporização. Em produção delega aos timers reais;
em teste, `installFakeClock()` (chamado no `install.ts`) troca a implementação por um
relógio virtual e `advanceTimers(ms)` o avança, disparando callbacks vencidos de forma
determinística. Adotantes atuais (substituíram `setTimeout`/`setInterval` globais por
`clock.*`):

- `features/scripts/model/aiLockWatchdog.ts` — watchdog AI 120s+grace (spec 04)
- `features/characters/model/refresh.ts` — watchdog refresh 5min (spec 05)
- `features/pricing/model/checkoutFlow.ts` — polling Stripe 5s / deadline 2min (spec 06)
- `features/story-workspace/model/storySave.ts` — autosave 30min + debounce 10s (spec 07)

Outros sites de timer (`data/sync-agent/scheduler.ts`, `features/auth/model/session.ts`,
`lib/useWebSocket.ts`) **ainda usam timers globais**; adotem `clock` se specs futuros
precisarem controlá-los. Cobertura unit: `src/lib/clock.test.ts`.

## Hooks de feature — ✅ funcionais agora (Tarefa 19, 2026-06-24)

Cada um tem um seam real no seu módulo dono (gated por `isTestMode()`, inerte em
produção). `handoffHistories` já era armado no `install.ts` desde 2026-06-22.

| Hook(s) | Specs | Seam (módulo dono) |
|---|---|---|
| `callSafeApi(endpoint)`, `setTokenExpiry(s)`, `jitRefreshHappened()`, `lastTokenRefreshed()` | 02,09 | `features/auth/model/authTestSeam.ts` — injeta sessão virtual em `cognito.ts` (`setAuthSessionReaderForTest`); o `getFreshToken`/`forceRefreshToken` REAIS rodam sobre ela. |
| `handoffHistories()` | 04,10 | `features/scripts/model/handoffRecorder.ts` (armado em `install.ts`). |
| `emitWsCharacters(names)`, `emitWsRefresh(reqId?)`, `characterCount()` | 05 | `lib/characterWsTestSeam.ts` + `lib/wsTestChannel.ts` — injeção percorre o caminho real (`useWebSocket`→bridge→`notifyWsResult`). |
| `applyUser(obj)` | 06 | `App.tsx` (dono do estado `user`) — `setUser(prev=>({...prev,...patch}))`; header anima o overlay +N. |

### Como registrar (padrão)

No módulo dono, no caminho de teste:

```ts
import { registerTestHook, isTestMode } from '../test-bridge/registry';

if (isTestMode()) {
  registerTestHook('capturedPushOrder', () => [...pushedEntityIds]);
}
```

## Roteamento de fixtures `?screen=…&fixture=…` — ✅ implementado (Tarefa 19D)

Subsistema separado em `src/test-bridge/fixtures/` (parser, `screenMap`, `catalog` das
26 fixtures, `seedPlan` puro, `applySeed` via repos reais, `boot` driver) +
`src/test-bridge/fixtureContext.tsx`. O `App.tsx` (modo teste) lê os query params no
boot, semeia banco local + usuário, navega para a rota da tela e expõe `subview`/`hint`
via `FixtureProvider`. O gate de auth do Amplify é bypassado por `useAuthStatus()` em
modo teste. **Cobertura unit:** `fixtures/fixtures.test.ts`. A montagem real (auth
bypass + navegação + seeding SQLite) só roda no **runtime Electron** (não sob jest); a
honra de `subview`/`hint` por uma sub-view específica é feita por-componente sob demanda.
