// Handlers IPC da camada de dados (main). Ponte SQL parametrizada para o renderer.
// O renderer é código próprio, mas NÃO é confiável por definição (XSS, dependência
// comprometida, navegação sequestrada). Por isso o main valida cada request:
//   - shape (sql string, params array, mode válido);
//   - uma statement por prepare() (better-sqlite3 já rejeita várias);
//   - sem ATTACH/DETACH/VACUUM/PRAGMA: ATTACH e VACUUM INTO criam arquivos em
//     qualquer caminho do disco; PRAGMA muda journal/foreign_keys/writable_schema.
//     O main é quem seta os pragmas (database.ts); o renderer só faz DML/DDL no
//     banco do app.
import { ipcMain } from 'electron';
import { IPC } from '../ipc/channels';
import { getDb } from './database';
import { runMigrations } from './migrate';

export interface DbQueryRequest {
  sql: string;
  params?: unknown[];
  mode: 'run' | 'all' | 'get';
}

export interface DbBatchRequest {
  ops: { sql: string; params?: unknown[] }[];
}

const MODES = new Set(['run', 'all', 'get']);
const MAX_BATCH_OPS = 10_000;
/** Comentários iniciais (-- … / /* … *​/) antes da primeira keyword. */
const LEADING_COMMENTS = /^(\s*(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/))*\s*/;
const FORBIDDEN_STATEMENT = /^(ATTACH|DETACH|VACUUM|PRAGMA)\b/i;

/** Valida e devolve o SQL; lança em request malformado ou statement proibida. */
export function assertSafeSql(sql: unknown): string {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new Error('db: sql deve ser uma string não vazia');
  }
  const head = sql.replace(LEADING_COMMENTS, '');
  const m = FORBIDDEN_STATEMENT.exec(head);
  if (m) throw new Error(`db: statement não permitida via IPC: ${m[1].toUpperCase()}`);
  return sql;
}

export function assertParams(params: unknown): unknown[] {
  if (params === undefined || params === null) return [];
  if (!Array.isArray(params)) throw new Error('db: params deve ser um array');
  return params;
}

/** Inicializa o banco (migrations) e registra os handlers IPC. Chamado no boot. */
export function registerDbHandlers(): void {
  runMigrations();

  ipcMain.handle(IPC.DB_QUERY, (_event, req: DbQueryRequest) => {
    if (!req || typeof req !== 'object') throw new Error('db: request inválido');
    if (!MODES.has(req.mode)) throw new Error('db: mode inválido');
    const sql = assertSafeSql(req.sql);
    const params = assertParams(req.params);
    const stmt = getDb().prepare(sql);
    if (req.mode === 'run') {
      const info = stmt.run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    }
    if (req.mode === 'get') return stmt.get(...params) ?? null;
    return stmt.all(...params);
  });

  // Batch transacional (ex: replaceCharactersForStory = DELETE + N INSERTs).
  ipcMain.handle(IPC.DB_BATCH, (_event, req: DbBatchRequest) => {
    if (!req || !Array.isArray(req.ops)) throw new Error('db: batch.ops deve ser um array');
    if (req.ops.length > MAX_BATCH_OPS) throw new Error('db: batch grande demais');
    // Valida TUDO antes de abrir a transação — nada é executado se algo for inválido.
    const ops = req.ops.map((op) => ({ sql: assertSafeSql(op?.sql), params: assertParams(op?.params) }));
    const db = getDb();
    const tx = db.transaction((list: typeof ops) => {
      for (const op of list) db.prepare(op.sql).run(...op.params);
    });
    tx(ops);
    return { ok: true };
  });
}
