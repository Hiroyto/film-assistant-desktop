# `src/data/` — Camada local-first (BC-08 Sync & Local Storage)

Camada **nova** (não existe no legado). Inverte o source-of-truth (AD-01): **SQLite local
é a verdade**; DynamoDB vira espelho sincronizado em background. Importável pelo código
React (por isso fica dentro de `src/`, não em pasta top-level).

> Borda desktop (AD-07): só o desktop usa esta camada. Na web, `if (window.electronAPI)`
> é falso e os hooks caem no comportamento legado (localStorage / online-first).

## Estrutura (scaffold após Tarefa 01)

```
data/
├── local-db/
│   ├── schema.sql          # Tarefa 02 — DDL SQLite (stories, characters, scenes, users, sync_queue, settings)
│   ├── migrations/         # Tarefa 02 — versionamento, roda no boot
│   └── repositories/       # Tarefa 07 — storyRepo, characterRepo, sceneRepo, userRepo, settingsRepo
├── sync-agent/             # Tarefa 07 — push-queue.ts, pull-strategy.ts, conflict-resolution.ts
└── sync-queue.ts           # Tarefa 07 — mutations pendentes + retry/backoff
```

## A construir

- **Tarefa 02**: schema + migrations SQLite (`target_data_model.md`).
- **Tarefa 03**: fluxos de migração de dados (initial pull + ongoing push/pull).
- **Tarefa 07**: repositories, sync agent (push/pull), conflict resolution (LWW + prompt — AD-02),
  `widgets/sync-status-bar`.
