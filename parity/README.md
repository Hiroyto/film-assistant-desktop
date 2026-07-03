# Suíte de Paridade (Tarefa 17 / parity_specs.md)

Traduz os ~60 cenários Gherkin dos 12 `parity_tests/*.feature` para Playwright,
rodando contra **web SPA** (oráculo, `localhost:3000`) e **desktop** (Electron). Honra
a estratégia do `parity_specs.md`: characterization + contract + data parity + golden
(literal) + contract semântico (modernizado).

## Estrutura

```
parity/
├── playwright.config.ts   # projetos 'web' e 'desktop' (≤1% pixel diff)
├── fixtures.ts            # dual-client (page) + TestBridge (SQLite/queue/eventos)
├── helpers/golden.ts      # golden file (modo literal)
└── specs/01..12.spec.ts   # 1:1 com os .feature (mesmos nomes/tags de cenário)
```

| Spec | Feature | Foco / risco |
|---|---|---|
| 01 | auth signin+confirm | BR-001..008, DEV-009/010 |
| 02 | token refresh OS-aware | AD-03, RISK-007 |
| 03 | story create/edit/save local-first | AD-01, **RISK-011** (lossy save) |
| 04 | screenplay TipTap + sync | **RISK-002** (canário) |
| 05 | characters CRUD + refresh | AD-05, tech-debt #3 |
| 06 | stripe deep link + polling | AD-04, **RISK-006** |
| 07 | offline edit + reconnect | AD-01, idempotência |
| 08 | sync conflict resolution | AD-02, **RISK-003** |
| 09 | save-on-sign-out | BR-008 |
| 10 | AI 3-handoff | BR-044..051 |
| 11 | 26 telas literal (golden) | paridade visual ≥99% |
| 12 | 4 telas modernizado (contract) | DEV-001..004, IPC |

## Como rodar (pré-requisitos)

1. **App montado**: o renderer precisa estar integrado (montagem do App + features),
   e um **build de teste** deve expor `window.__TEST__` (TestBridge: `dbGet`, `queueDepth`,
   `emitOs`, `emitDeepLink`, `menuStructure`, `emitWsRefresh`, etc) e aceitar `?screen=`/`?fixture=`.
2. **Backend de teste** AWS (Cognito + Lambdas) ou mocks via `page.route`.
3. Web oráculo: `npm start` (CRA) em `:3000`.
4. Rodar:
   - `npm run parity:web` (captura golden / valida web)
   - `npm run parity:update-golden` (gera baselines)
   - `npm run parity:desktop` (Electron; build automático antes)

## Critérios (parity_specs §critérios)

- `@paridade @critico` ≥ **95%** verdes (web ∧ desktop), 30 dias pré-release.
- `@paridade-visual` ≥ **99%** golden match (≤1% pixel).
- `@paridade-comportamental` **100%** contract das 4 telas novas.
- Conflict rate ≤10%, crash ≤2% (via `telemetry.getMetrics()` — Tarefa 16).

## Deviations (não são falhas)

`@regressao-esperada` marca divergências **intencionais** (DEV-006 Tour TAB/ESC, DEV-009
password/resend, etc). DEV-001..004 = telas modernizadas (sem baseline web → só contract).
DEV-008 Privacy dialog = byte-a-byte. Lista completa: `screen_deviation_log.md` (10 aprovadas).

## ⚠️ Estado honesto (atualizado 2026-06-24 — Tarefa 19)

Os specs estão **traduzidos e estruturados** fielmente (nomes/tags/passos). A
**instrumentação de código** que faltava foi implementada (Tarefa 19):

- ✅ **TestBridge de infraestrutura** (`window.__TEST__`): `dbGet`, `queueDepth`,
  `emitOs`, `emitDeepLink`, menu nativo, `lastOpenExternal`, `emitConflict`,
  `advanceTimers`, `capturedPushOrder`.
- ✅ **Hooks de feature**: `callSafeApi`/`setTokenExpiry`/`jitRefreshHappened`/
  `lastTokenRefreshed` (auth), `emitWsCharacters`/`emitWsRefresh`/`characterCount`
  (characters WS), `handoffHistories` (pipeline IA), `applyUser` (billing). Cada um
  com seam real no módulo dono, gated por `isTestMode()`. Ver `src/test-bridge/README.md`.
- ✅ **Roteamento de fixtures** `?screen=…&fixture=…`: subsistema `src/test-bridge/fixtures/`
  (parser + screenMap das 21 telas + catálogo das 26 fixtures + seeder via repos reais +
  boot driver no `App.tsx`, com bypass de auth do Amplify em modo teste).

**Ainda pendente (runtime/infra — fora do código do app):** (a) `npx playwright install`
(binários), (b) backend de teste AWS ou mocks completos via `page.route`, (c) captura de
golden baselines (specs 11/12), (d) execução end-to-end com o Electron empacotado. A honra
de `subview`/`hint` por uma sub-view específica é feita por-componente sob demanda.

Os seletores usam labels literais do Gherkin (getByRole/getByText) e o TestBridge para
estado local-first — nada de resultados fabricados. A lógica central de muitos cenários
já tem cobertura unit (jest) nos módulos: transforms, conflict-resolution, idempotency,
version-reconcile, sceneSync, storySerialization, characterCommands/refresh, passwordPolicy,
commandPalette, tourKeyboard, aiLockWatchdog, clock, pushRecorder, authTestSeam,
characterWsTestSeam, fixtures.
