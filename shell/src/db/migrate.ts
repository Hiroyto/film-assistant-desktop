// Runner de migrations (main process). Aplica migrations/v<n>.sql em ordem, dentro
// de transação, e registra em schema_version. Idempotente (IF NOT EXISTS nas SQLs).
// Fonte única das migrations: src/data/local-db/migrations (mantido no pacote — ver
// forge.config.js ignore com lookahead negativo).
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './database';

/**
 * Resolve o diretório das migrations, robusto aos vários modos de launch:
 *  - packaged (asar) e `electron .`: app.getAppPath() = raiz do app (contém src/).
 *  - dev `electron shell/dist/main.js`: app.getAppPath() = shell/dist, então
 *    subimos de ESTE arquivo compilado (shell/dist/db) até a raiz do projeto.
 *  - fallback: CWD (os npm scripts rodam a partir da raiz do projeto).
 * Usa o primeiro candidato que existir.
 */
function migrationsDir(): string {
  const rel = ['src', 'data', 'local-db', 'migrations'];
  const candidates = [
    path.join(app.getAppPath(), ...rel),
    path.join(__dirname, '..', '..', '..', ...rel), // shell/dist/db -> raiz
    path.join(process.cwd(), ...rel),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  console.error('[migrate] diretório de migrations não encontrado. Tentados:', candidates);
  return candidates[0];
}

/** Lista v<n>.sql ordenados por n crescente. */
function listMigrations(dir: string): { version: number; file: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => {
      const m = /^v(\d+)\.sql$/.exec(f);
      return m ? { version: Number(m[1]), file: path.join(dir, f) } : null;
    })
    .filter((x): x is { version: number; file: string } => x !== null)
    .sort((a, b) => a.version - b.version);
}

function currentVersion(): number {
  const db = getDb();
  // schema_version pode não existir ainda (primeiro boot).
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  if (!exists) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  return row?.v ?? 0;
}

/** Aplica todas as migrations pendentes. Roda no boot. */
export function runMigrations(): void {
  const db = getDb();
  const dir = migrationsDir();
  const all = listMigrations(dir);
  const from = currentVersion();

  for (const { version, file } of all) {
    if (version <= from) continue;
    const sql = fs.readFileSync(file, 'utf8');
    const applyTx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
    });
    applyTx();
    console.log(`[migrate] aplicada v${version}`);
  }
}
