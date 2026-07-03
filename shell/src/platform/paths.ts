// Platform — paths do OS (FS). Localização do arquivo SQLite (target_data_model.md).
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Caminho do banco SQLite local, OS-specific:
 *   Windows: %APPDATA%/film-assistant/film-assistant.db
 *   macOS:   ~/Library/Application Support/film-assistant/film-assistant.db
 * Garante que o diretório exista. Consumido pela camada de dados (Tarefa 07) via IPC.
 */
export function getDatabasePath(): string {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'film-assistant.db');
}
