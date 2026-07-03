# BC-05 — Characters (`features/characters`)

CRUD de characters, locks, refresh assíncrono via SQS+WebSocket. UI legada
(`components/characters-home`) preservada (Op3). Lógica antes espalhada no `App.tsx`
(1067-1121) extraída para cá.

## Construído na Tarefa 13

| Arquivo | Papel | Regras |
|---|---|---|
| `model/characterCommands.ts` | ops de array puras (PK=name, rename=delete+create) + `saveCharacters` (requer storyId). | BR-MIGRAR-018/019/020/024 |
| `model/refresh.ts` | refresh async: 202 → WS push com **watchdog 5min** (fix spinner-forever), requestId tracking, **offline→fila+retry**. | AD-05, BR-MIGRAR-022, tech-debt #3 |
| `lib/useCharacterWsBridge.ts` | **hook único** (COD-007): dedupe content-hash + merge respeitando locks + supressão de toast. | BR-MIGRAR-021/023/045, tech-debt #8 |
| `characters.test.ts` | CRUD, offline→queued, completed via WS, stale ignorado. | — |

## Destaques

- **COD-007 / tech-debt #8:** o merge WS, antes reimplementado em 3 sites (home/scenes/
  scripts), agora é **um** `useCharacterWsBridge`. Reset de dedupe no `storyId` change.
- **tech-debt #3 (spinner forever):** `refresh()` resolve com `timeout` após 5min sem WS
  push; a UI oferece retry. `requestId` stale é ignorado (`notifyWsResult` no-op).
- **AD-05 offline:** clicar refresh offline enfileira `character_refresh`; o push-worker
  re-tenta no reconnect.
- Defaults `importance='minor'`/`growth='static'` e shape array canônico vêm de
  `models/character.ts` (Tarefa 04 — BR-MIGRAR-024/025).

## Integração

```ts
const refreshCtrl = createCharacterRefresh({ getToken, events: { onTimeout: showRetryUI } });
const bridge = useCharacterWsBridge(userId, storyId, {
  initial: localChars,
  onRefreshResult: refreshCtrl.notifyWsResult,
});
// refresh: const r = await refreshCtrl.refresh(storyId); // 'completed' | 'timeout' | 'queued'
// salvar:  await saveCharacters(storyId, bridge.characters);
```
