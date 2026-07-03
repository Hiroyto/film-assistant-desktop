# Migrations — SQLite local

Convenção: um arquivo `v<n>.sql` por versão de schema, idempotente (`IF NOT EXISTS`).
Rodam no **boot** do app, em ordem crescente de `n`, dentro de uma transação.

## Como o runner funciona (implementado na Tarefa 07)

1. Abre a conexão e seta pragmas: `PRAGMA journal_mode = WAL;` + `PRAGMA foreign_keys = ON;`.
2. Lê a maior `version` em `schema_version` (0 se a tabela não existir).
3. Para cada `v<n>.sql` com `n > version_atual`, em ordem: executa em transação e
   grava `INSERT INTO schema_version(version, applied_at) VALUES (n, <ISO-8601 now>)`.
4. `CURRENT_SCHEMA_VERSION` (em `../rows.ts`) deve sempre bater com o maior `n`.

## Arquivos

- `v1.sql` — schema inicial (9 tabelas, BC-01/02/03/05/06/08/10). Validado contra DB vazio.

## Notas

- `schema.sql` (na pasta acima) é a **referência canônica** do schema completo — útil para
  inspeção e para recriar do zero. As migrations incrementais é que rodam em produção.
- Não editar uma migration já publicada; criar `v<n+1>.sql` para mudanças futuras.
