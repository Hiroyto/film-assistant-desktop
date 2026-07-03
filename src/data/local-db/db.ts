// Executor de DB do renderer (BC-08). Proxy via IPC para o SQLite do main process.
// Os repositories usam estas funções; nunca tocam window.electronAPI diretamente.
//
// Na web (sem electronAPI) lança — a camada local-first é exclusiva do desktop (AD-07).
// Hooks de feature checam isDesktop() antes de usar.

import { isDesktop } from '../../lib/ipcClient';

export interface BatchOp {
  sql: string;
  params?: unknown[];
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

function ensureDesktop(): NonNullable<Window['electronAPI']> {
  if (!isDesktop() || !window.electronAPI?.dbQuery) {
    throw new Error('[db] camada local-first indisponível fora do desktop');
  }
  return window.electronAPI;
}

/** SELECT múltiplas linhas. */
export async function all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const api = ensureDesktop();
  return (await api.dbQuery!({ sql, params, mode: 'all' })) as T[];
}

/** SELECT uma linha (ou null). */
export async function get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const api = ensureDesktop();
  return (await api.dbQuery!({ sql, params, mode: 'get' })) as T | null;
}

/** INSERT/UPDATE/DELETE. */
export async function run(sql: string, params: unknown[] = []): Promise<RunResult> {
  const api = ensureDesktop();
  return (await api.dbQuery!({ sql, params, mode: 'run' })) as RunResult;
}

/** Vários statements em uma transação (ex: DELETE + N INSERTs). */
export async function batch(ops: BatchOp[]): Promise<void> {
  const api = ensureDesktop();
  if (!api.dbBatch) throw new Error('[db] dbBatch indisponível');
  await api.dbBatch({ ops });
}
