# BC-04 — Scenes & Canvases (`features/scenes` + `features/scenes-canvas`)

Scene cards por segment + 2 canvases (Segment + Scenes). Aggregate `Scene` único
compartilhado pelas duas superfícies UI (um bounded context). UI legada
(`components/Scenes`, `ScenesCanvas`, `canvas/` fundido) **preservada** (Op3).

## Construído na Tarefa 12

| Arquivo | Papel | Regras |
|---|---|---|
| `scenes/model/sceneOps.ts` | add/update/delete/reorder/replace de scenes — PURO, preserva `.S` e demais segments. Único módulo que escreve `{S,scenes}`. | BR-MIGRAR-032, Scene canônico BR-052 |
| `scenes/model/sceneSync.ts` | `computeSegmentSyncOps` — fan-out por segment alterado; **vazio => DELETE (COD-001)**. | BR-MIGRAR-033 |
| `scenes/model/saveScenes.ts` | write local-first + fan-out de sync; substitui o debounce no-op (tech-debt #2). | AD-01, BR-MIGRAR-033 |
| `scenes-canvas/index.ts` | re-exporta o model (2ª superfície do mesmo aggregate). | BC-04 |
| `scenes.test.ts` | ops preservam outline/segments; fan-out + COD-001. | — |

## COD-001 — DELETE de scenes órfãs

O backend legado **mantinha** as scenes antigas quando um segment ficava vazio (não
recebia DELETE). Agora `computeSegmentSyncOps` emite `kind:'delete'` (`event:'delete-scenes'`)
para segments que foram esvaziados. **Validar com a Lambda `/works`** se ela aceita o
DELETE/`delete-scenes` (REFERIDO À CODIFICAÇÃO).

## Integração

```ts
let story = addScene(story, 'S2', { title: 'Abertura' }); // ou update/delete/reorder
const ops = await saveScenes(prevStory, story, userId);   // local + fan-out por segment
```
A vista "All Scenes" chama a MESMA `saveScenes` (não mais o no-op debounce do legado).
