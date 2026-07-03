# BC-10 — Shared Foundations (kernel técnico)

Cross-cutting consumido por todos os BCs. Na topologia **Op3 (híbrido cirúrgico)** o
kernel permanece nas pastas legadas (`models/`, `lib/`) e é **alterado in-place** — não
há pasta `shared/` top-level (isso seria Op2, rejeitada).

## Construído / alterado na Tarefa 05

| Arquivo | Estado | Alteração da migração |
|---|---|---|
| `models/apiHelpers.ts` (`safeApiCall`) | preservado + alterado | JIT refresh (AD-03/BR-MIGRAR-007), refresh-on-401 (tech-debt #17), auto-retry único 5xx/network (COD-003/BR-MIGRAR-038), `X-Request-Id` idempotente (COD-008). `configureApi({getFreshToken})` wira o refresh — chamado na Tarefa 08. |
| `lib/useWebSocket.ts` | preservado + alterado | reconnect estendido (30s/1min/5min) sem desistir + reset no evento OS `online` (BR-MIGRAR-046). `computeReconnectDelay` puro/testado. |
| `lib/ipcClient.ts` | NOVO | acesso único do renderer ao `window.electronAPI` (borda AD-07); degrada na web. |
| `lib/stripeDeepLink.ts` | NOVO | primitivo do checkout via deep link (AD-04); fluxo completo + polling na Tarefa 09. |
| `electron.d.ts` | estendido | tipos opcionais `openExternal`/`onDeepLink`/`onOsEvent` (implementados na Tarefa 06). |

## Providers (preservados in-place — Op3)

- `components/AIModelContext.tsx` — `modelOverride` (BR-MIGRAR-049). **Preservado.**
- `components/ui/StoryUIContext.tsx` — `storyChangeSource` (BR-MIGRAR-016). **Preservado.**
- `UserContext` (em `App.tsx`) — a **extração/redução do App.tsx** ocorre nas tarefas de
  feature (08 auth, 10 story-workspace), onde o App é fatiado. BC-10 não a força agora
  para não quebrar o renderer web (Strangler Fig).

## UI primitives e types

- `components/ui/` (ConfirmModal, Tooltip, SegmentedControl, etc) e os tipos globais
  (`models/*`, `global.d.ts`) já são o "shared/ui" e "shared/types" do Op3 — preservados.
