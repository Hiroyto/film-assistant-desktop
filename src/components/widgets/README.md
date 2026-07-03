# Telas (Tarefa 15) — modo híbrido (26 literal + 4 modernizado)

Decisão: `screen_modernization_decision.md` (modo **híbrido**, aprovado). 26 telas legacy
em **literal** (passthrough do componente React legado, zero mudança visual); 4 telas
novas do shell em **modernizado** (desenhadas do zero). Deviations DEV-001..010 **todas
aprovadas**.

## 26 telas literal (SCR-0001..0026) — passthrough

`spec.kind: react-component-passthrough` — o componente React legado **É** a especificação.
Como o legado é preservado (Op3) e roda dentro do shell Electron, **não há código novo**:
as telas são os componentes em `src/components/{Login,Home,Scripts,Scenes,ScenesCanvas,
characters-home,Profile,Pricing,Tour,Error,ActionModals}/`. Validação = golden-file /
snapshot contra a web SPA (Tarefa 17). Fixes comportamentais já feitos: Tour TAB/ESC
(T14/COD-006, SCR-0023), Cmd+K consolidado (T14/COD-007, SCR-0024), Privacy literal
(DEC-008, SCR-0021 — sem limpeza visual).

## 4 telas modernizado (SCR-0027..0030) — construídas

| ID | Tela | Arquivo | Deviation |
|---|---|---|---|
| SCR-0027 | os-menu-bar | `shell/src/menu/appMenu.ts` (nativo Electron Menu; File/Edit/View/Help; Cmd+K, Tour, About, Check Updates) | DEV-001 |
| SCR-0028 | sync-status-bar | `widgets/sync-status-bar/SyncStatusBar.tsx` (ícones lucide + tokens semânticos; conflict prioridade máxima) | DEV-002 |
| SCR-0029 | update-available-modal | `widgets/update-available/UpdateAvailableModal.tsx` (Later suprime 24h; Restart Now → installUpdate) | DEV-003 |
| SCR-0030 | conflict-resolution-modal | `widgets/conflict-resolution/ConflictResolutionModal.tsx` (diff local/remoto + keep mine/use remote/keep both) | DEV-004 |

## Tokens (DEV-005)

`tokens-derived.md` §Semânticas adicionados ao `tailwind.config.js`: `semanticSuccess`
`#22c55e`, `semanticInfo` `#3b82f6`, `semanticWarning` `#f59e0b`, `semanticError` `#ef4444`,
`semanticMuted`. **Nunca hex literal solto** — consumidos via classes Tailwind. Tokens
legados (`bgdark*`, `orange*`, `fontWhite*`) preservados.

## IPC novo (SCR-0027/0029)

`shell:menu` (menu → renderer: `onMenu`), `shell:updateInstall` (renderer → main:
`installUpdate` → `autoUpdater.quitAndInstall`). Tipados em `electron.d.ts`/`channels.ts`.

## Integração

Montar no shell-frame do renderer (após assemblagem do App): `<SyncStatusBar/>` (footer),
`<UpdateAvailableModal/>` e `<ConflictResolutionModal resolve={...} loadDiff={...}/>` no root;
`window.electronAPI.onMenu(event => routeMenuEvent(event))` para os itens nativos.
