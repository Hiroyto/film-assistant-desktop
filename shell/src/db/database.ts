// SQLite local (main process) — source-of-truth (AD-01). better-sqlite3 é módulo
// nativo Node; por isso o banco vive no main e o renderer fala via IPC (db:query).
import Database from 'better-sqlite3';
import { getDatabasePath } from '../platform/paths';

let db: Database.Database | null = null;

/** Abre (lazy) a conexão e seta os pragmas (WAL + foreign_keys — target_data_model.md). */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDatabasePath());
    db.pragma('journal_mode = WAL'); // reduz lock contention sync<->UI
    db.pragma('foreign_keys = ON'); // integridade referencial (por conexão)
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
