# BC-02 — Story Workspace (`features/story-workspace`)

Home: brainstorm, foundation, outline (9 segments / 3 atos). UI legada (`components/Home/`
+ Layer B) **preservada** (Op3); esta feature provê o model + a correção do save.

## Construído na Tarefa 10

| Arquivo | Papel | Regras |
|---|---|---|
| `model/storySerialization.ts` | **Coração do fix do lossy save**: toda path serializa `{S, scenes}`, nunca scalar. canonical↔row↔wire. | BR-MIGRAR-013, tech-debt #1, RISK-011 |
| `model/storySave.ts` | save **local-first** (write SQLite imediato) + push debounced 10s / imediato; autosave 30min = flush queue. | AD-01, BR-MIGRAR-014/015 |
| `model/storyCommands.ts` | create (storyId client-gen, limite 5), persist (user/ai), soft-delete. | BR-MIGRAR-009/011, COD-002 |
| `model/outlineEstimate.ts` | tempos de overlay (full = 50500ms). | BR-MIGRAR-050 |
| `story-workspace.test.ts` | prova que editar synopsis/outline **não apaga scenes** + round-trip. | RISK-011 |

## ⚠️ COD-005 — Layer B move (~3 800 LOC) — PENDENTE (mecânico)

Os ~30 flat files home-leaning em `src/components/` root (`HomePage`, `StorySegment`,
`Intern*`, `ScenesIntern*`, `Floating*`, `OverwriteConfirmModal`, `SynopsisRefinementModal`,
etc — inventário em `topology_decision.md §Mapa da árvore legada`) devem migrar para
`src/components/Home/` — **é só import path change** (sem reescrita de lógica).

**Por que pendente:** é um refactor de imports que toca muitos arquivos do renderer
(usados também pela web). Sem `tsc`/build disponível neste ambiente, um move cego
arriscaria quebrar imports sem detecção. Recomendação: executar com `npm install` +
`tsc --noEmit` validando cada move (codemod de paths). Não bloqueia o resto da feature.

## COD-002 — storyId client-gen definitivo

`createStory` gera o `storyId` (`story_<ms>_<rand6>`) e o trata como definitivo. O backend
**não pode sobrescrevê-lo** no primeiro save (senão o sync quebra). Validar com a Lambda
`/works` (REFERIDO À CODIFICAÇÃO).

## Integração no App.tsx (com a Tarefa 08)

- Trocar o 3-layer save legado por `persistStory(story, userId, source)`.
- `startAutoSave(flushQueue)` substitui o `setInterval(1_800_000)` legado.
- Story switch / AI response chamam `persistStory(..., 'ai')` (force immediate).
- `startSession`/`startSyncScheduler` (Tarefa 08) já cobrem refresh + pull/push.
