# `sync-agent/` — Plano de migração de dados realizado em código

Fonte: `_reversa_sdd/migration/data_migration_plan.md`.
**Não há ETL one-time**: o backend AWS continua autoritativo; o SQLite local espelha
on-demand. Cada user faz seu "cutover" implícito ao instalar e logar no desktop.

## Construído na Tarefa 03 (este conjunto)

| Arquivo | Conteúdo |
|---|---|
| `transforms.ts` | T-01..T-08 — funções puras DDB/S3 → linhas SQLite (segments JSON, characters array, scenes canônicas, MFA, timestamps, drop de campos out-of-scope). |
| `version-reconcile.ts` | Decisão do ongoing pull: compara `version`/`updated_at` local vs remoto → skip / apply / ignore / LWW; detecção de conflito multi-device (AD-02). |
| `idempotency.ts` | `request_id` UUID, backoff (1,2,4,8,16,30s), `MAX_ATTEMPTS=6`, watchdog 5min do character refresh. |
| `initial-pull.ts` | Orquestrador do initial pull (GET /user + /works → transforms → repos) + validação de integridade (counts). Contra interfaces injetadas. |
| `transforms.test.ts` | Testes (jest/`craco test`) das transformações e da reconciliação. |

## Construído na Tarefa 07 (BC-08) — usa os artefatos acima

| Arquivo | Papel | ✅ |
|---|---|---|
| `push-queue.ts` | Worker que lê `sync_queue`, faz POST com `X-Request-Id` (idempotency.ts), backoff persistente, 2xx→remove / 5xx→retry / 409→conflict. | ✅ |
| `pull-strategy.ts` | Ongoing pull; usa `version-reconcile.ts`; detecta conflito multi-device; full pull vs `?since=` (COD-009). | ✅ |
| `conflict-resolution.ts` | Last-write-wins + prompt em divergências grandes (>500 chars/>1h — AD-02). Decisão pura testada. | ✅ |
| `events.ts` | Barramento in-memory (`sync.state`/`queue.depth`/`conflict`/`applied`) p/ a sync-status-bar. | ✅ |
| `../../sync-queue.ts` | API de enqueue (gera id + request_id, acorda o worker). | ✅ |
| `../local-db/repositories/` | Repos concretos (via IPC db:query do shell). `initialPullRepos` satisfaz a interface da T03. | ✅ |
| `shell/src/db/*` | better-sqlite3 no main + migrations + handler IPC `db:query`/`db:batch`. | ✅ |
| `components/widgets/sync-status-bar` | UX online/syncing/offline/conflict + ações. | ✅ |

> Agendamento dos workers (boot, periodic 5min, on `os.online`/WS reconnect, on `before-quit`)
> é wirado na Tarefa 08 (auth/sessão) e nas features que disparam mutations.

## Fluxos (resumo do plano)

- **Initial pull** (1º login): `GET /user` (+ MFA) → `users`/`subscriptions`; `GET /works` →
  `stories` (+ `characters` por story). Screenplays **não** aqui — pull **lazy** ao abrir a
  story (`GET /scripts?storyId` + S3 → `screenplays.html_content`, Tarefa 11). Integridade:
  `COUNT(stories) == /works.length`, `COUNT(characters) == story.characters.length`.
- **Ongoing push**: nova mutation → entry em `sync_queue` → worker (lote ~10) → POST com
  `request_id` → 2xx grava `synced_at` e remove entry; 5xx/network → backoff; 409 → `conflict`.
- **Ongoing pull**: por entidade, compara version; aplica delta; LWW por `updated_at` em empate.
- **Character refresh** (BR-MIGRAR-022): POST `/story event=refresh_character_database` → 202 →
  espera WS push (watchdog 5min) → merge respeitando locks → remove entry por `request_id`.

## Itens REFERIDOS À CODIFICAÇÃO (verificar com o backend — não bloqueiam)

- **COD-008** — idempotência por `request_id` nas Lambdas (`/works`, `/scripts`, `/story`).
  Se ausente, retry pode duplicar mutations. Endereçar na **Fase 1** (Tarefa 07).
- **COD-009** — filtro `?since=<ISO-8601>` em `/works`. Se ausente, ongoing pull é full payload
  (~10KB) — aceitável até ~20 stories/user. Otimização futura.
