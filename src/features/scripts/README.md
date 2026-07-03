# BC-03 — Screenplay (`features/scripts`)

Editor TipTap + 3-handoff + inline AI + autofill. **A LÓGICA DO EDITOR TIPTAP É
INTOCADA** (RISK-002, canário do brief): `components/Scripts/editor/` (extensions,
tools) é preservado verbatim. Esta camada adiciona apenas persistência local-first e
o watchdog do AI lock.

## Construído na Tarefa 11

| Arquivo | Papel | Regras |
|---|---|---|
| `model/screenplayPersistence.ts` | HTML em SQLite (BLOB) substitui localStorage; load priority SQLite>state>S3; save local + push S3 com retry. | BR-MIGRAR-034/035/036, AD-01 |
| `model/aiLockWatchdog.ts` | watchdog 120s+grace força unlock do editor (anti stuck-state). | COD-004, BR-MIGRAR-051, FIL-315 |
| `scripts.test.ts` | prioridade de carga, round-trip BLOB, timing do watchdog. | — |

## Preservados verbatim (apenas documentados)

- **3-handoff pipeline** (`useSceneGeneration`) com `conversation_history` cross-handoff
  e gate `requires_third_handoff` — BR-MIGRAR-047/048 (ADR-0006). Lógica intocada.
- **Inline AI** (`useInlineAI`, wordDiff per-fragment) — adota `createAiLockWatchdog`:
  `start()` ao travar, `clear()` no success/error, `onTimeout` força unlock.
- **Guided generation** (Cmd+J) e **autofill** (character/slugline/transition) — intocados.
- **AI timeout 120s + auto-retry 5xx** já vive no `safeApiCall` (Tarefa 05 / BR-MIGRAR-038).
- **dirty-scene extraction antes da AI** (BR-MIGRAR-037 / FIL-302): preservado; offline,
  diferir a generation com mensagem (guard pela flag de online).

## Integração (adoção pelo editor legado)

```ts
const watchdog = createAiLockWatchdog((op) => { forceUnlockEditor(); /* emit ai.failed */ });
// ao iniciar AI: lockEditor(); watchdog.start('inlineAI')
// no finally:   watchdog.clear(); unlockEditor()
// load:  setHtml(await loadScreenplay(storyId, { stateHtml, fetchFromS3 }))
// save:  await saveScreenplay(storyId, editor.getHTML())
```
