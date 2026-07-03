# BC-07 — Onboarding & Commands (`features/tour` + `features/commands`)

Tour in-context + Cmd+K palette. UI legada (`components/Tour`, `src/commands/*`)
preservada (Op3); `CommandPaletteUI` (dead code) já removido na Tarefa 01.

## Construído na Tarefa 14

| Arquivo | Papel | Regras |
|---|---|---|
| `tour/model/tourKeyboard.ts` | bloqueia 9 nav keys **+ TAB**; **ESC = skip explícito** com mensagem; scroll-lock. | BR-MIGRAR-040, COD-006 |
| `commands/model/commandPalette.ts` | controller **único** (1 open state, 1 listener Cmd/Ctrl+K) — substitui os 3 do legado. | BR-MIGRAR-039, tech-debt #9, DEV-007 |
| `commands.test.ts` | bloqueio/skip do tour + toggle/close do palette. | — |

## Destaques

- **COD-006:** o legado deixava TAB/ESC escaparem. Agora `handleTourKeydown` bloqueia TAB
  e trata ESC como **skip explícito** (`onSkip`) — acessível e previsível.
- **tech-debt #9:** Cmd+K era registrado em `CommandBar`, `useCommandPalette` e
  `CommandUIContext` (3 listeners, 2 flags). Agora a instância única `commandPalette`
  centraliza tudo; os componentes legados consomem `subscribe`/`toggle`/`mount`.
- **Desktop:** registrar também o atalho no **menu nativo do OS** (Cmd+K macOS / Ctrl+K
  Windows) para descobribilidade — feito no shell menu (Tarefa 15).

## Integração

```ts
// Tour: no TourProvider, um único window.addEventListener('keydown', e => handleTourKeydown(e, { onSkip }))
// Commands: useEffect(() => commandPalette.mount(), []) — UM listener;
//           const open = useSyncExternalStore(commandPalette.subscribe, commandPalette.isOpen)
```
