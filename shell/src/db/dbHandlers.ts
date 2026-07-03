// Handlers IPC da camada de dados (main). Ponte SQL parametrizada para o renderer.
// Seguro porque o renderer é 100% código próprio (sem conteúdo remoto). Toda query
// usa params (sem interpolação de string).
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

/** Inicializa o banco (migrations) e registra os handlers IPC. Chamado no boot. */
export function registerDbHandlers(): void {
  runMigrations();

  ipcMain.handle(IPC.DB_QUERY, (_event, req: DbQueryRequest) => {
    const stmt = getDb().prepare(req.sql);
    const params = req.params ?? [];
    if (req.mode === 'run') {
      const info = stmt.run(...params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    }
    if (req.mode === 'get') return stmt.get(...params) ?? null;
    return stmt.all(...params);
  });

  // Batch transacional (ex: replaceCharactersForStory = DELETE + N INSERTs).
  ipcMain.handle(IPC.DB_BATCH, (_event, req: DbBatchRequest) => {
    const db = getDb();
    const tx = db.transaction((ops: DbBatchRequest['ops']) => {
      for (const op of ops) {
        db.prepare(op.sql).run(...(op.params ?? []));
      }
    });
    tx(req.ops);
    return { ok: true };
  });
}
